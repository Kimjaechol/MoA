/**
 * MoA Advanced Memory System - Main Manager
 *
 * Orchestrates the 4-layer memory architecture:
 * 1. Obsidian-style structured storage
 * 2. AI-based auto-classification & tagging
 * 3. Knowledge graph operations
 * 4. Triple hybrid search (vector + BM25 + graph)
 *
 * Integrates with the existing OpenClaw MemoryIndexManager for
 * backward compatibility while adding advanced features.
 */

import type { DatabaseSync } from "node:sqlite";
import { randomUUID } from "node:crypto";
import fsSync from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import type {
  AdvancedSearchFilters,
  AdvancedSearchResult,
  ClassificationResult,
  DomainType,
  GraphExploreResult,
  HubType,
  KnowledgeUploadRequest,
  MemoryEntryType,
  MemoryFrontmatter,
  MemoryStats,
  SearchWeightProfile,
} from "./types.js";
import { createSubsystemLogger } from "../../logging/subsystem.js";
import {
  buildClassificationPrompt,
  parseClassificationResponse,
  classifyWithRules,
} from "./classifier.js";
import { parseFrontmatter, extractInternalLinks, serializeFrontmatter } from "./frontmatter.js";
import { ensureAdvancedMemorySchema } from "./graph-schema.js";
import {
  upsertNode,
  upsertEdge,
  ensureTag,
  tagNode,
  exploreGraph,
  searchGraphForChunks,
  getMemoryStats,
  upsertChunkMetadata,
  findNodeByName,
  searchNodes,
} from "./graph.js";
import { generateHubDocument } from "./hub-generator.js";
import {
  classifyQueryType,
  getSearchWeights,
  mergeTripleResults,
  expandSearchContext,
  applyFilters,
} from "./hybrid-search.js";

const log = createSubsystemLogger("memory-advanced");

// ─── Types ───

export type AdvancedMemoryConfig = {
  /** User ID for multi-user isolation */
  userId?: string;
  /** Base directory for structured memory storage */
  memoryBaseDir: string;
  /** Path to the graph database (SQLite) */
  graphDbPath?: string;
  /** Enable AI-based auto-classification (requires LLM) */
  autoClassify?: boolean;
  /** Enable context expansion in search results */
  contextExpansion?: boolean;
  /** Maximum context expansion results */
  maxExpansionResults?: number;
  /** Custom search weight overrides */
  searchWeights?: Partial<SearchWeightProfile>;
};

export type ClassifyFunction = (prompt: string) => Promise<string>;

/**
 * AdvancedMemoryManager extends the existing memory system with
 * knowledge graph, auto-classification, and triple hybrid search.
 */
export class AdvancedMemoryManager {
  private readonly config: Required<AdvancedMemoryConfig>;
  private graphDb: DatabaseSync | null = null;
  private classifyFn: ClassifyFunction | null = null;
  private initialized = false;

  constructor(config: AdvancedMemoryConfig) {
    this.config = {
      userId: config.userId ?? "default",
      memoryBaseDir: config.memoryBaseDir,
      graphDbPath: config.graphDbPath ?? path.join(config.memoryBaseDir, "_meta", "graph.db"),
      autoClassify: config.autoClassify ?? true,
      contextExpansion: config.contextExpansion ?? true,
      maxExpansionResults: config.maxExpansionResults ?? 5,
      searchWeights: config.searchWeights ?? {},
    };
  }

  // ─── Initialization ───

