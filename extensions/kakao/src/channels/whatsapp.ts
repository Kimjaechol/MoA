/**
 * WhatsApp Cloud API Webhook Handler for MoA
 *
 * Uses Meta's official WhatsApp Cloud API (not web scraping).
 * Free tier: 1,000 service conversations/month.
 *
 * Setup:
 * 1. Create app at https://developers.facebook.com
 * 2. Add WhatsApp product → configure webhook
 * 3. Set env vars: WHATSAPP_TOKEN, WHATSAPP_PHONE_NUMBER_ID, WHATSAPP_VERIFY_TOKEN
 * 4. Webhook URL: https://moa.lawith.kr/whatsapp/webhook
 *
 * Environment:
 * - WHATSAPP_TOKEN — Permanent access token from Meta Business
 * - WHATSAPP_PHONE_NUMBER_ID — Phone number ID from WhatsApp Business
 * - WHATSAPP_VERIFY_TOKEN — Webhook verification token (you choose this)
 */

import type { IncomingMessage, ServerResponse } from "node:http";
import { createHmac } from "node:crypto";
import type { MoAMessageHandler, ChannelContext } from "./types.js";

/** Max webhook request body size (1 MB) to prevent memory exhaustion */
const MAX_BODY_SIZE = 1024 * 1024;

// ============================================
// WhatsApp Cloud API Types
// ============================================

interface WhatsAppWebhookBody {
  object: string;
  entry?: Array<{
    id: string;
    changes: Array<{
      value: {
        messaging_product: string;
        metadata: { display_phone_number: string; phone_number_id: string };
        contacts?: Array<{ profile: { name: string }; wa_id: string }>;
        messages?: Array<WhatsAppMessage>;
        statuses?: unknown[];
      };
      field: string;
    }>;
  }>;
}

interface WhatsAppMessage {
  from: string; // Sender phone number
  id: string;
  timestamp: string;
  type: "text" | "image" | "audio" | "document" | "location" | "interactive" | "button";
  text?: { body: string };
  interactive?: {
    type: string;
    button_reply?: { id: string; title: string };
    list_reply?: { id: string; title: string; description?: string };
  };
  button?: { text: string; payload: string };
}

// ============================================
// WhatsApp Cloud API Client
// ============================================

const WHATSAPP_API = "https://graph.facebook.com/v21.0";

function getWhatsAppConfig(): {
  token: string;
  phoneNumberId: string;
  verifyToken: string;
} | null {
  const token = process.env.WHATSAPP_TOKEN;
  const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;
  const verifyToken = process.env.WHATSAPP_VERIFY_TOKEN ?? "moa-whatsapp-verify";

  if (!token || !phoneNumberId) return null;
  return { token, phoneNumberId, verifyToken };
}

/**
 * Send a text message via WhatsApp Cloud API
 */
async function sendWhatsAppMessage(
  to: string,
  text: string,
  buttons?: Array<{ label: string; url: string }>,
  quickReplies?: string[],
): Promise<void> {
  const config = getWhatsAppConfig();
  if (!config) return;

  // WhatsApp message limit is 4096 chars
  const truncated = text.length > 4000 ? text.slice(0, 3997) + "..." : text;

  let body: Record<string, unknown>;

  // Use interactive message if we have quick reply buttons (max 3)
  if (quickReplies?.length && quickReplies.length <= 3) {
    body = {
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to,
      type: "interactive",
      interactive: {
        type: "button",
        body: { text: truncated },
        action: {
          buttons: quickReplies.slice(0, 3).map((label, i) => ({
            type: "reply",
            reply: { id: `btn_${i}`, title: label.slice(0, 20) },
          })),
        },
      },
    };
  } else if (buttons?.length) {
    // Use CTA URL buttons if available (max 1 URL button per message)
    body = {
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to,
      type: "interactive",
      interactive: {
        type: "cta_url",
        body: { text: truncated },
        action: {
          name: "cta_url",
          parameters: {
            display_text: buttons[0].label,
            url: buttons[0].url,
          },
        },
      },
    };
  } else {
    // Simple text message
    body = {
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to,
      type: "text",
      text: { body: truncated },
    };
  }

  try {
    const response = await fetch(
      `${WHATSAPP_API}/${config.phoneNumberId}/messages`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${config.token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(10000),
      },
    );

    if (!response.ok) {
      const err = await response.text().catch(() => "");
      console.error(`[WhatsApp] Send failed (${response.status}): ${err}`);
      // Fallback to simple text if interactive fails
      if (body.type !== "text") {
        await sendWhatsAppMessage(to, truncated);
      }
    }
  } catch (err) {
    console.error("[WhatsApp] Send error:", err);
  }
}

/**
 * Mark message as read (blue checkmarks)
 */
async function markAsRead(messageId: string): Promise<void> {
  const config = getWhatsAppConfig();
  if (!config) return;

  await fetch(`${WHATSAPP_API}/${config.phoneNumberId}/messages`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      status: "read",
      message_id: messageId,
    }),
    signal: AbortSignal.timeout(5000),
  }).catch(() => {});
}

// ============================================
// Webhook Handler
// ============================================

/**
 * Handle WhatsApp webhook requests.
 * Routes: GET /whatsapp/webhook (verification), POST /whatsapp/webhook (messages)
 */
