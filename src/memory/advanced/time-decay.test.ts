import { describe, it, expect } from "vitest";
import { applyTimeDecay, recencyScore } from "./time-decay.js";

describe("applyTimeDecay", () => {
  const now = new Date("2026-03-10T12:00:00Z");

  it("returns base score for null lastAccessed", () => {
    expect(applyTimeDecay(0.9, null, "active", 1, now)).toBe(0.9);
  });

  it("minimal decay for recent access", () => {
    const yesterday = "2026-03-09T12:00:00Z";
    const score = applyTimeDecay(1.0, yesterday, "active", 1, now);
    expect(score).toBeGreaterThan(0.98);
  });

  it("significant decay for old resolved items", () => {
    const thirtyDaysAgo = "2026-02-08T12:00:00Z";
    const score = applyTimeDecay(1.0, thirtyDaysAgo, "resolved", 1, now);
    // 30 days × 0.02 (2× decay rate) / 1 access factor → substantial decay
    expect(score).toBeLessThan(0.7);
  });

  it("archived items decay fastest", () => {
    const thirtyDaysAgo = "2026-02-08T12:00:00Z";
    const active = applyTimeDecay(1.0, thirtyDaysAgo, "active", 1, now);
    const resolved = applyTimeDecay(1.0, thirtyDaysAgo, "resolved", 1, now);
    const archived = applyTimeDecay(1.0, thirtyDaysAgo, "archived", 1, now);
    expect(active).toBeGreaterThan(resolved);
    expect(resolved).toBeGreaterThan(archived);
  });

  it("frequent access protects from decay", () => {
    const thirtyDaysAgo = "2026-02-08T12:00:00Z";
    const lowAccess = applyTimeDecay(1.0, thirtyDaysAgo, "active", 1, now);
    const highAccess = applyTimeDecay(1.0, thirtyDaysAgo, "active", 50, now);
    expect(highAccess).toBeGreaterThan(lowAccess);
  });

  it("preserves relative ordering of scores", () => {
    const dateStr = "2026-03-05T12:00:00Z";
    const high = applyTimeDecay(0.9, dateStr, "active", 1, now);
    const low = applyTimeDecay(0.3, dateStr, "active", 1, now);
    expect(high).toBeGreaterThan(low);
  });
});

describe("recencyScore", () => {
  const now = new Date("2026-03-10T12:00:00Z");

  it("returns 1.0 for null lastAccessed", () => {
    expect(recencyScore(null, "active", 1, now)).toBe(1.0);
  });

  it("returns high score for recent items", () => {
    expect(recencyScore("2026-03-10T00:00:00Z", "active", 1, now)).toBeGreaterThan(0.99);
  });

  it("returns lower score for old items", () => {
    const score = recencyScore("2025-01-01T00:00:00Z", "active", 1, now);
    expect(score).toBeLessThan(0.5);
  });
});
