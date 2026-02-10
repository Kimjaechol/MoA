/**
 * MoA Advanced Memory System - OpenClaw Integration Bridge
 *
 * Connects the advanced memory system to the existing OpenClaw
 * MemoryIndexManager. Hooks into the sync/index pipeline to
 * automatically enrich chunks with graph metadata.
 *
 * Integration strategy:
 * - Uses the same SQLite database as OpenClaw (extends it with new tables)
 * - Hooks into the indexFile pipeline to add chunk metadata
 * - Enhances search results with graph-based scoring
 * - Maintains backward compatibility: OpenClaw's original search still works
 */

import type { DatabaseSync } from "node:sqlite";
import type { ClassifyFunction } from "./manager.js";
import type { AdvancedSearchFilters, AdvancedSearchResult } from "./types.js";
import { createSubsystemLogger } from "../../logging/subsystem.js";
import { classifyWithRules } from "./classifier.js";
import { parseFrontmatter, extractInternalLinks } from "./frontmatter.js";
import { ensureAdvancedMemorySchema } from "./graph-schema.js";
import { upsertChunkMetadata } from "./graph.js";
import { AdvancedMemoryManager } from "./manager.js";

const log = createSubsystemLogger("memory-advanced");

// ─── Singleton cache for AdvancedMemoryManager instances ───
const ADVANCED_CACHE = new Map<string, AdvancedMemoryManager>();

/**
 * Get or create an AdvancedMemoryManager that extends an existing OpenClaw memory database.
 *
 * @param db - The existing SQLite DatabaseSync from MemoryIndexManager
 * @param workspaceDir - The workspace directory (same as OpenClaw's workspaceDir)
 * @param classifyFn - Optional LLM function for auto-classification
 */
export async function getAdvancedMemoryManager(params: {
  db: DatabaseSync;
  workspaceDir: string;
  userId?: string;
  classifyFn?: ClassifyFunction;
}): Promise<AdvancedMemoryManager> {
  const cacheKey = `${params.userId ?? "default"}:${params.workspaceDir}`;
  const existing = ADVANCED_CACHE.get(cacheKey);
  if (existing) {
    return existing;
  }

  const manager = new AdvancedMemoryManager({
    userId: params.userId,
    memoryBaseDir: params.workspaceDir,
  });

  await manager.initialize({
    existingDb: params.db,
    classifyFn: params.classifyFn,
  });

  ADVANCED_CACHE.set(cacheKey, manager);
  return manager;
}

/**
 * Hook into the OpenClaw indexFile pipeline.
 * Called after each file is indexed by the base MemoryIndexManager.
 *
 * This function:
 * 1. Parses YAML frontmatter for metadata
 * 2. Extracts [[internal links]] for graph construction
 * 3. Classifies content for each chunk
 * 4. Updates chunk_metadata with advanced metadata
 * 5. Adds entities and relationships to the knowledge graph
 */
export function enrichIndexedFile(params: {
  db: DatabaseSync;
  filePath: string;
  content: string;
  chunkIds: string[];
  chunkTexts: string[];
  workspaceDir: string;
}): void {
  try {
    // Ensure advanced schema exists (idempotent)
    ensureAdvancedMemorySchema(params.db);

    const { frontmatter, body } = parseFrontmatter(params.content);
    const internalLinks = extractInternalLinks(body);

    // Classify the full document content
    const fullClassification = classifyWithRules(params.content);

    // Enrich each chunk with metadata
    for (let i = 0; i < params.chunkIds.length; i++) {
      const chunkId = params.chunkIds[i];
      const chunkText = params.chunkTexts[i];
      if (!chunkId || !chunkText) {
        continue;
      }

      // Use frontmatter data if available, otherwise use document-level classification
      const type = frontmatter?.type ?? fullClassification.type;
      const people = frontmatter?.people ?? fullClassification.people;
      const caseRef = frontmatter?.case ?? fullClassification.case;
      const place = frontmatter?.place ?? fullClassification.place;
      const tags = frontmatter?.tags ?? fullClassification.tags;
      const importance = frontmatter?.importance ?? fullClassification.importance;
      const domain = frontmatter?.domain ?? fullClassification.domain;
      const emotion = frontmatter?.emotion ?? fullClassification.emotion;

      // Build linked node IDs from entities and links
      const linkedNodes: string[] = [];
      for (const entity of fullClassification.entities) {
        linkedNodes.push(entity.id);
      }
      for (const link of internalLinks) {
        linkedNodes.push(`topic_${slugify(link.target)}`);
      }

      upsertChunkMetadata(params.db, {
        chunkId,
        memoryFile: params.filePath,
        type: type as string,
        createdAt: frontmatter?.created ?? new Date().toISOString(),
        people: people,
        caseRef: caseRef,
        place: place,
        tags: tags as string[] | undefined,
        importance: importance as number | undefined,
        domain: domain as string | undefined,
        emotion: emotion as string | undefined,
        linkedNodes: linkedNodes.length > 0 ? linkedNodes : undefined,
        frontmatter: frontmatter as Record<string, unknown> | undefined,
      });
    }

    log.debug("Enriched indexed file", {
      file: params.filePath,
      chunks: params.chunkIds.length,
      type: fullClassification.type,
      entities: fullClassification.entities.length,
    });
  } catch (err) {
    // Non-fatal: don't break the main indexing pipeline
    log.warn(`Failed to enrich indexed file ${params.filePath}: ${String(err)}`);
  }
}

/**
 * Enhance OpenClaw search results with graph-based scoring.
 * Called after the base MemoryIndexManager.search() returns results.
 *
 * This function:
 * 1. Classifies the query type for weight optimization
 * 2. Performs graph search for additional results
 * 3. Merges graph scores with existing vector+BM25 scores
 * 4. Optionally expands results with related context
 */
export async function enhanceSearchResults(params: {
  db: DatabaseSync;
  query: string;
  baseResults: Array<{
    path: string;
    startLine: number;
    endLine: number;
    score: number;
    snippet: string;
    source: string;
  }>;
  filters?: AdvancedSearchFilters;
  expandGraph?: boolean;
  workspaceDir: string;
}): Promise<AdvancedSearchResult[]> {
  try {
    const manager = await getAdvancedMemoryManager({
      db: params.db,
      workspaceDir: params.workspaceDir,
    });

    // Convert base results to the format expected by the advanced search
    const vectorResults = params.baseResults.map((r) => ({
      id: `${r.path}:${r.startLine}:${r.endLine}`,
      path: r.path,
      startLine: r.startLine,
      endLine: r.endLine,
      score: r.score,
      snippet: r.snippet,
      source: r.source,
    }));

    return manager.search({
      query: params.query,
      vectorResults,
      filters: params.filters,
      expandGraph: params.expandGraph,
    });
  } catch (err) {
    log.warn(`Failed to enhance search results: ${String(err)}`);
    // Fall back to original results
    return params.baseResults.map((r) => ({
      ...r,
      type: undefined,
      people: undefined,
      case: undefined,
      place: undefined,
      tags: undefined,
      importance: undefined,
    }));
  }
}

/**
 * Clean up cached managers for a workspace.
 */
export function closeAdvancedMemory(workspaceDir: string): void {
  for (const [key, manager] of ADVANCED_CACHE) {
    if (key.includes(workspaceDir)) {
      manager.close();
      ADVANCED_CACHE.delete(key);
    }
  }
}

// ─── Helpers ───

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\u3131-\u314e\u314f-\u3163\uac00-\ud7a3\u4e00-\u9fff]+/g, "_")
    .replace(/^_|_$/g, "")
    .slice(0, 40);
}
