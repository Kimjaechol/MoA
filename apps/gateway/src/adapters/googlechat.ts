/**
 * Google Chat Adapter
 *
 * Receives messages via Google Chat Bot webhook.
 * Uses Google Chat API for sending responses.
 *
 * Setup:
 *   1. Create a Google Cloud project
 *   2. Enable Google Chat API
 *   3. Configure the Chat bot at chat.google.com/botmanagement
 *   4. Set Bot URL to: https://your-gateway/webhook/googlechat
 *   5. Set GOOGLE_CHAT_SERVICE_ACCOUNT_JSON (for sending messages)
 */

import type { GatewayConfig } from "../config.js";
import type { ChannelPlugin, WebhookResult, DeliveryParams } from "../plugins/types.js";
import type { IncomingMessage } from "../pipeline/types.js";
import { logger } from "../logger.js";

interface GoogleChatEvent {
  type: string;
  eventTime: string;
  message: {
    name: string;
    sender: { name: string; displayName?: string; type: string };
    text?: string;
    thread?: { name: string };
    space: { name: string; type: string };
    createTime: string;
  };
}

export class GoogleChatAdapter implements ChannelPlugin {
  readonly channel = "googlechat" as const;
  readonly displayName = "Google Chat";

  private serviceAccountJson: Record<string, string> | null = null;
  private cachedToken: { token: string; expiresAt: number } | null = null;

  isConfigured(config: GatewayConfig): boolean {
    return !!config.googleChatServiceAccountJson;
  }

  async initialize(config: GatewayConfig): Promise<void> {
    try {
      this.serviceAccountJson = JSON.parse(config.googleChatServiceAccountJson!);
    } catch {
      throw new Error("Invalid GOOGLE_CHAT_SERVICE_ACCOUNT_JSON format");
    }

    logger.info("Google Chat adapter initialized");
  }

  async handleWebhook(
    _path: string,
    _method: string,
    _headers: Record<string, string>,
    body: string,
  ): Promise<WebhookResult> {
    try {
      const event = JSON.parse(body) as GoogleChatEvent;

      // Only handle MESSAGE events with text
      if (event.type !== "MESSAGE" || !event.message?.text?.trim()) {
        // For ADDED_TO_SPACE, respond with welcome
        if (event.type === "ADDED_TO_SPACE") {
          return {
            messages: [],
            statusCode: 200,
            responseBody: { text: "안녕하세요! MoA AI입니다. 무엇이든 물어보세요." },
          };
        }
        return { messages: [], statusCode: 200 };
      }

      // Skip bot messages
      if (event.message.sender.type === "BOT") {
        return { messages: [], statusCode: 200 };
      }

      const msg: IncomingMessage = {
        channel: "googlechat",
        senderId: event.message.sender.name,
        senderName: event.message.sender.displayName,
        text: event.message.text.trim(),
        messageId: event.message.name,
        groupId: event.message.space.name,
        timestamp: event.message.createTime,
        deliveryMeta: {
          spaceName: event.message.space.name,
          threadName: event.message.thread?.name,
        },
      };

      return { messages: [msg], statusCode: 200 };
    } catch (err) {
      logger.error("Google Chat webhook parse error", {
        error: err instanceof Error ? err.message : String(err),
      });
      return { messages: [], statusCode: 400 };
    }
  }

  async deliver(params: DeliveryParams): Promise<boolean> {
    try {
      const spaceName = (params.metadata?.spaceName as string) ?? params.threadId ?? params.recipientId;
      const token = await this.getAuthToken();

      const url = `https://chat.googleapis.com/v1/${spaceName}/messages`;
      const body: Record<string, unknown> = { text: params.text };

      if (params.metadata?.threadName) {
        body.thread = { name: params.metadata.threadName };
      }

      const res = await fetch(url, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        const text = await res.text();
        logger.error("Google Chat send failed", { status: res.status, body: text });
        return false;
      }

      return true;
    } catch (err) {
      logger.error("Google Chat delivery error", {
        error: err instanceof Error ? err.message : String(err),
      });
      return false;
    }
  }

  async shutdown(): Promise<void> {
    this.cachedToken = null;
  }

  /** Get Google OAuth2 access token using service account JWT */
  private async getAuthToken(): Promise<string> {
    if (this.cachedToken && Date.now() < this.cachedToken.expiresAt - 60_000) {
      return this.cachedToken.token;
    }

    if (!this.serviceAccountJson) {
      throw new Error("Service account not configured");
    }

    const { createPrivateKey, createSign } = await import("node:crypto");

    const now = Math.floor(Date.now() / 1000);
    const header = Buffer.from(JSON.stringify({ alg: "RS256", typ: "JWT" })).toString("base64url");
    const payload = Buffer.from(JSON.stringify({
      iss: this.serviceAccountJson.client_email,
      scope: "https://www.googleapis.com/auth/chat.bot",
      aud: "https://oauth2.googleapis.com/token",
      iat: now,
      exp: now + 3600,
    })).toString("base64url");

    const signable = `${header}.${payload}`;
    const key = createPrivateKey(this.serviceAccountJson.private_key);
    const signature = createSign("SHA256").update(signable).sign(key, "base64url");
    const jwt = `${signable}.${signature}`;

    const res = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
        assertion: jwt,
      }),
    });

    if (!res.ok) {
      throw new Error(`Google auth failed: ${res.status}`);
    }

    const data = (await res.json()) as { access_token: string; expires_in: number };
    this.cachedToken = {
      token: data.access_token,
      expiresAt: Date.now() + data.expires_in * 1000,
    };

    return data.access_token;
  }
}
