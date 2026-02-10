import type { DatabaseSync } from "node:sqlite";

/**
 * MoA Advanced Memory v2 — Time Decay (Digital Forgetting)
 *
 * Simulates natural human memory decay:
 * - Recently accessed info → minimal decay
 * - Old resolved issues → fast decay
 * - Frequently accessed info → slow decay (protected by access count)
 * - Archived info → fastest decay
 *
 * Score formula: base_score × recency_factor
 * recency_factor = 1 / (1 + days_old × decay_rate / access_factor)
 */

/**
 * Apply time decay to a search score.
 *
 * @param baseScore - Original search similarity score (0-1)
 * @param lastAccessed - ISO date string of last access (or null)
 * @param status - "active" | "resolved" | "archived"
 * @param accessCount - Number of times this chunk was returned in search results
 * @param now - Current date (for testing)
 * @returns Decayed score
 */
export function applyTimeDecay(
  baseScore: number,
  lastAccessed: string | null,
  status: string = "active",
  accessCount: number = 1,
  now?: Date,
): number {
  if (!lastAccessed) {
    return baseScore;
  }

  const current = now ?? new Date();
  const lastDate = new Date(lastAccessed);
  const daysOld = Math.max(0, (current.getTime() - lastDate.getTime()) / (1000 * 60 * 60 * 24));

  // Base decay rate
  let decayRate = 0.01;

  // Resolved issues decay 2x faster
  if (status === "resolved") {
    decayRate *= 2;
    // Archived items decay 3x faster
  } else if (status === "archived") {
    decayRate *= 3;
  }

  // Frequently accessed info decays slower (log scale protection)
  const accessFactor = 1 + Math.log(Math.max(accessCount, 1));

  const recency = 1 / (1 + (daysOld * decayRate) / accessFactor);

  return baseScore * recency;
}

/**
 * Calculate recency score for sorting (without base score).
 * Useful for pure recency-based ranking.
 */
export function recencyScore(
  lastAccessed: string | null,
  status: string = "active",
  accessCount: number = 1,
  now?: Date,
): number {
  return applyTimeDecay(1.0, lastAccessed, status, accessCount, now);
}

/**
 * Update last_accessed and access_count for chunks returned in search results.
 * Called after each search to maintain the time decay system.
 */
export function touchAccessedChunks(db: DatabaseSync, chunkIds: string[]): void {
  if (chunkIds.length === 0) {
    return;
  }

  const now = new Date().toISOString();
  const stmt = db.prepare(
    `UPDATE chunk_metadata
     SET last_accessed = ?,
         access_count = access_count + 1
     WHERE id = ?`,
  );

  for (const id of chunkIds) {
    stmt.run(now, id);
  }
}
