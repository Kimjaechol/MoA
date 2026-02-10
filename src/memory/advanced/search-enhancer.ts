/**
 * MoA Advanced Memory v2 — Search Enhancer
 *
 * Enhances the base OpenClaw search with:
 *   1. Metadata pre-filtering (SQL WHERE) → narrow candidates
 *   2. Time decay scoring → recent/active items first
 *   3. Link traversal (1-hop) → expand with related documents
 *
 * Replaces v1's 3-way fusion search (vector + BM25 + graph).
 * Works with the single memory.db — no graph.db needed.
 */

import type { DatabaseSync } from "node:sqlite";
import type { AdvancedSearchFilters, AdvancedSearchResult, PersonEntry } from "./types.js";
import { expandViaLinks } from "./backlinks.js";
import { applyTimeDecay, touchAccessedChunks } from "./time-decay.js";

// ─── Metadata Pre-filtering ───

/**
 * Build SQL WHERE clause from search filters.
 * Returns conditions and parameter values for prepared statement.
 */
export function buildMetadataFilter(filters: AdvancedSearchFilters): {
  where: string;
  values: Array<string | number>;
} {
  const conditions: string[] = [];
  const values: Array<string | number> = [];

  if (filters.type) {
    conditions.push("type = ?");
    values.push(filters.type);
  }
  if (filters.caseRef) {
    conditions.push("case_ref = ?");
    values.push(filters.caseRef);
  }
  if (filters.domain) {
    conditions.push("domain = ?");
    values.push(filters.domain);
  }
  if (filters.status) {
    conditions.push("status = ?");
    values.push(filters.status);
  }
  if (filters.importanceMin != null) {
    conditions.push("importance >= ?");
    values.push(filters.importanceMin);
  }
  if (filters.dateFrom) {
    conditions.push("created_at >= ?");
    values.push(filters.dateFrom);
  }
  if (filters.dateTo) {
    conditions.push("created_at <= ?");
    values.push(filters.dateTo);
  }

  // People filter: check JSON array
  if (filters.people?.length) {
    const peopleConds = filters.people.map(() => "people LIKE ?");
    conditions.push(`(${peopleConds.join(" OR ")})`);
    for (const person of filters.people) {
      values.push(`%${person}%`);
    }
  }

  // Tags filter: check JSON array
  if (filters.tags?.length) {
    const tagConds = filters.tags.map(() => "tags LIKE ?");
    conditions.push(`(${tagConds.join(" OR ")})`);
    for (const tag of filters.tags) {
      values.push(`%${tag}%`);
    }
  }

  return {
    where: conditions.length > 0 ? conditions.join(" AND ") : "1=1",
    values,
  };
}

/**
 * Get chunk IDs matching the metadata filters.
 * This is the first step in the search pipeline — narrow candidates.
 */
export function getFilteredChunkIds(
  db: DatabaseSync,
  filters: AdvancedSearchFilters,
  limit: number = 100,
): string[] {
  const { where, values } = buildMetadataFilter(filters);

  const rows = db
    .prepare(
      `SELECT id FROM chunk_metadata
       WHERE ${where}
       ORDER BY importance DESC, created_at DESC
       LIMIT ?`,
    )
    .all(...values, limit) as Array<{ id: string }>;

  return rows.map((r) => r.id);
}

// ─── Search Result Enhancement ───

/**
 * Enhance base search results with metadata, time decay, and link expansion.
 *
 * @param db - SQLite database
 * @param baseResults - Results from vector/keyword search
 * @param options - Enhancement options
 * @returns Enhanced and re-ranked results
 */
