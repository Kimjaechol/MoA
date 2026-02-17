import type {
  ModelStrategyDefinition,
  ModelStrategyId,
  ModelStrategyResolution,
  UserModelStrategyConfig,
} from "./types.js";
import { getConfiguredLlmProviders, LLM_PROVIDERS } from "./api-key-manager.js";

// =====================================================================
// Agent Role Types
// =====================================================================

/**
 * 에이전트 역할별 모델 배정 기준:
 *
 * - "main": 메인 에이전트 (복잡한 계획/코드) → maxPerformance 모델
 * - "sub": 서브 에이전트, 요약/압축 → costEfficient 모델
 * - "heartbeat": Heartbeat → 항상 로컬 SLM (Qwen3 0.6B via Ollama)
 */
export type AgentRole = "main" | "sub" | "heartbeat";

// =====================================================================
// Local SLM (Heartbeat) Configuration
// =====================================================================

/**
 * Heartbeat용 로컬 SLM 설정.
 * Ollama + Qwen3 0.6B (Q4_K_M 양자화, ~400MB)
 *
 * 설치: bash scripts/install-slm.sh
 * 수동: ollama pull qwen3:0.6b-q4_K_M
 */
export const LOCAL_HEARTBEAT_MODEL = {
  provider: "ollama",
  model: "qwen3:0.6b-q4_K_M",
  displayName: "Qwen3 0.6B (로컬 SLM)",
  ollamaBaseUrl: "http://127.0.0.1:11434/v1",
} as const;

// =====================================================================
// Provider-Specific Model Maps
// =====================================================================

/**
 * 각 LLM 프로바이더별 전략에 맞는 모델 매핑
 *
 * costEfficient: 서브 에이전트, 요약/압축용 (가성비 모델)
 * maxPerformance: 메인 에이전트용 (최고 성능 모델)
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
    costEfficient: "gemini-3-flash",
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
 * 크레딧 차감 금액 = 원가(운영자가 API 제공사에 지불하는 비용)의 2배.
 *
 * 역할별 배정 (API 키 미입력 시):
 *
 * [메인 에이전트]
 * - 최고성능 전략: Claude Opus 4.6 — $5/$25 per 1M tokens (200K+ 시 $10/$37.5)
 * - 가성비 전략: Gemini 3.0 Pro — ~$2~2.5/$12 per 1M tokens (200K+ 시 $4/$18)
 *
 * [서브 에이전트 / 요약 / 압축]
 * - 항상: Gemini 3.0 Flash — $0.15/$0.60 per 1M tokens
 *
 * [Heartbeat]
 * - 항상: 로컬 SLM (Qwen3 0.6B via Ollama) — 비용 $0
 */
export const MOA_CREDIT_MAIN_MODELS: Record<
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
    model: "gemini-3-pro",
    displayName: "Gemini 3.0 Pro",
  },
  "max-performance": {
    provider: "anthropic",
    model: "claude-opus-4-6",
    displayName: "Claude Opus 4.6",
  },
};

export const MOA_CREDIT_SUB_MODEL = {
  provider: "gemini",
  model: "gemini-3-flash",
  displayName: "Gemini 3.0 Flash",
} as const;

// Backward-compatible alias
export const MOA_CREDIT_MODELS = MOA_CREDIT_MAIN_MODELS;

// =====================================================================
// Model Strategy Definitions (for display/explanation)
// =====================================================================

/**
 * 가성비 전략
 *
 * - API 키 보유 → 메인: maxPerformance, 서브: costEfficient (추가 비용 없음)
 * - API 키 없음 → 메인: Gemini 3.0 Pro, 서브: Gemini 3.0 Flash (원가의 2배 크레딧 차감)
 * - Heartbeat → 항상 로컬 SLM (Qwen3 0.6B)
 */
