import { NextRequest, NextResponse } from "next/server";
import { runSecurityChecks } from "@/lib/security";
import { resolveChannelUser, getUserCredits, makeSessionId } from "@/lib/channel-user-resolver";
import { generateAIResponse, detectCategory } from "@/lib/ai-engine";
import { enqueueTask, isQueueAvailable } from "@/lib/async-queue";
import { deliverDiscordFollowup, deliverDiscordChannel, splitMessage } from "@/lib/channel-delivery";

/**
 * Discord Bot Integration — optimized architecture.
 *
 * With QStash: defers response, processes via /api/worker (Opt 2)
 * Without QStash: calls ai-engine directly (Opt 1 — no internal HTTP)
 *
 * Security: Ed25519 signature verification + rate limiting + data masking.
 */

// Optimization 3: Run in Seoul region for Korean users
export const preferredRegion = "icn1";

const DISCORD_API = "https://discord.com/api/v10";

const INTERACTION_TYPE = { PING: 1, APPLICATION_COMMAND: 2, MESSAGE_COMPONENT: 3 } as const;
const INTERACTION_CALLBACK = { PONG: 1, CHANNEL_MESSAGE_WITH_SOURCE: 4, DEFERRED_CHANNEL_MESSAGE_WITH_SOURCE: 5 } as const;

/** Verify Discord interaction signature (Ed25519) — Edge-compatible */
async function verifyDiscordSignature(body: string, signature: string, timestamp: string, publicKey: string): Promise<boolean> {
  try {
    const encoder = new TextEncoder();
    const keyData = hexToUint8Array(publicKey);
    const key = await crypto.subtle.importKey("raw", keyData, { name: "Ed25519" }, false, ["verify"]);
    const message = encoder.encode(timestamp + body);
    const sig = hexToUint8Array(signature);
    return await crypto.subtle.verify("Ed25519", key, sig, message);
  } catch {
    return false;
  }
}

function hexToUint8Array(hex: string): Uint8Array<ArrayBuffer> {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.substring(i, i + 2), 16);
  }
  return bytes;
}

