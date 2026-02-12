/**
 * MoA Advanced Memory v2 — Proactive Memory Tags
 *
 * Extends the memory tagging system with tags that carry proactive
 * behavior metadata. These tags allow memories to:
 *
 *   - Trigger agent actions when conditions are met
 *   - Route to specific agents
 *   - Expire automatically
 *   - Carry action hints (what to do when this memory is relevant)
 *   - Link to trigger rules
 *
 * This bridges the memory system with the proactive agent system:
 *   memory_search → finds relevant memories with trigger tags →
 *   trigger engine creates events → gateway processes them
 *
 * Tag categories:
 *   - trigger: conditions that activate this memory
 *   - action: what to do when this memory is relevant
 *   - context: additional context for the agent
 *   - agent: which agent(s) this memory belongs to
 *   - priority: importance level for processing order
 *   - expiry: when this tag/memory should expire
 */

import type { DatabaseSync } from "node:sqlite";

// ─── Types ───

export type TagCategory = "trigger" | "action" | "context" | "agent" | "priority" | "expiry";

export interface ProactiveTag {
  id: string;
  /** The chunk this tag belongs to */
  chunkId: string;
  /** Tag name (e.g. "server_down", "daily_report", "notify_developer") */
  name: string;
  /** Category of the tag */
  category: TagCategory;
  /** The actual value (e.g. condition expression, action description) */
  value: string;
  /** When this tag was created */
  createdAt: string;
  /** When this tag expires (ISO date string) */
  expiresAt?: string;
  /** Whether this tag is active */
  active: boolean;
}

export interface TriggerTagConfig {
  /** Metric name to watch */
  metric?: string;
  /** Threshold for the metric */
  threshold?: number;
  /** Comparison operator */
  operator?: "gt" | "lt" | "eq" | "gte" | "lte";
  /** Text pattern to match */
  pattern?: string;
}

export interface ActionTagConfig {
  /** Type of action to take */
  actionType: "notify" | "escalate" | "auto_respond" | "delegate" | "log";
  /** Target agent or channel */
  target?: string;
  /** Message template */
  messageTemplate?: string;
}

// ─── Schema ───

/**
 * Create the proactive_tags table if it doesn't exist.
 */
