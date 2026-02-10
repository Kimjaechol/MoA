/**
 * MoA Advanced Memory v2 — Database Schema
 *
 * Extends the existing OpenClaw SQLite DB with a single chunk_metadata table.
 * No separate graph.db — [[links]] in content serve as the graph.
 *
 * Tables added:
 *   - chunk_metadata: structured metadata for filtering + time decay + backlinks
 */

import type { DatabaseSync } from "node:sqlite";

/**
 * Create the chunk_metadata table if it doesn't exist.
 * Safe to call multiple times (uses IF NOT EXISTS).
 */
export function ensureAdvancedSchema(db: DatabaseSync): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS chunk_metadata (
      id              TEXT PRIMARY KEY,
      memory_file     TEXT NOT NULL,
      chunk_index     INTEGER NOT NULL DEFAULT 0,

      -- Metadata = classification (from YAML frontmatter)
      type            TEXT,
      case_ref        TEXT,
      place           TEXT,
      tags            TEXT,
      importance      INTEGER DEFAULT 5,
      status          TEXT DEFAULT 'active',
      emotion         TEXT,
      emotion_raw     TEXT,
      domain          TEXT,

      -- People with disambiguation info (JSON array of {name, identifier})
      people          TEXT,

      -- Time decay fields
      created_at      TEXT NOT NULL,
      updated_at      TEXT NOT NULL,
      last_accessed   TEXT,
      access_count    INTEGER DEFAULT 0,

      -- Outgoing [[links]] for quick backlink lookups (JSON array)
      outgoing_links  TEXT
    );

    -- Metadata filtering indexes (search step 1)
    CREATE INDEX IF NOT EXISTS idx_cm_type ON chunk_metadata(type);
    CREATE INDEX IF NOT EXISTS idx_cm_case ON chunk_metadata(case_ref);
    CREATE INDEX IF NOT EXISTS idx_cm_status ON chunk_metadata(status);
    CREATE INDEX IF NOT EXISTS idx_cm_domain ON chunk_metadata(domain);
    CREATE INDEX IF NOT EXISTS idx_cm_importance ON chunk_metadata(importance);
    CREATE INDEX IF NOT EXISTS idx_cm_created ON chunk_metadata(created_at);
    CREATE INDEX IF NOT EXISTS idx_cm_memory_file ON chunk_metadata(memory_file);
  `);
}
