/**
 * MoA Advanced Memory System - Knowledge Graph Operations
 *
 * CRUD operations for the knowledge graph: nodes, edges, tags.
 * Graph traversal queries (1-hop, 2-hop, N-hop).
 */

import type { DatabaseSync } from "node:sqlite";

type SqlValue = string | number | bigint | null;
import { randomUUID } from "node:crypto";
import type {
  GraphNode,
  GraphEdge,
  TagEntry,
  EntryStatus,
  NodeType,
  GraphExploreResult,
  MemoryStats,
} from "./types.js";

// ─── Node Operations ───

export function upsertNode(
  db: DatabaseSync,
  node: {
    id?: string;
    name: string;
    type: NodeType;
    subtype?: string;
    importance?: number;
    status?: EntryStatus;
    confidence?: number;
    memoryFile?: string;
    source?: string;
    properties?: Record<string, unknown>;
    validFrom?: string;
    validTo?: string;
  },
): GraphNode {
  const id = node.id ?? `${node.type}_${slugify(node.name)}_${randomUUID().slice(0, 8)}`;
  const now = new Date().toISOString();
  const properties = JSON.stringify(node.properties ?? {});

  // Try to find existing node with same name and type
  const existing = db
    .prepare(`SELECT id FROM nodes WHERE name = ? AND type = ?`)
    .get(node.name, node.type) as { id: string } | undefined;

  if (existing) {
    db.prepare(
      `UPDATE nodes SET
        updated_at = ?,
        importance = COALESCE(?, importance),
        status = COALESCE(?, status),
        confidence = COALESCE(?, confidence),
        memory_file = COALESCE(?, memory_file),
        source = COALESCE(?, source),
        properties = CASE WHEN ? != '{}' THEN ? ELSE properties END,
        subtype = COALESCE(?, subtype)
      WHERE id = ?`,
    ).run(
      now,
      node.importance ?? null,
      node.status ?? null,
      node.confidence ?? null,
      node.memoryFile ?? null,
      node.source ?? null,
      properties,
      properties,
      node.subtype ?? null,
      existing.id,
    );
    return getNode(db, existing.id)!;
  }

  db.prepare(
    `INSERT INTO nodes (id, name, type, subtype, created_at, updated_at, importance, status, confidence, memory_file, source, properties, valid_from, valid_to)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    node.name,
    node.type,
    node.subtype ?? null,
    now,
    now,
    node.importance ?? 5,
    node.status ?? "active",
    node.confidence ?? 1.0,
    node.memoryFile ?? null,
    node.source ?? null,
    properties,
    node.validFrom ?? null,
    node.validTo ?? null,
  );

  return getNode(db, id)!;
}

export function getNode(db: DatabaseSync, id: string): GraphNode | null {
  const row = db.prepare(`SELECT * FROM nodes WHERE id = ?`).get(id) as RawNodeRow | undefined;
  return row ? rowToNode(row) : null;
}

export function findNodeByName(db: DatabaseSync, name: string, type?: NodeType): GraphNode | null {
  const query = type
    ? `SELECT * FROM nodes WHERE name = ? AND type = ? LIMIT 1`
    : `SELECT * FROM nodes WHERE name = ? LIMIT 1`;
  const params = type ? [name, type] : [name];
  const row = db.prepare(query).get(...params) as RawNodeRow | undefined;
  return row ? rowToNode(row) : null;
}

export function searchNodes(
  db: DatabaseSync,
  params: {
    type?: NodeType;
    status?: EntryStatus;
    namePattern?: string;
    minImportance?: number;
    limit?: number;
  },
): GraphNode[] {
  const conditions: string[] = [];
  const values: SqlValue[] = [];

  if (params.type) {
    conditions.push("type = ?");
    values.push(params.type);
  }
  if (params.status) {
    conditions.push("status = ?");
    values.push(params.status);
  }
  if (params.namePattern) {
    conditions.push("name LIKE ?");
    values.push(`%${params.namePattern}%`);
  }
  if (params.minImportance != null) {
    conditions.push("importance >= ?");
    values.push(params.minImportance);
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
  const limit = params.limit ?? 50;

  const rows = db
    .prepare(`SELECT * FROM nodes ${where} ORDER BY importance DESC, updated_at DESC LIMIT ?`)
    .all(...values, limit) as RawNodeRow[];

  return rows.map(rowToNode);
}

export function deleteNode(db: DatabaseSync, id: string): void {
  db.prepare(`DELETE FROM node_tags WHERE node_id = ?`).run(id);
  db.prepare(`DELETE FROM edges WHERE from_node = ? OR to_node = ?`).run(id, id);
  db.prepare(`DELETE FROM nodes WHERE id = ?`).run(id);
}

// ─── Edge Operations ───

export function upsertEdge(
  db: DatabaseSync,
  edge: {
    fromNode: string;
    toNode: string;
    relationship: string;
    weight?: number;
    confidence?: number;
    properties?: Record<string, unknown>;
    validFrom?: string;
    validTo?: string;
    sourceMemory?: string;
  },
): GraphEdge {
  const now = new Date().toISOString();
  const properties = JSON.stringify(edge.properties ?? {});

  // Check for existing edge with same from/to/relationship
  const existing = db
    .prepare(
      `SELECT id FROM edges WHERE from_node = ? AND to_node = ? AND relationship = ? AND (valid_to IS NULL OR valid_to > datetime('now'))`,
    )
    .get(edge.fromNode, edge.toNode, edge.relationship) as { id: string } | undefined;

  if (existing) {
    db.prepare(
      `UPDATE edges SET
        updated_at = ?,
        weight = COALESCE(?, weight),
        confidence = COALESCE(?, confidence),
        properties = CASE WHEN ? != '{}' THEN ? ELSE properties END,
        source_memory = COALESCE(?, source_memory)
      WHERE id = ?`,
    ).run(
      now,
      edge.weight ?? null,
      edge.confidence ?? null,
      properties,
      properties,
      edge.sourceMemory ?? null,
      existing.id,
    );
    return getEdge(db, existing.id)!;
  }

  const id = `edge_${randomUUID().slice(0, 12)}`;
  db.prepare(
    `INSERT INTO edges (id, from_node, to_node, relationship, created_at, updated_at, weight, confidence, properties, valid_from, valid_to, source_memory)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    edge.fromNode,
    edge.toNode,
    edge.relationship,
    now,
    now,
    edge.weight ?? 1.0,
    edge.confidence ?? 1.0,
    properties,
    edge.validFrom ?? null,
    edge.validTo ?? null,
    edge.sourceMemory ?? null,
  );

  return getEdge(db, id)!;
}

