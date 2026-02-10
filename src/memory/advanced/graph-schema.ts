/**
 * MoA Advanced Memory System - Knowledge Graph Schema
 *
 * SQLite-based knowledge graph with nodes (entities), edges (relationships),
 * tags, and enhanced memory chunks with metadata.
 * Extends the existing OpenClaw memory schema.
 */

import type { DatabaseSync } from "node:sqlite";

/**
 * Create or migrate the advanced memory graph tables.
 * Safe to call multiple times (uses IF NOT EXISTS).
 */
export function ensureAdvancedMemorySchema(db: DatabaseSync): void {
  // Nodes (entities) table
  db.exec(`
    CREATE TABLE IF NOT EXISTS nodes (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      type TEXT NOT NULL,
      subtype TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      importance INTEGER NOT NULL DEFAULT 5,
      status TEXT NOT NULL DEFAULT 'active',
      confidence REAL NOT NULL DEFAULT 1.0,
      memory_file TEXT,
      source TEXT,
      properties TEXT NOT NULL DEFAULT '{}',
      valid_from TEXT,
      valid_to TEXT
    );
  `);

  // Edges (relationships) table
  db.exec(`
    CREATE TABLE IF NOT EXISTS edges (
      id TEXT PRIMARY KEY,
      from_node TEXT NOT NULL REFERENCES nodes(id) ON DELETE CASCADE,
      to_node TEXT NOT NULL REFERENCES nodes(id) ON DELETE CASCADE,
      relationship TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      weight REAL NOT NULL DEFAULT 1.0,
      confidence REAL NOT NULL DEFAULT 1.0,
      properties TEXT NOT NULL DEFAULT '{}',
      valid_from TEXT,
      valid_to TEXT,
      source_memory TEXT
    );
  `);

  // Tags table
  db.exec(`
    CREATE TABLE IF NOT EXISTS tags (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tag TEXT NOT NULL UNIQUE,
      category TEXT,
      usage_count INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);

  // Node-tag join table
  db.exec(`
    CREATE TABLE IF NOT EXISTS node_tags (
      node_id TEXT NOT NULL REFERENCES nodes(id) ON DELETE CASCADE,
      tag_id INTEGER NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
      PRIMARY KEY (node_id, tag_id)
    );
  `);

  // Enhanced chunk metadata table (links chunks to graph nodes)
  db.exec(`
    CREATE TABLE IF NOT EXISTS chunk_metadata (
      chunk_id TEXT PRIMARY KEY,
      memory_file TEXT NOT NULL,
      type TEXT,
      created_at TEXT,
      people TEXT,
      case_ref TEXT,
      place TEXT,
      tags TEXT,
      importance INTEGER,
      domain TEXT,
      emotion TEXT,
      linked_nodes TEXT,
      frontmatter TEXT
    );
  `);

  // Graph traversal indexes
  db.exec(`CREATE INDEX IF NOT EXISTS idx_edges_from ON edges(from_node);`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_edges_to ON edges(to_node);`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_edges_relationship ON edges(relationship);`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_edges_temporal ON edges(valid_from, valid_to);`);

  // Node filtering indexes
  db.exec(`CREATE INDEX IF NOT EXISTS idx_nodes_type ON nodes(type);`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_nodes_status ON nodes(status);`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_nodes_importance ON nodes(importance);`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_nodes_name ON nodes(name);`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_nodes_temporal ON nodes(valid_from, valid_to);`);

  // Chunk metadata indexes
  db.exec(`CREATE INDEX IF NOT EXISTS idx_chunk_meta_type ON chunk_metadata(type);`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_chunk_meta_case ON chunk_metadata(case_ref);`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_chunk_meta_created ON chunk_metadata(created_at);`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_chunk_meta_domain ON chunk_metadata(domain);`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_chunk_meta_importance ON chunk_metadata(importance);`);

  // Tag usage index
  db.exec(`CREATE INDEX IF NOT EXISTS idx_tags_usage ON tags(usage_count DESC);`);
}
