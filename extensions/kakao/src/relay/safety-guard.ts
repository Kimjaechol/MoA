/**
 * Command Safety Guard
 *
 * Analyzes commands for potential danger before execution.
 * All commands go through this guard before being queued or executed.
 *
 * Risk levels:
 * - low: Safe commands (ls, cat, pwd, etc.) — auto-execute
 * - medium: Potentially risky (file writes, installs) — execute with warning
 * - high: Dangerous (delete, format, chmod) — require explicit user confirmation
 * - critical: Extremely dangerous (rm -rf /, sudo rm, format disk) — blocked entirely
 */

import type { CommandPayload } from "./types.js";

export type RiskLevel = "low" | "medium" | "high" | "critical";

export interface SafetyAnalysis {
  riskLevel: RiskLevel;
  requiresConfirmation: boolean;
  blocked: boolean;
  warnings: string[];
  explanation: string;
  /** Sanitized version of the command (if applicable) */
  sanitizedCommand?: string;
}

// ============================================
// Dangerous command patterns
// ============================================

/** Critical — always blocked */
const CRITICAL_PATTERNS: Array<{ pattern: RegExp; reason: string }> = [
  {
    pattern: /rm\s+(-[a-zA-Z]*f[a-zA-Z]*\s+)?(-[a-zA-Z]*r[a-zA-Z]*\s+)?\s*\/\s*$/i,
    reason: "루트 디렉토리 삭제 시도",
  },
  { pattern: /rm\s+-[a-zA-Z]*r[a-zA-Z]*f[a-zA-Z]*\s+\/(?!\S)/i, reason: "루트 디렉토리 재귀 삭제" },
  { pattern: /rm\s+-[a-zA-Z]*f[a-zA-Z]*r[a-zA-Z]*\s+\/(?!\S)/i, reason: "루트 디렉토리 재귀 삭제" },
  { pattern: /mkfs\./i, reason: "디스크 포맷 명령" },
  { pattern: /dd\s+if=.*of=\/dev\//i, reason: "디스크 직접 쓰기" },
  { pattern: /:(){ :\|:& };:/i, reason: "포크 폭탄" },
  { pattern: />\s*\/dev\/sd[a-z]/i, reason: "디스크 직접 쓰기" },
  { pattern: /chmod\s+-R\s+777\s+\//i, reason: "루트 전체 퍼미션 변경" },
  { pattern: /curl\s+.*\|\s*(sudo\s+)?bash/i, reason: "원격 스크립트 파이프 실행" },
  { pattern: /wget\s+.*\|\s*(sudo\s+)?bash/i, reason: "원격 스크립트 파이프 실행" },
  { pattern: /eval\s*\(/i, reason: "동적 코드 실행" },
  { pattern: /python[23]?\s+-c\s+.*import\s+os/i, reason: "Python을 통한 OS 명령 실행" },
  { pattern: /shutdown|reboot|poweroff|init\s+[06]/i, reason: "시스템 종료/재부팅 명령" },
];

/** High risk — require user confirmation */
const HIGH_RISK_PATTERNS: Array<{ pattern: RegExp; reason: string }> = [
  {
    pattern: /rm\s+(-[a-zA-Z]*r[a-zA-Z]*|-[a-zA-Z]*f[a-zA-Z]*)\s/i,
    reason: "파일/폴더 삭제 (재귀 또는 강제)",
  },
  { pattern: /rm\s+/i, reason: "파일 삭제" },
  { pattern: /sudo\s+/i, reason: "관리자 권한 명령" },
  { pattern: /chmod\s+/i, reason: "파일 권한 변경" },
  { pattern: /chown\s+/i, reason: "파일 소유자 변경" },
  { pattern: /mv\s+/i, reason: "파일 이동/이름 변경" },
  { pattern: /cp\s+-[a-zA-Z]*r/i, reason: "재귀 파일 복사" },
  { pattern: /kill\s+/i, reason: "프로세스 종료" },
  { pattern: /pkill\s+/i, reason: "프로세스 종료" },
  { pattern: /killall\s+/i, reason: "프로세스 전체 종료" },
  { pattern: /npm\s+(install|uninstall|update)/i, reason: "패키지 설치/삭제" },
  { pattern: /pip\s+(install|uninstall)/i, reason: "패키지 설치/삭제" },
  { pattern: /brew\s+(install|uninstall|remove)/i, reason: "패키지 설치/삭제" },
  { pattern: /apt(-get)?\s+(install|remove|purge)/i, reason: "패키지 설치/삭제" },
  { pattern: /git\s+(push|reset|clean|checkout\s+--)/i, reason: "Git 위험 명령" },
  { pattern: />\s+[^|]/i, reason: "파일 덮어쓰기 리다이렉션" },
  { pattern: /ssh\s+/i, reason: "원격 접속" },
  { pattern: /scp\s+/i, reason: "원격 파일 전송" },
  { pattern: /rsync\s+/i, reason: "원격 파일 동기화" },
  { pattern: /crontab\s+/i, reason: "예약 작업 변경" },
  { pattern: /systemctl\s+(start|stop|restart|enable|disable)/i, reason: "시스템 서비스 제어" },
  { pattern: /launchctl\s+/i, reason: "macOS 서비스 제어" },
];

/** Medium risk — execute with warning */
const MEDIUM_RISK_PATTERNS: Array<{ pattern: RegExp; reason: string }> = [
  { pattern: /tee\s+/i, reason: "파일 쓰기" },
  { pattern: /mkdir\s+/i, reason: "디렉토리 생성" },
  { pattern: /touch\s+/i, reason: "파일 생성" },
  { pattern: /echo\s+.*>/i, reason: "파일 쓰기" },
  { pattern: /cat\s+.*>/i, reason: "파일 쓰기" },
  { pattern: /git\s+(add|commit|stash|branch|merge)/i, reason: "Git 상태 변경" },
  { pattern: /open\s+/i, reason: "앱/파일 열기" },
  { pattern: /cp\s+/i, reason: "파일 복사" },
  { pattern: /ln\s+/i, reason: "심볼릭 링크 생성" },
  { pattern: /tar\s+/i, reason: "아카이브 작업" },
  { pattern: /zip\s+/i, reason: "압축 작업" },
  { pattern: /unzip\s+/i, reason: "압축 해제" },
];

// ============================================
// Safety Analysis
// ============================================

/**
 * Analyze a command payload for safety risks.
 */
export function analyzeCommandSafety(payload: CommandPayload): SafetyAnalysis {
  // Non-shell commands have predefined risk levels
  if (payload.type !== "shell") {
    return analyzeNonShellCommand(payload);
  }

  const command = payload.command;
  const warnings: string[] = [];

  // Check critical patterns first — these are always blocked
  for (const { pattern, reason } of CRITICAL_PATTERNS) {
    if (pattern.test(command)) {
      return {
        riskLevel: "critical",
        requiresConfirmation: false,
        blocked: true,
        warnings: [`차단됨: ${reason}`],
        explanation: `이 명령은 시스템에 치명적인 손상을 줄 수 있어 실행이 차단되었습니다.\n이유: ${reason}`,
      };
    }
  }

  // Check high risk patterns — require confirmation
  for (const { pattern, reason } of HIGH_RISK_PATTERNS) {
    if (pattern.test(command)) {
      warnings.push(reason);
    }
  }

  if (warnings.length > 0) {
    return {
      riskLevel: "high",
      requiresConfirmation: true,
      blocked: false,
      warnings,
      explanation: `이 명령은 다음과 같은 위험 요소가 있습니다:\n${warnings.map((w) => `• ${w}`).join("\n")}\n\n실행하시려면 /확인 명령을 보내주세요.`,
    };
  }

  // Check medium risk patterns — warn but allow
  const mediumWarnings: string[] = [];
  for (const { pattern, reason } of MEDIUM_RISK_PATTERNS) {
    if (pattern.test(command)) {
      mediumWarnings.push(reason);
    }
  }

  if (mediumWarnings.length > 0) {
    return {
      riskLevel: "medium",
      requiresConfirmation: false,
      blocked: false,
      warnings: mediumWarnings,
      explanation: `참고: ${mediumWarnings.join(", ")}`,
    };
  }

  // Low risk — safe to execute
  return {
    riskLevel: "low",
    requiresConfirmation: false,
    blocked: false,
    warnings: [],
    explanation: "안전한 명령입니다.",
  };
}

/**
 * Analyze non-shell command types
 */
function analyzeNonShellCommand(payload: CommandPayload): SafetyAnalysis {
  switch (payload.type) {
    case "file_read":
      // Reading files is generally safe, but check for sensitive paths
      if (isSensitivePath(payload.command)) {
        return {
          riskLevel: "high",
          requiresConfirmation: true,
          blocked: false,
          warnings: ["민감한 경로의 파일 읽기"],
          explanation: `민감한 파일에 접근하려 합니다: ${payload.command}\n확인이 필요합니다.`,
        };
      }
      return {
        riskLevel: "low",
        requiresConfirmation: false,
        blocked: false,
        warnings: [],
        explanation: "파일 읽기 — 안전합니다.",
      };

    case "file_write":
      return {
        riskLevel: "high",
        requiresConfirmation: true,
        blocked: false,
        warnings: ["파일 쓰기 작업"],
        explanation: `파일을 수정합니다: ${payload.command}\n확인이 필요합니다.`,
      };

    case "file_list":
      return {
        riskLevel: "low",
        requiresConfirmation: false,
        blocked: false,
        warnings: [],
        explanation: "디렉토리 목록 조회 — 안전합니다.",
      };

    case "browser_open":
      return {
        riskLevel: "medium",
        requiresConfirmation: false,
        blocked: false,
        warnings: ["브라우저에서 URL 열기"],
        explanation: `URL을 엽니다: ${payload.command}`,
      };

    case "clipboard":
      return {
        riskLevel: "low",
        requiresConfirmation: false,
        blocked: false,
        warnings: [],
        explanation: "클립보드 조회 — 안전합니다.",
      };

    case "screenshot":
      return {
        riskLevel: "medium",
        requiresConfirmation: false,
        blocked: false,
        warnings: ["화면 캡처"],
        explanation: "스크린샷을 캡처합니다.",
      };

    default:
      return {
        riskLevel: "medium",
        requiresConfirmation: true,
        blocked: false,
        warnings: ["알 수 없는 명령 유형"],
        explanation: "알 수 없는 유형의 명령입니다. 확인이 필요합니다.",
      };
  }
}

/**
 * Check if a file path points to a sensitive location
 */
function isSensitivePath(path: string): boolean {
  const sensitive = [
    /\/\.ssh\//i,
    /\/\.gnupg\//i,
    /\/\.aws\//i,
    /\/\.env/i,
    /\/\.git\/config/i,
    /\/\.npmrc/i,
    /\/\.pypirc/i,
    /\/etc\/shadow/i,
    /\/etc\/passwd/i,
    /id_rsa/i,
    /id_ed25519/i,
    /credentials/i,
    /secret/i,
    /password/i,
    /token/i,
    /\.pem$/i,
    /\.key$/i,
    /\.p12$/i,
    /\.pfx$/i,
    /keychain/i,
    /keystore/i,
  ];
  return sensitive.some((p) => p.test(path));
}

/**
 * Format a safety analysis for KakaoTalk display
 */
export function formatSafetyWarning(
  analysis: SafetyAnalysis,
  commandId: string,
  commandText: string,
): string {
  if (analysis.blocked) {
    return `🚫 **명령 차단됨**\n\n${analysis.explanation}\n\n명령: \`${commandText.slice(0, 100)}\``;
  }

  if (analysis.requiresConfirmation) {
    const riskIcon = analysis.riskLevel === "high" ? "⚠️" : "❓";
    return `${riskIcon} **실행 확인 필요**\n\n${analysis.explanation}\n\n명령: \`${commandText.slice(0, 100)}\`\n\n실행하려면: /확인 ${commandId.slice(0, 8)}\n취소하려면: /거부 ${commandId.slice(0, 8)}`;
  }

  // Medium risk — just a warning
  return analysis.explanation;
}
