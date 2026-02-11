import { describe, expect, it } from "vitest";
import type { UserModelStrategyConfig } from "./types.js";
import {
  DEFAULT_MODEL_STRATEGY,
  MODEL_STRATEGIES,
  PROVIDER_MODELS,
  MOA_CREDIT_MODELS,
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

    it("each strategy should have 2 tiers (API key + MoA credit)", () => {
      expect(MODEL_STRATEGIES["cost-efficient"].tiers).toHaveLength(2);
      expect(MODEL_STRATEGIES["max-performance"].tiers).toHaveLength(2);
    });

    it("cost-efficient should not enable parallel fallback", () => {
      expect(MODEL_STRATEGIES["cost-efficient"].parallelFallback).toBe(false);
    });

    it("max-performance should not enable parallel fallback", () => {
      expect(MODEL_STRATEGIES["max-performance"].parallelFallback).toBe(false);
    });

    it("default strategy should be cost-efficient", () => {
      expect(DEFAULT_MODEL_STRATEGY).toBe("cost-efficient");
    });
  });

  describe("provider models", () => {
    it("should have models for all major providers", () => {
      expect(PROVIDER_MODELS.anthropic).toBeDefined();
      expect(PROVIDER_MODELS.openai).toBeDefined();
      expect(PROVIDER_MODELS.gemini).toBeDefined();
      expect(PROVIDER_MODELS.xai).toBeDefined();
      expect(PROVIDER_MODELS.deepseek).toBeDefined();
      expect(PROVIDER_MODELS.groq).toBeDefined();
      expect(PROVIDER_MODELS.mistral).toBeDefined();
    });

    it("anthropic max-performance should be claude-opus-4-6", () => {
      expect(PROVIDER_MODELS.anthropic.maxPerformance).toBe("claude-opus-4-6");
    });

    it("anthropic cost-efficient should be claude-haiku-4-5", () => {
      expect(PROVIDER_MODELS.anthropic.costEfficient).toBe("claude-haiku-4-5");
    });
  });

  describe("MoA credit models", () => {
    it("cost-efficient credit model should be Gemini 2.5 Flash Thinking", () => {
      const model = MOA_CREDIT_MODELS["cost-efficient"];
      expect(model.provider).toBe("gemini");
      expect(model.model).toBe("gemini-2.5-flash-thinking");
      expect(model.thinkingBudget).toBe(-1);
    });

    it("max-performance credit model should be Claude Opus 4.6", () => {
      const model = MOA_CREDIT_MODELS["max-performance"];
      expect(model.provider).toBe("anthropic");
      expect(model.model).toBe("claude-opus-4-6");
      expect(model.thinkingBudget).toBeUndefined();
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
    describe("no API keys (MoA credit mode)", () => {
      it("cost-efficient should resolve to Gemini 2.5 Flash Thinking", () => {
        const config: UserModelStrategyConfig = {
          strategy: "cost-efficient",
          subscribedProviders: [],
        };
        const result = resolveModelStrategy(config);
        expect(result.strategy).toBe("cost-efficient");
        expect(result.tierLabel).toBe("MoA 크레딧 (기본)");
        expect(result.parallel).toBe(false);
        expect(result.selectedModels).toHaveLength(1);
        expect(result.selectedModels[0].provider).toBe("gemini");
        expect(result.selectedModels[0].model).toBe("gemini-2.5-flash-thinking");
        expect(result.modelConfig?.thinkingBudget).toBe(-1);
      });

      it("max-performance should resolve to Claude Opus 4.6", () => {
        const config: UserModelStrategyConfig = {
          strategy: "max-performance",
          subscribedProviders: [],
        };
        const result = resolveModelStrategy(config);
        expect(result.strategy).toBe("max-performance");
        expect(result.tierLabel).toBe("MoA 크레딧 (기본)");
        expect(result.parallel).toBe(false);
        expect(result.selectedModels).toHaveLength(1);
        expect(result.selectedModels[0].provider).toBe("anthropic");
        expect(result.selectedModels[0].model).toBe("claude-opus-4-6");
        expect(result.modelConfig).toBeUndefined();
      });
    });

    describe("with API key (subscribed provider)", () => {
      it("anthropic + cost-efficient should use claude-haiku-4-5", () => {
        const config: UserModelStrategyConfig = {
          strategy: "cost-efficient",
          subscribedProviders: ["anthropic"],
        };
        const result = resolveModelStrategy(config);
        expect(result.tierLabel).toBe("API 키 보유 사용자");
        expect(result.selectedModels[0].provider).toBe("anthropic");
        expect(result.selectedModels[0].model).toBe("claude-haiku-4-5");
        expect(result.explanation).toContain("추가 비용 없음");
      });

      it("anthropic + max-performance should use claude-opus-4-6", () => {
        const config: UserModelStrategyConfig = {
          strategy: "max-performance",
          subscribedProviders: ["anthropic"],
        };
        const result = resolveModelStrategy(config);
        expect(result.tierLabel).toBe("API 키 보유 사용자");
        expect(result.selectedModels[0].provider).toBe("anthropic");
        expect(result.selectedModels[0].model).toBe("claude-opus-4-6");
      });

      it("openai + cost-efficient should use gpt-4o-mini", () => {
        const config: UserModelStrategyConfig = {
          strategy: "cost-efficient",
          subscribedProviders: ["openai"],
        };
        const result = resolveModelStrategy(config);
        expect(result.selectedModels[0].provider).toBe("openai");
        expect(result.selectedModels[0].model).toBe("gpt-4o-mini");
      });

      it("openai + max-performance should use gpt-5.2", () => {
        const config: UserModelStrategyConfig = {
          strategy: "max-performance",
          subscribedProviders: ["openai"],
        };
        const result = resolveModelStrategy(config);
        expect(result.selectedModels[0].provider).toBe("openai");
        expect(result.selectedModels[0].model).toBe("gpt-5.2");
      });

      it("gemini + cost-efficient should use gemini-2.5-flash", () => {
        const config: UserModelStrategyConfig = {
          strategy: "cost-efficient",
          subscribedProviders: ["gemini"],
        };
        const result = resolveModelStrategy(config);
        expect(result.selectedModels[0].provider).toBe("gemini");
        expect(result.selectedModels[0].model).toBe("gemini-2.5-flash");
      });

      it("should use first provider when multiple API keys are registered", () => {
        const config: UserModelStrategyConfig = {
          strategy: "cost-efficient",
          subscribedProviders: ["openai", "anthropic"],
        };
        const result = resolveModelStrategy(config);
        expect(result.selectedModels[0].provider).toBe("openai");
      });
    });

    describe("primary override", () => {
      it("should respect primary override regardless of other settings", () => {
        const config: UserModelStrategyConfig = {
          strategy: "cost-efficient",
          subscribedProviders: ["anthropic"],
          primaryOverride: "openai/gpt-4o",
        };
        const result = resolveModelStrategy(config);
        expect(result.tierLabel).toBe("사용자 지정 모델");
        expect(result.selectedModels[0].provider).toBe("openai");
        expect(result.selectedModels[0].model).toBe("gpt-4o");
      });
    });

    describe("fallback behavior", () => {
      it("should fallback to cost-efficient for invalid strategy", () => {
        const config = {
          strategy: "invalid-strategy" as "cost-efficient",
          subscribedProviders: [],
        };
        const result = resolveModelStrategy(config);
        expect(result.strategy).toBe("cost-efficient");
      });
    });
  });

  describe("explainModelStrategy", () => {
    it("should show MoA credit info when no API keys", () => {
      const config: UserModelStrategyConfig = {
        strategy: "cost-efficient",
        subscribedProviders: [],
      };
      const text = explainModelStrategy(config);
      expect(text).toContain("가성비 전략");
      expect(text).toContain("MoA 크레딧");
      expect(text).toContain("Gemini 2.5 Flash (Thinking)");
      expect(text).toContain("thinkingBudget");
    });

    it("should show API key provider info when keys are registered", () => {
      const config: UserModelStrategyConfig = {
        strategy: "max-performance",
        subscribedProviders: ["anthropic"],
      };
      const text = explainModelStrategy(config);
      expect(text).toContain("최고성능 전략");
      expect(text).toContain("등록된 API 키");
      expect(text).toContain("claude-opus-4-6");
      expect(text).toContain("추가 비용 없음");
    });

    it("should show max-performance MoA credit model when no keys", () => {
      const config: UserModelStrategyConfig = {
        strategy: "max-performance",
        subscribedProviders: [],
      };
      const text = explainModelStrategy(config);
      expect(text).toContain("Claude Opus 4.6");
      expect(text).toContain("크레딧 차감");
    });
  });
});
