/**
 * MoA Advanced Memory System - Agent Tools
 *
 * MCP-compatible tool definitions that expose the advanced memory system
 * to AI agents. These tools wrap the AdvancedMemoryManager API.
 *
 * Tools:
 * - memory_store_advanced: Store with auto-classification
 * - memory_search_advanced: Triple hybrid search
 * - memory_explore: Graph exploration
 * - knowledge_upload: Knowledge base management
 * - knowledge_query: Knowledge-specific search
 * - memory_hub: Hub document access
 * - memory_stats: Memory statistics
 */

import { Type } from "@sinclair/typebox";
import type { AdvancedMemoryManager } from "./manager.js";
import type { AdvancedSearchFilters, DomainType, HubType, MemoryEntryType } from "./types.js";

type ToolResult = { content: Array<{ type: "text"; text: string }> };

function jsonResult(data: unknown): ToolResult {
  return {
    content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
  };
}

function readStringParam(params: Record<string, unknown>, key: string): string | undefined {
  const value = params[key];
  return typeof value === "string" ? value : undefined;
}

function readNumberParam(params: Record<string, unknown>, key: string): number | undefined {
  const value = params[key];
  return typeof value === "number" ? value : undefined;
}

function readBoolParam(params: Record<string, unknown>, key: string): boolean | undefined {
  const value = params[key];
  return typeof value === "boolean" ? value : undefined;
}

function readArrayParam(params: Record<string, unknown>, key: string): string[] | undefined {
  const value = params[key];
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : undefined;
}

// ─── Tool Schemas (TypeBox, no Union/anyOf) ───

export const MemoryStoreAdvancedSchema = Type.Object({
  content: Type.String({ description: "Content to store in memory" }),
  type: Type.Optional(
    Type.String({
      description:
        "Memory type: conversation, dispute, meeting, project, plan, transaction, learning, health, social, creative, knowledge, personal_note, legal, financial",
    }),
  ),
  tags: Type.Optional(Type.Array(Type.String(), { description: "Additional tags to apply" })),
  auto_classify: Type.Optional(
    Type.Boolean({
      description: "Enable AI auto-classification (default: true)",
    }),
  ),
});

export const MemorySearchAdvancedSchema = Type.Object({
  query: Type.String({ description: "Natural language search query" }),
  type: Type.Optional(Type.String({ description: "Filter by memory type" })),
  people: Type.Optional(Type.Array(Type.String(), { description: "Filter by related people" })),
  case_name: Type.Optional(Type.String({ description: "Filter by case/episode name" })),
  date_from: Type.Optional(Type.String({ description: "Start date filter (ISO 8601)" })),
  date_to: Type.Optional(Type.String({ description: "End date filter (ISO 8601)" })),
  tags: Type.Optional(Type.Array(Type.String(), { description: "Filter by tags" })),
  domain: Type.Optional(Type.String({ description: "Filter by domain" })),
  importance_min: Type.Optional(Type.Number({ description: "Minimum importance (1-10)" })),
  expand_graph: Type.Optional(
    Type.Boolean({
      description: "Enable graph-based context expansion (default: true)",
    }),
  ),
  max_results: Type.Optional(Type.Number({ description: "Maximum results to return" })),
});

export const MemoryExploreSchema = Type.Object({
  entity: Type.String({
    description: "Entity name to explore (person, case, topic, place)",
  }),
  depth: Type.Optional(Type.Number({ description: "Exploration depth (1-3, default: 2)" })),
  relationship_types: Type.Optional(
    Type.Array(Type.String(), {
      description: "Filter by specific relationship types",
    }),
  ),
  include_knowledge: Type.Optional(
    Type.Boolean({
      description: "Include knowledge base nodes (default: false)",
    }),
  ),
});

export const KnowledgeUploadSchema = Type.Object({
  content: Type.String({ description: "Knowledge content to upload" }),
  domain: Type.String({
    description:
      "Knowledge domain: daily, work, learning, health, finance, social, hobby, travel, cooking, parenting, legal, medical, realestate, technology, creative",
  }),
  source: Type.Optional(Type.String({ description: "Source of the knowledge" })),
  auto_structure: Type.Optional(
    Type.Boolean({
      description: "Auto-structure content into concept hierarchy (default: false)",
    }),
  ),
});

export const KnowledgeQuerySchema = Type.Object({
  question: Type.String({
    description: "Question to answer from the knowledge base",
  }),
  domain: Type.Optional(Type.String({ description: "Limit search to a specific domain" })),
  include_cases: Type.Optional(
    Type.Boolean({
      description: "Include related cases/episodes in results",
    }),
  ),
});

export const MemoryHubSchema = Type.Object({
  hub_type: Type.String({
    description: "Hub document type: cases, people, knowledge, domains, timeline",
  }),
  action: Type.Optional(
    Type.String({
      description: "Action: view (default) or refresh (regenerate)",
    }),
  ),
});

export const MemoryStatsSchema = Type.Object({});

// ─── Tool Factory Functions ───

