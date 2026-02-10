/**
 * MoA Advanced Memory v2 — Agent Tools
 *
 * MCP-compatible tools for the advanced memory system.
 *
 * v2 changes:
 *   - memory_explore removed (absorbed into memory_search expand_links)
 *   - memory_edit added (user correction workflow)
 *   - No graph DB operations
 *   - SLM-based metadata extraction (regex + local SLM, cost: $0)
 */

import type { DatabaseSync } from "node:sqlite";
import { Type } from "@sinclair/typebox";
import type { AdvancedSearchFilters } from "./types.js";
import { findBacklinks, findCoOccurringPeople } from "./backlinks.js";
import { enrichIndexedFile } from "./integration.js";
import { ensureAdvancedSchema } from "./schema.js";
import { getFilteredChunkIds, getMemoryStats } from "./search-enhancer.js";

// ─── Tool Schemas ───

const memoryStoreSchema = Type.Object({
  content: Type.String({ description: "Content to store in memory" }),
  type: Type.Optional(Type.String({ description: "Memory type override" })),
  people: Type.Optional(
    Type.Array(
      Type.Object({
        name: Type.String(),
        identifier: Type.Optional(Type.String()),
      }),
    ),
  ),
  tags: Type.Optional(Type.Array(Type.String())),
  place: Type.Optional(Type.String()),
  case_ref: Type.Optional(Type.String({ description: "Case/episode reference" })),
  importance: Type.Optional(Type.Number({ description: "1-10 importance" })),
});

const memorySearchSchema = Type.Object({
  query: Type.String({ description: "Natural language search query" }),
  type: Type.Optional(Type.String({ description: "Filter by memory type" })),
  people: Type.Optional(Type.Array(Type.String(), { description: "Filter by people" })),
  case_ref: Type.Optional(Type.String({ description: "Filter by case reference" })),
  date_from: Type.Optional(Type.String({ description: "Start date (ISO)" })),
  date_to: Type.Optional(Type.String({ description: "End date (ISO)" })),
  tags: Type.Optional(Type.Array(Type.String(), { description: "Filter by tags" })),
  domain: Type.Optional(Type.String({ description: "Filter by domain" })),
  importance_min: Type.Optional(Type.Number({ description: "Minimum importance (1-10)" })),
  status: Type.Optional(Type.String({ description: "Filter by status" })),
  expand_links: Type.Optional(Type.Boolean({ description: "Follow [[links]] to expand results" })),
  apply_decay: Type.Optional(
    Type.Boolean({ description: "Apply time decay scoring (default true)" }),
  ),
  limit: Type.Optional(Type.Number({ description: "Max results" })),
});

const memoryEditSchema = Type.Object({
  chunk_id: Type.String({ description: "Chunk ID to edit" }),
  type: Type.Optional(Type.String()),
  tags: Type.Optional(Type.Array(Type.String())),
  importance: Type.Optional(Type.Number()),
  status: Type.Optional(Type.String()),
  people: Type.Optional(
    Type.Array(
      Type.Object({
        name: Type.String(),
        identifier: Type.Optional(Type.String()),
      }),
    ),
  ),
});

const memoryStatsSchema = Type.Object({});

// ─── Tool Implementations ───

