/**
 * Zalo Adapter
 *
 * Receives messages via Zalo Official Account (OA) webhook.
 * Uses Zalo OA API for sending responses.
 *
 * Setup:
 *   1. Create Zalo OA at oa.zalo.me
 *   2. Register app at developers.zalo.me
 *   3. Set Webhook URL: https://your-gateway/webhook/zalo
 *   4. Set ZALO_OA_ACCESS_TOKEN and ZALO_OA_SECRET_KEY
 */

import type { GatewayConfig } from "../config.js";
import type { ChannelPlugin, WebhookResult, DeliveryParams } from "../plugins/types.js";
import type { IncomingMessage } from "../pipeline/types.js";
import { verifyHmacSha256 } from "../security/auth.js";
import { logger } from "../logger.js";

interface ZaloWebhookEvent {
  app_id: string;
  sender: { id: string };
  recipient: { id: string };
  event_name: string;
  message?: {
    msg_id: string;
    text?: string;
  };
  timestamp: string;
}

export class ZaloAdapter implements ChannelPlugin {
  readonly channel = "zalo" as const;
  readonly displayName = "Zalo";

  private accessToken = "";
  private secretKey = "";

  isConfigured(config: GatewayConfig): boolean {
    return !!(config.zaloOaAccessToken && config.zaloOaSecretKey);
  }

  async initialize(config: GatewayConfig): Promise<void> {
    this.accessToken = config.zaloOaAccessToken!;
    this.secretKey = config.zaloOaSecretKey!;
    logger.info("Zalo adapter initialized");
  }

  async handleWebhook(
    _path: string,
    _method: string,
    headers: Record<string, string>,
    body: string,
  ): Promise<WebhookResult> {
    try {
      // Verify Zalo webhook signature
      const signature = headers["x-zevent-signature"] ?? "";
      if (this.secretKey && signature) {
        if (!verifyHmacSha256(body, signature, this.secretKey, "mac=")) {
          logger.warn("Zalo invalid signature");
          return { messages: [], statusCode: 401 };
        }
      }

      const event = JSON.parse(body) as ZaloWebhookEvent;

      // Only handle user_send_text events
      if (event.event_name !== "user_send_text" || !event.message?.text?.trim()) {
        return { messages: [], statusCode: 200 };
      }

      const msg: IncomingMessage = {
        channel: "zalo",
        senderId: event.sender.id,
        text: event.message.text.trim(),
        messageId: event.message.msg_id,
        timestamp: event.timestamp,
      };

      return { messages: [msg], statusCode: 200 };
    } catch (err) {
      logger.error("Zalo webhook parse error", {
        error: err instanceof Error ? err.message : String(err),
      });
      return { messages: [], statusCode: 400 };
    }
  }

  async deliver(params: DeliveryParams): Promise<boolean> {
    try {
      const res = await fetch("https://openapi.zalo.me/v3.0/oa/message/cs", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          access_token: this.accessToken,
        },
        body: JSON.stringify({
          recipient: { user_id: params.recipientId },
          message: { text: params.text },
        }),
      });

      if (!res.ok) {
        const text = await res.text();
        logger.error("Zalo send failed", { status: res.status, body: text });
        return false;
      }

      const data = (await res.json()) as { error: number; message?: string };
      if (data.error !== 0) {
        logger.error("Zalo API error", { error: data.error, message: data.message });
        return false;
      }

      return true;
    } catch (err) {
      logger.error("Zalo delivery error", {
        error: err instanceof Error ? err.message : String(err),
      });
      return false;
    }
  }

  async shutdown(): Promise<void> {
    // No persistent connections
  }
}
