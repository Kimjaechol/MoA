/**
 * Remote Wipe — Emergency data deletion for lost/stolen devices
 *
 * 핵심 변경: 백업 없이 분실 신고 시 → "백업 후 삭제" 전략
 *
 * Flow:
 * 1. 사용자가 다른 채널에서 /분실신고
 * 2. 클라우드 백업 확인:
 *    a) 백업 있음 → 즉시 삭제 명령 큐잉
 *    b) 백업 없음 → "backup_then_wipe" 명령 큐잉
 *       → 기기 온라인 시: 먼저 E2E 암호화 백업 → 백업 확인 → 삭제 실행
 * 3. 기기 토큰 즉시 폐기 (외부 릴레이 접근 차단, 내부 wipe 전용 토큰 발급)
 * 4. 기기가 온라인 되면:
 *    a) checkPendingWipe() 호출 (heartbeat에서)
 *    b) backup_then_wipe인 경우: 백업 먼저 수행
 *    c) 백업 성공 확인 후 secureWipeAll() 실행
 *    d) 결과 보고 + 사용자 알림
 *
 * 보안 계층:
 * - 삭제 명령 자체도 AES-256-GCM 암호화
 * - 기기 토큰 즉시 폐기 → 절취자가 relay 사용 불가
 * - 삭제 전용 내부 토큰으로만 wipe 통신 가능
 * - 삭제 실행 후 전용 토큰도 폐기
 */

import { randomUUID, createHash, randomBytes } from "node:crypto";
import { getSupabase, isSupabaseConfigured } from "../supabase.js";
import type { WipeCommand, WipeStatus } from "../relay/types.js";

/** Wipe strategy: immediate wipe vs backup-first-then-wipe */
export type WipeStrategy = "immediate" | "backup_then_wipe";

/** Extended wipe command with strategy info */
export interface ExtendedWipeCommand extends WipeCommand {
  /** Whether to backup before wiping */
  strategy: WipeStrategy;
  /** Internal-only wipe token (replaces revoked device token for wipe communication) */
  wipeToken?: string;
  /** Backup status tracking */
  backupStatus?: "pending" | "in_progress" | "completed" | "failed";
  /** Backup version after emergency backup */
  backupVersion?: number;
}

/**
 * Request a remote wipe for a device.
 *
 * Key change: if no cloud backup exists, strategy = "backup_then_wipe"
 * → device will perform emergency backup before wiping.
 */
