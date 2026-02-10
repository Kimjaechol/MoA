/**
 * MoA Advanced Memory System - Triple Hybrid Search Engine
 *
 * Extends OpenClaw's 2-way search (vector + BM25) with graph traversal
 * to create a 3-way fusion search: vector + BM25 + graph.
 *
 * Includes:
 * - Automatic query type classification
 * - Dynamic weight adjustment based on query type
 * - Context expansion via graph traversal
 */

import type { DatabaseSync } from "node:sqlite";
import type {
  AdvancedSearchFilters,
  AdvancedSearchResult,
  SearchQueryType,
  SearchWeightProfile,
} from "./types.js";
import { SEARCH_WEIGHT_PROFILES } from "./types.js";

// ─── Query Type Classification ───

/**
 * Classify the type of a search query to determine optimal weight distribution.
 * Uses keyword analysis and pattern matching.
 */
export function classifyQueryType(query: string): SearchQueryType {
  const lower = query.toLowerCase();

  // Entity query: mentions specific names, people, cases
  if (
    matchesAny(lower, [
      "who",
      "person",
      "people",
      "누구",
      "사람",
      "씨",
      "님",
      "관련",
      "관계",
      "에 대해",
      "about",
    ])
  ) {
    return "entity_query";
  }

  // Temporal query: time-based searches
  if (
    matchesAny(lower, [
      "when",
      "last week",
      "yesterday",
      "last month",
      "recent",
      "today",
      "언제",
      "지난주",
      "어제",
      "지난달",
      "최근",
      "오늘",
      "월",
      "일",
      "이번주",
    ])
  ) {
    return "temporal_query";
  }

  // Exact query: specific project names, exact terms
  if (
    matchesAny(lower, ["v2", "v3", "version", "specific", "exactly", "결과", "리뷰", "결정"]) ||
    /[A-Z][a-z]+[A-Z]/.test(query) // camelCase
  ) {
    return "exact_query";
  }

  // Knowledge query: conceptual questions
  if (
    matchesAny(lower, [
      "how",
      "why",
      "what is",
      "concept",
      "explain",
      "method",
      "어떻게",
      "왜",
      "방법",
      "개념",
      "설명",
      "원리",
      "기초",
      "기본",
      "온도",
      "비율",
    ])
  ) {
    return "knowledge_query";
  }

  // Default: semantic query
  return "semantic_query";
}

/**
 * Get the search weight profile for a query.
 * Can be overridden with custom weights.
 */
export function getSearchWeights(
  queryType: SearchQueryType,
  overrides?: Partial<SearchWeightProfile>,
): SearchWeightProfile {
  const base = SEARCH_WEIGHT_PROFILES[queryType];
  const weights = {
    vector: overrides?.vector ?? base.vector,
    bm25: overrides?.bm25 ?? base.bm25,
    graph: overrides?.graph ?? base.graph,
  };

  // Normalize to sum to 1.0
  const sum = weights.vector + weights.bm25 + weights.graph;
  if (sum > 0 && Math.abs(sum - 1.0) > 0.01) {
    weights.vector /= sum;
    weights.bm25 /= sum;
    weights.graph /= sum;
  }

  return weights;
}

// ─── Triple Fusion Search ───

export type VectorResult = {
  id: string;
  path: string;
  startLine: number;
  endLine: number;
  score: number;
  snippet: string;
  source: string;
};

export type KeywordResult = {
  id: string;
  path: string;
  startLine: number;
  endLine: number;
  score: number;
  snippet: string;
  source: string;
  textScore: number;
};

export type GraphResult = {
  chunkId: string;
  score: number;
  linkedNodes: string[];
};

/**
 * Merge results from vector, BM25, and graph searches using weighted fusion.
 */
