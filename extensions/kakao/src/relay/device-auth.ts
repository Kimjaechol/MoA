/**
 * Device Authentication & Pairing
 *
 * Handles device registration via pairing codes and token-based authentication.
 *
 * Pairing flow:
 * 1. User sends /기기등록 via KakaoTalk → MoA generates 6-digit code (10 min TTL)
 * 2. User runs `moltbot relay pair --code <code>` on target device
 * 3. Device sends code + device info to POST /api/relay/pair
 * 4. MoA verifies code, creates device record, returns device token
 * 5. Device stores token locally and uses it for all future API calls
 */

import { randomBytes, createHmac } from "node:crypto";
import type { DeviceRegistration, PairingResult, RelayDevice } from "./types.js";
import { getSupabase, isSupabaseConfigured } from "../supabase.js";

const PAIRING_CODE_TTL_MINUTES = 10;
const DEVICE_TOKEN_BYTES = 32;

/**
 * Generate a 6-digit pairing code for a user
 */
export async function generatePairingCode(
  userId: string,
): Promise<{ code: string; expiresAt: Date } | { error: string }> {
  if (!isSupabaseConfigured()) {
    return { error: "Supabase가 설정되지 않았습니다." };
  }

  const supabase = getSupabase();

  // Clean up expired/used codes first
  await supabase
    .from("relay_pairing_codes")
    .delete()
    .or(`expires_at.lt.${new Date().toISOString()},used.eq.true`);

  // Check if user already has an active code
  const { data: existing } = await supabase
    .from("relay_pairing_codes")
    .select("code, expires_at")
    .eq("user_id", userId)
    .eq("used", false)
    .gt("expires_at", new Date().toISOString())
    .single();

  if (existing) {
    return {
      code: existing.code,
      expiresAt: new Date(existing.expires_at),
    };
  }

  // Generate unique 6-digit code
  const code = generateSixDigitCode();
  const expiresAt = new Date(Date.now() + PAIRING_CODE_TTL_MINUTES * 60 * 1000);

  const { error } = await supabase.from("relay_pairing_codes").insert({
    user_id: userId,
    code,
    expires_at: expiresAt.toISOString(),
  });

  if (error) {
    // Retry with a different code if collision
    if (error.code === "23505") {
      const retryCode = generateSixDigitCode();
      const { error: retryError } = await supabase.from("relay_pairing_codes").insert({
        user_id: userId,
        code: retryCode,
        expires_at: expiresAt.toISOString(),
      });
      if (retryError) {
        return { error: `페어링 코드 생성 실패: ${retryError.message}` };
      }
      return { code: retryCode, expiresAt };
    }
    return { error: `페어링 코드 생성 실패: ${error.message}` };
  }

  return { code, expiresAt };
}

/**
 * Complete device pairing using a pairing code
 */
export async function completePairing(
  code: string,
  device: DeviceRegistration,
): Promise<PairingResult> {
  if (!isSupabaseConfigured()) {
    return { success: false, error: "Supabase가 설정되지 않았습니다." };
  }

  const supabase = getSupabase();

  // Find valid pairing code
  const { data: pairingCode, error: findError } = await supabase
    .from("relay_pairing_codes")
    .select("id, user_id")
    .eq("code", code)
    .eq("used", false)
    .gt("expires_at", new Date().toISOString())
    .single();

  if (findError || !pairingCode) {
    return { success: false, error: "유효하지 않거나 만료된 페어링 코드입니다." };
  }

  // Check device limit
  const { count } = await supabase
    .from("relay_devices")
    .select("id", { count: "exact", head: true })
    .eq("user_id", pairingCode.user_id);

  const maxDevices = Number(process.env.RELAY_MAX_DEVICES ?? 5);
  if ((count ?? 0) >= maxDevices) {
    return { success: false, error: `최대 ${maxDevices}개의 기기만 등록할 수 있습니다.` };
  }

  // Check for duplicate device name
  const { data: existingDevice } = await supabase
    .from("relay_devices")
    .select("id")
    .eq("user_id", pairingCode.user_id)
    .eq("device_name", device.deviceName)
    .single();

  if (existingDevice) {
    return {
      success: false,
      error: `"${device.deviceName}" 이름의 기기가 이미 등록되어 있습니다.`,
    };
  }

  // Generate device token
  const deviceToken = generateDeviceToken();

  // Create device record
  const { data: newDevice, error: insertError } = await supabase
    .from("relay_devices")
    .insert({
      user_id: pairingCode.user_id,
      device_token: deviceToken,
      device_name: device.deviceName,
      device_type: device.deviceType,
      platform: device.platform,
      capabilities: device.capabilities ?? [],
      is_online: true,
      last_seen_at: new Date().toISOString(),
    })
    .select("id")
    .single();

  if (insertError || !newDevice) {
    return { success: false, error: `기기 등록 실패: ${insertError?.message}` };
  }

  // Mark pairing code as used
  await supabase.from("relay_pairing_codes").update({ used: true }).eq("id", pairingCode.id);

  return {
    success: true,
    deviceToken,
    deviceId: newDevice.id,
    userId: pairingCode.user_id,
  };
}

