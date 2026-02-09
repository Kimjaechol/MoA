/**
 * Command Gravity Engine — 명령 위험도 자동 평가 + 비례적 보호
 *
 * ## 핵심 원리: "위험할수록 더 강한 보호"
 *
 * 모든 명령에 "중력(gravity)" 점수(0~10)를 부여합니다.
 * 점수에 따라 자동으로 비례적 보호 장치가 적용됩니다:
 *
 * | 중력 | 등급      | 보호 장치                                  | 예시                        |
 * |------|-----------|--------------------------------------------|-----------------------------|
 * | 0~1  | 깃털      | 없음 (즉시 실행)                           | 날씨, 대화, 인사            |
 * | 2~3  | 가벼움    | 로그만 기록                                | 파일 읽기, 목록 조회        |
 * | 4~6  | 중간      | 자동 체크포인트 + 로그                     | 파일 수정, 패키지 설치      |
 * | 7~8  | 무거움    | 확인 요청 + 체크포인트 + 되돌리기 정보     | 파일 삭제, 설정 변경        |
 * | 9~10 | 치명적    | 재인증 + 카운트다운(지연 실행) + 체크포인트 | rm -rf, 포맷, 전체 삭제     |
 *
 * ## Dead Man's Switch (데드맨 스위치)
 *
 * 중력 7+ 명령은 즉시 실행하지 않고 대기열에 넣습니다.
 * 지정 시간(30초~5분) 동안 "!취소"를 입력하면 실행을 막을 수 있습니다.
 * 시간이 지나면 자동 실행됩니다.
 *
 * ## Panic Button (비상정지)
 *
 * "!비상정지" 또는 "!stop" → 즉시:
 * 1. 모든 대기 중인 명령 취소
 * 2. 현재 실행 중인 명령에 취소 신호
 * 3. 비상 체크포인트 자동 생성
 * 4. 기기 제어 잠금 (재인증 필요)
 *
 * ## Guardian Angel (AI 자가검증)
 *
 * 중력 5+ 명령에 대해 AI가 스스로 검증:
 * - "이 명령이 대화 맥락에 맞는가?"
 * - "주인의 평소 패턴과 일치하는가?"
 * - "프롬프트 인젝션 가능성은?"
 * 의심스러우면 추가 확인을 요청합니다.
 */

import {
  logAction,
  updateActionStatus,
  createCheckpoint,
  type ActionEntry,
} from "./action-journal.js";

// ============================================
// Types
// ============================================

/** 명령 위험도 등급 */
export type GravityLevel =
  | "feather"     // 0~1: 깃털 — 즉시 실행
  | "light"       // 2~3: 가벼움 — 로그만
  | "medium"      // 4~6: 중간 — 자동 체크포인트
  | "heavy"       // 7~8: 무거움 — 확인 요청
  | "critical";   // 9~10: 치명적 — 지연 실행 + 재인증

/** 명령 분석 결과 */
export interface GravityAssessment {
  /** 숫자 점수 (0~10) */
  score: number;
  /** 등급 */
  level: GravityLevel;
  /** 탐지된 위험 요인 */
  risks: string[];
  /** 적용될 보호 장치 */
  safeguards: string[];
  /** 사용자에게 보여줄 경고 메시지 (있으면) */
  warning?: string;
  /** 필요한 행동 */
  action: "execute" | "log_and_execute" | "checkpoint_and_execute" | "confirm_required" | "delayed_execution";
  /** 지연 실행 시 대기 시간 (초) */
  delaySeconds?: number;
}

/** 대기열 항목 */
export interface PendingCommand {
  id: string;
  command: string;
  assessment: GravityAssessment;
  userId: string;
  channelId: string;
  deviceName?: string;
  /** 실행 예정 시각 */
  executeAt: number;
  /** 생성 시각 */
  createdAt: number;
  /** 취소 여부 */
  cancelled: boolean;
}

/** 비상정지 결과 */
export interface PanicResult {
  cancelledCount: number;
  checkpointId: string;
  message: string;
}

