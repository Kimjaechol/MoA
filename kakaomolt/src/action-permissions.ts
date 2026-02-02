/**
 * Action Permission System
 *
 * 사용자 동의 기반 행동 제어 시스템
 *
 * 원칙:
 * 1. 민감한 행동은 사전 동의 필수
 * 2. 동의 받은 범위 내에서만 행동
 * 3. 애매한 경우 사용자에게 확인 요청
 * 4. 모든 민감한 행동은 감사 로그 기록
 */

import { getSupabase, isSupabaseConfigured } from "./supabase.js";
import { hashUserId } from "./user-settings.js";

// ============================================
// 행동 카테고리 정의
// ============================================

/**
 * 안전한 행동 (동의 불필요)
 * - 정보 조회, 질문 답변, 검색, 계산 등
 */
export type SafeAction =
  | "read_info"        // 정보 읽기/조회
  | "answer_question"  // 질문 답변
  | "search"           // 검색
  | "calculate"        // 계산
  | "translate"        // 번역
  | "summarize"        // 요약
  | "explain"          // 설명
  | "navigate";        // 길찾기

/**
 * 민감한 행동 (사전 동의 필수)
 * - 외부에 영향을 미치는 모든 행동
 */
export type SensitiveActionCategory =
  | "send_email"           // 이메일 발송
  | "send_sms"             // SMS 발송
  | "send_kakao"           // 카카오톡 메시지 발송 (타인에게)
  | "send_message"         // 기타 메시지 발송 (Telegram, Discord 등)
  | "make_payment"         // 결제/송금
  | "access_contacts"      // 연락처 접근
  | "access_calendar"      // 캘린더 접근/수정
  | "access_files"         // 파일 접근/수정
  | "execute_code"         // 코드 실행
  | "api_call"             // 외부 API 호출
  | "post_social"          // SNS 게시
  | "book_reservation"     // 예약
  | "modify_settings"      // 설정 변경
  | "share_data";          // 데이터 공유

/**
 * 행동 위험 수준
 */
export type RiskLevel = "low" | "medium" | "high" | "critical";

/**
 * 행동 카테고리 정보
 */
export interface ActionCategoryInfo {
  id: SensitiveActionCategory;
  name: string;
  description: string;
  riskLevel: RiskLevel;
  examples: string[];
  requiresEachTimeConfirm: boolean; // 매번 확인 필요 여부
}

/**
 * 민감한 행동 카테고리 정의
 */