  /**
   * Initialize the advanced memory system.
   * Creates directory structure and sets up the graph database.
   * Must be called before any other operations.
   */
  async initialize(params?: {
    /** Existing SQLite database to extend (from OpenClaw MemoryIndexManager) */
    existingDb?: DatabaseSync;
    /** LLM function for auto-classification */
    classifyFn?: ClassifyFunction;
  }): Promise<void> {
    if (this.initialized) {
      return;
    }

    // Use existing DB or create new one for graph
    if (params?.existingDb) {
      this.graphDb = params.existingDb;
    } else {
      const { requireNodeSqlite } = await import("../sqlite.js");
      const { DatabaseSync } = requireNodeSqlite();
      const dbDir = path.dirname(this.config.graphDbPath);
      fsSync.mkdirSync(dbDir, { recursive: true });
      this.graphDb = new DatabaseSync(this.config.graphDbPath);
    }

    // Set up the advanced schema (safe to call multiple times)
    ensureAdvancedMemorySchema(this.graphDb);

    // Set LLM classification function
    if (params?.classifyFn) {
      this.classifyFn = params.classifyFn;
    }

    // Ensure directory structure
    await this.ensureDirectoryStructure();

    this.initialized = true;
    log.info("Advanced memory system initialized", {
      userId: this.config.userId,
      baseDir: this.config.memoryBaseDir,
      autoClassify: this.config.autoClassify,
    });
  }

  // ─── Memory Store ───

  /**
   * Store new content into the advanced memory system.
   * Automatically classifies, tags, extracts entities, and updates the graph.
   */
  async store(params: {
    content: string;
    type?: MemoryEntryType;
    tags?: string[];
    autoClassify?: boolean;
    sourceFile?: string;
  }): Promise<{
    classification: ClassificationResult;
    memoryFile: string;
    nodeIds: string[];
  }> {
    this.ensureInitialized();

    // Step 1: Classify content
    const shouldClassify = params.autoClassify ?? this.config.autoClassify;
    let classification: ClassificationResult;

    if (shouldClassify && this.classifyFn) {
      classification = await this.classifyWithLLM(params.content);
    } else {
      classification = classifyWithRules(params.content);
    }

    // Override with explicit type/tags if provided
    if (params.type) {
      classification.type = params.type;
    }
    if (params.tags) {
      classification.tags = [...new Set([...classification.tags, ...params.tags])];
    }

    // Step 2: Create/update entities in the graph
    const nodeIds = this.processEntities(classification);

    // Step 3: Create relationships in the graph
    this.processRelationships(classification);

    // Step 4: Process tags
    this.processTags(classification, nodeIds);

    // Step 5: Generate structured markdown file
    const memoryFile =
      params.sourceFile ?? (await this.createMemoryDocument(params.content, classification));

    log.info("Memory stored", {
      type: classification.type,
      entities: classification.entities.length,
      relationships: classification.relationships.length,
      tags: classification.tags.length,
      file: memoryFile,
    });

    return { classification, memoryFile, nodeIds };
  }

  /**
   * Index an existing chunk with advanced metadata.
   * Called by the sync pipeline for each indexed chunk.
   */
  indexChunk(params: {
    chunkId: string;
    memoryFile: string;
    content: string;
    classification?: ClassificationResult;
  }): void {
    this.ensureInitialized();
    const db = this.graphDb!;

    // Use provided classification or do rule-based
    const classification = params.classification ?? classifyWithRules(params.content);

    // Extract entities from chunk and get node IDs
    const nodeIds = this.processEntities(classification);
    this.processRelationships(classification);
    this.processTags(classification, nodeIds);

    // Store chunk metadata
    upsertChunkMetadata(db, {
      chunkId: params.chunkId,
      memoryFile: params.memoryFile,
      type: classification.type,
      createdAt: classification.temporal?.eventDate ?? new Date().toISOString(),
      people: classification.people,
      caseRef: classification.case,
      place: classification.place,
      tags: classification.tags,
      importance: classification.importance,
      domain: classification.domain,
      emotion: classification.emotion,
      linkedNodes: nodeIds,
    });
  }

