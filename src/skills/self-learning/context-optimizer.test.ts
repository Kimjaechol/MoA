import { describe, expect, it } from "vitest";
import { ContextOptimizer } from "./context-optimizer.js";

describe("ContextOptimizer", () => {
  const optimizer = new ContextOptimizer();

  describe("estimateTokens", () => {
    it("returns 0 for empty string", () => {
      expect(optimizer.estimateTokens("")).toBe(0);
    });

    it("estimates English text at ~4 chars per token", () => {
      const text = "Hello world, this is a test string."; // 34 chars
      const tokens = optimizer.estimateTokens(text);
      // 34 other chars -> ceil(34/4) = 9
      expect(tokens).toBe(9);
    });

    it("estimates Korean text at ~2 chars per token", () => {
      const text = "안녕하세요 테스트입니다"; // 6 Hangul + space + 5 Hangul = 11 Hangul, 1 space
      const tokens = optimizer.estimateTokens(text);
      // 11 Korean chars -> ceil(11/2) = 6, 1 other -> ceil(1/4) = 1 => 7
      expect(tokens).toBe(7);
    });

    it("handles mixed Korean/English text", () => {
      const text = "Hello 안녕"; // 6 other (H,e,l,l,o,space) + 2 Korean
      const tokens = optimizer.estimateTokens(text);
      // 2 Korean -> ceil(2/2) = 1, 6 other -> ceil(6/4) = 2 => 3
      expect(tokens).toBe(3);
    });
  });

  describe("compressContext", () => {
    it("returns text unchanged if within budget", () => {
      const text = "Short text.";
      const result = optimizer.compressContext(text, 100);
      expect(result).toBe(text);
    });

    it("truncates text that exceeds the token budget", () => {
      const text =
        "First sentence. Second sentence. Third sentence. Fourth sentence. Fifth sentence.";
      // Force a small budget to trigger compression
      const result = optimizer.compressContext(text, 5);
      expect(result.length).toBeLessThan(text.length);
    });

    it("preserves first and last sentences when compressing", () => {
      const text =
        "The introduction is important. Middle filler content goes here. Another middle part. The conclusion matters.";
      const result = optimizer.compressContext(text, 15);
      expect(result).toContain("introduction");
      expect(result).toContain("conclusion");
    });

    it("handles single-sentence text by hard-truncating", () => {
      const longSentence = "A".repeat(500);
      const result = optimizer.compressContext(longSentence, 10);
      expect(result.length).toBeLessThan(longSentence.length);
      expect(result.endsWith("...")).toBe(true);
    });
  });

  describe("extractKeyPhrases", () => {
    it("returns empty array for empty text", () => {
      expect(optimizer.extractKeyPhrases("")).toEqual([]);
    });

    it("extracts repeated words as key phrases", () => {
      const text =
        "The database connection failed. Check the database config. Database is critical.";
      const phrases = optimizer.extractKeyPhrases(text);
      expect(phrases).toContain("database");
    });

    it("extracts longer-than-average words", () => {
      // Mix short words with a notably long one so avg is low
      const text = "Do it now via the internationalization API for app use.";
      const phrases = optimizer.extractKeyPhrases(text);
      // "internationalization" (20 chars) is well above average
      expect(phrases.length).toBeGreaterThan(0);
      expect(phrases).toContain("internationalization");
    });

    it("filters out very short words", () => {
      const text = "I am at it on to be or";
      const phrases = optimizer.extractKeyPhrases(text);
      // All words are <= 2 chars, should be empty
      expect(phrases).toEqual([]);
    });
  });

  describe("summarizeForContext", () => {
    it("returns empty string for empty entries", () => {
      expect(optimizer.summarizeForContext([], 100)).toBe("");
    });

    it("includes high-importance items first", () => {
      const entries = [
        { content: "Low importance item", importance: 1 },
        { content: "High importance item", importance: 10 },
        { content: "Medium importance item", importance: 5 },
      ];
      const result = optimizer.summarizeForContext(entries, 100);
      const highIdx = result.indexOf("High importance");
      const medIdx = result.indexOf("Medium importance");
      expect(highIdx).toBeLessThan(medIdx);
    });

    it("omits items that exceed the budget", () => {
      const entries = [
        { content: "A".repeat(200), importance: 10 },
        { content: "B".repeat(200), importance: 5 },
        { content: "C".repeat(200), importance: 1 },
      ];
      // Budget can only hold ~50 tokens = ~200 chars
      const result = optimizer.summarizeForContext(entries, 50);
      // Should include first item but not all three
      expect(result).toContain("A");
    });

    it("compresses the first item that overflows the remaining budget", () => {
      const entries = [
        { content: "Short.", importance: 10 },
        {
          content:
            "This is a very long sentence that should get compressed. Another long part here. And more filler text to exceed budget.",
          importance: 5,
        },
      ];
      const result = optimizer.summarizeForContext(entries, 20);
      expect(result).toContain("Short.");
    });
  });
});
