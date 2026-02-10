/**
 * MoA Advanced Memory v2 — Backlink System
 *
 * Replaces the v1 graph.db with [[internal links]] + backlink tracking.
 * Links in content serve as edges in the knowledge graph.
 *
 * Key principle: [[links]] = relationships, backlinks = reverse relationships
 * No separate graph DB needed.
 */

import type { DatabaseSync } from "node:sqlite";

// ─── Backlink Queries ───

/**
 * Find all chunks that link TO a given entity name.
 * This is the "backlink" query — replaces v1 graph edge lookup.
 *
 * Uses the outgoing_links JSON field in chunk_metadata for O(n) lookup.
 * Falls back to LIKE search on content for entries without outgoing_links.
 */
export function findBacklinks(
  db: DatabaseSync,
  entityName: string,
): Array<{ memoryFile: string; chunkId: string; type: string | null; createdAt: string }> {
  // Search outgoing_links JSON field + content LIKE fallback
  const rows = db
    .prepare(
      `SELECT DISTINCT id, memory_file, type, created_at
       FROM chunk_metadata
       WHERE outgoing_links LIKE ?
          OR outgoing_links LIKE ?
       ORDER BY created_at DESC`,
    )
    .all(`%"${entityName}"%`, `%"${entityName}|%`) as Array<{
    id: string;
    memory_file: string;
    type: string | null;
    created_at: string;
  }>;

  return rows.map((r) => ({
    memoryFile: r.memory_file,
    chunkId: r.id,
    type: r.type,
    createdAt: r.created_at,
  }));
}

/**
 * Find all chunks that are linked FROM a given file.
 * Returns the outgoing link targets for a memory file.
 */
export function findOutgoingLinks(db: DatabaseSync, memoryFile: string): string[] {
  const rows = db
    .prepare(
      `SELECT DISTINCT outgoing_links
       FROM chunk_metadata
       WHERE memory_file = ? AND outgoing_links IS NOT NULL`,
    )
    .all(memoryFile) as Array<{ outgoing_links: string }>;

  const allLinks = new Set<string>();
  for (const row of rows) {
    const links = safeJsonParse<string[]>(row.outgoing_links, []);
    for (const link of links) {
      allLinks.add(link);
    }
  }
  return [...allLinks];
}

/**
 * Find co-occurring people: people who appear in the same documents as a given person.
 * Replaces v1 graph "co-occurrence" query.
 */
export function findCoOccurringPeople(
  db: DatabaseSync,
  personName: string,
): Array<{ name: string; coOccurrences: number }> {
  // Find all documents mentioning this person
  const rows = db
    .prepare(
      `SELECT people
       FROM chunk_metadata
       WHERE people LIKE ?
         AND people IS NOT NULL`,
    )
    .all(`%${personName}%`) as Array<{ people: string }>;

  const counts = new Map<string, number>();

  for (const row of rows) {
    const people = safeJsonParse<Array<{ name: string }>>(row.people, []);
    for (const p of people) {
      if (p.name !== personName) {
        counts.set(p.name, (counts.get(p.name) ?? 0) + 1);
      }
    }
  }

  return [...counts.entries()]
    .map(([name, coOccurrences]) => ({ name, coOccurrences }))
    .toSorted((a, b) => b.coOccurrences - a.coOccurrences);
}

/**
 * Expand search results by following links (1-hop).
 * Given a set of chunks, find related chunks via [[links]] and backlinks.
 */
export function expandViaLinks(
  db: DatabaseSync,
  chunkIds: string[],
  maxExpanded: number = 5,
): string[] {
  if (chunkIds.length === 0) {
    return [];
  }

  // Get outgoing links from the source chunks
  const placeholders = chunkIds.map(() => "?").join(",");
  const rows = db
    .prepare(
      `SELECT outgoing_links
       FROM chunk_metadata
       WHERE id IN (${placeholders}) AND outgoing_links IS NOT NULL`,
    )
    .all(...chunkIds) as Array<{ outgoing_links: string }>;

  const linkTargets = new Set<string>();
  for (const row of rows) {
    const links = safeJsonParse<string[]>(row.outgoing_links, []);
    for (const link of links) {
      linkTargets.add(link);
    }
  }

  if (linkTargets.size === 0) {
    return [];
  }

  // Find chunks that are linked to these targets (via their file name or outgoing links)
  const expandedIds = new Set<string>();
  const existingIds = new Set(chunkIds);

  for (const target of linkTargets) {
    const linked = db
      .prepare(
        `SELECT id FROM chunk_metadata
         WHERE (memory_file LIKE ? OR outgoing_links LIKE ?)
           AND id NOT IN (${placeholders})
         LIMIT ?`,
      )
      .all(`%${target}%`, `%"${target}"%`, ...chunkIds, maxExpanded) as Array<{ id: string }>;

    for (const row of linked) {
      if (!existingIds.has(row.id)) {
        expandedIds.add(row.id);
      }
    }

    if (expandedIds.size >= maxExpanded) {
      break;
    }
  }

  return [...expandedIds].slice(0, maxExpanded);
}

// ─── Utilities ───

function safeJsonParse<T>(json: string, fallback: T): T {
  try {
    return JSON.parse(json) as T;
  } catch {
    return fallback;
  }
}