export function createMemoryStoreAdvancedTool(manager: AdvancedMemoryManager) {
  return {
    label: "Advanced Memory Store",
    name: "memory_store_advanced",
    description:
      "Store information with AI auto-classification, entity extraction, and knowledge graph integration. " +
      "Automatically extracts people, places, cases/episodes, tags, emotion, and importance. " +
      "Use for storing conversations, meeting notes, project updates, dispute records, " +
      "travel plans, health logs, financial records, or any life episode.",
    parameters: MemoryStoreAdvancedSchema,
    execute: async (_toolCallId: string, params: Record<string, unknown>) => {
      const content = readStringParam(params, "content");
      if (!content) {
        return jsonResult({ error: "content is required" });
      }

      try {
        const result = await manager.store({
          content,
          type: readStringParam(params, "type") as MemoryEntryType | undefined,
          tags: readArrayParam(params, "tags"),
          autoClassify: readBoolParam(params, "auto_classify"),
        });

        return jsonResult({
          success: true,
          classification: {
            type: result.classification.type,
            entities: result.classification.entities.map((e) => ({
              name: e.name,
              type: e.type,
            })),
            tags: result.classification.tags,
            importance: result.classification.importance,
            emotion: result.classification.emotion,
            domain: result.classification.domain,
            people: result.classification.people,
            case: result.classification.case,
            place: result.classification.place,
          },
          memoryFile: result.memoryFile,
          nodeIds: result.nodeIds,
        });
      } catch (err) {
        return jsonResult({
          error: err instanceof Error ? err.message : String(err),
        });
      }
    },
  };
}

export function createMemorySearchAdvancedTool(manager: AdvancedMemoryManager) {
  return {
    label: "Advanced Memory Search",
    name: "memory_search_advanced",
    description:
      "Search memory with triple hybrid engine (vector + keyword + knowledge graph). " +
      "Supports filtering by type, people, case, date range, tags, domain, and importance. " +
      "Automatically classifies query type and adjusts search weights. " +
      "Includes graph-based context expansion for related information.",
    parameters: MemorySearchAdvancedSchema,
    execute: async (_toolCallId: string, params: Record<string, unknown>) => {
      const query = readStringParam(params, "query");
      if (!query) {
        return jsonResult({ error: "query is required" });
      }

      try {
        const filters: AdvancedSearchFilters = {};
        const type = readStringParam(params, "type");
        if (type) {
          filters.type = type as MemoryEntryType;
        }
        const people = readArrayParam(params, "people");
        if (people) {
          filters.people = people;
        }
        const caseName = readStringParam(params, "case_name");
        if (caseName) {
          filters.case = caseName;
        }
        const dateFrom = readStringParam(params, "date_from");
        if (dateFrom) {
          filters.dateFrom = dateFrom;
        }
        const dateTo = readStringParam(params, "date_to");
        if (dateTo) {
          filters.dateTo = dateTo;
        }
        const tags = readArrayParam(params, "tags");
        if (tags) {
          filters.tags = tags;
        }
        const domain = readStringParam(params, "domain");
        if (domain) {
          filters.domain = domain as DomainType;
        }
        const importanceMin = readNumberParam(params, "importance_min");
        if (importanceMin != null) {
          filters.importanceMin = importanceMin;
        }

        const results = await manager.search({
          query,
          filters: Object.keys(filters).length > 0 ? filters : undefined,
          expandGraph: readBoolParam(params, "expand_graph"),
          limit: readNumberParam(params, "max_results"),
        });

        return jsonResult({
          results: results.map((r) => ({
            path: r.path,
            startLine: r.startLine,
            endLine: r.endLine,
            score: Math.round(r.score * 1000) / 1000,
            snippet: r.snippet,
            type: r.type,
            people: r.people,
            case: r.case,
            tags: r.tags,
            importance: r.importance,
            graphScore: r.graphScore,
            vectorScore: r.vectorScore,
            bm25Score: r.bm25Score,
          })),
          count: results.length,
        });
      } catch (err) {
        return jsonResult({
          results: [],
          error: err instanceof Error ? err.message : String(err),
        });
      }
    },
  };
}

export function createMemoryExploreTool(manager: AdvancedMemoryManager) {
  return {
    label: "Memory Graph Explore",
    name: "memory_explore",
    description:
      "Explore the knowledge graph starting from a specific entity (person, case, topic, place). " +
      "Shows connected entities, relationships, and related documents. " +
      "Use to understand connections between people, cases, and information.",
    parameters: MemoryExploreSchema,
    execute: async (_toolCallId: string, params: Record<string, unknown>) => {
      const entity = readStringParam(params, "entity");
      if (!entity) {
        return jsonResult({ error: "entity is required" });
      }

      try {
        const result = manager.explore({
          entity,
          depth: readNumberParam(params, "depth"),
          relationshipTypes: readArrayParam(params, "relationship_types"),
          includeKnowledge: readBoolParam(params, "include_knowledge"),
        });

        if (!result) {
          return jsonResult({
            found: false,
            message: `Entity "${entity}" not found in knowledge graph`,
          });
        }

        return jsonResult({
          found: true,
          centerNode: {
            name: result.centerNode.name,
            type: result.centerNode.type,
            importance: result.centerNode.importance,
            status: result.centerNode.status,
          },
          connectedNodes: result.connectedNodes.map((cn) => ({
            name: cn.node.name,
            type: cn.node.type,
            relationship: cn.relationship,
            direction: cn.direction,
            depth: cn.depth,
          })),
          relatedDocuments: result.relatedDocuments.map((doc) => ({
            path: doc.path,
            type: doc.type,
            snippet: doc.snippet,
          })),
        });
      } catch (err) {
        return jsonResult({
          error: err instanceof Error ? err.message : String(err),
        });
      }
    },
  };
}

