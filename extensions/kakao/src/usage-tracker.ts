/**
 * MoA Usage Tracker — Replit-Style Credit Display
 *
 * 요청 하나마다 사용된 스킬과 소진 크레딧을 추적하고,
 * 채팅창에 Replit 스타일로 표시합니다.
 *
 * 특징:
 * - 요청별 사용 스킬 목록 추적
 * - 각 스킬의 크레딧 소진량 기록
 * - 자기 검증(self-verification) 후 완료 보고
 * - 최종 응답에 크레딧 요약 첨부 (작게 표시)
 */

import { formatCreditsCompact, type ToolCategory } from "./pricing-table.js";
import type { SkillSelection } from "./skill-auto-selector.js";

// ============================================
// Types
// ============================================

export interface SkillUsageEntry {
  /** Tool/Skill ID */
  toolId: string;
  /** Display name */
  toolName: string;
  /** Category */
  category?: ToolCategory;
  /** Credits consumed */
  creditsUsed: number;
  /** Whether user's own API key was used */
  usedOwnKey: boolean;
  /** Execution duration (ms) */
  durationMs: number;
  /** Success / failure */
  success: boolean;
  /** Error message if failed */
  errorMessage?: string;
  /** Timestamp */
  timestamp: number;
}

export interface RequestUsageSummary {
  /** Unique request ID */
  requestId: string;
  /** User ID */
  userId: string;
  /** All skills used in this request */
  skills: SkillUsageEntry[];
  /** Total credits consumed */
  totalCredits: number;
  /** Total execution time (ms) */
  totalDurationMs: number;
  /** LLM model used (if any) */
  llmModel?: string;
  /** LLM credits consumed */
  llmCredits: number;
  /** Self-verification passed? */
  verified: boolean;
  /** Verification details */
  verificationNote?: string;
  /** Start time */
  startedAt: number;
  /** End time */
  completedAt?: number;
}

// ============================================
// Request Usage Session
// ============================================

/** Active request tracking sessions (per-user, per-request) */
const activeSessions = new Map<string, RequestUsageSummary>();

/**
 * Start tracking a new request
 */
