/**
 * Mattermost Adapter
 *
 * Receives messages via Mattermost Outgoing Webhook or Bot Account.
 * Uses Mattermost REST API v4 for sending responses.
 *
 * Setup:
 *   1. Create a Bot Account in Mattermost System Console
 *   2. Create Outgoing Webhook → URL: https://your-gateway/webhook/mattermost
 *   3. Set MATTERMOST_URL and MATTERMOST_TOKEN
 */

import type { GatewayConfig } from "../config.js";
import type { ChannelPlugin, WebhookResult, DeliveryParams } from "../plugins/types.js";
import type { IncomingMessage } from "../pipeline/types.js";
import { logger } from "../logger.js";

interface MattermostOutgoingWebhook {
  token?: string;
  team_id?: string;
  channel_id: string;
  channel_name?: string;
  user_id: string;
  user_name?: string;
  text: string;
  post_id?: string;
  timestamp?: number;
  trigger_word?: string;
}

export class MattermostAdapter implements ChannelPlugin {
  readonly channel = "mattermost" as const;
  readonly displayName = "Mattermost";

  private serverUrl = "";
  private token = "";
  private botUserId = "";

  isConfigured(config: GatewayConfig): boolean {
    return !!(config.mattermostUrl && config.mattermostToken);
  }

  async initialize(config: GatewayConfig): Promise<void> {
    this.serverUrl = config.mattermostUrl!.replace(/\/$/, "");
    this.token = config.mattermostToken!;

    // Verify bot credentials
    const res = await fetch(`${this.serverUrl}/api/v4/users/me`, {
      headers: { Authorization: `Bearer ${this.token}` },
    });

    if (!res.ok) {
      throw new Error(`Mattermost auth failed: ${res.status}`);
    }

    const me = (await res.json()) as { id: string; username: string };
    this.botUserId = me.id;
    logger.info("Mattermost adapter connected", { username: me.username });
  }

  async handleWebhook(
    _path: string,
    _method: string,
    _headers: Record<string, string>,
    body: string,
  ): Promise<WebhookResult> {
    try {
      const data = JSON.parse(body) as MattermostOutgoingWebhook;

      // Skip bot's own messages
      if (data.user_id === this.botUserId) {
        return { messages: [], statusCode: 200 };
      }

      // Remove trigger word from text
      let text = data.text;
      if (data.trigger_word) {
        text = text.replace(new RegExp(`^${data.trigger_word}\\s*`, "i"), "");
      }

      if (!text.trim()) {
        return { messages: [], statusCode: 200 };
      }

      const msg: IncomingMessage = {
        channel: "mattermost",
        senderId: data.user_id,
        senderName: data.user_name,
        text: text.trim(),
        messageId: data.post_id,
        groupId: data.channel_id,
        deliveryMeta: { channelId: data.channel_id },
      };

      return { messages: [msg], statusCode: 200 };
    } catch (err) {
      logger.error("Mattermost webhook parse error", {
        error: err instanceof Error ? err.message : String(err),
      });
      return { messages: [], statusCode: 400 };
    }
  }

  async deliver(params: DeliveryParams): Promise<boolean> {
    try {
      const channelId = (params.metadata?.channelId as string) ?? params.threadId ?? params.recipientId;

      // If recipientId is a user ID (DM), create/get DM channel first
      let targetChannelId = channelId;
      if (!params.metadata?.channelId && !params.threadId) {
        targetChannelId = await this.getOrCreateDM(params.recipientId);
      }

      const res = await fetch(`${this.serverUrl}/api/v4/posts`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          channel_id: targetChannelId,
          message: params.text,
          root_id: params.replyToId ?? undefined,
        }),
      });

      if (!res.ok) {
        const text = await res.text();
        logger.error("Mattermost send failed", { status: res.status, body: text });
        return false;
      }

      return true;
    } catch (err) {
      logger.error("Mattermost delivery error", {
        error: err instanceof Error ? err.message : String(err),
      });
      return false;
    }
  }

  async shutdown(): Promise<void> {
    // No persistent connections to clean up
  }

  /** Get or create a direct message channel with a user */
  private async getOrCreateDM(userId: string): Promise<string> {
    const res = await fetch(`${this.serverUrl}/api/v4/channels/direct`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify([this.botUserId, userId]),
    });

    if (!res.ok) {
      throw new Error(`Failed to create DM channel: ${res.status}`);
    }

    const channel = (await res.json()) as { id: string };
    return channel.id;
  }
}
