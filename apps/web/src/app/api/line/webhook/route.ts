import { NextRequest, NextResponse } from "next/server";
import { runSecurityChecks } from "@/lib/security";
import { resolveChannelUser, makeSessionId } from "@/lib/channel-user-resolver";
import { generateAIResponse, detectCategory } from "@/lib/ai-engine";
import { enqueueTask, isQueueAvailable } from "@/lib/async-queue";
import { deliverLine } from "@/lib/channel-delivery";

// Optimization 3: Run in Seoul region for Korean users
export const preferredRegion = "icn1";

/**
 * POST /api/line/webhook
 * LINE Messaging API webhook — handles messages from LINE users.
 *
 * Security:
 *   1. HMAC-SHA256 signature verification (LINE channel secret)
 *   2. Rate limiting per user
 *   3. Input validation & data masking
 *   4. Unified user resolution
 *
 * Env vars:
 *   LINE_CHANNEL_ACCESS_TOKEN — Channel access token (long-lived)
 *   LINE_CHANNEL_SECRET       — Channel secret for signature verification
 *
 * Setup:
 *   1. Create LINE Official Account + Messaging API channel at developers.line.biz
 *   2. Set LINE_CHANNEL_ACCESS_TOKEN and LINE_CHANNEL_SECRET in Vercel
 *   3. Set Webhook URL: https://mymoa.app/api/line/webhook
 *   4. Enable "Use webhook" in LINE Developers console
 */

/** Verify LINE webhook signature (HMAC-SHA256) */
async function verifyLineSignature(body: string, signature: string, secret: string): Promise<boolean> {
  try {
    const encoder = new TextEncoder();
    const key = await crypto.subtle.importKey(
      "raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"],
    );
    const sig = await crypto.subtle.sign("HMAC", key, encoder.encode(body));
    const expected = btoa(String.fromCharCode(...new Uint8Array(sig)));
    return expected === signature;
  } catch {
    return false;
  }
}

export async function POST(request: NextRequest) {
  try {
    const rawBody = await request.text();

    // Verify LINE signature
    const channelSecret = process.env.LINE_CHANNEL_SECRET;
    if (channelSecret) {
      const lineSignature = request.headers.get("x-line-signature") ?? "";
      const isValid = await verifyLineSignature(rawBody, lineSignature, channelSecret);
      if (!isValid) {
        return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
      }
    }

    const payload = JSON.parse(rawBody);
    const token = process.env.LINE_CHANNEL_ACCESS_TOKEN;

    if (!token || !payload.events || !Array.isArray(payload.events)) {
      return NextResponse.json({ ok: true });
    }

    // Process each event (LINE sends multiple events in one request)
    for (const event of payload.events) {
      // Only handle text messages
      if (event.type !== "message" || event.message?.type !== "text") {
        continue;
      }

      const text = event.message.text ?? "";
      const lineUserId = event.source?.userId ?? "";
      const replyToken = event.replyToken ?? "";

      if (!text.trim() || !lineUserId) continue;

      // Resolve user identity
      const resolvedUser = await resolveChannelUser({
        channel: "line",
        channelUserId: lineUserId,
      });
      const effectiveUserId = resolvedUser.effectiveUserId;
      const sessionId = makeSessionId("line", lineUserId);

      // Security checks
      const securityResult = await runSecurityChecks({
        channel: "line", userId: effectiveUserId, messageText: text,
      });

      if (!securityResult.proceed) {
        if (replyToken) {
          await deliverLine({
            token,
            replyToken,
            text: securityResult.userResponse ?? "잠시 후 다시 시도해주세요.",
          });
        }
        continue;
      }

      const category = detectCategory(securityResult.sanitizedText);

      // Try async path (Optimization 2)
      // Note: LINE replyToken expires in ~30s, so async mode uses push message instead
      if (isQueueAvailable()) {
        await enqueueTask({
          channel: "line",
          message: securityResult.sanitizedText,
          maskedTextForStorage: securityResult.sensitiveDataDetected ? securityResult.maskedTextForStorage : undefined,
          userId: effectiveUserId,
          sessionId,
          category,
          delivery: { lineUserId, replyToken },
        });
      } else {
        // Sync fallback: use reply token (faster, within 30s window)
        const result = await generateAIResponse({
          message: securityResult.sanitizedText,
          userId: effectiveUserId,
          sessionId,
          channel: "line",
          category,
          maskedTextForStorage: securityResult.sensitiveDataDetected ? securityResult.maskedTextForStorage : undefined,
        });
        await deliverLine({ token, replyToken, text: result.reply });
      }
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[line/webhook] Error:", err);
    return NextResponse.json({ ok: true });
  }
}

/**
 * GET /api/line/webhook
 * LINE webhook verification endpoint.
 */
export async function GET() {
  return NextResponse.json({
    status: "ok",
    channel: "line",
    configured: !!process.env.LINE_CHANNEL_ACCESS_TOKEN,
    setup: [
      "1. Create Messaging API channel at developers.line.biz",
      "2. Set LINE_CHANNEL_ACCESS_TOKEN and LINE_CHANNEL_SECRET in Vercel",
      "3. Set Webhook URL: https://mymoa.app/api/line/webhook",
      "4. Enable 'Use webhook' in LINE Developers console",
    ],
  });
}
