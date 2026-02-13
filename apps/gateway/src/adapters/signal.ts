/**
 * Signal Adapter
 *
 * Connects to Signal via signal-cli REST API.
 * signal-cli must be running separately (Docker or native).
 *
 * Endpoints used:
 *   GET  /v1/receive/{number}    — poll for new messages
 *   POST /v2/send                — send a message
 *   GET  /v1/about               — check signal-cli status
 *
 * Setup:
 *   1. Run signal-cli-rest-api container (bbernhard/signal-cli-rest-api)
 *   2. Register/link phone number with signal-cli
 *   3. Set SIGNAL_CLI_URL and SIGNAL_PHONE env vars
 */

import type { GatewayConfig } from "../config.js";
import type { ChannelPlugin, WebhookResult, DeliveryParams } from "../plugins/types.js";
import type { IncomingMessage } from "../pipeline/types.js";
import { logger } from "../logger.js";

interface SignalMessage {
  envelope: {
    source?: string;
    sourceName?: string;
    timestamp?: number;
    dataMessage?: {
      message?: string;
      timestamp?: number;
      groupInfo?: { groupId?: string };
    };
  };
}

export class SignalAdapter implements ChannelPlugin {
  readonly channel = "signal" as const;
  readonly displayName = "Signal";

  private cliUrl = "";
  private phone = "";
  private pollTimer: NodeJS.Timeout | null = null;
  private processFn?: (msg: IncomingMessage) => void;

  isConfigured(config: GatewayConfig): boolean {
    return !!(config.signalCliUrl && config.signalPhone);
  }

  async initialize(config: GatewayConfig): Promise<void> {
    this.cliUrl = config.signalCliUrl!.replace(/\/$/, "");
    this.phone = config.signalPhone!;

    // Verify signal-cli is reachable
    const res = await fetch(`${this.cliUrl}/v1/about`);
    if (!res.ok) {
      throw new Error(`signal-cli not reachable at ${this.cliUrl}`);
    }

    logger.info("Signal adapter connected", { phone: this.phone.slice(0, 4) + "****" });

    // Start polling for new messages (signal-cli doesn't support webhooks natively)
    this.startPolling();
  }

  /** Signal doesn't use webhooks — it polls signal-cli. Webhook handler is a no-op. */
  async handleWebhook(
    _path: string,
    _method: string,
    _headers: Record<string, string>,
    _body: string,
  ): Promise<WebhookResult> {
    return {
      messages: [],
      statusCode: 200,
      responseBody: { ok: true, note: "Signal uses polling, not webhooks" },
    };
  }

  async deliver(params: DeliveryParams): Promise<boolean> {
    try {
      const body: Record<string, unknown> = {
        message: params.text,
        number: this.phone,
        recipients: [params.recipientId],
      };

      // If it's a group message, send to group instead
      if (params.threadId) {
        delete body.recipients;
        body.group = params.threadId;
      }

      const res = await fetch(`${this.cliUrl}/v2/send`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        const text = await res.text();
        logger.error("Signal send failed", { status: res.status, body: text });
        return false;
      }

      return true;
    } catch (err) {
      logger.error("Signal delivery error", {
        error: err instanceof Error ? err.message : String(err),
      });
      return false;
    }
  }

  async shutdown(): Promise<void> {
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
  }

  /** Set the callback for processing received messages */
  onMessage(fn: (msg: IncomingMessage) => void): void {
    this.processFn = fn;
  }

  /** Poll signal-cli for new messages every 2 seconds */
  private startPolling(): void {
    this.pollTimer = setInterval(async () => {
      try {
        const res = await fetch(`${this.cliUrl}/v1/receive/${encodeURIComponent(this.phone)}`);
        if (!res.ok) return;

        const messages = (await res.json()) as SignalMessage[];
        for (const msg of messages) {
          const text = msg.envelope?.dataMessage?.message;
          const sender = msg.envelope?.source;
          if (!text || !sender || sender === this.phone) continue;

          const incoming: IncomingMessage = {
            channel: "signal",
            senderId: sender,
            senderName: msg.envelope?.sourceName,
            text,
            groupId: msg.envelope?.dataMessage?.groupInfo?.groupId,
            timestamp: msg.envelope?.timestamp?.toString(),
          };

          this.processFn?.(incoming);
        }
      } catch {
        // Polling errors are non-critical
      }
    }, 2000);
  }
}
