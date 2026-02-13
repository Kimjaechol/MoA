/**
 * Async Queue — QStash-based message queue for webhook processing.
 *
 * Optimization 2: Webhook returns immediately (0.1s), LLM work runs in /api/worker.
 *
 * When QStash is not configured, falls back to direct execution via ai-engine
 * (the old behavior but without the internal HTTP hop).
 *
 * Env vars (optional):
 *   QSTASH_TOKEN  — Upstash QStash API token
 *   QSTASH_URL    — QStash publish endpoint (default: https://qstash.upstash.io)
 *   WORKER_SECRET — Shared secret for worker endpoint authentication
 */

export interface QueuedTask {
  /** Channel: telegram, discord, slack, line, whatsapp, kakao */
  channel: string;
  /** Message text (original, not masked) */
  message: string;
  /** Masked text for storage (if sensitive data detected) */
  maskedTextForStorage?: string;
  /** Resolved effective user ID */
  userId: string;
  /** Session ID */
  sessionId: string;
  /** Detected category */
  category: string;
  /** Channel-specific delivery info (chatId, interactionToken, etc.) */
  delivery: Record<string, unknown>;
}

/**
 * Returns true if QStash is configured and available.
 */
export function isQueueAvailable(): boolean {
  return !!process.env.QSTASH_TOKEN;
}

/**
 * Enqueue a task for async processing via QStash → /api/worker.
 * Returns true if enqueued, false if QStash not available.
 */
export async function enqueueTask(task: QueuedTask): Promise<boolean> {
  const qstashToken = process.env.QSTASH_TOKEN;
  if (!qstashToken) return false;

  const baseUrl = process.env.NEXT_PUBLIC_BASE_URL
    ?? (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : null);

  if (!baseUrl) return false;

  const workerUrl = `${baseUrl}/api/worker`;
  const qstashUrl = process.env.QSTASH_URL ?? "https://qstash.upstash.io";

  try {
    const workerSecret = process.env.WORKER_SECRET ?? "";
    const res = await fetch(`${qstashUrl}/v2/publish/${workerUrl}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${qstashToken}`,
        "Content-Type": "application/json",
        "Upstash-Retries": "2",
        "Upstash-Forward-x-worker-secret": workerSecret,
      },
      body: JSON.stringify(task),
    });

    return res.ok;
  } catch {
    return false;
  }
}
