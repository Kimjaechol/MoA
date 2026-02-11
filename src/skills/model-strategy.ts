import type {
  ModelStrategyDefinition,
  ModelStrategyId,
  ModelStrategyResolution,
  UserModelStrategyConfig,
} from "./types.js";
import { getConfiguredLlmProviders, LLM_PROVIDERS } from "./api-key-manager.js";

// =====================================================================
// Provider-Specific Model Maps
// =====================================================================

/**
 * 각 LLM 프로바이더별 전략에 맞는 모델 매핑
 *
 * costEfficient: 충분한 능력을 가진 모델 중 가장 저렴한 모델
 * maxPerformance: 가장 최신, 최고 성능의 모델
 */
export const PROVIDER_MODELS: Record<
  string,
  { costEfficient: string; maxPerformance: string; displayName: string }
> = {
  anthropic: {
    costEfficient: "claude-haiku-4-5",
    maxPerformance: "claude-opus-4-6",
    displayName: "Anthropic (Claude)",
  },
  openai: {
    costEfficient: "gpt-4o-mini",
    maxPerformance: "gpt-5.2",
    displayName: "OpenAI",
  },
  gemini: {
    costEfficient: "gemini-2.5-flash",
    maxPerformance: "gemini-3-pro",
    displayName: "Google Gemini",
  },
  xai: {
    costEfficient: "grok-3-mini",
    maxPerformance: "grok-3",
    displayName: "xAI (Grok)",
  },
  deepseek: {
    costEfficient: "deepseek-chat",
    maxPerformance: "deepseek-r1",
    displayName: "DeepSeek",
  },
  groq: {
    costEfficient: "kimi-k2-0905",
    maxPerformance: "kimi-k2-0905",
    displayName: "Groq (Kimi K2)",
  },
  mistral: {
    costEfficient: "mistral-small-latest",
    maxPerformance: "mistral-large-latest",
    displayName: "Mistral AI",
  },
};

// =====================================================================
// MoA 크레딧 기본 모델 (API 키 미입력 사용자용)
// =====================================================================

/**
 * API 키를 입력하지 않은 사용자에게 적용되는 기본 모델.
 * 크레딧 차감 방식으로 운영 (최초 가입 시 일정량 무료 크레딧 제공).
 *
 * - 가성비: Gemini 2.5 Flash (Thinking) — $0.30/$2.50 per 1M tokens
 *   Thinking 동적 할당 (thinkingBudget: -1) 적용, 비용 추가 부담 없음
 * - 최고성능: Claude Opus 4.6 — $5/$25 per 1M tokens
 *   Terminal-Bench 65.4%, BigLaw 90.2%, SWE-bench 80.8%
 */
export const MOA_CREDIT_MODELS: Record<
  ModelStrategyId,
  {
    provider: string;
    model: string;
    displayName: string;
    thinkingBudget?: number;
  }
> = {
  "cost-efficient": {
    provider: "gemini",
    model: "gemini-2.5-flash-thinking",
    displayName: "Gemini 2.5 Flash (Thinking)",
    thinkingBudget: -1, // 동적 할당 — 비용 추가 없음
  },
  "max-performance": {
    provider: "anthropic",
    model: "claude-opus-4-6",
    displayName: "Claude Opus 4.6",
  },
};

// =====================================================================
// Model Strategy Definitions (for display/explanation)
// =====================================================================

/**
 * 가성비 전략
 *
 * - API 키 보유 → 해당 LLM의 가성비 최적 모델 (추가 비용 없음)
 * - API 키 없음 → MoA 크레딧으로 Gemini 2.5 Flash (Thinking) 사용
 */
