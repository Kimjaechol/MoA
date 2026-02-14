/**
 * Remote Wipe — Emergency data deletion for lost/stolen devices
 *
 * When a phone is lost or stolen, the user can trigger a remote wipe
 * from any other channel (KakaoTalk, Telegram, Discord, web, etc.).
 *
 * Flow:
 * 1. User sends "/분실신고" or "/기기삭제 <device>" from any channel
 * 2. System verifies user identity (channel-specific auth, already done)
 * 3. Wipe command queued in Supabase (encrypted, like relay commands)
 * 4. If device is online: wipe executes immediately
 * 5. If device is offline: wipe executes on next connect (heartbeat)
 *
 * What gets wiped:
 * - "all": Everything (DB + chat + credentials)
 * - "memory_db": Only the vector database
 * - "chat_history": Only chat logs and session files
 * - "credentials": Only auth tokens and keys
 *
 * Safety:
 * - Cloud backup is verified to exist before wipe is allowed
 * - Wipe requires explicit confirmation (two-step)
 * - Wipe is logged for audit trail
 * - Recovery is possible from cloud backup after wipe
 */

import { randomUUID } from "node:crypto";
import { getSupabase, isSupabaseConfigured } from "../supabase.js";
import type { WipeCommand, WipeStatus } from "../relay/types.js";

/**
 * Request a remote wipe for a device.
 *
 * This creates a wipe command in Supabase. If the device is online,
 * it will pick up the command on next poll. If offline, it will
 * execute on reconnect.
 */
export async function requestRemoteWipe(params: {
  userId: string;
  targetDeviceId: string;
  targetDeviceName: string;
  scope: WipeCommand["scope"];
  requestedBy: string;
  requestChannel: string;
}): Promise<{
  success: boolean;
  wipeId?: string;
  backupVerified?: boolean;
  error?: string;
}> {
  if (!isSupabaseConfigured()) {
    return { success: false, error: "서버가 설정되지 않았습니다." };
  }

  const supabase = getSupabase();

  // Step 1: Verify cloud backup exists before allowing wipe
  const { data: backupData } = await supabase
    .from("memory_sync")
    .select("version, created_at")
    .eq("user_id", params.userId)
    .order("version", { ascending: false })
    .limit(1);

  const hasBackup = backupData && backupData.length > 0;

  if (!hasBackup && params.scope === "all") {
    return {
      success: false,
      backupVerified: false,
      error:
        "⚠️ 클라우드 백업이 없습니다!\n" +
        "전체 삭제를 진행하면 모든 기억 데이터가 영구 삭제됩니다.\n" +
        "먼저 다른 기기에서 /동기화 업로드를 실행해주세요.\n\n" +
        "그래도 진행하려면 /분실신고 강제삭제 를 입력하세요.",
    };
  }

  // Step 2: Check if there's already a pending wipe for this device
  const { data: existingWipe } = await supabase
    .from("device_wipe_commands")
    .select("id")
    .eq("user_id", params.userId)
    .eq("target_device_id", params.targetDeviceId)
    .eq("executed", false)
    .limit(1);

  if (existingWipe && existingWipe.length > 0) {
    return {
      success: false,
      error:
        "이미 이 기기에 대한 삭제 명령이 대기 중입니다.\n" +
        "기기가 온라인되면 자동으로 실행됩니다.",
    };
  }

  // Step 3: Create wipe command
  const wipeId = randomUUID();
  const now = new Date().toISOString();

  const { error } = await supabase.from("device_wipe_commands").insert({
    id: wipeId,
    user_id: params.userId,
    target_device_id: params.targetDeviceId,
    scope: params.scope,
    requested_by: params.requestedBy,
    request_channel: params.requestChannel,
    requested_at: now,
    executed: false,
  });

  if (error) {
    return { success: false, error: `삭제 명령 생성 실패: ${error.message}` };
  }

  // Step 4: Also revoke the device token immediately (blocks relay access)
  await supabase
    .from("relay_devices")
    .update({ is_online: false, device_token: `revoked_${Date.now()}` })
    .eq("id", params.targetDeviceId)
    .eq("user_id", params.userId);

  return { success: true, wipeId, backupVerified: hasBackup ?? false };
}

/**
 * Check for pending wipe commands on device connect/heartbeat.
 *
 * Called by the device during heartbeat to see if a wipe is pending.
 * Returns the wipe command if one exists.
 */
export async function checkPendingWipe(params: {
  userId: string;
  deviceId: string;
}): Promise<WipeCommand | null> {
  if (!isSupabaseConfigured()) return null;

  const supabase = getSupabase();

  const { data } = await supabase
    .from("device_wipe_commands")
    .select("*")
    .eq("user_id", params.userId)
    .eq("target_device_id", params.deviceId)
    .eq("executed", false)
    .order("requested_at", { ascending: false })
    .limit(1);

  if (!data || data.length === 0) return null;

  const wipe = data[0];
  return {
    targetDeviceId: wipe.target_device_id,
    scope: wipe.scope as WipeCommand["scope"],
    requestedBy: wipe.requested_by,
    requestChannel: wipe.request_channel,
    requestedAt: wipe.requested_at,
    executed: false,
  };
}

