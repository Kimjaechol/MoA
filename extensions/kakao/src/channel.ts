import type { ChannelPlugin } from "clawdbot/plugin-sdk";
import type { ResolvedKakaoAccount } from "./types.js";
import {
  listKakaoAccountIds,
  resolveKakaoAccount,
  listEnabledKakaoAccounts,
  validateKakaoAccount,
} from "./config.js";
import { createKakaoApiClient } from "./api-client.js";
import { startKakaoWebhook } from "./webhook.js";
import { getKakaoRuntime } from "./runtime.js";

/**
 * Kakao Channel Metadata
 */
const kakaoMeta = {
  id: "kakao" as const,
  label: "KakaoTalk",
  selectionLabel: "KakaoTalk (Kakao i Open Builder)",
  docsPath: "/channels/kakao",
  blurb: "KakaoTalk messaging integration via Kakao i Open Builder",
  order: 25,
};

/**
 * Active webhook servers by account ID
 */
const activeWebhooks = new Map<string, { stop: () => Promise<void> }>();

/**
 * Kakao Channel Plugin
 */
export const kakaoPlugin: ChannelPlugin<ResolvedKakaoAccount> = {
  id: "kakao",
  meta: kakaoMeta,

  capabilities: {
    chatTypes: ["direct"],
    reactions: false,
    threads: false,
    media: true,
    nativeCommands: false,
    blockStreaming: true, // Kakao requires full response
  },

  reload: {
    configPrefixes: ["channels.kakao"],
  },

  // Configuration adapters
  config: {
    listAccountIds: (cfg) => listKakaoAccountIds(cfg),
    resolveAccount: (cfg, accountId) => resolveKakaoAccount({ cfg, accountId }),
    listEnabledAccounts: (cfg) => listEnabledKakaoAccounts(cfg),
    getDefaultAccountId: () => "default",
    accountLabel: (account) => account.name ?? account.accountId,
  },

  // Security policies
  security: {
    dmPolicyOptions: ["open", "allowlist", "disabled"],
    getDmPolicy: (account) => account.config.dmPolicy ?? "open",
    getDmAllowlist: (account) => account.config.allowFrom ?? [],
    shouldAcceptDm: (account, senderId) => {
      const policy = account.config.dmPolicy ?? "open";
      if (policy === "disabled") return { accept: false, reason: "DM disabled" };
      if (policy === "open") return { accept: true };
      const allowFrom = account.config.allowFrom ?? [];
      const allowed = allowFrom.includes(senderId);
      return allowed
        ? { accept: true }
        : { accept: false, reason: "Not in allowlist" };
    },
    getWarnings: (account) => {
      const { warnings } = validateKakaoAccount(account);
      return warnings;
    },
  },

  // Message threading (not supported by Kakao)
  threading: {
    replyModes: ["off"],
    getReplyMode: () => "off",
    resolveThreadTarget: (target) => ({ ...target, threadId: undefined }),
  },

  // Messaging adapters
  messaging: {
    normalizeTarget: (target) => ({
      channel: "kakao",
      peerId: target.peerId,
      accountId: target.accountId ?? "default",
    }),
    isValidTarget: (target) => Boolean(target.peerId),
    formatPeerId: (peerId) => peerId,
    parsePeerId: (raw) => raw,
  },

  // Outbound message sending
  outbound: {
    deliveryMode: "skill-response", // Special mode for Kakao
    textChunkLimit: 1000,
    chunkerMode: "length",

    chunker: (text, limit) => {
      const account = getKakaoRuntime().config.channels?.kakao as ResolvedKakaoAccount | undefined;
      if (account) {
        const client = createKakaoApiClient(account);
        return client.chunkText(text, limit);
      }
      // Fallback chunking
      if (text.length <= (limit ?? 1000)) return [text];
      const chunks: string[] = [];
      for (let i = 0; i < text.length; i += (limit ?? 1000)) {
        chunks.push(text.slice(i, i + (limit ?? 1000)));
      }
      return chunks;
    },

    // For skill server responses, we don't actively send
    // The response is returned from the webhook handler
    sendText: async ({ to, text, accountId }) => {
      const cfg = getKakaoRuntime().config;
      const account = resolveKakaoAccount({ cfg, accountId });

      if (!account) {
        return { channel: "kakao", ok: false, error: "Account not found" };
      }

      const client = createKakaoApiClient(account);

      // Try Friend Talk for proactive messages
      if (account.senderKey && account.toastAppKey) {
        const result = await client.sendFriendTalk({
          recipientNo: to,
          content: text,
        });

        return {
          channel: "kakao",
          ok: result.success,
          error: result.error,
          messageId: result.requestId,
        };
      }

      // Skill server mode - message is returned in webhook response
      // This path is for background/proactive messages
      return {
        channel: "kakao",
        ok: false,
        error: "Friend Talk not configured. Use Kakao i Open Builder for reactive messaging.",
      };
    },

    sendMedia: async ({ to, text, mediaUrl, accountId }) => {
      // Kakao Friend Talk with image
      const cfg = getKakaoRuntime().config;
      const account = resolveKakaoAccount({ cfg, accountId });

      if (!account) {
        return { channel: "kakao", ok: false, error: "Account not found" };
      }

      const client = createKakaoApiClient(account);

      if (account.senderKey && account.toastAppKey) {
        // Note: Friend Talk with image requires image registration
        // For now, send text with image URL
        const messageWithImage = mediaUrl ? `${text}\n\n🖼️ ${mediaUrl}` : text;

        const result = await client.sendFriendTalk({
          recipientNo: to,
          content: messageWithImage,
        });

        return {
          channel: "kakao",
          ok: result.success,
          error: result.error,
          messageId: result.requestId,
        };
      }

      return {
        channel: "kakao",
        ok: false,
        error: "Media sending requires Friend Talk configuration",
      };
    },
  },

  // Status and health checks
  status: {
    probe: async (account) => {
      const client = createKakaoApiClient(account);
      const result = await client.probe();

      return {
        ok: result.ok,
        latencyMs: result.latencyMs,
        details: result.error ? { error: result.error } : undefined,
      };
    },

    getAccountStatus: (account) => {
      const { valid, errors, warnings } = validateKakaoAccount(account);

      return {
        enabled: account.enabled,
        configured: valid,
        issues: [
          ...errors.map((e) => ({ level: "error" as const, message: e })),
          ...warnings.map((w) => ({ level: "warning" as const, message: w })),
        ],
      };
    },

    audit: (account) => {
      const issues: Array<{ level: "error" | "warning" | "info"; message: string }> = [];

      if (!account.appKey && !account.adminKey) {
        issues.push({ level: "error", message: "No API keys configured" });
      }

      if (!account.channelId) {
        issues.push({ level: "warning", message: "Channel ID not set" });
      }

      if (!account.senderKey) {
        issues.push({ level: "info", message: "Sender Key not set - proactive messaging disabled" });
      }

      if (account.config.dmPolicy === "open") {
        issues.push({
          level: "warning",
          message: "DM policy is 'open' - anyone can send messages",
        });
      }

      return issues;
    },
  },

  // Gateway lifecycle
  gateway: {
    startAccount: async (ctx) => {
      const { account, abortSignal, logger } = ctx;

      // Start webhook server
      const webhook = await startKakaoWebhook({
        account,
        port: account.config.webhookPort,
        path: account.config.webhookPath,
        abortSignal,
        logger,
        onMessage: async ({ userId, text, timestamp }) => {
          // Route message to Moltbot agent
          const runtime = getKakaoRuntime();

          try {
            // Call the agent with the incoming message
            const result = await runtime.routeMessage({
              channel: "kakao",
              accountId: account.accountId,
              from: userId,
              text,
              timestamp,
            });

            return {
              text: result.response ?? "메시지를 처리했습니다.",
              quickReplies: result.quickReplies,
            };
          } catch (err) {
            logger.error(`[kakao] Agent error: ${err}`);
            return {
              text: "죄송합니다. 메시지 처리 중 오류가 발생했습니다.",
            };
          }
        },
        onError: (err) => {
          logger.error(`[kakao] Webhook error: ${err.message}`);
        },
      });

      activeWebhooks.set(account.accountId, webhook);

      logger.info(`[kakao] Started webhook for account ${account.accountId} at port ${webhook.port}`);

      // Return cleanup function
      return {
        stop: async () => {
          await webhook.stop();
          activeWebhooks.delete(account.accountId);
        },
      };
    },

    stopAccount: async (ctx) => {
      const webhook = activeWebhooks.get(ctx.account.accountId);
      if (webhook) {
        await webhook.stop();
        activeWebhooks.delete(ctx.account.accountId);
      }
    },
  },

  // Setup wizard
  setup: {
    steps: [
      {
        id: "intro",
        title: "KakaoTalk Setup",
        description: "Set up KakaoTalk integration using Kakao i Open Builder",
      },
      {
        id: "credentials",
        title: "API Credentials",
        description: "Enter your Kakao Developer API keys",
        fields: [
          { key: "appKey", label: "App Key (JavaScript Key)", required: false },
          { key: "adminKey", label: "Admin Key (REST API Key)", required: true, sensitive: true },
          { key: "channelId", label: "Kakao Channel ID", required: false },
        ],
      },
      {
        id: "friendtalk",
        title: "Friend Talk (Optional)",
        description: "For proactive outbound messaging via NHN Cloud Toast",
        fields: [
          { key: "senderKey", label: "Sender Key", required: false },
          { key: "toastAppKey", label: "Toast App Key", required: false },
          { key: "toastSecretKey", label: "Toast Secret Key", required: false, sensitive: true },
        ],
      },
      {
        id: "webhook",
        title: "Webhook Settings",
        description: "Configure the webhook server for receiving messages",
        fields: [
          { key: "webhookPort", label: "Webhook Port", default: "8788" },
          { key: "webhookPath", label: "Webhook Path", default: "/kakao/webhook" },
        ],
      },
    ],
  },

  // Onboarding wizard
  onboarding: {
    welcome: `
# KakaoTalk Channel Setup

이 가이드는 Moltbot을 KakaoTalk과 연동하는 방법을 안내합니다.

## 준비 사항
1. Kakao Developers 계정 (https://developers.kakao.com)
2. Kakao i Open Builder 계정 (https://i.kakao.com)
3. (선택) NHN Cloud Toast 계정 - 친구톡 발송용

## 연동 방식
- **Kakao i Open Builder**: 사용자가 카카오톡 채널에 메시지를 보내면 Moltbot이 응답
- **Friend Talk**: Moltbot이 먼저 카카오톡 메시지를 보낼 수 있음 (비용 발생)
    `.trim(),

    instructions: `
## 설정 단계

### 1. Kakao Developers 앱 생성
1. https://developers.kakao.com 에서 로그인
2. "내 애플리케이션" → "애플리케이션 추가하기"
3. 앱 이름 입력 후 생성
4. "앱 키" 탭에서 REST API 키 복사

### 2. Kakao i Open Builder 스킬 설정
1. https://i.kakao.com 에서 로그인
2. 봇 생성 또는 기존 봇 선택
3. "스킬" → "스킬 생성"
4. 스킬 URL에 웹훅 주소 입력:
   \`http://your-server:8788/kakao/webhook\`
5. "시나리오" → 스킬 연결

### 3. 웹훅 서버 실행
Moltbot이 실행되면 자동으로 웹훅 서버가 시작됩니다.
외부에서 접근 가능하도록 포트 포워딩이나 ngrok 등을 사용하세요.

### 4. (선택) Friend Talk 설정
프로액티브 메시지 발송을 원하면:
1. Kakao 비즈니스 채널 생성
2. NHN Cloud Toast 가입
3. 알림톡/친구톡 발신 프로필 등록
4. Sender Key 발급
    `.trim(),
  },

  // Directory (not applicable for Kakao)
  directory: {
    listPeers: async () => [],
    listGroups: async () => [],
  },

  // Actions (limited for Kakao)
  actions: {
    canReact: () => false,
    canEdit: () => false,
    canDelete: () => false,
    canPin: () => false,
  },
};