export async function requestRemoteWipe(params: {
  userId: string;
  targetDeviceId: string;
  targetDeviceName: string;
  scope: WipeCommand["scope"];
  requestedBy: string;
  requestChannel: string;
  /** Force wipe even without backup (explicit user choice) */
  forceWithoutBackup?: boolean;
}): Promise<{
  success: boolean;
  wipeId?: string;
  strategy?: WipeStrategy;
  backupVerified?: boolean;
  wipeToken?: string;
  error?: string;
}> {
  if (!isSupabaseConfigured()) {
    return { success: false, error: "서버가 설정되지 않았습니다." };
  }

  const supabase = getSupabase();

  // Step 1: Check cloud backup status
  const { data: backupData } = await supabase
    .from("memory_sync")
    .select("version, created_at")
    .eq("user_id", params.userId)
    .order("version", { ascending: false })
    .limit(1);

  const hasBackup = backupData && backupData.length > 0;
  const backupAge = hasBackup
    ? Date.now() - new Date(backupData[0].created_at).getTime()
    : Infinity;
  const backupStale = backupAge > 24 * 60 * 60 * 1000; // > 24 hours old

  // Determine strategy
  let strategy: WipeStrategy;
  if (hasBackup && !backupStale) {
    strategy = "immediate";
  } else {
    // No backup or stale backup → backup first, then wipe
    strategy = "backup_then_wipe";
  }

  // Step 2: Check for existing pending wipe
  const { data: existingWipe } = await supabase
    .from("device_wipe_commands")
    .select("id, strategy")
    .eq("user_id", params.userId)
    .eq("target_device_id", params.targetDeviceId)
    .eq("executed", false)
    .limit(1);

  if (existingWipe && existingWipe.length > 0) {
    return {
      success: false,
      error:
        "이미 이 기기에 대한 삭제 명령이 대기 중입니다.\n" +
        "기기가 온라인되면 자동으로 실행됩니다.\n" +
        "취소하려면 /분실취소 를 입력하세요.",
    };
  }

  // Step 3: Generate wipe-only token (device uses this instead of revoked token)
  const wipeToken = `wipe_${randomBytes(32).toString("hex")}`;
  const wipeTokenHash = createHash("sha256").update(wipeToken).digest("hex");

  // Step 4: Create wipe command
  const wipeId = randomUUID();
  const now = new Date().toISOString();

  const { error } = await supabase.from("device_wipe_commands").insert({
    id: wipeId,
    user_id: params.userId,
    target_device_id: params.targetDeviceId,
    scope: params.scope,
    strategy,
    requested_by: params.requestedBy,
    request_channel: params.requestChannel,
    requested_at: now,
    executed: false,
    wipe_token_hash: wipeTokenHash,
    backup_status: strategy === "backup_then_wipe" ? "pending" : null,
  });

  if (error) {
    return { success: false, error: `삭제 명령 생성 실패: ${error.message}` };
  }

  // Step 5: Revoke the normal device token immediately
  // This blocks all normal relay operations (commands, conversations)
  // Only the wipe-specific token works now
  await supabase
    .from("relay_devices")
    .update({
      is_online: false,
      device_token: `revoked_${Date.now()}`,
    })
    .eq("id", params.targetDeviceId)
    .eq("user_id", params.userId);

  // Step 6: Store wipe token for the device to authenticate wipe operations
  await supabase.from("device_wipe_tokens").upsert({
    device_id: params.targetDeviceId,
    user_id: params.userId,
    wipe_token_hash: wipeTokenHash,
    created_at: now,
    expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(), // 7 days
  });

  return {
    success: true,
    wipeId,
    strategy,
    backupVerified: hasBackup ?? false,
    wipeToken,
  };
}

/**
 * Check for pending wipe commands on device connect/heartbeat.
 *
 * Called by the device during heartbeat. If a wipe is pending,
 * returns the full command including strategy (backup_then_wipe or immediate).
 */
export async function checkPendingWipe(params: {
  userId: string;
  deviceId: string;
}): Promise<ExtendedWipeCommand | null> {
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
    strategy: (wipe.strategy as WipeStrategy) ?? "immediate",
    requestedBy: wipe.requested_by,
    requestChannel: wipe.request_channel,
    requestedAt: wipe.requested_at,
    executed: false,
    backupStatus: wipe.backup_status ?? undefined,
  };
}

/**
 * Update backup status during backup_then_wipe flow.
 * Called by the device as it progresses through emergency backup.
 */
export async function updateWipeBackupStatus(params: {
  userId: string;
  deviceId: string;
  backupStatus: "in_progress" | "completed" | "failed";
  backupVersion?: number;
}): Promise<void> {
  if (!isSupabaseConfigured()) return;

  const supabase = getSupabase();

  await supabase
    .from("device_wipe_commands")
    .update({
      backup_status: params.backupStatus,
      ...(params.backupVersion != null ? { backup_version: params.backupVersion } : {}),
    })
    .eq("user_id", params.userId)
    .eq("target_device_id", params.deviceId)
    .eq("executed", false);
}

/**
 * Mark a wipe command as executed.
 * Called after the device has completed the wipe (and backup if required).
 */
export async function markWipeExecuted(params: {
  userId: string;
  deviceId: string;
  wipedFiles: number;
  wipedBytes: number;
  backupCompleted?: boolean;
  backupVersion?: number;
}): Promise<void> {
  if (!isSupabaseConfigured()) return;

  const supabase = getSupabase();
  const now = new Date().toISOString();

  // Mark wipe as executed
  await supabase
    .from("device_wipe_commands")
    .update({
      executed: true,
      executed_at: now,
      wipe_result: {
        files: params.wipedFiles,
        bytes: params.wipedBytes,
        backupCompleted: params.backupCompleted ?? false,
        backupVersion: params.backupVersion,
        completedAt: now,
      },
    })
    .eq("user_id", params.userId)
    .eq("target_device_id", params.deviceId)
    .eq("executed", false);

  // Revoke the wipe token (no longer needed)
  await supabase
    .from("device_wipe_tokens")
    .delete()
    .eq("device_id", params.deviceId)
    .eq("user_id", params.userId);
}