export function enhanceSearchResults(
  db: DatabaseSync,
  baseResults: Array<{ chunkId: string; content: string; score: number; filePath?: string }>,
  options: {
    applyDecay?: boolean;
    expandLinks?: boolean;
    limit?: number;
  } = {},
): AdvancedSearchResult[] {
  const { applyDecay: doDecay = true, expandLinks = false, limit = 20 } = options;

  if (baseResults.length === 0) {
    return [];
  }

  // Fetch metadata for all result chunks
  const chunkIds = baseResults.map((r) => r.chunkId);
  const metadataMap = getChunkMetadataMap(db, chunkIds);

  // Build enhanced results with time decay
  const enhanced: AdvancedSearchResult[] = [];

  for (const result of baseResults) {
    const meta = metadataMap.get(result.chunkId);
    let score = result.score;

    if (doDecay && meta) {
      score = applyTimeDecay(
        score,
        meta.last_accessed,
        meta.status ?? "active",
        meta.access_count ?? 1,
      );
    }

    enhanced.push({
      chunkId: result.chunkId,
      memoryFile: meta?.memory_file ?? result.filePath ?? "",
      content: result.content,
      score,
      type: meta?.type ?? undefined,
      people: meta?.people ? safeJsonParse<PersonEntry[]>(meta.people, []) : undefined,
      tags: meta?.tags ? safeJsonParse<string[]>(meta.tags, []) : undefined,
      caseRef: meta?.case_ref ?? undefined,
      place: meta?.place ?? undefined,
      emotion: meta?.emotion ?? undefined,
      emotionRaw: meta?.emotion_raw ?? undefined,
      domain: meta?.domain ?? undefined,
      importance: meta?.importance ?? undefined,
      createdAt: meta?.created_at ?? undefined,
    });
  }

  // Link expansion (1-hop)
  if (expandLinks) {
    const expandedIds = expandViaLinks(db, chunkIds, 5);
    if (expandedIds.length > 0) {
      const expandedMeta = getChunkMetadataMap(db, expandedIds);
      for (const id of expandedIds) {
        const meta = expandedMeta.get(id);
        if (meta) {
          enhanced.push({
            chunkId: id,
            memoryFile: meta.memory_file,
            content: `[linked] ${meta.memory_file}`,
            score: 0.3, // Lower score for expanded results
            type: meta.type ?? undefined,
            people: meta.people ? safeJsonParse<PersonEntry[]>(meta.people, []) : undefined,
            tags: meta.tags ? safeJsonParse<string[]>(meta.tags, []) : undefined,
            caseRef: meta.case_ref ?? undefined,
            emotion: meta.emotion ?? undefined,
            emotionRaw: meta.emotion_raw ?? undefined,
            domain: meta.domain ?? undefined,
            importance: meta.importance ?? undefined,
            createdAt: meta.created_at ?? undefined,
          });
        }
      }
    }
  }

  // Sort by score descending
  const sorted = enhanced.toSorted((a, b) => b.score - a.score).slice(0, limit);

  // Touch accessed chunks (update last_accessed, increment access_count)
  const accessedIds = sorted.map((r) => r.chunkId);
  try {
    touchAccessedChunks(db, accessedIds);
  } catch {
    // Non-critical — don't fail the search
  }

  return sorted;
}

// ─── Metadata Helpers ───

interface ChunkMetadataRaw {
  id: string;
  memory_file: string;
  type: string | null;
  case_ref: string | null;
  place: string | null;
  tags: string | null;
  importance: number | null;
  status: string | null;
  emotion: string | null;
  emotion_raw: string | null;
  domain: string | null;
  people: string | null;
  created_at: string;
  last_accessed: string | null;
  access_count: number | null;
  outgoing_links: string | null;
}

function getChunkMetadataMap(db: DatabaseSync, chunkIds: string[]): Map<string, ChunkMetadataRaw> {
  if (chunkIds.length === 0) {
    return new Map();
  }

  const map = new Map<string, ChunkMetadataRaw>();
  const placeholders = chunkIds.map(() => "?").join(",");

  const rows = db
    .prepare(`SELECT * FROM chunk_metadata WHERE id IN (${placeholders})`)
    .all(...chunkIds) as unknown as ChunkMetadataRaw[];

  for (const row of rows) {
    map.set(row.id, row);
  }

  return map;
}

/**
 * Get memory statistics from chunk_metadata.
 */
