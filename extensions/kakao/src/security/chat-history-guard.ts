/**
 * Chat History Guard — Prevents unauthorized access to conversation history
 *
 * 문제: 분실된 폰에서 절취자가 카카오톡/텔레그램 등을 열면
 *       MoA와의 채팅 내역을 읽을 수 있음 → 민감 정보 유출
 *
 * 해결책 (다층 방어):
 *
 * Layer 1: 채팅 메시지 자동 삭제 (Ephemeral Messages)
 *   - MoA의 응답 후 설정된 시간(기본 5분) 뒤 메시지 삭제 요청
 *   - 각 채널 API의 메시지 삭제 기능 활용
 *   - KakaoTalk: 알림톡 → 자동 만료, 채널 메시지 → 삭제 API
 *   - Telegram: deleteMessage API (Bot이 보낸 메시지 삭제 가능)
 *   - Discord: 임시 메시지 (ephemeral), 또는 bulkDelete
 *
 * Layer 2: 민감 정보 마스킹 (Response Masking)
 *   - AI 응답에 포함된 민감 정보를 마스킹 후 전송
 *   - 전화번호, 계좌번호, 비밀번호 등 패턴 탐지 + 마스킹
 *   - 원본은 로컬 sqlite-vec에만 보관 (암호화됨)
 *
 * Layer 3: 보안 모드 (Lockdown Mode)
 *   - 분실 신고 후 해당 기기의 모든 채널에서 응답 차단
 *   - "이 기기는 분실 신고되었습니다" 메시지만 반환
 *   - 새로운 인증 없이는 대화 재개 불가
 */

import { getSupabase, isSupabaseConfigured } from "../supabase.js";

/** Configuration for chat history protection */
export interface ChatGuardConfig {
  /** Whether ephemeral messages are enabled */
  ephemeralEnabled: boolean;
  /** Auto-delete delay in seconds (default: 300 = 5 minutes) */
  ephemeralDelaySec: number;
  /** Whether sensitive data masking is enabled */
  maskingEnabled: boolean;
  /** Whether lockdown mode is active (after /분실신고) */
  lockdownActive: boolean;
}

const DEFAULT_CONFIG: ChatGuardConfig = {
  ephemeralEnabled: true,
  ephemeralDelaySec: 300,
  maskingEnabled: true,
  lockdownActive: false,
};

// Sensitive data patterns for masking
const SENSITIVE_PATTERNS: Array<{ pattern: RegExp; replacement: string; label: string }> = [
  // Korean phone numbers
  { pattern: /01[0-9]-?\d{3,4}-?\d{4}/g, replacement: "010-****-****", label: "전화번호" },
  // Korean resident registration number
  { pattern: /\d{6}-?[1-4]\d{6}/g, replacement: "******-*******", label: "주민등록번호" },
  // Bank account numbers (Korean format)
  { pattern: /\d{3,4}-?\d{2,6}-?\d{2,6}-?\d{0,3}/g, replacement: "****-****-****", label: "계좌번호" },
  // Email addresses
  { pattern: /[\w.-]+@[\w.-]+\.\w{2,}/g, replacement: "***@***.***", label: "이메일" },
  // Credit card numbers
  { pattern: /\d{4}[\s-]?\d{4}[\s-]?\d{4}[\s-]?\d{4}/g, replacement: "****-****-****-****", label: "카드번호" },
  // IP addresses
  { pattern: /\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}/g, replacement: "***.***.***.***", label: "IP주소" },
  // Password mentions
  { pattern: /(?:비밀번호|password|pw|패스워드)\s*[:=]?\s*\S+/gi, replacement: "[비밀번호 마스킹됨]", label: "비밀번호" },
];

/**
 * Mask sensitive data in a message before sending to chat channel.
 *
 * Original unmasked data stays in the local sqlite-vec (encrypted).
 * Only the masked version is sent through chat channels.
 */
export function maskSensitiveData(text: string): {
  masked: string;
  maskedCount: number;
  maskedTypes: string[];
} {
  let masked = text;
  let maskedCount = 0;
  const maskedTypes: string[] = [];

  for (const { pattern, replacement, label } of SENSITIVE_PATTERNS) {
    const matches = masked.match(pattern);
    if (matches && matches.length > 0) {
      masked = masked.replace(pattern, replacement);
      maskedCount += matches.length;
      if (!maskedTypes.includes(label)) {
        maskedTypes.push(label);
      }
    }
  }

  return { masked, maskedCount, maskedTypes };
}

/**
 * Schedule a message for auto-deletion after the ephemeral delay.
 *
 * This stores the message deletion job in Supabase. A background worker
 * or the next heartbeat cycle will execute the actual deletion.
 *
 * Each channel has its own deletion API:
 * - Telegram: bot.deleteMessage(chatId, messageId)
 * - Discord: message.delete()
 * - KakaoTalk: limited — we send expiring alimtalk instead
 */
