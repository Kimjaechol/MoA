/**
 * MoA Advanced Memory v2 — OpenClaw Integration Bridge
 *
 * Hooks into OpenClaw's existing indexFile() pipeline to enrich chunks
 * with structured metadata. Non-breaking — failures are silently caught.
 *
 * v2 changes:
 *   - No graph.db operations (removed)
 *   - Only writes to chunk_metadata table
 *   - Uses regex extraction only (no LLM calls)
 */

import type { DatabaseSync } from "node:sqlite";
import { parseFrontmatter, frontmatterToMetadata, extractLinkTargets } from "./frontmatter.js";
import { extractMetadata } from "./metadata-extractor.js";
import { ensureAdvancedSchema } from "./schema.js";

/**
 * Enrich indexed file chunks with structured metadata.
 * Called from OpenClaw's MemoryIndexManager.indexFile() method.
 *
 * This is the main integration point — processes each indexed file to:
 * 1. Parse YAML frontmatter (if present)
 * 2. Extract metadata via regex (type, people, place, tags, etc.)
 * 3. Extract [[internal links]] for backlink tracking
 * 4. Store everything in chunk_metadata table
 */
export function enrichIndexedFile(params: {
  db: DatabaseSync;
  filePath: string;
  content: string;
  chunkIds: string[];
  chunkTexts: string[];
}): void {
  const { db, filePath, content, chunkIds, chunkTexts: _chunkTexts } = params;

  // Ensure schema exists (safe to call multiple times)
  ensureAdvancedSchema(db);

  // Parse frontmatter if present
  const { frontmatter, body } = parseFrontmatter(content);
  const fmMetadata = frontmatterToMetadata(frontmatter);

  // Extract metadata from body text via regex
  const extracted = extractMetadata(body);

  // Merge: frontmatter takes priority over regex extraction
  const merged = {
    type: fmMetadata.type ?? extracted.type,
    people: fmMetadata.people?.length ? fmMetadata.people : extracted.people,
    place: fmMetadata.place ?? extracted.place,
    tags: fmMetadata.tags?.length ? fmMetadata.tags : extracted.tags,
    importance: fmMetadata.importance ?? extracted.importance,
    emotion: fmMetadata.emotion ?? extracted.emotion,
    emotionRaw: extracted.emotionRaw,
    domain: fmMetadata.domain ?? extracted.domain,
    status: fmMetadata.status ?? extracted.status ?? "active",
    caseRef: fmMetadata.caseRef ?? extracted.caseRef,
  };

  // Extract outgoing [[links]]
  const outgoingLinks = extractLinkTargets(content);
  const now = new Date().toISOString();

  // Store metadata for each chunk
  const stmt = db.prepare(
    `INSERT OR REPLACE INTO chunk_metadata
     (id, memory_file, chunk_index, type, case_ref, place, tags,
      importance, status, emotion, emotion_raw, domain, people,
      created_at, updated_at, outgoing_links)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );

  for (let i = 0; i < chunkIds.length; i++) {
    stmt.run(
      chunkIds[i],
      filePath,
      i,
      merged.type ?? null,
      merged.caseRef ?? null,
      merged.place ?? null,
      merged.tags.length > 0 ? JSON.stringify(merged.tags) : null,
      merged.importance,
      merged.status,
      merged.emotion ?? null,
      merged.emotionRaw ?? null,
      merged.domain ?? null,
      merged.people.length > 0 ? JSON.stringify(merged.people) : null,
      now,
      now,
      outgoingLinks.length > 0 ? JSON.stringify(outgoingLinks) : null,
    );
  }
}
