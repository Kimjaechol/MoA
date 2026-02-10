export type { MemoryIndexManager, MemorySearchResult } from "./manager.js";
export { getMemorySearchManager, type MemorySearchManagerResult } from "./search-manager.js";

// Advanced memory system
export { AdvancedMemoryManager } from "./advanced/index.js";
export type {
  AdvancedMemoryConfig,
  ClassifyFunction,
  AdvancedSearchFilters,
  AdvancedSearchResult,
  GraphExploreResult,
  MemoryStats,
  HubType,
} from "./advanced/index.js";
export {
  getAdvancedMemoryManager,
  enhanceSearchResults,
  enrichIndexedFile,
} from "./advanced/integration.js";
export { createAdvancedMemoryTools } from "./advanced/tools.js";
