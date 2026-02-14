import { NextRequest, NextResponse } from "next/server";
import { runSecurityChecks } from "@/lib/security";
import { resolveChannelUser, makeSessionId } from "@/lib/channel-user-resolver";
import { generateAIResponse, detectCategory } from "@/lib/ai-engine";
import { enqueueTask, isQueueAvailable } from "@/lib/async-queue";
import { deliverSlack } from "@/lib/channel-delivery";

// Optimization 3: Run in Seoul region for Korean users
export const preferredRegion = "icn1";

/**
 * POST /api/slack/webhook
 * Slack Events API webhook — handles messages from Slack workspace.
 *
 * Security:
 *   1. HMAC-SHA256 signature verification (Slack signing secret)
 *   2. Rate limiting per user
 *   3. Input validation & data masking
 *   4. Unified user resolution
 *
 * Env vars:
 *   SLACK_BOT_TOKEN      — Bot OAuth token (xoxb-...)
 *   SLACK_SIGNING_SECRET — App signing secret for request verification
 *
 * Setup:
 *   1. Create Slack app at api.slack.com
 *   2. Enable Events API, set Request URL to https://mymoa.app/api/slack/webhook
 *   3. Subscribe to: message.im, message.channels, app_mention
 *   4. Install app to workspace
 */

/** Verify Slack request signature (HMAC-SHA256) — Edge-compatible */
async function verifySlackSignature(body: string, timestamp: string, signature: string, secret: string): Promise<boolean> {
  try {
    // Check timestamp freshness (5 min window)
    const now = Math.floor(Date.now() / 1000);
    if (Math.abs(now - parseInt(timestamp)) > 300) return false;

    const baseString = `v0:${timestamp}:${body}`;
    const encoder = new TextEncoder();
    const key = await crypto.subtle.importKey(
      "raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"],
    );
    const sig = await crypto.subtle.sign("HMAC", key, encoder.encode(baseString));
    const expected = `v0=${Array.from(new Uint8Array(sig)).map(b => b.toString(16).padStart(2, "0")).join("")}`;

    return expected === signature;
  } catch {
    return false;
  }
}

export async function POST(request: NextRequest) {
  try {
    // Skip Slack retry events to prevent duplicate processing
    const retryNum = request.headers.get("x-slack-retry-num");
    if (retryNum) {
      return NextResponse.json({ ok: true });
    }

    const rawBody = await request.text();

    // Verify Slack signature
    const signingSecret = process.env.SLACK_SIGNING_SECRET;
    if (signingSecret) {
      const slackTimestamp = request.headers.get("x-slack-request-timestamp") ?? "";
      const slackSignature = request.headers.get("x-slack-signature") ?? "";
      const isValid = await verifySlackSignature(rawBody, slackTimestamp, slackSignature, signingSecret);
      if (!isValid) {
        return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
      }
    }

    const payload = JSON.parse(rawBody);

    // Handle Slack URL verification challenge
    if (payload.type === "url_verification") {
      return NextResponse.json({ challenge: payload.challenge });
    }

    // Handle Events API
    if (payload.type === "event_callback") {
      const event = payload.event;
      if (!event) return NextResponse.json({ ok: true });

      // Skip bot messages (prevent loops)
      if (event.bot_id || event.subtype === "bot_message") {
        return NextResponse.json({ ok: true });
      }

      // Handle: message.im (DM), app_mention, message.channels (if bot mentioned)
      const isDirectMessage = event.channel_type === "im";
      const isMention = event.type === "app_mention";

      if (!isDirectMessage && !isMention) {
        return NextResponse.json({ ok: true });
      }

      const text = event.text ?? "";
      const slackUserId = event.user ?? "";
      const channelId = event.channel ?? "";
      const threadTs = event.thread_ts ?? event.ts;

      if (!text.trim() || !slackUserId) {
        return NextResponse.json({ ok: true });
      }

      // Remove bot mention from text (<@BOTID>)
      const cleanText = text.replace(/<@[A-Z0-9]+>/g, "").trim();
      if (!cleanText) return NextResponse.json({ ok: true });

      // Resolve user identity
      const resolvedUser = await resolveChannelUser({
        channel: "slack",
        channelUserId: slackUserId,
        displayName: slackUserId,
      });
      const effectiveUserId = resolvedUser.effectiveUserId;
      const sessionId = makeSessionId("slack", slackUserId);

      // Security checks
      const securityResult = await runSecurityChecks({
        channel: "slack", userId: effectiveUserId, messageText: cleanText,
      });

      if (!securityResult.proceed) {
        const token = process.env.SLACK_BOT_TOKEN;
        if (token) {
          await deliverSlack({ token, channelId, text: securityResult.userResponse ?? "잠시 후 다시 시도해주세요.", threadTs });
        }
        return NextResponse.json({ ok: true });
      }

      const category = detectCategory(securityResult.sanitizedText);
      const token = process.env.SLACK_BOT_TOKEN;

      // Try async path (Optimization 2)
      if (isQueueAvailable()) {
        await enqueueTask({
          channel: "slack",
          message: securityResult.sanitizedText,
          maskedTextForStorage: securityResult.sensitiveDataDetected ? securityResult.maskedTextForStorage : undefined,
          userId: effectiveUserId,
          sessionId,
          category,
          delivery: { channelId, threadTs },
        });
      } else if (token) {
        // Sync fallback: call ai-engine directly
        const result = await generateAIResponse({
          message: securityResult.sanitizedText,
          userId: effectiveUserId,
          sessionId,
          channel: "slack",
          category,
          maskedTextForStorage: securityResult.sensitiveDataDetected ? securityResult.maskedTextForStorage : undefined,
        });
        await deliverSlack({ token, channelId, text: result.reply, threadTs });
      }

      return NextResponse.json({ ok: true });
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[slack/webhook] Error:", err);
    return NextResponse.json({ ok: true });
  }
}

/**
 * GET /api/slack/webhook?action=info
 * Check Slack bot status.
 */
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const action = searchParams.get("action");
  const token = process.env.SLACK_BOT_TOKEN;

  if (!token) {
    return NextResponse.json({ error: "SLACK_BOT_TOKEN not configured" }, { status: 503 });
  }

  if (action === "info") {
    try {
      const res = await fetch("https://slack.com/api/auth.test", {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      return NextResponse.json({ bot: data });
    } catch {
      return NextResponse.json({ error: "Failed to fetch bot info" }, { status: 500 });
    }
  }

  return NextResponse.json({
    usage: {
      info: "GET /api/slack/webhook?action=info",
      setup: [
        "1. Create app at api.slack.com/apps",
        "2. Set SLACK_BOT_TOKEN and SLACK_SIGNING_SECRET in Vercel",
        "3. Enable Events API → Request URL: https://mymoa.app/api/slack/webhook",
        "4. Subscribe to: message.im, app_mention",
        "5. Install to workspace",
      ],
    },
  });
}
