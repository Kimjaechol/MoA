/**
 * Slack Events API Webhook Handler for MoA
 *
 * Receives messages from Slack Events API and processes them
 * through the unified MoA message pipeline.
 *
 * Setup:
 * 1. Create app at https://api.slack.com/apps
 * 2. Enable Events API → subscribe to bot events: message.im, app_mention
 * 3. Set SLACK_BOT_TOKEN and SLACK_SIGNING_SECRET env vars
 * 4. Webhook URL: https://mymoa.app/slack/webhook
 *
 * Environment:
 * - SLACK_BOT_TOKEN — Bot User OAuth Token (xoxb-...) (required)
 * - SLACK_SIGNING_SECRET — Signing secret for request verification (required)
 */

import type { IncomingMessage, ServerResponse } from "node:http";
import { createHmac, timingSafeEqual } from "node:crypto";
import type { MoAMessageHandler, ChannelContext } from "./types.js";

/** Max webhook request body size (1 MB) */
const MAX_BODY_SIZE = 1024 * 1024;

/** Slack signature timestamp tolerance (5 minutes) */
const TIMESTAMP_TOLERANCE_S = 300;

// ============================================
// Slack API Types (minimal)
// ============================================

interface SlackEventPayload {
  type: string;
  challenge?: string;
  token?: string;
  event?: SlackEvent;
  event_id?: string;
  team_id?: string;
}

interface SlackEvent {
  type: string;
  subtype?: string;
  user?: string;
  text?: string;
  channel?: string;
  channel_type?: string;
  ts?: string;
  bot_id?: string;
  thread_ts?: string;
}

// ============================================
// Slack API Client
// ============================================

function getSlackConfig(): { botToken: string; signingSecret: string } | null {
  const botToken = process.env.SLACK_BOT_TOKEN;
  const signingSecret = process.env.SLACK_SIGNING_SECRET;
  if (!botToken || !signingSecret) return null;
  return { botToken, signingSecret };
}

/**
 * Verify Slack request signature (HMAC-SHA256).
 */
function verifySlackSignature(
  signingSecret: string,
  signature: string | undefined,
  timestamp: string | undefined,
  body: string,
): boolean {
  if (!signature || !timestamp) return false;

  // Check timestamp freshness (prevent replay attacks)
  const now = Math.floor(Date.now() / 1000);
  if (Math.abs(now - parseInt(timestamp, 10)) > TIMESTAMP_TOLERANCE_S) {
    return false;
  }

  const basestring = `v0:${timestamp}:${body}`;
  const expected = "v0=" + createHmac("sha256", signingSecret).update(basestring).digest("hex");

  try {
    return timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
  } catch {
    return false;
  }
}

/**
 * Send a message to a Slack channel via Web API.
 */
async function sendSlackMessage(
  channel: string,
  text: string,
  threadTs?: string,
  quickReplies?: string[],
  buttons?: Array<{ label: string; url: string }>,
): Promise<void> {
  const config = getSlackConfig();
  if (!config) return;

  // Slack message limit is 40,000 chars but practical limit ~4000
  const truncated = text.length > 4000 ? text.slice(0, 3997) + "..." : text;

  const body: Record<string, unknown> = {
    channel,
    text: truncated,
  };

  if (threadTs) {
    body.thread_ts = threadTs;
  }

  // Build blocks for buttons/quick replies
  const blocks: unknown[] = [
    { type: "section", text: { type: "mrkdwn", text: truncated } },
  ];

  if (buttons?.length) {
    blocks.push({
      type: "actions",
      elements: buttons.slice(0, 5).map((btn, i) => ({
        type: "button",
        text: { type: "plain_text", text: btn.label.slice(0, 75) },
        url: btn.url,
        action_id: `btn_${i}`,
      })),
    });
  }

  if (quickReplies?.length) {
    blocks.push({
      type: "actions",
      elements: quickReplies.slice(0, 5).map((label, i) => ({
        type: "button",
        text: { type: "plain_text", text: label.slice(0, 75) },
        action_id: `qr_${i}`,
        value: label,
      })),
    });
  }

  if (buttons?.length || quickReplies?.length) {
    body.blocks = blocks;
  }

  try {
    const response = await fetch("https://slack.com/api/chat.postMessage", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${config.botToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(10000),
    });

    if (!response.ok) {
      console.error(`[Slack] Send failed (${response.status})`);
    } else {
      const result = await response.json() as { ok: boolean; error?: string };
      if (!result.ok) {
        console.error(`[Slack] API error: ${result.error}`);
      }
    }
  } catch (err) {
    console.error("[Slack] Send error:", err);
  }
}

/**
 * Fetch user info from Slack API.
 */