export function getEdge(db: DatabaseSync, id: string): GraphEdge | null {
  const row = db.prepare(`SELECT * FROM edges WHERE id = ?`).get(id) as RawEdgeRow | undefined;
  return row ? rowToEdge(row) : null;
}

export function getEdgesForNode(
  db: DatabaseSync,
  nodeId: string,
  params?: {
    direction?: "outgoing" | "incoming" | "both";
    relationship?: string;
    activeOnly?: boolean;
  },
): GraphEdge[] {
  const direction = params?.direction ?? "both";
  const conditions: string[] = [];
  const values: SqlValue[] = [];

  if (direction === "outgoing") {
    conditions.push("from_node = ?");
    values.push(nodeId);
  } else if (direction === "incoming") {
    conditions.push("to_node = ?");
    values.push(nodeId);
  } else {
    conditions.push("(from_node = ? OR to_node = ?)");
    values.push(nodeId, nodeId);
  }

  if (params?.relationship) {
    conditions.push("relationship = ?");
    values.push(params.relationship);
  }

  if (params?.activeOnly !== false) {
    conditions.push("(valid_to IS NULL OR valid_to > datetime('now'))");
  }

  const where = conditions.join(" AND ");
  const rows = db
    .prepare(`SELECT * FROM edges WHERE ${where} ORDER BY weight DESC`)
    .all(...values) as RawEdgeRow[];

  return rows.map(rowToEdge);
}

// ─── Tag Operations ───

export function ensureTag(db: DatabaseSync, tag: string, category?: string): number {
  const existing = db.prepare(`SELECT id FROM tags WHERE tag = ?`).get(tag) as
    | { id: number }
    | undefined;

  if (existing) {
    db.prepare(`UPDATE tags SET usage_count = usage_count + 1 WHERE id = ?`).run(existing.id);
    return existing.id;
  }

  const result = db
    .prepare(`INSERT INTO tags (tag, category, usage_count) VALUES (?, ?, 1)`)
    .run(tag, category ?? null);

  return Number(result.lastInsertRowid);
}