const COST_EFFICIENT_STRATEGY: ModelStrategyDefinition = {
  id: "cost-efficient",
  name: "가성비 전략",
  description:
    "API 키가 있으면 해당 LLM의 가성비 모델을, 없으면 MoA 크레딧으로 Gemini 2.5 Flash (Thinking)를 사용합니다.",
  tiers: [
    {
      priority: 1,
      label: "API 키 보유 사용자",
      description: "사용자의 LLM 구독에서 가성비 최적 모델 자동 선택 (추가 비용 없음)",
      models: Object.entries(PROVIDER_MODELS).map(
        ([provider, m]) => `${provider}/${m.costEfficient}`,
      ),
      free: false,
    },
    {
      priority: 2,
      label: "MoA 크레딧 (기본)",
      description: "Gemini 2.5 Flash (Thinking) — Thinking 동적 할당, 크레딧 차감",
      models: ["gemini/gemini-2.5-flash-thinking"],
      free: false,
    },
  ],
  parallelFallback: false,
};

/**
 * 최고성능 전략
 *
 * - API 키 보유 → 해당 LLM의 최고 성능, 최신 모델 (추가 비용 없음)
 * - API 키 없음 → MoA 크레딧으로 Claude Opus 4.6 사용
 */
const MAX_PERFORMANCE_STRATEGY: ModelStrategyDefinition = {
  id: "max-performance",
  name: "최고성능 전략",
  description:
    "API 키가 있으면 해당 LLM의 최고 성능 모델을, 없으면 MoA 크레딧으로 Claude Opus 4.6을 사용합니다.",
  tiers: [
    {
      priority: 1,
      label: "API 키 보유 사용자",
      description: "사용자의 LLM 구독에서 최고 성능 모델 자동 선택 (추가 비용 없음)",
      models: Object.entries(PROVIDER_MODELS).map(
        ([provider, m]) => `${provider}/${m.maxPerformance}`,
      ),
      free: false,
    },
    {
      priority: 2,
      label: "MoA 크레딧 (기본)",
      description: "Claude Opus 4.6 — 코딩/법률/추론 모든 영역 최강",
      models: ["anthropic/claude-opus-4-6"],
      free: false,
    },
  ],
  parallelFallback: false,
};

/** All available strategies indexed by ID. */
export const MODEL_STRATEGIES: Record<ModelStrategyId, ModelStrategyDefinition> = {
  "cost-efficient": COST_EFFICIENT_STRATEGY,
  "max-performance": MAX_PERFORMANCE_STRATEGY,
};

/** Default strategy for new users. */
export const DEFAULT_MODEL_STRATEGY: ModelStrategyId = "cost-efficient";

// =====================================================================
// Strategy Resolution
// =====================================================================

/**
 * Detect which LLM providers the user currently has configured
 * (via environment variables / API keys).
 */
export function detectSubscribedProviders(): string[] {
  return getConfiguredLlmProviders().map((p) => p.id);
}

/**
 * Resolve the model strategy for the current request.
 *
 * 핵심 로직:
 * 1. primaryOverride → 사용자 지정 모델 사용
 * 2. API 키 등록 프로바이더 있음 → 해당 프로바이더의 모델만 사용
 *    - cost-efficient → 가성비 모델 (충분한 능력의 가장 저렴한 모델)
 *    - max-performance → 최고 성능 모델 (최신/최강 모델)
 * 3. API 키 없음 → MoA 크레딧 차감 기본 모델
 *    - cost-efficient → Gemini 2.5 Flash (Thinking)
 *    - max-performance → Claude Opus 4.6
 */
