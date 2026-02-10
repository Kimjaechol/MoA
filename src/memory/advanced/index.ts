/**
 * MoA Advanced Memory System
 *
 * A 4-layer hybrid memory architecture that extends OpenClaw's basic memory
 * with knowledge graph, auto-classification, and triple hybrid search.
 *
 * Layer 1: Obsidian-style structured storage (Markdown + YAML + [[links]])
 * Layer 2: AI-based auto-classification & tagging (7-dimension taxonomy)
 * Layer 3: Knowledge Graph (SQLite nodes + edges + traversal)
 * Layer 4: Triple hybrid search (vector + BM25 + graph fusion)
 */

export { AdvancedMemoryManager } from "./manager.js";
export type { AdvancedMemoryConfig, ClassifyFunction } from "./manager.js";

// Types
export type {
  MemoryEntryType,
  EmotionType,
  EntryStatus,
  DomainType,
  MemoryFrontmatter,
  NodeType,
  GraphNode,
  GraphEdge,
  TagEntry,
  ExtractedEntity,
  ExtractedRelationship,
  ClassificationResult,
  AdvancedSearchFilters,
  AdvancedSearchResult,
  GraphExploreResult,
  HubType,
  KnowledgeUploadRequest,
  MemoryStats,
  SearchWeightProfile,
  SearchQueryType,
} from "./types.js";

// Graph operations (for direct access)
export {
  upsertNode,
  upsertEdge,
  ensureTag,
  tagNode,
  getNode,
  findNodeByName,
  searchNodes,
  getEdgesForNode,
  getNodeTags,
  getPopularTags,
  exploreGraph,
  searchGraphForChunks,
  getMemoryStats,
  upsertChunkMetadata,
  deleteNode,
} from "./graph.js";

// Classification
export {
  buildClassificationPrompt,
  parseClassificationResponse,
  classifyWithRules,
} from "./classifier.js";

// Frontmatter
export {
  parseFrontmatter,
  serializeFrontmatter,
  extractInternalLinks,
  extractExternalLinks,
  autoLinkEntities,
} from "./frontmatter.js";

// Search
export {
  classifyQueryType,
  getSearchWeights,
  mergeTripleResults,
  expandSearchContext,
  applyFilters,
} from "./hybrid-search.js";

// Hub documents
export { generateHubDocument } from "./hub-generator.js";

// Schema
export { ensureAdvancedMemorySchema } from "./graph-schema.js";
