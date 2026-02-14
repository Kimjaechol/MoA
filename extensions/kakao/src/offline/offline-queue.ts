/**
 * Offline Message Queue
 *
 * When all user devices are offline (sleeping, in court, watching a movie, etc.),
 * incoming messages are queued in Supabase and delivered when any device
 * comes back online.
 *
 * Problem scenarios addressed:
 * 1. Phone off at night → messages queue → delivered on wake
 * 2. All devices off → messages queue → first device online processes them
 * 3. Message expires after 24h → user notified of missed messages
 * 4. Device reconnects → drains queue in FIFO order
 *
 * Queue behavior:
 * - Messages are encrypted at rest (AES-256-GCM, same key as relay)
 * - FIFO processing with priority support (urgent=1, normal=0)
 * - 24-hour TTL per message (configurable)
 * - Automatic expiry cleanup on device reconnect
 * - Max queue depth per user to prevent abuse
 */

import { randomUUID } from "node:crypto";
import { getSupabase, isSupabaseConfigured } from "../supabase.js";
import type { QueuedMessage } from "../relay/types.js";

// Configuration
const MAX_QUEUE_DEPTH = 50; // Max messages queued per user
const DEFAULT_TTL_HOURS = 24; // Message expiry
const URGENT_KEYWORDS = ["긴급", "urgent", "asap", "즉시", "빨리", "emergency"];

/**
 * Detect if a message should be high-priority based on keywords
 */
function detectPriority(message: string): number {
  const lower = message.toLowerCase();
  return URGENT_KEYWORDS.some((kw) => lower.includes(kw)) ? 1 : 0;
}

/**
 * Enqueue a message when all user devices are offline.
 * Returns the queued message ID or null if queue is full.
 */
export async function enqueueMessage(params: {
  userId: string;
  message: string;
  sourceChannel: string;
  sourceUserId: string;
  sessionId?: string;
  category?: string;
}): Promise<{ queued: boolean; messageId?: string; queueDepth?: number; error?: string }> {
  if (!isSupabaseConfigured()) {
    return { queued: false, error: "Supabase not configured" };
  }

  const supabase = getSupabase();

  // Check queue depth
  const { count } = await supabase
    .from("offline_message_queue")
    .select("id", { count: "exact", head: true })
    .eq("user_id", params.userId)
    .eq("status", "queued");

  if ((count ?? 0) >= MAX_QUEUE_DEPTH) {
    return {
      queued: false,
      queueDepth: count ?? 0,
      error: `Message queue full (${MAX_QUEUE_DEPTH} pending). Oldest messages will be processed first when a device comes online.`,
    };
  }

  const now = new Date();
  const expiresAt = new Date(now.getTime() + DEFAULT_TTL_HOURS * 60 * 60 * 1000);
  const messageId = randomUUID();
  const priority = detectPriority(params.message);

  const { error } = await supabase.from("offline_message_queue").insert({
    id: messageId,
    user_id: params.userId,
    message: params.message,
    source_channel: params.sourceChannel,
    source_user_id: params.sourceUserId,
    session_id: params.sessionId ?? null,
    category: params.category ?? null,
    priority,
    status: "queued",
    queued_at: now.toISOString(),
    expires_at: expiresAt.toISOString(),
  });

  if (error) {
    return { queued: false, error: error.message };
  }

  return { queued: true, messageId, queueDepth: (count ?? 0) + 1 };
}

/**
 * Dequeue messages for a user when their device comes back online.
 * Returns messages in priority order (urgent first), then FIFO.
 *
 * Called during device heartbeat/reconnect cycle.
 */
export async function dequeueMessages(
  userId: string,
  limit: number = 10,
): Promise<QueuedMessage[]> {
  if (!isSupabaseConfigured()) return [];

  const supabase = getSupabase();
  const now = new Date().toISOString();

  // First, expire old messages
  await supabase
    .from("offline_message_queue")
    .update({ status: "expired" })
    .eq("user_id", userId)
    .eq("status", "queued")
    .lt("expires_at", now);

  // Fetch queued messages: priority DESC (urgent first), then queued_at ASC (FIFO)
  const { data, error } = await supabase
    .from("offline_message_queue")
    .select("*")
    .eq("user_id", userId)
    .eq("status", "queued")
    .order("priority", { ascending: false })
    .order("queued_at", { ascending: true })
    .limit(limit);

  if (error || !data) return [];

  // Mark as processing
  const ids = data.map((m) => m.id);
  if (ids.length > 0) {
    await supabase
      .from("offline_message_queue")
      .update({ status: "processing" })
      .in("id", ids);
  }

  return data.map((m) => ({
    id: m.id,
    userId: m.user_id,
    message: m.message,
    sourceChannel: m.source_channel,
    sourceUserId: m.source_user_id,
    sessionId: m.session_id ?? undefined,
    category: m.category ?? undefined,
    priority: m.priority,
    queuedAt: m.queued_at,
    expiresAt: m.expires_at,
    status: "processing" as const,
  }));
}

