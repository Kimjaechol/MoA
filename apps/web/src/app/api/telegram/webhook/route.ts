import { NextRequest, NextResponse } from "next/server";
import { runSecurityChecks } from "@/lib/security";
import { resolveChannelUser, getUserCredits, makeSessionId } from "@/lib/channel-user-resolver";
import { generateAIResponse, detectCategory } from "@/lib/ai-engine";
import { enqueueTask, isQueueAvailable } from "@/lib/async-queue";
import { deliverTelegram, sendTelegramTyping, splitMessage } from "@/lib/channel-delivery";

/**
 * POST /api/telegram/webhook
 * Telegram Bot webhook endpoint — optimized architecture.
 *
 * With QStash: returns 200 instantly, processes via /api/worker (Opt 2)
 * Without QStash: calls ai-engine directly (Opt 1 — no internal HTTP)
 *
 * Security layers:
 *   1. Webhook secret verification (Telegram-provided)
 *   2. Rate limiting per user (three-strike system)
 *   3. Input validation & injection detection
 *   4. Sensitive data masking for stored messages
 *   5. Unified user resolution (cross-channel identity)
 */

// Optimization 3: Run in Seoul region for Korean users (lowest latency)
export const preferredRegion = "icn1";

const TELEGRAM_API = "https://api.telegram.org/bot";

/** Cache bot username to avoid repeated API calls */
let cachedBotUsername = "";

async function getBotUsername(token: string): Promise<string> {
  if (cachedBotUsername) return cachedBotUsername;
  try {
    const res = await fetch(`${TELEGRAM_API}${token}/getMe`);
    if (res.ok) {
      const data = await res.json();
      cachedBotUsername = data.result?.username ?? "moa_ai_bot";
      return cachedBotUsername;
    }
  } catch { /* fall through */ }
  return "moa_ai_bot";
}

/** Process message: either enqueue (async) or handle directly (sync) */
async function processMessage(params: {
  token: string;
  chatId: number;
  messageId: number;
  text: string;
  effectiveUserId: string;
  sessionId: string;
  maskedText?: string;
}): Promise<void> {
  const { token, chatId, messageId, text, effectiveUserId, sessionId, maskedText } = params;
  const category = detectCategory(text);

  // Try async path first (Optimization 2)
  if (isQueueAvailable()) {
    await enqueueTask({
      channel: "telegram",
      message: text,
      maskedTextForStorage: maskedText,
      userId: effectiveUserId,
      sessionId,
      category,
      delivery: { chatId, messageId },
    });
    return; // Webhook returns 200 immediately
  }

  // Sync fallback: call ai-engine directly (Optimization 1 — no internal HTTP)
  await sendTelegramTyping(token, chatId);
  const result = await generateAIResponse({
    message: text,
    userId: effectiveUserId,
    sessionId,
    channel: "telegram",
    category,
    maskedTextForStorage: maskedText,
  });
  await deliverTelegram({ token, chatId, text: result.reply, replyToMessageId: messageId });
}

