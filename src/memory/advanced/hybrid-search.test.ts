import { describe, it, expect } from "vitest";
import {
  classifyQueryType,
  getSearchWeights,
  mergeTripleResults,
  applyFilters,
} from "./hybrid-search.js";

describe("classifyQueryType", () => {
  it("classifies entity queries", () => {
    expect(classifyQueryType("민수씨와 관련된 일들")).toBe("entity_query");
    expect(classifyQueryType("Who was involved in the dispute?")).toBe("entity_query");
    expect(classifyQueryType("이 사람에 대해 알려줘")).toBe("entity_query");
  });

  it("classifies temporal queries", () => {
    expect(classifyQueryType("지난주에 뭐 했더라?")).toBe("temporal_query");
    expect(classifyQueryType("What happened last week?")).toBe("temporal_query");
    expect(classifyQueryType("최근 활동 보여줘")).toBe("temporal_query");
  });

  it("classifies exact queries", () => {
    expect(classifyQueryType("앱 v2 결제 플로우 리뷰 결과")).toBe("exact_query");
  });

  it("classifies knowledge queries", () => {
    expect(classifyQueryType("소금빵 발효 온도는 어떻게 해야 하나?")).toBe("knowledge_query");
    expect(classifyQueryType("How do I handle state management?")).toBe("knowledge_query");
    expect(classifyQueryType("이론적 설명 부탁해")).toBe("knowledge_query");
  });

  it("defaults to semantic query", () => {
    expect(classifyQueryType("interesting memories from summer")).toBe("semantic_query");
  });
});

describe("getSearchWeights", () => {
  it("returns correct weights for entity queries", () => {
    const weights = getSearchWeights("entity_query");
    expect(weights.graph).toBeGreaterThan(weights.vector);
    expect(weights.graph).toBeGreaterThan(weights.bm25);
  });

  it("returns correct weights for semantic queries", () => {
    const weights = getSearchWeights("semantic_query");
    expect(weights.vector).toBeGreaterThan(weights.bm25);
    expect(weights.vector).toBeGreaterThan(weights.graph);
  });

  it("normalizes weights to sum to 1.0", () => {
    const weights = getSearchWeights("entity_query", { vector: 0.5, bm25: 0.5, graph: 0.5 });
    const sum = weights.vector + weights.bm25 + weights.graph;
    expect(Math.abs(sum - 1.0)).toBeLessThan(0.01);
  });
});

describe("mergeTripleResults", () => {
  it("merges vector, keyword, and graph results", () => {
    const results = mergeTripleResults({
      vector: [
        {
          id: "chunk1",
          path: "test.md",
          startLine: 1,
          endLine: 5,
          score: 0.8,
          snippet: "Vector result",
          source: "memory",
        },
      ],
      keyword: [
        {
          id: "chunk1",
          path: "test.md",
          startLine: 1,
          endLine: 5,
          score: 0.7,
          snippet: "Keyword result",
          source: "memory",
          textScore: 0.7,
        },
        {
          id: "chunk2",
          path: "other.md",
          startLine: 1,
          endLine: 3,
          score: 0.6,
          snippet: "Only keyword",
          source: "memory",
          textScore: 0.6,
        },
      ],
      graph: [
        {
          chunkId: "chunk1",
          score: 0.9,
          linkedNodes: ["node1"],
        },
      ],
      weights: { vector: 0.4, bm25: 0.25, graph: 0.35 },
    });

    expect(results.length).toBeGreaterThan(0);

    // chunk1 should have the highest score (appears in all three)
    const chunk1 = results.find((r) => r.path === "test.md");
    expect(chunk1).toBeDefined();
    expect(chunk1!.score).toBeGreaterThan(0);
    expect(chunk1!.linkedNodes).toContain("node1");

    // Results should be sorted by score descending
    for (let i = 1; i < results.length; i++) {
      expect(results[i - 1].score).toBeGreaterThanOrEqual(results[i].score);
    }
  });

  it("handles empty inputs", () => {
    const results = mergeTripleResults({
      vector: [],
      keyword: [],
      graph: [],
      weights: { vector: 0.4, bm25: 0.3, graph: 0.3 },
    });
    expect(results).toHaveLength(0);
  });

  it("handles vector-only results", () => {
    const results = mergeTripleResults({
      vector: [
        {
          id: "chunk1",
          path: "test.md",
          startLine: 1,
          endLine: 5,
          score: 0.8,
          snippet: "Test",
          source: "memory",
        },
      ],
      keyword: [],
      graph: [],
      weights: { vector: 0.7, bm25: 0.15, graph: 0.15 },
    });
    expect(results).toHaveLength(1);
    expect(results[0].score).toBeCloseTo(0.7 * 0.8, 2);
  });
});

describe("applyFilters", () => {
  const sampleResults = [
    {
      path: "a.md",
      startLine: 1,
      endLine: 5,
      score: 0.9,
      snippet: "Test A",
      source: "memory",
      type: "dispute" as const,
      people: ["민수씨"],
      case: "잔디밭 분쟁",
      importance: 8,
      tags: ["이웃분쟁"],
    },
    {
      path: "b.md",
      startLine: 1,
      endLine: 3,
      score: 0.7,
      snippet: "Test B",
      source: "memory",
      type: "meeting" as const,
      people: ["박과장"],
      case: "앱개발 v2",
      importance: 6,
      tags: ["업무"],
    },
    {
      path: "c.md",
      startLine: 1,
      endLine: 2,
      score: 0.5,
      snippet: "Test C",
      source: "memory",
      type: "personal_note" as const,
      importance: 3,
      tags: ["일상"],
    },
  ];

  it("filters by type", () => {
    const filtered = applyFilters(sampleResults, { type: "dispute" });
    expect(filtered).toHaveLength(1);
    expect(filtered[0].type).toBe("dispute");
  });

  it("filters by people", () => {
    const filtered = applyFilters(sampleResults, { people: ["민수씨"] });
    expect(filtered).toHaveLength(1);
    expect(filtered[0].people).toContain("민수씨");
  });

  it("filters by minimum importance", () => {
    const filtered = applyFilters(sampleResults, { importanceMin: 7 });
    expect(filtered).toHaveLength(1);
    expect(filtered[0].importance).toBeGreaterThanOrEqual(7);
  });

  it("filters by case", () => {
    const filtered = applyFilters(sampleResults, { case: "앱개발 v2" });
    expect(filtered).toHaveLength(1);
  });

  it("filters by tags", () => {
    const filtered = applyFilters(sampleResults, { tags: ["이웃분쟁"] });
    expect(filtered).toHaveLength(1);
  });

  it("combines multiple filters", () => {
    const filtered = applyFilters(sampleResults, {
      type: "dispute",
      importanceMin: 5,
    });
    expect(filtered).toHaveLength(1);
  });
});
