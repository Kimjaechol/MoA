import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  explainFallbackResolution,
  findProvidersWithCapability,
  getConfiguredLlmProviders,
  hasLlmProvider,
  LLM_PROVIDERS,
  resolveFallback,
} from "../api-key-manager.js";

describe("3-Tier Fallback Resolution", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    // Clear all relevant env vars
    for (const key of [
      "BRAVE_SEARCH_API_KEY",
      "PERPLEXITY_API_KEY",
      "GEMINI_API_KEY",
      "OPENAI_API_KEY",
      "ANTHROPIC_API_KEY",
      "XAI_API_KEY",
      "DEEPSEEK_API_KEY",
      "MISTRAL_API_KEY",
      "GROQ_API_KEY",
      "FAL_KEY",
      "HF_TOKEN",
    ]) {
      delete process.env[key];
    }
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  describe("LLM Provider Detection", () => {
    it("detects no providers when no env vars are set", () => {
      const configured = getConfiguredLlmProviders();
      expect(configured).toHaveLength(0);
    });

    it("detects OpenAI provider when OPENAI_API_KEY is set", () => {
      process.env.OPENAI_API_KEY = "sk-test1234567890abcdefghijklmnopqrstuvwxyz";
      const configured = getConfiguredLlmProviders();
      expect(configured).toHaveLength(1);
      expect(configured[0].id).toBe("openai");
    });

    it("detects multiple providers when multiple keys are set", () => {
      process.env.OPENAI_API_KEY = "sk-test1234567890abcdefghijklmnopqrstuvwxyz";
      process.env.GEMINI_API_KEY = "test-gemini-key";
      const configured = getConfiguredLlmProviders();
      expect(configured).toHaveLength(2);
      const ids = configured.map((p) => p.id);
      expect(ids).toContain("openai");
      expect(ids).toContain("gemini");
    });

    it("rejects invalid API key format", () => {
      process.env.OPENAI_API_KEY = "invalid-key";
      const openai = LLM_PROVIDERS.find((p) => p.id === "openai")!;
      expect(hasLlmProvider(openai)).toBe(false);
    });

    it("finds providers with specific capability", () => {
      process.env.OPENAI_API_KEY = "sk-test1234567890abcdefghijklmnopqrstuvwxyz";
      const imageProviders = findProvidersWithCapability("image-generation");
      expect(imageProviders).toHaveLength(1);
      expect(imageProviders[0].id).toBe("openai");
    });

    it("returns empty when no provider has capability", () => {
      process.env.DEEPSEEK_API_KEY = "test-key";
      const imageProviders = findProvidersWithCapability("image-generation");
      expect(imageProviders).toHaveLength(0);
    });
  });

  describe("resolveFallback — 3-tier priority", () => {
    it("returns Tier 1 when skill API key is set", () => {
      process.env.BRAVE_SEARCH_API_KEY = "BSAtest1234567890abcdefghij";
      const result = resolveFallback("brave-search");
      expect(result.tier).toBe("skill-api");
      expect(result.provider).toBe("brave-search");
      expect(result.envVar).toBe("BRAVE_SEARCH_API_KEY");
    });

    it("returns Tier 2 (user LLM) when skill API absent but LLM configured", () => {
      // No BRAVE_SEARCH_API_KEY, but user has OpenAI (which has web-search)
      process.env.OPENAI_API_KEY = "sk-test1234567890abcdefghijklmnopqrstuvwxyz";
      const result = resolveFallback("brave-search");
      expect(result.tier).toBe("user-llm");
      expect(result.provider).toBe("openai");
    });

    it("returns Tier 3 (free fallback) when neither skill API nor LLM available", () => {
      const result = resolveFallback("brave-search");
      expect(result.tier).toBe("free-fallback");
      expect(result.strategy).toContain("DuckDuckGo");
    });

    it("prefers Tier 1 over Tier 2 even when both are available", () => {
      process.env.BRAVE_SEARCH_API_KEY = "BSAtest1234567890abcdefghij";
      process.env.OPENAI_API_KEY = "sk-test1234567890abcdefghijklmnopqrstuvwxyz";
      const result = resolveFallback("brave-search");
      expect(result.tier).toBe("skill-api");
    });

    it("uses Gemini as Tier 2 for summarization when available", () => {
      process.env.GEMINI_API_KEY = "test-gemini-key";
      // summarize skill uses GEMINI_API_KEY as its own skill API too,
      // so it should resolve as Tier 1
      const result = resolveFallback("summarize");
      expect(result.tier).toBe("skill-api");
    });

    it("uses OpenAI as Tier 2 for image generation when fal-ai key absent", () => {
      process.env.OPENAI_API_KEY = "sk-test1234567890abcdefghijklmnopqrstuvwxyz";
      const result = resolveFallback("fal-ai");
      expect(result.tier).toBe("user-llm");
      expect(result.provider).toBe("openai");
      expect(result.strategy).toContain("image-generation");
    });

    it("falls back to free for skills with no LLM capability mapping", () => {
      process.env.OPENAI_API_KEY = "sk-test1234567890abcdefghijklmnopqrstuvwxyz";
      // slack-api has no LLM capability mapping
      const result = resolveFallback("slack-api");
      expect(result.tier).toBe("free-fallback");
    });

    it("uses Anthropic for code generation tasks", () => {
      process.env.ANTHROPIC_API_KEY = "sk-ant-test1234567890abcdefghijklmnopqrstuvwxyz";
      const result = resolveFallback("gemini");
      expect(result.tier).toBe("user-llm");
      expect(result.provider).toBe("anthropic");
    });
  });

  describe("explainFallbackResolution", () => {
    it("explains Tier 1 resolution", () => {
      process.env.BRAVE_SEARCH_API_KEY = "BSAtest1234567890abcdefghij";
      const explanation = explainFallbackResolution("brave-search");
      expect(explanation).toContain("Tier 1");
      expect(explanation).toContain("BRAVE_SEARCH_API_KEY");
      expect(explanation).toContain("우선순위 체인");
    });

    it("explains Tier 2 resolution with upgrade hint", () => {
      process.env.OPENAI_API_KEY = "sk-test1234567890abcdefghijklmnopqrstuvwxyz";
      const explanation = explainFallbackResolution("brave-search");
      expect(explanation).toContain("Tier 2");
      expect(explanation).toContain("유료 LLM");
      expect(explanation).toContain("전용 API key");
    });

    it("explains Tier 3 resolution", () => {
      const explanation = explainFallbackResolution("brave-search");
      expect(explanation).toContain("Tier 3");
      expect(explanation).toContain("무료 대안");
      expect(explanation).toContain("우선순위 체인");
    });

    it("shows all three tiers in the priority chain", () => {
      const explanation = explainFallbackResolution("brave-search");
      expect(explanation).toContain("1️⃣ 전용 API");
      expect(explanation).toContain("2️⃣ 유료 LLM");
      expect(explanation).toContain("3️⃣ 무료 대안");
    });
  });
});
