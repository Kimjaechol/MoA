/**
 * Telegram Bot Webhook Handler for MoA
 *
 * Receives messages from Telegram Bot API webhook and processes them
 * through the unified MoA message pipeline.
 *
 * Setup:
 * 1. Create bot via @BotFather on Telegram
 * 2. Set TELEGRAM_BOT_TOKEN env var
 * 3. Register webhook: POST https://api.telegram.org/bot<TOKEN>/setWebhook
 *    body: { "url": "https://moa.lawith.kr/telegram/webhook" }
 *
 * Environment:
 * - TELEGRAM_BOT_TOKEN — Bot token from @BotFather (required)
 */

import type { IncomingMessage, ServerResponse } from "node:http";
import type { MoAMessageHandler, MoAMessageResult, ChannelContext } from "./types.js";

// ============================================
// Telegram API Types (minimal)
// ============================================

interface TelegramUpdate {
  update_id: number;
  message?: TelegramMessage;
  callback_query?: {
    id: string;
    from: TelegramUser;
    message?: TelegramMessage;
    data?: string;
  };
}

interface TelegramMessage {
  message_id: number;
  from?: TelegramUser;
  chat: TelegramChat;
  date: number;
  text?: string;
  // Media types for future use
  photo?: unknown[];
  document?: unknown;
  voice?: unknown;
}

interface TelegramUser {
  id: number;
  is_bot: boolean;
  first_name: string;
  last_name?: string;
  username?: string;
  language_code?: string;
}

interface TelegramChat {
  id: number;
  type: "private" | "group" | "supergroup" | "channel";
  title?: string;
  first_name?: string;
  last_name?: string;
  username?: string;
}

// ============================================
// Telegram API Client
// ============================================

const TELEGRAM_API = "https://api.telegram.org";

function getBotToken(): string | null {
  return process.env.TELEGRAM_BOT_TOKEN ?? null;
}

