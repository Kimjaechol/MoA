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
