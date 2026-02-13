/**
 * Message Processing Pipeline
 *
 * Flow: Incoming Message → Validate → Rate Limit → Allowlist → Mask → AI → Deliver
 *
 * The gateway calls the MoA Web API for AI processing,
 * keeping the AI engine centralized (single source of truth for credits, models, etc.)
 */

import type { GatewayConfig } from "../config.js";
import type { IncomingMessage, ProcessedResult } from "./types.js";
import type { RateLimiter } from "../security/rate-limiter.js";
import type { Allowlist } from "../security/allowlist.js";
import { validateInput, detectAndMaskSensitiveData } from "./normalize.js";
import { signRequest, logSecurityEvent } from "../security/auth.js";
import { registry } from "../plugins/registry.js";
import { logger } from "../logger.js";
import type { GatewayChannel } from "../plugins/types.js";

interface PipelineDeps {
  config: GatewayConfig;
  rateLimiter: RateLimiter;
  allowlist: Allowlist;
}

/**
 * Process a single incoming message through the full pipeline.
 */
export async function processMessage(
  msg: IncomingMessage,
  deps: PipelineDeps,
): Promise<void> {
  const { config, rateLimiter, allowlist } = deps;

  const logCtx = {
    channel: msg.channel,
    senderId: msg.senderId.slice(0, 8) + "...",
    groupId: msg.groupId,
  };

  logger.debug("Processing message", logCtx);

  // 1. Allowlist check
  if (!allowlist.isAllowed(msg.channel, msg.senderId, msg.groupId)) {
    logger.info("Message blocked by allowlist", logCtx);
    return; // silently drop
  }

  // 2. Rate limit check
  const rateResult = rateLimiter.check(msg.channel, msg.senderId);
  if (!rateResult.allowed) {
    logger.info("Message rate-limited", { ...logCtx, strikes: rateResult.strikes });
    logSecurityEvent("rate_limit_hit", msg.channel, msg.senderId, {
      strikes: rateResult.strikes,
      banned: rateResult.banned,
    });

    // Deliver rate limit message back to user
    await deliverResponse(msg, rateResult.reason ?? "잠시 후 다시 시도해주세요.");
    return;
  }

  // 3. Input validation
  const validation = validateInput(msg.text);
  if (!validation.safe) {
    logger.warn("Suspicious input detected", { ...logCtx, threats: validation.threats });
    logSecurityEvent("suspicious_input", msg.channel, msg.senderId, {
      threats: validation.threats,
    });

    // Only block if it's a clear injection attempt (not just long messages)
    const hasInjection = validation.threats.some(
      (t) => t !== "message_too_long",
    );
    if (hasInjection) {
      await deliverResponse(msg, "입력 내용을 확인해주세요. 보안 정책에 의해 처리할 수 없습니다.");
      return;
    }
  }

  // 4. Sensitive data masking
  const sensitiveResult = detectAndMaskSensitiveData(validation.sanitizedText);
  if (sensitiveResult.detected) {
    logger.info("Sensitive data masked", {
      ...logCtx,
      types: sensitiveResult.types,
    });
  }

  // 5. Call MoA API for AI processing
  try {
    const result = await callMoaApi(config, {
      user_id: `gateway_${msg.channel}_${msg.senderId}`,
      session_id: `gw_${msg.channel}_${msg.senderId}`,
      content: validation.sanitizedText,
      channel: msg.channel,
      content_for_storage: sensitiveResult.detected ? sensitiveResult.maskedText : undefined,
    });

    logger.info("AI response received", {
      ...logCtx,
      model: result.model,
      creditsUsed: result.creditsUsed,
    });

    // 6. Deliver response
    await deliverResponse(msg, result.reply);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error("AI processing failed", { ...logCtx, error: message });

    // Fallback response
    await deliverResponse(
      msg,
      "죄송합니다. 일시적인 오류가 발생했습니다. 잠시 후 다시 시도해주세요.",
    );
  }
}

/**
 * Call the MoA Web API for AI processing.
 */
async function callMoaApi(
  config: GatewayConfig,
  body: {
    user_id: string;
    session_id: string;
    content: string;
    channel: string;
    content_for_storage?: string;
  },
): Promise<ProcessedResult> {
  const url = `${config.moaApiUrl}/api/chat`;
  const payload = JSON.stringify(body);
  const authToken = signRequest(payload, config.moaApiSecret);

  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Gateway-Auth": authToken,
      "X-Gateway-Channel": body.channel,
    },
    body: payload,
    signal: AbortSignal.timeout(60_000), // 60s timeout
  });

  if (!response.ok) {
    throw new Error(`MoA API returned ${response.status}: ${response.statusText}`);
  }

  const data = await response.json() as Record<string, unknown>;

  return {
    reply: (data.reply as string) ?? "응답을 생성할 수 없습니다.",
    model: (data.model as string) ?? "unknown",
    category: (data.category as string) ?? "other",
    creditsUsed: (data.credits_used as number) ?? 0,
    creditsRemaining: data.credits_remaining as number | undefined,
    keySource: (data.key_source as "moa" | "user") ?? "moa",
    timestamp: (data.timestamp as string) ?? new Date().toISOString(),
  };
}

/**
 * Deliver a text response back to the originating channel.
 */
async function deliverResponse(msg: IncomingMessage, text: string): Promise<void> {
  const plugin = registry.get(msg.channel as GatewayChannel);
  if (!plugin) {
    logger.error("No active plugin for delivery", { channel: msg.channel });
    return;
  }

  try {
    await plugin.deliver({
      recipientId: msg.senderId,
      text,
      replyToId: msg.messageId,
      threadId: msg.groupId,
      metadata: msg.deliveryMeta,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error("Delivery failed", { channel: msg.channel, error: message });
  }
}