export function createAdvancedMemoryTools(db: DatabaseSync) {
  ensureAdvancedSchema(db);

  return [
    {
      name: "memory_store",
      description:
        "Store content in advanced memory with automatic metadata extraction (regex + SLM, cost: $0). " +
        "Metadata = classification. [[Links]] = relationships. No separate graph DB.",
      schema: memoryStoreSchema,
      execute: async (params: {
        content: string;
        type?: string;
        people?: Array<{ name: string; identifier?: string }>;
        tags?: string[];
        place?: string;
        case_ref?: string;
        importance?: number;
      }) => {
        const chunkId = `mem_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

        enrichIndexedFile({
          db,
          filePath: `interactions/${new Date().toISOString().slice(0, 10)}_${chunkId}.md`,
          content: params.content,
          chunkIds: [chunkId],
          chunkTexts: [params.content],
        });

        // Apply user overrides if provided
        if (
          params.type ||
          params.people ||
          params.tags ||
          params.place ||
          params.case_ref ||
          params.importance
        ) {
          const updates: string[] = [];
          const values: Array<string | number | null> = [];

          if (params.type) {
            updates.push("type = ?");
            values.push(params.type);
          }
          if (params.tags) {
            updates.push("tags = ?");
            values.push(JSON.stringify(params.tags));
          }
          if (params.place) {
            updates.push("place = ?");
            values.push(params.place);
          }
          if (params.case_ref) {
            updates.push("case_ref = ?");
            values.push(params.case_ref);
          }
          if (params.importance) {
            updates.push("importance = ?");
            values.push(params.importance);
          }
          if (params.people) {
            updates.push("people = ?");
            values.push(JSON.stringify(params.people));
          }

          if (updates.length > 0) {
            db.prepare(`UPDATE chunk_metadata SET ${updates.join(", ")} WHERE id = ?`).run(
              ...values,
              chunkId,
            );
          }
        }

        return { stored: true, chunkId };
      },
    },

    {
      name: "memory_search",
      description:
        "Search memory with metadata filtering + time decay + link expansion. " +
        "Pipeline: metadata filter → vector search → FTS5 boost → link traversal.",
      schema: memorySearchSchema,
      execute: async (params: {
        query: string;
        type?: string;
        people?: string[];
        case_ref?: string;
        date_from?: string;
        date_to?: string;
        tags?: string[];
        domain?: string;
        importance_min?: number;
        status?: string;
        expand_links?: boolean;
        apply_decay?: boolean;
        limit?: number;
      }) => {
        const filters: AdvancedSearchFilters = {
          type: params.type as AdvancedSearchFilters["type"],
          people: params.people,
          caseRef: params.case_ref,
          dateFrom: params.date_from,
          dateTo: params.date_to,
          tags: params.tags,
          domain: params.domain as AdvancedSearchFilters["domain"],
          importanceMin: params.importance_min,
          status: params.status as AdvancedSearchFilters["status"],
        };

        // Step 1: metadata pre-filter
        const candidateIds = getFilteredChunkIds(db, filters, params.limit ?? 50);

        // Return filtered IDs (actual vector search happens in the caller/manager)
        return {
          candidateIds,
          filters,
          expandLinks: params.expand_links ?? false,
          applyDecay: params.apply_decay ?? true,
          limit: params.limit ?? 20,
        };
      },
    },

    {
      name: "memory_edit",
      description:
        "Edit metadata of a memory chunk (user correction workflow). " +
        "Since metadata = classification, editing metadata = correcting classification.",
      schema: memoryEditSchema,
      execute: async (params: {
        chunk_id: string;
        type?: string;
        tags?: string[];
        importance?: number;
        status?: string;
        people?: Array<{ name: string; identifier?: string }>;
      }) => {
        const updates: string[] = [];
        const values: Array<string | number | null> = [];

        if (params.type) {
          updates.push("type = ?");
          values.push(params.type);
        }
        if (params.tags) {
          updates.push("tags = ?");
          values.push(JSON.stringify(params.tags));
        }
        if (params.importance) {
          updates.push("importance = ?");
          values.push(params.importance);
        }
        if (params.status) {
          updates.push("status = ?");
          values.push(params.status);
        }
        if (params.people) {
          updates.push("people = ?");
          values.push(JSON.stringify(params.people));
        }

        updates.push("updated_at = ?");
        values.push(new Date().toISOString());

        if (updates.length > 1) {
          db.prepare(`UPDATE chunk_metadata SET ${updates.join(", ")} WHERE id = ?`).run(
            ...values,
            params.chunk_id,
          );
        }

        return { edited: true, chunkId: params.chunk_id };
      },
    },

    {
      name: "memory_stats",
      description:
        "Get memory statistics: document counts, top people, top tags, domain distribution.",
      schema: memoryStatsSchema,
      execute: async () => {
        return getMemoryStats(db);
      },
    },

    {
      name: "memory_backlinks",
      description:
        "Find all documents that reference a given entity. " +
        "Replaces graph traversal — [[links]] are the graph.",
      schema: Type.Object({
        entity_name: Type.String({ description: "Entity name to find backlinks for" }),
      }),
      execute: async (params: { entity_name: string }) => {
        const backlinks = findBacklinks(db, params.entity_name);
        const coOccurring = findCoOccurringPeople(db, params.entity_name);
        return { backlinks, coOccurringPeople: coOccurring };
      },
    },
  ];
}