export function handleWhatsAppRequest(
  req: IncomingMessage,
  res: ServerResponse,
  onMessage: MoAMessageHandler,
  logger: { info: (msg: string) => void; error: (msg: string) => void },
): boolean {
  const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);

  if (url.pathname !== "/whatsapp/webhook") {
    return false;
  }

  const config = getWhatsAppConfig();

  // GET: Webhook verification (required by Meta)
  if (req.method === "GET") {
    const mode = url.searchParams.get("hub.mode");
    const token = url.searchParams.get("hub.verify_token");
    const challenge = url.searchParams.get("hub.challenge");

    if (mode === "subscribe" && token === (config?.verifyToken ?? "moa-whatsapp-verify")) {
      logger.info("[WhatsApp] Webhook verified");
      res.writeHead(200, { "Content-Type": "text/plain" });
      res.end(challenge ?? "");
    } else {
      res.writeHead(403);
      res.end("Forbidden");
    }
    return true;
  }

  // POST: Incoming messages
  if (req.method === "POST") {
    if (!config) {
      res.writeHead(200);
      res.end("OK");
      return true;
    }

    let body = "";
    let bodySize = 0;
    let aborted = false;

    req.on("data", (chunk: Buffer) => {
      bodySize += chunk.length;
      if (bodySize > MAX_BODY_SIZE) {
        aborted = true;
        res.writeHead(413);
        res.end("Payload Too Large");
        req.destroy();
        return;
      }
      body += chunk.toString();
    });
    req.on("end", () => {
      if (aborted) return;

      // Verify webhook signature if WHATSAPP_APP_SECRET is configured
      const appSecret = process.env.WHATSAPP_APP_SECRET;
      if (appSecret) {
        const signature = req.headers["x-hub-signature-256"] as string | undefined;
        if (!signature) {
          logger.error("[WhatsApp] Missing X-Hub-Signature-256 header");
          res.writeHead(401);
          res.end("Unauthorized");
          return;
        }
        const expected = "sha256=" + createHmac("sha256", appSecret).update(body).digest("hex");
        if (signature !== expected) {
          logger.error("[WhatsApp] Invalid webhook signature");
          res.writeHead(401);
          res.end("Unauthorized");
          return;
        }
      }

      res.writeHead(200);
      res.end("OK");

      processWhatsAppWebhook(body, onMessage, logger).catch((err) => {
        logger.error(`[WhatsApp] Processing error: ${err}`);
      });
    });
    return true;
  }

  return false;
}

/**
 * Process a WhatsApp webhook event
 */
async function processWhatsAppWebhook(
  rawBody: string,
  onMessage: MoAMessageHandler,
  logger: { info: (msg: string) => void; error: (msg: string) => void },
): Promise<void> {
  let webhook: WhatsAppWebhookBody;
  try {
    webhook = JSON.parse(rawBody) as WhatsAppWebhookBody;
  } catch {
    logger.error("[WhatsApp] Failed to parse webhook body");
    return;
  }

  if (webhook.object !== "whatsapp_business_account") return;

  for (const entry of webhook.entry ?? []) {
    for (const change of entry.changes) {
      const value = change.value;
      if (!value.messages?.length) continue;

      for (const message of value.messages) {
        await handleWhatsAppMessage(message, value.contacts, onMessage, logger);
      }
    }
  }
}

/**
 * Handle a single WhatsApp message
 */
async function handleWhatsAppMessage(
  message: WhatsAppMessage,
  contacts: Array<{ profile: { name: string }; wa_id: string }> | undefined,
  onMessage: MoAMessageHandler,
  logger: { info: (msg: string) => void; error: (msg: string) => void },
): Promise<void> {
  // Extract text content
  let text: string | undefined;

  if (message.type === "text") {
    text = message.text?.body;
  } else if (message.type === "interactive") {
    text = message.interactive?.button_reply?.title ?? message.interactive?.list_reply?.title;
  } else if (message.type === "button") {
    text = message.button?.text;
  }

  if (!text) return;

  // Find contact name
  const contact = contacts?.find((c) => c.wa_id === message.from);
  const displayName = contact?.profile?.name ?? message.from;

  logger.info(`[WhatsApp] Message from ${displayName}: ${text.slice(0, 100)}`);

  // Mark as read
  await markAsRead(message.id);

  const channel: ChannelContext = {
    channelId: "whatsapp",
    channelName: "WhatsApp",
    userId: `wa_${message.from}`,
    userName: displayName,
    chatId: message.from,
    maxMessageLength: 4000,
  };

  try {
    const result = await onMessage({
      userId: channel.userId,
      userType: "whatsapp",
      text,
      botId: "moa-whatsapp",
      blockId: "",
      timestamp: parseInt(message.timestamp, 10) * 1000,
      channel,
    });

    await sendWhatsAppMessage(
      message.from,
      result.text,
      result.buttons,
      result.quickReplies,
    );
  } catch (err) {
    logger.error(`[WhatsApp] Message handling error: ${err}`);
    await sendWhatsAppMessage(
      message.from,
      "죄송합니다, 메시지 처리 중 오류가 발생했습니다. 잠시 후 다시 시도해주세요.",
    );
  }
}

/**
 * Check if WhatsApp is configured
 */
export function isWhatsAppConfigured(): boolean {
  return !!getWhatsAppConfig();
}