export function tagNode(db: DatabaseSync, nodeId: string, tagId: number): void {
  db.prepare(`INSERT OR IGNORE INTO node_tags (node_id, tag_id) VALUES (?, ?)`).run(nodeId, tagId);
}

export function getNodeTags(db: DatabaseSync, nodeId: string): TagEntry[] {
  const rows = db
    .prepare(
      `SELECT t.* FROM tags t JOIN node_tags nt ON t.id = nt.tag_id WHERE nt.node_id = ? ORDER BY t.usage_count DESC`,
    )
    .all(nodeId) as RawTagRow[];
  return rows.map(rowToTag);
}

export function getPopularTags(db: DatabaseSync, limit?: number): TagEntry[] {
  const rows = db
    .prepare(`SELECT * FROM tags ORDER BY usage_count DESC LIMIT ?`)
    .all(limit ?? 50) as RawTagRow[];
  return rows.map(rowToTag);
}

// ─── Graph Traversal ───

/**
 * Explore the graph from a center node, traversing N hops.
 * Returns connected nodes with their relationships and depths.
 */
export function exploreGraph(
  db: DatabaseSync,
  params: {
    nodeId?: string;
    nodeName?: string;
    depth?: number;
    relationshipTypes?: string[];
    includeKnowledge?: boolean;
    limit?: number;
  },
): GraphExploreResult | null {
  // Find the center node
  let centerNode: GraphNode | null = null;
  if (params.nodeId) {
    centerNode = getNode(db, params.nodeId);
  } else if (params.nodeName) {
    centerNode = findNodeByName(db, params.nodeName);
  }
  if (!centerNode) {
    return null;
  }

  const maxDepth = Math.min(params.depth ?? 2, 3);
  const limit = params.limit ?? 50;
  const visited = new Set<string>([centerNode.id]);
  const connectedNodes: GraphExploreResult["connectedNodes"] = [];

  // BFS traversal
  type QueueItem = { nodeId: string; depth: number };
  const queue: QueueItem[] = [{ nodeId: centerNode.id, depth: 0 }];

  while (queue.length > 0 && connectedNodes.length < limit) {
    const current = queue.shift()!;
    if (current.depth >= maxDepth) {
      continue;
    }

    const edges = getEdgesForNode(db, current.nodeId, {
      relationship:
        params.relationshipTypes?.length === 1 ? params.relationshipTypes[0] : undefined,
      activeOnly: true,
    });

    for (const edge of edges) {
      const neighborId = edge.fromNode === current.nodeId ? edge.toNode : edge.fromNode;
      if (visited.has(neighborId)) {
        continue;
      }
      visited.add(neighborId);

      const neighbor = getNode(db, neighborId);
      if (!neighbor) {
        continue;
      }

      // Filter by relationship types if specified
      if (params.relationshipTypes?.length) {
        if (!params.relationshipTypes.includes(edge.relationship)) {
          continue;
        }
      }

      // Optionally exclude knowledge nodes
      if (!params.includeKnowledge && neighbor.type === "knowledge") {
        continue;
      }

      const direction = edge.fromNode === current.nodeId ? "outgoing" : "incoming";
      connectedNodes.push({
        node: neighbor,
        relationship: edge.relationship,
        direction,
        depth: current.depth + 1,
      });

      // Continue BFS
      if (current.depth + 1 < maxDepth) {
        queue.push({ nodeId: neighborId, depth: current.depth + 1 });
      }
    }
  }

  // Find related documents from chunk_metadata
  const nodeIds = [centerNode.id, ...connectedNodes.map((cn) => cn.node.id)];
  const relatedDocuments = findRelatedDocuments(db, nodeIds);

  return { centerNode, connectedNodes, relatedDocuments };
}