export const SENSITIVE_ACTIONS: Record<SensitiveActionCategory, ActionCategoryInfo> = {
  send_email: {
    id: "send_email",
    name: "이메일 발송",
    description: "다른 사람에게 이메일을 보냅니다",
    riskLevel: "high",
    examples: ["이메일 보내기", "메일 발송", "이메일 전송"],
    requiresEachTimeConfirm: true,
  },
  send_sms: {
    id: "send_sms",
    name: "문자 발송",
    description: "다른 사람에게 SMS 문자를 보냅니다",
    riskLevel: "high",
    examples: ["문자 보내기", "SMS 발송"],
    requiresEachTimeConfirm: true,
  },
  send_kakao: {
    id: "send_kakao",
    name: "카카오톡 메시지",
    description: "다른 사람에게 카카오톡 메시지를 보냅니다",
    riskLevel: "high",
    examples: ["카톡 보내기", "카카오톡 전송"],
    requiresEachTimeConfirm: true,
  },
  send_message: {
    id: "send_message",
    name: "메시지 전송",
    description: "다른 채널(Telegram, Discord 등)로 메시지를 보냅니다",
    riskLevel: "medium",
    examples: ["텔레그램 전송", "디스코드 메시지"],
    requiresEachTimeConfirm: true,
  },
  make_payment: {
    id: "make_payment",
    name: "결제/송금",
    description: "결제하거나 돈을 보냅니다",
    riskLevel: "critical",
    examples: ["결제하기", "송금하기", "구매하기"],
    requiresEachTimeConfirm: true, // 항상 확인 필요
  },
  access_contacts: {
    id: "access_contacts",
    name: "연락처 접근",
    description: "연락처 정보를 읽거나 수정합니다",
    riskLevel: "medium",
    examples: ["연락처 보기", "전화번호 찾기"],
    requiresEachTimeConfirm: false,
  },
  access_calendar: {
    id: "access_calendar",
    name: "캘린더 접근",
    description: "일정을 조회하거나 추가/수정합니다",
    riskLevel: "low",
    examples: ["일정 추가", "캘린더 보기"],
    requiresEachTimeConfirm: false,
  },
  access_files: {
    id: "access_files",
    name: "파일 접근",
    description: "파일을 읽거나 수정/삭제합니다",
    riskLevel: "medium",
    examples: ["파일 열기", "문서 수정"],
    requiresEachTimeConfirm: false,
  },
  execute_code: {
    id: "execute_code",
    name: "코드 실행",
    description: "프로그램 코드를 실행합니다",
    riskLevel: "high",
    examples: ["코드 실행", "스크립트 실행"],
    requiresEachTimeConfirm: true,
  },
  api_call: {
    id: "api_call",
    name: "외부 API 호출",
    description: "외부 서비스 API를 호출합니다",
    riskLevel: "medium",
    examples: ["API 호출", "외부 서비스 연동"],
    requiresEachTimeConfirm: false,
  },
  post_social: {
    id: "post_social",
    name: "SNS 게시",
    description: "SNS에 게시물을 올립니다",
    riskLevel: "high",
    examples: ["트위터 게시", "인스타그램 포스팅"],
    requiresEachTimeConfirm: true,
  },
  book_reservation: {
    id: "book_reservation",
    name: "예약",
    description: "예약을 진행합니다",
    riskLevel: "medium",
    examples: ["예약하기", "예매하기"],
    requiresEachTimeConfirm: true,
  },
  modify_settings: {
    id: "modify_settings",
    name: "설정 변경",
    description: "시스템 설정을 변경합니다",
    riskLevel: "low",
    examples: ["설정 변경", "옵션 수정"],
    requiresEachTimeConfirm: false,
  },
  share_data: {
    id: "share_data",
    name: "데이터 공유",
    description: "데이터를 외부와 공유합니다",
    riskLevel: "high",
    examples: ["데이터 공유", "정보 전송"],
    requiresEachTimeConfirm: true,
  },
};

// ============================================
// 권한 타입 정의
// ============================================

export interface ActionPermission {
  category: SensitiveActionCategory;
  granted: boolean;
  grantedAt?: Date;
  expiresAt?: Date;        // 권한 만료 시간 (선택)
  scope?: string;          // 허용 범위 (예: "특정 이메일 주소만")
  restrictions?: string[]; // 제한 사항
}

export interface UserPermissions {
  userId: string;
  permissions: ActionPermission[];
  globalConsent: boolean;  // 기본 동의 여부 (false가 기본)
  createdAt: Date;
  updatedAt: Date;
}

/**
 * 권한 확인 결과
 */
export interface PermissionCheckResult {
  allowed: boolean;
  reason: "granted" | "denied" | "not_requested" | "expired" | "needs_confirmation";
  permission?: ActionPermission;
  message: string;
}

/**
 * 확인 요청 대기 상태
 */
export interface PendingConfirmation {
  id: string;
  userId: string;
  action: SensitiveActionCategory;
  details: string;
  createdAt: Date;
  expiresAt: Date;
  status: "pending" | "approved" | "denied" | "expired";
}

// ============================================
// 권한 관리 함수
// ============================================

/**
 * 사용자 권한 조회
 */
