/**
 * LINE Messaging API Webhook Handler for MoA
 *
 * Receives messages from LINE Messaging API webhook and processes them
 * through the unified MoA message pipeline.
 *
 * Setup:
 * 1. Create channel at https://developers.line.biz/console/
 * 2. Enable Messaging API
 * 3. Set LINE_CHANNEL_ACCESS_TOKEN and LINE_CHANNEL_SECRET env vars
 * 4. Webhook URL: https://mymoa.app/line/webhook
 *
 * Environment:
 * - LINE_CHANNEL_ACCESS_TOKEN — Channel access token (required)
 * - LINE_CHANNEL_SECRET — Channel secret for signature verification (required)
 */

import type { IncomingMessage, ServerResponse } from "node:http";
import { createHmac } from "node:crypto";
import type { MoAMessageHandler, ChannelContext } from "./types.js";

/** Max webhook request body size (1 MB) */
const MAX_BODY_SIZE = 1024 * 1024;

// ============================================
// LINE Messaging API Types (minimal)
// ============================================

interface LineWebhookBody {
  destination?: string;
  events: LineEvent[];
}

interface LineEvent {
  type: string;
  replyToken?: string;
  source?: {
    type: "user" | "group" | "room";
    userId?: string;
    groupId?: string;
    roomId?: string;
  };
  timestamp: number;
  message?: LineMessage;
  postback?: { data: string };
}

interface LineMessage {
  id: string;
  type: "text" | "image" | "video" | "audio" | "file" | "location" | "sticker";
  text?: string;
}

// ============================================
// LINE API Client
// ============================================

const LINE_API = "https://api.line.me/v2/bot";

function getLineConfig(): { accessToken: string; channelSecret: string } | null {
  const accessToken = process.env.LINE_CHANNEL_ACCESS_TOKEN;
  const channelSecret = process.env.LINE_CHANNEL_SECRET;
  if (!accessToken || !channelSecret) return null;
  return { accessToken, channelSecret };
}

/**
 * Verify LINE webhook signature (HMAC-SHA256 base64).
 */
function verifyLineSignature(
  channelSecret: string,
  signature: string | undefined,
  body: string,
): boolean {
  if (!signature) return false;
  const expected = createHmac("sha256", channelSecret).update(body).digest("base64");
  return signature === expected;
}

/**
 * Reply to a LINE message using the reply token.
 * Reply tokens expire after 30 seconds, so this must be called quickly.
 */
async function replyMessage(
  replyToken: string,
  text: string,
  quickReplies?: string[],
  buttons?: Array<{ label: string; url: string }>,
): Promise<boolean> {
  const config = getLineConfig();
  if (!config) return false;

  // LINE message limit is 5000 chars
  const truncated = text.length > 4900 ? text.slice(0, 4897) + "..." : text;

  const messages: unknown[] = [];

  // Main text message
  const textMsg: Record<string, unknown> = {
    type: "text",
    text: truncated,
  };

  // Add quick reply items if available (max 13 items)
  const qrItems: unknown[] = [];

  if (quickReplies?.length) {
    for (const label of quickReplies.slice(0, 10)) {
      qrItems.push({
        type: "action",
        action: { type: "message", label: label.slice(0, 20), text: label },
      });
    }
  }

  if (buttons?.length) {
    for (const btn of buttons.slice(0, 3)) {
      qrItems.push({
        type: "action",
        action: { type: "uri", label: btn.label.slice(0, 20), uri: btn.url },
      });
    }
  }

  if (qrItems.length > 0) {
    textMsg.quickReply = { items: qrItems };
  }

  messages.push(textMsg);

  try {
    const response = await fetch(`${LINE_API}/message/reply`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${config.accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ replyToken, messages }),
      signal: AbortSignal.timeout(10000),
    });

    if (!response.ok) {
      const err = await response.text().catch(() => "");
      console.error(`[LINE] Reply failed (${response.status}): ${err}`);
      return false;
    }
    return true;
  } catch (err) {
    console.error("[LINE] Reply error:", err);
    return false;
  }
}

/**
 * Push message to a LINE user (for async responses when reply token expired).
 */
async function pushMessage(
  userId: string,
  text: string,
  quickReplies?: string[],
  buttons?: Array<{ label: string; url: string }>,
): Promise<void> {
  const config = getLineConfig();
  if (!config) return;

  const truncated = text.length > 4900 ? text.slice(0, 4897) + "..." : text;

  const textMsg: Record<string, unknown> = {
    type: "text",
    text: truncated,
  };

  const qrItems: unknown[] = [];
  if (quickReplies?.length) {
    for (const label of quickReplies.slice(0, 10)) {
      qrItems.push({
        type: "action",
        action: { type: "message", label: label.slice(0, 20), text: label },
      });
    }
  }
  if (buttons?.length) {
    for (const btn of buttons.slice(0, 3)) {
      qrItems.push({
        type: "action",
        action: { type: "uri", label: btn.label.slice(0, 20), uri: btn.url },
      });
    }
  }
  if (qrItems.length > 0) {
    textMsg.quickReply = { items: qrItems };
  }

  try {
    const response = await fetch(`${LINE_API}/message/push`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${config.accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        to: userId,
        messages: [textMsg],
      }),
      signal: AbortSignal.timeout(10000),
    });

    if (!response.ok) {
      const err = await response.text().catch(() => "");
      console.error(`[LINE] Push failed (${response.status}): ${err}`);
    }
  } catch (err) {
    console.error("[LINE] Push error:", err);
  }
}

