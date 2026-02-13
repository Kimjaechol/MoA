import { NextRequest, NextResponse } from "next/server";
import { runSecurityChecks } from "@/lib/security";
import { resolveChannelUser, makeSessionId } from "@/lib/channel-user-resolver";
import { generateAIResponse, detectCategory } from "@/lib/ai-engine";
import { enqueueTask, isQueueAvailable } from "@/lib/async-queue";
import { deliverWhatsApp } from "@/lib/channel-delivery";

// Optimization 3: Run in Seoul region for Korean users
export const preferredRegion = "icn1";

/**
 * POST /api/whatsapp/webhook
 * WhatsApp Cloud API webhook — handles messages via Meta Business Platform.
 *
 * Security:
 *   1. Webhook verify token validation (Meta-provided)
 *   2. Message signature verification (optional, X-Hub-Signature-256)
 *   3. Rate limiting per user
 *   4. Input validation & data masking
 *   5. Unified user resolution
 *
 * Env vars:
 *   WHATSAPP_TOKEN            — Permanent access token from Meta
 *   WHATSAPP_VERIFY_TOKEN     — Webhook verification token (you choose this)
 *   WHATSAPP_PHONE_NUMBER_ID  — Phone number ID from Meta dashboard
 *   WHATSAPP_APP_SECRET       — (optional) App secret for signature verification
 *
 * Setup:
 *   1. Create Meta App at developers.facebook.com
 *   2. Add WhatsApp product, get permanent token
 *   3. Set Webhook URL: https://mymoa.app/api/whatsapp/webhook
 *   4. Subscribe to messages webhook field
 */

/** Verify Meta webhook signature (HMAC-SHA256) */
async function verifyMetaSignature(body: string, signature: string, secret: string): Promise<boolean> {
  try {
    const encoder = new TextEncoder();
    const key = await crypto.subtle.importKey(
      "raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"],
    );
    const sig = await crypto.subtle.sign("HMAC", key, encoder.encode(body));
    const expected = `sha256=${Array.from(new Uint8Array(sig)).map(b => b.toString(16).padStart(2, "0")).join("")}`;
    return expected === signature;
  } catch {
    return false;
  }
}

/** Mark message as read (best-effort) */
async function markAsRead(token: string, phoneNumberId: string, messageId: string): Promise<void> {
  try {
    await fetch(`https://graph.facebook.com/v21.0/${phoneNumberId}/messages`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        status: "read",
        message_id: messageId,
      }),
    });
  } catch { /* non-critical */ }
}

export async function POST(request: NextRequest) {
  try {
    const rawBody = await request.text();

    // Verify Meta signature if app secret is configured
    const appSecret = process.env.WHATSAPP_APP_SECRET;
    if (appSecret) {
      const signature = request.headers.get("x-hub-signature-256") ?? "";
      const isValid = await verifyMetaSignature(rawBody, signature, appSecret);
      if (!isValid) {
        return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
      }
    }

    const payload = JSON.parse(rawBody);
    const token = process.env.WHATSAPP_TOKEN;
    const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;

    if (!token || !phoneNumberId) {
      return NextResponse.json({ ok: true });
    }

    // Process WhatsApp webhook events
    const entries = payload.entry ?? [];
    for (const entry of entries) {
      const changes = entry.changes ?? [];
      for (const change of changes) {
        if (change.field !== "messages") continue;

        const value = change.value;
        const messages = value?.messages ?? [];

        for (const message of messages) {
          // Only handle text messages
          if (message.type !== "text") continue;

          const text = message.text?.body ?? "";
          const senderPhone = message.from ?? "";
          const waMessageId = message.id ?? "";

          if (!text.trim() || !senderPhone) continue;

          // Mark as read
          markAsRead(token, phoneNumberId, waMessageId).catch(() => {});

          // Extract contact name if available
          const contacts = value?.contacts ?? [];
          const contactName = contacts.find((c: { wa_id: string }) => c.wa_id === senderPhone)?.profile?.name;

          // Resolve user identity
          const resolvedUser = await resolveChannelUser({
            channel: "whatsapp",
            channelUserId: senderPhone,
            displayName: contactName,
          });
          const effectiveUserId = resolvedUser.effectiveUserId;
          const sessionId = makeSessionId("whatsapp", senderPhone);

          // Security checks
          const securityResult = await runSecurityChecks({
            channel: "whatsapp", userId: effectiveUserId, messageText: text,
          });

          if (!securityResult.proceed) {
            await deliverWhatsApp({
              token, phoneNumberId,
              recipientPhone: senderPhone,
              text: securityResult.userResponse ?? "잠시 후 다시 시도해주세요.",
            });
            continue;
          }

          const category = detectCategory(securityResult.sanitizedText);

          // Try async path (Optimization 2)
          if (isQueueAvailable()) {
            await enqueueTask({
              channel: "whatsapp",
              message: securityResult.sanitizedText,
              maskedTextForStorage: securityResult.sensitiveDataDetected ? securityResult.maskedTextForStorage : undefined,
              userId: effectiveUserId,
              sessionId,
              category,
              delivery: { recipientPhone: senderPhone },
            });
          } else {
            // Sync fallback: call ai-engine directly
            const result = await generateAIResponse({
              message: securityResult.sanitizedText,
              userId: effectiveUserId,
              sessionId,
              channel: "whatsapp",
              category,
              maskedTextForStorage: securityResult.sensitiveDataDetected ? securityResult.maskedTextForStorage : undefined,
            });
            await deliverWhatsApp({ token, phoneNumberId, recipientPhone: senderPhone, text: result.reply });
          }
        }
      }
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[whatsapp/webhook] Error:", err);
    return NextResponse.json({ ok: true });
  }
}

/**
 * GET /api/whatsapp/webhook
 * Meta webhook verification (hub.challenge).
 */
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);

  // Meta sends verification challenge
  const mode = searchParams.get("hub.mode");
  const verifyToken = searchParams.get("hub.verify_token");
  const challenge = searchParams.get("hub.challenge");

  if (mode === "subscribe" && verifyToken === process.env.WHATSAPP_VERIFY_TOKEN) {
    // Return the challenge value as plain text
    return new NextResponse(challenge, { status: 200, headers: { "Content-Type": "text/plain" } });
  }

  return NextResponse.json({
    status: "ok",
    channel: "whatsapp",
    configured: !!process.env.WHATSAPP_TOKEN,
    setup: [
      "1. Create Meta App at developers.facebook.com",
      "2. Add WhatsApp product, generate permanent token",
      "3. Set WHATSAPP_TOKEN, WHATSAPP_VERIFY_TOKEN, WHATSAPP_PHONE_NUMBER_ID in Vercel",
      "4. Set Webhook URL: https://mymoa.app/api/whatsapp/webhook",
      "5. Subscribe to 'messages' webhook field",
    ],
  });
}
