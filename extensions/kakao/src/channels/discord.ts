/**
 * Discord Bot Handler for MoA
 *
 * Uses Discord Gateway (WebSocket) for receiving messages
 * and REST API for sending responses.
 *
 * Setup:
 * 1. Create application at https://discord.com/developers/applications
 * 2. Create bot → copy token
 * 3. Enable MESSAGE CONTENT intent in Bot settings
 * 4. Invite bot: https://discord.com/oauth2/authorize?client_id=CLIENT_ID&scope=bot&permissions=3072
 *    (permissions: Send Messages + Read Message History)
 * 5. Set env var: DISCORD_BOT_TOKEN
 *
 * Environment:
 * - DISCORD_BOT_TOKEN — Bot token from Discord Developer Portal
 * - DISCORD_APPLICATION_ID — (optional) Application ID for slash commands
 */

import type { MoAMessageHandler, ChannelContext } from "./types.js";

// ============================================
// Discord API Types
// ============================================

interface DiscordUser {
  id: string;
  username: string;
  discriminator: string;
  global_name?: string | null;
  bot?: boolean;
}

interface DiscordMessage {
  id: string;
  channel_id: string;
  author: DiscordUser;
  content: string;
  timestamp: string;
  guild_id?: string;
  mentions?: DiscordUser[];
  type: number; // 0 = DEFAULT
}

interface DiscordGatewayPayload {
  op: number;
  d: unknown;
  s?: number | null;
  t?: string | null;
}

interface DiscordReadyEvent {
  user: DiscordUser;
  session_id: string;
}

// ============================================
// Discord REST API
// ============================================

const DISCORD_API = "https://discord.com/api/v10";

function getDiscordConfig(): { token: string; applicationId?: string } | null {
  const token = process.env.DISCORD_BOT_TOKEN;
  if (!token) { return null; }
  return {
    token,
    applicationId: process.env.DISCORD_APPLICATION_ID,
  };
}

/**
 * Send a message to a Discord channel
 */
