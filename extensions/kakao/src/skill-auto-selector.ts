/**
 * MoA Skill Auto-Selector
 *
 * 이용자의 요청을 분석하여 최적의 스킬/도구를 자동으로 선택합니다.
 *
 * 선택 우선순위:
 * 1. 무료 도구 (API Key 불필요) — 0 크레딧
 * 2. 무료 도구 (API Key 필요, 이용자 보유) — 0 크레딧
 * 3. 유료 도구 (저렴한 순 → 비싼 순) — 크레딧 차감
 *
 * 유료 도구 중에서는 가장 저렴한 것부터 시도하며,
 * 실패 시 다음으로 저렴한 도구로 자동 폴백합니다.
 */

import type { IntentType } from "./intent-classifier.js";
import {
  TOOL_PRICING,
  type ToolPricing,
  type ToolCategory,
  formatCreditsCompact,
} from "./pricing-table.js";

// ============================================
// Types
// ============================================

export interface SkillSelection {
  /** Selected tool ID */
  toolId: string;
  /** Display name */
  toolName: string;
  /** Credits that will be consumed */
  creditsCost: number;
  /** Whether this is using user's own API key (no credit charge) */
  usesOwnKey: boolean;
  /** Tier: free / freemium / paid */
  tier: "free" | "freemium" | "paid";
  /** Provider name */
  provider: string;
  /** Why this tool was selected */
  selectionReason: string;
}

export interface AutoSelectionResult {
  /** Primary selected skill */
  primary: SkillSelection;
  /** Fallback chain (if primary fails) */
  fallbacks: SkillSelection[];
  /** All candidate tools considered */
  candidates: SkillSelection[];
  /** Intent that triggered this selection */
  intent: IntentType;
  /** Category used for matching */
  category: ToolCategory;
}

// ============================================
// Intent → Category Mapping
// ============================================

const INTENT_CATEGORY_MAP: Record<IntentType, ToolCategory[]> = {
  weather: ["weather"],
  calendar: ["calendar"],
  sports: ["sports"],
  public_data: ["public_data"],
  web_search: ["search"],
  legal_info: ["legal"],
  legal_consult: ["legal"],
  medical_consult: ["search"],   // fallback to web search
  tax_consult: ["search"],       // fallback to web search
  creative_image: ["image"],
  creative_emoticon: ["image"],
  creative_music: ["music"],
  creative_qrcode: ["creative"],
  freepik_generate: ["image"],
  freepik_search: ["search", "image"],
  translate: ["translation"],
  travel_help: ["translation"],
  billing: ["utility"],
  chat: ["llm"],
};

// ============================================
// Intent → Specific Tool Override
// ============================================
// Some intents map directly to a specific tool regardless of category

const INTENT_TOOL_OVERRIDES: Partial<Record<IntentType, string[]>> = {
  creative_qrcode: ["qrcode"],
  travel_help: ["travel_phrases"],
  public_data: ["public_holidays", "air_quality"],
  legal_info: ["legal_rag"],
};

// ============================================
// Core Auto-Selection Logic
// ============================================

/**
 * Check if a tool's API key is available in the environment
 */
function isApiKeyAvailable(tool: ToolPricing): boolean {
  if (!tool.requiresApiKey) return true;
  if (!tool.envVar) return false;
  const value = process.env[tool.envVar];
  return !!value && value.trim() !== "";
}

/**
 * Build a SkillSelection from a ToolPricing entry
 */
function buildSelection(tool: ToolPricing, reason: string): SkillSelection {
  const usesOwnKey = tool.requiresApiKey && isApiKeyAvailable(tool);
  const creditsCost = usesOwnKey && tool.tier === "paid" ? 0 : tool.creditsPerUse;

  return {
    toolId: tool.toolId,
    toolName: tool.name,
    creditsCost,
    usesOwnKey,
    tier: tool.tier,
    provider: tool.provider,
    selectionReason: reason,
  };
}

/**
 * Select the best skill for a given intent.
 *
 * Priority order:
 * 1. Free tools (no API key needed) — always available, 0 credits
 * 2. Freemium tools (API key required, user has it) — 0 credits
 * 3. Paid tools (sorted by cost, cheapest first) — credits charged
 *
 * Within paid tools, cheapest is always tried first.
 */
