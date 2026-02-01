import type {
  KakaoApiResponse,
  KakaoBasicCard,
  KakaoButton,
  KakaoFriendTalkMessage,
  KakaoQuickReply,
  KakaoSimpleText,
  KakaoSkillResponse,
  ResolvedKakaoAccount,
} from "./types.js";

/**
 * Kakao API Client
 *
 * Supports:
 * 1. Kakao i Open Builder - Skill Server responses
 * 2. Kakao Talk Channel API - Friend Talk / Alim Talk (via NHN Cloud)
 */
export class KakaoApiClient {
  private account: ResolvedKakaoAccount;
  private baseUrl = "https://kapi.kakao.com";
  private toastBaseUrl = "https://api-alimtalk.cloud.toast.com";

  constructor(account: ResolvedKakaoAccount) {
    this.account = account;
  }

  /**
   * Build a Skill Response for Kakao i Open Builder
   * This is the response format for incoming webhook messages
   */
  buildSkillResponse(text: string, quickReplies?: string[]): KakaoSkillResponse {
    const response: KakaoSkillResponse = {
      version: "2.0",
      template: {
        outputs: [
          {
            simpleText: {
              text: this.truncateText(text),
            },
          } as KakaoSimpleText,
        ],
      },
    };

    if (quickReplies && quickReplies.length > 0) {
      response.template.quickReplies = quickReplies.slice(0, 10).map((label) => ({
        label: label.slice(0, 14), // Max 14 chars
        action: "message" as const,
        messageText: label,
      }));
    }

    return response;
  }

  /**
   * Build a multi-output Skill Response (for long messages)
   */
  buildChunkedSkillResponse(chunks: string[]): KakaoSkillResponse {
    // Kakao allows max 3 outputs
    const outputs = chunks.slice(0, 3).map((text) => ({
      simpleText: { text: this.truncateText(text) },
    }));

    return {
      version: "2.0",
      template: { outputs },
    };
  }

  /**
   * Build a Skill Response with webLink buttons
   * Used for LawCall consultation links
   */
  buildSkillResponseWithLinks(
    text: string,
    buttons: Array<{ label: string; url: string }>,
    quickReplies?: Array<{ label: string; messageText: string }>,
  ): KakaoSkillResponse {
    const response: KakaoSkillResponse = {
      version: "2.0",
      template: {
        outputs: [
          {
            basicCard: {
              description: this.truncateText(text, 400),
              buttons: buttons.slice(0, 3).map((btn): KakaoButton => ({
                label: btn.label.slice(0, 14),
                action: "webLink",
                webLinkUrl: btn.url,
              })),
            },
          } as KakaoBasicCard,
        ],
      },
    };

    if (quickReplies && quickReplies.length > 0) {
      response.template.quickReplies = quickReplies.slice(0, 10).map((qr): KakaoQuickReply => ({
        label: qr.label.slice(0, 14),
        action: "message",
        messageText: qr.messageText,
      }));
    }

    return response;
  }

  /**
   * Build a Skill Response with text and webLink buttons
   * Shows text first, then card with buttons
   */
  buildTextWithButtonResponse(
    text: string,
    buttonLabel: string,
    buttonUrl: string,
    quickReplies?: string[],
  ): KakaoSkillResponse {
    const response: KakaoSkillResponse = {
      version: "2.0",
      template: {
        outputs: [
          {
            simpleText: {
              text: this.truncateText(text),
            },
          } as KakaoSimpleText,
          {
            basicCard: {
              buttons: [
                {
                  label: buttonLabel.slice(0, 14),
                  action: "webLink",
                  webLinkUrl: buttonUrl,
                },
              ],
            },
          } as KakaoBasicCard,
        ],
      },
    };

    if (quickReplies && quickReplies.length > 0) {
      response.template.quickReplies = quickReplies.slice(0, 10).map((label): KakaoQuickReply => ({
        label: label.slice(0, 14),
        action: "message",
        messageText: label,
      }));
    }

    return response;
  }

  /**
   * Send Friend Talk (친구톡) via NHN Cloud Toast
   * This is for proactive outbound messages
   */
  async sendFriendTalk(params: {
    recipientNo: string;
    content: string;
    buttons?: Array<{ name: string; type: string; linkMo?: string; linkPc?: string }>;
  }): Promise<{ success: boolean; error?: string; requestId?: string }> {
    if (!this.account.toastAppKey || !this.account.senderKey) {
      return {
        success: false,
        error: "Toast App Key and Sender Key required for Friend Talk",
      };
    }

    const url = `${this.toastBaseUrl}/friendtalk/v2.2/appkeys/${this.account.toastAppKey}/messages`;

    const body: KakaoFriendTalkMessage = {
      senderKey: this.account.senderKey,
      recipientList: [
        {
          recipientNo: params.recipientNo,
          content: this.truncateText(params.content),
          buttons: params.buttons?.map((btn, i) => ({
            ordering: i + 1,
            ...btn,
          })),
        },
      ],
    };

    try {
      const response = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json;charset=UTF-8",
          "X-Secret-Key": this.account.toastSecretKey ?? "",
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout((this.account.config.timeoutSeconds ?? 30) * 1000),
      });

      const data = (await response.json()) as KakaoApiResponse;

      if (response.ok && data.code === 0) {
        return { success: true, requestId: String(data.data) };
      }

