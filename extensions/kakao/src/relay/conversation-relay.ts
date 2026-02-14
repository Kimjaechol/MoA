/**
 * Conversation Relay — Device-First Memory Engine
 *
 * Routes user conversations through the best available device for
 * memory-augmented AI responses. The device performs local sqlite-vec
 * search, calls the AI API with memory context, and returns the response.
 *
 * 3-Tier response strategy:
 *   Tier 1 (Cache):    Upstash semantic cache — instant, no device needed
 *   Tier 2 (Device):   Relay to best online device — full memory context
 *   Tier 3 (Fallback): Direct AI call without memory — degraded but available
 *
 * Cost model:
 *   - Tier 1: $0 (Upstash free tier covers most usage)
 *   - Tier 2: $0 server-side (device does all compute)
 *   - Tier 3: Standard AI API cost (only when all devices offline)
 */

import { randomUUID } from "node:crypto";
import { getSupabase, isSupabaseConfigured } from "../supabase.js";
import { listUserDevices } from "./device-auth.js";
import type {
  ConversationRelayPayload,
  ConversationRelayResult,
  QueuedMessage,
  RelayDevice,
  ResponseStrategy,
  ResponseTier,
} from "./types.js";

// Default timeout waiting for device response (seconds)
const DEFAULT_DEVICE_TIMEOUT_SEC = 10;

// Poll interval when waiting for device response (ms)
const DEVICE_POLL_INTERVAL_MS = 500;

// How long a device can be unseen before considered stale (ms)
const DEVICE_STALE_THRESHOLD_MS = 2 * 60 * 1000; // 2 minutes

/**
 * Select the best online device for conversation processing.
 *
 * Selection criteria (priority order):
 * 1. Most recently seen (freshest heartbeat)
 * 2. Desktop/laptop preferred over mobile (more compute power)
 * 3. Must have been seen within DEVICE_STALE_THRESHOLD_MS
 */
export function selectBestDevice(devices: RelayDevice[]): RelayDevice | null {
  const now = Date.now();

  const candidates = devices
    .filter((d) => {
      if (!d.isOnline) return false;
      if (!d.lastSeenAt) return false;
      const age = now - new Date(d.lastSeenAt).getTime();
      return age < DEVICE_STALE_THRESHOLD_MS;
    })
    .sort((a, b) => {
      // Prefer desktop/laptop over mobile for compute
      const typeScore = (d: RelayDevice) => {
        if (d.deviceType === "desktop" || d.deviceType === "laptop") return 2;
        if (d.deviceType === "server") return 3; // server is best
        return 1; // mobile, tablet, other
      };

      const scoreDiff = typeScore(b) - typeScore(a);
      if (scoreDiff !== 0) return scoreDiff;

      // Then by most recently seen
      const aTime = a.lastSeenAt ? new Date(a.lastSeenAt).getTime() : 0;
      const bTime = b.lastSeenAt ? new Date(b.lastSeenAt).getTime() : 0;
      return bTime - aTime;
    });

  return candidates[0] ?? null;
}

/**
 * Route a conversation message to a device for memory-augmented processing.
 *
 * Encrypts the conversation payload using the existing relay encryption,
 * inserts it into relay_commands with type='conversation', and waits
 * for the device to process and return a result.
 */
export async function relayConversationToDevice(params: {
  userId: string;
  device: RelayDevice;
  payload: ConversationRelayPayload;
  timeoutSec?: number;
}): Promise<ConversationRelayResult> {
  const { userId, device, payload, timeoutSec = DEFAULT_DEVICE_TIMEOUT_SEC } = params;

  if (!isSupabaseConfigured()) {
    return { success: false, error: "Supabase not configured" };
  }

  const supabase = getSupabase();
  const commandId = randomUUID();

  // Import encryption from relay-handler (reuse existing AES-256-GCM)
  const { createCipheriv, createHash, randomBytes } = await import("node:crypto");
  const key = getRelayEncryptionKey();
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);

  const plaintext = JSON.stringify(payload);
  let encrypted = cipher.update(plaintext, "utf8", "base64");
  encrypted += cipher.final("base64");
  const authTag = cipher.getAuthTag().toString("base64");

  // Insert conversation relay entry
  const { error: insertError } = await supabase.from("relay_commands").insert({
    id: commandId,
    user_id: userId,
    target_device_id: device.id,
    encrypted_command: encrypted,
    iv: iv.toString("base64"),
    auth_tag: authTag,
    status: "pending",
    priority: 5, // Higher priority than regular commands
    credits_charged: 0, // Conversations don't cost relay credits
    command_type: "conversation",
    command_preview: `[대화] ${payload.message.slice(0, 100)}`,
    execution_log: [],
    expires_at: new Date(Date.now() + timeoutSec * 1000).toISOString(),
  });

  if (insertError) {
    return { success: false, error: `Failed to relay: ${insertError.message}` };
  }

  // Wait for device response with polling
  const startTime = Date.now();
  const deadlineMs = timeoutSec * 1000;

  while (Date.now() - startTime < deadlineMs) {
    await sleep(DEVICE_POLL_INTERVAL_MS);

    const { data: cmd } = await supabase
      .from("relay_commands")
      .select("status, encrypted_result, result_iv, result_auth_tag")
      .eq("id", commandId)
      .single();

    if (!cmd) continue;

    if (cmd.status === "completed" || cmd.status === "failed") {
      if (cmd.encrypted_result && cmd.result_iv && cmd.result_auth_tag) {
        try {
          const result = decryptRelayPayload<ConversationRelayResult>(
            cmd.encrypted_result,
            cmd.result_iv,
            cmd.result_auth_tag,
          );
          if (result) return result;
        } catch {
          return { success: false, error: "Failed to decrypt device response" };
        }
      }
      return {
        success: cmd.status === "completed",
        error: cmd.status === "failed" ? "Device reported failure" : undefined,
      };
    }
  }

  // Timeout — mark as expired
  await supabase
    .from("relay_commands")
    .update({ status: "expired" })
    .eq("id", commandId)
    .eq("status", "pending");

  return { success: false, error: "Device response timeout" };
}