export function getMemoryStats(db: DatabaseSync): {
  totalDocuments: number;
  totalChunks: number;
  totalLinks: number;
  documentsByType: Record<string, number>;
  documentsByDomain: Record<string, number>;
  documentsByStatus: Record<string, number>;
  topPeople: Array<{ name: string; count: number }>;
  topTags: Array<{ tag: string; count: number }>;
} {
  const totalChunks = (
    db.prepare(`SELECT COUNT(*) as cnt FROM chunk_metadata`).get() as { cnt: number }
  ).cnt;

  const totalDocuments = (
    db.prepare(`SELECT COUNT(DISTINCT memory_file) as cnt FROM chunk_metadata`).get() as {
      cnt: number;
    }
  ).cnt;

  // Count outgoing links
  const linkRows = db
    .prepare(`SELECT outgoing_links FROM chunk_metadata WHERE outgoing_links IS NOT NULL`)
    .all() as Array<{ outgoing_links: string }>;

  let totalLinks = 0;
  for (const row of linkRows) {
    const links = safeJsonParse<string[]>(row.outgoing_links, []);
    totalLinks += links.length;
  }

  // By type
  const typeRows = db
    .prepare(
      `SELECT type, COUNT(*) as cnt FROM chunk_metadata WHERE type IS NOT NULL GROUP BY type`,
    )
    .all() as Array<{ type: string; cnt: number }>;
  const documentsByType: Record<string, number> = {};
  for (const r of typeRows) {
    documentsByType[r.type] = r.cnt;
  }

  // By domain
  const domainRows = db
    .prepare(
      `SELECT domain, COUNT(*) as cnt FROM chunk_metadata WHERE domain IS NOT NULL GROUP BY domain`,
    )
    .all() as Array<{ domain: string; cnt: number }>;
  const documentsByDomain: Record<string, number> = {};
  for (const r of domainRows) {
    documentsByDomain[r.domain] = r.cnt;
  }

  // By status
  const statusRows = db
    .prepare(`SELECT status, COUNT(*) as cnt FROM chunk_metadata GROUP BY status`)
    .all() as Array<{ status: string; cnt: number }>;
  const documentsByStatus: Record<string, number> = {};
  for (const r of statusRows) {
    documentsByStatus[r.status] = r.cnt;
  }

  // Top people
  const peopleRows = db
    .prepare(`SELECT people FROM chunk_metadata WHERE people IS NOT NULL`)
    .all() as Array<{ people: string }>;
  const peopleCounts = new Map<string, number>();
  for (const row of peopleRows) {
    const people = safeJsonParse<Array<{ name: string }>>(row.people, []);
    for (const p of people) {
      peopleCounts.set(p.name, (peopleCounts.get(p.name) ?? 0) + 1);
    }
  }
  const topPeople = [...peopleCounts.entries()]
    .map(([name, count]) => ({ name, count }))
    .toSorted((a, b) => b.count - a.count)
    .slice(0, 10);

  // Top tags
  const tagRows = db
    .prepare(`SELECT tags FROM chunk_metadata WHERE tags IS NOT NULL`)
    .all() as Array<{ tags: string }>;
  const tagCounts = new Map<string, number>();
  for (const row of tagRows) {
    const tags = safeJsonParse<string[]>(row.tags, []);
    for (const t of tags) {
      tagCounts.set(t, (tagCounts.get(t) ?? 0) + 1);
    }
  }
  const topTags = [...tagCounts.entries()]
    .map(([tag, count]) => ({ tag, count }))
    .toSorted((a, b) => b.count - a.count)
    .slice(0, 10);

  return {
    totalDocuments,
    totalChunks,
    totalLinks,
    documentsByType,
    documentsByDomain,
    documentsByStatus,
    topPeople,
    topTags,
  };
}

// ─── Utilities ───

function safeJsonParse<T>(json: string, fallback: T): T {
  try {
    return JSON.parse(json) as T;
  } catch {
    return fallback;
  }
}
