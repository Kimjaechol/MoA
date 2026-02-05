/**
 * Relay Command Handler
 *
 * Routes commands from KakaoTalk to target devices via Supabase command queue.
 * Handles command encryption, queuing, and result retrieval.
 */

import { createCipheriv, createDecipheriv, randomBytes, createHash } from "node:crypto";
import { getSupabase, isSupabaseConfigured } from "../supabase.js";
import { findDeviceByName, listUserDevices } from "./device-auth.js";
import { chargeRelayCommand } from "./relay-billing.js";
import type { CommandPayload, CommandResult, CommandStatus } from "./types.js";

// Encryption key derived from env (used for encrypting commands at rest)
function getRelayEncryptionKey(): Buffer {
  const key = process.env.LAWCALL_ENCRYPTION_KEY ?? process.env.SUPABASE_SERVICE_KEY ?? "moa-relay-default";
  return createHash("sha256").update(key).digest();
}

/**
 * Encrypt a command payload for storage
 */
function encryptPayload(payload: CommandPayload | CommandResult): { encrypted: string; iv: string; authTag: string } {
  const key = getRelayEncryptionKey();
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);

  const plaintext = JSON.stringify(payload);
  let encrypted = cipher.update(plaintext, "utf8", "base64");
  encrypted += cipher.final("base64");
  const authTag = cipher.getAuthTag().toString("base64");

  return {
    encrypted,
    iv: iv.toString("base64"),
    authTag,
  };
}

/**
 * Decrypt a command payload from storage
 */
export function decryptPayload<T = CommandPayload | CommandResult>(
  encrypted: string,
  iv: string,
  authTag: string,
): T | null {
  try {
    const key = getRelayEncryptionKey();
    const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(iv, "base64"));
    decipher.setAuthTag(Buffer.from(authTag, "base64"));

    let decrypted = decipher.update(encrypted, "base64", "utf8");
    decrypted += decipher.final("utf8");
    return JSON.parse(decrypted) as T;
  } catch {
    return null;
  }
}

/**
 * Send a command to a target device via the relay queue.
 *
 * Called when a user sends `/원격 <device_name> <command>` via KakaoTalk.
 */
export async function sendRelayCommand(params: {
  userId: string;
  targetDeviceName: string;
  commandText: string;
  priority?: number;
}): Promise<{ success: boolean; commandId?: string; error?: string }> {
  const { userId, targetDeviceName, commandText, priority = 0 } = params;

  if (!isSupabaseConfigured()) {
    return { success: false, error: "서버가 아직 설정되지 않았습니다." };
  }

  // Find target device
  const device = await findDeviceByName(userId, targetDeviceName);
  if (!device) {
    const devices = await listUserDevices(userId);
    if (devices.length === 0) {
      return { success: false, error: "등록된 기기가 없습니다. /기기등록 명령으로 먼저 기기를 등록해주세요." };
    }
    const names = devices.map((d) => `• ${d.deviceName} (${d.isOnline ? "온라인" : "오프라인"})`).join("\n");
    return { success: false, error: `"${targetDeviceName}" 기기를 찾을 수 없습니다.\n\n등록된 기기:\n${names}` };
  }

  if (!device.isOnline) {
    return {
      success: false,
      error: `"${device.deviceName}" 기기가 오프라인입니다. 기기에서 moltbot relay가 실행 중인지 확인해주세요.`,
    };
  }

  // Charge credits
  const billing = await chargeRelayCommand(userId);
  if (!billing.success) {
    return { success: false, error: billing.error };
  }

  // Parse command text into a structured payload
  const payload = parseCommandText(commandText);

  // Encrypt the command
  const { encrypted, iv, authTag } = encryptPayload(payload);

  // Insert into command queue
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from("relay_commands")
    .insert({
      user_id: userId,
      target_device_id: device.id,
      encrypted_command: encrypted,
      iv,
      auth_tag: authTag,
      status: "pending",
      priority,
      credits_charged: billing.creditsCharged,
      expires_at: new Date(Date.now() + 60 * 60 * 1000).toISOString(), // 1 hour expiry
    })
    .select("id")
    .single();

  if (error || !data) {
    return { success: false, error: `명령 전송 실패: ${error?.message}` };
  }

  // Record usage
  await supabase.from("relay_usage").insert({
    user_id: userId,
    command_id: data.id,
    credits_used: billing.creditsCharged,
    action: "command",
  });

  return { success: true, commandId: data.id };
}

