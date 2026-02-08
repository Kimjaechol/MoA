/**
 * Proactive Messaging via Friend Talk (친구톡)
 *
 * Sends proactive messages to users via NHN Cloud Toast Friend Talk API.
 * Used for:
 * - Welcome messages after device pairing
 * - Notifications and alerts
 * - Alim Talk (알림톡) template-based notifications
 *
 * Phone number storage in Supabase enables Friend Talk delivery.
 */

import { createKakaoApiClient } from "./api-client.js";
import { getSupabase, isSupabaseConfigured } from "./supabase.js";
import type { ResolvedKakaoAccount } from "./types.js";

// ============================================
// Phone Number Storage
// ============================================

/**
 * Normalize Korean phone number to international format
 * 010-1234-5678 → 01012345678 (Toast API format)
 */
function normalizePhoneNumber(phone: string): string {
  // Remove all non-digit characters
  const digits = phone.replace(/\D/g, "");

  // Already in international format (+82)
  if (digits.startsWith("82")) {
    return digits;
  }

  // Korean format: 010XXXXXXXX → 01012345678
  if (digits.startsWith("010") && digits.length === 11) {
    return digits;
  }

  return digits;
}

/**
 * Validate Korean phone number format
 */
function isValidKoreanPhone(phone: string): boolean {
  const digits = phone.replace(/\D/g, "");
  return /^(010|011|016|017|018|019)\d{7,8}$/.test(digits);
}

/**
 * Store a user's phone number for proactive messaging
 */
export async function storeUserPhoneNumber(
  kakaoUserId: string,
  phoneNumber: string,
): Promise<{ success: boolean; error?: string }> {
  if (!isSupabaseConfigured()) {
    return { success: false, error: "Supabase가 설정되지 않았습니다." };
  }

  if (!isValidKoreanPhone(phoneNumber)) {
    return { success: false, error: "올바른 전화번호 형식이 아닙니다. (예: 010-1234-5678)" };
  }

  const normalized = normalizePhoneNumber(phoneNumber);
  const supabase = getSupabase();

  // Find or create user
  const { data: user } = await supabase
    .from("lawcall_users")
    .select("id")
    .eq("kakao_user_id", kakaoUserId)
    .single();

  if (!user) {
    return { success: false, error: "사용자 정보를 찾을 수 없습니다." };
  }

  // Upsert phone number
  const { error } = await supabase
    .from("lawcall_users")
    .update({ phone_number: normalized })
    .eq("id", user.id);

  if (error) {
    return { success: false, error: `전화번호 저장 실패: ${error.message}` };
  }

  return { success: true };
}

/**
 * Get user's phone number by Kakao user ID
 */
export async function getUserPhoneNumber(kakaoUserId: string): Promise<string | null> {
  if (!isSupabaseConfigured()) return null;

  const supabase = getSupabase();
  const { data } = await supabase
    .from("lawcall_users")
    .select("phone_number")
    .eq("kakao_user_id", kakaoUserId)
    .single();

  return data?.phone_number ?? null;
}

/**
 * Get user's phone number by Supabase user ID
 */
export async function getUserPhoneNumberById(userId: string): Promise<string | null> {
  if (!isSupabaseConfigured()) return null;

  const supabase = getSupabase();
  const { data } = await supabase
    .from("lawcall_users")
    .select("phone_number")
    .eq("id", userId)
    .single();

  return data?.phone_number ?? null;
}

// ============================================
// Proactive Message Sending
// ============================================

/**
 * Check if proactive messaging is configured (Toast API keys present)
 */
export function isProactiveMessagingConfigured(account: ResolvedKakaoAccount): boolean {
  return !!(account.toastAppKey && account.toastSecretKey && account.senderKey);
}

/**
 * Send a welcome message via Friend Talk after device pairing
 */
export async function sendWelcomeAfterPairing(
  userId: string,
  deviceName: string,
  account: ResolvedKakaoAccount,
): Promise<{ success: boolean; error?: string }> {
  if (!isProactiveMessagingConfigured(account)) {
    return { success: false, error: "Friend Talk이 설정되지 않았습니다." };
  }

  // Get user's phone number
  const phoneNumber = await getUserPhoneNumberById(userId);
  if (!phoneNumber) {
    return { success: false, error: "사용자 전화번호가 등록되지 않았습니다." };
  }

  const apiClient = createKakaoApiClient(account);

  const welcomeMessage = `🎉 "${deviceName}" 기기가 성공적으로 연결되었습니다!

시키실 일이 있거나 질문하고 싶은 것이 있으면 무엇이든 지시하시고 물어보세요.

카카오톡에서 바로 사용해보세요:
• @${deviceName} ls ~/Desktop
• @${deviceName} 오늘 날씨 알려줘

MoA가 항상 대기하고 있습니다! 🤖`;

  const result = await apiClient.sendFriendTalk({
    recipientNo: phoneNumber,
    content: welcomeMessage,
  });

  if (result.success) {
    console.log(`[MoA] Welcome Friend Talk sent to user ${userId} for device "${deviceName}"`);
  } else {
    console.warn(`[MoA] Failed to send welcome Friend Talk: ${result.error}`);
  }

  return result;
}

/**
 * Send a general proactive message via Friend Talk
 */
export async function sendProactiveMessage(
  recipientNo: string,
  content: string,
  account: ResolvedKakaoAccount,
): Promise<{ success: boolean; error?: string }> {
  if (!isProactiveMessagingConfigured(account)) {
    return { success: false, error: "Friend Talk이 설정되지 않았습니다." };
  }

  const apiClient = createKakaoApiClient(account);
  return apiClient.sendFriendTalk({ recipientNo, content });
}

/**
 * Send an Alim Talk notification
 */
export async function sendAlimTalkNotification(
  recipientNo: string,
  templateCode: string,
  templateParameter: Record<string, string>,
  account: ResolvedKakaoAccount,
): Promise<{ success: boolean; error?: string }> {
  if (!isProactiveMessagingConfigured(account)) {
    return { success: false, error: "Alim Talk이 설정되지 않았습니다." };
  }

  const apiClient = createKakaoApiClient(account);
  return apiClient.sendAlimTalk({ recipientNo, templateCode, templateParameter });
}
