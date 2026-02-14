/**
 * Smart Degradation — Graceful response when devices are offline
 *
 * Addresses the reality that phones aren't always on:
 * - Sleeping at night
 * - In court hearings
 * - Watching movies
 * - Phone turned off or in airplane mode
 * - Network issues
 *
 * Strategy:
 * 1. First check semantic cache (Upstash) — 5ms, $0 cost
 * 2. If cache miss, try to relay to any online device — 2-10s
 * 3. If all devices offline, provide a graceful fallback:
 *    a. Acknowledge the message
 *    b. Queue it for device processing
 *    c. Notify user when the response is ready
 *    d. Optionally provide a limited AI response without memory
 */

import { routeConversation, selectBestDevice } from "../relay/conversation-relay.js";
import { listUserDevices } from "../relay/device-auth.js";
import { isSupabaseConfigured } from "../supabase.js";
import { enqueueMessage, getQueueStatus } from "./offline-queue.js";
import type { ResponseStrategy } from "../relay/types.js";

/** Offline notification templates */
const OFFLINE_MESSAGES = {
  allOffline: (queuePosition: number) =>
    `모든 기기가 오프라인 상태입니다. 메시지가 대기열에 추가되었습니다 (${queuePosition}번째).\n기기가 온라인되면 자동으로 처리됩니다.`,

  partialResponse: (fallbackResponse: string) =>
    `⚡ 기기 접속 전 임시 응답:\n${fallbackResponse}\n\n💡 기기가 온라인되면 기억 기반의 정확한 답변을 보내드리겠습니다.`,

  queueFull:
    "메시지 대기열이 가득 찼습니다. 기기가 온라인 상태가 되면 새 메시지를 보내주세요.",

  deviceTimeout: (deviceName: string) =>
    `"${deviceName}" 기기가 응답하지 않습니다. 다른 기기를 확인 중...`,
} as const;

/**
 * Full conversation handling with smart degradation.
 *
 * This is the main entry point that webhooks should call.
 * It orchestrates the entire 3-tier response flow.
 */
export async function handleConversationWithDegradation(params: {
  userId: string;
  message: string;
  sourceChannel: string;
  sourceUserId: string;
  sessionId?: string;
  category?: string;
  /** Pre-fetched semantic cache result (from webhook) */
  cachedResponse?: string | null;
  /** Function to generate a basic AI response without memory context */
  generateFallbackResponse?: (message: string) => Promise<string>;
}): Promise<ResponseStrategy> {
  const {
    userId,
    message,
    sourceChannel,
    sourceUserId,
    sessionId,
    category,
    cachedResponse,
    generateFallbackResponse,
  } = params;

  const startTime = Date.now();

  // ── Tier 1: Semantic Cache ──
  if (cachedResponse) {
    return {
      tier: "cache",
      response: cachedResponse,
      hasMemoryContext: false,
      processingTimeMs: Date.now() - startTime,
    };
  }

  // ── Tier 2: Device Relay ──
  if (isSupabaseConfigured()) {
    const result = await routeConversation({
      userId,
      message,
      sourceChannel,
      sourceUserId,
      sessionId,
      category,
    });

    if (result.tier === "device" && result.response) {
      return result;
    }

    // Device relay failed — we're now in fallback territory
  }

  // ── Tier 3: Smart Fallback ──
  // Queue the message for when a device comes online
  const queueResult = await enqueueMessage({
    userId,
    message,
    sourceChannel,
    sourceUserId,
    sessionId,
    category,
  });

  // Generate a limited response without memory
  if (generateFallbackResponse) {
    try {
      const fallbackResponse = await generateFallbackResponse(message);

      // Compose a response that combines the fallback + notification
      const response = OFFLINE_MESSAGES.partialResponse(fallbackResponse);

      return {
        tier: "fallback",
        response,
        hasMemoryContext: false,
        processingTimeMs: Date.now() - startTime,
      };
    } catch {
      // Even fallback generation failed — just queue notification
    }
  }

  // Last resort: just acknowledge and queue
  const response = queueResult.queued
    ? OFFLINE_MESSAGES.allOffline(queueResult.queueDepth ?? 1)
    : OFFLINE_MESSAGES.queueFull;

  return {
    tier: "fallback",
    response,
    hasMemoryContext: false,
    processingTimeMs: Date.now() - startTime,
  };
}

/**
 * Check if a user has any online devices.
 * Used by webhooks to decide whether to attempt device relay.
 */
export async function hasOnlineDevices(userId: string): Promise<boolean> {
  if (!isSupabaseConfigured()) return false;

  const devices = await listUserDevices(userId);
  return selectBestDevice(devices) !== null;
}

/**
 * Process queued messages when a device comes back online.
 * Called during device reconnect/heartbeat.
 *
 * Returns the number of messages processed.
 */
export async function processQueuedMessages(params: {
  userId: string;
  processMessage: (message: string, channel: string, sessionId?: string) => Promise<string>;
  sendResponse: (channel: string, userId: string, response: string) => Promise<void>;
}): Promise<number> {
  const { dequeueMessages, markDelivered } = await import("./offline-queue.js");

  const messages = await dequeueMessages(params.userId);
  let processed = 0;

  for (const msg of messages) {
    try {
      // Process with device's local memory
      const response = await params.processMessage(msg.message, msg.sourceChannel, msg.sessionId);

      // Send response back through the original channel
      await params.sendResponse(msg.sourceChannel, msg.sourceUserId, response);

      // Mark as delivered
      await markDelivered(msg.id);
      processed++;
    } catch (err) {
      console.error(`[offline-queue] Failed to process message ${msg.id}:`, err);
      // Leave as 'processing' — will retry on next cycle
    }
  }

  return processed;
}

/**
 * Format a notification about queued messages for the user.
 */
export function formatOfflineNotification(queuedCount: number, deviceName: string): string {
  if (queuedCount === 0) return "";

  return [
    `📱 "${deviceName}" 기기가 다시 온라인입니다.`,
    `📬 오프라인 동안 ${queuedCount}건의 메시지가 도착했습니다.`,
    "🔄 순서대로 처리 중...",
  ].join("\n");
}