      return { success: false, error: data.message || `HTTP ${response.status}` };
    } catch (err) {
      return {
        success: false,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }

  /**
   * Send Alim Talk (알림톡) via NHN Cloud Toast
   * This requires pre-registered message templates
   */
  async sendAlimTalk(params: {
    recipientNo: string;
    templateCode: string;
    templateParameter?: Record<string, string>;
  }): Promise<{ success: boolean; error?: string; requestId?: string }> {
    if (!this.account.toastAppKey || !this.account.senderKey) {
      return {
        success: false,
        error: "Toast App Key and Sender Key required for Alim Talk",
      };
    }

    const url = `${this.toastBaseUrl}/alimtalk/v2.2/appkeys/${this.account.toastAppKey}/messages`;

    const body = {
      senderKey: this.account.senderKey,
      templateCode: params.templateCode,
      recipientList: [
        {
          recipientNo: params.recipientNo,
          templateParameter: params.templateParameter ?? {},
        },
      ],
    };

    try {
      const response = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json;charset=UTF-8",
          "X-Secret-Key": this.account.toastSecretKey ?? "",
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout((this.account.config.timeoutSeconds ?? 30) * 1000),
      });

      const data = (await response.json()) as KakaoApiResponse;

      if (response.ok && data.code === 0) {
        return { success: true, requestId: String(data.data) };
      }

      return { success: false, error: data.message || `HTTP ${response.status}` };
    } catch (err) {
      return {
        success: false,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }

  /**
   * Get user profile via Kakao API (if user authorized)
   */
  async getUserProfile(accessToken: string): Promise<{
    success: boolean;
    profile?: { id: string; nickname?: string; profileImage?: string };
    error?: string;
  }> {
    try {
      const response = await fetch(`${this.baseUrl}/v2/user/me`, {
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
        signal: AbortSignal.timeout((this.account.config.timeoutSeconds ?? 30) * 1000),
      });

      if (!response.ok) {
        return { success: false, error: `HTTP ${response.status}` };
      }

      const data = (await response.json()) as {
        id: number;
        properties?: { nickname?: string; profile_image?: string };
      };

      return {
        success: true,
        profile: {
          id: String(data.id),
          nickname: data.properties?.nickname,
          profileImage: data.properties?.profile_image,
        },
      };
    } catch (err) {
      return {
        success: false,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }

  /**
   * Send a message to Kakao Talk Channel (via Plus Friend API)
   * Note: This requires business verification
   */
  async sendChannelMessage(params: {
    receiverUuids: string[];
    templateId: string;
    templateArgs?: Record<string, string>;
  }): Promise<{ success: boolean; error?: string }> {
    if (!this.account.adminKey) {
      return { success: false, error: "Admin Key required for channel messaging" };
    }

    const url = `${this.baseUrl}/v1/api/talk/friends/message/default/send`;

    try {
      const response = await fetch(url, {
        method: "POST",
        headers: {
          Authorization: `KakaoAK ${this.account.adminKey}`,
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams({
          receiver_uuids: JSON.stringify(params.receiverUuids),
          template_object: JSON.stringify({
            object_type: "text",
            text: params.templateArgs?.text ?? "",
            link: {
              web_url: params.templateArgs?.webUrl ?? "",
              mobile_web_url: params.templateArgs?.mobileWebUrl ?? "",
            },
          }),
        }),
        signal: AbortSignal.timeout((this.account.config.timeoutSeconds ?? 30) * 1000),
      });

      if (!response.ok) {
        const error = await response.text();
        return { success: false, error: `HTTP ${response.status}: ${error}` };
      }

      return { success: true };
    } catch (err) {
      return {
        success: false,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }

  /**
   * Probe the Kakao API to check connectivity
   */
  async probe(): Promise<{ ok: boolean; latencyMs: number; error?: string }> {
    const start = Date.now();

    try {
      // Try to access the Kakao API info endpoint
      await fetch("https://kapi.kakao.com/", {
        method: "HEAD",
        signal: AbortSignal.timeout(5000),
      });

      return {
        ok: true,
        latencyMs: Date.now() - start,
      };
    } catch (err) {
      return {
        ok: false,
        latencyMs: Date.now() - start,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }

  /**
   * Truncate text to Kakao's limits
   */
  private truncateText(text: string, maxLength = 1000): string {
    if (text.length <= maxLength) return text;
    return text.slice(0, maxLength - 3) + "...";
  }

  /**
   * Chunk long text into multiple messages
   */
  chunkText(text: string, limit?: number): string[] {
    const maxLength = limit ?? this.account.config.textChunkLimit ?? 1000;
    const chunks: string[] = [];

    if (text.length <= maxLength) {
      return [text];
    }

    // Split by paragraphs first
    const paragraphs = text.split(/\n\n+/);
    let currentChunk = "";

    for (const para of paragraphs) {
      if (currentChunk.length + para.length + 2 > maxLength) {
        if (currentChunk) chunks.push(currentChunk.trim());
        currentChunk = para;
      } else {
        currentChunk += (currentChunk ? "\n\n" : "") + para;
      }
    }

    if (currentChunk) chunks.push(currentChunk.trim());

    // Further split any chunks that are still too long
    const finalChunks: string[] = [];
    for (const chunk of chunks) {
      if (chunk.length <= maxLength) {
        finalChunks.push(chunk);
      } else {
        // Split by sentences
        let remaining = chunk;
        while (remaining.length > maxLength) {
          const cutPoint = remaining.lastIndexOf(". ", maxLength);
          if (cutPoint > maxLength / 2) {
            finalChunks.push(remaining.slice(0, cutPoint + 1));
            remaining = remaining.slice(cutPoint + 2);
          } else {
            finalChunks.push(remaining.slice(0, maxLength - 3) + "...");
            remaining = remaining.slice(maxLength - 3);
          }
        }
        if (remaining) finalChunks.push(remaining);
      }
    }

    return finalChunks;
  }
}

/**
 * Create a Kakao API client for an account
 */
export function createKakaoApiClient(account: ResolvedKakaoAccount): KakaoApiClient {
  return new KakaoApiClient(account);
}