function findRelatedDocuments(
  db: DatabaseSync,
  nodeIds: string[],
): GraphExploreResult["relatedDocuments"] {
  if (nodeIds.length === 0) {
    return [];
  }

  const results: GraphExploreResult["relatedDocuments"] = [];
  const seen = new Set<string>();

  for (const nodeId of nodeIds) {
    const rows = db
      .prepare(
        `SELECT DISTINCT cm.memory_file, cm.type, substr(c.text, 1, 200) as snippet
         FROM chunk_metadata cm
         JOIN chunks c ON c.id = cm.chunk_id
         WHERE cm.linked_nodes LIKE ?
         LIMIT 10`,
      )
      .all(`%${nodeId}%`) as Array<{
      memory_file: string;
      type: string | null;
      snippet: string;
    }>;

    for (const row of rows) {
      if (seen.has(row.memory_file)) {
        continue;
      }
      seen.add(row.memory_file);
      results.push({
        path: row.memory_file,
        type: (row.type ?? "personal_note") as any,
        snippet: row.snippet,
      });
    }
  }

  return results;
}

// ─── Chunk Metadata ───

export function upsertChunkMetadata(
  db: DatabaseSync,
  meta: {
    chunkId: string;
    memoryFile: string;
    type?: string;
    createdAt?: string;
    people?: string[];
    caseRef?: string;
    place?: string;
    tags?: string[];
    importance?: number;
    domain?: string;
    emotion?: string;
    linkedNodes?: string[];
    frontmatter?: Record<string, unknown>;
  },
): void {
  db.prepare(
    `INSERT OR REPLACE INTO chunk_metadata
     (chunk_id, memory_file, type, created_at, people, case_ref, place, tags, importance, domain, emotion, linked_nodes, frontmatter)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    meta.chunkId,
    meta.memoryFile,
    meta.type ?? null,
    meta.createdAt ?? null,
    meta.people ? JSON.stringify(meta.people) : null,
    meta.caseRef ?? null,
    meta.place ?? null,
    meta.tags ? JSON.stringify(meta.tags) : null,
    meta.importance ?? null,
    meta.domain ?? null,
    meta.emotion ?? null,
    meta.linkedNodes ? JSON.stringify(meta.linkedNodes) : null,
    meta.frontmatter ? JSON.stringify(meta.frontmatter) : null,
  );
}

// ─── Graph Search ───

/**
 * Search the graph for chunks related to specific entities.
 * Returns chunk IDs scored by graph relevance.
 */
export function searchGraphForChunks(
  db: DatabaseSync,
  params: {
    query: string;
    filters?: {
      type?: string;
      people?: string[];
      case?: string;
      dateFrom?: string;
      dateTo?: string;
      tags?: string[];
      domain?: string;
      importanceMin?: number;
    };
    limit?: number;
  },
): Array<{ chunkId: string; score: number; linkedNodes: string[] }> {
  const results: Array<{ chunkId: string; score: number; linkedNodes: string[] }> = [];
  const limit = params.limit ?? 20;

  // Step 1: Find matching nodes by name similarity
  const matchingNodes = findMatchingNodes(db, params.query);

  // Step 2: Collect all related node IDs (1-hop)
  const relatedNodeIds = new Set<string>();
  for (const node of matchingNodes) {
    relatedNodeIds.add(node.id);
    const edges = getEdgesForNode(db, node.id, { activeOnly: true });
    for (const edge of edges) {
      const neighborId = edge.fromNode === node.id ? edge.toNode : edge.fromNode;
      relatedNodeIds.add(neighborId);
    }
  }

  if (relatedNodeIds.size === 0 && !params.filters) {
    return [];
  }

  // Step 3: Find chunks linked to these nodes + apply filters
  const conditions: string[] = [];
  const values: SqlValue[] = [];

  if (relatedNodeIds.size > 0) {
    // Build OR conditions for linked_nodes LIKE matching
    const likeClauses = Array.from(relatedNodeIds)
      .slice(0, 20) // limit to avoid overly large queries
      .map(() => "cm.linked_nodes LIKE ?");
    if (likeClauses.length > 0) {
      conditions.push(`(${likeClauses.join(" OR ")})`);
      for (const nodeId of Array.from(relatedNodeIds).slice(0, 20)) {
        values.push(`%${nodeId}%`);
      }
    }
  }

  if (params.filters?.type) {
    conditions.push("cm.type = ?");
    values.push(params.filters.type);
  }
  if (params.filters?.case) {
    conditions.push("cm.case_ref = ?");
    values.push(params.filters.case);
  }
  if (params.filters?.domain) {
    conditions.push("cm.domain = ?");
    values.push(params.filters.domain);
  }
  if (params.filters?.importanceMin != null) {
    conditions.push("cm.importance >= ?");
    values.push(params.filters.importanceMin);
  }
  if (params.filters?.dateFrom) {
    conditions.push("cm.created_at >= ?");
    values.push(params.filters.dateFrom);
  }
  if (params.filters?.dateTo) {
    conditions.push("cm.created_at <= ?");
    values.push(params.filters.dateTo);
  }
  if (params.filters?.people?.length) {
    const peopleClauses = params.filters.people.map(() => "cm.people LIKE ?");
    conditions.push(`(${peopleClauses.join(" OR ")})`);
    for (const person of params.filters.people) {
      values.push(`%${person}%`);
    }
  }
  if (params.filters?.tags?.length) {
    const tagClauses = params.filters.tags.map(() => "cm.tags LIKE ?");
    conditions.push(`(${tagClauses.join(" OR ")})`);
    for (const tag of params.filters.tags) {
      values.push(`%${tag}%`);
    }
  }

  if (conditions.length === 0) {
    return [];
  }

  const where = conditions.join(" AND ");
  const rows = db
    .prepare(
      `SELECT cm.chunk_id, cm.linked_nodes, cm.importance
       FROM chunk_metadata cm
       WHERE ${where}
       ORDER BY cm.importance DESC
       LIMIT ?`,
    )
    .all(...values, limit) as Array<{
    chunk_id: string;
    linked_nodes: string | null;
    importance: number | null;
  }>;

  for (const row of rows) {
    const linkedNodes = row.linked_nodes ? safeJsonParse<string[]>(row.linked_nodes, []) : [];
    // Score based on how many matching nodes appear in linked_nodes
    const matchCount = linkedNodes.filter((n) => relatedNodeIds.has(n)).length;
    const importanceBoost = (row.importance ?? 5) / 10;
    const score = Math.min(
      1.0,
      (matchCount / Math.max(1, relatedNodeIds.size)) * 0.7 + importanceBoost * 0.3,
    );

    results.push({ chunkId: row.chunk_id, score, linkedNodes });
  }

  return results.toSorted((a, b) => b.score - a.score);
}

/** Find nodes whose names partially match a query string */
function findMatchingNodes(db: DatabaseSync, query: string): GraphNode[] {
  const tokens = query
    .split(/[\s,;.!?]+/)
    .map((t) => t.trim())
    .filter((t) => t.length > 1);
  if (tokens.length === 0) {
    return [];
  }

  const allNodes: GraphNode[] = [];
  const seen = new Set<string>();

  for (const token of tokens) {
    const rows = db
      .prepare(`SELECT * FROM nodes WHERE name LIKE ? AND status != 'archived' LIMIT 10`)
      .all(`%${token}%`) as RawNodeRow[];

    for (const row of rows) {
      if (!seen.has(row.id)) {
        seen.add(row.id);
        allNodes.push(rowToNode(row));
      }
    }
  }

  return allNodes;
}

// ─── Statistics ───

export function getMemoryStats(db: DatabaseSync): MemoryStats {
  const totalNodes = (db.prepare(`SELECT COUNT(*) as c FROM nodes`).get() as { c: number })?.c ?? 0;
  const totalEdges = (db.prepare(`SELECT COUNT(*) as c FROM edges`).get() as { c: number })?.c ?? 0;
  const totalDocuments =
    (db.prepare(`SELECT COUNT(*) as c FROM chunk_metadata`).get() as { c: number })?.c ?? 0;
  const totalTags = (db.prepare(`SELECT COUNT(*) as c FROM tags`).get() as { c: number })?.c ?? 0;

  const nodesByType: Record<string, number> = {};
  const nodeTypeRows = db
    .prepare(`SELECT type, COUNT(*) as c FROM nodes GROUP BY type`)
    .all() as Array<{ type: string; c: number }>;
  for (const row of nodeTypeRows) {
    nodesByType[row.type] = row.c;
  }

  const documentsByType: Record<string, number> = {};
  const docTypeRows = db
    .prepare(`SELECT type, COUNT(*) as c FROM chunk_metadata WHERE type IS NOT NULL GROUP BY type`)
    .all() as Array<{ type: string; c: number }>;
  for (const row of docTypeRows) {
    documentsByType[row.type] = row.c;
  }

  const domainDistribution: Record<string, number> = {};
  const domainRows = db
    .prepare(
      `SELECT domain, COUNT(*) as c FROM chunk_metadata WHERE domain IS NOT NULL GROUP BY domain`,
    )
    .all() as Array<{ domain: string; c: number }>;
  for (const row of domainRows) {
    domainDistribution[row.domain] = row.c;
  }

  const recentActivity: MemoryStats["recentActivity"] = [];
  const activityRows = db
    .prepare(
      `SELECT date(created_at) as d, COUNT(*) as c FROM chunk_metadata
       WHERE created_at IS NOT NULL
       GROUP BY date(created_at)
       ORDER BY d DESC LIMIT 30`,
    )
    .all() as Array<{ d: string; c: number }>;
  for (const row of activityRows) {
    recentActivity.push({ date: row.d, entries: row.c });
  }

  const topConnectedNodes: MemoryStats["topConnectedNodes"] = [];
  const connectedRows = db
    .prepare(
      `SELECT n.name, n.type, COUNT(DISTINCT e.id) as conn
       FROM nodes n
       LEFT JOIN edges e ON n.id = e.from_node OR n.id = e.to_node
       GROUP BY n.id
       ORDER BY conn DESC
       LIMIT 20`,
    )
    .all() as Array<{ name: string; type: string; conn: number }>;
  for (const row of connectedRows) {
    topConnectedNodes.push({ name: row.name, type: row.type, connections: row.conn });
  }

  return {
    totalNodes,
    totalEdges,
    totalDocuments,
    totalTags,
    nodesByType,
    documentsByType,
    domainDistribution,
    recentActivity,
    topConnectedNodes,
  };
}

// ─── Internal Helpers ───

type RawNodeRow = {
  id: string;
  name: string;
  type: string;
  subtype: string | null;
  created_at: string;
  updated_at: string;
  importance: number;
  status: string;
  confidence: number;
  memory_file: string | null;
  source: string | null;
  properties: string;
  valid_from: string | null;
  valid_to: string | null;
};

type RawEdgeRow = {
  id: string;
  from_node: string;
  to_node: string;
  relationship: string;
  created_at: string;
  updated_at: string;
  weight: number;
  confidence: number;
  properties: string;
  valid_from: string | null;
  valid_to: string | null;
  source_memory: string | null;
};

type RawTagRow = {
  id: number;
  tag: string;
  category: string | null;
  usage_count: number;
  created_at: string;
};

function rowToNode(row: RawNodeRow): GraphNode {
  return {
    id: row.id,
    name: row.name,
    type: row.type as NodeType,
    subtype: row.subtype ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    importance: row.importance,
    status: row.status as EntryStatus,
    confidence: row.confidence,
    memoryFile: row.memory_file ?? undefined,
    source: row.source ?? undefined,
    properties: safeJsonParse(row.properties, {}),
    validFrom: row.valid_from ?? undefined,
    validTo: row.valid_to ?? undefined,
  };
}

function rowToEdge(row: RawEdgeRow): GraphEdge {
  return {
    id: row.id,
    fromNode: row.from_node,
    toNode: row.to_node,
    relationship: row.relationship,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    weight: row.weight,
    confidence: row.confidence,
    properties: safeJsonParse(row.properties, {}),
    validFrom: row.valid_from ?? undefined,
    validTo: row.valid_to ?? undefined,
    sourceMemory: row.source_memory ?? undefined,
  };
}

function rowToTag(row: RawTagRow): TagEntry {
  return {
    id: row.id,
    tag: row.tag,
    category: row.category ?? undefined,
    usageCount: row.usage_count,
    createdAt: row.created_at,
  };
}

function safeJsonParse<T>(raw: string, fallback: T): T {
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\u3131-\u314e\u314f-\u3163\uac00-\ud7a3\u4e00-\u9fff]+/g, "_")
    .replace(/^_|_$/g, "")
    .slice(0, 40);
}
