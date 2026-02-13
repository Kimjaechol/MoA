/**
 * Microsoft Teams Adapter
 *
 * Receives messages via Bot Framework webhook.
 * Uses Bot Framework REST API for sending responses.
 *
 * Setup:
 *   1. Register bot at dev.botframework.com or Azure Bot Service
 *   2. Set Messaging Endpoint to: https://your-gateway/webhook/msteams
 *   3. Set TEAMS_APP_ID and TEAMS_APP_PASSWORD
 *   4. Install bot in Teams workspace
 */

import type { GatewayConfig } from "../config.js";
import type { ChannelPlugin, WebhookResult, DeliveryParams } from "../plugins/types.js";
import type { IncomingMessage } from "../pipeline/types.js";
import { logger } from "../logger.js";

interface BotFrameworkActivity {
  type: string;
  id: string;
  text?: string;
  from: { id: string; name?: string };
  conversation: { id: string; conversationType?: string };
  channelId: string;
  serviceUrl: string;
  timestamp: string;
  replyToId?: string;
}

export class MSTeamsAdapter implements ChannelPlugin {
  readonly channel = "msteams" as const;
  readonly displayName = "Microsoft Teams";

  private appId = "";
  private appPassword = "";
  private cachedToken: { token: string; expiresAt: number } | null = null;

  isConfigured(config: GatewayConfig): boolean {
    return !!(config.teamsAppId && config.teamsAppPassword);
  }

  async initialize(config: GatewayConfig): Promise<void> {
    this.appId = config.teamsAppId!;
    this.appPassword = config.teamsAppPassword!;

    // Pre-fetch auth token to verify credentials
    await this.getAuthToken();
    logger.info("MS Teams adapter initialized", { appId: this.appId });
  }

  async handleWebhook(
    _path: string,
    _method: string,
    _headers: Record<string, string>,
    body: string,
  ): Promise<WebhookResult> {
    try {
      const activity = JSON.parse(body) as BotFrameworkActivity;

      // Only handle message activities
      if (activity.type !== "message" || !activity.text?.trim()) {
        return { messages: [], statusCode: 200 };
      }

      const msg: IncomingMessage = {
        channel: "msteams",
        senderId: activity.from.id,
        senderName: activity.from.name,
        text: activity.text.trim(),
        messageId: activity.id,
        groupId: activity.conversation.id,
        timestamp: activity.timestamp,
        deliveryMeta: {
          serviceUrl: activity.serviceUrl,
          conversationId: activity.conversation.id,
          replyToId: activity.id,
        },
      };

      return { messages: [msg], statusCode: 200 };
    } catch (err) {
      logger.error("Teams webhook parse error", {
        error: err instanceof Error ? err.message : String(err),
      });
      return { messages: [], statusCode: 400 };
    }
  }

  async deliver(params: DeliveryParams): Promise<boolean> {
    try {
      const serviceUrl = (params.metadata?.serviceUrl as string) ?? "https://smba.trafficmanager.net/kr/";
      const conversationId = params.threadId ?? params.recipientId;
      const token = await this.getAuthToken();

      const url = `${serviceUrl.replace(/\/$/, "")}/v3/conversations/${encodeURIComponent(conversationId)}/activities`;

      const activity: Record<string, unknown> = {
        type: "message",
        text: params.text,
        textFormat: "plain",
      };

      if (params.metadata?.replyToId) {
        activity.replyToId = params.metadata.replyToId;
      }

      const res = await fetch(url, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(activity),
      });

      if (!res.ok) {
        const text = await res.text();
        logger.error("Teams send failed", { status: res.status, body: text });
        return false;
      }

      return true;
    } catch (err) {
      logger.error("Teams delivery error", {
        error: err instanceof Error ? err.message : String(err),
      });
      return false;
    }
  }

  async shutdown(): Promise<void> {
    this.cachedToken = null;
  }

  /** Get Bot Framework OAuth2 token (with caching) */
  private async getAuthToken(): Promise<string> {
    if (this.cachedToken && Date.now() < this.cachedToken.expiresAt - 60_000) {
      return this.cachedToken.token;
    }

    const res = await fetch("https://login.microsoftonline.com/botframework.com/oauth2/v2.0/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "client_credentials",
        client_id: this.appId,
        client_secret: this.appPassword,
        scope: "https://api.botframework.com/.default",
      }),
    });

    if (!res.ok) {
      throw new Error(`Teams auth failed: ${res.status}`);
    }

    const data = (await res.json()) as { access_token: string; expires_in: number };
    this.cachedToken = {
      token: data.access_token,
      expiresAt: Date.now() + data.expires_in * 1000,
    };

    return data.access_token;
  }
}