/**
 * Main entry point: Route conversation through the 3-tier strategy.
 *
 * Tier 1: Check semantic cache (Upstash) for similar past response
 * Tier 2: Relay to best online device for memory-augmented response
 * Tier 3: Queue for offline device + return limited fallback
 */
export async function routeConversation(params: {
  userId: string;
  message: string;
  sourceChannel: string;
  sourceUserId: string;
  sessionId?: string;
  category?: string;
  /** Optional: pre-fetched semantic cache result */
  cachedResponse?: string | null;
  /** Optional: skip device relay (for testing) */
  skipDeviceRelay?: boolean;
}): Promise<ResponseStrategy> {
  const startTime = Date.now();
  const {
    userId,
    message,
    sourceChannel,
    sourceUserId,
    sessionId,
    category,
    cachedResponse,
    skipDeviceRelay,
  } = params;

  // ── Tier 1: Semantic Cache ──
  if (cachedResponse) {
    return {
      tier: "cache",
      response: cachedResponse,
      hasMemoryContext: false, // Cache doesn't guarantee memory was used
      processingTimeMs: Date.now() - startTime,
    };
  }

  // ── Tier 2: Device Relay ──
  if (!skipDeviceRelay && isSupabaseConfigured()) {
    const devices = await listUserDevices(userId);
    const bestDevice = selectBestDevice(devices);

    if (bestDevice) {
      const payload: ConversationRelayPayload = {
        type: "conversation",
        message,
        sourceChannel,
        sourceUserId,
        sessionId,
        category,
        timeoutSec: DEFAULT_DEVICE_TIMEOUT_SEC,
      };

      const result = await relayConversationToDevice({
        userId,
        device: bestDevice,
        payload,
      });

      if (result.success && result.response) {
        return {
          tier: "device",
          response: result.response,
          hasMemoryContext: true,
          deviceName: bestDevice.deviceName,
          processingTimeMs: Date.now() - startTime,
        };
      }
    }

    // All devices offline or timed out — queue message for later
    await enqueueOfflineMessage({
      userId,
      message,
      sourceChannel,
      sourceUserId,
      sessionId,
      category,
    });
  }

  // ── Tier 3: Fallback (no memory) ──
  return {
    tier: "fallback",
    response: "", // Caller should generate a basic AI response without memory
    hasMemoryContext: false,
    processingTimeMs: Date.now() - startTime,
  };
}

/**
 * Queue a message for processing when a device comes back online.
 * The device will pick this up on its next heartbeat/poll cycle.
 */
async function enqueueOfflineMessage(params: {
  userId: string;
  message: string;
  sourceChannel: string;
  sourceUserId: string;
  sessionId?: string;
  category?: string;
}): Promise<void> {
  if (!isSupabaseConfigured()) return;

  const supabase = getSupabase();
  const now = new Date();
  const expiresAt = new Date(now.getTime() + 24 * 60 * 60 * 1000); // 24 hours

  await supabase.from("offline_message_queue").insert({
    id: randomUUID(),
    user_id: params.userId,
    message: params.message,
    source_channel: params.sourceChannel,
    source_user_id: params.sourceUserId,
    session_id: params.sessionId ?? null,
    category: params.category ?? null,
    priority: 0,
    status: "queued",
    queued_at: now.toISOString(),
    expires_at: expiresAt.toISOString(),
  });
}

// ── Helpers (reuse relay-handler encryption without circular import) ──

function getRelayEncryptionKey(): Buffer {
  const { createHash } = require("node:crypto");
  const key =
    process.env.LAWCALL_ENCRYPTION_KEY ??
    process.env.MOA_ENCRYPTION_KEY ??
    process.env.SUPABASE_SERVICE_KEY;
  if (!key) {
    throw new Error("[relay] No encryption key configured");
  }
  return createHash("sha256").update(key).digest();
}

function decryptRelayPayload<T>(encrypted: string, iv: string, authTag: string): T | null {
  try {
    const { createDecipheriv } = require("node:crypto");
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

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
