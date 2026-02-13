import { NextRequest, NextResponse } from "next/server";

/**
 * Discord Bot Integration for Vercel (Serverless)
 *
 * Discord bots on serverless need a different approach than WebSocket-based bots.
 * We use two mechanisms:
 *   1. Interactions Endpoint — slash commands (/ask, /help, /credits)
 *   2. Message polling via Discord REST API — for DM responses
 *
 * Env vars needed:
 *   DISCORD_BOT_TOKEN         — Bot token from Discord Developer Portal
 *   DISCORD_APPLICATION_ID    — Application ID from Developer Portal
 *   DISCORD_PUBLIC_KEY        — Public key for interaction verification
 *
 * Setup flow:
 *   1. Set env vars in Vercel
 *   2. GET /api/discord/webhook?action=register — registers slash commands
 *   3. Set Interactions Endpoint URL in Discord Developer Portal:
 *      https://mymoa.app/api/discord/webhook
 *   4. Bot responds to slash commands and DMs
 */

const DISCORD_API = "https://discord.com/api/v10";

/** Verify Discord interaction signature (Ed25519) */
async function verifyDiscordSignature(
  body: string,
  signature: string,
  timestamp: string,
  publicKey: string,
): Promise<boolean> {
  try {
    const encoder = new TextEncoder();
    const keyData = hexToUint8Array(publicKey);
    const key = await crypto.subtle.importKey(
      "raw",
      keyData,
      { name: "Ed25519" },
      false,
      ["verify"],
    );

    const message = encoder.encode(timestamp + body);
    const sig = hexToUint8Array(signature);

    return await crypto.subtle.verify("Ed25519", key, sig, message);
  } catch {
    return false;
  }
}

function hexToUint8Array(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.substring(i, i + 2), 16);
  }
  return bytes;
}

/** Send a message to a Discord channel */
async function sendDiscordMessage(
  token: string,
  channelId: string,
  content: string,
): Promise<boolean> {
  try {
    const chunks = splitMessage(content, 2000);
    for (const chunk of chunks) {
      await fetch(`${DISCORD_API}/channels/${channelId}/messages`, {
        method: "POST",
        headers: {
          Authorization: `Bot ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ content: chunk }),
      });
    }
    return true;
  } catch {
    return false;
  }
}

/** Trigger typing indicator in a channel */
async function triggerTyping(token: string, channelId: string): Promise<void> {
  try {
    await fetch(`${DISCORD_API}/channels/${channelId}/typing`, {
      method: "POST",
      headers: { Authorization: `Bot ${token}` },
    });
  } catch { /* non-critical */ }
}

/** Split long messages for Discord (2000 char limit) */
function splitMessage(text: string, maxLen: number): string[] {
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

/** Generate AI response via our chat API */
async function generateDiscordResponse(text: string, userId: string, channelId: string): Promise<string> {
  try {
    const baseUrl = process.env.NEXT_PUBLIC_BASE_URL
      ?? (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "http://localhost:3000");

    const res = await fetch(`${baseUrl}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        user_id: userId,
        session_id: `discord_${channelId}`,
        content: text,
        channel: "discord",
        category: detectCategory(text),
      }),
    });

    if (res.ok) {
      const data = await res.json();
      return data.reply ?? "I couldn't process your message.";
    }
  } catch (err) {
    console.error("[discord/webhook] AI response error:", err);
  }

  return "Hi! I'm MoA AI. The system is currently starting up. Please try again shortly.";
}

/** Simple category detection */
function detectCategory(text: string): string {
  const lower = text.toLowerCase();
  if (/코드|코딩|code|debug|function|class|import|git/.test(lower)) return "coding";
  if (/문서|보고서|요약|번역|pptx|docx|pdf|document|report/.test(lower)) return "document";
  if (/이미지|그림|사진|image|photo|draw/.test(lower)) return "image";
  if (/음악|노래|music|song/.test(lower)) return "music";
  if (/이메일|업무|email|meeting|report/.test(lower)) return "work";
  if (/날씨|일정|weather|schedule/.test(lower)) return "daily";
  return "other";
}

// Discord Interaction Types
const INTERACTION_TYPE = {
  PING: 1,
  APPLICATION_COMMAND: 2,
  MESSAGE_COMPONENT: 3,
} as const;

