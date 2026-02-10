import type { DatabaseSync } from "node:sqlite";
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { findBacklinks, findOutgoingLinks, findCoOccurringPeople } from "./backlinks.js";
import { ensureAdvancedSchema } from "./schema.js";

let db: DatabaseSync;

beforeEach(async () => {
  const { requireNodeSqlite } = await import("../sqlite.js");
  const { DatabaseSync: SqliteDB } = requireNodeSqlite();
  db = new SqliteDB(":memory:");
  ensureAdvancedSchema(db);

  const stmt = db.prepare(
    `INSERT INTO chunk_metadata
     (id, memory_file, chunk_index, type, people, created_at, updated_at, outgoing_links)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  );

  const now = "2026-03-10T12:00:00Z";

  // Document 1: mentions 민수씨 and 잔디밭_분쟁
  stmt.run(
    "c1",
    "cases/분쟁.md",
    0,
    "dispute",
    '[{"name":"민수씨","identifier":"옆집"},{"name":"민수씨 아내"}]',
    now,
    now,
    '["민수씨","잔디밭_분쟁","이웃분쟁_관련법"]',
  );

  // Document 2: also mentions 민수씨
  stmt.run(
    "c2",
    "journal/2026-03-08.md",
    0,
    "personal_note",
    '[{"name":"민수씨","identifier":"옆집"}]',
    now,
    now,
    '["민수씨"]',
  );

  // Document 3: mentions 박과장 only
  stmt.run(
    "c3",
    "interactions/미팅.md",
    0,
    "meeting",
    '[{"name":"박과장","identifier":"팀장"}]',
    now,
    now,
    '["박과장","앱개발_v2"]',
  );

  // Document 4: mentions 민수씨 and 박과장 (co-occurrence)
  stmt.run(
    "c4",
    "journal/2026-03-10.md",
    0,
    "personal_note",
    '[{"name":"민수씨"},{"name":"박과장"}]',
    now,
    now,
    '["민수씨","박과장"]',
  );
});

afterEach(() => {
  db.close();
});

describe("findBacklinks", () => {
  it("finds documents that link to an entity", () => {
    const backlinks = findBacklinks(db, "민수씨");
    expect(backlinks.length).toBeGreaterThanOrEqual(3);
  });

  it("returns empty for unknown entity", () => {
    const backlinks = findBacklinks(db, "존재하지않는사람");
    expect(backlinks).toHaveLength(0);
  });

  it("includes file and type info", () => {
    const backlinks = findBacklinks(db, "잔디밭_분쟁");
    expect(backlinks.length).toBeGreaterThanOrEqual(1);
    const first = backlinks[0];
    expect(first.memoryFile).toBeDefined();
    expect(first.chunkId).toBeDefined();
  });
});

describe("findOutgoingLinks", () => {
  it("returns all outgoing links from a file", () => {
    const links = findOutgoingLinks(db, "cases/분쟁.md");
    expect(links).toContain("민수씨");
    expect(links).toContain("잔디밭_분쟁");
    expect(links).toContain("이웃분쟁_관련법");
  });

  it("returns empty for file with no links", () => {
    const links = findOutgoingLinks(db, "nonexistent.md");
    expect(links).toHaveLength(0);
  });
});

describe("findCoOccurringPeople", () => {
  it("finds people who appear with the target person", () => {
    const coOccurring = findCoOccurringPeople(db, "민수씨");
    const names = coOccurring.map((p) => p.name);
    expect(names).toContain("민수씨 아내");
    expect(names).toContain("박과장");
  });

  it("does not include the target person themselves", () => {
    const coOccurring = findCoOccurringPeople(db, "민수씨");
    const names = coOccurring.map((p) => p.name);
    expect(names).not.toContain("민수씨");
  });

  it("returns sorted by co-occurrence count", () => {
    const coOccurring = findCoOccurringPeople(db, "민수씨");
    if (coOccurring.length >= 2) {
      expect(coOccurring[0].coOccurrences).toBeGreaterThanOrEqual(coOccurring[1].coOccurrences);
    }
  });
});
