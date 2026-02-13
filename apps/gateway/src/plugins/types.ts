/**
 * Gateway Plugin Interface
 *
 * Each channel adapter implements this interface to register with the gateway.
 * Benchmarked from OpenClaw's ChannelPlugin pattern.
 */

import type { GatewayConfig } from "../config.js";
import type { IncomingMessage } from "../pipeline/types.js";

/** Channel identifier — all channels the gateway can handle */
export type GatewayChannel =
  | "signal"
  | "matrix"
  | "msteams"
  | "googlechat"
  | "mattermost"
  | "nextcloud-talk"
  | "twitch"
  | "nostr"
  | "zalo"
  | "bluebubbles"
  | "tlon"
  | "imessage";

/** Plugin lifecycle hooks */
export interface ChannelPlugin {
  /** Unique channel identifier */
  readonly channel: GatewayChannel;

  /** Human-readable channel name */
  readonly displayName: string;

  /**
   * Check if this plugin is configured (has required env vars).
   * Called during startup — unconfigured plugins are skipped.
   */
  isConfigured(config: GatewayConfig): boolean;

  /**
   * Initialize the plugin (connect to APIs, set up listeners, etc.).
   * Called once at startup for configured plugins.
   */
  initialize(config: GatewayConfig): Promise<void>;

  /**
   * Handle an incoming webhook HTTP request.
   * Return null if the request is not for this plugin.
   * Return an IncomingMessage[] for messages to process.
   */
  handleWebhook?(
    path: string,
    method: string,
    headers: Record<string, string>,
    body: string,
  ): Promise<WebhookResult>;

  /**
   * Deliver a response message back to the channel.
   */
  deliver(params: DeliveryParams): Promise<boolean>;

  /**
   * Graceful shutdown (disconnect, cleanup resources).
   */
  shutdown(): Promise<void>;
}

/** Result of processing a webhook request */
export interface WebhookResult {
  /** Messages extracted from the webhook payload */
  messages: IncomingMessage[];

  /** HTTP status code to return to the webhook caller */
  statusCode: number;

  /** Response body to send back (e.g., challenge response) */
  responseBody?: unknown;

  /** Response headers */
  responseHeaders?: Record<string, string>;
}

/** Parameters for delivering a message to a channel */
export interface DeliveryParams {
  /** Channel-specific recipient ID */
  recipientId: string;

  /** Message text to deliver */
  text: string;

  /** Optional: reply to a specific message */
  replyToId?: string;

  /** Optional: thread/room context */
  threadId?: string;

  /** Extra channel-specific metadata */
  metadata?: Record<string, unknown>;
}