async function sendDiscordMessage(
  channelId: string,
  text: string,
  buttons?: Array<{ label: string; url: string }>,
  quickReplies?: string[],
): Promise<void> {
  const config = getDiscordConfig();
  if (!config) { return; }

  // Discord message limit is 2000 chars
  const truncated = text.length > 1950 ? text.slice(0, 1947) + "..." : text;

  const body: Record<string, unknown> = {
    content: truncated,
  };

  // Build components (buttons)
  const components: unknown[] = [];

  // URL buttons (Link type = 5)
  if (buttons?.length) {
    const row = {
      type: 1, // ACTION_ROW
      components: buttons.slice(0, 5).map((btn) => ({
        type: 2, // BUTTON
        style: 5, // LINK
        label: btn.label.slice(0, 80),
        url: btn.url,
      })),
    };
    components.push(row);
  }

  // Quick reply buttons (Secondary style = 2)
  if (quickReplies?.length) {
    const row = {
      type: 1, // ACTION_ROW
      components: quickReplies.slice(0, 5).map((label, i) => ({
        type: 2, // BUTTON
        style: 2, // SECONDARY
        label: label.slice(0, 80),
        custom_id: `qr_${i}_${label.slice(0, 50)}`,
      })),
    };
    components.push(row);
  }

  if (components.length > 0) {
    body.components = components;
  }

  try {
    const response = await fetch(`${DISCORD_API}/channels/${channelId}/messages`, {
      method: "POST",
      headers: {
        Authorization: `Bot ${config.token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(10000),
    });

    if (!response.ok) {
      const err = await response.text().catch(() => "");
      console.error(`[Discord] Send failed (${response.status}): ${err}`);
      // Retry without components if it fails
      if (components.length > 0) {
        await sendDiscordMessage(channelId, truncated);
      }
    }
  } catch (err) {
    console.error("[Discord] Send error:", err);
  }
}

/**
 * Send typing indicator to a Discord channel
 */
async function sendTypingIndicator(channelId: string): Promise<void> {
  const config = getDiscordConfig();
  if (!config) { return; }

  await fetch(`${DISCORD_API}/channels/${channelId}/typing`, {
    method: "POST",
    headers: {
      Authorization: `Bot ${config.token}`,
    },
    signal: AbortSignal.timeout(5000),
  }).catch(() => {});
}

// ============================================
// Discord Gateway (WebSocket)
// ============================================

let botUser: DiscordUser | null = null;
let gatewaySequence: number | null = null;
let heartbeatInterval: ReturnType<typeof setInterval> | null = null;
let gatewayWs: WebSocket | null = null;
let reconnectAttempts = 0;
const MAX_RECONNECT_ATTEMPTS = 10;

/**
 * Connect to Discord Gateway and start listening for messages
 */
export async function startDiscordGateway(
  onMessage: MoAMessageHandler,
  logger: { info: (msg: string) => void; error: (msg: string) => void },
): Promise<boolean> {
  const config = getDiscordConfig();
  if (!config) {
    logger.info("[Discord] No DISCORD_BOT_TOKEN set, skipping gateway connection");
    return false;
  }

  try {
    // Get gateway URL
    const gatewayResponse = await fetch(`${DISCORD_API}/gateway/bot`, {
      headers: { Authorization: `Bot ${config.token}` },
      signal: AbortSignal.timeout(10000),
    });

    if (!gatewayResponse.ok) {
      logger.error(`[Discord] Failed to get gateway URL: ${gatewayResponse.status}`);
      return false;
    }

    const gatewayData = (await gatewayResponse.json()) as { url: string };
    const gatewayUrl = `${gatewayData.url}/?v=10&encoding=json`;

    connectGateway(gatewayUrl, config.token, onMessage, logger);
    return true;
  } catch (err) {
    logger.error(`[Discord] Gateway connection error: ${String(err)}`);
    return false;
  }
}

function connectGateway(
  url: string,
  token: string,
  onMessage: MoAMessageHandler,
  logger: { info: (msg: string) => void; error: (msg: string) => void },
): void {
  const ws = new WebSocket(url);
  gatewayWs = ws;

  ws.addEventListener("open", () => {
    logger.info("[Discord] Gateway connected");
    reconnectAttempts = 0;
  });

  ws.addEventListener("message", (event) => {
    const data = typeof event.data === "string" ? event.data : "";
    let payload: DiscordGatewayPayload;
    try {
      payload = JSON.parse(data) as DiscordGatewayPayload;
    } catch {
      return;
    }

    if (payload.s !== null && payload.s !== undefined) {
      gatewaySequence = payload.s;
    }

    switch (payload.op) {
      case 10: {
        // Hello — start heartbeat and identify
        const hello = payload.d as { heartbeat_interval: number };
        startHeartbeat(ws, hello.heartbeat_interval);

        // Send Identify
        ws.send(
          JSON.stringify({
            op: 2,
            d: {
              token,
              intents: 512 | 4096 | 32768, // GUILD_MESSAGES | DIRECT_MESSAGES | MESSAGE_CONTENT
              properties: {
                os: "linux",
                browser: "moa",
                device: "moa",
              },
            },
          }),
        );
        break;
      }

      case 11:
        // Heartbeat ACK — connection is alive
        break;

      case 1:
        // Heartbeat request from Discord
        ws.send(JSON.stringify({ op: 1, d: gatewaySequence }));
        break;

      case 0:
        // Dispatch event
        handleDispatchEvent(payload, onMessage, logger);
        break;

      case 7:
        // Reconnect requested by Discord
        logger.info("[Discord] Reconnect requested");
        ws.close(1000);
        break;

      case 9:
        // Invalid session
        logger.error("[Discord] Invalid session, reconnecting...");
        ws.close(1000);
        break;
    }
  });

  ws.addEventListener("close", (event) => {
    logger.info(`[Discord] Gateway disconnected (code: ${event.code})`);
    stopHeartbeat();
    gatewayWs = null;

    // Reconnect with exponential backoff
    if (reconnectAttempts < MAX_RECONNECT_ATTEMPTS) {
      const delay = Math.min(1000 * 2 ** reconnectAttempts, 60000);
      reconnectAttempts++;
      logger.info(`[Discord] Reconnecting in ${delay / 1000}s (attempt ${reconnectAttempts})...`);
      setTimeout(() => connectGateway(url, token, onMessage, logger), delay);
    } else {
      logger.error("[Discord] Max reconnect attempts reached, giving up");
    }
  });

  ws.addEventListener("error", (err) => {
    logger.error(`[Discord] Gateway error: ${err.type}`);
  });
}

function startHeartbeat(ws: WebSocket, intervalMs: number): void {
  stopHeartbeat();
  // Send first heartbeat after a random jitter
  const jitter = Math.random() * intervalMs;
  setTimeout(() => {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ op: 1, d: gatewaySequence }));
    }
    heartbeatInterval = setInterval(() => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ op: 1, d: gatewaySequence }));
      }
    }, intervalMs);
  }, jitter);
}

function stopHeartbeat(): void {
  if (heartbeatInterval) {
    clearInterval(heartbeatInterval);
    heartbeatInterval = null;
  }
}

// ============================================
// Event Dispatch
// ============================================

function handleDispatchEvent(
  payload: DiscordGatewayPayload,
  onMessage: MoAMessageHandler,
  logger: { info: (msg: string) => void; error: (msg: string) => void },
): void {
  switch (payload.t) {
    case "READY": {
      const ready = payload.d as DiscordReadyEvent;
      botUser = ready.user;
      logger.info(`[Discord] Bot ready: ${ready.user.username}#${ready.user.discriminator}`);
      break;
    }

    case "MESSAGE_CREATE": {
      const message = payload.d as DiscordMessage;
      handleDiscordMessage(message, onMessage, logger).catch((err) => {
        logger.error(`[Discord] Message handling error: ${err}`);
      });
      break;
    }

    case "INTERACTION_CREATE": {
      const interaction = payload.d as {
        type: number;
        data?: { custom_id?: string };
        channel_id: string;
        member?: { user: DiscordUser };
        user?: DiscordUser;
        id: string;
        token: string;
      };
      // Handle button interactions (type 3 = MESSAGE_COMPONENT)
      if (interaction.type === 3 && interaction.data?.custom_id?.startsWith("qr_")) {
        const label = interaction.data.custom_id.replace(/^qr_\d+_/, "");
        const user = interaction.member?.user ?? interaction.user;
        if (user && label) {
          // ACK the interaction
          ackInteraction(interaction.id, interaction.token).catch(() => {});
          // Process as a text message
          const syntheticMessage: DiscordMessage = {
            id: interaction.id,
            channel_id: interaction.channel_id,
            author: user,
            content: label,
            timestamp: new Date().toISOString(),
            type: 0,
          };
          handleDiscordMessage(syntheticMessage, onMessage, logger).catch((err) => {
            logger.error(`[Discord] Interaction handling error: ${err}`);
          });
        }
      }
      break;
    }
  }
}

async function ackInteraction(interactionId: string, interactionToken: string): Promise<void> {
  await fetch(`${DISCORD_API}/interactions/${interactionId}/${interactionToken}/callback`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      type: 6, // DEFERRED_UPDATE_MESSAGE
    }),
    signal: AbortSignal.timeout(3000),
  }).catch(() => {});
}

