import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { FeedbackCollector } from "./feedback-collector.js";

describe("FeedbackCollector", () => {
  let tempDir: string;
  let storagePath: string;
  let collector: FeedbackCollector;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "moa-feedback-test-"));
    storagePath = join(tempDir, "learnings.json");
    collector = new FeedbackCollector(storagePath);
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  describe("detectCorrection", () => {
    it("detects Korean correction '아니, 그게 아니라'", () => {
      const result = collector.detectCorrection("아니, 그게 아니라 이렇게 해줘");
      expect(result.isCorrection).toBe(true);
      expect(result.pattern).toBe("korean-not-that");
    });

    it("detects Korean correction '틀렸어'", () => {
      const result = collector.detectCorrection("틀렸어, 다시 해줘");
      expect(result.isCorrection).toBe(true);
      expect(result.pattern).toBe("korean-wrong");
    });

    it("detects Korean correction '다시 해줘'", () => {
      const result = collector.detectCorrection("다시 해 줘");
      expect(result.isCorrection).toBe(true);
      expect(result.pattern).toBe("korean-redo");
    });

    it("detects English correction 'Actually...'", () => {
      const result = collector.detectCorrection("Actually, I wanted something different");
      expect(result.isCorrection).toBe(true);
      expect(result.pattern).toBe("en-actually");
    });

    it("detects English correction 'No, that's wrong'", () => {
      const result = collector.detectCorrection("No, that's wrong. Try again.");
      expect(result.isCorrection).toBe(true);
      expect(result.pattern).toBe("en-thats-wrong");
    });

    it("returns false for normal messages", () => {
      const result = collector.detectCorrection("Can you help me with this?");
      expect(result.isCorrection).toBe(false);
      expect(result.pattern).toBe("");
    });

    it("detects 'please fix' pattern", () => {
      const result = collector.detectCorrection("Please fix the formatting");
      expect(result.isCorrection).toBe(true);
      expect(result.pattern).toBe("en-please-fix");
    });
  });

  describe("recordCorrection", () => {
    it("creates a learning entry with generated id and timestamp", () => {
      const entry = collector.recordCorrection({
        type: "correction",
        trigger: "wrong format",
        correction: "use YYYY-MM-DD format",
      });

      expect(entry.id).toBeTruthy();
      expect(entry.timestamp).toBeTruthy();
      expect(entry.appliedCount).toBe(0);
      expect(entry.type).toBe("correction");
      expect(entry.trigger).toBe("wrong format");
      expect(entry.correction).toBe("use YYYY-MM-DD format");
    });

    it("persists entries to disk and reloads them", () => {
      collector.recordCorrection({
        type: "preference",
        trigger: "code style",
        correction: "use tabs not spaces",
      });

      // Create a new collector from the same storage path
      const reloaded = new FeedbackCollector(storagePath);
      const entries = reloaded.getAllEntries();
      expect(entries).toHaveLength(1);
      expect(entries[0].correction).toBe("use tabs not spaces");
    });
  });

  describe("recordErrorRecovery", () => {
    it("records an error recovery entry", () => {
      const entry = collector.recordErrorRecovery(
        "ENOENT: file not found",
        "Create parent directory before writing file",
      );

      expect(entry.type).toBe("error_recovery");
      expect(entry.trigger).toBe("ENOENT: file not found");
      expect(entry.correction).toBe("Create parent directory before writing file");
    });
  });

  describe("getRelevantLearnings", () => {
    it("returns entries matching context keywords", () => {
      collector.recordCorrection({
        type: "correction",
        trigger: "date format wrong",
        correction: "use ISO 8601 date format",
      });
      collector.recordCorrection({
        type: "preference",
        trigger: "color theme",
        correction: "prefer dark mode",
      });

      const results = collector.getRelevantLearnings("date format question");
      expect(results.length).toBeGreaterThan(0);
      expect(results[0].trigger).toContain("date");
    });

    it("returns empty array when no context matches", () => {
      collector.recordCorrection({
        type: "correction",
        trigger: "specific topic alpha",
        correction: "use beta approach",
      });

      const results = collector.getRelevantLearnings("xyz");
      expect(results).toHaveLength(0);
    });

    it("respects the limit parameter", () => {
      for (let i = 0; i < 10; i++) {
        collector.recordCorrection({
          type: "correction",
          trigger: `common keyword item ${i}`,
          correction: `fix for common keyword ${i}`,
        });
      }

      const results = collector.getRelevantLearnings("common keyword", 3);
      expect(results).toHaveLength(3);
    });
  });
});