// Discord Interaction Response Types
const INTERACTION_CALLBACK = {
  PONG: 1,
  CHANNEL_MESSAGE_WITH_SOURCE: 4,
  DEFERRED_CHANNEL_MESSAGE_WITH_SOURCE: 5,
} as const;

/**
 * POST /api/discord/webhook
 * Discord Interactions Endpoint — handles slash commands and message interactions.
 */
export async function POST(request: NextRequest) {
  try {
    const rawBody = await request.text();
    const signature = request.headers.get("x-signature-ed25519") ?? "";
    const timestamp = request.headers.get("x-signature-timestamp") ?? "";
    const publicKey = process.env.DISCORD_PUBLIC_KEY;

    // Verify signature (required by Discord)
    if (publicKey) {
      const isValid = await verifyDiscordSignature(rawBody, signature, timestamp, publicKey);
      if (!isValid) {
        return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
      }
    }

    const interaction = JSON.parse(rawBody);

    // Handle PING (Discord verification handshake)
    if (interaction.type === INTERACTION_TYPE.PING) {
      return NextResponse.json({ type: INTERACTION_CALLBACK.PONG });
    }

    // Handle Application Commands (slash commands)
    if (interaction.type === INTERACTION_TYPE.APPLICATION_COMMAND) {
      const commandName = interaction.data?.name;
      const userId = `discord_${interaction.member?.user?.id ?? interaction.user?.id}`;
      const channelId = interaction.channel_id;
      const token = process.env.DISCORD_BOT_TOKEN;

      switch (commandName) {
        case "ask": {
          const question = interaction.data?.options?.[0]?.value ?? "";
          if (!question) {
            return NextResponse.json({
              type: INTERACTION_CALLBACK.CHANNEL_MESSAGE_WITH_SOURCE,
              data: { content: "Please provide a question. Usage: `/ask your question here`" },
            });
          }

          // Respond with deferred message (shows "Bot is thinking...")
          // Then follow up with the actual response
          const deferResponse = NextResponse.json({
            type: INTERACTION_CALLBACK.DEFERRED_CHANNEL_MESSAGE_WITH_SOURCE,
          });

          // Process in background via followup
          if (token) {
            const appId = process.env.DISCORD_APPLICATION_ID;
            const interactionToken = interaction.token;

            // Use edge runtime or background processing
            generateDiscordResponse(question, userId, channelId).then(async (reply) => {
              try {
                const chunks = splitMessage(reply, 2000);
                // Edit the deferred response with first chunk
                await fetch(`${DISCORD_API}/webhooks/${appId}/${interactionToken}/messages/@original`, {
                  method: "PATCH",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ content: chunks[0] }),
                });
                // Send additional chunks as followups
                for (let i = 1; i < chunks.length; i++) {
                  await fetch(`${DISCORD_API}/webhooks/${appId}/${interactionToken}`, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ content: chunks[i] }),
                  });
                }
              } catch (err) {
                console.error("[discord] Followup error:", err);
              }
            });
          }

          return deferResponse;
        }

        case "help": {
          return NextResponse.json({
            type: INTERACTION_CALLBACK.CHANNEL_MESSAGE_WITH_SOURCE,
            data: {
              content:
                "**MoA AI Assistant** 🤖\n\n" +
                "MoA is an AI agent with 100+ skills across 15 channels.\n\n" +
                "**Commands:**\n" +
                "`/ask [question]` — Ask MoA anything\n" +
                "`/help` — Show this help\n" +
                "`/credits` — Check credit balance\n\n" +
                "**Categories:**\n" +
                "🌤 Daily — Weather, translation, schedule\n" +
                "💼 Work — Email, reports, analysis\n" +
                "📄 Document — Summary, creation, conversion\n" +
                "💻 Coding — Code writing, debugging, review\n" +
                "🎨 Image — AI generation, editing\n" +
                "🎵 Music — Composition, lyrics, TTS\n\n" +
                "**Web:** https://mymoa.app\n" +
                "**Billing:** https://mymoa.app/billing",
            },
          });
        }

        case "credits": {
          let balanceText = "Credit info unavailable.";
          try {
            const { getServiceSupabase } = await import("@/lib/supabase");
            const supabase = getServiceSupabase();
            const { data } = await supabase
              .from("moa_credits")
              .select("balance, plan, monthly_quota, monthly_used")
              .eq("user_id", userId)
              .single();
            if (data) {
              balanceText = `**Balance:** ${data.balance.toLocaleString()} credits\n` +
                `**Plan:** ${data.plan}\n` +
                `**Usage:** ${data.monthly_used}/${data.monthly_quota} this month`;
            } else {
              balanceText = "**Balance:** 100 credits (Free trial)\n**Plan:** Free";
            }
          } catch { /* DB not available */ }

          return NextResponse.json({
            type: INTERACTION_CALLBACK.CHANNEL_MESSAGE_WITH_SOURCE,
            data: {
              content: `💳 ${balanceText}\n\nTop up: https://mymoa.app/billing`,
            },
          });
        }

        default:
          return NextResponse.json({
            type: INTERACTION_CALLBACK.CHANNEL_MESSAGE_WITH_SOURCE,
            data: { content: "Unknown command. Try `/help` for available commands." },
          });
      }
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[discord/webhook] Error:", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}