export function resolveModelStrategy(
  config: UserModelStrategyConfig,
  _taskComplexity: "simple" | "complex" = "simple",
): ModelStrategyResolution {
  const strategyDef = MODEL_STRATEGIES[config.strategy];
  if (!strategyDef) {
    // Fallback to cost-efficient if invalid
    return resolveModelStrategy({ ...config, strategy: "cost-efficient" }, _taskComplexity);
  }

  // 1. Primary override (사용자 직접 지정)
  if (config.primaryOverride) {
    const [provider, model] = config.primaryOverride.split("/");
    if (provider && model) {
      return {
        strategy: config.strategy,
        tierLabel: "사용자 지정 모델",
        selectedModels: [{ provider, model }],
        parallel: false,
        explanation: `사용자 지정 모델 ${config.primaryOverride}을(를) 사용합니다.`,
      };
    }
  }

  // 2. API 키 등록 프로바이더 확인
  const subscribedProviders = config.subscribedProviders ?? detectSubscribedProviders();

  if (subscribedProviders.length > 0) {
    // 이미 구독 중인 LLM의 API 키가 있는 사용자
    // → 해당 프로바이더의 모델만 사용 (추가 비용 없음, 이중 결제 방지)
    const primaryProvider = subscribedProviders[0];
    const providerModels = PROVIDER_MODELS[primaryProvider];

    if (providerModels) {
      const model =
        config.strategy === "cost-efficient"
          ? providerModels.costEfficient
          : providerModels.maxPerformance;

      const providerName =
        LLM_PROVIDERS.find((p) => p.id === primaryProvider)?.name ?? providerModels.displayName;

      return {
        strategy: config.strategy,
        tierLabel: "API 키 보유 사용자",
        selectedModels: [{ provider: primaryProvider, model }],
        parallel: false,
        explanation:
          config.strategy === "cost-efficient"
            ? `${providerName} 구독 → 가성비 모델 ${model} 적용 (추가 비용 없음)`
            : `${providerName} 구독 → 최고 성능 모델 ${model} 적용 (추가 비용 없음)`,
      };
    }
  }

  // 3. API 키 없음 → MoA 크레딧 기본 모델 (크레딧 차감)
  const creditModel = MOA_CREDIT_MODELS[config.strategy];

  return {
    strategy: config.strategy,
    tierLabel: "MoA 크레딧 (기본)",
    selectedModels: [{ provider: creditModel.provider, model: creditModel.model }],
    parallel: false,
    explanation:
      config.strategy === "cost-efficient"
        ? `MoA 크레딧 → ${creditModel.displayName} 적용 (Thinking 동적 할당)`
        : `MoA 크레딧 → ${creditModel.displayName} 적용 (코딩/법률/추론 최강)`,
    modelConfig:
      creditModel.thinkingBudget !== undefined
        ? { thinkingBudget: creditModel.thinkingBudget }
        : undefined,
  };
}

/**
 * Return a user-facing summary of the strategy configuration.
 */
export function explainModelStrategy(config: UserModelStrategyConfig): string {
  const strategyDef = MODEL_STRATEGIES[config.strategy];
  if (!strategyDef) return "알 수 없는 전략";

  const subscribedProviders = config.subscribedProviders ?? detectSubscribedProviders();
  const lines: string[] = [];

  lines.push(`📋 모델 전략: ${strategyDef.name}`);
  lines.push(`   ${strategyDef.description}`);
  lines.push("");

  if (subscribedProviders.length > 0) {
    // API 키 등록 사용자
    const providerDetails = subscribedProviders.map((id) => {
      const models = PROVIDER_MODELS[id];
      const providerName =
        models?.displayName ?? LLM_PROVIDERS.find((p) => p.id === id)?.name ?? id;
      if (!models) return `  • ${providerName} (모델 매핑 없음)`;
      const selectedModel =
        config.strategy === "cost-efficient" ? models.costEfficient : models.maxPerformance;
      return `  • ${providerName} → ${selectedModel}`;
    });

    lines.push("🔑 등록된 API 키:");
    lines.push(...providerDetails);
    lines.push("   → 이미 구독 중인 LLM을 사용하므로 추가 비용 없음");
  } else {
    // MoA 크레딧 사용자
    const creditModel = MOA_CREDIT_MODELS[config.strategy];
    lines.push("💳 MoA 크레딧 사용 (API 키 미등록)");
    lines.push(`   → ${creditModel.displayName}`);
    if (creditModel.thinkingBudget !== undefined) {
      lines.push(`   → Thinking 동적 할당 (thinkingBudget: ${creditModel.thinkingBudget})`);
    }
    lines.push("   → 크레딧 차감 방식 (최초 가입 시 무료 크레딧 제공)");
  }

  return lines.join("\n");
}

/**
 * Validate a strategy ID string.
 */
export function isValidStrategy(value: unknown): value is ModelStrategyId {
  return value === "cost-efficient" || value === "max-performance";
}