async function getSlackUserInfo(userId: string): Promise<{ name: string; realName: string } | null> {
  const config = getSlackConfig();
  if (!config) return null;

  try {
    const response = await fetch(`https://slack.com/api/users.info?user=${userId}`, {
      headers: { Authorization: `Bearer ${config.botToken}` },
      signal: AbortSignal.timeout(5000),
    });
    const data = await response.json() as {
      ok: boolean;
      user?: { name?: string; real_name?: string };
    };
    if (data.ok && data.user) {
      return {
        name: data.user.name ?? userId,
        realName: data.user.real_name ?? data.user.name ?? userId,
      };
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
 * Handle incoming Slack Events API webhook requests.
 * Routes: POST /slack/webhook
 */
export function handleSlackRequest(
  req: IncomingMessage,
  res: ServerResponse,
  onMessage: MoAMessageHandler,
  logger: { info: (msg: string) => void; error: (msg: string) => void },
): boolean {
  const url = req.url?.split("?")[0] ?? "";

  if (url !== "/slack/webhook") {
    return false;
  }

  const config = getSlackConfig();

  // GET: Return setup info
  if (req.method === "GET") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({
      channel: "slack",
      configured: !!config,
      webhook_url: "/slack/webhook",
      setup: "https://api.slack.com/apps → Events API → message.im, app_mention",
    }));
    return true;
  }

  if (req.method !== "POST") {
    return false;
  }

  if (!config) {
    res.writeHead(200, { "Content-Type": "application/json" });
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

    // Verify Slack signature
    const signature = req.headers["x-slack-signature"] as string | undefined;
    const timestamp = req.headers["x-slack-request-timestamp"] as string | undefined;

    if (!verifySlackSignature(config.signingSecret, signature, timestamp, body)) {
      logger.error("[Slack] Invalid request signature");
      res.writeHead(401);
      res.end("Unauthorized");
      return;
    }

    let payload: SlackEventPayload;
    try {
      payload = JSON.parse(body) as SlackEventPayload;
    } catch {
      logger.error("[Slack] Failed to parse event body");
      res.writeHead(400);
      res.end("Bad Request");
      return;
    }

    // Handle URL verification challenge
    if (payload.type === "url_verification" && payload.challenge) {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ challenge: payload.challenge }));
      return;
    }

    // Respond 200 immediately for event callbacks
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: true }));

    // Process event asynchronously
    if (payload.type === "event_callback" && payload.event) {
      processSlackEvent(payload.event, onMessage, logger).catch((err) => {
        logger.error(`[Slack] Event processing error: ${err}`);
      });
    }
  });

  return true;
}

/**
 * Process a single Slack event.
 */
async function processSlackEvent(
  event: SlackEvent,
  onMessage: MoAMessageHandler,
  logger: { info: (msg: string) => void; error: (msg: string) => void },
): Promise<void> {
  // Only handle message events (DMs and mentions)
  if (event.type !== "message" && event.type !== "app_mention") return;

  // Skip bot messages to prevent loops
  if (event.bot_id || event.subtype === "bot_message") return;

  // Skip message subtypes (edits, deletes, etc.)
  if (event.subtype) return;

  const text = event.text?.trim();
  if (!text || !event.user || !event.channel) return;

  // Remove bot mention from text if present
  let cleanText = text.replace(/<@[A-Z0-9]+>/g, "").trim();
  if (!cleanText) cleanText = "안녕";

  const userInfo = await getSlackUserInfo(event.user);
  const displayName = userInfo?.realName ?? event.user;

  logger.info(`[Slack] Message from ${displayName}: ${cleanText.slice(0, 100)}`);

  const channel: ChannelContext = {
    channelId: "slack",
    channelName: "Slack",
    userId: `slack_${event.user}`,
    userName: displayName,
    chatId: event.channel,
    maxMessageLength: 4000,
  };

  try {
    const result = await onMessage({
      userId: channel.userId,
      userType: "slack",
      text: cleanText,
      botId: "moa-slack",
      blockId: "",
      timestamp: event.ts ? parseFloat(event.ts) * 1000 : Date.now(),
      channel,
    });

    await sendSlackMessage(
      event.channel,
      result.text,
      event.thread_ts,
      result.quickReplies,
      result.buttons,
    );
  } catch (err) {
    logger.error(`[Slack] Message handling error: ${err}`);
    await sendSlackMessage(
      event.channel,
      "죄송합니다, 메시지 처리 중 오류가 발생했습니다. 잠시 후 다시 시도해주세요.",
      event.thread_ts,
    );
  }
}

/**
 * Check if Slack is configured.
 */
export function isSlackConfigured(): boolean {
  return !!getSlackConfig();
}