export async function POST(request: NextRequest) {
  try {
    const token = process.env.TELEGRAM_BOT_TOKEN;
    if (!token) {
      return NextResponse.json({ ok: true });
    }

    // Verify webhook secret
    const webhookSecret = process.env.TELEGRAM_WEBHOOK_SECRET;
    if (webhookSecret) {
      const secretHeader = request.headers.get("x-telegram-bot-api-secret-token");
      if (secretHeader !== webhookSecret) {
        return NextResponse.json({ ok: true });
      }
    }

    const update = await request.json();

    // Handle /start command
    if (update.message?.text === "/start") {
      const chatId = update.message.chat.id;
      const firstName = update.message.from?.first_name ?? "User";
      await deliverTelegram({
        token, chatId,
        text: `안녕하세요 ${firstName}님! *MoA AI 에이전트*입니다.\n\n` +
          `무엇이든 물어보세요! 일상, 업무, 코딩, 문서 작성 등 다양한 분야를 도와드립니다.\n\n` +
          `*주요 명령어:*\n/help - 도움말\n/model - AI 모델 정보\n/credits - 크레딧 잔액\n\n` +
          `웹에서 더 많은 기능: https://mymoa.app`,
      });
      return NextResponse.json({ ok: true });
    }

    // Handle /help command
    if (update.message?.text === "/help") {
      const chatId = update.message.chat.id;
      await deliverTelegram({
        token, chatId,
        text: `*MoA AI 도움말*\n\n` +
          `*카테고리별 기능:*\n` +
          `일상 - 날씨, 번역, 일정, 맛집\n` +
          `업무 - 이메일, 보고서, 데이터 분석\n` +
          `문서 - 요약, 작성, 변환\n` +
          `코딩 - 코드 작성, 디버깅, 리뷰\n` +
          `이미지 - AI 생성, 편집, 분석\n` +
          `음악 - 작곡, 가사, TTS\n\n` +
          `설정: https://mymoa.app/mypage\n결제: https://mymoa.app/billing`,
      });
      return NextResponse.json({ ok: true });
    }

    // Handle /credits command
    if (update.message?.text === "/credits") {
      const chatId = update.message.chat.id;
      const rawTgId = String(update.message.from?.id ?? chatId);
      const resolvedUser = await resolveChannelUser({
        channel: "telegram",
        channelUserId: rawTgId,
        displayName: [update.message.from?.first_name, update.message.from?.last_name].filter(Boolean).join(" ") || undefined,
      });
      const credits = await getUserCredits(resolvedUser.effectiveUserId);
      const linkedStatus = resolvedUser.isLinked ? "계정 연동됨" : "미연동 (mymoa.app에서 연동)";
      await deliverTelegram({
        token, chatId,
        text: `*크레딧 잔액:* ${credits.balance.toLocaleString()}\n*플랜:* ${credits.plan}\n*월 사용량:* ${credits.monthlyUsed}/${credits.monthlyQuota}\n*계정:* ${linkedStatus}\n\n충전: https://mymoa.app/billing`,
      });
      return NextResponse.json({ ok: true });
    }

    // Handle /model command
    if (update.message?.text === "/model") {
      const chatId = update.message.chat.id;
      const rawTgId = String(update.message.from?.id ?? chatId);
      const resolvedUser = await resolveChannelUser({ channel: "telegram", channelUserId: rawTgId });
      let modelInfo = `*기본 전략:* 가성비\n*사용 모델:* Gemini 2.5 Flash`;
      try {
        const { getUserLLMSettings } = await import("@/lib/channel-user-resolver");
        const settings = await getUserLLMSettings(resolvedUser.effectiveUserId);
        const strategyLabel = settings.modelStrategy === "max-performance" ? "최고성능" : "가성비";
        const keyStatus = settings.hasOwnApiKeys ? `등록됨 (${settings.activeProviders.join(", ")})` : "미등록";
        modelInfo = `*현재 전략:* ${strategyLabel}\n*API 키:* ${keyStatus}`;
      } catch { /* settings not available */ }
      await deliverTelegram({
        token, chatId,
        text: `*현재 AI 모델 설정*\n\n${modelInfo}\n\n설정: https://mymoa.app/mypage`,
      });
      return NextResponse.json({ ok: true });
    }

    // Handle regular text messages
    const message = update.message;
    if (!message?.text) {
      return NextResponse.json({ ok: true });
    }

    const chatId = message.chat.id;
    const messageId = message.message_id;
    const text = message.text;
    const rawTgId = String(message.from?.id ?? chatId);
    const displayName = [message.from?.first_name, message.from?.last_name].filter(Boolean).join(" ") || "Telegram User";

    // Resolve unified user identity
    const resolvedUser = await resolveChannelUser({ channel: "telegram", channelUserId: rawTgId, displayName });
    const effectiveUserId = resolvedUser.effectiveUserId;
    const sessionId = makeSessionId("telegram", rawTgId);

    // Security checks
    const securityResult = await runSecurityChecks({ channel: "telegram", userId: effectiveUserId, messageText: text });
    if (!securityResult.proceed) {
      await deliverTelegram({ token, chatId, text: securityResult.userResponse ?? "잠시 후 다시 시도해주세요.", replyToMessageId: messageId });
      return NextResponse.json({ ok: true });
    }

    // Group chat: only respond when mentioned or replied to
    if (message.chat.type !== "private") {
      const botUsername = await getBotUsername(token);
      const isMentioned = text.includes(`@${botUsername}`);
      const isReplyToBot = message.reply_to_message?.from?.is_bot === true;
      if (!isMentioned && !isReplyToBot) {
        return NextResponse.json({ ok: true });
      }
      const cleanText = text.replace(new RegExp(`@${botUsername}`, "gi"), "").trim();
      if (!cleanText) return NextResponse.json({ ok: true });

      await processMessage({
        token, chatId, messageId, text: cleanText, effectiveUserId, sessionId,
        maskedText: securityResult.sensitiveDataDetected ? securityResult.maskedTextForStorage : undefined,
      });
      return NextResponse.json({ ok: true });
    }

    // Private chat
    await processMessage({
      token, chatId, messageId, text: securityResult.sanitizedText, effectiveUserId, sessionId,
      maskedText: securityResult.sensitiveDataDetected ? securityResult.maskedTextForStorage : undefined,
    });

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[telegram/webhook] Error:", err);
    return NextResponse.json({ ok: true });
  }
}