export async function POST(request: NextRequest) {
  try {
    const rawBody = await request.text();
    const signature = request.headers.get("x-signature-ed25519") ?? "";
    const timestamp = request.headers.get("x-signature-timestamp") ?? "";
    const publicKey = process.env.DISCORD_PUBLIC_KEY;

    if (publicKey) {
      const isValid = await verifyDiscordSignature(rawBody, signature, timestamp, publicKey);
      if (!isValid) {
        return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
      }
    }

    const interaction = JSON.parse(rawBody);

    // PING handshake
    if (interaction.type === INTERACTION_TYPE.PING) {
      return NextResponse.json({ type: INTERACTION_CALLBACK.PONG });
    }

    // Application Commands
    if (interaction.type === INTERACTION_TYPE.APPLICATION_COMMAND) {
      const commandName = interaction.data?.name;
      const rawDiscordId = String(interaction.member?.user?.id ?? interaction.user?.id);
      const discordUsername = interaction.member?.user?.username ?? interaction.user?.username;

      const resolvedUser = await resolveChannelUser({
        channel: "discord",
        channelUserId: rawDiscordId,
        displayName: discordUsername,
      });
      const effectiveUserId = resolvedUser.effectiveUserId;
      const sessionId = makeSessionId("discord", rawDiscordId);

      switch (commandName) {
        case "ask": {
          const question = interaction.data?.options?.[0]?.value ?? "";
          if (!question) {
            return NextResponse.json({
              type: INTERACTION_CALLBACK.CHANNEL_MESSAGE_WITH_SOURCE,
              data: { content: "Please provide a question. Usage: `/ask your question here`" },
            });
          }

          const securityResult = await runSecurityChecks({
            channel: "discord", userId: effectiveUserId, messageText: question,
          });

          if (!securityResult.proceed) {
            return NextResponse.json({
              type: INTERACTION_CALLBACK.CHANNEL_MESSAGE_WITH_SOURCE,
              data: { content: securityResult.userResponse ?? "Please try again later." },
            });
          }

          // Always defer first — Discord requires response within 3 seconds
          const deferResponse = NextResponse.json({
            type: INTERACTION_CALLBACK.DEFERRED_CHANNEL_MESSAGE_WITH_SOURCE,
          });

          const appId = process.env.DISCORD_APPLICATION_ID;
          const interactionToken = interaction.token;
          const category = detectCategory(securityResult.sanitizedText);

          // Try async path (Optimization 2)
          if (isQueueAvailable() && appId) {
            enqueueTask({
              channel: "discord",
              message: securityResult.sanitizedText,
              maskedTextForStorage: securityResult.sensitiveDataDetected ? securityResult.maskedTextForStorage : undefined,
              userId: effectiveUserId,
              sessionId,
              category,
              delivery: { interactionToken },
            }).catch(() => {});
          } else if (appId) {
            // Sync fallback: process in background via unresolved promise
            // (Discord deferred response allows up to 15 min for followup)
            generateAIResponse({
              message: securityResult.sanitizedText,
              userId: effectiveUserId,
              sessionId,
              channel: "discord",
              category,
              maskedTextForStorage: securityResult.sensitiveDataDetected ? securityResult.maskedTextForStorage : undefined,
            }).then(async (result) => {
              await deliverDiscordFollowup({ appId, interactionToken, text: result.reply });
            }).catch((err) => {
              console.error("[discord] Followup error:", err);
            });
          }

          return deferResponse;
        }

        case "help":
          return NextResponse.json({
            type: INTERACTION_CALLBACK.CHANNEL_MESSAGE_WITH_SOURCE,
            data: {
              content:
                "**MoA AI Assistant**\n\n" +
                "**Commands:**\n" +
                "`/ask [question]` — Ask MoA anything\n" +
                "`/help` — Show this help\n" +
                "`/credits` — Check credit balance\n\n" +
                "**Categories:** Daily, Work, Document, Coding, Image, Music\n\n" +
                "**Web:** https://mymoa.app | **Billing:** https://mymoa.app/billing",
            },
          });

        case "credits": {
          const credits = await getUserCredits(effectiveUserId);
          const linkedStatus = resolvedUser.isLinked ? "Account linked" : "Not linked (link at mymoa.app)";
          return NextResponse.json({
            type: INTERACTION_CALLBACK.CHANNEL_MESSAGE_WITH_SOURCE,
            data: {
              content: `**Balance:** ${credits.balance.toLocaleString()} credits\n**Plan:** ${credits.plan}\n**Usage:** ${credits.monthlyUsed}/${credits.monthlyQuota}\n**Status:** ${linkedStatus}\n\nTop up: https://mymoa.app/billing`,
            },
          });
        }

        default:
          return NextResponse.json({
            type: INTERACTION_CALLBACK.CHANNEL_MESSAGE_WITH_SOURCE,
            data: { content: "Unknown command. Try `/help`." },
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
 * GET /api/discord/webhook?action=register|info|invite
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const action = searchParams.get("action");
    const token = process.env.DISCORD_BOT_TOKEN;
    const appId = process.env.DISCORD_APPLICATION_ID;

    if (!token) return NextResponse.json({ error: "DISCORD_BOT_TOKEN not configured" }, { status: 503 });
    if (!appId) return NextResponse.json({ error: "DISCORD_APPLICATION_ID not configured" }, { status: 503 });

    switch (action) {
      case "register": {
        const commands = [
          { name: "ask", description: "Ask MoA AI a question", options: [{ name: "question", description: "Your question", type: 3, required: true }] },
          { name: "help", description: "Show MoA AI help" },
          { name: "credits", description: "Check credit balance" },
        ];
        const res = await fetch(`${DISCORD_API}/applications/${appId}/commands`, {
          method: "PUT",
          headers: { Authorization: `Bot ${token}`, "Content-Type": "application/json" },
          body: JSON.stringify(commands),
        });
        const data = await res.json();
        return NextResponse.json({
          success: res.ok,
          commands_registered: res.ok ? commands.map(c => `/${c.name}`) : [],
          details: data,
        });
      }

      case "info": {
        const [meRes, commandsRes] = await Promise.all([
          fetch(`${DISCORD_API}/users/@me`, { headers: { Authorization: `Bot ${token}` } }),
          fetch(`${DISCORD_API}/applications/${appId}/commands`, { headers: { Authorization: `Bot ${token}` } }),
        ]);
        const me = await meRes.json();
        const commands = await commandsRes.json();
        return NextResponse.json({
          bot: { username: me.username, id: me.id },
          commands: Array.isArray(commands) ? commands.map((c: { name: string; description: string }) => ({ name: c.name, description: c.description })) : commands,
        });
      }

      case "invite": {
        const permissions = 2147483648 | 2048 | 1024 | 65536;
        return NextResponse.json({
          invite_url: `https://discord.com/api/oauth2/authorize?client_id=${appId}&permissions=${permissions}&scope=bot%20applications.commands`,
        });
      }

      default:
        return NextResponse.json({
          usage: {
            register: "GET /api/discord/webhook?action=register",
            info: "GET /api/discord/webhook?action=info",
            invite: "GET /api/discord/webhook?action=invite",
          },
        });
    }
  } catch (err) {
    console.error("[discord/webhook] GET error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