  /**
   * Index a file with frontmatter-based metadata.
   * Parses YAML frontmatter and [[links]] for graph construction.
   */
  async indexFileWithFrontmatter(params: {
    filePath: string;
    content: string;
    chunkIds: string[];
  }): Promise<void> {
    this.ensureInitialized();
    const db = this.graphDb!;

    const { frontmatter, body } = parseFrontmatter(params.content);
    const internalLinks = extractInternalLinks(body);

    // Process frontmatter metadata
    if (frontmatter) {
      // Create case node if specified
      if (frontmatter.case) {
        const caseNode = upsertNode(db, {
          name: frontmatter.case,
          type: "case",
          importance: frontmatter.importance ?? 5,
          status: frontmatter.status ?? "active",
          memoryFile: params.filePath,
        });

        // Link people to case
        if (frontmatter.people) {
          for (const person of frontmatter.people) {
            const personNode = upsertNode(db, { name: person, type: "person" });
            upsertEdge(db, {
              fromNode: personNode.id,
              toNode: caseNode.id,
              relationship: "involved_in",
              sourceMemory: params.filePath,
            });
          }
        }

        // Link place to case
        if (frontmatter.place) {
          const placeNode = upsertNode(db, { name: frontmatter.place, type: "place" });
          upsertEdge(db, {
            fromNode: caseNode.id,
            toNode: placeNode.id,
            relationship: "located_at",
            sourceMemory: params.filePath,
          });
        }
      }

      // Process tags from frontmatter
      if (frontmatter.tags) {
        for (const tag of frontmatter.tags) {
          ensureTag(db, tag, frontmatter.domain ?? frontmatter.type);
        }
      }

      // Update chunk metadata for all chunks in this file
      for (const chunkId of params.chunkIds) {
        upsertChunkMetadata(db, {
          chunkId,
          memoryFile: params.filePath,
          type: frontmatter.type,
          createdAt: frontmatter.created,
          people: frontmatter.people,
          caseRef: frontmatter.case,
          place: frontmatter.place,
          tags: frontmatter.tags,
          importance: frontmatter.importance,
          domain: frontmatter.domain,
          emotion: frontmatter.emotion,
          frontmatter: frontmatter as Record<string, unknown>,
        });
      }
    }

    // Process [[internal links]]
    for (const link of internalLinks) {
      // Try to find or create a node for each link target
      const existing = findNodeByName(db, link.target);
      if (!existing) {
        upsertNode(db, {
          name: link.target,
          type: "topic",
          confidence: 0.7,
          source: params.filePath,
        });
      }
    }
  }

  // ─── Advanced Search ───

  /**
   * Perform a triple hybrid search: vector + BM25 + graph.
   * Extends the existing MemoryIndexManager.search() with graph traversal.
   */
  async search(params: {
    query: string;
    vectorResults?: Array<{
      id: string;
      path: string;
      startLine: number;
      endLine: number;
      score: number;
      snippet: string;
      source: string;
    }>;
    keywordResults?: Array<{
      id: string;
      path: string;
      startLine: number;
      endLine: number;
      score: number;
      snippet: string;
      source: string;
      textScore: number;
    }>;
    filters?: AdvancedSearchFilters;
    expandGraph?: boolean;
    limit?: number;
    customWeights?: Partial<SearchWeightProfile>;
  }): Promise<AdvancedSearchResult[]> {
    this.ensureInitialized();
    const db = this.graphDb!;

    // Step 1: Classify query type for weight optimization
    const queryType = classifyQueryType(params.query);
    const weights = getSearchWeights(queryType, params.customWeights ?? this.config.searchWeights);

    // Step 2: Perform graph search
    const graphResults = searchGraphForChunks(db, {
      query: params.query,
      filters: params.filters
        ? {
            type: params.filters.type,
            people: params.filters.people,
            case: params.filters.case,
            dateFrom: params.filters.dateFrom,
            dateTo: params.filters.dateTo,
            tags: params.filters.tags,
            domain: params.filters.domain,
            importanceMin: params.filters.importanceMin,
          }
        : undefined,
      limit: params.limit ?? 20,
    });

    // Step 3: Merge all three result sets
    const merged = mergeTripleResults({
      vector: params.vectorResults ?? [],
      keyword: params.keywordResults ?? [],
      graph: graphResults,
      weights,
      db,
    });

    // Step 4: Apply post-merge filters
    let results = params.filters ? applyFilters(merged, params.filters) : merged;

    // Step 5: Context expansion
    const shouldExpand = params.expandGraph ?? this.config.contextExpansion;
    if (shouldExpand && results.length > 0) {
      results = expandSearchContext(db, results, this.config.maxExpansionResults);
    }

    // Step 6: Limit results
    const limit = params.limit ?? 10;
    return results.slice(0, limit);
  }

