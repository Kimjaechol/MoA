import { NextRequest, NextResponse } from "next/server";

/**
 * POST /api/telegram/webhook
 * Telegram Bot webhook endpoint for Vercel deployment.
 *
 * Env vars needed:
 *   TELEGRAM_BOT_TOKEN      — Telegram Bot token from @BotFather
 *   TELEGRAM_WEBHOOK_SECRET — (optional) Secret for webhook verification
 *
 * Setup:
 *   1. Set TELEGRAM_BOT_TOKEN in Vercel env vars
 *   2. Call GET /api/telegram/webhook?action=register to register the webhook
 *   3. Telegram will send updates to POST /api/telegram/webhook
 *
 * Flow:
 *   Telegram message → this webhook → AI response → Telegram sendMessage
 */

const TELEGRAM_API = "https://api.telegram.org/bot";

/** Send a message via Telegram Bot API */
async function sendTelegramMessage(
  token: string,
  chatId: number | string,
  text: string,
  replyToMessageId?: number,
): Promise<boolean> {
  try {
    // Truncate very long messages (Telegram limit: 4096 chars)
    const chunks = splitMessage(text, 4000);

    for (const chunk of chunks) {
      const res = await fetch(`${TELEGRAM_API}${token}/sendMessage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chat_id: chatId,
          text: chunk,
          parse_mode: "Markdown",
          ...(replyToMessageId ? { reply_to_message_id: replyToMessageId } : {}),
        }),
      });

      if (!res.ok) {
        // Retry without Markdown if parse failed
        const errData = await res.json().catch(() => ({}));
        if (errData.description?.includes("parse")) {
          await fetch(`${TELEGRAM_API}${token}/sendMessage`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              chat_id: chatId,
              text: chunk,
              ...(replyToMessageId ? { reply_to_message_id: replyToMessageId } : {}),
            }),
          });
        }
      }
    }
    return true;
  } catch {
    return false;
  }
}

/** Send a "typing..." chat action */
async function sendTypingAction(token: string, chatId: number | string): Promise<void> {
  try {
    await fetch(`${TELEGRAM_API}${token}/sendChatAction`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, action: "typing" }),
    });
  } catch { /* non-critical */ }
}

/** Split long messages into chunks at sentence boundaries */
function splitMessage(text: string, maxLen: number): string[] {
  if (text.length <= maxLen) return [text];

  const chunks: string[] = [];
  let remaining = text;

  while (remaining.length > 0) {
    if (remaining.length <= maxLen) {
      chunks.push(remaining);
      break;
    }

    // Try to break at paragraph, then sentence, then word boundary
    let breakAt = remaining.lastIndexOf("\n\n", maxLen);
    if (breakAt < maxLen * 0.3) breakAt = remaining.lastIndexOf("\n", maxLen);
    if (breakAt < maxLen * 0.3) breakAt = remaining.lastIndexOf(". ", maxLen);
    if (breakAt < maxLen * 0.3) breakAt = remaining.lastIndexOf(" ", maxLen);
    if (breakAt < maxLen * 0.3) breakAt = maxLen;

    chunks.push(remaining.slice(0, breakAt + 1));
    remaining = remaining.slice(breakAt + 1);
  }

  return chunks;
}

/**
 * Generate AI response for a Telegram message.
 * Reuses the same AI pipeline as the web chat.
 */
async function generateTelegramResponse(
  text: string,
  userId: string,
  chatId: string,
): Promise<string> {
  try {
    // Call our own chat API internally
    const baseUrl = process.env.NEXT_PUBLIC_BASE_URL ?? process.env.VERCEL_URL
      ? `https://${process.env.VERCEL_URL}`
      : "http://localhost:3000";

    const res = await fetch(`${baseUrl}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        user_id: userId,
        session_id: `telegram_${chatId}`,
        content: text,
        channel: "telegram",
        category: detectCategory(text),
      }),
    });

    if (res.ok) {
      const data = await res.json();
      return data.reply ?? "Sorry, I couldn't process your message.";
    }
  } catch (err) {
    console.error("[telegram/webhook] AI response error:", err);
  }

  return "안녕하세요! MoA AI입니다. 현재 시스템을 준비 중입니다. 잠시 후 다시 시도해주세요.";
}

/** Simple category detection from message content */
function detectCategory(text: string): string {
  const lower = text.toLowerCase();
  if (/코드|코딩|프로그래밍|debug|bug|function|class|import|git/.test(lower)) return "coding";
  if (/문서|보고서|요약|번역|pptx|docx|pdf/.test(lower)) return "document";
  if (/이미지|그림|사진|그려|image|photo|draw/.test(lower)) return "image";
  if (/음악|노래|작곡|가사|music|song/.test(lower)) return "music";
  if (/이메일|업무|보고|회의|미팅|email|meeting|report/.test(lower)) return "work";
  if (/날씨|일정|번역|맛집|추천|weather|schedule/.test(lower)) return "daily";
  return "other";
}

/**
 * POST /api/telegram/webhook
 * Receive Telegram updates.
 */
export async function POST(request: NextRequest) {
  try {
    const token = process.env.TELEGRAM_BOT_TOKEN;
    if (!token) {
      console.error("[telegram/webhook] TELEGRAM_BOT_TOKEN not set");
      return NextResponse.json({ ok: true }); // Return 200 to avoid Telegram retries
    }

    // Verify webhook secret if configured
    const webhookSecret = process.env.TELEGRAM_WEBHOOK_SECRET;
    if (webhookSecret) {
      const secretHeader = request.headers.get("x-telegram-bot-api-secret-token");
      if (secretHeader !== webhookSecret) {
        return NextResponse.json({ ok: true }); // Silent reject
      }
    }

    const update = await request.json();

    // Handle /start command
    if (update.message?.text === "/start") {
      const chatId = update.message.chat.id;
      const firstName = update.message.from?.first_name ?? "User";
      await sendTelegramMessage(
        token,
        chatId,
        `안녕하세요 ${firstName}님! *MoA AI 에이전트*입니다. 🤖\n\n` +
        `무엇이든 물어보세요! 일상, 업무, 코딩, 문서 작성 등 다양한 분야를 도와드립니다.\n\n` +
        `*주요 명령어:*\n` +
        `/help - 도움말\n` +
        `/model - 현재 AI 모델 정보\n` +
        `/credits - 크레딧 잔액\n\n` +
        `💡 웹에서 더 많은 기능을 사용하세요: https://mymoa.app`,
      );
      return NextResponse.json({ ok: true });
    }

    // Handle /help command
    if (update.message?.text === "/help") {
      const chatId = update.message.chat.id;
      await sendTelegramMessage(
        token,
        chatId,
        `*MoA AI 도움말* 📖\n\n` +
        `MoA는 100+ 전문 스킬을 가진 AI 에이전트입니다.\n\n` +
        `*카테고리별 기능:*\n` +
        `🌤 *일상* - 날씨, 번역, 일정, 맛집\n` +
        `💼 *업무* - 이메일, 보고서, 데이터 분석\n` +
        `📄 *문서* - 요약, 작성, 변환 (DOCX/PDF/PPTX)\n` +
        `💻 *코딩* - 코드 작성, 디버깅, 리뷰\n` +
        `🎨 *이미지* - AI 생성, 편집, 분석\n` +
        `🎵 *음악* - 작곡, 가사, TTS\n\n` +
        `*설정:*\n` +
        `• 웹에서 API 키 등록 시 크레딧 50% 절감\n` +
        `• 마이페이지: https://mymoa.app/mypage\n` +
        `• 결제/크레딧: https://mymoa.app/billing`,
      );
      return NextResponse.json({ ok: true });
    }

    // Handle /credits command
    if (update.message?.text === "/credits") {
      const chatId = update.message.chat.id;
      const telegramUserId = `tg_${update.message.from?.id ?? chatId}`;

      let balanceText = "크레딧 정보를 조회할 수 없습니다.";
      try {
        const { getServiceSupabase } = await import("@/lib/supabase");
        const supabase = getServiceSupabase();
        const { data } = await supabase
          .from("moa_credits")
          .select("balance, plan, monthly_quota, monthly_used")
          .eq("user_id", telegramUserId)
          .single();
        if (data) {
          balanceText = `*크레딧 잔액:* ${data.balance.toLocaleString()}\n` +
            `*플랜:* ${data.plan}\n` +
            `*월 사용량:* ${data.monthly_used}/${data.monthly_quota}`;
        } else {
          balanceText = "*크레딧 잔액:* 100 (무료 체험)\n*플랜:* Free";
        }
      } catch { /* DB not available */ }

      await sendTelegramMessage(token, chatId, `💳 ${balanceText}\n\n충전: https://mymoa.app/billing`);
      return NextResponse.json({ ok: true });
    }

    // Handle /model command
    if (update.message?.text === "/model") {
      const chatId = update.message.chat.id;
      await sendTelegramMessage(
        token,
        chatId,
        `🤖 *현재 AI 모델 설정*\n\n` +
        `*기본 전략:* 가성비 (cost-efficient)\n` +
        `*사용 모델:* Gemini 2.5 Flash → GPT-4o-mini → Claude Haiku\n\n` +
        `자체 API 키를 등록하면 1x 크레딧으로 더 좋은 모델을 사용할 수 있습니다.\n` +
        `설정: https://mymoa.app/mypage`,
      );
      return NextResponse.json({ ok: true });
    }

    // Handle regular text messages
    const message = update.message;
    if (!message?.text) {
      // Non-text messages (photos, stickers, etc.) — acknowledge but skip
      return NextResponse.json({ ok: true });
    }

    const chatId = message.chat.id;
    const messageId = message.message_id;
    const text = message.text;
    const telegramUserId = `tg_${message.from?.id ?? chatId}`;

    // Send typing indicator
    await sendTypingAction(token, chatId);

    // In group chats, only respond when mentioned or replied to
    if (message.chat.type !== "private") {
      const botUsername = await getBotUsername(token);
      const isMentioned = text.includes(`@${botUsername}`);
      const isReplyToBot = message.reply_to_message?.from?.is_bot === true;

      if (!isMentioned && !isReplyToBot) {
        return NextResponse.json({ ok: true }); // Ignore non-targeted group messages
      }

      // Remove bot mention from text
      const cleanText = text.replace(new RegExp(`@${botUsername}`, "gi"), "").trim();
      if (!cleanText) return NextResponse.json({ ok: true });

      const reply = await generateTelegramResponse(cleanText, telegramUserId, String(chatId));
      await sendTelegramMessage(token, chatId, reply, messageId);
      return NextResponse.json({ ok: true });
    }

    // Private chat — respond to all messages
    const reply = await generateTelegramResponse(text, telegramUserId, String(chatId));
    await sendTelegramMessage(token, chatId, reply, messageId);

    // Save channel connection record (best-effort)
    try {
      const { getServiceSupabase } = await import("@/lib/supabase");
      const supabase = getServiceSupabase();
      await supabase.from("moa_channel_connections").upsert({
        user_id: telegramUserId,
        channel: "telegram",
        channel_user_id: String(message.from?.id ?? chatId),
        display_name: [message.from?.first_name, message.from?.last_name].filter(Boolean).join(" ") || "Telegram User",
        is_active: true,
        last_message_at: new Date().toISOString(),
      }, { onConflict: "user_id,channel" });
    } catch { /* non-critical */ }

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[telegram/webhook] Error:", err);
    // Always return 200 to prevent Telegram from retrying
    return NextResponse.json({ ok: true });
  }
}

/** Cache bot username to avoid repeated API calls */
let cachedBotUsername: string | null = null;

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

/**
 * GET /api/telegram/webhook?action=register
 * Register/manage the Telegram webhook.
 *
 * Actions:
 *   register — Set webhook URL with Telegram
 *   unregister — Remove webhook
 *   info — Get current webhook info
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

        return NextResponse.json({
          success: data.ok,
          webhook_url: webhookUrl,
          description: data.description,
        });
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

        return NextResponse.json({
          bot: meData.result,
          webhook: webhookData.result,
        });
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
