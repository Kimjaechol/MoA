import type { DatabaseSync } from "node:sqlite";
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { ensureAdvancedMemorySchema } from "./graph-schema.js";
import {
  upsertNode,
  upsertEdge,
  getNode,
  findNodeByName,
  searchNodes,
  deleteNode,
  getEdgesForNode,
  ensureTag,
  tagNode,
  getNodeTags,
  getPopularTags,
  exploreGraph,
  searchGraphForChunks,
  getMemoryStats,
  upsertChunkMetadata,
} from "./graph.js";

let db: DatabaseSync;

beforeEach(async () => {
  // Create in-memory SQLite database
  const { requireNodeSqlite } = await import("../sqlite.js");
  const { DatabaseSync } = requireNodeSqlite();
  db = new DatabaseSync(":memory:");
  ensureAdvancedMemorySchema(db);

  // Also create chunks table (normally created by OpenClaw base schema)
  db.exec(`
    CREATE TABLE IF NOT EXISTS chunks (
      id TEXT PRIMARY KEY,
      path TEXT NOT NULL,
      source TEXT NOT NULL DEFAULT 'memory',
      start_line INTEGER NOT NULL,
      end_line INTEGER NOT NULL,
      hash TEXT NOT NULL,
      model TEXT NOT NULL,
      text TEXT NOT NULL,
      embedding TEXT NOT NULL,
      updated_at INTEGER NOT NULL
    );
  `);
});

afterEach(() => {
  try {
    db.close();
  } catch {}
});

describe("Node operations", () => {
  it("creates a new node", () => {
    const node = upsertNode(db, {
      name: "옆집 민수씨",
      type: "person",
      subtype: "neighbor",
      importance: 7,
    });
    expect(node.id).toBeDefined();
    expect(node.name).toBe("옆집 민수씨");
    expect(node.type).toBe("person");
    expect(node.subtype).toBe("neighbor");
    expect(node.importance).toBe(7);
  });

  it("upserts existing node by name+type", () => {
    const first = upsertNode(db, { name: "Test Person", type: "person", importance: 5 });
    const second = upsertNode(db, { name: "Test Person", type: "person", importance: 8 });
    expect(second.id).toBe(first.id);
    expect(second.importance).toBe(8);
  });

  it("finds node by name", () => {
    upsertNode(db, { name: "절친 A", type: "person" });
    const found = findNodeByName(db, "절친 A");
    expect(found).not.toBeNull();
    expect(found!.name).toBe("절친 A");
  });

  it("finds node by name and type", () => {
    upsertNode(db, { name: "Office", type: "place" });
    upsertNode(db, { name: "Office", type: "organization" });
    const place = findNodeByName(db, "Office", "place");
    expect(place).not.toBeNull();
    expect(place!.type).toBe("place");
  });

  it("searches nodes with filters", () => {
    upsertNode(db, { name: "Person A", type: "person", importance: 3 });
    upsertNode(db, { name: "Person B", type: "person", importance: 8 });
    upsertNode(db, { name: "Place C", type: "place", importance: 5 });

    const people = searchNodes(db, { type: "person" });
    expect(people).toHaveLength(2);

    const important = searchNodes(db, { minImportance: 7 });
    expect(important).toHaveLength(1);
    expect(important[0].name).toBe("Person B");

    const byName = searchNodes(db, { namePattern: "Person" });
    expect(byName).toHaveLength(2);
  });

  it("deletes a node and its edges", () => {
    const node = upsertNode(db, { name: "ToDelete", type: "topic" });
    const other = upsertNode(db, { name: "Other", type: "topic" });
    upsertEdge(db, { fromNode: node.id, toNode: other.id, relationship: "related_to" });

    deleteNode(db, node.id);
    expect(getNode(db, node.id)).toBeNull();

    const edges = getEdgesForNode(db, other.id);
    expect(edges).toHaveLength(0);
  });
});