// ============================================
// Gravity Scoring Rules
// ============================================

/** 위험 패턴 — 각 패턴에 점수와 설명을 부여 */
interface RiskPattern {
  /** 패턴 매칭 함수 */
  match: (text: string) => boolean;
  /** 이 패턴의 기본 점수 */
  score: number;
  /** 위험 설명 */
  risk: string;
}

const RISK_PATTERNS: RiskPattern[] = [
  // ── 치명적 (9~10) ──
  {
    match: (t) => /rm\s+(-rf?|--recursive)\s+[/~]/.test(t),
    score: 10,
    risk: "루트/홈 디렉토리 재귀 삭제",
  },
  {
    match: (t) => /rm\s+-rf?\s+\*/.test(t) || /rm\s+-rf?\s+\./.test(t),
    score: 10,
    risk: "와일드카드/현재 디렉토리 재귀 삭제",
  },
  {
    match: (t) => /mkfs|fdisk|format\s+[cd]:|diskpart/.test(t),
    score: 10,
    risk: "디스크 포맷/파티션 변경",
  },
  {
    match: (t) => /dd\s+.*of=\/dev\//.test(t),
    score: 10,
    risk: "디스크 직접 쓰기 (dd)",
  },
  {
    match: (t) => /(전체|모두|전부|all)\s*(삭제|지워|제거|delete|remove|erase)/.test(t),
    score: 9,
    risk: "전체 삭제 요청",
  },
  {
    match: (t) => /데이터\s*(싹|전부|다)\s*(지워|삭제|날려)/.test(t),
    score: 9,
    risk: "데이터 일괄 삭제 요청",
  },
  {
    match: (t) => /drop\s+database|drop\s+table|truncate\s+table/i.test(t),
    score: 9,
    risk: "데이터베이스 삭제/초기화",
  },

  // ── 무거움 (7~8) ──
  {
    match: (t) => /rm\s+(-[rf]+\s+)?/.test(t) && !/rm\s+-rf?\s+[/~]/.test(t),
    score: 7,
    risk: "파일/디렉토리 삭제",
  },
  {
    match: (t) => /삭제|지워|제거|delete|remove/.test(t.toLowerCase()),
    score: 7,
    risk: "삭제 관련 명령",
  },
  {
    match: (t) => /chmod\s+777|chmod\s+-R/.test(t),
    score: 7,
    risk: "파일 권한 대량 변경",
  },
  {
    match: (t) => /git\s+(reset\s+--hard|push\s+--force|clean\s+-fd)/.test(t),
    score: 8,
    risk: "Git 파괴적 작업 (강제 푸시/리셋)",
  },
  {
    match: (t) => /npm\s+publish|pip\s+upload|docker\s+push/.test(t),
    score: 7,
    risk: "패키지/이미지 공개 배포",
  },
  {
    match: (t) => /shutdown|reboot|restart|재시작|종료/.test(t.toLowerCase()),
    score: 7,
    risk: "시스템 종료/재시작",
  },

  // ── 중간 (4~6) ──
  {
    match: (t) => />(>)?|tee\s|>>/.test(t),
    score: 5,
    risk: "파일 덮어쓰기/추가 (리다이렉션)",
  },
  {
    match: (t) => /mv\s+/.test(t),
    score: 5,
    risk: "파일/디렉토리 이동",
  },
  {
    match: (t) => /cp\s+-r/.test(t),
    score: 4,
    risk: "디렉토리 복사",
  },
  {
    match: (t) => /npm\s+install|pip\s+install|apt\s+install|brew\s+install/.test(t),
    score: 4,
    risk: "패키지 설치",
  },
  {
    match: (t) => /git\s+(commit|merge|rebase|checkout)/.test(t),
    score: 4,
    risk: "Git 상태 변경 작업",
  },
  {
    match: (t) => /수정|변경|바꿔|고쳐|edit|modify|change/.test(t.toLowerCase()),
    score: 5,
    risk: "파일/설정 수정 요청",
  },
  {
    match: (t) => /전송|보내|send|mail|email/.test(t.toLowerCase()),
    score: 6,
    risk: "외부 전송 (되돌릴 수 없음)",
  },

  // ── 가벼움 (2~3) ──
  {
    match: (t) => /ls|dir|cat|head|tail|less|more|pwd|whoami|echo/.test(t),
    score: 2,
    risk: "읽기 전용 명령",
  },
  {
    match: (t) => /파일\s*(열어|보여|확인|읽어)|내용\s*알려/.test(t),
    score: 2,
    risk: "파일 읽기 요청",
  },
  {
    match: (t) => /상태|status|목록|list|조회/.test(t.toLowerCase()),
    score: 2,
    risk: "상태 조회",
  },
  {
    match: (t) => /git\s+(status|log|diff|show|branch)/.test(t),
    score: 2,
    risk: "Git 읽기 명령",
  },
];

