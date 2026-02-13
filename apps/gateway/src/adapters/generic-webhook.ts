/**
 * Generic Webhook Adapter
 *
 * A catch-all adapter for channels that use simple webhook patterns:
 *   - Twitch (EventSub webhooks)
 *   - Nostr (relay bridge)
 *   - BlueBubbles (iMessage bridge)
 *   - Tlon (Urbit bridge)
 *   - iMessage (via BlueBubbles or similar bridge)
 *
 * Each of these channels sends a webhook with a standardized payload format:
 * {
 *   "sender_id": "...",
 *   "sender_name": "...",
 *   "text": "...",
 *   "message_id": "...",
 *   "group_id": "...",
 *   "reply_url": "..."    // URL to POST the response to
 * }
 *
 * This avoids creating separate adapter files for channels
 * that have simple webhook-in → webhook-out patterns.
 */

import type { GatewayConfig } from "../config.js";
import type { ChannelPlugin, WebhookResult, DeliveryParams, GatewayChannel } from "../plugins/types.js";
import type { IncomingMessage } from "../pipeline/types.js";
import { logger } from "../logger.js";

interface GenericWebhookPayload {
  sender_id: string;
  sender_name?: string;
  text: string;
  message_id?: string;
  group_id?: string;
  reply_url?: string;
  metadata?: Record<string, unknown>;
}

/**
 * Create a generic webhook adapter for a given channel.
 * The adapter receives messages via webhook and delivers responses to a reply_url.
 */
export function createGenericAdapter(
  channel: GatewayChannel,
  displayName: string,
  configCheck: (config: GatewayConfig) => boolean,
): ChannelPlugin {
  let replyUrls = new Map<string, string>(); // senderId → replyUrl

  return {
    channel,
    displayName,

    isConfigured: configCheck,

    async initialize(): Promise<void> {
      logger.info(`${displayName} generic adapter initialized`);
    },

    async handleWebhook(
      _path: string,
      _method: string,
      _headers: Record<string, string>,
      body: string,
    ): Promise<WebhookResult> {
      try {
        const data = JSON.parse(body) as GenericWebhookPayload;

        if (!data.text?.trim() || !data.sender_id) {
          return { messages: [], statusCode: 200 };
        }

        // Store reply URL for later delivery
        if (data.reply_url) {
          replyUrls.set(data.sender_id, data.reply_url);
        }

        const msg: IncomingMessage = {
          channel,
          senderId: data.sender_id,
          senderName: data.sender_name,
          text: data.text.trim(),
          messageId: data.message_id,
          groupId: data.group_id,
          deliveryMeta: {
            replyUrl: data.reply_url,
            ...data.metadata,
          },
        };

        return { messages: [msg], statusCode: 200 };
      } catch (err) {
        logger.error(`${displayName} webhook parse error`, {
          error: err instanceof Error ? err.message : String(err),
        });
        return { messages: [], statusCode: 400 };
      }
    },

    async deliver(params: DeliveryParams): Promise<boolean> {
      const replyUrl = (params.metadata?.replyUrl as string)
        ?? replyUrls.get(params.recipientId);

      if (!replyUrl) {
        logger.warn(`${displayName}: no reply URL for delivery`, {
          recipientId: params.recipientId,
        });
        return false;
      }

      try {
        const res = await fetch(replyUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            recipient_id: params.recipientId,
            text: params.text,
            reply_to_id: params.replyToId,
            thread_id: params.threadId,
          }),
        });

        if (!res.ok) {
          logger.error(`${displayName} delivery failed`, { status: res.status });
          return false;
        }

        return true;
      } catch (err) {
        logger.error(`${displayName} delivery error`, {
          error: err instanceof Error ? err.message : String(err),
        });
        return false;
      }
    },

    async shutdown(): Promise<void> {
      replyUrls = new Map();
    },
  };
}