export function createKnowledgeUploadTool(manager: AdvancedMemoryManager) {
  return {
    label: "Knowledge Upload",
    name: "knowledge_upload",
    description:
      "Upload professional knowledge to the structured knowledge base. " +
      "Supports all domains: cooking, programming, law, health, finance, etc. " +
      "Knowledge is automatically categorized, linked to the knowledge graph, " +
      "and made searchable with semantic and graph-based queries.",
    parameters: KnowledgeUploadSchema,
    execute: async (_toolCallId: string, params: Record<string, unknown>) => {
      const content = readStringParam(params, "content");
      const domain = readStringParam(params, "domain");
      if (!content || !domain) {
        return jsonResult({ error: "content and domain are required" });
      }

      try {
        const result = await manager.uploadKnowledge({
          content,
          domain: domain as DomainType,
          source: readStringParam(params, "source"),
          autoStructure: readBoolParam(params, "auto_structure"),
        });

        return jsonResult({
          success: true,
          files: result.files,
          nodeIds: result.nodeIds,
        });
      } catch (err) {
        return jsonResult({
          error: err instanceof Error ? err.message : String(err),
        });
      }
    },
  };
}

export function createKnowledgeQueryTool(manager: AdvancedMemoryManager) {
  return {
    label: "Knowledge Query",
    name: "knowledge_query",
    description:
      "Query the knowledge base for specific information across all domains. " +
      "Searches structured knowledge documents with concept hierarchy awareness. " +
      "Optionally includes related cases/episodes for practical context.",
    parameters: KnowledgeQuerySchema,
    execute: async (_toolCallId: string, params: Record<string, unknown>) => {
      const question = readStringParam(params, "question");
      if (!question) {
        return jsonResult({ error: "question is required" });
      }

      try {
        const results = manager.queryKnowledge({
          question,
          domain: readStringParam(params, "domain") as DomainType | undefined,
          includeCases: readBoolParam(params, "include_cases"),
        });

        return jsonResult({
          results: results.map((r) => ({
            path: r.path,
            score: Math.round(r.score * 1000) / 1000,
            snippet: r.snippet,
            type: r.type,
            linkedNodes: r.linkedNodes,
          })),
          count: results.length,
        });
      } catch (err) {
        return jsonResult({
          results: [],
          error: err instanceof Error ? err.message : String(err),
        });
      }
    },
  };
}

export function createMemoryHubTool(manager: AdvancedMemoryManager) {
  return {
    label: "Memory Hub",
    name: "memory_hub",
    description:
      "Access hub (index) documents that provide organized overviews of all memory. " +
      "Hub types: cases (all life episodes), people (known contacts), " +
      "knowledge (knowledge base index), domains (distribution), timeline (chronological).",
    parameters: MemoryHubSchema,
    execute: async (_toolCallId: string, params: Record<string, unknown>) => {
      const hubType = readStringParam(params, "hub_type");
      if (!hubType) {
        return jsonResult({ error: "hub_type is required" });
      }

      try {
        const action = readStringParam(params, "action") ?? "view";

        if (action === "refresh") {
          const files = await manager.refreshAllHubs();
          return jsonResult({
            action: "refresh",
            hubsRefreshed: files.length,
            content: manager.getHub(hubType as HubType),
          });
        }

        const content = manager.getHub(hubType as HubType);
        return jsonResult({ hubType, content });
      } catch (err) {
        return jsonResult({
          error: err instanceof Error ? err.message : String(err),
        });
      }
    },
  };
}

export function createMemoryStatsTool(manager: AdvancedMemoryManager) {
  return {
    label: "Memory Stats",
    name: "memory_stats",
    description:
      "Get comprehensive statistics about the memory system: " +
      "total nodes, edges, documents, domain distribution, " +
      "recent activity, and most connected entities.",
    parameters: MemoryStatsSchema,
    execute: async (_toolCallId: string, _params: Record<string, unknown>) => {
      try {
        const stats = manager.getStats();
        return jsonResult(stats);
      } catch (err) {
        return jsonResult({
          error: err instanceof Error ? err.message : String(err),
        });
      }
    },
  };
}

/**
 * Create all advanced memory tools.
 */
export function createAdvancedMemoryTools(manager: AdvancedMemoryManager) {
  return [
    createMemoryStoreAdvancedTool(manager),
    createMemorySearchAdvancedTool(manager),
    createMemoryExploreTool(manager),
    createKnowledgeUploadTool(manager),
    createKnowledgeQueryTool(manager),
    createMemoryHubTool(manager),
    createMemoryStatsTool(manager),
  ];
}
