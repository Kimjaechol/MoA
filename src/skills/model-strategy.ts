import type {
  ModelStrategyDefinition,
  ModelStrategyId,
  ModelStrategyResolution,
  ModelStrategyTier,
  UserModelStrategyConfig,
} from "./types.js";
import { getConfiguredLlmProviders, LLM_PROVIDERS } from "./api-key-manager.js";

// =====================================================================
// Model Strategy Definitions
// =====================================================================

/**
 * 최저비용 (가성비) 전략
 *
 * Resolution order:
 * 1. 무료 내장 SLM
 * 2. 유료 LLM의 무료 사용 한도
 * 3. 유료 LLM 가성비 버전 (or user's subscribed LLM first)
 * 4. 유료 LLM 최고 버전
 */
const COST_EFFICIENT_STRATEGY: ModelStrategyDefinition = {
  id: "cost-efficient",
  name: "최저비용 (가성비 전략)",
  description:
    "무료 SLM부터 시작하여 단계적으로 상위 모델을 사용합니다. 이미 구독 중인 유료 LLM이 있다면 우선 적용됩니다.",
  tiers: [
    {
      priority: 1,
      label: "무료 내장 SLM",
      description: "내장된 소형 언어 모델로 무료 처리",
      models: ["local/slm-default"],
      free: true,
    },
    {
      priority: 2,
      label: "유료 LLM 무료 한도",
      description: "유료 LLM의 무료 사용 한도 내에서 처리",
      models: ["gemini/gemini-2.5-flash", "openai/gpt-4o-mini", "anthropic/claude-haiku-4-5"],
      free: true,
    },
    {
      priority: 3,
      label: "유료 LLM 가성비 버전",
      description: "비용 대비 성능이 우수한 유료 모델 사용",
      models: [
        "deepseek/deepseek-chat",
        "anthropic/claude-sonnet-4-5",
        "openai/gpt-4o",
        "gemini/gemini-2.5-pro",
      ],
      free: false,
    },
    {
      priority: 4,
      label: "유료 LLM 최고 버전",
      description: "최고 성능의 프리미엄 모델 사용",
      models: ["anthropic/claude-opus-4-5", "openai/gpt-5.2", "gemini/gemini-3-pro"],
      free: false,
    },
  ],
  parallelFallback: false,
};

/**
 * 최고지능 (최대성능) 전략
 *
 * Resolution order:
 * 1. 현 시점 최고 성능 유료 LLM
 * 2. 병렬 처리: 여러 최고급 모델을 동시 실행하여 최상의 결과 선택
 */
