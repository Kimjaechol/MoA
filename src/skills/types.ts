export interface SkillApiKeyConfig {
  /** Environment variable name, e.g. "BRAVE_SEARCH_API_KEY" */
  envVar: string;
  /** What this key enables */
  description: string;
  /** Whether the key is required (false = has free fallback) */
  required: boolean;
  /** Description of free alternative when key is absent */
  freeFallback?: string;
  /** Optional regex to validate key format */
  validatePattern?: RegExp;
}

/**
 * Known LLM providers that a user may have configured.
 * These are checked as a middle-tier fallback: when the dedicated skill
 * API key is missing but the user has a paid LLM that can perform the task.
 */
export interface LlmProviderConfig {
  /** Provider identifier */
  id: string;
  /** Human-readable provider name */
  name: string;
  /** Environment variable that holds the API key */
  envVar: string;
  /** Capabilities this provider supports */
  capabilities: LlmCapability[];
  /** Optional regex to validate key format */
  validatePattern?: RegExp;
}

/** Capabilities that an LLM provider may support. */
export type LlmCapability =
  | "text-generation"
  | "summarization"
  | "web-search"
  | "image-generation"
  | "image-analysis"
  | "audio-transcription"
  | "code-generation"
  | "translation"
  | "long-context"
  | "video-generation"
  | "embedding";

/** The three tiers of fallback resolution, in priority order. */
export type FallbackTier = "skill-api" | "user-llm" | "free-fallback";

/** Result of resolving the best available strategy for a skill. */
export interface FallbackResolution {
  /** Which tier was resolved */
  tier: FallbackTier;
  /** Description of the resolved strategy */
  strategy: string;
  /** Provider or tool name */
  provider: string;
  /** The env var that is being used (if any) */
  envVar?: string;
}

export interface MoaSkillDefinition {
  id: string;
  name: string;
  tier: 1 | 2 | 3;
  category: string;
  apiKeys?: SkillApiKeyConfig[];
  requiresBins?: string[];
  /** Whether this skill ships with MoA */
  bundled: boolean;
}

export interface LearningEntry {
  id: string;
  timestamp: string;
  type: "correction" | "error_recovery" | "preference" | "insight";
  /** What triggered the learning */
  trigger: string;
  /** What was learned */
  correction: string;
  /** Surrounding context */
  context?: string;
  /** How many times this learning was applied */
  appliedCount: number;
}

export interface IntegrityCheckResult {
  file: string;
  expectedHash: string;
  actualHash: string;
  status: "ok" | "modified" | "missing";
}

// =====================================================================
// Model Strategy Types
// =====================================================================

/**
 * User-selectable model strategy.
 *
 * - "cost-efficient": Minimize cost while maintaining acceptable quality.
 *     무료 SLM → 유료 LLM 무료한도 → 유료 LLM 가성비 → 유료 LLM 최고급
 *     (사용자가 이미 유료 구독 중인 LLM이 있으면 우선 적용)
 *
 * - "max-performance": Always use the best available model.
 *     현 시점 최고성능 유료 LLM 적용.
 *     1개 모델로 처리 실패 시 여러 최고급 모델을 병렬 처리.
 */
export type ModelStrategyId = "cost-efficient" | "max-performance";

/** A single tier in the model resolution chain. */
export interface ModelStrategyTier {
  /** Tier priority (lower = tried first) */
  priority: number;
  /** Human-readable tier label */
  label: string;
  /** Description of what this tier does */
  description: string;
  /** Model references for this tier (provider/model format) */
  models: string[];
  /** Whether this tier is free */
  free: boolean;
}

/** Full definition of a model strategy. */
export interface ModelStrategyDefinition {
  id: ModelStrategyId;
  /** Display name */
  name: string;
  /** Short description for UI */
  description: string;
  /** Ordered tiers (tried in priority order) */
  tiers: ModelStrategyTier[];
  /** Whether to try parallel execution on failure (max-performance only) */
  parallelFallback: boolean;
}

/** User's persisted model strategy preference. */
export interface UserModelStrategyConfig {
  /** Selected strategy */
  strategy: ModelStrategyId;
  /** User's subscribed LLM provider IDs (for cost-efficient priority) */
  subscribedProviders?: string[];
  /** Custom primary model override (optional) */
  primaryOverride?: string;
}

/** Result of model strategy resolution. */
export interface ModelStrategyResolution {
  /** Which strategy was used */
  strategy: ModelStrategyId;
  /** Which tier resolved */
  tierLabel: string;
  /** Selected model(s) */
  selectedModels: Array<{ provider: string; model: string }>;
  /** Whether parallel execution is being used */
  parallel: boolean;
  /** Human-readable explanation */
  explanation: string;
}