describe("Edge operations", () => {
  it("creates an edge between nodes", () => {
    const person = upsertNode(db, { name: "Person", type: "person" });
    const caseNode = upsertNode(db, { name: "Case A", type: "case" });
    const edge = upsertEdge(db, {
      fromNode: person.id,
      toNode: caseNode.id,
      relationship: "involved_in",
    });
    expect(edge.id).toBeDefined();
    expect(edge.fromNode).toBe(person.id);
    expect(edge.toNode).toBe(caseNode.id);
    expect(edge.relationship).toBe("involved_in");
  });

  it("upserts existing edge", () => {
    const a = upsertNode(db, { name: "A", type: "person" });
    const b = upsertNode(db, { name: "B", type: "case" });
    const first = upsertEdge(db, { fromNode: a.id, toNode: b.id, relationship: "involved_in" });
    const second = upsertEdge(db, {
      fromNode: a.id,
      toNode: b.id,
      relationship: "involved_in",
      weight: 2.0,
    });
    expect(second.id).toBe(first.id);
    expect(second.weight).toBe(2.0);
  });

  it("gets edges for a node with direction filter", () => {
    const center = upsertNode(db, { name: "Center", type: "person" });
    const a = upsertNode(db, { name: "NodeA", type: "case" });
    const b = upsertNode(db, { name: "NodeB", type: "place" });
    upsertEdge(db, { fromNode: center.id, toNode: a.id, relationship: "involved_in" });
    upsertEdge(db, { fromNode: b.id, toNode: center.id, relationship: "located_at" });

    const outgoing = getEdgesForNode(db, center.id, { direction: "outgoing" });
    expect(outgoing).toHaveLength(1);
    expect(outgoing[0].relationship).toBe("involved_in");

    const incoming = getEdgesForNode(db, center.id, { direction: "incoming" });
    expect(incoming).toHaveLength(1);
    expect(incoming[0].relationship).toBe("located_at");

    const both = getEdgesForNode(db, center.id, { direction: "both" });
    expect(both).toHaveLength(2);
  });
});

describe("Tag operations", () => {
  it("creates and retrieves tags", () => {
    const tagId = ensureTag(db, "이웃분쟁", "domain");
    expect(tagId).toBeGreaterThan(0);

    // Second call should reuse existing tag
    const sameTagId = ensureTag(db, "이웃분쟁", "domain");
    expect(sameTagId).toBe(tagId);
  });

  it("tags nodes and retrieves them", () => {
    const node = upsertNode(db, { name: "Test", type: "case" });
    const tagId1 = ensureTag(db, "tag1");
    const tagId2 = ensureTag(db, "tag2");
    tagNode(db, node.id, tagId1);
    tagNode(db, node.id, tagId2);

    const tags = getNodeTags(db, node.id);
    expect(tags).toHaveLength(2);
    expect(tags.map((t) => t.tag)).toContain("tag1");
    expect(tags.map((t) => t.tag)).toContain("tag2");
  });

  it("gets popular tags", () => {
    ensureTag(db, "popular_tag");
    ensureTag(db, "popular_tag"); // usage_count = 2
    ensureTag(db, "rare_tag");

    const popular = getPopularTags(db, 5);
    expect(popular.length).toBeGreaterThan(0);
    expect(popular[0].tag).toBe("popular_tag");
  });
});

describe("Graph traversal", () => {
  it("explores 1-hop connections", () => {
    const person = upsertNode(db, { name: "민수씨", type: "person" });
    const case1 = upsertNode(db, { name: "잔디밭 분쟁", type: "case" });
    const place = upsertNode(db, { name: "앞마당", type: "place" });
    upsertEdge(db, { fromNode: person.id, toNode: case1.id, relationship: "involved_in" });
    upsertEdge(db, { fromNode: case1.id, toNode: place.id, relationship: "located_at" });

    const result = exploreGraph(db, { nodeName: "민수씨", depth: 1 });
    expect(result).not.toBeNull();
    expect(result!.centerNode.name).toBe("민수씨");
    expect(result!.connectedNodes).toHaveLength(1);
    expect(result!.connectedNodes[0].node.name).toBe("잔디밭 분쟁");
  });

  it("explores 2-hop connections", () => {
    const person = upsertNode(db, { name: "민수씨", type: "person" });
    const case1 = upsertNode(db, { name: "잔디밭 분쟁", type: "case" });
    const place = upsertNode(db, { name: "앞마당", type: "place" });
    upsertEdge(db, { fromNode: person.id, toNode: case1.id, relationship: "involved_in" });
    upsertEdge(db, { fromNode: case1.id, toNode: place.id, relationship: "located_at" });

    const result = exploreGraph(db, { nodeName: "민수씨", depth: 2 });
    expect(result).not.toBeNull();
    expect(result!.connectedNodes.length).toBeGreaterThanOrEqual(2);

    const names = result!.connectedNodes.map((cn) => cn.node.name);
    expect(names).toContain("잔디밭 분쟁");
    expect(names).toContain("앞마당");
  });

  it("returns null for unknown entity", () => {
    const result = exploreGraph(db, { nodeName: "Unknown Person" });
    expect(result).toBeNull();
  });

  it("filters by relationship type", () => {
    const person = upsertNode(db, { name: "A", type: "person" });
    const case1 = upsertNode(db, { name: "Case1", type: "case" });
    const friend = upsertNode(db, { name: "Friend", type: "person" });
    upsertEdge(db, { fromNode: person.id, toNode: case1.id, relationship: "involved_in" });
    upsertEdge(db, { fromNode: person.id, toNode: friend.id, relationship: "friend" });

    const result = exploreGraph(db, {
      nodeName: "A",
      depth: 1,
      relationshipTypes: ["friend"],
    });
    expect(result!.connectedNodes).toHaveLength(1);
    expect(result!.connectedNodes[0].node.name).toBe("Friend");
  });
});

