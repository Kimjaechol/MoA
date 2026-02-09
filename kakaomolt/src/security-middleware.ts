/**
 * Security Middleware - 선차단 기반 보안 시스템
 *
 * 핵심 원칙: "선차단 후 동의" (Block First, Consent Later)
 *
 * 1. 데이터 '유출'(아웃바운드)만 차단 - 크롤링 등 '수집'(인바운드)은 허용
 * 2. 의심스러운 데이터 유출 시도는 즉시 차단
 * 3. 사용자에게 상황 알림
 * 4. 명시적 동의 후에만 차단 해제
 * 5. 동의 없으면 영구 차단 유지
 *
 * 중요: 웹 크롤링, 외부 API 호출, 검색 등 데이터를 '가져오는' 작업은
 *       데이터 유출이 아니므로 차단 대상이 아님
 */

import {
  checkMessageSecurity,
  checkRateLimit,
  validateSession,
  recordFailedAttempt,
  analyzeAnomalies,
  checkDataTransferConsent,
  grantDataTransferConsent,
  logSecurityEvent,
  formatSecurityWarning,
  formatDataTransferConsentRequest,
  detectInboundOperation,
  PROTECTED_DATA,
  type SecurityCheckResult,
  type ProtectedDataType,
  type ThreatCategory,
  type ThreatLevel,
} from "./security-guard.js";
import {
  grantPermission,
  isConfirmationResponse,
  type SensitiveActionCategory,
} from "./action-permissions.js";
import { hashUserId } from "./user-settings.js";

// ============================================
// 보안 미들웨어 결과
// ============================================

export interface SecurityMiddlewareResult {
  /** 요청 진행 가능 여부 */
  proceed: boolean;

  /** 차단됨 */
  blocked: boolean;

  /** 동의 대기 중 */
  awaitingConsent: boolean;

  /** 사용자에게 보낼 응답 메시지 */
  response?: string;

  /** 빠른 응답 버튼 */
  quickReplies?: string[];

  /** 차단 사유 */
  blockReason?: string;

  /** 감지된 위협 */
  threats?: Array<{
    category: ThreatCategory;
    level: ThreatLevel;
    description: string;
  }>;

  /** 필요한 동의 유형 */
  requiredConsents?: ProtectedDataType[];

  /** 대기 중인 확인 ID */
  pendingConfirmationId?: string;
}

// ============================================
// 대기 중인 보안 확인
// ============================================

interface PendingSecurityConfirmation {
  id: string;
  userId: string;
  type: "threat_override" | "data_transfer" | "action_permission";
  originalMessage: string;
  threats?: SecurityCheckResult["threats"];
  dataType?: ProtectedDataType;
  actionCategory?: SensitiveActionCategory;
  createdAt: Date;
  expiresAt: Date;
}

const pendingSecurityConfirmations = new Map<string, PendingSecurityConfirmation>();

// 사용자별 마지막 대기 확인 추적
const userPendingConfirmations = new Map<string, string>();

// ============================================
// 메인 보안 미들웨어
// ============================================

/**
 * 모든 요청에 대한 보안 검사
 *
 * 순서:
 * 1. 세션 검증
 * 2. 속도 제한 확인
 * 3. 이상 행동 분석
 * 4. 메시지 보안 검사 (패턴 + 데이터 유출 감지)
 * 5. 결과에 따른 선차단
 */
