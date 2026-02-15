/**
 * Unified MoA Channel Types
 *
 * Shared types for all messaging channels (KakaoTalk, Telegram, WhatsApp, Discord, Slack, LINE).
 * Each channel adapter converts platform-specific messages to/from this format.
 */

/** Context about which channel a message came from */
export interface ChannelContext {
  channelId: "kakao" | "telegram" | "whatsapp" | "discord" | "slack" | "line";
  channelName: string;
  userId: string;
  userName: string;
  chatId: string;
  /** Max response text length for this channel */
  maxMessageLength: number;
}

/** Unified message handler input */
export interface MoAMessageParams {
  userId: string;
  userType: string;
  text: string;
  botId: string;
  blockId: string;
  timestamp: number;
  /** Channel context (absent for legacy Kakao calls) */
  channel?: ChannelContext;
}

/** Unified message handler result */
export interface MoAMessageResult {
  text: string;
  quickReplies?: string[];
  buttons?: Array<{ label: string; url: string }>;
}

/** Unified message handler function signature */
export type MoAMessageHandler = (params: MoAMessageParams) => Promise<MoAMessageResult>;

/** Channel status info */
export interface ChannelStatus {
  channelId: string;
  channelName: string;
  configured: boolean;
  connected: boolean;
  botName?: string;
  botUrl?: string;
}