export async function getUserPermissions(kakaoUserId: string): Promise<UserPermissions> {
  const hashedId = hashUserId(kakaoUserId);

  if (!isSupabaseConfigured()) {
    return {
      userId: hashedId,
      permissions: [],
      globalConsent: false,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
  }

  const supabase = getSupabase();

  const { data: existing } = await supabase
    .from("user_permissions")
    .select("*")
    .eq("kakao_user_id", hashedId)
    .single();

  if (existing) {
    return {
      userId: existing.id,
      permissions: existing.permissions ?? [],
      globalConsent: existing.global_consent ?? false,
      createdAt: new Date(existing.created_at),
      updatedAt: new Date(existing.updated_at),
    };
  }

  // 새 사용자 - 기본 권한 생성
  const { data: newPerms } = await supabase
    .from("user_permissions")
    .insert({
      kakao_user_id: hashedId,
      permissions: [],
      global_consent: false,
    })
    .select()
    .single();

  return {
    userId: newPerms?.id ?? hashedId,
    permissions: [],
    globalConsent: false,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

/**
 * 권한 부여
 */
export async function grantPermission(
  kakaoUserId: string,
  category: SensitiveActionCategory,
  options: {
    scope?: string;
    expiresIn?: number; // 밀리초
    restrictions?: string[];
  } = {},
): Promise<void> {
  const hashedId = hashUserId(kakaoUserId);
  const userPerms = await getUserPermissions(kakaoUserId);

  const newPermission: ActionPermission = {
    category,
    granted: true,
    grantedAt: new Date(),
    expiresAt: options.expiresIn ? new Date(Date.now() + options.expiresIn) : undefined,
    scope: options.scope,
    restrictions: options.restrictions,
  };

  // 기존 권한 업데이트 또는 추가
  const existingIndex = userPerms.permissions.findIndex(p => p.category === category);
  if (existingIndex >= 0) {
    userPerms.permissions[existingIndex] = newPermission;
  } else {
    userPerms.permissions.push(newPermission);
  }

  if (isSupabaseConfigured()) {
    const supabase = getSupabase();
    await supabase
      .from("user_permissions")
      .update({
        permissions: userPerms.permissions,
        updated_at: new Date().toISOString(),
      })
      .eq("kakao_user_id", hashedId);
  }

  // 감사 로그
  await logAction(kakaoUserId, "permission_granted", {
    category,
    scope: options.scope,
  });
}

/**
 * 권한 철회
 */
export async function revokePermission(
  kakaoUserId: string,
  category: SensitiveActionCategory,
): Promise<void> {
  const hashedId = hashUserId(kakaoUserId);
  const userPerms = await getUserPermissions(kakaoUserId);

  userPerms.permissions = userPerms.permissions.filter(p => p.category !== category);

  if (isSupabaseConfigured()) {
    const supabase = getSupabase();
    await supabase
      .from("user_permissions")
      .update({
        permissions: userPerms.permissions,
        updated_at: new Date().toISOString(),
      })
      .eq("kakao_user_id", hashedId);
  }

  await logAction(kakaoUserId, "permission_revoked", { category });
}

/**
 * 모든 권한 철회
 */
export async function revokeAllPermissions(kakaoUserId: string): Promise<void> {
  const hashedId = hashUserId(kakaoUserId);

  if (isSupabaseConfigured()) {
    const supabase = getSupabase();
    await supabase
      .from("user_permissions")
      .update({
        permissions: [],
        global_consent: false,
        updated_at: new Date().toISOString(),
      })
      .eq("kakao_user_id", hashedId);
  }

  await logAction(kakaoUserId, "all_permissions_revoked", {});
}

// ============================================
// 권한 확인 함수
// ============================================

/**
 * 행동 수행 전 권한 확인
 */
export async function checkPermission(
  kakaoUserId: string,
  action: SensitiveActionCategory,
): Promise<PermissionCheckResult> {
  const userPerms = await getUserPermissions(kakaoUserId);
  const actionInfo = SENSITIVE_ACTIONS[action];

  // 해당 카테고리 권한 찾기
  const permission = userPerms.permissions.find(p => p.category === action);

  // 권한이 없는 경우
  if (!permission) {
    return {
      allowed: false,
      reason: "not_requested",
      message: `"${actionInfo.name}" 권한이 필요합니다. 동의하시겠습니까?`,
    };
  }

  // 권한이 거부된 경우
  if (!permission.granted) {
    return {
      allowed: false,
      reason: "denied",
      permission,
      message: `"${actionInfo.name}" 권한이 거부되어 있습니다.`,
    };
  }

  // 권한이 만료된 경우
  if (permission.expiresAt && new Date(permission.expiresAt) < new Date()) {
    return {
      allowed: false,
      reason: "expired",
      permission,
      message: `"${actionInfo.name}" 권한이 만료되었습니다. 다시 동의하시겠습니까?`,
    };
  }

  // 매번 확인이 필요한 경우 (critical 행동)
  if (actionInfo.requiresEachTimeConfirm) {
    return {
      allowed: false,
      reason: "needs_confirmation",
      permission,
      message: `이 작업을 수행하시겠습니까?\n(${actionInfo.name}: ${actionInfo.description})`,
    };
  }

  // 권한 있음
  return {
    allowed: true,
    reason: "granted",
    permission,
    message: "",
  };
}

/**
 * 행동이 민감한 행동인지 확인
 */
export function isSensitiveAction(action: string): action is SensitiveActionCategory {
  return action in SENSITIVE_ACTIONS;
}

/**
 * 메시지에서 민감한 행동 의도 감지
 */
export function detectSensitiveIntent(message: string): {
  detected: boolean;
  actions: SensitiveActionCategory[];
  confidence: "high" | "medium" | "low";
} {
  const normalized = message.toLowerCase();
  const detectedActions: SensitiveActionCategory[] = [];

  // 이메일 발송 감지
  if (/이메일|메일|mail/.test(normalized) && /보내|발송|전송|send/.test(normalized)) {
    detectedActions.push("send_email");
  }

  // 문자 발송 감지
  if (/문자|sms|mms/.test(normalized) && /보내|발송|전송/.test(normalized)) {
    detectedActions.push("send_sms");
  }

  // 카카오톡 메시지 감지
  if (/카톡|카카오톡|kakao/.test(normalized) && /보내|전송|알림/.test(normalized)) {
    detectedActions.push("send_kakao");
  }

  // 결제/송금 감지
  if (/결제|송금|이체|구매|주문|pay|payment/.test(normalized)) {
    detectedActions.push("make_payment");
  }

  // 예약 감지
  if (/예약|예매|booking|reservation/.test(normalized)) {
    detectedActions.push("book_reservation");
  }

  // SNS 게시 감지
  if (/게시|포스팅|올리|트윗|post/.test(normalized) && /sns|트위터|인스타|페이스북|twitter|instagram|facebook/.test(normalized)) {
    detectedActions.push("post_social");
  }

  // 코드 실행 감지
  if (/실행|execute|run/.test(normalized) && /코드|스크립트|프로그램|code|script/.test(normalized)) {
    detectedActions.push("execute_code");
  }

  // 파일 접근 감지
  if (/파일|문서|file|document/.test(normalized) && /삭제|수정|변경|delete|modify/.test(normalized)) {
    detectedActions.push("access_files");
  }

  // 데이터 공유 감지
  if (/공유|share|전달|전송/.test(normalized) && /데이터|정보|자료/.test(normalized)) {
    detectedActions.push("share_data");
  }

  // 신뢰도 결정
  let confidence: "high" | "medium" | "low" = "low";
  if (detectedActions.length > 0) {
    // 명확한 동사가 있으면 high
    if (/보내줘|해줘|실행해|결제해|예약해/.test(normalized)) {
      confidence = "high";
    } else if (/보내|하고|실행|결제|예약/.test(normalized)) {
      confidence = "medium";
    }
  }

  return {
    detected: detectedActions.length > 0,
    actions: detectedActions,
    confidence,
  };
}

// ============================================
// 확인 요청 관리
// ============================================

const pendingConfirmations = new Map<string, PendingConfirmation>();

/**
 * 확인 요청 생성
 */
export function createConfirmationRequest(
  kakaoUserId: string,
  action: SensitiveActionCategory,
  details: string,
): PendingConfirmation {
  const id = `confirm_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

  const confirmation: PendingConfirmation = {
    id,
    userId: kakaoUserId,
    action,
    details,
    createdAt: new Date(),
    expiresAt: new Date(Date.now() + 5 * 60 * 1000), // 5분 후 만료
    status: "pending",
  };

  pendingConfirmations.set(id, confirmation);

  return confirmation;
}

/**
 * 확인 요청 응답 처리
 */
export async function handleConfirmationResponse(
  kakaoUserId: string,
  approved: boolean,
): Promise<{
  found: boolean;
  confirmation?: PendingConfirmation;
  message: string;
}> {
  // 사용자의 가장 최근 pending 확인 요청 찾기
  let latestConfirmation: PendingConfirmation | undefined;

  for (const [_id, conf] of pendingConfirmations) {
    if (conf.userId === kakaoUserId && conf.status === "pending") {
      if (!latestConfirmation || conf.createdAt > latestConfirmation.createdAt) {
        latestConfirmation = conf;
      }
    }
  }

  if (!latestConfirmation) {
    return {
      found: false,
      message: "확인 대기 중인 요청이 없습니다.",
    };
  }

  // 만료 확인
  if (new Date() > latestConfirmation.expiresAt) {
    latestConfirmation.status = "expired";
    pendingConfirmations.delete(latestConfirmation.id);
    return {
      found: true,
      confirmation: latestConfirmation,
      message: "확인 요청이 만료되었습니다. 다시 시도해주세요.",
    };
  }

  // 응답 처리
  latestConfirmation.status = approved ? "approved" : "denied";
  pendingConfirmations.delete(latestConfirmation.id);

  // 감사 로그
  await logAction(kakaoUserId, approved ? "action_approved" : "action_denied", {
    action: latestConfirmation.action,
    details: latestConfirmation.details,
  });

  if (approved) {
    return {
      found: true,
      confirmation: latestConfirmation,
      message: "승인되었습니다. 작업을 수행합니다.",
    };
  } else {
    return {
      found: true,
      confirmation: latestConfirmation,
      message: "거부되었습니다. 작업이 취소되었습니다.",
    };
  }
}

/**
 * 확인 응답 메시지인지 확인
 */
export function isConfirmationResponse(message: string): {
  isResponse: boolean;
  approved?: boolean;
} {
  const normalized = message.trim().toLowerCase();

  const approvePatterns = ["네", "예", "응", "ㅇㅇ", "ok", "yes", "승인", "확인", "동의", "허락", "해줘", "해도 돼"];
  const denyPatterns = ["아니", "아니요", "ㄴㄴ", "no", "거부", "취소", "안돼", "하지마", "그만"];

  if (approvePatterns.some(p => normalized === p || normalized.startsWith(p))) {
    return { isResponse: true, approved: true };
  }

  if (denyPatterns.some(p => normalized === p || normalized.startsWith(p))) {
    return { isResponse: true, approved: false };
  }

  return { isResponse: false };
}

// ============================================
// 감사 로그
// ============================================

export interface AuditLogEntry {
  id?: string;
  userId: string;
  action: string;
  category?: SensitiveActionCategory;
  details: Record<string, unknown>;
  result: "success" | "blocked" | "pending";
  timestamp: Date;
}

/**
 * 감사 로그 기록
 */
export async function logAction(
  kakaoUserId: string,
  action: string,
  details: Record<string, unknown>,
  result: "success" | "blocked" | "pending" = "success",
): Promise<void> {
  const hashedId = hashUserId(kakaoUserId);

  const entry: AuditLogEntry = {
    userId: hashedId,
    action,
    details,
    result,
    timestamp: new Date(),
  };

  if (isSupabaseConfigured()) {
    const supabase = getSupabase();
    await supabase.from("action_audit_log").insert({
      user_id: hashedId,
      action,
      details,
      result,
    });
  }

  // 콘솔 로그 (디버깅용)
  console.log(`[AUDIT] ${hashedId.slice(0, 8)}... | ${action} | ${result} | ${JSON.stringify(details)}`);
}

/**
 * 감사 로그 조회
 */
export async function getAuditLog(
  kakaoUserId: string,
  limit: number = 20,
): Promise<AuditLogEntry[]> {
  const hashedId = hashUserId(kakaoUserId);

  if (!isSupabaseConfigured()) {
    return [];
  }

  const supabase = getSupabase();
  const { data } = await supabase
    .from("action_audit_log")
    .select("*")
    .eq("user_id", hashedId)
    .order("created_at", { ascending: false })
    .limit(limit);

  return (data ?? []).map(row => ({
    id: row.id,
    userId: row.user_id,
    action: row.action,
    details: row.details,
    result: row.result,
    timestamp: new Date(row.created_at),
  }));
}

// ============================================
// 메시지 포맷팅
// ============================================

/**
 * 권한 요청 메시지 생성
 */
export function formatPermissionRequestMessage(action: SensitiveActionCategory): string {
  const actionInfo = SENSITIVE_ACTIONS[action];
  const riskEmoji = {
    low: "🟢",
    medium: "🟡",
    high: "🟠",
    critical: "🔴",
  };

  return `⚠️ **권한 요청**

${riskEmoji[actionInfo.riskLevel]} **${actionInfo.name}**
${actionInfo.description}

이 기능을 허용하시겠습니까?

"네" 또는 "아니오"로 응답해주세요.`;
}

/**
 * 확인 요청 메시지 생성
 */
export function formatConfirmationMessage(
  action: SensitiveActionCategory,
  details: string,
): string {
  const actionInfo = SENSITIVE_ACTIONS[action];

  return `🔔 **작업 확인**

**${actionInfo.name}**을(를) 수행하려고 합니다.

📋 상세 내용:
${details}

진행하시겠습니까? ("네" / "아니오")

⏱️ 5분 내에 응답해주세요.`;
}

/**
 * 권한 현황 메시지 생성
 */
export async function formatPermissionStatusMessage(kakaoUserId: string): Promise<string> {
  const userPerms = await getUserPermissions(kakaoUserId);

  const lines = [
    "🔐 **내 권한 설정**",
    "",
  ];

  if (userPerms.permissions.length === 0) {
    lines.push("허용된 권한이 없습니다.");
    lines.push("");
    lines.push("AI가 민감한 작업을 수행하려면 사전 동의가 필요합니다.");
  } else {
    lines.push("**허용된 권한:**");
    for (const perm of userPerms.permissions) {
      if (perm.granted) {
        const info = SENSITIVE_ACTIONS[perm.category];
        const expired = perm.expiresAt && new Date(perm.expiresAt) < new Date();
        const status = expired ? "⚪ (만료됨)" : "✅";
        lines.push(`${status} ${info.name}`);
        if (perm.scope) {
          lines.push(`   └ 범위: ${perm.scope}`);
        }
      }
    }
  }

  lines.push("");
  lines.push("━━━━━━━━━━━━━━━━━━━━");
  lines.push("");
  lines.push("**명령어:**");
  lines.push('• "권한 허용 [기능]" - 권한 부여');
  lines.push('• "권한 취소 [기능]" - 권한 철회');
  lines.push('• "모든 권한 취소" - 전체 철회');

  return lines.join("\n");
}

/**
 * 권한 명령어 파싱
 */
export function parsePermissionCommand(message: string): {
  isCommand: boolean;
  action?: "grant" | "revoke" | "revoke_all" | "status";
  category?: SensitiveActionCategory;
} {
  const normalized = message.trim().toLowerCase();

  // 권한 상태 확인
  if (/^권한\s*(상태|현황|목록)?$/.test(normalized)) {
    return { isCommand: true, action: "status" };
  }

  // 모든 권한 취소
  if (/^(모든\s*)?권한\s*(모두\s*)?(취소|철회|삭제)$/.test(normalized)) {
    return { isCommand: true, action: "revoke_all" };
  }

  // 권한 부여
  const grantMatch = normalized.match(/^권한\s*(허용|부여|승인)\s+(.+)$/);
  if (grantMatch) {
    const category = findCategoryByKeyword(grantMatch[2]);
    if (category) {
      return { isCommand: true, action: "grant", category };
    }
  }

  // 권한 취소
  const revokeMatch = normalized.match(/^권한\s*(취소|철회|삭제)\s+(.+)$/);
  if (revokeMatch) {
    const category = findCategoryByKeyword(revokeMatch[2]);
    if (category) {
      return { isCommand: true, action: "revoke", category };
    }
  }

  return { isCommand: false };
}

/**
 * 키워드로 카테고리 찾기
 */
function findCategoryByKeyword(keyword: string): SensitiveActionCategory | undefined {
  const normalized = keyword.toLowerCase();

  const keywordMap: Record<string, SensitiveActionCategory> = {
    "이메일": "send_email",
    "메일": "send_email",
    "문자": "send_sms",
    "sms": "send_sms",
    "카톡": "send_kakao",
    "카카오톡": "send_kakao",
    "메시지": "send_message",
    "결제": "make_payment",
    "송금": "make_payment",
    "연락처": "access_contacts",
    "캘린더": "access_calendar",
    "일정": "access_calendar",
    "파일": "access_files",
    "코드": "execute_code",
    "실행": "execute_code",
    "api": "api_call",
    "sns": "post_social",
    "게시": "post_social",
    "예약": "book_reservation",
    "설정": "modify_settings",
    "공유": "share_data",
  };

  for (const [kw, cat] of Object.entries(keywordMap)) {
    if (normalized.includes(kw)) {
      return cat;
    }
  }

  return undefined;
}
