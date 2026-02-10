/**
 * MoA Advanced Memory System - Core Types
 *
 * Defines the type system for the 4-layer hybrid memory architecture:
 * Layer 1: Obsidian-style structured storage
 * Layer 2: AI-based auto-classification & tagging
 * Layer 3: Knowledge Graph (nodes, edges, traversal)
 * Layer 4: Hybrid search (vector + BM25 + graph fusion)
 */

// ─── Memory Document Types ───

/** All possible memory entry types (종류 분류) */
export type MemoryEntryType =
  | "conversation" // 대화 기록
  | "dispute" // 분쟁·갈등
  | "meeting" // 회의·미팅
  | "project" // 프로젝트
  | "plan" // 계획
  | "transaction" // 거래
  | "learning" // 학습
  | "health" // 건강·운동
  | "social" // 사회적 관계
  | "creative" // 창작 활동
  | "knowledge" // 전문지식
  | "personal_note" // 개인 메모
  | "legal" // 법률 사건
  | "financial"; // 재무·투자

/** Emotion categories detected in content */
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

/** Status of a memory entry or case */
export type EntryStatus = "active" | "archived" | "resolved";

/** Life/professional domain categories */
export type DomainType =
  | "daily" // 일상
  | "work" // 업무
  | "learning" // 학습
  | "health" // 건강
  | "finance" // 재무
  | "social" // 사회관계
  | "hobby" // 취미
  | "travel" // 여행
  | "cooking" // 요리
  | "parenting" // 육아
  | "legal" // 법률
  | "medical" // 의료
  | "realestate" // 부동산
  | "technology" // 기술
  | "creative"; // 창작

// ─── YAML Frontmatter ───

/** YAML frontmatter for structured memory documents */
export type MemoryFrontmatter = {
  id: string;
  type: MemoryEntryType;
  created: string; // ISO 8601
  updated: string; // ISO 8601
  people?: string[];
  case?: string;
  place?: string;
  tags?: string[];
  importance?: number; // 1-10
  status?: EntryStatus;
  emotion?: EmotionType;
  domain?: DomainType;
  deadline?: string; // ISO 8601
  links_to?: Array<{ url: string; title: string }>;
  parent?: string; // for knowledge hierarchy
  children?: string[];
  source?: string;
  confidence?: number; // 0.0-1.0
};

// ─── Knowledge Graph Types ───

/** Node (entity) types in the knowledge graph */
export type NodeType =
  | "person"
  | "organization"
  | "case"
  | "topic"
  | "place"
  | "document"
  | "concept"
  | "event"
  | "knowledge";

/** A node in the knowledge graph */
export type GraphNode = {
  id: string;
  name: string;
  type: NodeType;
  subtype?: string;
  createdAt: string;
  updatedAt: string;
  importance: number;
  status: EntryStatus;
  confidence: number;
  memoryFile?: string;
  source?: string;
  properties: Record<string, unknown>;
  validFrom?: string;
  validTo?: string;
};

/** An edge (relationship) in the knowledge graph */
export type GraphEdge = {
  id: string;
  fromNode: string;
  toNode: string;
  relationship: string;
  createdAt: string;
  updatedAt: string;
  weight: number;
  confidence: number;
  properties: Record<string, unknown>;
  validFrom?: string;
  validTo?: string;
  sourceMemory?: string;
};

/** A tag entry */
export type TagEntry = {
  id: number;
  tag: string;
  category?: string;
  usageCount: number;
  createdAt: string;
};

// ─── Auto-Classification Types ───

/** Entity extracted from content by AI */
export type ExtractedEntity = {
  id: string;
  name: string;
  type: NodeType;
  isNew: boolean;
};

/** Relationship extracted from content by AI */
export type ExtractedRelationship = {
  from: string;
  to: string;
  type: string;
};

/** Result of AI auto-classification */
export type ClassificationResult = {
  type: MemoryEntryType;
  entities: ExtractedEntity[];
  relationships: ExtractedRelationship[];
  tags: string[];
  importance: number;
  emotion?: EmotionType;
  domain?: DomainType;
  temporal?: {
    eventDate?: string;
    deadline?: string;
  };
  suggestedLinks?: string[];
  people?: string[];
  case?: string;
  place?: string;
};

// ─── Search Types ───

/** Search query weight profile */
export type SearchWeightProfile = {
  vector: number;
  bm25: number;
  graph: number;
};

/** Search query type classification */
export type SearchQueryType =
  | "entity_query" // 특정 인물/사건 조회
  | "semantic_query" // 의미 기반 검색
  | "temporal_query" // 시간 기반 검색
  | "exact_query" // 정확한 키워드 검색
  | "knowledge_query"; // 전문지식 검색

/** Search weight profiles for different query types */
export const SEARCH_WEIGHT_PROFILES: Record<SearchQueryType, SearchWeightProfile> = {
  entity_query: { vector: 0.2, bm25: 0.2, graph: 0.6 },
  semantic_query: { vector: 0.6, bm25: 0.2, graph: 0.2 },
  temporal_query: { vector: 0.3, bm25: 0.3, graph: 0.4 },
  exact_query: { vector: 0.1, bm25: 0.5, graph: 0.4 },
  knowledge_query: { vector: 0.5, bm25: 0.2, graph: 0.3 },
};

/** Advanced memory search filters */
export type AdvancedSearchFilters = {
  type?: MemoryEntryType;
  people?: string[];
  case?: string;
  dateFrom?: string;
  dateTo?: string;
  tags?: string[];
  domain?: DomainType;
  importanceMin?: number;
  status?: EntryStatus;
};

/** Advanced search result with graph context */
export type AdvancedSearchResult = {
  path: string;
  startLine: number;
  endLine: number;
  score: number;
  snippet: string;
  source: string;
  // advanced metadata
  type?: MemoryEntryType;
  people?: string[];
  case?: string;
  place?: string;
  tags?: string[];
  importance?: number;
  linkedNodes?: string[];
  graphScore?: number;
  vectorScore?: number;
  bm25Score?: number;
};

/** Graph exploration result */
export type GraphExploreResult = {
  centerNode: GraphNode;
  connectedNodes: Array<{
    node: GraphNode;
    relationship: string;
    direction: "outgoing" | "incoming";
    depth: number;
  }>;
  relatedDocuments: Array<{
    path: string;
    type: MemoryEntryType;
    snippet: string;
  }>;
};

// ─── Hub Document Types ───

/** Hub document type for index generation */
export type HubType = "cases" | "people" | "knowledge" | "domains" | "timeline";

/** Entry in a hub index */
export type HubIndexEntry = {
  name: string;
  type: string;
  linkedEntities: string[];
  summary: string;
  lastActivity: string;
  status: EntryStatus;
};

// ─── Knowledge Upload Types ───

/** Knowledge document hierarchy level */
export type KnowledgeLevel = "core_concept" | "detail" | "example" | "practice";

/** Knowledge upload request */
export type KnowledgeUploadRequest = {
  content: string;
  domain: DomainType;
  source?: string;
  autoStructure?: boolean;
};

// ─── Memory Stats Types ───

export type MemoryStats = {
  totalNodes: number;
  totalEdges: number;
  totalDocuments: number;
  totalTags: number;
  nodesByType: Record<string, number>;
  documentsByType: Record<string, number>;
  domainDistribution: Record<string, number>;
  recentActivity: Array<{
    date: string;
    entries: number;
  }>;
  topConnectedNodes: Array<{
    name: string;
    type: string;
    connections: number;
  }>;
};
