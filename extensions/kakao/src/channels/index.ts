/**
 * MoA Channels — multi-channel messaging support
 */

export type {
  ChannelContext,
  MoAMessageParams,
  MoAMessageResult,
  MoAMessageHandler,
  ChannelStatus,
} from "./types.js";

export {
  handleTelegramRequest,
  registerTelegramWebhook,
  getTelegramBotInfo,
  isTelegramConfigured,
} from "./telegram.js";

export {
  handleWhatsAppRequest,
  isWhatsAppConfigured,
} from "./whatsapp.js";

export {
  startDiscordGateway,
  stopDiscordGateway,
  getDiscordBotInfo,
  isDiscordConfigured,
} from "./discord.js";