const COST_EFFICIENT_STRATEGY: ModelStrategyDefinition = {
  id: "cost-efficient",
  name: "가성비 전략",
  description:
    "메인: API 키 시 해당 LLM 최고성능, 없으면 Gemini 3.0 Pro. 서브: 가성비 모델. Heartbeat: 로컬 SLM. (원가의 2배 크레딧 차감)",
  tiers: [
    {
      priority: 1,
      label: "API 키 보유 사용자",
      description: "메인: maxPerformance / 서브: costEfficient (크레딧 차감 없음)",
      models: Object.entries(PROVIDER_MODELS).map(
        ([provider, m]) => `${provider}/${m.maxPerformance}`,
      ),
      free: false,
    },
    {
      priority: 2,
      label: "MoA 크레딧 (기본)",
      description: "메인: Gemini 3.0 Pro / 서브: Gemini 3.0 Flash (크레딧 차감)",
      models: ["gemini/gemini-3-pro", "gemini/gemini-3-flash"],
      free: false,
    },
  ],
  parallelFallback: false,
};

/**
 * 최고성능 전략
 *
 * - API 키 보유 → 메인: maxPerformance, 서브: costEfficient (추가 비용 없음)
 * - API 키 없음 → 메인: Claude Opus 4.6, 서브: Gemini 3.0 Flash (원가의 2배 크레딧 차감)
 * - Heartbeat → 항상 로컬 SLM (Qwen3 0.6B)
 */
