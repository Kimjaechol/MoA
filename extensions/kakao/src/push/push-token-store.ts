/**
 * Push Token Store
 *
 * FCM/APNs 푸시 토큰의 저장/조회/갱신을 담당합니다.
 * relay_devices 테이블에 push_token, push_platform 컬럼을 사용합니다.
 */

import { getSupabase, isSupabaseConfigured } from "../supabase.js";

export type PushPlatform = "fcm" | "apns";

export interface PushTokenInfo {
  deviceId: string;
  deviceName: string;
  pushToken: string;
  pushPlatform: PushPlatform;
  updatedAt: Date;
}

/**
 * 디바이스의 푸시 토큰 저장/갱신
 */
export async function savePushToken(
  deviceId: string,
  pushToken: string,
  pushPlatform: PushPlatform,
): Promise<{ success: boolean; error?: string }> {
  if (!isSupabaseConfigured()) {
    return { success: false, error: "Supabase not configured" };
  }

  const supabase = getSupabase();
  const { error } = await supabase
    .from("relay_devices")
    .update({
      push_token: pushToken,
      push_platform: pushPlatform,
      push_token_updated_at: new Date().toISOString(),
    })
    .eq("id", deviceId);

  if (error) {
    return { success: false, error: error.message };
  }

  return { success: true };
}

/**
 * 사용자의 모든 디바이스 푸시 토큰 조회
 */
export async function getUserPushTokens(userId: string): Promise<PushTokenInfo[]> {
  if (!isSupabaseConfigured()) {
    return [];
  }

  const supabase = getSupabase();
  const { data, error } = await supabase
    .from("relay_devices")
    .select("id, device_name, push_token, push_platform, push_token_updated_at")
    .eq("user_id", userId)
    .not("push_token", "is", null);

  if (error || !data) {
    return [];
  }

  return data.map((row) => ({
    deviceId: row.id,
    deviceName: row.device_name,
    pushToken: row.push_token,
    pushPlatform: row.push_platform as PushPlatform,
    updatedAt: new Date(row.push_token_updated_at),
  }));
}

/**
 * 특정 디바이스의 푸시 토큰 조회
 */
export async function getDevicePushToken(deviceId: string): Promise<PushTokenInfo | null> {
  if (!isSupabaseConfigured()) {
    return null;
  }

  const supabase = getSupabase();
  const { data, error } = await supabase
    .from("relay_devices")
    .select("id, device_name, push_token, push_platform, push_token_updated_at")
    .eq("id", deviceId)
    .not("push_token", "is", null)
    .single();

  if (error || !data) {
    return null;
  }

  return {
    deviceId: data.id,
    deviceName: data.device_name,
    pushToken: data.push_token,
    pushPlatform: data.push_platform as PushPlatform,
    updatedAt: new Date(data.push_token_updated_at),
  };
}

/**
 * 푸시 토큰 삭제 (앱 로그아웃/삭제 시)
 */
export async function removePushToken(deviceId: string): Promise<void> {
  if (!isSupabaseConfigured()) return;

  const supabase = getSupabase();
  await supabase
    .from("relay_devices")
    .update({
      push_token: null,
      push_platform: null,
      push_token_updated_at: null,
    })
    .eq("id", deviceId);
}
