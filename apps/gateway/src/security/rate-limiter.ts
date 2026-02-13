/**
 * Gateway Rate Limiter
 *
 * In-memory sliding window rate limiter with 3-strike escalation.
 * Benchmarked from OpenClaw's lane-based concurrency + MoA web security.
 *
 * Strike system:
 *   - Strike 1: 30min cooldown
 *   - Strike 2: 1hr cooldown
 *   - Strike 3: permanent ban (requires admin reset)
 */

import { logger } from "../logger.js";

interface UserBucket {
  /** Timestamps of recent requests (sliding window) */
  timestamps: number[];
  /** Number of rate limit violations */
  strikes: number;
  /** Blocked until this timestamp (0 = not blocked) */
  blockedUntil: number;
  /** Permanently banned */
  banned: boolean;
}

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  resetInMs: number;
  reason?: string;
  strikes?: number;
  banned?: boolean;
}

export class RateLimiter {
  private buckets = new Map<string, UserBucket>();
  private readonly maxPerMinute: number;
  private readonly maxStrikes: number;
  private readonly strikeCooldowns: number[];
  private cleanupTimer: NodeJS.Timeout | null = null;

  constructor(opts: {
    maxPerMinute?: number;
    maxStrikes?: number;
    strikeCooldownMs?: number;
  } = {}) {
    this.maxPerMinute = opts.maxPerMinute ?? 30;
    this.maxStrikes = opts.maxStrikes ?? 3;
    const baseCooldown = opts.strikeCooldownMs ?? 1_800_000; // 30min
    this.strikeCooldowns = [
      baseCooldown,           // Strike 1: 30min
      baseCooldown * 2,       // Strike 2: 1hr
      Infinity,               // Strike 3: permanent
    ];

    // Periodic cleanup of stale buckets (every 5 min)
    this.cleanupTimer = setInterval(() => this.cleanup(), 300_000);
  }

  /** Check and consume a rate limit token */
  check(channel: string, userId: string): RateLimitResult {
    const key = `${channel}:${userId}`;
    let bucket = this.buckets.get(key);

    if (!bucket) {
      bucket = { timestamps: [], strikes: 0, blockedUntil: 0, banned: false };
      this.buckets.set(key, bucket);
    }

    // Check permanent ban
    if (bucket.banned) {
      return {
        allowed: false,
        remaining: 0,
        resetInMs: Infinity,
        reason: "계정이 영구 차단되었습니다. 관리자에게 문의하세요.",
        strikes: bucket.strikes,
        banned: true,
      };
    }

    // Check temporary block
    const now = Date.now();
    if (bucket.blockedUntil > now) {
      const remainMs = bucket.blockedUntil - now;
      const remainMin = Math.ceil(remainMs / 60_000);
      return {
        allowed: false,
        remaining: 0,
        resetInMs: remainMs,
        reason: `너무 많은 요청이 감지되었습니다. ${remainMin}분 후 다시 시도해주세요.`,
        strikes: bucket.strikes,
      };
    }

    // Sliding window: remove timestamps older than 1 minute
    const windowStart = now - 60_000;
    bucket.timestamps = bucket.timestamps.filter((t) => t > windowStart);

    // Check rate limit
    if (bucket.timestamps.length >= this.maxPerMinute) {
      bucket.strikes++;

      if (bucket.strikes >= this.maxStrikes) {
        bucket.banned = true;
        logger.warn("User permanently banned", { channel, key });
        return {
          allowed: false,
          remaining: 0,
          resetInMs: Infinity,
          reason: "반복적인 과도한 요청으로 계정이 차단되었습니다.",
          strikes: bucket.strikes,
          banned: true,
        };
      }

      const cooldown = this.strikeCooldowns[bucket.strikes - 1] ?? this.strikeCooldowns[0];
      bucket.blockedUntil = now + cooldown;
      const cooldownMin = Math.ceil(cooldown / 60_000);

      logger.warn("Rate limit strike", {
        channel,
        key,
        strike: bucket.strikes,
        cooldownMin,
      });

      return {
        allowed: false,
        remaining: 0,
        resetInMs: cooldown,
        reason: `요청 제한에 도달했습니다. ${cooldownMin}분 후 다시 시도해주세요. (경고 ${bucket.strikes}/${this.maxStrikes})`,
        strikes: bucket.strikes,
      };
    }

    // Allow request
    bucket.timestamps.push(now);
    const remaining = this.maxPerMinute - bucket.timestamps.length;

    return {
      allowed: true,
      remaining,
      resetInMs: bucket.timestamps.length > 0
        ? 60_000 - (now - bucket.timestamps[0])
        : 60_000,
    };
  }

  /** Reset a user's rate limit state (admin action) */
  reset(channel: string, userId: string): void {
    this.buckets.delete(`${channel}:${userId}`);
  }

  /** Unban a user (admin action) */
  unban(channel: string, userId: string): void {
    const key = `${channel}:${userId}`;
    const bucket = this.buckets.get(key);
    if (bucket) {
      bucket.banned = false;
      bucket.strikes = 0;
      bucket.blockedUntil = 0;
      bucket.timestamps = [];
    }
  }

  /** Get current stats */
  stats(): { totalUsers: number; bannedUsers: number; blockedUsers: number } {
    let banned = 0;
    let blocked = 0;
    const now = Date.now();
    for (const bucket of this.buckets.values()) {
      if (bucket.banned) banned++;
      else if (bucket.blockedUntil > now) blocked++;
    }
    return { totalUsers: this.buckets.size, bannedUsers: banned, blockedUsers: blocked };
  }

  /** Remove stale entries (no activity in 2 hours, not banned) */
  private cleanup(): void {
    const cutoff = Date.now() - 7_200_000;
    for (const [key, bucket] of this.buckets) {
      if (bucket.banned) continue; // keep banned entries
      const lastActivity = bucket.timestamps[bucket.timestamps.length - 1] ?? 0;
      if (lastActivity < cutoff && bucket.blockedUntil < Date.now()) {
        this.buckets.delete(key);
      }
    }
  }

  /** Shutdown cleanup timer */
  destroy(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }
  }
}