/**
 * Get the result of a relay command
 */
export async function getCommandResult(commandId: string, userId: string): Promise<{
  status: CommandStatus;
  result?: CommandResult;
  summary?: string;
  error?: string;
}> {
  if (!isSupabaseConfigured()) {
    return { status: "failed", error: "서버가 설정되지 않았습니다." };
  }

  const supabase = getSupabase();

  const { data, error } = await supabase
    .from("relay_commands")
    .select("status, encrypted_result, result_iv, result_auth_tag, result_summary")
    .eq("id", commandId)
    .eq("user_id", userId)
    .single();

  if (error || !data) {
    return { status: "failed", error: "명령을 찾을 수 없습니다." };
  }

  const status = data.status as CommandStatus;

  if (status === "completed" || status === "failed") {
    let result: CommandResult | undefined;
    if (data.encrypted_result && data.result_iv && data.result_auth_tag) {
      result = decryptPayload<CommandResult>(
        data.encrypted_result,
        data.result_iv,
        data.result_auth_tag,
      ) ?? undefined;
    }
    return {
      status,
      result,
      summary: data.result_summary ?? undefined,
    };
  }

  return { status };
}

/**
 * Get recent commands for a user (for status display)
 */
export async function getRecentCommands(userId: string, limit = 5): Promise<Array<{
  id: string;
  deviceName: string;
  status: CommandStatus;
  summary?: string;
  createdAt: Date;
}>> {
  if (!isSupabaseConfigured()) return [];

  const supabase = getSupabase();

  const { data, error } = await supabase
    .from("relay_commands")
    .select(`
      id,
      status,
      result_summary,
      created_at,
      relay_devices!inner(device_name)
    `)
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error || !data) return [];

  return data.map((cmd) => ({
    id: cmd.id,
    deviceName: (cmd.relay_devices as unknown as { device_name: string }).device_name,
    status: cmd.status as CommandStatus,
    summary: cmd.result_summary ?? undefined,
    createdAt: new Date(cmd.created_at),
  }));
}

/**
 * Cancel a pending command
 */
export async function cancelCommand(commandId: string, userId: string): Promise<boolean> {
  if (!isSupabaseConfigured()) return false;

  const supabase = getSupabase();

  const { error } = await supabase
    .from("relay_commands")
    .update({ status: "cancelled" })
    .eq("id", commandId)
    .eq("user_id", userId)
    .eq("status", "pending");

  return !error;
}

// ============================================
// Command Parsing
// ============================================

/**
 * Parse free-form command text into a structured payload.
 * Supports Korean and English command prefixes.
 */
function parseCommandText(text: string): CommandPayload {
  const trimmed = text.trim();

  // File read: 파일읽기 <path> or read <path>
  const fileReadMatch = trimmed.match(/^(?:파일읽기|파일\s*열기|read|cat)\s+(.+)$/i);
  if (fileReadMatch) {
    return { type: "file_read", command: fileReadMatch[1].trim() };
  }

  // File list: 파일목록 <path> or ls <path>
  const fileListMatch = trimmed.match(/^(?:파일목록|파일\s*리스트|ls|dir)\s*(.*)$/i);
  if (fileListMatch) {
    return { type: "file_list", command: fileListMatch[1].trim() || "." };
  }

  // Browser open: 브라우저 <url> or open <url>
  const browserMatch = trimmed.match(/^(?:브라우저|열기|open|browse)\s+(https?:\/\/.+)$/i);
  if (browserMatch) {
    return { type: "browser_open", command: browserMatch[1].trim() };
  }

  // Clipboard: 클립보드 or clipboard
  if (/^(?:클립보드|clipboard)$/i.test(trimmed)) {
    return { type: "clipboard", command: "get" };
  }

  // Screenshot: 스크린샷 or screenshot
  if (/^(?:스크린샷|screenshot|캡처)$/i.test(trimmed)) {
    return { type: "screenshot", command: "capture" };
  }

  // Default: treat as shell command
  return { type: "shell", command: trimmed, timeout: 60 };
}