/** 추가 위험 증폭기 (이미 높은 점수를 더 높임) */
interface RiskAmplifier {
  match: (text: string) => boolean;
  amplify: number; // 추가할 점수
  reason: string;
}

const RISK_AMPLIFIERS: RiskAmplifier[] = [
  {
    match: (t) => /sudo|관리자|admin|root/.test(t.toLowerCase()),
    amplify: 1,
    reason: "관리자 권한 사용",
  },
  {
    match: (t) => /&&|;|\|/.test(t),
    amplify: 1,
    reason: "연쇄 명령 (파이프/체이닝)",
  },
  {
    match: (t) => /\$\(|`[^`]+`/.test(t),
    amplify: 1,
    reason: "명령 치환 (서브쉘)",
  },
  {
    match: (t) => /-y\b|--yes\b|--force\b|-f\b/.test(t),
    amplify: 1,
    reason: "확인 생략 플래그 사용",
  },
  {
    match: (t) => /\/\*|\.\.\/|~\/\.\w/.test(t),
    amplify: 1,
    reason: "위험한 경로 패턴 (와일드카드/상위디렉토리/숨김파일)",
  },
];

// ============================================
// Gravity Assessment
// ============================================

/**
 * 명령의 위험도를 분석합니다.
 */
export function assessCommandGravity(command: string): GravityAssessment {
  let score = 0;
  const risks: string[] = [];

  // 1. 위험 패턴 매칭
  for (const pattern of RISK_PATTERNS) {
    if (pattern.match(command)) {
      if (pattern.score > score) {
        score = pattern.score;
      }
      risks.push(pattern.risk);
    }
  }

  // 2. 증폭기 적용
  for (const amp of RISK_AMPLIFIERS) {
    if (amp.match(command)) {
      score = Math.min(10, score + amp.amplify);
      risks.push(amp.reason);
    }
  }

  // 3. 기본값 (패턴 미매칭)
  if (risks.length === 0) {
    score = 1;
    risks.push("일반 명령");
  }

  // 4. 등급 결정
  const level = getGravityLevel(score);

  // 5. 보호 장치 결정
  const safeguards = getSafeguards(level);

  // 6. 행동 결정
  const action = getRequiredAction(level);

  // 7. 경고 메시지
  const warning = getWarningMessage(level, risks, score);

  // 8. 지연 시간
  const delaySeconds = getDelaySeconds(score);

  return {
    score,
    level,
    risks,
    safeguards,
    warning,
    action,
    delaySeconds,
  };
}

function getGravityLevel(score: number): GravityLevel {
  if (score <= 1) return "feather";
  if (score <= 3) return "light";
  if (score <= 6) return "medium";
  if (score <= 8) return "heavy";
  return "critical";
}

function getSafeguards(level: GravityLevel): string[] {
  switch (level) {
    case "feather":
      return [];
    case "light":
      return ["작업 로그 기록"];
    case "medium":
      return ["자동 체크포인트", "작업 로그 기록", "되돌리기 정보 저장"];
    case "heavy":
      return ["사용자 확인 필요", "자동 체크포인트", "작업 로그 기록", "되돌리기 정보 저장"];
    case "critical":
      return ["재인증 필요", "카운트다운 지연 실행", "자동 체크포인트", "작업 로그 기록", "되돌리기 정보 저장"];
  }
}

function getRequiredAction(level: GravityLevel): GravityAssessment["action"] {
  switch (level) {
    case "feather": return "execute";
    case "light": return "log_and_execute";
    case "medium": return "checkpoint_and_execute";
    case "heavy": return "confirm_required";
    case "critical": return "delayed_execution";
  }
}

function getWarningMessage(level: GravityLevel, risks: string[], score: number): string | undefined {
  if (level === "feather" || level === "light") return undefined;

  const riskList = risks.slice(0, 3).join(", ");

  if (level === "medium") {
    return `이 명령은 시스템에 변경을 가합니다.\n위험 요인: ${riskList}\n자동 체크포인트가 생성됩니다.`;
  }

  if (level === "heavy") {
    return `⚠️ 위험도 ${score}/10 — 확인이 필요합니다.\n\n위험 요인: ${riskList}\n\n실행하려면 "!확인"을 입력하세요.\n취소하려면 "!취소"를 입력하세요.`;
  }

  // critical
  return `🚨 위험도 ${score}/10 — 매우 위험한 명령입니다!\n\n위험 요인: ${riskList}\n\n이 명령은 되돌리기 어려울 수 있습니다.\n실행하려면 "!인증" 후 "!확인"을 입력하세요.`;
}

function getDelaySeconds(score: number): number | undefined {
  if (score <= 6) return undefined;
  if (score <= 8) return 30; // 30초 대기
  return 180; // 3분 대기 (치명적)
}

// ============================================
// Dead Man's Switch (지연 실행 대기열)
// ============================================

/** 대기 중인 명령 (메모리에만 — 서버 재시작 시 자동 취소됨, 이것이 안전한 설계) */
const pendingCommands = new Map<string, PendingCommand>();

/** 실행 타이머 */
const executionTimers = new Map<string, ReturnType<typeof setTimeout>>();

/**
 * 명령을 대기열에 넣습니다 (지연 실행).
 * 지정 시간 후 자동 실행되며, 그 전에 취소 가능합니다.
 */
export function queueCommand(params: {
  id: string;
  command: string;
  assessment: GravityAssessment;
  userId: string;
  channelId: string;
  deviceName?: string;
  onExecute: () => void;
}): PendingCommand {
  const delayMs = (params.assessment.delaySeconds ?? 30) * 1000;

  const pending: PendingCommand = {
    id: params.id,
    command: params.command,
    assessment: params.assessment,
    userId: params.userId,
    channelId: params.channelId,
    deviceName: params.deviceName,
    executeAt: Date.now() + delayMs,
    createdAt: Date.now(),
    cancelled: false,
  };

  pendingCommands.set(params.id, pending);

  // Set execution timer
  const timer = setTimeout(() => {
    const cmd = pendingCommands.get(params.id);
    if (cmd && !cmd.cancelled) {
      console.log(`[Gravity] Executing delayed command: ${params.id}`);
      params.onExecute();
      pendingCommands.delete(params.id);
    }
    executionTimers.delete(params.id);
  }, delayMs);

  executionTimers.set(params.id, timer);

  return pending;
}

/**
 * 대기 중인 명령을 취소합니다.
 */
export function cancelPendingCommand(commandId: string): boolean {
  const pending = pendingCommands.get(commandId);
  if (!pending || pending.cancelled) return false;

  pending.cancelled = true;
  pendingCommands.delete(commandId);

  const timer = executionTimers.get(commandId);
  if (timer) {
    clearTimeout(timer);
    executionTimers.delete(commandId);
  }

  console.log(`[Gravity] Cancelled pending command: ${commandId}`);
  return true;
}

/**
 * 모든 대기 중인 명령을 취소합니다 (비상정지용).
 */
export function cancelAllPending(): number {
  let count = 0;
  for (const [id] of pendingCommands) {
    if (cancelPendingCommand(id)) count++;
  }
  return count;
}

/**
 * 대기 중인 명령 목록을 가져옵니다.
 */
export function getPendingCommands(): PendingCommand[] {
  return Array.from(pendingCommands.values()).filter((c) => !c.cancelled);
}

// ============================================
// Panic Button (비상정지)
// ============================================

/** 비상정지 잠금 상태 */
let panicLocked = false;

/**
 * 비상정지를 실행합니다.
 *
 * 즉시:
 * 1. 모든 대기 명령 취소
 * 2. 비상 체크포인트 생성
 * 3. 기기 제어 잠금 (재인증 필요)
 */
export function executePanic(userId: string, channelId: string): PanicResult {
  // 1. 모든 대기 명령 취소
  const cancelledCount = cancelAllPending();

  // 2. 비상 체크포인트 생성
  const checkpoint = createCheckpoint({
    name: `EMERGENCY-${new Date().toISOString().slice(0, 19)}`,
    description: "비상정지에 의한 긴급 체크포인트",
    auto: true,
    userId,
    channelId,
  });

  // 3. 기기 제어 잠금
  panicLocked = true;

  // 4. 로그
  logAction({
    type: "system_change",
    summary: "🚨 비상정지 발동",
    detail: `취소된 명령: ${cancelledCount}개, 체크포인트: ${checkpoint.id}`,
    reversibility: "reversible",
    undoAction: {
      type: "restore_config",
      payload: { panicLocked: false },
      description: "비상정지 해제",
    },
    userId,
    channelId,
  });

  console.warn(`[PANIC] Emergency stop by ${channelId}/${userId.slice(0, 8)}... — ${cancelledCount} commands cancelled`);

  return {
    cancelledCount,
    checkpointId: checkpoint.id,
    message: [
      "🚨 비상정지가 발동되었습니다!",
      "",
      `취소된 대기 명령: ${cancelledCount}개`,
      `비상 체크포인트: ${checkpoint.id}`,
      "",
      "모든 기기 제어가 잠겼습니다.",
      "재개하려면 \"!인증 [비밀구문]\"으로 다시 인증하세요.",
      "",
      `이전 상태로 복원: "!복원 ${checkpoint.id}"`,
    ].join("\n"),
  };
}

/**
 * 비상정지 잠금 해제 (재인증 시 호출)
 */
export function releasePanicLock(): void {
  panicLocked = false;
  console.log("[PANIC] Lock released");
}

/**
 * 비상정지 잠금 상태 확인
 */
export function isPanicLocked(): boolean {
  return panicLocked;
}

// ============================================
// Guardian Angel (AI 자가검증)
// ============================================

/**
 * 명령의 "의심도"를 계산합니다.
 * 높은 의심도 = 추가 확인 필요.
 *
 * 검증 항목:
 * 1. 시간대 이상 (새벽 2~5시 고위험 명령)
 * 2. 감정적 언어 패턴 (분노/좌절 표현과 함께 파괴적 명령)
 * 3. 급격한 에스컬레이션 (이전 대화와 맥락 불일치)
 * 4. 인젝션 의심 패턴
 */
export function guardianAngelCheck(
  command: string,
  gravity: GravityAssessment,
): {
  suspicionScore: number; // 0~10
  reasons: string[];
  shouldBlock: boolean;
  additionalWarning?: string;
} {
  let suspicion = 0;
  const reasons: string[] = [];

  // 1. 시간대 검사 — 새벽 위험 시간대
  const hour = new Date().getHours();
  if (hour >= 1 && hour <= 5 && gravity.score >= 7) {
    suspicion += 3;
    reasons.push(`새벽 ${hour}시에 고위험 명령 (판단력 저하 가능성)`);
  }

  // 2. 감정적 언어 + 파괴적 명령 조합
  const emotionalPatterns = [
    /짜증|화나|빡치|미치|시발|씨발|좆|ㅅㅂ|ㅂㅅ|개[짜열빡]/,
    /싹\s*(다|지워|날려|없애)/,
    /다\s*(지워|없애|삭제|날려)/,
    /전부\s*(지워|없애|삭제|날려)/,
  ];
  if (emotionalPatterns.some((p) => p.test(command)) && gravity.score >= 5) {
    suspicion += 4;
    reasons.push("감정적 표현 + 파괴적 명령 (충동적 판단 가능성)");
  }

  // 3. 과도하게 넓은 범위
  const broadScope = [
    /\*\*/,           // 재귀 와일드카드
    /\/\s*$/,         // 루트 경로
    /~\s*$/,          // 홈 전체
    /--all|--everything/,
  ];
  if (broadScope.some((p) => p.test(command)) && gravity.score >= 5) {
    suspicion += 2;
    reasons.push("영향 범위가 매우 넓음");
  }

  // 4. 인젝션 의심 (이미 auth에서 걸러지지만 이중 확인)
  const injectionLike = [
    /ignore.*(?:previous|above|all).*(?:instruction|prompt|rule)/i,
    /you are now/i,
    /new instructions?:/i,
    /\[system\]/i,
  ];
  if (injectionLike.some((p) => p.test(command))) {
    suspicion += 5;
    reasons.push("프롬프트 인젝션 패턴 감지");
  }

  // 판정
  const shouldBlock = suspicion >= 6;
  let additionalWarning: string | undefined;

  if (suspicion >= 6) {
    additionalWarning = [
      "🛡️ Guardian Angel 경고",
      "",
      ...reasons.map((r) => `• ${r}`),
      "",
      "이 명령의 실행을 보류합니다.",
      "정말 실행하려면 \"!강제실행\"을 입력하세요.",
      "취소하려면 \"!취소\"를 입력하세요.",
    ].join("\n");
  } else if (suspicion >= 3) {
    additionalWarning = `⚠️ 참고: ${reasons.join(", ")}`;
  }

  return {
    suspicionScore: Math.min(10, suspicion),
    reasons,
    shouldBlock,
    additionalWarning,
  };
}

// ============================================
// Formatting for Chat Display
// ============================================

const GRAVITY_EMOJI: Record<GravityLevel, string> = {
  feather: "🪶",
  light: "💚",
  medium: "🟡",
  heavy: "🟠",
  critical: "🔴",
};

const GRAVITY_LABEL_KO: Record<GravityLevel, string> = {
  feather: "안전",
  light: "가벼움",
  medium: "주의",
  heavy: "위험",
  critical: "치명적",
};

/**
 * 위험도 평가 결과를 사용자에게 보여줄 형태로 포맷합니다.
 */
export function formatGravityAssessment(assessment: GravityAssessment): string {
  const emoji = GRAVITY_EMOJI[assessment.level];
  const label = GRAVITY_LABEL_KO[assessment.level];

  let output = `${emoji} 위험도: ${assessment.score}/10 (${label})\n`;

  if (assessment.risks.length > 0) {
    output += `탐지: ${assessment.risks.slice(0, 3).join(", ")}\n`;
  }

  if (assessment.safeguards.length > 0) {
    output += `보호: ${assessment.safeguards.join(", ")}\n`;
  }

  if (assessment.delaySeconds) {
    output += `대기: ${assessment.delaySeconds}초 후 자동 실행 (취소: "!취소")\n`;
  }

  return output;
}

/**
 * 대기 중인 명령 목록을 포맷합니다.
 */
export function formatPendingCommands(commands: PendingCommand[]): string {
  if (commands.length === 0) {
    return "대기 중인 명령이 없습니다.";
  }

  let output = "⏳ 대기 중인 명령\n\n";

  for (const cmd of commands) {
    const remaining = Math.max(0, Math.ceil((cmd.executeAt - Date.now()) / 1000));
    const emoji = GRAVITY_EMOJI[cmd.assessment.level];
    output += `${emoji} ${cmd.command.slice(0, 60)}\n`;
    output += `   ${remaining}초 후 실행 · ${cmd.id}\n`;
    output += `   취소: "!취소 ${cmd.id}"\n\n`;
  }

  output += `전체 취소: "!비상정지"`;

  return output;
}