export async function securityCheck(
  kakaoUserId: string,
  message: string,
  context?: {
    deviceId?: string;
    ipAddress?: string;
  },
): Promise<SecurityMiddlewareResult> {
  const _hashedId = hashUserId(kakaoUserId);

  // ============================================
  // 1. 이전 확인 응답 처리
  // ============================================
  const confirmResponse = isConfirmationResponse(message);
  if (confirmResponse.isResponse) {
    const pendingId = userPendingConfirmations.get(kakaoUserId);
    if (pendingId) {
      return await handleSecurityConfirmation(kakaoUserId, confirmResponse.approved ?? false);
    }
  }

  // ============================================
  // 2. 세션 검증
  // ============================================
  const sessionResult = validateSession(kakaoUserId, context?.deviceId, context?.ipAddress);

  if (!sessionResult.valid) {
    await logSecurityEvent(kakaoUserId, "session_blocked", {
      reason: sessionResult.reason,
      ip: context?.ipAddress,
    });

    return {
      proceed: false,
      blocked: true,
      awaitingConsent: false,
      response: `🔒 **보안 차단**\n\n${sessionResult.reason}\n\n문제가 지속되면 관리자에게 문의하세요.`,
      blockReason: sessionResult.reason,
    };
  }

  // ============================================
  // 3. 속도 제한 확인
  // ============================================
  const rateLimit = checkRateLimit(kakaoUserId);

  if (!rateLimit.allowed) {
    await logSecurityEvent(kakaoUserId, "rate_limit_blocked", {
      remaining: rateLimit.remaining,
      resetIn: rateLimit.resetIn,
    });

    return {
      proceed: false,
      blocked: true,
      awaitingConsent: false,
      response: `🚫 **요청 제한**\n\n너무 많은 요청이 감지되었습니다.\n${Math.ceil(rateLimit.resetIn / 1000)}초 후에 다시 시도해주세요.`,
      blockReason: "Rate limit exceeded",
    };
  }

  // ============================================
  // 4. 이상 행동 분석
  // ============================================
  const anomalyResult = analyzeAnomalies(kakaoUserId, message);

  // 인바운드 작업(크롤링, 검색 등)은 이상 행동 검사에서 제외
  if (anomalyResult.isInboundOperation) {
    // 인바운드 작업은 허용 - 다음 검사로 진행
  } else if (anomalyResult.riskScore >= 70) {
    // 아웃바운드 관련 높은 위험 점수 - 선차단
    await logSecurityEvent(kakaoUserId, "anomaly_blocked", {
      riskScore: anomalyResult.riskScore,
      anomalies: anomalyResult.anomalies,
    });

    recordFailedAttempt(kakaoUserId, context?.deviceId);

    // 확인 요청 생성
    const confirmId = createSecurityConfirmation(kakaoUserId, "threat_override", message, {
      threats: [{
        category: "anomaly",
        level: anomalyResult.riskScore >= 90 ? "critical" : "high",
        description: anomalyResult.anomalies.join(", "),
        evidence: [message.slice(0, 100)],
        timestamp: new Date(),
        blocked: true,
      }],
    });

    return {
      proceed: false,
      blocked: true,
      awaitingConsent: true,
      response: formatAnomalyBlockMessage(anomalyResult),
      quickReplies: ["본인입니다", "취소"],
      blockReason: "Anomaly detected",
      pendingConfirmationId: confirmId,
    };
  }

  // ============================================
  // 5. 메시지 보안 검사
  // ============================================
  const securityResult = checkMessageSecurity(message);

  // 5-1. Critical 위협 - 즉시 차단, 해제 불가
  const criticalThreats = securityResult.threats.filter(t => t.level === "critical");
  if (criticalThreats.length > 0) {
    await logSecurityEvent(kakaoUserId, "critical_threat_blocked", {
      threats: criticalThreats.map(t => ({
        category: t.category,
        description: t.description,
      })),
      message: message.slice(0, 200),
    });

    recordFailedAttempt(kakaoUserId, context?.deviceId);

    return {
      proceed: false,
      blocked: true,
      awaitingConsent: false, // Critical은 동의로도 해제 불가
      response: formatCriticalBlockMessage(criticalThreats),
      blockReason: "Critical security threat",
      threats: criticalThreats.map(t => ({
        category: t.category,
        level: t.level,
        description: t.description,
      })),
    };
  }

  // 5-2. High 위협 - 선차단, 동의 시 해제 가능
  const highThreats = securityResult.threats.filter(t => t.level === "high");
  if (highThreats.length > 0) {
    await logSecurityEvent(kakaoUserId, "high_threat_blocked", {
      threats: highThreats.map(t => ({
        category: t.category,
        description: t.description,
      })),
    });

    const confirmId = createSecurityConfirmation(kakaoUserId, "threat_override", message, {
      threats: securityResult.threats,
    });

    return {
      proceed: false,
      blocked: true,
      awaitingConsent: true,
      response: formatHighThreatBlockMessage(highThreats),
      quickReplies: ["본인 확인, 계속 진행", "취소"],
      blockReason: "Security threat detected",
      threats: highThreats.map(t => ({
        category: t.category,
        level: t.level,
        description: t.description,
      })),
      pendingConfirmationId: confirmId,
    };
  }

  // 5-3. 보호 데이터 접근 - 동의 필요
  if (securityResult.requiresConsent && securityResult.requiresConsent.length > 0) {
    // 각 데이터 유형에 대해 동의 확인
    const unconsentedData: ProtectedDataType[] = [];

    for (const dataType of securityResult.requiresConsent) {
      const consent = await checkDataTransferConsent(kakaoUserId, dataType);

      if (consent.neverAllowed) {
        // 절대 허용 불가 데이터
        return {
          proceed: false,
          blocked: true,
          awaitingConsent: false,
          response: consent.message ?? `🚫 ${PROTECTED_DATA[dataType].name}은(는) 보안상 전송할 수 없습니다.`,
          blockReason: "Protected data - never allowed",
        };
      }

      if (!consent.consented) {
        unconsentedData.push(dataType);
      }
    }

    if (unconsentedData.length > 0) {
      const primaryDataType = unconsentedData[0];

      const confirmId = createSecurityConfirmation(kakaoUserId, "data_transfer", message, {
        dataType: primaryDataType,
      });

      return {
        proceed: false,
        blocked: true,
        awaitingConsent: true,
        response: formatDataTransferConsentRequest(primaryDataType),
        quickReplies: ["동의합니다", "거부합니다"],
        blockReason: "Data transfer consent required",
        requiredConsents: unconsentedData,
        pendingConfirmationId: confirmId,
      };
    }
  }

  // 5-4. Medium/Low 위협 - 경고만 (진행 허용)
  const mediumLowThreats = securityResult.threats.filter(
    t => t.level === "medium" || t.level === "low"
  );
  if (mediumLowThreats.length > 0) {
    await logSecurityEvent(kakaoUserId, "threat_warning", {
      threats: mediumLowThreats.map(t => ({
        category: t.category,
        description: t.description,
      })),
    });

    // 경고 로그만 남기고 진행 허용
  }

  // ============================================
  // 6. 모든 검사 통과
  // ============================================
  return {
    proceed: true,
    blocked: false,
    awaitingConsent: false,
  };
}

