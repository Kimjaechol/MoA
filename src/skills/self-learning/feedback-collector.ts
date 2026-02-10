import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type { LearningEntry } from "../types.js";

/** Patterns that indicate the user is correcting the agent. */
const CORRECTION_PATTERNS: Array<{ pattern: RegExp; label: string }> = [
  // Korean correction phrases
  { pattern: /아니[,.]?\s*그게\s*아니라/u, label: "korean-not-that" },
  { pattern: /틀렸어/u, label: "korean-wrong" },
  { pattern: /다시\s*해\s*줘/u, label: "korean-redo" },
  { pattern: /그게\s*아니고/u, label: "korean-not-that-alt" },
  { pattern: /잘못\s*했어/u, label: "korean-mistake" },
  // English correction phrases
  { pattern: /\bactually[,.]?\s/i, label: "en-actually" },
  { pattern: /\bno[,.]?\s+that'?s\s+(wrong|incorrect|not right)/i, label: "en-thats-wrong" },
  { pattern: /\bthat'?s\s+not\s+what\s+I\s+(meant|asked|wanted)/i, label: "en-not-what-i-meant" },
  { pattern: /\bI\s+said\b/i, label: "en-i-said" },
  { pattern: /\bwrong[.!]\s/i, label: "en-wrong" },
  { pattern: /\bnot\s+correct/i, label: "en-not-correct" },
  { pattern: /\bplease\s+(fix|correct|redo)/i, label: "en-please-fix" },
];

/**
 * Collects user corrections and error-recovery events, persisting them
 * as a JSON-lines file for the self-learning engine.
 */
export class FeedbackCollector {
  private entries: LearningEntry[] = [];
  private readonly storagePath: string;

  constructor(storagePath: string) {
    this.storagePath = storagePath;
    this.loadFromDisk();
  }

  /**
   * Detect whether a user message contains a correction signal.
   * Returns the matched pattern label if found.
   */
  detectCorrection(userMessage: string): {
    isCorrection: boolean;
    pattern: string;
  } {
    for (const { pattern, label } of CORRECTION_PATTERNS) {
      if (pattern.test(userMessage)) {
        return { isCorrection: true, pattern: label };
      }
    }
    return { isCorrection: false, pattern: "" };
  }

  /** Record a user correction or preference learning. */
  recordCorrection(entry: Omit<LearningEntry, "id" | "timestamp" | "appliedCount">): LearningEntry {
    const full: LearningEntry = {
      ...entry,
      id: randomUUID(),
      timestamp: new Date().toISOString(),
      appliedCount: 0,
    };
    this.entries.push(full);
    this.persistToDisk();
    return full;
  }

  /** Record an error that was successfully recovered from. */
  recordErrorRecovery(error: string, resolution: string): LearningEntry {
    return this.recordCorrection({
      type: "error_recovery",
      trigger: error,
      correction: resolution,
    });
  }

  /**
   * Find learnings relevant to the current context using keyword overlap.
   * Returns entries sorted by relevance (keyword match count) descending.
   */
  getRelevantLearnings(context: string, limit = 5): LearningEntry[] {
    const contextWords = this.extractWords(context);
    if (contextWords.size === 0) {
      return [];
    }

    const scored: Array<{ entry: LearningEntry; score: number }> = [];
    for (const entry of this.entries) {
      const entryWords = this.extractWords(
        `${entry.trigger} ${entry.correction} ${entry.context ?? ""}`,
      );
      let overlap = 0;
      for (const word of contextWords) {
        if (entryWords.has(word)) {
          overlap++;
        }
      }
      if (overlap > 0) {
        scored.push({ entry, score: overlap });
      }
    }

    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, limit).map((s) => s.entry);
  }

  /** Return all stored entries (read-only copy). */
  getAllEntries(): ReadonlyArray<LearningEntry> {
    return [...this.entries];
  }

  // --- Private helpers ---

  private extractWords(text: string): Set<string> {
    // Split on whitespace and punctuation, lowercase, filter short tokens
    const words = text
      .toLowerCase()
      .split(/[\s,.!?;:'"()\[\]{}<>]+/)
      .filter((w) => w.length > 2);
    return new Set(words);
  }

  private loadFromDisk(): void {
    if (!existsSync(this.storagePath)) {
      this.entries = [];
      return;
    }
    try {
      const raw = readFileSync(this.storagePath, "utf-8").trim();
      if (raw === "") {
        this.entries = [];
        return;
      }
      const parsed: unknown = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        this.entries = parsed as LearningEntry[];
      }
    } catch {
      // Corrupted file; start fresh
      this.entries = [];
    }
  }

  private persistToDisk(): void {
    const dir = dirname(this.storagePath);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
    writeFileSync(this.storagePath, JSON.stringify(this.entries, null, 2), "utf-8");
  }
}