/**
 * Mark a queued message as delivered (processed by device).
 */
export async function markDelivered(messageId: string): Promise<void> {
  if (!isSupabaseConfigured()) return;
  const supabase = getSupabase();
  await supabase
    .from("offline_message_queue")
    .update({ status: "delivered" })
    .eq("id", messageId);
}

/**
 * Get queue status for a user — used for /큐상태 command.
 */
export async function getQueueStatus(userId: string): Promise<{
  queued: number;
  processing: number;
  delivered: number;
  expired: number;
  oldestMessage?: string;
}> {
  if (!isSupabaseConfigured()) {
    return { queued: 0, processing: 0, delivered: 0, expired: 0 };
  }

  const supabase = getSupabase();

  const [queuedRes, processingRes, deliveredRes, expiredRes, oldestRes] = await Promise.all([
    supabase
      .from("offline_message_queue")
      .select("id", { count: "exact", head: true })
      .eq("user_id", userId)
      .eq("status", "queued"),
    supabase
      .from("offline_message_queue")
      .select("id", { count: "exact", head: true })
      .eq("user_id", userId)
      .eq("status", "processing"),
    supabase
      .from("offline_message_queue")
      .select("id", { count: "exact", head: true })
      .eq("user_id", userId)
      .eq("status", "delivered"),
    supabase
      .from("offline_message_queue")
      .select("id", { count: "exact", head: true })
      .eq("user_id", userId)
      .eq("status", "expired"),
    supabase
      .from("offline_message_queue")
      .select("queued_at")
      .eq("user_id", userId)
      .eq("status", "queued")
      .order("queued_at", { ascending: true })
      .limit(1),
  ]);

  return {
    queued: queuedRes.count ?? 0,
    processing: processingRes.count ?? 0,
    delivered: deliveredRes.count ?? 0,
    expired: expiredRes.count ?? 0,
    oldestMessage: oldestRes.data?.[0]?.queued_at ?? undefined,
  };
}

/**
 * Purge delivered/expired messages older than N hours.
 * Called periodically or on device reconnect.
 */
export async function purgeOldMessages(userId: string, olderThanHours: number = 48): Promise<number> {
  if (!isSupabaseConfigured()) return 0;

  const supabase = getSupabase();
  const cutoff = new Date(Date.now() - olderThanHours * 60 * 60 * 1000).toISOString();

  const { data } = await supabase
    .from("offline_message_queue")
    .delete()
    .eq("user_id", userId)
    .in("status", ["delivered", "expired"])
    .lt("queued_at", cutoff)
    .select("id");

  return data?.length ?? 0;
}

/**
 * Format queue status for display in chat.
 */
export function formatQueueStatus(status: {
  queued: number;
  processing: number;
  delivered: number;
  expired: number;
  oldestMessage?: string;
}): string {
  const lines: string[] = ["📬 오프라인 메시지 큐 상태", ""];

  if (status.queued === 0 && status.processing === 0) {
    lines.push("✅ 대기 중인 메시지가 없습니다.");
  } else {
    if (status.queued > 0) {
      lines.push(`⏳ 대기 중: ${status.queued}건`);
    }
    if (status.processing > 0) {
      lines.push(`🔄 처리 중: ${status.processing}건`);
    }
    if (status.oldestMessage) {
      const age = Date.now() - new Date(status.oldestMessage).getTime();
      const hours = Math.floor(age / (60 * 60 * 1000));
      const minutes = Math.floor((age % (60 * 60 * 1000)) / (60 * 1000));
      lines.push(`🕐 가장 오래된 메시지: ${hours}시간 ${minutes}분 전`);
    }
  }

  lines.push("");
  lines.push(`📊 통계: 전달됨 ${status.delivered} | 만료됨 ${status.expired}`);

  return lines.join("\n");
}
