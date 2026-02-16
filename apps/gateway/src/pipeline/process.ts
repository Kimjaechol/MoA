/**
 * Message Processing Pipeline
 *
 * Flow: Incoming Message → Validate → Rate Limit → Allowlist → Mask → OpenClaw Agent / MoA API → Deliver
 *
 * When the OpenClaw gateway is configured and available, messages are first
 * routed through the OpenClaw agent for enhanced AI processing (tools, skills,
 * memory, browser automation). Falls back to the MoA Web API for direct LLM calls.
 */

import { randomUUID } from "node:crypto";
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

  // 5. Try OpenClaw Agent first (if configured), then fall back to MoA API
  const userId = `gateway_${msg.channel}_${msg.senderId}`;
  const sessionId = `gw_${msg.channel}_${msg.senderId}`;

  try {
    let result: ProcessedResult | null = null;

    // 5a. Try OpenClaw Agent for enhanced AI (tools, skills, memory)
    if (config.openclawGatewayUrl) {
      try {
        result = await callOpenClawAgent(config, {
          message: validation.sanitizedText,
          userId,
          sessionKey: `moa:${msg.channel}:${msg.senderId}`,
          channel: msg.channel,
        });
        if (result) {
          logger.info("OpenClaw agent responded", {
            ...logCtx,
            model: result.model,
          });
        }
      } catch (agentErr) {
        const agentMsg = agentErr instanceof Error ? agentErr.message : String(agentErr);
        logger.warn("OpenClaw agent failed, falling back to MoA API", {
          ...logCtx,
          error: agentMsg,
        });
      }
    }

    // 5b. Fall back to MoA API for direct LLM calls
    if (!result) {
      result = await callMoaApi(config, {
        user_id: userId,
        session_id: sessionId,
        content: validation.sanitizedText,
        channel: msg.channel,
        content_for_storage: sensitiveResult.detected ? sensitiveResult.maskedText : undefined,
      });
    }

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
 * Call the OpenClaw gateway agent via HTTP health check + WebSocket RPC.
 * Returns null if the agent is unavailable, allowing fallback to MoA API.
 */
async function callOpenClawAgent(
  config: GatewayConfig,
  params: {
    message: string;
    userId: string;
    sessionKey: string;
    channel: string;
  },
): Promise<ProcessedResult | null> {
  const gatewayUrl = config.openclawGatewayUrl;
  if (!gatewayUrl) return null;

  // Health check (HTTP, fast)
  const httpUrl = gatewayUrl.replace(/^ws:/, "http:").replace(/^wss:/, "https:");
  const healthRes = await fetch(`${httpUrl}/health`, {
    signal: AbortSignal.timeout(5_000),
  });
  if (!healthRes.ok) return null;

  // Use dynamic import for WebSocket
  const { default: WebSocket } = await import("ws");

  return new Promise<ProcessedResult | null>((resolve) => {
    const ws = new WebSocket(gatewayUrl, { handshakeTimeout: 10_000 });
    const connectId = randomUUID();
    const sendId = randomUUID();
    const idempotencyKey = randomUUID();

    let responseText = "";
    let modelUsed = "";
    let connected = false;

    const timer = setTimeout(() => {
      try { ws.close(); } catch { /* ignore */ }
      resolve(null);
    }, config.openclawTimeoutMs);

    function cleanup() {
      clearTimeout(timer);
      try { ws.close(); } catch { /* ignore */ }
    }

    ws.on("error", () => { cleanup(); resolve(null); });
    ws.on("close", () => {
      clearTimeout(timer);
      if (responseText) {
        resolve({
          reply: responseText,
          model: modelUsed || "openclaw/agent",
          category: "other",
          creditsUsed: 0,
          keySource: "user",
          timestamp: new Date().toISOString(),
        });
      } else {
        resolve(null);
      }
    });

    ws.on("open", () => {
      ws.send(JSON.stringify({
        type: "req", id: connectId, method: "connect",
        params: {
          minProtocol: 1, maxProtocol: 1,
          client: {
            id: `moa-gw-${params.channel}`,
            displayName: `MoA Gateway (${params.channel})`,
            version: "1.0.0", platform: "server", mode: "backend",
            instanceId: randomUUID(),
          },
          auth: config.openclawGatewayToken ? { token: config.openclawGatewayToken } : {},
          scopes: ["operator.admin"],
        },
      }));
    });

    ws.on("message", (raw: Buffer) => {
      let frame: { type: string; id?: string; ok?: boolean; payload?: Record<string, unknown>; error?: { message: string }; event?: string };
      try { frame = JSON.parse(raw.toString()); } catch { return; }

      if (frame.type === "res") {
        if (frame.id === connectId) {
          if (frame.ok) {
            connected = true;
            ws.send(JSON.stringify({
              type: "req", id: sendId, method: "chat.send",
              params: {
                sessionKey: params.sessionKey,
                message: params.message,
                idempotencyKey,
                timeoutMs: config.openclawTimeoutMs,
              },
            }));
          } else {
            cleanup(); resolve(null);
          }
        } else if (frame.id === sendId && !frame.ok) {
          cleanup(); resolve(null);
        }
      }

      if (frame.type === "event" && frame.event === "chat" && frame.payload) {
        const payload = frame.payload;
        const state = payload.state as string;

        // Accumulate streaming text
        if (payload.delta) {
          const delta = payload.delta as { type: string; text?: string };
          if (delta.type === "text" && delta.text) responseText += delta.text;
        }

        if (state === "final") {
          const msg = payload.message as { content?: Array<{ type: string; text?: string }>; model?: string } | undefined;
          if (msg?.content) {
            const text = msg.content.filter((c) => c.type === "text" && c.text).map((c) => c.text).join("\n");
            if (text) responseText = text;
          }
          if (msg?.model) modelUsed = msg.model;

          cleanup();
          resolve({
            reply: responseText,
            model: modelUsed || "openclaw/agent",
            category: "other",
            creditsUsed: 0,
            keySource: "user",
            timestamp: new Date().toISOString(),
          });
        }

        if (state === "error") {
          cleanup();
          resolve(responseText ? {
            reply: responseText,
            model: modelUsed || "openclaw/agent",
            category: "other",
            creditsUsed: 0,
            keySource: "user",
            timestamp: new Date().toISOString(),
          } : null);
        }
      }
    });
  });
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