/**
 * Mark a wipe command as executed.
 * Called after the device has completed the wipe.
 */
export async function markWipeExecuted(params: {
  userId: string;
  deviceId: string;
  wipedFiles: number;
  wipedBytes: number;
}): Promise<void> {
  if (!isSupabaseConfigured()) return;

  const supabase = getSupabase();
  const now = new Date().toISOString();

  await supabase
    .from("device_wipe_commands")
    .update({
      executed: true,
      executed_at: now,
      wipe_result: {
        files: params.wipedFiles,
        bytes: params.wipedBytes,
        completedAt: now,
      },
    })
    .eq("user_id", params.userId)
    .eq("target_device_id", params.deviceId)
    .eq("executed", false);
}

/**
 * Get wipe status for all user devices — for /분실상태 command.
 */
export async function getWipeStatus(userId: string): Promise<WipeStatus[]> {
  if (!isSupabaseConfigured()) return [];

  const supabase = getSupabase();

  // Get all devices
  const { data: devices } = await supabase
    .from("relay_devices")
    .select("id, device_name, is_online")
    .eq("user_id", userId);

  if (!devices) return [];

  // Get all wipe commands
  const { data: wipes } = await supabase
    .from("device_wipe_commands")
    .select("target_device_id, scope, requested_at, executed, executed_at")
    .eq("user_id", userId)
    .order("requested_at", { ascending: false });

  return devices.map((device) => {
    const latestWipe = wipes?.find((w) => w.target_device_id === device.id);

    return {
      deviceId: device.id,
      deviceName: device.device_name,
      isOnline: device.is_online,
      pendingWipe: latestWipe ? !latestWipe.executed : false,
      wipeScope: latestWipe?.scope as WipeCommand["scope"] | undefined,
      requestedAt: latestWipe?.requested_at ?? undefined,
      executedAt: latestWipe?.executed_at ?? undefined,
    };
  });
}

/**
 * Cancel a pending wipe (before it executes).
 */
export async function cancelWipe(params: {
  userId: string;
  targetDeviceId: string;
}): Promise<{ success: boolean; error?: string }> {
  if (!isSupabaseConfigured()) {
    return { success: false, error: "서버가 설정되지 않았습니다." };
  }

  const supabase = getSupabase();

  const { data } = await supabase
    .from("device_wipe_commands")
    .delete()
    .eq("user_id", params.userId)
    .eq("target_device_id", params.targetDeviceId)
    .eq("executed", false)
    .select("id");

  if (!data || data.length === 0) {
    return { success: false, error: "대기 중인 삭제 명령이 없습니다." };
  }

  return { success: true };
}

/**
 * Format wipe status for display in chat.
 */
export function formatWipeStatus(statuses: WipeStatus[]): string {
  if (statuses.length === 0) {
    return "등록된 기기가 없습니다.";
  }

  const lines = ["🔐 기기 보안 상태", ""];

  for (const s of statuses) {
    const onlineIcon = s.isOnline ? "🟢" : "🔴";
    let statusText = `${onlineIcon} ${s.deviceName}`;

    if (s.pendingWipe) {
      statusText += ` — ⚠️ 삭제 대기 중 (${s.wipeScope})`;
      if (!s.isOnline) {
        statusText += "\n    기기가 온라인되면 자동 삭제됩니다.";
      }
    } else if (s.executedAt) {
      const execDate = new Date(s.executedAt).toLocaleString("ko-KR");
      statusText += ` — ✅ 삭제 완료 (${execDate})`;
    } else {
      statusText += " — 정상";
    }

    lines.push(statusText);
  }

  return lines.join("\n");
}

/**
 * Format wipe confirmation message (before executing).
 */
export function formatWipeConfirmation(params: {
  deviceName: string;
  scope: WipeCommand["scope"];
  hasBackup: boolean;
}): string {
  const scopeText = {
    all: "모든 데이터 (기억DB + 채팅 + 인증정보)",
    memory_db: "기억 데이터베이스",
    chat_history: "채팅 기록",
    credentials: "인증 정보",
  };

  const lines = [
    "⚠️ 원격 삭제 확인",
    "",
    `📱 대상 기기: ${params.deviceName}`,
    `🗑️ 삭제 범위: ${scopeText[params.scope]}`,
    `☁️ 클라우드 백업: ${params.hasBackup ? "✅ 있음 (복구 가능)" : "❌ 없음 (복구 불가!)"}`,
    "",
    "이 작업은 되돌릴 수 없습니다.",
    "진행하려면 /분실확인 을 입력하세요.",
    "취소하려면 /분실취소 를 입력하세요.",
  ];

  return lines.join("\n");
}
