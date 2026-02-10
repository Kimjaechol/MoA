export type { MemoryIndexManager, MemorySearchResult } from "./manager.js";
export { getMemorySearchManager, type MemorySearchManagerResult } from "./search-manager.js";

// Advanced memory v2: metadata-based classification + link-based relationships
export type {
  AdvancedSearchFilters,
  AdvancedSearchResult,
  MemoryStats,
  HubType,
  PersonEntry,
  ExtractedMetadata,
} from "./advanced/index.js";
export { enrichIndexedFile } from "./advanced/integration.js";
export { createAdvancedMemoryTools } from "./advanced/tools.js";
export { enhanceSearchResults, getMemoryStats } from "./advanced/search-enhancer.js";
