/**
 * Relay Command Handler
 *
 * Routes commands from KakaoTalk to target devices via Supabase command queue.
 * Handles command encryption, queuing, safety analysis, confirmation flow,
 * execution monitoring, and result retrieval.
 *
 * Safety flow:
 * 1. Command is parsed and analyzed by safety-guard
 * 2. Critical commands → blocked immediately
 * 3. High-risk commands → queued as "awaiting_confirmation", user must /확인
 * 4. Medium/low-risk commands → queued as "pending", auto-executed
 * 5. Device executes, sends progress updates, then final result
 * 6. User can check /원격결과 or /원격상태 to see progress
 */

import { createCipheriv, createDecipheriv, randomBytes, createHash } from "node:crypto";
import { getSupabase, isSupabaseConfigured } from "../supabase.js";
import { findDeviceByName, listUserDevices } from "./device-auth.js";
import { chargeRelayCommand } from "./relay-billing.js";
import { analyzeCommandSafety, formatSafetyWarning, type SafetyAnalysis } from "./safety-guard.js";
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

// ============================================
// Send Command (with safety analysis)
// ============================================

export interface SendRelayResult {
  success: boolean;
  commandId?: string;
  /** If the command requires confirmation, this contains the warning message */
  confirmationRequired?: boolean;
  safetyWarning?: string;
  error?: string;
}

/**
 * Send a command to a target device via the relay queue.
 * Analyzes safety first — dangerous commands require explicit confirmation.
 */
export async function sendRelayCommand(params: {
  userId: string;
  targetDeviceName: string;
  commandText: string;
  priority?: number;
}): Promise<SendRelayResult> {
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

  // Parse command text into a structured payload
  const payload = parseCommandText(commandText);

  // Safety analysis
  const safety = analyzeCommandSafety(payload);

  // Critical commands are always blocked
  if (safety.blocked) {
    return {
      success: false,
      error: formatSafetyWarning(safety, "", commandText),
    };
  }

  // Charge credits (even for awaiting_confirmation, refund on reject)
  const billing = await chargeRelayCommand(userId);
  if (!billing.success) {
    return { success: false, error: billing.error };
  }

  // Encrypt the command
  const { encrypted, iv, authTag } = encryptPayload(payload);

  // Determine initial status based on safety analysis
  const initialStatus: CommandStatus = safety.requiresConfirmation ? "awaiting_confirmation" : "pending";

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
      status: initialStatus,
      priority,
      credits_charged: billing.creditsCharged,
      risk_level: safety.riskLevel,
      safety_warnings: safety.warnings,
      command_preview: commandText.slice(0, 200),
      execution_log: [],
      expires_at: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
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

  // If confirmation required, return the warning
  if (safety.requiresConfirmation) {
    return {
      success: true,
      commandId: data.id,
      confirmationRequired: true,
      safetyWarning: formatSafetyWarning(safety, data.id, commandText),
    };
  }

  return { success: true, commandId: data.id };
}

// ============================================
// Confirmation Flow
// ============================================

/**
 * Confirm a command that is awaiting user confirmation.
 * Changes status from "awaiting_confirmation" to "pending".
 */
export async function confirmCommand(commandIdPrefix: string, userId: string): Promise<{
  success: boolean;
  commandId?: string;
  commandPreview?: string;
  error?: string;
}> {
  if (!isSupabaseConfigured()) {
    return { success: false, error: "서버가 설정되지 않았습니다." };
  }

  const supabase = getSupabase();

  // Find command by ID prefix (user only sees first 8 chars)
  const { data: commands } = await supabase
    .from("relay_commands")
    .select("id, command_preview, status")
    .eq("user_id", userId)
    .eq("status", "awaiting_confirmation")
    .like("id", `${commandIdPrefix}%`)
    .limit(1);

  if (!commands || commands.length === 0) {
    return { success: false, error: "확인 대기 중인 명령을 찾을 수 없습니다." };
  }

  const cmd = commands[0];

  // Update status to pending (device can now pick it up)
  const { error } = await supabase
    .from("relay_commands")
    .update({
      status: "pending",
      execution_log: [{ timestamp: new Date().toISOString(), event: "confirmed_by_user", message: "사용자가 실행을 승인했습니다." }],
    })
    .eq("id", cmd.id);

  if (error) {
    return { success: false, error: `확인 처리 실패: ${error.message}` };
  }

  return {
    success: true,
    commandId: cmd.id,
    commandPreview: cmd.command_preview,
  };
}

