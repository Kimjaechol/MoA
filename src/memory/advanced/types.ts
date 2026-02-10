/**
 * MoA Advanced Memory System v2 — Core Types
 *
 * 2-Layer architecture:
 *   Layer 1: Structured storage (Markdown + YAML metadata + [[links]])
 *   Layer 2: Unified search (metadata filter → vector → FTS5 → link traversal)
 *
 * Key principle: "Data describes itself"
 *   - Metadata = classification (no separate LLM classification step)
 *   - [[Internal links]] = relationships (no separate graph DB)
 *   - Backlinks = reverse relationships (automatic)
 */

// ─── Memory Entry Types ───

export type MemoryEntryType =
  | "conversation"
  | "dispute"
  | "meeting"
  | "project"
  | "plan"
  | "transaction"
  | "learning"
  | "health"
  | "social"
  | "creative"
  | "knowledge"
  | "personal_note"
  | "legal"
  | "financial";

export type EmotionType =
  | "happy"
  | "grateful"
  | "excited"
  | "neutral"
  | "tired"
  | "frustrated"
  | "angry"
  | "anxious"
  | "sad";

export type EntryStatus = "active" | "resolved" | "archived";

export type DomainType =
  | "daily"
  | "work"
  | "learning"
  | "health"
  | "finance"
  | "social"
  | "hobby"
  | "travel"
  | "cooking"
  | "parenting"
  | "legal"
  | "medical"
  | "realestate"
  | "technology"
  | "creative";

// ─── Person with Disambiguation ───

/** Person entry with identifying info to prevent name collision */
export interface PersonEntry {
  name: string;
  identifier?: string; // e.g. "옆집, 40대, 정원 관리" or "개발팀, 1990년생"
}

// ─── Extracted Metadata ───

/** Result of regex + SLM metadata extraction pipeline */
export interface ExtractedMetadata {
  type?: MemoryEntryType;
  people: PersonEntry[];
  place?: string;
  tags: string[];
  importance: number;
  emotion?: EmotionType;
  emotionRaw?: string; // Original emotional expression from the text (verbatim quote)
  domain?: DomainType;
  status: EntryStatus;
  caseRef?: string;
  deadline?: string;
  eventDate?: string;
}

// ─── Chunk Metadata (stored in memory.db) ───

export interface ChunkMetadataRow {
  id: string;
  memoryFile: string;
  chunkIndex: number;
  content: string;
  type: string | null;
  caseRef: string | null;
  place: string | null;
  tags: string | null; // JSON array
  importance: number;
  status: string;
  emotion: string | null;
  emotionRaw: string | null; // Original emotional expression from the text
  domain: string | null;
  people: string | null; // JSON array of PersonEntry
  createdAt: string;
  updatedAt: string;
  lastAccessed: string | null;
  accessCount: number;
  outgoingLinks: string | null; // JSON array of link targets
}

// ─── Search Types ───

export interface AdvancedSearchFilters {
  type?: MemoryEntryType;
  people?: string[];
  caseRef?: string;
  dateFrom?: string;
  dateTo?: string;
  tags?: string[];
  domain?: DomainType;
  importanceMin?: number;
  status?: EntryStatus;
}

export interface AdvancedSearchResult {
  chunkId: string;
  memoryFile: string;
  content: string;
  score: number;
  type?: string;
  people?: PersonEntry[];
  tags?: string[];
  caseRef?: string;
  place?: string;
  emotion?: string;
  emotionRaw?: string; // Original emotional expression from the text
  domain?: string;
  importance?: number;
  createdAt?: string;
  linkedFrom?: string[]; // backlink sources (files that link to this)
}

// ─── Hub Document Types ───

export type HubType = "cases" | "people" | "knowledge" | "domains" | "timeline";

// ─── Memory Statistics ───

export interface MemoryStats {
  totalDocuments: number;
  totalChunks: number;
  totalLinks: number;
  totalBacklinks: number;
  documentsByType: Record<string, number>;
  documentsByDomain: Record<string, number>;
  documentsByStatus: Record<string, number>;
  topPeople: Array<{ name: string; count: number }>;
  topTags: Array<{ tag: string; count: number }>;
}

// ─── Manager Config ───

export interface AdvancedMemoryConfig {
  workspaceDir: string;
  dbPath: string;
}