export function selectSkill(
  intent: IntentType,
  userCredits: number = Infinity,
): AutoSelectionResult {
  const categories = INTENT_CATEGORY_MAP[intent] || ["utility"];
  const primaryCategory = categories[0];

  // Check for direct tool overrides
  const overrideToolIds = INTENT_TOOL_OVERRIDES[intent];

  // Gather all candidate tools for the category
  let categoryTools: ToolPricing[];

  if (overrideToolIds) {
    // Use override tools first, then category tools as fallback
    const overrideTools = overrideToolIds
      .map((id) => TOOL_PRICING.find((t) => t.toolId === id))
      .filter((t): t is ToolPricing => t !== undefined);
    const otherCategoryTools = TOOL_PRICING.filter(
      (t) => categories.includes(t.category) && !overrideToolIds.includes(t.toolId),
    );
    categoryTools = [...overrideTools, ...otherCategoryTools];
  } else {
    categoryTools = TOOL_PRICING.filter((t) => categories.includes(t.category));
  }

  // ━━ Phase 1: Free tools (no API key required) ━━
  const freeTools = categoryTools
    .filter((t) => t.tier === "free")
    .map((t) => buildSelection(t, "무료 도구 (API키 불필요)"));

  // ━━ Phase 2: Freemium tools (API key required, user has it) ━━
  const freemiumTools = categoryTools
    .filter((t) => t.tier === "freemium" && isApiKeyAvailable(t))
    .map((t) => buildSelection(t, "무료 도구 (사용자 API키 사용)"));

  // ━━ Phase 3: Paid tools (sorted by cost ascending — cheapest first) ━━
  const paidTools = categoryTools
    .filter((t) => t.tier === "paid")
    .sort((a, b) => a.creditsPerUse - b.creditsPerUse)
    .filter((t) => {
      // Only include if user has API key OR enough credits
      if (isApiKeyAvailable(t)) return true;
      return t.creditsPerUse <= userCredits;
    })
    .map((t) => {
      if (isApiKeyAvailable(t)) {
        return buildSelection(t, "유료 도구 (사용자 API키 → 무료)");
      }
      return buildSelection(t, `유료 도구 (${formatCreditsCompact(t.creditsPerUse)}/회)`);
    });

  // Combine all candidates in priority order
  const allCandidates = [...freeTools, ...freemiumTools, ...paidTools];

  // Select primary and fallbacks
  const primary = allCandidates[0] ?? buildFallbackSelection(intent);
  const fallbacks = allCandidates.slice(1);

  return {
    primary,
    fallbacks,
    candidates: allCandidates,
    intent,
    category: primaryCategory,
  };
}

/**
 * Build a fallback selection when no tools match
 */
function buildFallbackSelection(intent: IntentType): SkillSelection {
  return {
    toolId: "llm_chat",
    toolName: "LLM 대화",
    creditsCost: 0,
    usesOwnKey: false,
    tier: "free",
    provider: "MoA LLM",
    selectionReason: `${intent}에 맞는 전용 도구 없음 → LLM 직접 처리`,
  };
}

/**
 * Execute skill selection with automatic fallback chain.
 *
 * If the primary tool fails, automatically tries the next tool in the chain.
 * Returns the result of the first successful execution.
 */
export async function executeWithAutoFallback<T>(
  selection: AutoSelectionResult,
  executor: (toolId: string) => Promise<T>,
): Promise<{ result: T; usedTool: SkillSelection; attemptedTools: string[] }> {
  const attemptedTools: string[] = [];
  const chain = [selection.primary, ...selection.fallbacks];

  for (const tool of chain) {
    attemptedTools.push(tool.toolId);
    try {
      const result = await executor(tool.toolId);
      return { result, usedTool: tool, attemptedTools };
    } catch (error) {
      console.warn(
        `[AutoSelector] ${tool.toolId} 실패, 다음 도구 시도:`,
        error instanceof Error ? error.message : error,
      );
      continue;
    }
  }

  throw new Error(
    `모든 도구가 실패했습니다 (시도: ${attemptedTools.join(" → ")})`,
  );
}

/**
 * Format selection result for logging/debugging
 */
export function formatSelectionDebug(result: AutoSelectionResult): string {
  const lines: string[] = [];
  lines.push(`[AutoSelector] Intent: ${result.intent} → Category: ${result.category}`);
  lines.push(`  Primary: ${result.primary.toolName} (${result.primary.tier}, ${formatCreditsCompact(result.primary.creditsCost)})`);
  lines.push(`  Reason: ${result.primary.selectionReason}`);

  if (result.fallbacks.length > 0) {
    lines.push(`  Fallbacks: ${result.fallbacks.map((f) => `${f.toolName}(${formatCreditsCompact(f.creditsCost)})`).join(" → ")}`);
  }

  return lines.join("\n");
}