/**
 * Get LINE user profile.
 */
async function getLineUserProfile(userId: string): Promise<{ displayName: string } | null> {
  const config = getLineConfig();
  if (!config) return null;

  try {
    const response = await fetch(`${LINE_API}/profile/${userId}`, {
      headers: { Authorization: `Bearer ${config.accessToken}` },
      signal: AbortSignal.timeout(5000),
    });
    if (response.ok) {
      const data = await response.json() as { displayName?: string };
      return { displayName: data.displayName ?? userId };
    }
  } catch {
    // Ignore
  }
  return null;
}

// ============================================
// Webhook Handler
// ============================================

/**
 * Handle incoming LINE Messaging API webhook requests.
 * Routes: POST /line/webhook
 */
export function handleLineRequest(
  req: IncomingMessage,
  res: ServerResponse,
  onMessage: MoAMessageHandler,
  logger: { info: (msg: string) => void; error: (msg: string) => void },
): boolean {
  const url = req.url?.split("?")[0] ?? "";

  if (url !== "/line/webhook") {
    return false;
  }

  const config = getLineConfig();

  // GET: Return setup info
  if (req.method === "GET") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({
      channel: "line",
      configured: !!config,
      webhook_url: "/line/webhook",
      setup: "https://developers.line.biz/console/ → Messaging API → Webhook",
    }));
    return true;
  }

  if (req.method !== "POST") {
    return false;
  }

  if (!config) {
    res.writeHead(200);
    res.end(JSON.stringify({ ok: true }));
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

    // Verify LINE signature
    const signature = req.headers["x-line-signature"] as string | undefined;
    if (!verifyLineSignature(config.channelSecret, signature, body)) {
      logger.error("[LINE] Invalid webhook signature");
      res.writeHead(401);
      res.end("Unauthorized");
      return;
    }

    // Respond 200 immediately
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: true }));

    // Process events asynchronously
    processLineWebhook(body, onMessage, logger).catch((err) => {
      logger.error(`[LINE] Processing error: ${err}`);
    });
  });

  return true;
}

/**
 * Process LINE webhook events.
 */
async function processLineWebhook(
  rawBody: string,
  onMessage: MoAMessageHandler,
  logger: { info: (msg: string) => void; error: (msg: string) => void },
): Promise<void> {
  let webhook: LineWebhookBody;
  try {
    webhook = JSON.parse(rawBody) as LineWebhookBody;
  } catch {
    logger.error("[LINE] Failed to parse webhook body");
    return;
  }

  for (const event of webhook.events) {
    if (event.type === "message" && event.message?.type === "text") {
      await handleLineTextMessage(event, onMessage, logger);
    } else if (event.type === "postback" && event.postback) {
      // Handle postback (button click) as a text message
      await handleLineTextMessage(
        { ...event, message: { id: "", type: "text", text: event.postback.data } },
        onMessage,
        logger,
      );
    }
  }
}

/**
 * Handle a single LINE text message event.
 */
async function handleLineTextMessage(
  event: LineEvent,
  onMessage: MoAMessageHandler,
  logger: { info: (msg: string) => void; error: (msg: string) => void },
): Promise<void> {
  const text = event.message?.text?.trim();
  if (!text) return;

  const userId = event.source?.userId;
  if (!userId) return;

  const profile = await getLineUserProfile(userId);
  const displayName = profile?.displayName ?? userId;

  logger.info(`[LINE] Message from ${displayName}: ${text.slice(0, 100)}`);

  const channel: ChannelContext = {
    channelId: "line",
    channelName: "LINE",
    userId: `line_${userId}`,
    userName: displayName,
    chatId: event.source?.groupId ?? event.source?.roomId ?? userId,
    maxMessageLength: 4900,
  };

  try {
    const result = await onMessage({
      userId: channel.userId,
      userType: "line",
      text,
      botId: "moa-line",
      blockId: "",
      timestamp: event.timestamp,
      channel,
    });

    // Try reply token first (faster, free quota), fallback to push message
    if (event.replyToken) {
      const replied = await replyMessage(
        event.replyToken,
        result.text,
        result.quickReplies,
        result.buttons,
      );
      if (replied) return;
    }

    // Fallback: push message (costs messaging API quota)
    await pushMessage(userId, result.text, result.quickReplies, result.buttons);
  } catch (err) {
    logger.error(`[LINE] Message handling error: ${err}`);
    if (event.replyToken) {
      await replyMessage(event.replyToken, "죄송합니다, 메시지 처리 중 오류가 발생했습니다. 잠시 후 다시 시도해주세요.");
    } else {
      await pushMessage(userId, "죄송합니다, 메시지 처리 중 오류가 발생했습니다. 잠시 후 다시 시도해주세요.");
    }
  }
}

/**
 * Check if LINE is configured.
 */
export function isLineConfigured(): boolean {
  return !!getLineConfig();
}
