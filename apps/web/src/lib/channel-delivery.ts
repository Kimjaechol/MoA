/**
 * Channel Delivery — Send AI responses back to messaging platforms.
 *
 * Shared by /api/worker (async mode) and webhook handlers (sync fallback).
 * Each function sends the response via the platform's HTTP API.
 */

// ────────────────────────────────────────────
// Message Splitting (shared across channels)
// ────────────────────────────────────────────

export function splitMessage(text: string, maxLen: number): string[] {
  if (text.length <= maxLen) return [text];

  const chunks: string[] = [];
  let remaining = text;

  while (remaining.length > 0) {
    if (remaining.length <= maxLen) {
      chunks.push(remaining);
      break;
    }
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

// ────────────────────────────────────────────
// Telegram
// ────────────────────────────────────────────

const TELEGRAM_API = "https://api.telegram.org/bot";

export async function deliverTelegram(params: {
  token: string;
  chatId: number | string;
  text: string;
  replyToMessageId?: number;
}): Promise<boolean> {
  try {
    const chunks = splitMessage(params.text, 4000);
    for (const chunk of chunks) {
      const res = await fetch(`${TELEGRAM_API}${params.token}/sendMessage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chat_id: params.chatId,
          text: chunk,
          parse_mode: "Markdown",
          ...(params.replyToMessageId ? { reply_to_message_id: params.replyToMessageId } : {}),
        }),
      });
      if (!res.ok) {
        // Retry without Markdown if parse failed
        const errData = await res.json().catch(() => ({}));
        if (errData.description?.includes("parse")) {
          await fetch(`${TELEGRAM_API}${params.token}/sendMessage`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              chat_id: params.chatId,
              text: chunk,
              ...(params.replyToMessageId ? { reply_to_message_id: params.replyToMessageId } : {}),
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

export async function sendTelegramTyping(token: string, chatId: number | string): Promise<void> {
  try {
    await fetch(`${TELEGRAM_API}${token}/sendChatAction`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, action: "typing" }),
    });
  } catch { /* non-critical */ }
}

// ────────────────────────────────────────────
// Discord
// ────────────────────────────────────────────

const DISCORD_API = "https://discord.com/api/v10";

export async function deliverDiscordFollowup(params: {
  appId: string;
  interactionToken: string;
  text: string;
}): Promise<boolean> {
  try {
    const chunks = splitMessage(params.text, 2000);
    // Edit original deferred message
    await fetch(`${DISCORD_API}/webhooks/${params.appId}/${params.interactionToken}/messages/@original`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: chunks[0] }),
    });
    // Send additional chunks as followup
    for (let i = 1; i < chunks.length; i++) {
      await fetch(`${DISCORD_API}/webhooks/${params.appId}/${params.interactionToken}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: chunks[i] }),
      });
    }
    return true;
  } catch {
    return false;
  }
}

export async function deliverDiscordChannel(params: {
  token: string;
  channelId: string;
  text: string;
}): Promise<boolean> {
  try {
    const chunks = splitMessage(params.text, 2000);
    for (const chunk of chunks) {
      await fetch(`${DISCORD_API}/channels/${params.channelId}/messages`, {
        method: "POST",
        headers: { Authorization: `Bot ${params.token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ content: chunk }),
      });
    }
    return true;
  } catch {
    return false;
  }
}

// ────────────────────────────────────────────
// Slack
// ────────────────────────────────────────────

export async function deliverSlack(params: {
  token: string;
  channelId: string;
  text: string;
  threadTs?: string;
}): Promise<boolean> {
  try {
    const chunks = splitMessage(params.text, 3000);
    for (const chunk of chunks) {
      const res = await fetch("https://slack.com/api/chat.postMessage", {
        method: "POST",
        headers: { Authorization: `Bearer ${params.token}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          channel: params.channelId,
          text: chunk,
          ...(params.threadTs ? { thread_ts: params.threadTs } : {}),
        }),
      });
      if (!res.ok) return false;
      // Slack returns 200 even on errors — check the JSON body
      const data = await res.json().catch(() => ({ ok: false }));
      if (!data.ok) return false;
    }
    return true;
  } catch {
    return false;
  }
}

// ────────────────────────────────────────────
// LINE
// ────────────────────────────────────────────

export async function deliverLine(params: {
  token: string;
  replyToken: string;
  text: string;
}): Promise<boolean> {
  try {
    const chunks = splitMessage(params.text, 5000);
    // LINE reply API accepts up to 5 messages
    const messages = chunks.slice(0, 5).map(chunk => ({ type: "text" as const, text: chunk }));

    const res = await fetch("https://api.line.me/v2/bot/message/reply", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${params.token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ replyToken: params.replyToken, messages }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

/** LINE push message (for async delivery when replyToken expired) */
export async function deliverLinePush(params: {
  token: string;
  userId: string;
  text: string;
}): Promise<boolean> {
  try {
    const chunks = splitMessage(params.text, 5000);
    const messages = chunks.slice(0, 5).map(chunk => ({ type: "text" as const, text: chunk }));

    const res = await fetch("https://api.line.me/v2/bot/message/push", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${params.token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ to: params.userId, messages }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

// ────────────────────────────────────────────
// WhatsApp (Meta Cloud API)
// ────────────────────────────────────────────

export async function deliverWhatsApp(params: {
  token: string;
  phoneNumberId: string;
  recipientPhone: string;
  text: string;
}): Promise<boolean> {
  try {
    const chunks = splitMessage(params.text, 4096);
    for (const chunk of chunks) {
      const res = await fetch(
        `https://graph.facebook.com/v21.0/${params.phoneNumberId}/messages`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${params.token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            messaging_product: "whatsapp",
            to: params.recipientPhone,
            type: "text",
            text: { body: chunk },
          }),
        },
      );
      if (!res.ok) return false;
    }
    return true;
  } catch {
    return false;
  }
}