async function telegramApiCall(
  method: string,
  body: Record<string, unknown>,
): Promise<{ ok: boolean; result?: unknown; description?: string }> {
  const token = getBotToken();
  if (!token) throw new Error("TELEGRAM_BOT_TOKEN not set");

  const response = await fetch(`${TELEGRAM_API}/bot${token}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(10000),
  });

  return response.json() as Promise<{ ok: boolean; result?: unknown; description?: string }>;
}

/**
 * Send a text message to a Telegram chat.
 * Supports Markdown formatting and inline keyboard buttons.
 */
async function sendMessage(
  chatId: number,
  text: string,
  options?: {
    replyMarkup?: unknown;
    parseMode?: "Markdown" | "MarkdownV2" | "HTML";
  },
): Promise<void> {
  // Telegram message limit is 4096 chars
  const truncated = text.length > 4000 ? text.slice(0, 3997) + "..." : text;

  const body: Record<string, unknown> = {
    chat_id: chatId,
    text: truncated,
  };

  if (options?.parseMode) {
    body.parse_mode = options.parseMode;
  }
  if (options?.replyMarkup) {
    body.reply_markup = options.replyMarkup;
  }

  const result = await telegramApiCall("sendMessage", body);
  if (!result.ok) {
    // Retry without parse_mode if formatting fails
    if (options?.parseMode) {
      await telegramApiCall("sendMessage", {
        chat_id: chatId,
        text: truncated,
      });
    } else {
      console.error(`[Telegram] sendMessage failed: ${result.description}`);
    }
  }
}

/**
 * Send "typing..." indicator
 */
async function sendTypingAction(chatId: number): Promise<void> {
  await telegramApiCall("sendChatAction", {
    chat_id: chatId,
    action: "typing",
  }).catch(() => {});
}

// ============================================
// Keyboard Builders
// ============================================

/**
 * Build Telegram inline keyboard from MoA buttons
 */
function buildInlineKeyboard(
  buttons?: Array<{ label: string; url: string }>,
): unknown | undefined {
  if (!buttons?.length) return undefined;

  return {
    inline_keyboard: buttons.map((btn) => [
      { text: btn.label, url: btn.url },
    ]),
  };
}

/**
 * Build Telegram reply keyboard from MoA quick replies
 */
function buildReplyKeyboard(
  quickReplies?: string[],
): unknown | undefined {
  if (!quickReplies?.length) return undefined;

  // Arrange in rows of 2-3 buttons
  const rows: Array<Array<{ text: string }>> = [];
  for (let i = 0; i < quickReplies.length; i += 3) {
    rows.push(
      quickReplies.slice(i, i + 3).map((text) => ({ text })),
    );
  }

  return {
    keyboard: rows,
    resize_keyboard: true,
    one_time_keyboard: true,
  };
}

// ============================================
// Webhook Setup Helper
// ============================================

/**
 * Register/update the Telegram webhook URL.
 * Call this once during server startup.
 */
export async function registerTelegramWebhook(webhookUrl: string): Promise<boolean> {
  const token = getBotToken();
  if (!token) {
    console.log("[Telegram] No TELEGRAM_BOT_TOKEN set, skipping webhook registration");
    return false;
  }

  try {
    const result = await telegramApiCall("setWebhook", {
      url: webhookUrl,
      allowed_updates: ["message", "callback_query"],
      drop_pending_updates: false,
    });

    if (result.ok) {
      console.log(`[Telegram] Webhook registered: ${webhookUrl}`);
      return true;
    }
    console.error(`[Telegram] Webhook registration failed: ${result.description}`);
    return false;
  } catch (err) {
    console.error("[Telegram] Webhook registration error:", err);
    return false;
  }
}

/**
 * Get bot info for display
 */
export async function getTelegramBotInfo(): Promise<{ username: string; name: string } | null> {
  const token = getBotToken();
  if (!token) return null;

  try {
    const result = await telegramApiCall("getMe", {});
    if (result.ok) {
      const bot = result.result as { username?: string; first_name?: string };
      return {
        username: bot.username ?? "unknown",
        name: bot.first_name ?? "MoA Bot",
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
 * Handle incoming Telegram webhook requests.
 * Routes: POST /telegram/webhook
 *
 * @param onMessage - Unified MoA message handler
 * @param logger - Logger instance
 * @returns true if request was handled
 */
export function handleTelegramRequest(
  req: IncomingMessage,
  res: ServerResponse,
  onMessage: MoAMessageHandler,
  logger: { info: (msg: string) => void; error: (msg: string) => void },
): boolean {
  const url = req.url?.split("?")[0] ?? "";

  if (url !== "/telegram/webhook" || req.method !== "POST") {
    return false;
  }

  // Must have bot token configured
  if (!getBotToken()) {
    res.writeHead(200);
    res.end(JSON.stringify({ ok: true }));
    return true;
  }

  // Read body and process asynchronously
  let body = "";
  req.on("data", (chunk: Buffer) => {
    body += chunk.toString();
  });
  req.on("end", () => {
    // Respond 200 immediately (Telegram requires fast response)
    res.writeHead(200);
    res.end(JSON.stringify({ ok: true }));

    // Process message asynchronously
    processTelegramUpdate(body, onMessage, logger).catch((err) => {
      logger.error(`[Telegram] Update processing error: ${err}`);
    });
  });

  return true;
}

/**
 * Process a single Telegram update
 */
async function processTelegramUpdate(
  rawBody: string,
  onMessage: MoAMessageHandler,
  logger: { info: (msg: string) => void; error: (msg: string) => void },
): Promise<void> {
  let update: TelegramUpdate;
  try {
    update = JSON.parse(rawBody) as TelegramUpdate;
  } catch {
    logger.error("[Telegram] Failed to parse update body");
    return;
  }

  // Handle callback queries (button clicks)
  if (update.callback_query) {
    const cb = update.callback_query;
    const chatId = cb.message?.chat.id;
    const text = cb.data;

    // Acknowledge the callback
    await telegramApiCall("answerCallbackQuery", { callback_query_id: cb.id }).catch(() => {});

    if (chatId && text) {
      await handleTextMessage(chatId, cb.from, text, onMessage, logger);
    }
    return;
  }

  // Handle text messages
  const message = update.message;
  if (!message?.text || !message.from) {
    return;
  }

  // Skip messages from bots
  if (message.from.is_bot) {
    return;
  }

  // Only handle private chats and group mentions for now
  if (message.chat.type !== "private") {
    // In groups, only respond to /moa commands or @mentions
    const text = message.text.toLowerCase();
    if (!text.startsWith("/moa") && !text.includes("@moa")) {
      return;
    }
  }

  await handleTextMessage(
    message.chat.id,
    message.from,
    message.text,
    onMessage,
    logger,
  );
}

/**
 * Handle a text message from Telegram
 */
async function handleTextMessage(
  chatId: number,
  from: TelegramUser,
  text: string,
  onMessage: MoAMessageHandler,
  logger: { info: (msg: string) => void; error: (msg: string) => void },
): Promise<void> {
  const displayName =
    [from.first_name, from.last_name].filter(Boolean).join(" ") ||
    from.username ||
    String(from.id);

  logger.info(`[Telegram] Message from ${displayName}: ${text.slice(0, 100)}`);

  // Show typing indicator
  await sendTypingAction(chatId);

  // Strip Telegram bot commands prefix
  let cleanText = text;
  if (cleanText.startsWith("/start")) {
    cleanText = "안녕";
  } else if (cleanText.startsWith("/help")) {
    cleanText = "도움말";
  } else if (cleanText.startsWith("/install")) {
    cleanText = "설치";
  } else if (cleanText.startsWith("/register")) {
    cleanText = "이 기기등록";
  } else if (cleanText.startsWith("/moa ")) {
    cleanText = cleanText.slice(5);
  } else if (cleanText.startsWith("/moa")) {
    cleanText = "안녕";
  }

  const channel: ChannelContext = {
    channelId: "telegram",
    channelName: "Telegram",
    userId: `tg_${from.id}`,
    userName: displayName,
    chatId: String(chatId),
    maxMessageLength: 4000,
  };

  try {
    const result = await onMessage({
      userId: channel.userId,
      userType: "telegram",
      text: cleanText,
      botId: "moa-telegram",
      blockId: "",
      timestamp: Date.now(),
      channel,
    });

    // Build reply markup (prefer inline keyboard for URLs, reply keyboard for quick replies)
    const inlineKb = buildInlineKeyboard(result.buttons);
    const replyKb = buildReplyKeyboard(result.quickReplies);

    await sendMessage(chatId, result.text, {
      replyMarkup: inlineKb ?? replyKb,
    });
  } catch (err) {
    logger.error(`[Telegram] Message handling error: ${err}`);
    await sendMessage(chatId, "죄송합니다, 메시지 처리 중 오류가 발생했습니다. 잠시 후 다시 시도해주세요.");
  }
}

/**
 * Check if Telegram is configured
 */
export function isTelegramConfigured(): boolean {
  return !!getBotToken();
}