const MAX_PERFORMANCE_STRATEGY: ModelStrategyDefinition = {
  id: "max-performance",
  name: "최고성능 전략",
  description:
    "메인: API 키 시 해당 LLM 최고성능, 없으면 Claude Opus 4.6. 서브: 가성비 모델. Heartbeat: 로컬 SLM. (원가의 2배 크레딧 차감)",
  tiers: [
    {
      priority: 1,
      label: "API 키 보유 사용자",
      description: "메인: maxPerformance / 서브: costEfficient (크레딧 차감 없음)",
      models: Object.entries(PROVIDER_MODELS).map(
        ([provider, m]) => `${provider}/${m.maxPerformance}`,
      ),
      free: false,
    },
    {
      priority: 2,
      label: "MoA 크레딧 (기본)",
      description: "메인: Claude Opus 4.6 / 서브: Gemini 3.0 Flash (크레딧 차감)",
      models: ["anthropic/claude-opus-4-6", "gemini/gemini-3-flash"],
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
 * 역할별 모델 전략 해석 (Role-Aware Model Resolution)
 *
 * 1단계: API 키 보유 사용자
 *   - 메인 에이전트 → PROVIDER_MODELS[provider].maxPerformance
 *   - 서브 에이전트 → PROVIDER_MODELS[provider].costEfficient
 *   - Heartbeat → 항상 로컬 SLM (Qwen3 0.6B)
 *
 * 2단계: API 키 미입력 (MoA 크레딧 사용)
 *   - 메인 에이전트 →
 *       최고성능 전략: Claude Opus 4.6
 *       가성비 전략: Gemini 3.0 Pro
 *   - 서브 에이전트 → Gemini 3.0 Flash (항상)
 *   - Heartbeat → 로컬 SLM (항상, 비용 $0)
 *
 * 주의: 200K 토큰 초과 시 API 요금이 인상됨 → billing에서 자동 반영.
 */
export function resolveModelStrategy(
  config: UserModelStrategyConfig,
  _taskComplexity: "simple" | "complex" = "simple",
  role: AgentRole = "main",
): ModelStrategyResolution {
  // Heartbeat는 항상 로컬 SLM (전략/API 키 무관)
  if (role === "heartbeat") {
    return {
      strategy: config.strategy,
      tierLabel: "로컬 SLM (Heartbeat)",
      selectedModels: [{ provider: LOCAL_HEARTBEAT_MODEL.provider, model: LOCAL_HEARTBEAT_MODEL.model }],
      parallel: false,
      explanation: `Heartbeat → ${LOCAL_HEARTBEAT_MODEL.displayName} (로컬 실행, 비용 $0)`,
    };
  }

  const strategyDef = MODEL_STRATEGIES[config.strategy];
  if (!strategyDef) {
    return resolveModelStrategy({ ...config, strategy: "cost-efficient" }, _taskComplexity, role);
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
    const primaryProvider = subscribedProviders[0];
    const providerModels = PROVIDER_MODELS[primaryProvider];

    if (providerModels) {
      // 역할에 따라 모델 선택
      const model = role === "sub"
        ? providerModels.costEfficient
        : providerModels.maxPerformance;

      const roleLabel = role === "sub" ? "서브 에이전트" : "메인 에이전트";
      const modelTier = role === "sub" ? "가성비" : "최고 성능";

      const providerName =
        LLM_PROVIDERS.find((p) => p.id === primaryProvider)?.name ?? providerModels.displayName;

      return {
        strategy: config.strategy,
        tierLabel: "API 키 보유 사용자",
        selectedModels: [{ provider: primaryProvider, model }],
        parallel: false,
        explanation: `${providerName} 구독 → ${roleLabel}: ${modelTier} 모델 ${model} 적용 (추가 비용 없음)`,
      };
    }
  }

  // 3. API 키 없음 → MoA 크레딧 차감 (원가의 2배)
  if (role === "sub") {
    // 서브 에이전트는 항상 Gemini 3.0 Flash
    return {
      strategy: config.strategy,
      tierLabel: "MoA 크레딧 (서브 에이전트)",
      selectedModels: [{ provider: MOA_CREDIT_SUB_MODEL.provider, model: MOA_CREDIT_SUB_MODEL.model }],
      parallel: false,
      explanation: `MoA 크레딧 → 서브 에이전트: ${MOA_CREDIT_SUB_MODEL.displayName} 적용 (원가의 2배 크레딧 차감)`,
    };
  }

  // 메인 에이전트 → 전략에 따라 모델 결정
  const creditModel = MOA_CREDIT_MAIN_MODELS[config.strategy];

  return {
    strategy: config.strategy,
    tierLabel: "MoA 크레딧 (메인 에이전트)",
    selectedModels: [{ provider: creditModel.provider, model: creditModel.model }],
    parallel: false,
    explanation:
      config.strategy === "cost-efficient"
        ? `MoA 크레딧 → 메인 에이전트: ${creditModel.displayName} 적용 (원가의 2배 크레딧 차감)`
        : `MoA 크레딧 → 메인 에이전트: ${creditModel.displayName} 적용 (원가의 2배 크레딧 차감)`,
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
      return [
        `  • ${providerName}`,
        `    메인: ${models.maxPerformance}`,
        `    서브: ${models.costEfficient}`,
      ].join("\n");
    });

    lines.push("🔑 등록된 API 키:");
    lines.push(...providerDetails);
    lines.push(`  💓 Heartbeat: ${LOCAL_HEARTBEAT_MODEL.displayName} (로컬)`);
    lines.push("   → 이미 구독 중인 LLM을 사용하므로 추가 비용 없음");
  } else {
    // MoA 크레딧 사용자
    const mainModel = MOA_CREDIT_MAIN_MODELS[config.strategy];
    lines.push("💳 MoA 크레딧 사용 (API 키 미등록)");
    lines.push(`   메인 에이전트: ${mainModel.displayName}`);
    lines.push(`   서브 에이전트: ${MOA_CREDIT_SUB_MODEL.displayName}`);
    lines.push(`   💓 Heartbeat: ${LOCAL_HEARTBEAT_MODEL.displayName} (로컬, 비용 $0)`);
    lines.push("   → 크레딧 차감: 원가의 2배 (최초 가입 시 무료 크레딧 제공)");
    lines.push("   → 200K 토큰 초과 시 프리미엄 요금 구간 자동 적용");
  }

  return lines.join("\n");
}

/**
 * Validate a strategy ID string.
 */
export function isValidStrategy(value: unknown): value is ModelStrategyId {
  return value === "cost-efficient" || value === "max-performance";
}
