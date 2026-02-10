import type { DatabaseSync } from "node:sqlite";
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { ensureAdvancedSchema } from "./schema.js";
import { buildMetadataFilter, getFilteredChunkIds, getMemoryStats } from "./search-enhancer.js";

let db: DatabaseSync;

beforeEach(async () => {
  const { requireNodeSqlite } = await import("../sqlite.js");
  const { DatabaseSync: SqliteDB } = requireNodeSqlite();
  db = new SqliteDB(":memory:");
  ensureAdvancedSchema(db);

  // Insert test data
  const stmt = db.prepare(
    `INSERT INTO chunk_metadata
     (id, memory_file, chunk_index, type, case_ref, place, tags, importance,
      status, emotion, domain, people, created_at, updated_at, outgoing_links)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );

  const now = "2026-03-10T12:00:00Z";

  stmt.run(
    "chunk1",
    "cases/분쟁.md",
    0,
    "dispute",
    "잔디밭_분쟁",
    "앞마당",
    '["이웃분쟁","잔디밭"]',
    8,
    "active",
    "frustrated",
    "daily",
    '[{"name":"민수씨","identifier":"옆집, 40대"}]',
    now,
    now,
    '["민수씨","잔디밭_분쟁"]',
  );

  stmt.run(
    "chunk2",
    "interactions/미팅.md",
    0,
    "meeting",
    "앱개발_v2",
    "사무실",
    '["앱개발","리뷰"]',
    6,
    "active",
    null,
    "work",
    '[{"name":"박과장","identifier":"팀장"}]',
    now,
    now,
    '["박과장","앱개발_v2"]',
  );

  stmt.run(
    "chunk3",
    "journal/2026-03-09.md",
    0,
    "social",
    null,
    "카페",
    '["이직","커리어"]',
    4,
    "active",
    null,
    "social",
    '[{"name":"절친 A","identifier":"대학동기"}]',
    now,
    now,
    '["절친 A"]',
  );

  stmt.run(
    "chunk4",
    "cases/완료.md",
    0,
    "transaction",
    "중고차_구매",
    null,
    '["거래","중고차"]',
    5,
    "resolved",
    "happy",
    "daily",
    null,
    "2026-01-15T12:00:00Z",
    "2026-01-15T12:00:00Z",
    null,
  );
});

afterEach(() => {
  db.close();
});

describe("buildMetadataFilter", () => {
  it("builds empty filter", () => {
    const { where, values } = buildMetadataFilter({});
    expect(where).toBe("1=1");
    expect(values).toHaveLength(0);
  });

  it("builds type filter", () => {
    const { where, values } = buildMetadataFilter({ type: "dispute" });
    expect(where).toContain("type = ?");
    expect(values).toContain("dispute");
  });

  it("builds people filter", () => {
    const { where, values } = buildMetadataFilter({ people: ["민수씨"] });
    expect(where).toContain("people LIKE ?");
    expect(values).toContain("%민수씨%");
  });

  it("builds combined filters", () => {
    const { where, values } = buildMetadataFilter({
      type: "dispute",
      domain: "daily",
      importanceMin: 5,
    });
    expect(where).toContain("type = ?");
    expect(where).toContain("domain = ?");
    expect(where).toContain("importance >= ?");
    expect(values).toHaveLength(3);
  });
});

describe("getFilteredChunkIds", () => {
  it("returns all chunks with no filter", () => {
    const ids = getFilteredChunkIds(db, {});
    expect(ids).toHaveLength(4);
  });

  it("filters by type", () => {
    const ids = getFilteredChunkIds(db, { type: "dispute" });
    expect(ids).toHaveLength(1);
    expect(ids[0]).toBe("chunk1");
  });

  it("filters by people", () => {
    const ids = getFilteredChunkIds(db, { people: ["민수씨"] });
    expect(ids).toHaveLength(1);
    expect(ids[0]).toBe("chunk1");
  });

  it("filters by status", () => {
    const ids = getFilteredChunkIds(db, { status: "resolved" });
    expect(ids).toHaveLength(1);
    expect(ids[0]).toBe("chunk4");
  });

  it("filters by domain", () => {
    const ids = getFilteredChunkIds(db, { domain: "work" });
    expect(ids).toHaveLength(1);
    expect(ids[0]).toBe("chunk2");
  });

  it("filters by tags", () => {
    const ids = getFilteredChunkIds(db, { tags: ["이웃분쟁"] });
    expect(ids).toHaveLength(1);
    expect(ids[0]).toBe("chunk1");
  });

  it("filters by importance minimum", () => {
    const ids = getFilteredChunkIds(db, { importanceMin: 7 });
    expect(ids).toHaveLength(1);
    expect(ids[0]).toBe("chunk1");
  });
});

describe("getMemoryStats", () => {
  it("returns correct statistics", () => {
    const stats = getMemoryStats(db);
    expect(stats.totalChunks).toBe(4);
    expect(stats.totalDocuments).toBe(4);
    expect(stats.documentsByType["dispute"]).toBe(1);
    expect(stats.documentsByType["meeting"]).toBe(1);
    expect(stats.documentsByStatus["active"]).toBe(3);
    expect(stats.documentsByStatus["resolved"]).toBe(1);
    expect(stats.topPeople.length).toBeGreaterThan(0);
    expect(stats.topTags.length).toBeGreaterThan(0);
    expect(stats.totalLinks).toBeGreaterThan(0);
  });
});