const MAX_PERFORMANCE_STRATEGY: ModelStrategyDefinition = {
  id: "max-performance",
  name: "최고지능 (최대성능 전략)",
  description:
    "현 시점 최고 성능의 AI 모델을 사용합니다. 1개 모델로 처리가 어려운 경우 여러 최고급 모델을 병렬로 실행합니다.",
  tiers: [
    {
      priority: 1,
      label: "최고 성능 단일 모델",
      description: "현 시점 최고 성능의 유료 LLM 단일 실행",
      models: ["anthropic/claude-opus-4-5", "openai/gpt-5.2", "gemini/gemini-3-pro"],
      free: false,
    },
    {
      priority: 2,
      label: "병렬 멀티 모델",
      description: "여러 최고급 LLM을 동시 실행하여 최상의 결과 선택",
      models: [
        "anthropic/claude-opus-4-5",
        "openai/gpt-5.2",
        "gemini/gemini-3-pro",
        "xai/grok-3",
        "deepseek/deepseek-r1",
      ],
      free: false,
    },
  ],
  parallelFallback: true,
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
 * Reorder tiers to prioritize the user's already-subscribed LLM providers.
 * Only applies to cost-efficient strategy.
 */
function reorderForSubscribedProviders(
  tiers: ModelStrategyTier[],
  subscribedProviders: string[],
): ModelStrategyTier[] {
  if (subscribedProviders.length === 0) return tiers;

  return tiers.map((tier) => {
    if (tier.free) return tier;

    // Move subscribed provider models to the front of this tier
    const subscribed: string[] = [];
    const others: string[] = [];

    for (const model of tier.models) {
      const provider = model.split("/")[0];
      if (subscribedProviders.includes(provider)) {
        subscribed.push(model);
      } else {
        others.push(model);
      }
    }

    return { ...tier, models: [...subscribed, ...others] };
  });
}

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
 * @param config - User's model strategy preferences
 * @param taskComplexity - Optional hint about task complexity ("simple" | "complex")
 * @returns Resolution with selected model(s) and explanation
 */
export function resolveModelStrategy(
  config: UserModelStrategyConfig,
  taskComplexity: "simple" | "complex" = "simple",
): ModelStrategyResolution {
  const strategyDef = MODEL_STRATEGIES[config.strategy];
  if (!strategyDef) {
    // Fallback to cost-efficient if invalid
    return resolveModelStrategy({ ...config, strategy: "cost-efficient" }, taskComplexity);
  }

  // Detect subscribed providers from environment
  const subscribedProviders = config.subscribedProviders ?? detectSubscribedProviders();

  // Reorder tiers based on subscribed providers (cost-efficient only)
  const tiers =
    config.strategy === "cost-efficient"
      ? reorderForSubscribedProviders(strategyDef.tiers, subscribedProviders)
      : strategyDef.tiers;

  // For max-performance + complex task, jump to parallel tier
  if (config.strategy === "max-performance" && taskComplexity === "complex") {
    const parallelTier = tiers.find((t) => t.label === "병렬 멀티 모델");
    if (parallelTier) {
      const models = parallelTier.models.map((m) => {
        const [provider, model] = m.split("/");
        return { provider, model };
      });
      return {
        strategy: config.strategy,
        tierLabel: parallelTier.label,
        selectedModels: models,
        parallel: true,
        explanation: `최대성능 전략: ${models.length}개 최고급 모델을 병렬 실행하여 최상의 결과를 선택합니다.`,
      };
    }
  }

  // Apply primary override if set
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

  // Walk through tiers in priority order
  for (const tier of tiers) {
    if (tier.models.length === 0) continue;

    const firstModel = tier.models[0];
    const [provider, model] = firstModel.split("/");

    return {
      strategy: config.strategy,
      tierLabel: tier.label,
      selectedModels: [{ provider, model }],
      parallel: false,
      explanation: buildExplanation(config.strategy, tier, subscribedProviders),
    };
  }

  // Should never reach here, but fallback
  return {
    strategy: config.strategy,
    tierLabel: "기본 모델",
    selectedModels: [{ provider: "anthropic", model: "claude-sonnet-4-5" }],
    parallel: false,
    explanation: "기본 모델을 사용합니다.",
  };
}

function buildExplanation(
  strategy: ModelStrategyId,
  tier: ModelStrategyTier,
  subscribedProviders: string[],
): string {
  const prefix = strategy === "cost-efficient" ? "가성비 전략" : "최대성능 전략";

  if (tier.free) {
    return `${prefix}: ${tier.label} - ${tier.description} (무료)`;
  }

  if (subscribedProviders.length > 0 && strategy === "cost-efficient") {
    const names = subscribedProviders
      .map((id) => LLM_PROVIDERS.find((p) => p.id === id)?.name ?? id)
      .join(", ");
    return `${prefix}: ${tier.label} - 구독 중인 ${names}을(를) 우선 적용합니다.`;
  }

  return `${prefix}: ${tier.label} - ${tier.description}`;
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
    const names = subscribedProviders
      .map((id) => LLM_PROVIDERS.find((p) => p.id === id)?.name ?? id)
      .join(", ");
    lines.push(`🔑 구독 중인 LLM: ${names}`);
    if (config.strategy === "cost-efficient") {
      lines.push("   → 유료 단계에서 구독 중인 LLM이 우선 적용됩니다.");
    }
    lines.push("");
  }

  lines.push("📊 처리 순서:");
  for (const tier of strategyDef.tiers) {
    const freeTag = tier.free ? " (무료)" : " (유료)";
    lines.push(`   ${tier.priority}. ${tier.label}${freeTag}`);
    lines.push(`      ${tier.description}`);
    lines.push(`      모델: ${tier.models.join(", ")}`);
  }

  if (strategyDef.parallelFallback) {
    lines.push("");
    lines.push("⚡ 병렬 처리: 1개 모델 실패 시 여러 최고급 모델을 동시 실행");
  }

  return lines.join("\n");
}

/**
 * Validate a strategy ID string.
 */
export function isValidStrategy(value: unknown): value is ModelStrategyId {
  return value === "cost-efficient" || value === "max-performance";
}
