/**
 * POST /api/worker
 * Async worker endpoint — processes queued tasks from QStash.
 *
 * Optimization 2: Webhook enqueues work → QStash calls this → LLM + delivery.
 * This runs on Node.js runtime (needs node:crypto for key decryption).
 *
 * Authentication: x-worker-secret header must match WORKER_SECRET env var.
 * QStash also provides its own signature verification.
 *
 * Env vars:
 *   WORKER_SECRET — shared secret for authenticating QStash → worker calls
 */

// Optimization 3: Run in Seoul region for Korean users
export const preferredRegion = "icn1";

import { NextRequest, NextResponse } from "next/server";
import { generateAIResponse } from "@/lib/ai-engine";
import {
  deliverTelegram,
  deliverDiscordFollowup,
  deliverSlack,
  deliverLinePush,
  deliverWhatsApp,
} from "@/lib/channel-delivery";
import type { QueuedTask } from "@/lib/async-queue";

export async function POST(request: NextRequest) {
  try {
    // Authenticate: verify worker secret
    const workerSecret = process.env.WORKER_SECRET;
    if (workerSecret) {
      const provided = request.headers.get("x-worker-secret");
      if (provided !== workerSecret) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
      }
    }

    const task: QueuedTask = await request.json();
    const { channel, message, maskedTextForStorage, userId, sessionId, category, delivery } = task;

    // Generate AI response (direct call — no internal HTTP)
    const result = await generateAIResponse({
      message,
      userId,
      sessionId,
      channel,
      category,
      maskedTextForStorage,
    });

    // Deliver response to the correct platform
    switch (channel) {
      case "telegram": {
        const token = process.env.TELEGRAM_BOT_TOKEN;
        if (token) {
          await deliverTelegram({
            token,
            chatId: delivery.chatId as number,
            text: result.reply,
            replyToMessageId: delivery.messageId as number | undefined,
          });
        }
        break;
      }

      case "discord": {
        const appId = process.env.DISCORD_APPLICATION_ID;
        if (appId && delivery.interactionToken) {
          await deliverDiscordFollowup({
            appId,
            interactionToken: delivery.interactionToken as string,
            text: result.reply,
          });
        }
        break;
      }

      case "slack": {
        const token = process.env.SLACK_BOT_TOKEN;
        if (token) {
          await deliverSlack({
            token,
            channelId: delivery.channelId as string,
            text: result.reply,
            threadTs: delivery.threadTs as string | undefined,
          });
        }
        break;
      }

      case "line": {
        const token = process.env.LINE_CHANNEL_ACCESS_TOKEN;
        if (token) {
          // Use push message (replyToken has expired by now in async mode)
          await deliverLinePush({
            token,
            userId: delivery.lineUserId as string,
            text: result.reply,
          });
        }
        break;
      }

      case "whatsapp": {
        const token = process.env.WHATSAPP_TOKEN;
        const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;
        if (token && phoneNumberId) {
          await deliverWhatsApp({
            token,
            phoneNumberId,
            recipientPhone: delivery.recipientPhone as string,
            text: result.reply,
          });
        }
        break;
      }

      case "kakao":
        // KakaoTalk runs on a separate server (extensions/kakao),
        // but handle gracefully if a task is queued with this channel
        console.info(`[worker] KakaoTalk messages are handled by the kakao extension server`);
        break;

      default:
        console.warn(`[worker] Unknown channel: ${channel}`);
    }

    return NextResponse.json({ ok: true, model: result.model });
  } catch (err) {
    console.error("[worker] Error:", err);
    return NextResponse.json({ error: "Worker processing failed" }, { status: 500 });
  }
}