// ============================================
// 보안 확인 응답 처리
// ============================================

/**
 * 보안 확인 생성
 */
function createSecurityConfirmation(
  kakaoUserId: string,
  type: PendingSecurityConfirmation["type"],
  originalMessage: string,
  data: {
    threats?: SecurityCheckResult["threats"];
    dataType?: ProtectedDataType;
    actionCategory?: SensitiveActionCategory;
  },
): string {
  const id = `sec_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

  const confirmation: PendingSecurityConfirmation = {
    id,
    userId: kakaoUserId,
    type,
    originalMessage,
    threats: data.threats,
    dataType: data.dataType,
    actionCategory: data.actionCategory,
    createdAt: new Date(),
    expiresAt: new Date(Date.now() + 3 * 60 * 1000), // 3분 만료
  };

  pendingSecurityConfirmations.set(id, confirmation);
  userPendingConfirmations.set(kakaoUserId, id);

  return id;
}

/**
 * 보안 확인 응답 처리
 */
async function handleSecurityConfirmation(
  kakaoUserId: string,
  approved: boolean,
): Promise<SecurityMiddlewareResult> {
  const confirmId = userPendingConfirmations.get(kakaoUserId);
  if (!confirmId) {
    return {
      proceed: false,
      blocked: false,
      awaitingConsent: false,
      response: "확인 대기 중인 요청이 없습니다.",
    };
  }

  const confirmation = pendingSecurityConfirmations.get(confirmId);
  if (!confirmation) {
    userPendingConfirmations.delete(kakaoUserId);
    return {
      proceed: false,
      blocked: false,
      awaitingConsent: false,
      response: "확인 요청이 만료되었습니다.",
    };
  }

  // 만료 확인
  if (new Date() > confirmation.expiresAt) {
    pendingSecurityConfirmations.delete(confirmId);
    userPendingConfirmations.delete(kakaoUserId);

    await logSecurityEvent(kakaoUserId, "confirmation_expired", {
      type: confirmation.type,
    });

    return {
      proceed: false,
      blocked: false,
      awaitingConsent: false,
      response: "⏱️ 확인 요청이 만료되었습니다. 다시 시도해주세요.",
    };
  }

  // 정리
  pendingSecurityConfirmations.delete(confirmId);
  userPendingConfirmations.delete(kakaoUserId);

  if (!approved) {
    await logSecurityEvent(kakaoUserId, "user_denied_action", {
      type: confirmation.type,
      originalMessage: confirmation.originalMessage.slice(0, 100),
    });

    return {
      proceed: false,
      blocked: true,
      awaitingConsent: false,
      response: "🚫 요청이 취소되었습니다.\n\n의심스러운 활동이 감지되어 보안을 위해 차단 상태를 유지합니다.",
    };
  }

  // 승인된 경우
  await logSecurityEvent(kakaoUserId, "user_approved_action", {
    type: confirmation.type,
    originalMessage: confirmation.originalMessage.slice(0, 100),
  });

  switch (confirmation.type) {
    case "threat_override":
      return {
        proceed: true,
        blocked: false,
        awaitingConsent: false,
        response: `✅ 본인 확인 완료.\n\n요청을 처리합니다: "${confirmation.originalMessage.slice(0, 50)}..."`,
      };

    case "data_transfer":
      if (confirmation.dataType) {
        await grantDataTransferConsent(kakaoUserId, confirmation.dataType, {
          purpose: "User confirmed",
          expiresIn: 30 * 60 * 1000, // 30분
        });
      }
      return {
        proceed: true,
        blocked: false,
        awaitingConsent: false,
        response: `✅ 데이터 전송이 승인되었습니다. (30분간 유효)\n\n요청을 처리합니다.`,
      };

    case "action_permission":
      if (confirmation.actionCategory) {
        await grantPermission(kakaoUserId, confirmation.actionCategory);
      }
      return {
        proceed: true,
        blocked: false,
        awaitingConsent: false,
        response: `✅ 권한이 부여되었습니다.\n\n요청을 처리합니다.`,
      };

    default:
      return {
        proceed: true,
        blocked: false,
        awaitingConsent: false,
      };
  }
}

// ============================================
// 메시지 포맷팅
// ============================================

/**
 * Critical 위협 차단 메시지
 */
function formatCriticalBlockMessage(
  threats: SecurityCheckResult["threats"],
): string {
  const lines = [
    "🚨 **보안 위협 - 즉시 차단**",
    "",
    "심각한 보안 위협이 감지되어 요청이 차단되었습니다.",
    "이 유형의 요청은 보안상 허용되지 않습니다.",
    "",
    "**감지된 위협:**",
  ];

  for (const threat of threats) {
    lines.push(`🔴 ${threat.description}`);
  }

  lines.push("");
  lines.push("⚠️ 반복적인 시도는 계정 차단으로 이어질 수 있습니다.");

  return lines.join("\n");
}

/**
 * High 위협 차단 메시지
 */
function formatHighThreatBlockMessage(
  threats: SecurityCheckResult["threats"],
): string {
  const lines = [
    "🔒 **보안 확인 필요**",
    "",
    "의심스러운 활동이 감지되어 요청이 일시 차단되었습니다.",
    "",
    "**감지된 사항:**",
  ];

  for (const threat of threats) {
    lines.push(`🟠 ${threat.description}`);
  }

  lines.push("");
  lines.push("본인이 직접 요청한 것이 맞습니까?");
  lines.push("");
  lines.push('"본인 확인, 계속 진행" 또는 "취소"로 응답해주세요.');
  lines.push("");
  lines.push("⏱️ 3분 내에 응답하지 않으면 자동으로 취소됩니다.");

  return lines.join("\n");
}

/**
 * 이상 행동 차단 메시지
 */
function formatAnomalyBlockMessage(
  anomalyResult: { anomalies: string[]; riskScore: number },
): string {
  const lines = [
    "🔒 **데이터 유출 의심 활동 감지**",
    "",
    "데이터를 외부로 전송하려는 의심스러운 활동이 감지되었습니다.",
    "",
    "**감지된 이상 징후:**",
  ];

  for (const anomaly of anomalyResult.anomalies) {
    lines.push(`⚠️ ${anomaly}`);
  }

  lines.push("");
  lines.push("해킹이나 원격 조종에 의한 데이터 유출이 아닌지 확인이 필요합니다.");
  lines.push("");
  lines.push("💡 참고: 웹 크롤링, 검색, 외부 정보 조회 등 데이터를 '가져오는' 작업은 차단되지 않습니다.");
  lines.push("");
  lines.push("본인이 직접 데이터 전송을 요청하신 것이라면 '본인입니다'라고 응답해주세요.");
  lines.push("");
  lines.push("⏱️ 3분 내에 응답하지 않으면 보안을 위해 차단 상태가 유지됩니다.");

  return lines.join("\n");
}

// ============================================
// 보안 명령어 처리
// ============================================

/**
 * 보안 관련 명령어인지 확인
 */
export function isSecurityCommand(message: string): boolean {
  const normalized = message.trim().toLowerCase();
  const securityCommands = [
    /^보안\s*(상태|설정|로그)?$/,
    /^차단\s*(목록|해제)$/,
    /^동의\s*(현황|취소|철회)$/,
  ];

  return securityCommands.some(p => p.test(normalized));
}

/**
 * 보안 명령어 처리
 */
export async function handleSecurityCommand(
  kakaoUserId: string,
  message: string,
): Promise<{
  handled: boolean;
  response?: string;
  quickReplies?: string[];
}> {
  const normalized = message.trim().toLowerCase();

  // 보안 상태
  if (/^보안\s*(상태)?$/.test(normalized)) {
    return {
      handled: true,
      response: await formatSecurityStatus(kakaoUserId),
      quickReplies: ["동의 현황", "보안 로그"],
    };
  }

  // 동의 현황
  if (/^동의\s*(현황)?$/.test(normalized)) {
    return {
      handled: true,
      response: await formatConsentStatus(kakaoUserId),
      quickReplies: ["보안 상태", "동의 철회"],
    };
  }

  // 모든 동의 철회
  if (/^(모든\s*)?동의\s*(철회|취소)$/.test(normalized)) {
    return {
      handled: true,
      response: "⚠️ 모든 데이터 전송 동의를 철회하시겠습니까?\n\n철회 후에는 다시 동의가 필요합니다.\n\n'네' 또는 '아니오'로 응답해주세요.",
      quickReplies: ["네", "아니오"],
    };
  }

  return { handled: false };
}

/**
 * 보안 상태 포맷팅
 */
async function formatSecurityStatus(_kakaoUserId: string): Promise<string> {
  const lines = [
    "🔐 **보안 상태**",
    "",
    "✅ 세션: 정상",
    "✅ 속도 제한: 정상",
    "",
    "**보호 설정:**",
    "• 선차단 모드: 활성화",
    "• 데이터 유출 방지: 활성화",
    "• 민감 행동 확인: 필수",
    "",
    "**보호 범위:**",
    "🛡️ 차단: 내 데이터를 외부로 보내는 행위",
    "✅ 허용: 외부에서 데이터를 가져오는 행위 (크롤링, 검색 등)",
    "",
    "**최근 보안 이벤트:**",
    "(최근 이벤트 없음)",
    "",
    '"동의 현황"으로 데이터 전송 동의 상태를 확인할 수 있습니다.',
  ];

  return lines.join("\n");
}

/**
 * 동의 현황 포맷팅
 */
async function formatConsentStatus(_kakaoUserId: string): Promise<string> {
  const lines = [
    "📋 **데이터 전송 동의 현황**",
    "",
    "**현재 활성 동의:**",
    "(없음)",
    "",
    "**동의 불가 데이터:**",
    "🔴 비밀번호/인증정보 - 전송 불가",
    "🔴 생체정보 - 전송 불가",
    "🔴 금융정보 - 전송 불가",
    "🔴 데이터베이스 전체 - 전송 불가",
    "",
    "**동의 필요 데이터:**",
    "🟠 연락처, 메시지, 파일 등",
    "",
    '"동의 철회"로 모든 동의를 취소할 수 있습니다.',
  ];

  return lines.join("\n");
}

// ============================================
// 내보내기
// ============================================

export {
  checkMessageSecurity,
  checkDataTransferConsent,
  grantDataTransferConsent,
  logSecurityEvent,
  formatSecurityWarning,
  detectInboundOperation,
  PROTECTED_DATA,
};