export async function scheduleMessageDeletion(params: {
  userId: string;
  channel: string;
  /** Channel-specific message identifier */
  messageId: string;
  /** Channel-specific chat/channel identifier */
  chatId: string;
  /** Delay in seconds before deletion */
  delaySec?: number;
}): Promise<void> {
  if (!isSupabaseConfigured()) return;

  const config = DEFAULT_CONFIG;
  if (!config.ephemeralEnabled) return;

  const supabase = getSupabase();
  const delaySec = params.delaySec ?? config.ephemeralDelaySec;
  const deleteAt = new Date(Date.now() + delaySec * 1000).toISOString();

  await supabase.from("scheduled_message_deletions").insert({
    user_id: params.userId,
    channel: params.channel,
    message_id: params.messageId,
    chat_id: params.chatId,
    delete_at: deleteAt,
    executed: false,
  });
}

/**
 * Process pending message deletions.
 *
 * Called periodically (e.g., every minute) to delete expired messages.
 * Returns deletion functions for each channel.
 */
export async function processPendingDeletions(params: {
  /** Channel-specific deletion functions */
  deleteMessage: (channel: string, chatId: string, messageId: string) => Promise<boolean>;
}): Promise<{ deleted: number; failed: number }> {
  if (!isSupabaseConfigured()) return { deleted: 0, failed: 0 };

  const supabase = getSupabase();
  const now = new Date().toISOString();

  // Fetch messages due for deletion
  const { data } = await supabase
    .from("scheduled_message_deletions")
    .select("*")
    .eq("executed", false)
    .lt("delete_at", now)
    .limit(50);

  if (!data || data.length === 0) return { deleted: 0, failed: 0 };

  let deleted = 0;
  let failed = 0;

  for (const msg of data) {
    try {
      const success = await params.deleteMessage(msg.channel, msg.chat_id, msg.message_id);
      if (success) {
        await supabase
          .from("scheduled_message_deletions")
          .update({ executed: true, executed_at: now })
          .eq("id", msg.id);
        deleted++;
      } else {
        failed++;
      }
    } catch {
      failed++;
    }
  }

  return { deleted, failed };
}

/**
 * Activate lockdown mode for a device.
 *
 * When lockdown is active:
 * - All MoA responses are replaced with a lockdown message
 * - No memory searches are performed
 * - No AI API calls are made
 * - Only /분실취소 + authentication can deactivate
 */
export async function activateLockdown(params: {
  userId: string;
  deviceId: string;
}): Promise<void> {
  if (!isSupabaseConfigured()) return;

  const supabase = getSupabase();

  await supabase.from("device_lockdown").upsert({
    user_id: params.userId,
    device_id: params.deviceId,
    active: true,
    activated_at: new Date().toISOString(),
  });
}

/**
 * Check if a device is in lockdown mode.
 */
export async function isDeviceLocked(params: {
  userId: string;
  deviceId: string;
}): Promise<boolean> {
  if (!isSupabaseConfigured()) return false;

  const supabase = getSupabase();

  const { data } = await supabase
    .from("device_lockdown")
    .select("active")
    .eq("user_id", params.userId)
    .eq("device_id", params.deviceId)
    .single();

  return data?.active === true;
}

/**
 * Deactivate lockdown mode (requires re-authentication).
 */
export async function deactivateLockdown(params: {
  userId: string;
  deviceId: string;
}): Promise<void> {
  if (!isSupabaseConfigured()) return;

  const supabase = getSupabase();

  await supabase
    .from("device_lockdown")
    .update({ active: false, deactivated_at: new Date().toISOString() })
    .eq("user_id", params.userId)
    .eq("device_id", params.deviceId);
}

/** The message shown when a locked-down device tries to chat */
export const LOCKDOWN_MESSAGE =
  "🔒 이 기기는 분실 신고되었습니다.\n\n" +
  "보안을 위해 MoA와의 대화가 차단되었습니다.\n" +
  "본인이시라면 다른 기기에서 /분실취소 를 입력하세요.";

/**
 * Format chat guard status for display.
 */
export function formatChatGuardStatus(config: ChatGuardConfig): string {
  const lines = [
    "🛡️ 채팅 보안 상태",
    "",
    `• 자동 메시지 삭제: ${config.ephemeralEnabled ? `✅ ${config.ephemeralDelaySec}초 후` : "❌ 비활성"}`,
    `• 민감정보 마스킹: ${config.maskingEnabled ? "✅ 활성" : "❌ 비활성"}`,
    `• 잠금 모드: ${config.lockdownActive ? "🔒 활성 (분실 신고)" : "✅ 정상"}`,
  ];

  return lines.join("\n");
}