/**
 * Reject a command that is awaiting confirmation.
 * Credits are refunded.
 */
export async function rejectCommand(commandIdPrefix: string, userId: string): Promise<{
  success: boolean;
  refundedCredits?: number;
  error?: string;
}> {
  if (!isSupabaseConfigured()) {
    return { success: false, error: "서버가 설정되지 않았습니다." };
  }

  const supabase = getSupabase();

  // Find command
  const { data: commands } = await supabase
    .from("relay_commands")
    .select("id, credits_charged")
    .eq("user_id", userId)
    .eq("status", "awaiting_confirmation")
    .like("id", `${commandIdPrefix}%`)
    .limit(1);

  if (!commands || commands.length === 0) {
    return { success: false, error: "확인 대기 중인 명령을 찾을 수 없습니다." };
  }

  const cmd = commands[0];

  // Cancel the command
  await supabase
    .from("relay_commands")
    .update({ status: "cancelled" })
    .eq("id", cmd.id);

  // Refund credits if any were charged
  if (cmd.credits_charged > 0) {
    const { hashUserId } = await import("../billing.js");
    const hashedId = hashUserId(userId);
    await supabase.rpc("add_credits", {
      p_kakao_user_id: hashedId,
      p_amount: cmd.credits_charged,
    });
  }

  return { success: true, refundedCredits: cmd.credits_charged };
}

// ============================================
// Execution Progress
// ============================================

/**
 * Append a progress log entry to a command (called by device via API)
 */
export async function appendExecutionLog(
  commandId: string,
  deviceToken: string,
  logEntry: { event: string; message: string; data?: string },
): Promise<boolean> {
  if (!isSupabaseConfigured()) return false;

  const supabase = getSupabase();

  // Verify the device owns this command
  const { data: cmd } = await supabase
    .from("relay_commands")
    .select("id, execution_log, relay_devices!inner(device_token)")
    .eq("id", commandId)
    .single();

  if (!cmd) return false;

  const deviceData = cmd.relay_devices as unknown as { device_token: string };
  if (deviceData.device_token !== deviceToken) return false;

  // Append log entry
  const existingLog = (cmd.execution_log as Array<Record<string, unknown>>) ?? [];
  existingLog.push({
    timestamp: new Date().toISOString(),
    ...logEntry,
  });

  const { error } = await supabase
    .from("relay_commands")
    .update({
      status: "executing",
      execution_log: existingLog,
    })
    .eq("id", commandId);

  return !error;
}

/**
 * Get execution log for a command (for user monitoring)
 */
export async function getExecutionLog(commandId: string, userId: string): Promise<{
  status: CommandStatus;
  riskLevel?: string;
  commandPreview?: string;
  log: Array<{ timestamp: string; event: string; message: string; data?: string }>;
  result?: CommandResult;
  summary?: string;
  error?: string;
}> {
  if (!isSupabaseConfigured()) {
    return { status: "failed", log: [], error: "서버가 설정되지 않았습니다." };
  }

  const supabase = getSupabase();

  const { data, error } = await supabase
    .from("relay_commands")
    .select("status, risk_level, command_preview, execution_log, encrypted_result, result_iv, result_auth_tag, result_summary")
    .eq("id", commandId)
    .eq("user_id", userId)
    .single();

  if (error || !data) {
    return { status: "failed", log: [], error: "명령을 찾을 수 없습니다." };
  }

  const status = data.status as CommandStatus;
  const log = (data.execution_log as Array<{ timestamp: string; event: string; message: string; data?: string }>) ?? [];

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
    riskLevel: data.risk_level ?? undefined,
    commandPreview: data.command_preview ?? undefined,
    log,
    result,
    summary: data.result_summary ?? undefined,
  };
}

// ============================================
// Result Retrieval
// ============================================

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
  riskLevel?: string;
  commandPreview?: string;
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
      risk_level,
      command_preview,
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
    riskLevel: cmd.risk_level ?? undefined,
    commandPreview: cmd.command_preview ?? undefined,
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
    .in("status", ["pending", "awaiting_confirmation"]);

  return !error;
}

// ============================================
// Command Parsing
// ============================================

/**
 * Parse free-form command text into a structured payload.
 * Supports Korean and English command prefixes.
 */
export function parseCommandText(text: string): CommandPayload {
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