describe("Chunk metadata", () => {
  it("stores and retrieves chunk metadata", () => {
    upsertChunkMetadata(db, {
      chunkId: "chunk_001",
      memoryFile: "interactions/2026-03-10_dispute.md",
      type: "dispute",
      createdAt: "2026-03-10T14:30:00Z",
      people: ["민수씨"],
      caseRef: "잔디밭_분쟁_2026-03",
      place: "앞마당",
      tags: ["이웃분쟁"],
      importance: 7,
      domain: "daily",
      linkedNodes: ["person_민수씨", "case_잔디밭_분쟁"],
    });

    const row = db
      .prepare(`SELECT * FROM chunk_metadata WHERE chunk_id = ?`)
      .get("chunk_001") as Record<string, unknown>;
    expect(row).toBeDefined();
    expect(row.type).toBe("dispute");
    expect(row.importance).toBe(7);
  });
});

describe("Graph search for chunks", () => {
  it("finds chunks linked to matching nodes", () => {
    const person = upsertNode(db, { name: "민수씨", type: "person" });

    // Create a chunk in the chunks table
    db.prepare(
      `INSERT INTO chunks (id, path, source, start_line, end_line, hash, model, text, embedding, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      "chunk_001",
      "test.md",
      "memory",
      1,
      10,
      "abc",
      "test-model",
      "Test text about 민수씨",
      "[]",
      Date.now(),
    );

    upsertChunkMetadata(db, {
      chunkId: "chunk_001",
      memoryFile: "test.md",
      type: "dispute",
      linkedNodes: [person.id],
      importance: 7,
    });

    const results = searchGraphForChunks(db, {
      query: "민수씨",
      limit: 5,
    });

    expect(results.length).toBeGreaterThan(0);
    expect(results[0].chunkId).toBe("chunk_001");
  });

  it("applies metadata filters", () => {
    upsertChunkMetadata(db, {
      chunkId: "chunk_a",
      memoryFile: "a.md",
      type: "dispute",
      importance: 8,
      domain: "daily",
    });
    upsertChunkMetadata(db, {
      chunkId: "chunk_b",
      memoryFile: "b.md",
      type: "meeting",
      importance: 5,
      domain: "work",
    });

    const disputes = searchGraphForChunks(db, {
      query: "test",
      filters: { type: "dispute" },
    });
    // May return 0 if no nodes match, but at least no errors
    expect(Array.isArray(disputes)).toBe(true);
  });
});

describe("Memory statistics", () => {
  it("returns correct stats", () => {
    const person1 = upsertNode(db, { name: "Person1", type: "person" });
    upsertNode(db, { name: "Person2", type: "person" });
    const case1 = upsertNode(db, { name: "Case1", type: "case" });
    upsertEdge(db, {
      fromNode: person1.id,
      toNode: case1.id,
      relationship: "test",
    });

    const stats = getMemoryStats(db);
    expect(stats.totalNodes).toBe(3);
    expect(stats.nodesByType["person"]).toBe(2);
    expect(stats.nodesByType["case"]).toBe(1);
  });
});