  // ─── Graph Exploration ───

  /**
   * Explore the knowledge graph from a specific entity.
   */
  explore(params: {
    entity: string;
    depth?: number;
    relationshipTypes?: string[];
    includeKnowledge?: boolean;
  }): GraphExploreResult | null {
    this.ensureInitialized();
    return exploreGraph(this.graphDb!, {
      nodeName: params.entity,
      depth: params.depth,
      relationshipTypes: params.relationshipTypes,
      includeKnowledge: params.includeKnowledge,
    });
  }

  // ─── Knowledge Management ───

  /**
   * Upload and structure knowledge content.
   */
  async uploadKnowledge(request: KnowledgeUploadRequest): Promise<{
    files: string[];
    nodeIds: string[];
  }> {
    this.ensureInitialized();
    const db = this.graphDb!;

    // Create a knowledge node
    const knowledgeNode = upsertNode(db, {
      name: generateKnowledgeTitle(request.content),
      type: "knowledge",
      properties: { domain: request.domain },
      source: request.source,
    });

    // Create domain tag
    const domainTagId = ensureTag(db, request.domain, "domain");
    tagNode(db, knowledgeNode.id, domainTagId);

    // Create a knowledge markdown file
    const fileName = slugify(knowledgeNode.name);
    const filePath = path.join(
      this.config.memoryBaseDir,
      "knowledge",
      request.domain,
      `${fileName}.md`,
    );

    const frontmatter: Partial<MemoryFrontmatter> = {
      id: knowledgeNode.id,
      type: "knowledge",
      domain: request.domain,
      created: new Date().toISOString(),
      updated: new Date().toISOString(),
      source: request.source,
      tags: [request.domain],
    };

    const markdown = serializeFrontmatter(frontmatter, request.content);

    // Ensure directory exists
    const dir = path.dirname(filePath);
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(filePath, markdown, "utf-8");

    // If auto-structuring is requested and LLM is available, extract sub-concepts
    if (request.autoStructure && this.classifyFn) {
      // Auto-structuring would require more sophisticated LLM-based analysis
      // For now, classify the content and link appropriately
      const classification = await this.classifyWithLLM(request.content);
      this.processEntities(classification);
      this.processRelationships(classification);
    }

    const relPath = path.relative(this.config.memoryBaseDir, filePath);

    return { files: [relPath], nodeIds: [knowledgeNode.id] };
  }

  /**
   * Query knowledge base for specific information.
   */
  queryKnowledge(params: {
    question: string;
    domain?: DomainType;
    includeCases?: boolean;
  }): AdvancedSearchResult[] {
    this.ensureInitialized();
    const db = this.graphDb!;

    // Search knowledge nodes specifically
    searchNodes(db, {
      type: "knowledge",
      namePattern: params.question,
      limit: 10,
    });

    // Search chunk metadata for knowledge-type entries
    const results = searchGraphForChunks(db, {
      query: params.question,
      filters: {
        type: "knowledge",
        domain: params.domain,
      },
      limit: 10,
    });

    // Convert to AdvancedSearchResult format
    const searchResults: AdvancedSearchResult[] = results
      .map((r) => {
        const chunkRow = db
          .prepare(`SELECT path, start_line, end_line, source, text FROM chunks WHERE id = ?`)
          .get(r.chunkId) as
          | { path: string; start_line: number; end_line: number; source: string; text: string }
          | undefined;

        return {
          path: chunkRow?.path ?? "",
          startLine: chunkRow?.start_line ?? 0,
          endLine: chunkRow?.end_line ?? 0,
          score: r.score,
          snippet: chunkRow?.text?.slice(0, 700) ?? "",
          source: chunkRow?.source ?? "memory",
          type: "knowledge" as MemoryEntryType,
          linkedNodes: r.linkedNodes,
        };
      })
      .filter((r) => r.path);

    return searchResults;
  }

