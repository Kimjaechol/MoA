/**
 * Nextcloud Talk Adapter
 *
 * Integrates with Nextcloud Talk via Nextcloud Bots API.
 * Uses OCS API v2 for sending messages.
 *
 * Setup:
 *   1. Install Nextcloud Talk on your Nextcloud instance
 *   2. Register bot via OCS API or admin settings
 *   3. Set Webhook URL: https://your-gateway/webhook/nextcloud-talk
 *   4. Set NEXTCLOUD_URL, NEXTCLOUD_USER, NEXTCLOUD_PASSWORD
 */

import type { GatewayConfig } from "../config.js";
import type { ChannelPlugin, WebhookResult, DeliveryParams } from "../plugins/types.js";
import type { IncomingMessage } from "../pipeline/types.js";
import { logger } from "../logger.js";

interface NextcloudTalkWebhook {
  type: string;
  target: { type: string; id: string };
  actor: { type: string; id: string; name?: string };
  object: {
    type: string;
    id: number;
    name: string;
    content: string;
    mediaType: string;
  };
}

export class NextcloudTalkAdapter implements ChannelPlugin {
  readonly channel = "nextcloud-talk" as const;
  readonly displayName = "Nextcloud Talk";

  private baseUrl = "";
  private authHeader = "";

  isConfigured(config: GatewayConfig): boolean {
    return !!(config.nextcloudUrl && config.nextcloudUser && config.nextcloudPassword);
  }

  async initialize(config: GatewayConfig): Promise<void> {
    this.baseUrl = config.nextcloudUrl!.replace(/\/$/, "");
    this.authHeader = "Basic " + Buffer.from(
      `${config.nextcloudUser!}:${config.nextcloudPassword!}`,
    ).toString("base64");

    // Verify connection
    const res = await fetch(`${this.baseUrl}/ocs/v2.php/core/getapppassword`, {
      headers: {
        Authorization: this.authHeader,
        "OCS-APIRequest": "true",
      },
    });
    // 403 is expected if using app password directly, 200 if using regular password
    if (res.status !== 200 && res.status !== 403) {
      throw new Error(`Nextcloud connection failed: ${res.status}`);
    }

    logger.info("Nextcloud Talk adapter initialized", { url: this.baseUrl });
  }

  async handleWebhook(
    _path: string,
    _method: string,
    _headers: Record<string, string>,
    body: string,
  ): Promise<WebhookResult> {
    try {
      const event = JSON.parse(body) as NextcloudTalkWebhook;

      // Only handle chat messages
      if (event.object?.type !== "message" || !event.object.content?.trim()) {
        return { messages: [], statusCode: 200 };
      }

      const msg: IncomingMessage = {
        channel: "nextcloud-talk",
        senderId: event.actor.id,
        senderName: event.actor.name,
        text: event.object.content.trim(),
        messageId: event.object.id.toString(),
        groupId: event.target.id,
        deliveryMeta: { conversationToken: event.target.id },
      };

      return { messages: [msg], statusCode: 200 };
    } catch (err) {
      logger.error("Nextcloud Talk webhook parse error", {
        error: err instanceof Error ? err.message : String(err),
      });
      return { messages: [], statusCode: 400 };
    }
  }

  async deliver(params: DeliveryParams): Promise<boolean> {
    try {
      const conversationToken = (params.metadata?.conversationToken as string)
        ?? params.threadId ?? params.recipientId;

      const res = await fetch(
        `${this.baseUrl}/ocs/v2.php/apps/spreed/api/v1/chat/${encodeURIComponent(conversationToken)}`,
        {
          method: "POST",
          headers: {
            Authorization: this.authHeader,
            "Content-Type": "application/json",
            "OCS-APIRequest": "true",
          },
          body: JSON.stringify({
            message: params.text,
            replyTo: params.replyToId ? parseInt(params.replyToId, 10) : undefined,
          }),
        },
      );

      if (!res.ok) {
        const text = await res.text();
        logger.error("Nextcloud Talk send failed", { status: res.status, body: text });
        return false;
      }

      return true;
    } catch (err) {
      logger.error("Nextcloud Talk delivery error", {
        error: err instanceof Error ? err.message : String(err),
      });
      return false;
    }
  }

  async shutdown(): Promise<void> {
    // No persistent connections
  }
}