/**
 * GET /api/telegram/webhook?action=register|unregister|info
 * Register/manage the Telegram webhook.
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const action = searchParams.get("action");
    const token = process.env.TELEGRAM_BOT_TOKEN;

    if (!token) {
      return NextResponse.json({ error: "TELEGRAM_BOT_TOKEN not configured" }, { status: 503 });
    }

    switch (action) {
      case "register": {
        const baseUrl = process.env.NEXT_PUBLIC_BASE_URL
          ?? (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : null);
        if (!baseUrl) {
          return NextResponse.json({ error: "NEXT_PUBLIC_BASE_URL not set" }, { status: 400 });
        }
        const webhookUrl = `${baseUrl}/api/telegram/webhook`;
        const secret = process.env.TELEGRAM_WEBHOOK_SECRET;
        const params: Record<string, unknown> = {
          url: webhookUrl,
          allowed_updates: ["message", "edited_message", "callback_query"],
          drop_pending_updates: true,
        };
        if (secret) params.secret_token = secret;

        const res = await fetch(`${TELEGRAM_API}${token}/setWebhook`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(params),
        });
        const data = await res.json();
        return NextResponse.json({ success: data.ok, webhook_url: webhookUrl, description: data.description });
      }

      case "unregister": {
        const res = await fetch(`${TELEGRAM_API}${token}/deleteWebhook`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ drop_pending_updates: true }),
        });
        const data = await res.json();
        return NextResponse.json({ success: data.ok, description: data.description });
      }

      case "info": {
        const [webhookRes, meRes] = await Promise.all([
          fetch(`${TELEGRAM_API}${token}/getWebhookInfo`),
          fetch(`${TELEGRAM_API}${token}/getMe`),
        ]);
        const webhookData = await webhookRes.json();
        const meData = await meRes.json();
        return NextResponse.json({ bot: meData.result, webhook: webhookData.result });
      }

      default:
        return NextResponse.json({
          usage: {
            register: "GET /api/telegram/webhook?action=register",
            unregister: "GET /api/telegram/webhook?action=unregister",
            info: "GET /api/telegram/webhook?action=info",
          },
        });
    }
  } catch {
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