  // ─── Hub Documents ───

  /**
   * Generate or refresh a hub (index) document.
   */
  getHub(hubType: HubType): string {
    this.ensureInitialized();
    return generateHubDocument(this.graphDb!, hubType);
  }

  /**
   * Generate all hub documents and save them to disk.
   */
  async refreshAllHubs(): Promise<string[]> {
    this.ensureInitialized();
    const hubTypes: HubType[] = ["cases", "people", "knowledge", "domains", "timeline"];
    const files: string[] = [];

    const hubDir = path.join(this.config.memoryBaseDir, "_hub");
    await fs.mkdir(hubDir, { recursive: true });

    for (const hubType of hubTypes) {
      const content = this.getHub(hubType);
      const filePath = path.join(hubDir, `${hubType}_index.md`);
      await fs.writeFile(filePath, content, "utf-8");
      files.push(filePath);
    }

    return files;
  }

  // ─── Statistics ───

  /**
   * Get comprehensive memory statistics.
   */
  getStats(): MemoryStats {
    this.ensureInitialized();
    return getMemoryStats(this.graphDb!);
  }

  // ─── Cleanup ───

  /**
   * Close the database connection.
   */
  close(): void {
    // The graph DB lifecycle is managed by the caller if they passed existingDb
    this.graphDb = null;
    this.initialized = false;
  }

  // ─── Internal Methods ───

  private ensureInitialized(): void {
    if (!this.initialized || !this.graphDb) {
      throw new Error("AdvancedMemoryManager not initialized. Call initialize() first.");
    }
  }

  private async classifyWithLLM(content: string): Promise<ClassificationResult> {
    if (!this.classifyFn) {
      return classifyWithRules(content);
    }

    try {
      const db = this.graphDb!;

      // Gather existing context for the classification prompt
      const existingEntities = db
        .prepare(`SELECT id, name, type FROM nodes LIMIT 50`)
        .all() as Array<{ id: string; name: string; type: string }>;
      const existingTags = db
        .prepare(`SELECT tag FROM tags ORDER BY usage_count DESC LIMIT 30`)
        .all() as Array<{ tag: string }>;
      const existingCases = db
        .prepare(`SELECT name FROM nodes WHERE type = 'case' AND status = 'active' LIMIT 20`)
        .all() as Array<{ name: string }>;

      const prompt = buildClassificationPrompt({
        content,
        existingEntities,
        existingTags: existingTags.map((t) => t.tag),
        existingCases: existingCases.map((c) => c.name),
      });

      const response = await this.classifyFn(prompt);
      const parsed = parseClassificationResponse(response);

      if (parsed) {
        return parsed;
      }

      log.warn("LLM classification failed to parse, falling back to rules");
      return classifyWithRules(content);
    } catch (err) {
      log.warn(`LLM classification error, falling back to rules: ${String(err)}`);
      return classifyWithRules(content);
    }
  }

  private processEntities(classification: ClassificationResult): string[] {
    const db = this.graphDb!;
    const nodeIds: string[] = [];

    for (const entity of classification.entities) {
      const node = upsertNode(db, {
        id: entity.isNew ? undefined : entity.id,
        name: entity.name,
        type: entity.type,
        importance: classification.importance,
      });
      nodeIds.push(node.id);
    }

    return nodeIds;
  }