/**
 * Authenticate a device by its token. Returns the device if valid.
 */
export async function authenticateDevice(deviceToken: string): Promise<RelayDevice | null> {
  if (!isSupabaseConfigured()) {
    return null;
  }

  const supabase = getSupabase();

  const { data, error } = await supabase
    .from("relay_devices")
    .select("*")
    .eq("device_token", deviceToken)
    .single();

  if (error || !data) {
    return null;
  }

  return {
    id: data.id,
    userId: data.user_id,
    deviceToken: data.device_token,
    deviceName: data.device_name,
    deviceType: data.device_type as RelayDevice["deviceType"],
    platform: data.platform,
    lastSeenAt: data.last_seen_at ? new Date(data.last_seen_at) : null,
    isOnline: data.is_online,
    capabilities: (data.capabilities ?? []) as RelayDevice["capabilities"],
    createdAt: new Date(data.created_at),
  };
}

/**
 * List all devices for a user
 */
export async function listUserDevices(userId: string): Promise<RelayDevice[]> {
  if (!isSupabaseConfigured()) {
    return [];
  }

  const supabase = getSupabase();

  const { data, error } = await supabase
    .from("relay_devices")
    .select("*")
    .eq("user_id", userId)
    .order("created_at", { ascending: true });

  if (error || !data) {
    return [];
  }

  return data.map((d) => ({
    id: d.id,
    userId: d.user_id,
    deviceToken: d.device_token,
    deviceName: d.device_name,
    deviceType: d.device_type as RelayDevice["deviceType"],
    platform: d.platform,
    lastSeenAt: d.last_seen_at ? new Date(d.last_seen_at) : null,
    isOnline: d.is_online,
    capabilities: (d.capabilities ?? []) as RelayDevice["capabilities"],
    createdAt: new Date(d.created_at),
  }));
}

/**
 * Find a device by name for a user
 */
export async function findDeviceByName(
  userId: string,
  deviceName: string,
): Promise<RelayDevice | null> {
  if (!isSupabaseConfigured()) {
    return null;
  }

  const supabase = getSupabase();

  const { data, error } = await supabase
    .from("relay_devices")
    .select("*")
    .eq("user_id", userId)
    .ilike("device_name", deviceName)
    .single();

  if (error || !data) {
    return null;
  }

  return {
    id: data.id,
    userId: data.user_id,
    deviceToken: data.device_token,
    deviceName: data.device_name,
    deviceType: data.device_type as RelayDevice["deviceType"],
    platform: data.platform,
    lastSeenAt: data.last_seen_at ? new Date(data.last_seen_at) : null,
    isOnline: data.is_online,
    capabilities: (data.capabilities ?? []) as RelayDevice["capabilities"],
    createdAt: new Date(data.created_at),
  };
}

/**
 * Remove a device
 */
export async function removeDevice(userId: string, deviceName: string): Promise<boolean> {
  if (!isSupabaseConfigured()) {
    return false;
  }

  const supabase = getSupabase();

  const { error } = await supabase
    .from("relay_devices")
    .delete()
    .eq("user_id", userId)
    .ilike("device_name", deviceName);

  return !error;
}

/**
 * Update device heartbeat
 */
export async function updateHeartbeat(deviceToken: string): Promise<number> {
  if (!isSupabaseConfigured()) {
    return 0;
  }

  const supabase = getSupabase();

  // Update last_seen
  await supabase
    .from("relay_devices")
    .update({ last_seen_at: new Date().toISOString(), is_online: true })
    .eq("device_token", deviceToken);

  // Count pending commands
  const device = await authenticateDevice(deviceToken);
  if (!device) {
    return 0;
  }

  const { count } = await supabase
    .from("relay_commands")
    .select("id", { count: "exact", head: true })
    .eq("target_device_id", device.id)
    .eq("status", "pending")
    .gt("expires_at", new Date().toISOString());

  return count ?? 0;
}

// ============================================
// Helpers
// ============================================

function generateSixDigitCode(): string {
  // Generate a random 6-digit code (100000-999999)
  const bytes = randomBytes(4);
  const num = (bytes.readUInt32BE(0) % 900000) + 100000;
  return num.toString();
}

let warnedAboutDefaultHmacKey = false;

function generateDeviceToken(): string {
  const token = randomBytes(DEVICE_TOKEN_BYTES).toString("hex");
  const hmacKey = process.env.LAWCALL_ENCRYPTION_KEY ?? process.env.SUPABASE_SERVICE_KEY;
  if (!hmacKey) {
    if (!warnedAboutDefaultHmacKey) {
      console.warn(
        "[relay] WARNING: No LAWCALL_ENCRYPTION_KEY or SUPABASE_SERVICE_KEY set for device token HMAC. Using insecure fallback — NOT safe for production!",
      );
      warnedAboutDefaultHmacKey = true;
    }
  }
  const hmac = createHmac("sha256", hmacKey ?? "moa-relay-default-dev-only");
  hmac.update(token);
  return `moa_${token}_${hmac.digest("hex").slice(0, 8)}`;
}
