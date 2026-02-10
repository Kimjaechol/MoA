/**
 * Context compression and optimization for SLM (Small Language Model)
 * token budgets. Handles both English and Korean text estimation.
 */
export class ContextOptimizer {
  /**
   * Rough token count estimation.
   * English: ~4 chars per token.
   * Korean (Hangul): ~2 chars per token (larger vocab, denser encoding).
   * Mixed text is estimated by weighing each segment.
   */
  estimateTokens(text: string): number {
    if (text.length === 0) {
      return 0;
    }

    let koreanChars = 0;
    let otherChars = 0;

    for (const char of text) {
      const code = char.codePointAt(0) ?? 0;
      // Hangul Syllables (AC00-D7AF) + Hangul Jamo (1100-11FF, 3130-318F)
      if (
        (code >= 0xac00 && code <= 0xd7af) ||
        (code >= 0x1100 && code <= 0x11ff) ||
        (code >= 0x3130 && code <= 0x318f)
      ) {
        koreanChars++;
      } else {
        otherChars++;
      }
    }

    // Korean: ~2 chars/token, Other: ~4 chars/token
    const koreanTokens = Math.ceil(koreanChars / 2);
    const otherTokens = Math.ceil(otherChars / 4);
    return koreanTokens + otherTokens;
  }

  /**
   * Compress text to fit within a token budget.
   * Strategy: sentence-level truncation, removing less-informative
   * sentences from the middle (keeps first + last for coherence).
   */
  compressContext(text: string, maxTokens: number): string {
    if (this.estimateTokens(text) <= maxTokens) {
      return text;
    }

    const sentences = this.splitSentences(text);
    if (sentences.length <= 2) {
      // Can't split further; hard-truncate by character estimate
      return this.hardTruncate(text, maxTokens);
    }

    // Keep first and last sentence, then greedily add middle sentences
    const first = sentences[0];
    const last = sentences[sentences.length - 1];
    const middle = sentences.slice(1, -1);

    let result = `${first} ... ${last}`;
    if (this.estimateTokens(result) > maxTokens) {
      return this.hardTruncate(first, maxTokens);
    }

    // Greedily add middle sentences from the start
    const kept: string[] = [first];
    for (const sentence of middle) {
      const candidate = [...kept, sentence, last].join(" ");
      if (this.estimateTokens(candidate) > maxTokens) {
        break;
      }
      kept.push(sentence);
    }
    kept.push(last);

    return kept.join(" ");
  }

  /**
   * Extract key phrases from text.
   * Uses a simple heuristic: words that are capitalized (proper nouns),
   * longer than average, or appear multiple times.
   */
  extractKeyPhrases(text: string): string[] {
    const words = text.split(/\s+/).filter((w) => w.length > 0);
    if (words.length === 0) {
      return [];
    }

    const freq = new Map<string, number>();
    for (const word of words) {
      const normalized = word.toLowerCase().replace(/[^a-z0-9\uac00-\ud7af]/g, "");
      if (normalized.length < 3) {
        continue;
      }
      freq.set(normalized, (freq.get(normalized) ?? 0) + 1);
    }

    const avgLen = [...freq.keys()].reduce((sum, w) => sum + w.length, 0) / Math.max(freq.size, 1);

    const phrases: string[] = [];
    for (const [word, count] of freq) {
      // Key phrase heuristic: frequent OR notably longer than average
      if (count >= 2 || word.length > avgLen * 1.5) {
        phrases.push(word);
      }
    }

    // Sort by frequency descending, then by length descending
    phrases.sort((a, b) => {
      const freqDiff = (freq.get(b) ?? 0) - (freq.get(a) ?? 0);
      if (freqDiff !== 0) {
        return freqDiff;
      }
      return b.length - a.length;
    });

    return phrases;
  }

  /**
   * Summarize multiple content entries within a token budget.
   * Higher-importance items are kept first; lower-importance items
   * are truncated or omitted when the budget is exhausted.
   */
  summarizeForContext(
    entries: Array<{ content: string; importance: number }>,
    budget: number,
  ): string {
    if (entries.length === 0) {
      return "";
    }

    // Sort by importance descending
    const sorted = [...entries].sort((a, b) => b.importance - a.importance);

    const kept: string[] = [];
    let usedTokens = 0;

    for (const entry of sorted) {
      const entryTokens = this.estimateTokens(entry.content);
      if (usedTokens + entryTokens <= budget) {
        kept.push(entry.content);
        usedTokens += entryTokens;
      } else {
        // Try to fit a compressed version
        const remaining = budget - usedTokens;
        if (remaining > 10) {
          const compressed = this.compressContext(entry.content, remaining);
          if (compressed.length > 0) {
            kept.push(compressed);
            usedTokens += this.estimateTokens(compressed);
          }
        }
        break;
      }
    }

    return kept.join("\n\n");
  }

  // --- Private helpers ---

  private splitSentences(text: string): string[] {
    // Split on sentence-ending punctuation (handles Korean period too)
    const raw = text.split(/(?<=[.!?\u3002])\s+/);
    return raw.filter((s) => s.trim().length > 0);
  }

  private hardTruncate(text: string, maxTokens: number): string {
    // Estimate chars from token budget (conservative: use 3 chars/token)
    const maxChars = maxTokens * 3;
    if (text.length <= maxChars) {
      return text;
    }
    return text.slice(0, maxChars) + "...";
  }
}