export function ensureProactiveTagsSchema(db: DatabaseSync): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS proactive_tags (
      id TEXT PRIMARY KEY,
      chunk_id TEXT NOT NULL,
      name TEXT NOT NULL,
      category TEXT NOT NULL,
      value TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      expires_at TEXT,
      active INTEGER NOT NULL DEFAULT 1,
      FOREIGN KEY (chunk_id) REFERENCES chunk_metadata(id) ON DELETE CASCADE
    )
  `);

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_proactive_tags_chunk
      ON proactive_tags(chunk_id)
  `);

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_proactive_tags_category
      ON proactive_tags(category)
  `);

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_proactive_tags_name
      ON proactive_tags(name)
  `);

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_proactive_tags_active
      ON proactive_tags(active)
  `);
}

// ─── Tag Operations ───

let tagIdCounter = 0;

function generateTagId(): string {
  tagIdCounter += 1;
  return `ptag_${Date.now()}_${tagIdCounter}`;
}

/**
 * Add a proactive tag to a memory chunk.
 */
export function addProactiveTag(
  db: DatabaseSync,
  params: {
    chunkId: string;
    name: string;
    category: TagCategory;
    value: string;
    expiresAt?: string;
  },
): ProactiveTag {
  const id = generateTagId();
  const now = new Date().toISOString();

  db.prepare(
    `INSERT INTO proactive_tags (id, chunk_id, name, category, value, created_at, expires_at, active)
     VALUES (?, ?, ?, ?, ?, ?, ?, 1)`,
  ).run(
    id,
    params.chunkId,
    params.name,
    params.category,
    params.value,
    now,
    params.expiresAt ?? null,
  );

  return {
    id,
    chunkId: params.chunkId,
    name: params.name,
    category: params.category,
    value: params.value,
    createdAt: now,
    expiresAt: params.expiresAt,
    active: true,
  };
}

/**
 * Get all active proactive tags for a memory chunk.
 */
export function getTagsForChunk(db: DatabaseSync, chunkId: string): ProactiveTag[] {
  deactivateExpiredTags(db);

  const rows = db
    .prepare(
      `SELECT * FROM proactive_tags WHERE chunk_id = ? AND active = 1 ORDER BY category, name`,
    )
    .all(chunkId) as unknown as ProactiveTagRow[];

  return rows.map(rowToTag);
}

/**
 * Find memory chunks that have trigger tags matching given criteria.
 * This is used by the trigger engine to find memories with
 * actionable conditions.
 */
export function findChunksWithTriggerTags(
  db: DatabaseSync,
  options?: {
    category?: TagCategory;
    namePattern?: string;
    limit?: number;
  },
): Array<{ chunkId: string; tags: ProactiveTag[] }> {
  deactivateExpiredTags(db);

  let query = `SELECT * FROM proactive_tags WHERE active = 1`;
  const values: (string | number)[] = [];

  if (options?.category) {
    query += ` AND category = ?`;
    values.push(options.category);
  }

  if (options?.namePattern) {
    query += ` AND name LIKE ?`;
    values.push(`%${options.namePattern}%`);
  }

  query += ` ORDER BY chunk_id, category, name`;

  if (options?.limit) {
    query += ` LIMIT ?`;
    values.push(options.limit);
  }

  const rows = db.prepare(query).all(...values) as unknown as ProactiveTagRow[];

  // Group by chunk
  const grouped = new Map<string, ProactiveTag[]>();
  for (const row of rows) {
    const tag = rowToTag(row);
    const existing = grouped.get(tag.chunkId) ?? [];
    existing.push(tag);
    grouped.set(tag.chunkId, existing);
  }

  return [...grouped.entries()].map(([chunkId, tags]) => ({
    chunkId,
    tags,
  }));
}

/**
 * Find trigger tags that match a specific metric condition.
 * Used during heartbeat to check if any memory-linked triggers should fire.
 */
export function findMatchingTriggerTags(
  db: DatabaseSync,
  metric: string,
  value: number,
): Array<{ chunkId: string; tag: ProactiveTag; config: TriggerTagConfig }> {
  const triggerChunks = findChunksWithTriggerTags(db, {
    category: "trigger",
  });

  const results: Array<{ chunkId: string; tag: ProactiveTag; config: TriggerTagConfig }> = [];

  for (const { chunkId, tags } of triggerChunks) {
    for (const tag of tags) {
      const config = safeJsonParse<TriggerTagConfig>(tag.value, {});
      if (config.metric === metric && config.threshold != null) {
        const matches = compareMetricValues(value, config.threshold, config.operator ?? "gt");
        if (matches) {
          results.push({ chunkId, tag, config });
        }
      }
    }
  }

  return results;
}

/**
 * Get action tags for a chunk — tells the agent what to do
 * when this memory becomes relevant.
 */
export function getActionTags(
  db: DatabaseSync,
  chunkId: string,
): Array<{ tag: ProactiveTag; config: ActionTagConfig }> {
  const tags = getTagsForChunk(db, chunkId).filter((t) => t.category === "action");

  return tags.map((tag) => ({
    tag,
    config: safeJsonParse<ActionTagConfig>(tag.value, {
      actionType: "log",
    }),
  }));
}

/**
 * Deactivate a proactive tag.
 */
export function deactivateTag(db: DatabaseSync, tagId: string): boolean {
  const result = db.prepare(`UPDATE proactive_tags SET active = 0 WHERE id = ?`).run(tagId);
  return (result as { changes: number }).changes > 0;
}

/**
 * Remove all tags for a chunk.
 */
export function removeTagsForChunk(db: DatabaseSync, chunkId: string): number {
  const result = db.prepare(`DELETE FROM proactive_tags WHERE chunk_id = ?`).run(chunkId);
  return (result as { changes: number }).changes;
}

/**
 * Deactivate expired tags.
 */
export function deactivateExpiredTags(db: DatabaseSync): number {
  const now = new Date().toISOString();
  const result = db
    .prepare(
      `UPDATE proactive_tags SET active = 0 WHERE active = 1 AND expires_at IS NOT NULL AND expires_at <= ?`,
    )
    .run(now);
  return (result as { changes: number }).changes;
}

/**
 * Get tag statistics.
 */
export function getProactiveTagStats(db: DatabaseSync): {
  total: number;
  active: number;
  byCategory: Record<string, number>;
  topNames: Array<{ name: string; count: number }>;
} {
  const total = (
    db.prepare(`SELECT COUNT(*) as cnt FROM proactive_tags`).get() as {
      cnt: number;
    }
  ).cnt;

  const active = (
    db.prepare(`SELECT COUNT(*) as cnt FROM proactive_tags WHERE active = 1`).get() as {
      cnt: number;
    }
  ).cnt;

  const categoryRows = db
    .prepare(
      `SELECT category, COUNT(*) as cnt FROM proactive_tags WHERE active = 1 GROUP BY category`,
    )
    .all() as Array<{ category: string; cnt: number }>;

  const byCategory: Record<string, number> = {};
  for (const r of categoryRows) {
    byCategory[r.category] = r.cnt;
  }

  const nameRows = db
    .prepare(
      `SELECT name, COUNT(*) as cnt FROM proactive_tags WHERE active = 1
       GROUP BY name ORDER BY cnt DESC LIMIT 10`,
    )
    .all() as Array<{ name: string; cnt: number }>;

  const topNames = nameRows.map((r) => ({ name: r.name, count: r.cnt }));

  return { total, active, byCategory, topNames };
}

// ─── Helpers ───

interface ProactiveTagRow {
  id: string;
  chunk_id: string;
  name: string;
  category: string;
  value: string;
  created_at: string;
  expires_at: string | null;
  active: number;
}

function rowToTag(row: ProactiveTagRow): ProactiveTag {
  return {
    id: row.id,
    chunkId: row.chunk_id,
    name: row.name,
    category: row.category as TagCategory,
    value: row.value,
    createdAt: row.created_at,
    expiresAt: row.expires_at ?? undefined,
    active: row.active === 1,
  };
}

function safeJsonParse<T>(json: string, fallback: T): T {
  try {
    return JSON.parse(json) as T;
  } catch {
    return fallback;
  }
}

function compareMetricValues(actual: number, threshold: number, operator: string): boolean {
  switch (operator) {
    case "gt":
      return actual > threshold;
    case "lt":
      return actual < threshold;
    case "eq":
      return actual === threshold;
    case "gte":
      return actual >= threshold;
    case "lte":
      return actual <= threshold;
    default:
      return false;
  }
}