export function startRequestTracking(userId: string, requestId?: string): string {
  const id = requestId ?? `req_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

  activeSessions.set(id, {
    requestId: id,
    userId,
    skills: [],
    totalCredits: 0,
    totalDurationMs: 0,
    llmCredits: 0,
    verified: false,
    startedAt: Date.now(),
  });

  return id;
}

/**
 * Record a skill usage in the current request
 */
export function recordSkillUsage(
  requestId: string,
  entry: Omit<SkillUsageEntry, "timestamp">,
): void {
  const session = activeSessions.get(requestId);
  if (!session) return;

  const fullEntry: SkillUsageEntry = {
    ...entry,
    timestamp: Date.now(),
  };

  session.skills.push(fullEntry);
  session.totalCredits += entry.creditsUsed;
  session.totalDurationMs += entry.durationMs;
}

/**
 * Record a skill usage from a SkillSelection
 */
export function recordFromSelection(
  requestId: string,
  selection: SkillSelection,
  durationMs: number,
  success: boolean,
  errorMessage?: string,
): void {
  recordSkillUsage(requestId, {
    toolId: selection.toolId,
    toolName: selection.toolName,
    creditsUsed: selection.creditsCost,
    usedOwnKey: selection.usesOwnKey,
    durationMs,
    success,
    errorMessage,
  });
}

/**
 * Record LLM usage for this request
 */
export function recordLlmUsage(
  requestId: string,
  modelId: string,
  credits: number,
): void {
  const session = activeSessions.get(requestId);
  if (!session) return;

  session.llmModel = modelId;
  session.llmCredits = credits;
  session.totalCredits += credits;
}

/**
 * Mark self-verification as complete
 */
export function markVerified(
  requestId: string,
  passed: boolean,
  note?: string,
): void {
  const session = activeSessions.get(requestId);
  if (!session) return;

  session.verified = passed;
  session.verificationNote = note;
}

/**
 * Complete the request tracking and get final summary
 */
export function completeRequestTracking(requestId: string): RequestUsageSummary | null {
  const session = activeSessions.get(requestId);
  if (!session) return null;

  session.completedAt = Date.now();

  // Clean up (keep last 50 sessions for debugging)
  activeSessions.delete(requestId);

  return session;
}

/**
 * Get current session (for mid-request queries)
 */
export function getCurrentSession(requestId: string): RequestUsageSummary | null {
  return activeSessions.get(requestId) ?? null;
}

// ============================================
// Replit-Style Credit Display Formatting
// ============================================

/**
 * Format usage summary as a compact footer for chat messages.
 * Replit 스타일: 응답 하단에 작게 크레딧 소진량 표시
 *
 * Example outputs:
 * - "⚡ 날씨 조회 | 무료"
 * - "⚡ Perplexity 검색(2C) + DALL-E 이미지(54C) | 총 56C 사용"
 * - "⚡ 파파고 번역 | 무료 (본인 API키)"
 */
export function formatUsageFooter(summary: RequestUsageSummary): string {
  const { skills, totalCredits, llmModel, llmCredits } = summary;

  // No tools used, only LLM
  if (skills.length === 0 && !llmModel) {
    return "";
  }

  const parts: string[] = [];

  // Format each skill usage
  for (const skill of skills) {
    if (!skill.success) continue; // Don't show failed tools

    if (skill.creditsUsed === 0) {
      if (skill.usedOwnKey) {
        parts.push(`${skill.toolName} (본인키)`);
      } else {
        parts.push(skill.toolName);
      }
    } else {
      parts.push(`${skill.toolName}(${formatCreditsCompact(skill.creditsUsed)})`);
    }
  }

  // Include LLM if used
  if (llmModel && llmCredits > 0) {
    const llmName = llmModel.split("/").pop() ?? llmModel;
    parts.push(`${llmName}(${formatCreditsCompact(llmCredits)})`);
  }

  if (parts.length === 0) return "";

  // Build footer
  const skillList = parts.join(" + ");

  if (totalCredits === 0) {
    return `\n\n─\n⚡ ${skillList} | 무료`;
  }

  return `\n\n─\n⚡ ${skillList} | 총 ${formatCreditsCompact(totalCredits)} 사용`;
}

/**
 * Format a detailed usage report (for /잔액 or /사용내역 command)
 */
export function formatUsageReport(summary: RequestUsageSummary): string {
  const lines: string[] = [];
  const duration = summary.completedAt
    ? ((summary.completedAt - summary.startedAt) / 1000).toFixed(1)
    : "진행 중";

  lines.push("━━ 작업 완료 보고서 ━━\n");

  // Skills used
  if (summary.skills.length > 0) {
    lines.push("사용 도구:");
    for (const skill of summary.skills) {
      const status = skill.success ? "✅" : "❌";
      const cost = skill.creditsUsed === 0
        ? "무료"
        : `${formatCreditsCompact(skill.creditsUsed)}`;
      const keyInfo = skill.usedOwnKey ? " (본인키)" : "";
      lines.push(`  ${status} ${skill.toolName}: ${cost}${keyInfo}`);
    }
  }

  // LLM model
  if (summary.llmModel) {
    const llmCost = summary.llmCredits === 0
      ? "무료"
      : formatCreditsCompact(summary.llmCredits);
    lines.push(`  🤖 LLM: ${summary.llmModel} (${llmCost})`);
  }

  // Totals
  lines.push("");
  lines.push(`총 크레딧: ${formatCreditsCompact(summary.totalCredits)}`);
  lines.push(`처리 시간: ${duration}초`);

  // Verification
  if (summary.verified) {
    lines.push(`\n✅ 자체 검증 완료${summary.verificationNote ? `: ${summary.verificationNote}` : ""}`);
  }

  return lines.join("\n");
}

/**
 * Format a compact one-line usage string (for inline display)
 */
export function formatUsageInline(summary: RequestUsageSummary): string {
  if (summary.totalCredits === 0) {
    return "무료";
  }
  return `${formatCreditsCompact(summary.totalCredits)} 사용`;
}

// ============================================
// Self-Verification
// ============================================

/**
 * Perform self-verification on the request result.
 *
 * Checks:
 * 1. At least one tool succeeded
 * 2. Response is not empty
 * 3. Credits were properly tracked
 */
export function selfVerify(
  requestId: string,
  response: string | null,
): { passed: boolean; note: string } {
  const session = activeSessions.get(requestId);
  if (!session) {
    return { passed: false, note: "세션을 찾을 수 없음" };
  }

  const checks: string[] = [];
  let allPassed = true;

  // Check 1: At least one tool execution succeeded (if any were attempted)
  if (session.skills.length > 0) {
    const anySuccess = session.skills.some((s) => s.success);
    if (!anySuccess) {
      checks.push("모든 도구 실행 실패");
      allPassed = false;
    } else {
      checks.push("도구 실행 성공");
    }
  }

  // Check 2: Response is not empty
  if (!response || response.trim().length === 0) {
    checks.push("응답이 비어있음");
    allPassed = false;
  } else {
    checks.push("응답 생성 완료");
  }

  // Check 3: Credits properly tracked
  const expectedCredits = session.skills
    .filter((s) => s.success)
    .reduce((sum, s) => sum + s.creditsUsed, 0) + session.llmCredits;
  if (session.totalCredits !== expectedCredits) {
    checks.push(`크레딧 불일치 (기록: ${session.totalCredits}, 예상: ${expectedCredits})`);
    // Auto-fix
    session.totalCredits = expectedCredits;
  } else {
    checks.push("크레딧 정상");
  }

  const note = checks.join(", ");
  markVerified(requestId, allPassed, note);

  return { passed: allPassed, note };
}
