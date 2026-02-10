/**
 * MoA Advanced Memory v2 — Public Exports
 *
 * 2-Layer architecture:
 *   Layer 1: Markdown + YAML metadata + [[links]] (metadata = classification)
 *   Layer 2: Vector + keyword search + metadata filter + link traversal
 */

// Types
export type {
  MemoryEntryType,
  EmotionType,
  EntryStatus,
  DomainType,
  PersonEntry,
  ExtractedMetadata,
  ChunkMetadataRow,
  AdvancedSearchFilters,
  AdvancedSearchResult,
  HubType,
  MemoryStats,
  AdvancedMemoryConfig,
} from "./types.js";

// Schema
export { ensureAdvancedSchema } from "./schema.js";

// Frontmatter
export {
  parseFrontmatter,
  serializeFrontmatter,
  extractInternalLinks,
  extractLinkTargets,
  autoLinkEntities,
  frontmatterToMetadata,
} from "./frontmatter.js";

// Metadata extraction
export { extractMetadata, extractPeople } from "./metadata-extractor.js";

// Backlinks
export {
  findBacklinks,
  findOutgoingLinks,
  findCoOccurringPeople,
  expandViaLinks,
} from "./backlinks.js";

// Time decay
export { applyTimeDecay, recencyScore, touchAccessedChunks } from "./time-decay.js";

// Search enhancement
export {
  buildMetadataFilter,
  getFilteredChunkIds,
  enhanceSearchResults,
  getMemoryStats,
} from "./search-enhancer.js";

// Integration
export { enrichIndexedFile } from "./integration.js";

// Tools
export { createAdvancedMemoryTools } from "./tools.js";