export function mergeTripleResults(params: {
  vector: VectorResult[];
  keyword: KeywordResult[];
  graph: GraphResult[];
  weights: SearchWeightProfile;
  db?: DatabaseSync;
}): AdvancedSearchResult[] {
  const { vector, keyword, graph, weights } = params;

  // Build a map of all results by chunk ID
  const byId = new Map<
    string,
    {
      id: string;
      path: string;
      startLine: number;
      endLine: number;
      source: string;
      snippet: string;
      vectorScore: number;
      bm25Score: number;
      graphScore: number;
      linkedNodes: string[];
    }
  >();

  // Merge vector results
  for (const r of vector) {
    byId.set(r.id, {
      id: r.id,
      path: r.path,
      startLine: r.startLine,
      endLine: r.endLine,
      source: r.source,
      snippet: r.snippet,
      vectorScore: r.score,
      bm25Score: 0,
      graphScore: 0,
      linkedNodes: [],
    });
  }

  // Merge keyword results
  for (const r of keyword) {
    const existing = byId.get(r.id);
    if (existing) {
      existing.bm25Score = r.textScore;
      if (r.snippet && r.snippet.length > existing.snippet.length) {
        existing.snippet = r.snippet;
      }
    } else {
      byId.set(r.id, {
        id: r.id,
        path: r.path,
        startLine: r.startLine,
        endLine: r.endLine,
        source: r.source,
        snippet: r.snippet,
        vectorScore: 0,
        bm25Score: r.textScore,
        graphScore: 0,
        linkedNodes: [],
      });
    }
  }

  // Merge graph results
  for (const r of graph) {
    const existing = byId.get(r.chunkId);
    if (existing) {
      existing.graphScore = r.score;
      existing.linkedNodes = r.linkedNodes;
    } else {
      // Graph result without vector/BM25 match — need to look up chunk info
      // We leave it with minimal info; the caller should resolve
      byId.set(r.chunkId, {
        id: r.chunkId,
        path: "",
        startLine: 0,
        endLine: 0,
        source: "memory",
        snippet: "",
        vectorScore: 0,
        bm25Score: 0,
        graphScore: r.score,
        linkedNodes: r.linkedNodes,
      });
    }
  }

  // Calculate fused scores and resolve graph-only entries
  const merged: AdvancedSearchResult[] = [];

  for (const entry of byId.values()) {
    // Resolve graph-only entries from DB if needed
    if (!entry.path && params.db) {
      const chunkRow = params.db
        .prepare(`SELECT path, start_line, end_line, source, text FROM chunks WHERE id = ?`)
        .get(entry.id) as
        | { path: string; start_line: number; end_line: number; source: string; text: string }
        | undefined;

      if (chunkRow) {
        entry.path = chunkRow.path;
        entry.startLine = chunkRow.start_line;
        entry.endLine = chunkRow.end_line;
        entry.source = chunkRow.source;
        entry.snippet = chunkRow.text.slice(0, 700);
      }
    }

    // Skip entries we couldn't resolve
    if (!entry.path) {
      continue;
    }

    const score =
      weights.vector * entry.vectorScore +
      weights.bm25 * entry.bm25Score +
      weights.graph * entry.graphScore;

    // Retrieve metadata from chunk_metadata if available
    let metadata: ChunkMeta | undefined;
    if (params.db) {
      metadata = params.db
        .prepare(`SELECT * FROM chunk_metadata WHERE chunk_id = ?`)
        .get(entry.id) as ChunkMeta | undefined;
    }

    merged.push({
      path: entry.path,
      startLine: entry.startLine,
      endLine: entry.endLine,
      score,
      snippet: entry.snippet,
      source: entry.source,
      type: metadata?.type as any,
      people: metadata?.people ? safeJsonParse<string[]>(metadata.people, []) : undefined,
      case: metadata?.case_ref ?? undefined,
      place: metadata?.place ?? undefined,
      tags: metadata?.tags ? safeJsonParse<string[]>(metadata.tags, []) : undefined,
      importance: metadata?.importance ?? undefined,
      linkedNodes: entry.linkedNodes.length > 0 ? entry.linkedNodes : undefined,
      graphScore: entry.graphScore > 0 ? entry.graphScore : undefined,
      vectorScore: entry.vectorScore > 0 ? entry.vectorScore : undefined,
      bm25Score: entry.bm25Score > 0 ? entry.bm25Score : undefined,
    });
  }

  // Sort by fused score descending
  return merged.toSorted((a, b) => b.score - a.score);
}

/**
 * Perform context expansion using graph traversal.
 * Takes initial search results and expands them with related information.
 */
