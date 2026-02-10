import { describe, expect, it } from "vitest";
import type { UserModelStrategyConfig } from "./types.js";
import {
  DEFAULT_MODEL_STRATEGY,
  MODEL_STRATEGIES,
  resolveModelStrategy,
  explainModelStrategy,
  isValidStrategy,
} from "./model-strategy.js";

describe("Model Strategy System", () => {
  describe("strategy definitions", () => {
    it("should have exactly 2 strategies", () => {
      expect(Object.keys(MODEL_STRATEGIES)).toHaveLength(2);
      expect(MODEL_STRATEGIES["cost-efficient"]).toBeDefined();
      expect(MODEL_STRATEGIES["max-performance"]).toBeDefined();
    });

    it("cost-efficient should have 4 tiers", () => {
      expect(MODEL_STRATEGIES["cost-efficient"].tiers).toHaveLength(4);
    });

    it("max-performance should have 2 tiers", () => {
      expect(MODEL_STRATEGIES["max-performance"].tiers).toHaveLength(2);
    });

    it("cost-efficient tiers should start with free options", () => {
      const tiers = MODEL_STRATEGIES["cost-efficient"].tiers;
      expect(tiers[0].free).toBe(true);
      expect(tiers[1].free).toBe(true);
      expect(tiers[2].free).toBe(false);
      expect(tiers[3].free).toBe(false);
    });

    it("max-performance should enable parallel fallback", () => {
      expect(MODEL_STRATEGIES["max-performance"].parallelFallback).toBe(true);
    });

    it("cost-efficient should not enable parallel fallback", () => {
      expect(MODEL_STRATEGIES["cost-efficient"].parallelFallback).toBe(false);
    });

    it("default strategy should be cost-efficient", () => {
      expect(DEFAULT_MODEL_STRATEGY).toBe("cost-efficient");
    });
  });

  describe("isValidStrategy", () => {
    it("should accept valid strategy IDs", () => {
      expect(isValidStrategy("cost-efficient")).toBe(true);
      expect(isValidStrategy("max-performance")).toBe(true);
    });

    it("should reject invalid strategy IDs", () => {
      expect(isValidStrategy("invalid")).toBe(false);
      expect(isValidStrategy("")).toBe(false);
      expect(isValidStrategy(null)).toBe(false);
      expect(isValidStrategy(undefined)).toBe(false);
      expect(isValidStrategy(123)).toBe(false);
    });
  });

  describe("resolveModelStrategy", () => {
    it("cost-efficient should resolve to free SLM tier first", () => {
      const config: UserModelStrategyConfig = {
        strategy: "cost-efficient",
        subscribedProviders: [],
      };
      const result = resolveModelStrategy(config);
      expect(result.strategy).toBe("cost-efficient");
      expect(result.tierLabel).toBe("무료 내장 SLM");
      expect(result.parallel).toBe(false);
      expect(result.selectedModels).toHaveLength(1);
      expect(result.selectedModels[0].provider).toBe("local");
    });

    it("max-performance should resolve to top-tier model", () => {
      const config: UserModelStrategyConfig = {
        strategy: "max-performance",
        subscribedProviders: [],
      };
      const result = resolveModelStrategy(config);
      expect(result.strategy).toBe("max-performance");
      expect(result.tierLabel).toBe("최고 성능 단일 모델");
      expect(result.parallel).toBe(false);
      expect(result.selectedModels).toHaveLength(1);
    });

    it("max-performance + complex task should use parallel", () => {
      const config: UserModelStrategyConfig = {
        strategy: "max-performance",
        subscribedProviders: [],
      };
      const result = resolveModelStrategy(config, "complex");
      expect(result.parallel).toBe(true);
      expect(result.tierLabel).toBe("병렬 멀티 모델");
      expect(result.selectedModels.length).toBeGreaterThan(1);
    });

    it("should respect primary override", () => {
      const config: UserModelStrategyConfig = {
        strategy: "cost-efficient",
        primaryOverride: "openai/gpt-4o",
      };
      const result = resolveModelStrategy(config);
      expect(result.tierLabel).toBe("사용자 지정 모델");
      expect(result.selectedModels[0].provider).toBe("openai");
      expect(result.selectedModels[0].model).toBe("gpt-4o");
    });

    it("should prioritize subscribed providers in cost-efficient", () => {
      const config: UserModelStrategyConfig = {
        strategy: "cost-efficient",
        subscribedProviders: ["anthropic"],
      };
      const result = resolveModelStrategy(config);
      // First tier is still free SLM regardless of subscription
      expect(result.tierLabel).toBe("무료 내장 SLM");
    });

    it("should fallback to cost-efficient for invalid strategy", () => {
      const config = {
        strategy: "invalid-strategy" as "cost-efficient",
        subscribedProviders: [],
      };
      const result = resolveModelStrategy(config);
      expect(result.strategy).toBe("cost-efficient");
    });
  });

  describe("explainModelStrategy", () => {
    it("should produce readable explanation for cost-efficient", () => {
      const config: UserModelStrategyConfig = {
        strategy: "cost-efficient",
        subscribedProviders: [],
      };
      const text = explainModelStrategy(config);
      expect(text).toContain("최저비용");
      expect(text).toContain("가성비");
      expect(text).toContain("무료 내장 SLM");
      expect(text).toContain("유료 LLM 무료 한도");
      expect(text).toContain("유료 LLM 가성비 버전");
      expect(text).toContain("유료 LLM 최고 버전");
    });

    it("should produce readable explanation for max-performance", () => {
      const config: UserModelStrategyConfig = {
        strategy: "max-performance",
        subscribedProviders: [],
      };
      const text = explainModelStrategy(config);
      expect(text).toContain("최고지능");
      expect(text).toContain("최대성능");
      expect(text).toContain("병렬");
    });

    it("should mention subscribed providers when present", () => {
      const config: UserModelStrategyConfig = {
        strategy: "cost-efficient",
        subscribedProviders: ["openai", "anthropic"],
      };
      const text = explainModelStrategy(config);
      expect(text).toContain("구독 중인 LLM");
      expect(text).toContain("우선 적용");
    });
  });

  describe("tier model ordering", () => {
    it("cost-efficient tier 3 should have Kimi K2-0905 Groq first, then budget models", () => {
      const tier3 = MODEL_STRATEGIES["cost-efficient"].tiers[2];
      expect(tier3.label).toBe("유료 LLM 가성비 버전");
      expect(tier3.models[0]).toBe("groq/kimi-k2-0905");
      expect(tier3.models.some((m) => m.includes("deepseek"))).toBe(true);
      expect(tier3.models.some((m) => m.includes("gemini-2.5-flash"))).toBe(true);
    });

    it("cost-efficient tier 4 should have top-tier models", () => {
      const tier4 = MODEL_STRATEGIES["cost-efficient"].tiers[3];
      expect(tier4.label).toBe("유료 LLM 최고 버전");
      expect(tier4.models.some((m) => m.includes("opus"))).toBe(true);
    });

    it("max-performance parallel tier should have 5+ models", () => {
      const parallelTier = MODEL_STRATEGIES["max-performance"].tiers[1];
      expect(parallelTier.label).toBe("병렬 멀티 모델");
      expect(parallelTier.models.length).toBeGreaterThanOrEqual(5);
    });
  });
});