// ============================================
// Message Handler
// ============================================

async function handleDiscordMessage(
  message: DiscordMessage,
  onMessage: MoAMessageHandler,
  logger: { info: (msg: string) => void; error: (msg: string) => void },
): Promise<void> {
  // Skip bot messages (including ourselves)
  if (message.author.bot) { return; }

  // Skip empty or system messages
  if (!message.content?.trim() || message.type !== 0) { return; }

  let text = message.content.trim();

  // In guild channels, only respond to mentions or !moa prefix
  if (message.guild_id) {
    const isMentioned = message.mentions?.some((u) => u.id === botUser?.id);
    const hasPrefix = text.toLowerCase().startsWith("!moa");

    if (!isMentioned && !hasPrefix) { return; }

    // Strip mention or prefix
    if (isMentioned && botUser) {
      text = text.replace(new RegExp(`<@!?${botUser.id}>`, "g"), "").trim();
    }
    if (hasPrefix) {
      text = text.slice(4).trim();
    }

    // Default to greeting if empty after stripping
    if (!text) { text = "안녕"; }
  }

  const displayName = message.author.global_name ?? message.author.username;

  logger.info(`[Discord] Message from ${displayName}: ${text.slice(0, 100)}`);

  // Send typing indicator
  await sendTypingIndicator(message.channel_id);

  const channel: ChannelContext = {
    channelId: "discord",
    channelName: "Discord",
    userId: `discord_${message.author.id}`,
    userName: displayName,
    chatId: message.channel_id,
    maxMessageLength: 2000,
  };

  try {
    const result = await onMessage({
      userId: channel.userId,
      userType: "discord",
      text,
      botId: "moa-discord",
      blockId: "",
      timestamp: new Date(message.timestamp).getTime(),
      channel,
    });

    await sendDiscordMessage(
      message.channel_id,
      result.text,
      result.buttons,
      result.quickReplies,
    );
  } catch (err) {
    logger.error(`[Discord] Message handling error: ${err}`);
    await sendDiscordMessage(
      message.channel_id,
      "죄송합니다, 메시지 처리 중 오류가 발생했습니다. 잠시 후 다시 시도해주세요.",
    );
  }
}

// ============================================
// Exports
// ============================================

/**
 * Check if Discord bot is configured
 */
export function isDiscordConfigured(): boolean {
  return !!getDiscordConfig();
}

/**
 * Get Discord bot info
 */
export function getDiscordBotInfo(): DiscordUser | null {
  return botUser;
}

/**
 * Stop the Discord gateway connection
 */
export function stopDiscordGateway(): void {
  stopHeartbeat();
  if (gatewayWs) {
    gatewayWs.close(1000);
    gatewayWs = null;
  }
}
