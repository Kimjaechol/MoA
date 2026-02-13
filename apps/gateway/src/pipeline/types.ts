/**
 * Unified Message Types
 *
 * All channel-specific messages are normalized into these types
 * before processing through the pipeline.
 */

import type { GatewayChannel } from "../plugins/types.js";

/** Normalized incoming message (from any channel) */
export interface IncomingMessage {
  /** Source channel */
  channel: GatewayChannel;

  /** Channel-specific sender ID */
  senderId: string;

  /** Sender display name (if available) */
  senderName?: string;

  /** Message text content */
  text: string;

  /** Channel-specific message ID */
  messageId?: string;

  /** Group/room/thread ID (if applicable) */
  groupId?: string;

  /** Reply-to message context */
  replyToId?: string;

  /** Raw timestamp from the channel */
  timestamp?: string;

  /** Extra channel-specific metadata for delivery */
  deliveryMeta?: Record<string, unknown>;
}

/** Processed result from the AI engine */
export interface ProcessedResult {
  /** AI response text */
  reply: string;

  /** Model used for generation */
  model: string;

  /** Category detected */
  category: string;

  /** Credits used */
  creditsUsed: number;

  /** Credits remaining */
  creditsRemaining?: number;

  /** Key source (moa vs user) */
  keySource: "moa" | "user";

  /** Processing timestamp */
  timestamp: string;
}

/** Input validation result */
export interface ValidationResult {
  /** Whether the input is safe to process */
  safe: boolean;

  /** Detected threats */
  threats: string[];

  /** Sanitized text (HTML entities escaped, etc.) */
  sanitizedText: string;
}

/** Sensitive data detection result */
export interface SensitiveDataResult {
  /** Whether sensitive data was found */
  detected: boolean;

  /** Types of sensitive data found */
  types: string[];

  /** Text with sensitive data masked */
  maskedText: string;
}