  private processRelationships(classification: ClassificationResult): void {
    const db = this.graphDb!;

    for (const rel of classification.relationships) {
      // Verify both nodes exist
      const fromNode =
        findNodeByName(db, rel.from) ?? upsertNode(db, { name: rel.from, type: "topic" });
      const toNode = findNodeByName(db, rel.to) ?? upsertNode(db, { name: rel.to, type: "topic" });

      upsertEdge(db, {
        fromNode: fromNode.id,
        toNode: toNode.id,
        relationship: rel.type,
      });
    }
  }

  private processTags(classification: ClassificationResult, nodeIds: string[]): void {
    const db = this.graphDb!;

    for (const tag of classification.tags) {
      const tagId = ensureTag(db, tag, classification.domain ?? classification.type);
      for (const nodeId of nodeIds) {
        tagNode(db, nodeId, tagId);
      }
    }
  }

  private async createMemoryDocument(
    content: string,
    classification: ClassificationResult,
  ): Promise<string> {
    const now = new Date().toISOString();
    const dateStr = now.split("T")[0] ?? now;
    const id = `mem_${dateStr.replace(/-/g, "")}_${randomUUID().slice(0, 6)}`;

    const frontmatter: Partial<MemoryFrontmatter> = {
      id,
      type: classification.type,
      created: now,
      updated: now,
      tags: classification.tags,
      importance: classification.importance,
    };

    if (classification.people?.length) {
      frontmatter.people = classification.people;
    }
    if (classification.case) {
      frontmatter.case = classification.case;
    }
    if (classification.place) {
      frontmatter.place = classification.place;
    }
    if (classification.domain) {
      frontmatter.domain = classification.domain;
    }
    if (classification.emotion) {
      frontmatter.emotion = classification.emotion;
    }

    // Determine file location based on type
    const subDir = getSubDirectory(classification.type);
    const fileName = `${dateStr}_${slugify(classification.case ?? classification.type)}_${id.slice(-6)}.md`;
    const filePath = path.join(this.config.memoryBaseDir, subDir, fileName);

    const markdown = serializeFrontmatter(frontmatter, content);

    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, markdown, "utf-8");

    return path.relative(this.config.memoryBaseDir, filePath);
  }

  private async ensureDirectoryStructure(): Promise<void> {
    const base = this.config.memoryBaseDir;
    const dirs = [
      path.join(base, "_hub"),
      path.join(base, "_meta"),
      path.join(base, "entities", "people"),
      path.join(base, "entities", "cases"),
      path.join(base, "entities", "topics"),
      path.join(base, "entities", "places"),
      path.join(base, "knowledge"),
      path.join(base, "journal"),
      path.join(base, "interactions"),
    ];

    for (const dir of dirs) {
      await fs.mkdir(dir, { recursive: true }).catch(() => {});
    }
  }
}

// ─── Helpers ───

function getSubDirectory(type: MemoryEntryType): string {
  switch (type) {
    case "conversation":
    case "social":
      return "interactions";
    case "knowledge":
      return "knowledge";
    case "personal_note":
      return "journal";
    default:
      return "interactions";
  }
}

function generateKnowledgeTitle(content: string): string {
  // Use the first heading or first sentence as the title
  const headingMatch = content.match(/^#\s+(.+)/m);
  if (headingMatch) {
    return headingMatch[1].slice(0, 60);
  }
  const firstSentence = content.split(/[.!?\n]/)[0]?.trim();
  return firstSentence ? firstSentence.slice(0, 60) : "Untitled Knowledge";
}

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\u3131-\u314e\u314f-\u3163\uac00-\ud7a3\u4e00-\u9fff]+/g, "_")
    .replace(/^_|_$/g, "")
    .slice(0, 50);
}