export function expandSearchContext(
  db: DatabaseSync,
  initialResults: AdvancedSearchResult[],
  limit?: number,
): AdvancedSearchResult[] {
  const maxExpansion = limit ?? 5;
  const expanded: AdvancedSearchResult[] = [...initialResults];
  const seen = new Set(initialResults.map((r) => `${r.path}:${r.startLine}`));

  // Collect all linked nodes from initial results
  const allLinkedNodes = new Set<string>();
  for (const result of initialResults) {
    if (result.linkedNodes) {
      for (const nodeId of result.linkedNodes) {
        allLinkedNodes.add(nodeId);
      }
    }
  }

  if (allLinkedNodes.size === 0) {
    return expanded;
  }

  // Find additional chunks connected to these nodes (2-hop expansion)
  let addedCount = 0;
  for (const nodeId of allLinkedNodes) {
    if (addedCount >= maxExpansion) {
      break;
    }

    // Get chunks linked to this node that aren't already in results
    const rows = db
      .prepare(
        `SELECT cm.chunk_id, cm.memory_file, cm.type, cm.importance, cm.tags,
                substr(c.text, 1, 300) as snippet,
                c.path, c.start_line, c.end_line, c.source
         FROM chunk_metadata cm
         JOIN chunks c ON c.id = cm.chunk_id
         WHERE cm.linked_nodes LIKE ?
         ORDER BY cm.importance DESC
         LIMIT 5`,
      )
      .all(`%${nodeId}%`) as Array<{
      chunk_id: string;
      memory_file: string;
      type: string | null;
      importance: number | null;
      tags: string | null;
      snippet: string;
      path: string;
      start_line: number;
      end_line: number;
      source: string;
    }>;

    for (const row of rows) {
      const key = `${row.path}:${row.start_line}`;
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);
      addedCount++;

      expanded.push({
        path: row.path,
        startLine: row.start_line,
        endLine: row.end_line,
        score: 0.1, // Low score for expansion results
        snippet: `[Related context] ${row.snippet}`,
        source: row.source,
        type: row.type as any,
        tags: row.tags ? safeJsonParse<string[]>(row.tags, []) : undefined,
        importance: row.importance ?? undefined,
        linkedNodes: [nodeId],
      });

      if (addedCount >= maxExpansion) {
        break;
      }
    }
  }

  return expanded;
}

// ─── Filter Application ───

/**
 * Apply advanced filters to search results.
 */
export function applyFilters(
  results: AdvancedSearchResult[],
  filters: AdvancedSearchFilters,
): AdvancedSearchResult[] {
  return results.filter((result) => {
    if (filters.type && result.type !== filters.type) {
      return false;
    }
    if (filters.status) {
      // Status filter would require looking up the original entry; skip for now
    }
    if (filters.importanceMin != null && (result.importance ?? 0) < filters.importanceMin) {
      return false;
    }
    if (filters.people?.length) {
      if (!result.people) {
        return false;
      }
      const hasMatchingPerson = filters.people.some((p) =>
        result.people!.some((rp) => rp.toLowerCase().includes(p.toLowerCase())),
      );
      if (!hasMatchingPerson) {
        return false;
      }
    }
    if (filters.case && result.case !== filters.case) {
      return false;
    }
    if (filters.tags?.length) {
      if (!result.tags) {
        return false;
      }
      const hasMatchingTag = filters.tags.some((t) =>
        result.tags!.some((rt) => rt.toLowerCase().includes(t.toLowerCase())),
      );
      if (!hasMatchingTag) {
        return false;
      }
    }
    return true;
  });
}

// ─── Helpers ───

type ChunkMeta = {
  chunk_id: string;
  memory_file: string;
  type: string | null;
  created_at: string | null;
  people: string | null;
  case_ref: string | null;
  place: string | null;
  tags: string | null;
  importance: number | null;
  domain: string | null;
  emotion: string | null;
  linked_nodes: string | null;
  frontmatter: string | null;
};

function safeJsonParse<T>(raw: string, fallback: T): T {
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function matchesAny(text: string, keywords: string[]): boolean {
  return keywords.some((kw) => text.includes(kw));
}