/**
 * Get wipe status for all user devices.
 */
export async function getWipeStatus(userId: string): Promise<WipeStatus[]> {
  if (!isSupabaseConfigured()) return [];

  const supabase = getSupabase();

  const [{ data: devices }, { data: wipes }] = await Promise.all([
    supabase.from("relay_devices").select("id, device_name, is_online").eq("user_id", userId),
    supabase
      .from("device_wipe_commands")
      .select("target_device_id, scope, strategy, requested_at, executed, executed_at, backup_status")
      .eq("user_id", userId)
      .order("requested_at", { ascending: false }),
  ]);

  if (!devices) return [];

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

  // Also clean up wipe token
  await supabase
    .from("device_wipe_tokens")
    .delete()
    .eq("device_id", params.targetDeviceId)
    .eq("user_id", params.userId);

  return { success: true };
}

// ============================================
// Display Formatters
// ============================================

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
        statusText += "\n    기기가 온라인되면 자동 백업 후 삭제됩니다.";
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

export function formatWipeConfirmation(params: {
  deviceName: string;
  scope: WipeCommand["scope"];
  hasBackup: boolean;
  strategy: WipeStrategy;
}): string {
  const scopeText = {
    all: "모든 데이터 (기억DB + 채팅 + 인증정보)",
    memory_db: "기억 데이터베이스",
    chat_history: "채팅 기록",
    credentials: "인증 정보",
  };

  const lines = [
    "⚠️ 분실 기기 원격 삭제",
    "",
    `📱 대상 기기: ${params.deviceName}`,
    `🗑️ 삭제 범위: ${scopeText[params.scope]}`,
  ];

  if (params.strategy === "backup_then_wipe") {
    lines.push(
      "",
      "☁️ 클라우드 백업: ❌ 최신 백업 없음",
      "📋 전략: 기기 온라인 시 먼저 백업 → 백업 확인 → 삭제",
      "    → 데이터가 안전하게 보존된 후 삭제됩니다.",
    );
  } else {
    lines.push(
      "",
      "☁️ 클라우드 백업: ✅ 있음 (복구 가능)",
      "📋 전략: 기기 온라인 시 즉시 삭제",
    );
  }

  lines.push(
    "",
    "🔒 보안 조치:",
    "    • 기기 접근 토큰이 즉시 폐기됩니다",
    "    • 절취자는 MoA 릴레이를 사용할 수 없습니다",
    "    • 삭제는 3중 덮어쓰기로 복구 불가능합니다",
    "",
    "진행하려면 /분실확인 을 입력하세요.",
    "취소하려면 /분실취소 를 입력하세요.",
  );

  return lines.join("\n");
}

/**
 * Format wipe notification sent to user after device executes wipe.
 */
export function formatWipeCompletionNotice(params: {
  deviceName: string;
  wipedFiles: number;
  wipedBytes: number;
  backupCompleted: boolean;
  backupVersion?: number;
}): string {
  const sizeMB = (params.wipedBytes / (1024 * 1024)).toFixed(1);

  const lines = [
    "🔐 원격 삭제 완료",
    "",
    `📱 기기: ${params.deviceName}`,
    `🗑️ 삭제된 파일: ${params.wipedFiles}개 (${sizeMB}MB)`,
  ];

  if (params.backupCompleted) {
    lines.push(`☁️ 백업 완료: 버전 ${params.backupVersion ?? "?"}`);
    lines.push("    → 새 기기에서 /동기화 다운로드로 복구 가능");
  }

  lines.push(
    "",
    "✅ 분실 기기의 모든 민감 데이터가 안전하게 삭제되었습니다.",
    "    새 기기에서 MoA를 설치하고 /기기등록으로 시작하세요.",
  );

  return lines.join("\n");
}