/**
 * GET /api/discord/webhook?action=register|info
 * Register slash commands or get bot info.
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const action = searchParams.get("action");
    const token = process.env.DISCORD_BOT_TOKEN;
    const appId = process.env.DISCORD_APPLICATION_ID;

    if (!token) {
      return NextResponse.json({ error: "DISCORD_BOT_TOKEN not configured" }, { status: 503 });
    }
    if (!appId) {
      return NextResponse.json({ error: "DISCORD_APPLICATION_ID not configured" }, { status: 503 });
    }

    switch (action) {
      case "register": {
        // Register global slash commands
        const commands = [
          {
            name: "ask",
            description: "Ask MoA AI a question",
            options: [
              {
                name: "question",
                description: "Your question for MoA AI",
                type: 3, // STRING
                required: true,
              },
            ],
          },
          {
            name: "help",
            description: "Show MoA AI help and available features",
          },
          {
            name: "credits",
            description: "Check your MoA credit balance",
          },
        ];

        const res = await fetch(`${DISCORD_API}/applications/${appId}/commands`, {
          method: "PUT",
          headers: {
            Authorization: `Bot ${token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(commands),
        });

        const data = await res.json();

        return NextResponse.json({
          success: res.ok,
          commands_registered: res.ok ? commands.map((c) => `/${c.name}`) : [],
          details: data,
          next_steps: [
            "1. Go to Discord Developer Portal → Your App → General Information",
            "2. Set 'Interactions Endpoint URL' to: https://mymoa.app/api/discord/webhook",
            "3. Save Changes",
            "4. Test with /ask, /help, /credits in your Discord server",
          ],
        });
      }

      case "info": {
        const [meRes, commandsRes] = await Promise.all([
          fetch(`${DISCORD_API}/users/@me`, {
            headers: { Authorization: `Bot ${token}` },
          }),
          fetch(`${DISCORD_API}/applications/${appId}/commands`, {
            headers: { Authorization: `Bot ${token}` },
          }),
        ]);

        const me = await meRes.json();
        const commands = await commandsRes.json();

        return NextResponse.json({
          bot: {
            username: me.username,
            id: me.id,
            discriminator: me.discriminator,
          },
          commands: Array.isArray(commands)
            ? commands.map((c: { name: string; description: string }) => ({
                name: c.name,
                description: c.description,
              }))
            : commands,
        });
      }

      case "invite": {
        // Generate invite URL with required permissions
        const permissions = 2147483648 | 2048 | 1024 | 65536; // USE_APPLICATION_COMMANDS + SEND_MESSAGES + READ_MESSAGE_HISTORY + READ_MESSAGES
        const inviteUrl = `https://discord.com/api/oauth2/authorize?client_id=${appId}&permissions=${permissions}&scope=bot%20applications.commands`;
        return NextResponse.json({ invite_url: inviteUrl });
      }

      default:
        return NextResponse.json({
          usage: {
            register: "GET /api/discord/webhook?action=register — Register slash commands",
            info: "GET /api/discord/webhook?action=info — Bot and command info",
            invite: "GET /api/discord/webhook?action=invite — Generate invite URL",
          },
        });
    }
  } catch (err) {
    console.error("[discord/webhook] GET error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
