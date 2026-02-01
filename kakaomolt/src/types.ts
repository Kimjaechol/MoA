/**
 * KakaoTalk Channel Plugin Types
 *
 * Supports two methods:
 * 1. Kakao Channel API (Official) - For business messaging via Kakao Channels
 * 2. Kakao i Open Builder - For chatbot integration
 */

// Kakao User Info
export interface KakaoUser {
  id: string;
  type: "user" | "plusfriend";
  properties?: {
    nickname?: string;
    profile_image?: string;
    thumbnail_image?: string;
  };
}

// Incoming Message from Kakao Channel
export interface KakaoIncomingMessage {
  intent: {
    id: string;
    name: string;
  };
  userRequest: {
    timezone: string;
    params: {
      ignoreMe?: string;
      surface?: string;
    };
    block: {
      id: string;
      name: string;
    };
    utterance: string;
    lang: string | null;
    user: {
      id: string;
      type: "botUserKey" | "appUserId" | "plusfriendUserKey";
      properties: Record<string, string>;
    };
  };
  bot: {
    id: string;
    name: string;
  };
  action: {
    name: string;
    clientExtra: Record<string, unknown> | null;
    params: Record<string, string>;
    id: string;
    detailParams: Record<string, { origin: string; value: string; groupName: string }>;
  };
}

// Outgoing Message Response (Kakao i Open Builder format)
export interface KakaoSkillResponse {
  version: "2.0";
  template: {
    outputs: KakaoOutput[];
    quickReplies?: KakaoQuickReply[];
  };
  context?: {
    values: Array<{
      name: string;
      lifeSpan: number;
      params?: Record<string, string>;
    }>;
  };
  data?: Record<string, unknown>;
}

export type KakaoOutput =
  | KakaoSimpleText
  | KakaoSimpleImage
  | KakaoBasicCard
  | KakaoCommerceCard
  | KakaoListCard
  | KakaoCarousel;

export interface KakaoSimpleText {
  simpleText: {
    text: string;
  };
}

export interface KakaoSimpleImage {
  simpleImage: {
    imageUrl: string;
    altText: string;
  };
}

export interface KakaoBasicCard {
  basicCard: {
    title?: string;
    description?: string;
    thumbnail?: {
      imageUrl: string;
      link?: { web: string };
      fixedRatio?: boolean;
      width?: number;
      height?: number;
    };
    profile?: {
      nickname: string;
      imageUrl?: string;
    };
    social?: {
      like?: number;
      comment?: number;
      share?: number;
    };
    buttons?: KakaoButton[];
  };
}

export interface KakaoCommerceCard {
  commerceCard: {
    description: string;
    price: number;
    currency: string;
    discount?: number;
    discountRate?: number;
    discountedPrice?: number;
    thumbnails: Array<{ imageUrl: string; link?: { web: string } }>;
    profile?: { nickname: string; imageUrl?: string };
    buttons?: KakaoButton[];
  };
}

export interface KakaoListCard {
  listCard: {
    header: {
      title: string;
      imageUrl?: string;
      link?: { web: string };
    };
    items: Array<{
      title: string;
      description?: string;
      imageUrl?: string;
      link?: { web: string };
    }>;
    buttons?: KakaoButton[];
  };
}

export interface KakaoCarousel {
  carousel: {
    type: "basicCard" | "commerceCard" | "listCard";
    items: Array<KakaoBasicCard["basicCard"] | KakaoCommerceCard["commerceCard"] | KakaoListCard["listCard"]>;
    header?: {
      title: string;
      description?: string;
      thumbnail?: { imageUrl: string };
    };
  };
}

export interface KakaoButton {
  label: string;
  action: "webLink" | "message" | "phone" | "block" | "share" | "operator";
  webLinkUrl?: string;
  messageText?: string;
  phoneNumber?: string;
  blockId?: string;
}

export interface KakaoQuickReply {
  label: string;
  action: "message" | "block";
  messageText?: string;
  blockId?: string;
}

// Kakao Talk Channel API (알림톡/친구톡)
export interface KakaoChannelMessage {
  senderKey: string;
  templateCode?: string; // For 알림톡 (Alimtalk)
  recipientList: Array<{
    recipientNo: string;
    templateParameter?: Record<string, string>;
    resendParameter?: {
      isResend: boolean;
      resendType?: string;
      resendTitle?: string;
      resendContent?: string;
      resendSendNo?: string;
    };
    buttons?: Array<{
      ordering: number;
      type: string;
      name: string;
      linkMo?: string;
      linkPc?: string;
      schemeIos?: string;
      schemeAndroid?: string;
    }>;
  }>;
}

// Friend Talk (친구톡) - No template required
export interface KakaoFriendTalkMessage {
  senderKey: string;
  requestDate?: string;
  recipientList: Array<{
    recipientNo: string;
    content: string;
    imageSeq?: number;
    imageLink?: string;
    buttons?: Array<{
      ordering: number;
      type: string;
      name: string;
      linkMo?: string;
      linkPc?: string;
    }>;
    resendParameter?: {
      isResend: boolean;
      resendType?: string;
      resendContent?: string;
    };
  }>;
}

// API Response
export interface KakaoApiResponse {
  code: number;
  message: string;
  data?: unknown;
}

// Config Types
export interface KakaoAccountConfig {
  name?: string;
  enabled?: boolean;

  // Kakao Developer App Keys
  appKey?: string; // JavaScript Key
  adminKey?: string; // Admin Key (REST API)
  secretKey?: string; // Secret Key (Optional)

  // Kakao Channel (for messaging)
  channelId?: string;
  senderKey?: string; // For 알림톡/친구톡

  // NHN Cloud Toast (for 알림톡/친구톡 API)
  toastAppKey?: string;
  toastSecretKey?: string;

  // Webhook
  webhookUrl?: string;
  webhookPath?: string;
  webhookPort?: number;

  // Policies
  dmPolicy?: "open" | "allowlist" | "disabled";
  allowFrom?: string[];

  // Message settings
  textChunkLimit?: number;

  // Timeouts
  timeoutSeconds?: number;
}

export interface KakaoConfig {
  accounts?: Record<string, KakaoAccountConfig>;
}

export interface ResolvedKakaoAccount {
  accountId: string;
  enabled: boolean;
  name?: string;
  appKey: string;
  adminKey: string;
  channelId?: string;
  senderKey?: string;
  toastAppKey?: string;
  toastSecretKey?: string;
  config: KakaoAccountConfig;
}

// Webhook Event Types
export interface KakaoWebhookEvent {
  type: "message" | "added" | "blocked" | "leave";
  userId: string;
  message?: {
    text?: string;
    photo?: { url: string; width: number; height: number };
    video?: { url: string };
    audio?: { url: string };
  };
  timestamp: number;
}

// Internal Message Format
export interface KakaoMessage {
  id: string;
  userId: string;
  text: string;
  timestamp: number;
  media?: {
    type: "photo" | "video" | "audio";
    url: string;
  };
}
