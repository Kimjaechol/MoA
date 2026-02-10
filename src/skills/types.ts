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
