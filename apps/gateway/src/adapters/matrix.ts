/**
 * Matrix Adapter
 *
 * Connects to Matrix homeserver via Client-Server API (appservice or bot mode).
 * Uses webhook-based approach: Matrix → Webhook Bridge → Gateway.
 *
 * Endpoints:
 *   POST /webhook/matrix — receives Matrix webhook events
 *   PUT  /_matrix/...    — Matrix appservice transaction endpoint
 *
 * Setup:
 *   1. Create a Matrix bot account on your homeserver
 *   2. Generate access token: curl -XPOST https://matrix.example.com/_matrix/client/v3/login
 *   3. Set MATRIX_HOMESERVER_URL, MATRIX_ACCESS_TOKEN, MATRIX_USER_ID
 *   4. Invite the bot to rooms
 */

import type { GatewayConfig } from "../config.js";
import type { ChannelPlugin, WebhookResult, DeliveryParams } from "../plugins/types.js";
import type { IncomingMessage } from "../pipeline/types.js";
import { logger } from "../logger.js";

interface MatrixEvent {
  type: string;
  sender: string;
  room_id: string;
  event_id: string;
  content: {
    msgtype?: string;
    body?: string;
  };
  origin_server_ts: number;
}

export class MatrixAdapter implements ChannelPlugin {
  readonly channel = "matrix" as const;
  readonly displayName = "Matrix";

  private homeserverUrl = "";
  private accessToken = "";
  private botUserId = "";
  private syncToken = "";
  private syncTimer: NodeJS.Timeout | null = null;
  private processFn?: (msg: IncomingMessage) => void;

  isConfigured(config: GatewayConfig): boolean {
    return !!(config.matrixHomeserverUrl && config.matrixAccessToken && config.matrixUserId);
  }

  async initialize(config: GatewayConfig): Promise<void> {
    this.homeserverUrl = config.matrixHomeserverUrl!.replace(/\/$/, "");
    this.accessToken = config.matrixAccessToken!;
    this.botUserId = config.matrixUserId!;

    // Verify credentials
    const res = await fetch(`${this.homeserverUrl}/_matrix/client/v3/account/whoami`, {
      headers: { Authorization: `Bearer ${this.accessToken}` },
    });

    if (!res.ok) {
      throw new Error(`Matrix auth failed: ${res.status}`);
    }

    const whoami = (await res.json()) as { user_id: string };
    logger.info("Matrix adapter connected", { userId: whoami.user_id });

    // Start long-polling sync
    this.startSync();
  }

  async handleWebhook(
    _path: string,
    _method: string,
    _headers: Record<string, string>,
    body: string,
  ): Promise<WebhookResult> {
    // Handle webhook bridge events (e.g., from mautrix-webhook)
    try {
      const event = JSON.parse(body) as MatrixEvent;
      const messages = this.extractMessages([event]);
      return { messages, statusCode: 200 };
    } catch {
      return { messages: [], statusCode: 400 };
    }
  }

  async deliver(params: DeliveryParams): Promise<boolean> {
    try {
      const roomId = params.threadId ?? params.recipientId;
      const txnId = `moa_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

      const res = await fetch(
        `${this.homeserverUrl}/_matrix/client/v3/rooms/${encodeURIComponent(roomId)}/send/m.room.message/${txnId}`,
        {
          method: "PUT",
          headers: {
            Authorization: `Bearer ${this.accessToken}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            msgtype: "m.text",
            body: params.text,
          }),
        },
      );

      if (!res.ok) {
        const text = await res.text();
        logger.error("Matrix send failed", { roomId, status: res.status, body: text });
        return false;
      }

      return true;
    } catch (err) {
      logger.error("Matrix delivery error", {
        error: err instanceof Error ? err.message : String(err),
      });
      return false;
    }
  }

  async shutdown(): Promise<void> {
    if (this.syncTimer) {
      clearTimeout(this.syncTimer);
      this.syncTimer = null;
    }
  }

  onMessage(fn: (msg: IncomingMessage) => void): void {
    this.processFn = fn;
  }

  /** Extract processable messages from Matrix events */
  private extractMessages(events: MatrixEvent[]): IncomingMessage[] {
    const messages: IncomingMessage[] = [];

    for (const event of events) {
      // Only process text messages from other users
      if (event.type !== "m.room.message") continue;
      if (event.sender === this.botUserId) continue;
      if (event.content.msgtype !== "m.text") continue;

      const text = event.content.body ?? "";
      if (!text.trim()) continue;

      messages.push({
        channel: "matrix",
        senderId: event.sender,
        text: text.trim(),
        messageId: event.event_id,
        groupId: event.room_id,
        timestamp: new Date(event.origin_server_ts).toISOString(),
        deliveryMeta: { roomId: event.room_id },
      });
    }

    return messages;
  }

  /** Long-polling sync with Matrix homeserver */
  private async startSync(): Promise<void> {
    const doSync = async () => {
      try {
        const params = new URLSearchParams({
          timeout: "30000",
          filter: JSON.stringify({
            room: {
              timeline: { types: ["m.room.message"], limit: 10 },
              state: { types: [] },
            },
            presence: { types: [] },
          }),
        });

        if (this.syncToken) {
          params.set("since", this.syncToken);
        }

        const res = await fetch(
          `${this.homeserverUrl}/_matrix/client/v3/sync?${params}`,
          {
            headers: { Authorization: `Bearer ${this.accessToken}` },
            signal: AbortSignal.timeout(35_000),
          },
        );

        if (res.ok) {
          const data = (await res.json()) as {
            next_batch: string;
            rooms?: { join?: Record<string, { timeline?: { events: MatrixEvent[] } }> };
          };

          this.syncToken = data.next_batch;

          // Process new messages from joined rooms
          if (data.rooms?.join) {
            for (const room of Object.values(data.rooms.join)) {
              const events = room.timeline?.events ?? [];
              const messages = this.extractMessages(events);
              for (const msg of messages) {
                this.processFn?.(msg);
              }
            }
          }
        }
      } catch {
        // Sync errors: retry after delay
      }

      // Schedule next sync
      this.syncTimer = setTimeout(doSync, 500);
    };

    // Initial sync (with no since token, gets current state only)
    doSync();
  }
}
