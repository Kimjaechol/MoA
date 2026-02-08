import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { randomBytes } from "node:crypto";
import type { KakaoIncomingMessage, KakaoSkillResponse, ResolvedKakaoAccount } from "./types.js";
import { createKakaoApiClient } from "./api-client.js";
// lawcall-router is available for legal consultation features when needed
// import { getConsultationButton, isLegalQuestion } from "./lawcall-router.js";
import {
  handleBillingCommand,
  preBillingCheck,
  postBillingDeduct,
  getCreditStatusMessage,
} from "./billing-handler.js";
import { handleSyncCommand, isSyncCommand, type SyncCommandContext } from "./sync/index.js";
import { getSupabase, isSupabaseConfigured } from "./supabase.js";
import {
  formatChannelList,
  formatToolList,
  parseBridgeCommand,
  type MoltbotAgentIntegration,
} from "./moltbot/index.js";
import {
  generatePairingCode,
  listUserDevices,
  removeDevice,
  sendRelayCommand,
  getRecentCommands,
  getCommandResult,
  getExecutionLog,
  getRelayUsageStats,
  getRelayBillingConfig,
  confirmCommand,
  rejectCommand,
  // Multi-device direct command
  parseDirectCommand,
  sendMultiDeviceCommand,
  formatMultiDeviceResult,
  getTwinMoAStatus,
  formatTwinMoAStatus,
  // Device status monitoring
  getDetailedDeviceStatus,
  formatDeviceStatusSummary,
  formatDeviceStatusDetail,
  getDeviceStatusById,
} from "./relay/index.js";
import {
  // Installer & Subscription
  DEFAULT_INSTALLER_CONFIG,
  PLATFORM_INSTALLERS,
  getUserSubscription,
  formatSubscriptionStatus,
  formatPlanComparison,
  isBetaPeriod,
} from "./installer/index.js";
import {
  storeUserPhoneNumber,
} from "./proactive-messaging.js";

export interface KakaoWebhookOptions {
  account: ResolvedKakaoAccount;
  port?: number;
  host?: string;
  path?: string;
  abortSignal?: AbortSignal;
  /** Message handler (called when no special commands match) */
  onMessage: (params: {
    userId: string;
    userType: string;
    text: string;
    botId: string;
    blockId: string;
    timestamp: number;
  }) => Promise<{ text: string; quickReplies?: string[]; buttons?: Array<{ label: string; url: string }> }>;
  onError?: (error: Error) => void;
  logger?: {
    info: (msg: string) => void;
    warn: (msg: string) => void;
    error: (msg: string) => void;
  };
  /** Optional Moltbot agent integration for tools, channels, and memory */
  moltbotAgent?: MoltbotAgentIntegration;
  /** Optional request interceptor — called before webhook handling. Return true to indicate the request was handled. */
  requestInterceptor?: (req: IncomingMessage, res: ServerResponse) => Promise<boolean>;
}

/**
 * Create and start a Kakao webhook server
 * This receives messages from Kakao i Open Builder skill server
 */
export async function startKakaoWebhook(opts: KakaoWebhookOptions): Promise<{
  stop: () => Promise<void>;
  port: number;
  url: string;
}> {
  const {
    account,
    port = account.config.webhookPort ?? 8788,
    host = "0.0.0.0",
    path = account.config.webhookPath ?? "/kakao/webhook",
    abortSignal,
    onMessage,
    onError,
    logger = console,
    moltbotAgent,
    requestInterceptor,
  } = opts;

  const apiClient = createKakaoApiClient(account);
  let server: ReturnType<typeof createServer> | null = null;

  const handleRequest = async (req: IncomingMessage, res: ServerResponse) => {
    // Health check
    if (req.url === "/health" && req.method === "GET") {
      res.writeHead(200, { "Content-Type": "text/plain" });
      res.end("ok");
      return;
    }

    // Request interceptor (e.g., relay API routes)
    if (requestInterceptor) {
      const handled = await requestInterceptor(req, res);
      if (handled) return;
    }

    // Only accept POST to webhook path
    if (req.url !== path || req.method !== "POST") {
      res.writeHead(404);
      res.end("Not Found");
      return;
    }

    // Parse JSON body
    let body = "";
    for await (const chunk of req) {
      body += chunk;
    }

    let kakaoRequest: KakaoIncomingMessage;
    try {
      kakaoRequest = JSON.parse(body) as KakaoIncomingMessage;
    } catch {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Invalid JSON" }));
      return;
    }

    const userId = kakaoRequest.userRequest?.user?.id ?? "";
    const userType = kakaoRequest.userRequest?.user?.type ?? "";
    const utterance = kakaoRequest.userRequest?.utterance ?? "";
    const botId = kakaoRequest.bot?.id ?? "";
    const blockId = kakaoRequest.action?.id ?? "";

    logger.info(
      `[kakao] Received message from ${userId.slice(0, 8)}...: "${utterance.slice(0, 50)}${utterance.length > 50 ? "..." : ""}"`,
    );

    // Check allowlist if configured
    if (account.config.dmPolicy === "allowlist") {
      const allowFrom = account.config.allowFrom ?? [];
      if (!allowFrom.includes(userId)) {
        logger.warn(`[kakao] User ${userId.slice(0, 8)}... not in allowlist`);
        const response = apiClient.buildSkillResponse(
          "죄송합니다. 허용되지 않은 사용자입니다.",
        );
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify(response));
        return;
      }
    }

    if (account.config.dmPolicy === "disabled") {
      const response = apiClient.buildSkillResponse(
        "현재 메시지 수신이 비활성화되어 있습니다.",
      );
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(response));
      return;
    }

    try {
      const supabaseReady = isSupabaseConfigured();

      // Step 0: Check for sync commands (/동기화, /sync) — requires Supabase
      if (supabaseReady && isSyncCommand(utterance)) {
        // Get or create user in Supabase
        const supabase = getSupabase();
        let supabaseUserId: string;

        const { data: existingUser } = await supabase
          .from("lawcall_users")
          .select("id")
          .eq("kakao_user_id", userId)
          .single();

        if (existingUser) {
          supabaseUserId = existingUser.id;
        } else {
          // Create new user
          const { data: newUser, error } = await supabase
            .from("lawcall_users")
            .insert({ kakao_user_id: userId })
            .select("id")
            .single();

          if (error || !newUser) {
            const response = apiClient.buildSkillResponse(
              "사용자 등록에 실패했습니다. 잠시 후 다시 시도해주세요.",
            );
            res.writeHead(200, { "Content-Type": "application/json" });
            res.end(JSON.stringify(response));
            return;
          }
          supabaseUserId = newUser.id;
        }

        // Create sync context
        const syncContext: SyncCommandContext = {
          kakaoUserId: userId,
          userId: supabaseUserId,
          deviceId: `kakao-${userId.slice(0, 16)}-${randomBytes(4).toString("hex")}`,
          deviceName: "KakaoTalk",
          deviceType: "mobile",
        };

        const syncResult = await handleSyncCommand(syncContext, utterance);
        const response = apiClient.buildSkillResponse(syncResult.message);
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify(response));
        logger.info(`[kakao] Handled sync command for ${userId.slice(0, 8)}...`);
        return;
      }

      // Step 0.5: Check for Moltbot-specific commands — requires Supabase for relay/install/subscribe
      const moltbotCmd = parseMoltbotCommand(utterance);
      if (moltbotCmd.isCommand) {
        // Some moltbot commands (tools, channels, help, status) work without Supabase
        const supabaseFreeCommands = new Set(["tools", "channels", "help", "status", "bridge"]);
        if (supabaseReady || supabaseFreeCommands.has(moltbotCmd.type ?? "")) {
          const moltbotResult = await handleMoltbotCommand(
            moltbotCmd,
            userId,
            moltbotAgent,
            logger,
          );
          const response = apiClient.buildSkillResponse(
            moltbotResult.text,
            moltbotResult.quickReplies,
          );
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify(response));
          logger.info(`[kakao] Handled Moltbot command for ${userId.slice(0, 8)}...`);
          return;
        }
      }

      // Step 1 & 2: Billing checks — only when Supabase is configured
      let usedPlatformKey = true;
      if (supabaseReady) {
        // Step 1: Check for billing commands (잔액, 충전, API키 등록 등)
        const billingCmd = await handleBillingCommand(userId, utterance);
        if (billingCmd.handled) {
          let response: KakaoSkillResponse;
          if (billingCmd.paymentUrl) {
            response = apiClient.buildTextWithButtonResponse(
              billingCmd.response ?? "",
              "결제하기",
              billingCmd.paymentUrl,
              billingCmd.quickReplies,
            );
          } else {
            response = apiClient.buildSkillResponse(
              billingCmd.response ?? "",
              billingCmd.quickReplies,
            );
          }
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify(response));
          logger.info(`[kakao] Handled billing command for ${userId.slice(0, 8)}...`);
          return;
        }

        // Step 2: Pre-billing check (verify credits or custom API key)
        const billingCheck = await preBillingCheck(userId);
        if (billingCheck.handled) {
          const response = apiClient.buildSkillResponse(
            billingCheck.response ?? "",
            billingCheck.quickReplies,
          );
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify(response));
          logger.info(`[kakao] Billing check failed for ${userId.slice(0, 8)}...: insufficient credits`);
          return;
        }
        usedPlatformKey = !billingCheck.billingCheck?.useCustomKey;
      }

      // Step 3: Call the message handler (AI agent)
      const result = await onMessage({
        userId,
        userType,
        text: utterance,
        botId,
        blockId,
        timestamp: Date.now(),
      });

      // Step 4 & 5: Post-billing deduct — only when Supabase is configured
      let finalText = result.text;
      let creditsUsed = 0;
      if (supabaseReady) {
        const estimatedInputTokens = Math.ceil(utterance.length / 4);
        const estimatedOutputTokens = Math.ceil(result.text.length / 4);
        const model = process.env.OPENCLAW_MODEL ?? "claude-3-5-haiku-20241022";

        const billingResult = await postBillingDeduct(
          userId,
          model,
          estimatedInputTokens,
          estimatedOutputTokens,
          usedPlatformKey,
        );
        creditsUsed = billingResult.creditsUsed;

        const creditMessage = await getCreditStatusMessage(userId, billingResult.creditsUsed, usedPlatformKey);
        finalText = result.text + creditMessage;
      }

      // Build response — use simpleText + button card if buttons are provided, otherwise simple text
      let response: KakaoSkillResponse;
      if (result.buttons && result.buttons.length > 0) {
        // Use buildTextWithButtonResponse: simpleText (full text) + basicCard (button only)
        // This avoids basicCard description 400-char limit issues
        const firstButton = result.buttons[0];
        response = apiClient.buildTextWithButtonResponse(
          finalText,
          firstButton.label,
          firstButton.url,
          result.quickReplies,
        );
      } else {
        response = apiClient.buildSkillResponse(finalText, result.quickReplies);
      }

      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(response));

      logger.info(
        `[kakao] Sent response to ${userId.slice(0, 8)}...: "${result.text.slice(0, 50)}${result.text.length > 50 ? "..." : ""}"${supabaseReady ? ` (credits: -${creditsUsed})` : ""}`,
      );
    } catch (err) {
      logger.error(`[kakao] Error processing message: ${err}`);
      onError?.(err instanceof Error ? err : new Error(String(err)));

      // Send error response
      const response = apiClient.buildSkillResponse(
        "죄송합니다. 메시지 처리 중 오류가 발생했습니다. 잠시 후 다시 시도해주세요.",
      );
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(response));
    }
  };

  return new Promise((resolve, reject) => {
    server = createServer(handleRequest);

    server.on("error", (err) => {
      logger.error(`[kakao] Server error: ${err}`);
      reject(err);
    });

    // Handle abort signal
    if (abortSignal) {
      abortSignal.addEventListener("abort", () => {
        server?.close();
      });
    }

    server.listen(port, host, () => {
      const url = `http://${host === "0.0.0.0" ? "localhost" : host}:${port}${path}`;
      logger.info(`[kakao] Webhook server started at ${url}`);

      resolve({
        port,
        url,
        stop: async () => {
          return new Promise((res) => {
            if (server) {
              server.close(() => {
                logger.info("[kakao] Webhook server stopped");
                res();
              });
            } else {
              res();
            }
          });
        },
      });
    });
  });
}

/**
 * Parse Kakao webhook request body
 */
export function parseKakaoWebhookBody(body: string): KakaoIncomingMessage | null {
  try {
    return JSON.parse(body) as KakaoIncomingMessage;
  } catch {
    return null;
  }
}

/**
 * Build error response for Kakao
 */
export function buildKakaoErrorResponse(message: string): KakaoSkillResponse {
  return {
    version: "2.0",
    template: {
      outputs: [{ simpleText: { text: message } }],
    },
  };
}

/**
 * Validate Kakao webhook request (optional signature verification)
 */
export function validateKakaoWebhook(
  headers: Record<string, string | string[] | undefined>,
  _body: string,
  _secretKey?: string,
): boolean {
  // Kakao i Open Builder doesn't have built-in signature verification
  // You can implement custom validation here if needed
  // _body and _secretKey are reserved for future signature verification

  // For now, just check Content-Type
  const contentType = headers["content-type"];
  if (typeof contentType === "string" && !contentType.includes("application/json")) {
    return false;
  }

  return true;
}

/**
 * Extract user info from Kakao request
 */
export function extractKakaoUserInfo(request: KakaoIncomingMessage): {
  userId: string;
  userType: string;
  timezone: string;
  lang: string | null;
  properties: Record<string, string>;
} {
  return {
    userId: request.userRequest?.user?.id ?? "",
    userType: request.userRequest?.user?.type ?? "",
    timezone: request.userRequest?.timezone ?? "Asia/Seoul",
    lang: request.userRequest?.lang ?? null,
    properties: request.userRequest?.user?.properties ?? {},
  };
}

// ============================================
// Moltbot Command Handling
// ============================================

interface MoltbotCommand {
  isCommand: boolean;
  type?: "tools" | "channels" | "bridge" | "status" | "memory" | "help" | "install" | "subscribe" | "subscribe_status" | "device_status" | "device_detail" | "relay" | "relay_multi" | "relay_register" | "relay_devices" | "relay_remove" | "relay_status" | "relay_confirm" | "relay_reject" | "relay_result" | "phone_register";
  args?: string[];
  bridgeCmd?: ReturnType<typeof parseBridgeCommand>;
  /** For relay commands: target device name */
  relayDevice?: string;
  /** For multi-device commands: target device names */
  relayDevices?: string[];
  /** For relay commands: the command text to send */
  relayCommand?: string;
}

/**
 * Parse Moltbot-specific commands
 */
function parseMoltbotCommand(message: string): MoltbotCommand {
  const trimmed = message.trim();

  // Check for @ prefix direct command (쌍둥이 MoA 직접 호출)
  // Formats: @노트북 ls -la, @노트북,@태블릿 git pull, @모두 df -h
  if (trimmed.startsWith("@")) {
    const parsed = parseDirectCommand(trimmed);
    if (parsed) {
      if (parsed.targetDevices.length === 1 && !parsed.isAllDevices) {
        // Single device: use existing relay type
        return {
          isCommand: true,
          type: "relay",
          relayDevice: parsed.targetDevices[0],
          relayCommand: parsed.command,
        };
      }
      // Multiple devices or @모두: use new relay_multi type
      return {
        isCommand: true,
        type: "relay_multi",
        relayDevices: parsed.targetDevices,
        relayCommand: parsed.command,
      };
    }
  }

  // Check for bridge command first
  const bridgeCmd = parseBridgeCommand(trimmed);
  if (bridgeCmd.isCommand) {
    return { isCommand: true, type: "bridge", bridgeCmd };
  }

  // Tool list command: /도구, /도구목록, /tools
  if (/^[/\/](도구|도구목록|tools?)(\s|$)/i.test(trimmed)) {
    const args = trimmed.split(/\s+/).slice(1);
    return { isCommand: true, type: "tools", args };
  }

  // Channel list command: /채널, /채널목록, /channels
  if (/^[/\/](채널|채널목록|channels?)(\s|$)/i.test(trimmed)) {
    return { isCommand: true, type: "channels" };
  }

  // Status command: /상태, /status
  if (/^[/\/](상태|status)$/i.test(trimmed)) {
    return { isCommand: true, type: "status" };
  }

  // Memory search command: /기억, /memory
  if (/^[/\/](기억|memory)\s+(.+)$/i.test(trimmed)) {
    const match = trimmed.match(/^[/\/](기억|memory)\s+(.+)$/i);
    return { isCommand: true, type: "memory", args: match ? [match[2]] : [] };
  }

  // Help command: /도움말, /help
  if (/^[/\/](도움말|help)$/i.test(trimmed)) {
    return { isCommand: true, type: "help" };
  }

  // Install command: /설치, /install
  if (/^[/\/](설치|install)$/i.test(trimmed)) {
    return { isCommand: true, type: "install" };
  }

  // Subscribe command: /구독, /subscribe [plan]
  const subscribeMatch = trimmed.match(/^[/\/](구독|subscribe)(\s+(.+))?$/i);
  if (subscribeMatch) {
    const planArg = subscribeMatch[3]?.trim();
    return { isCommand: true, type: "subscribe", args: planArg ? [planArg] : [] };
  }

  // Subscription status: /구독상태, /subscription
  if (/^[/\/](구독상태|subscription|나의구독)$/i.test(trimmed)) {
    return { isCommand: true, type: "subscribe_status" };
  }

  // Device status: /연결상태, /device-status
  if (/^[/\/](연결상태|연결|device[-_]?status|connection)$/i.test(trimmed)) {
    return { isCommand: true, type: "device_status" };
  }

  // Device detail: /기기상태 <name>, /device <name>
  const deviceDetailMatch = trimmed.match(/^[/\/](기기상태|기기정보|device)\s+(.+)$/i);
  if (deviceDetailMatch) {
    return { isCommand: true, type: "device_detail", args: [deviceDetailMatch[2].trim()] };
  }

  // Relay commands: /원격, /기기등록, /기기, /기기삭제, /원격상태
  // /원격 <device_name> <command>
  const relayMatch = trimmed.match(/^[/\/](원격|remote)\s+(\S+)\s+(.+)$/is);
  if (relayMatch) {
    return {
      isCommand: true,
      type: "relay",
      relayDevice: relayMatch[2],
      relayCommand: relayMatch[3],
    };
  }

  // /기기등록, /register-device
  if (/^[/\/](기기등록|register[-_]?device)$/i.test(trimmed)) {
    return { isCommand: true, type: "relay_register" };
  }

  // /기기, /devices — list devices
  if (/^[/\/](기기|기기목록|devices?)$/i.test(trimmed)) {
    return { isCommand: true, type: "relay_devices" };
  }

  // /기기삭제 <name>, /remove-device <name>
  const removeMatch = trimmed.match(/^[/\/](기기삭제|remove[-_]?device)\s+(.+)$/i);
  if (removeMatch) {
    return { isCommand: true, type: "relay_remove", args: [removeMatch[2].trim()] };
  }

  // /원격상태, /relay-status
  if (/^[/\/](원격상태|relay[-_]?status)$/i.test(trimmed)) {
    return { isCommand: true, type: "relay_status" };
  }

  // /확인 <id_prefix> — confirm a dangerous command
  const confirmMatch = trimmed.match(/^[/\/](확인|confirm)\s+(\S+)$/i);
  if (confirmMatch) {
    return { isCommand: true, type: "relay_confirm", args: [confirmMatch[2]] };
  }

  // /거부 <id_prefix> — reject a dangerous command
  const rejectMatch = trimmed.match(/^[/\/](거부|reject|취소)\s+(\S+)$/i);
  if (rejectMatch) {
    return { isCommand: true, type: "relay_reject", args: [rejectMatch[2]] };
  }

  // /원격결과 <id_prefix> — view execution log and result
  const resultMatch = trimmed.match(/^[/\/](원격결과|relay[-_]?result|결과)\s+(\S+)$/i);
  if (resultMatch) {
    return { isCommand: true, type: "relay_result", args: [resultMatch[2]] };
  }

  // /전화번호 010-XXXX-XXXX — register phone number for proactive notifications
  const phoneMatch = trimmed.match(/^[/\/]?전화번호\s+([\d\-]+)$/i);
  if (phoneMatch) {
    return { isCommand: true, type: "phone_register", args: [phoneMatch[1]] };
  }

  // Pure phone number pattern (010으로 시작하는 메시지)
  const purePhoneMatch = trimmed.match(/^(010[\d\-]{8,12})$/);
  if (purePhoneMatch) {
    return { isCommand: true, type: "phone_register", args: [purePhoneMatch[1]] };
  }

  return { isCommand: false };
}

/**
 * Handle Moltbot-specific commands
 */
async function handleMoltbotCommand(
  cmd: MoltbotCommand,
  userId: string,
  agent: MoltbotAgentIntegration | undefined,
  logger: { info: (msg: string) => void },
): Promise<{ text: string; quickReplies?: string[] }> {
  switch (cmd.type) {
    case "tools": {
      const category = cmd.args?.[0];
      const validCategories = ["communication", "information", "execution", "session", "memory", "media", "channel"];
      const categoryMap: Record<string, string> = {
        통신: "communication",
        정보: "information",
        실행: "execution",
        세션: "session",
        메모리: "memory",
        미디어: "media",
        채널: "channel",
      };

      const normalizedCategory = category
        ? categoryMap[category] ?? category
        : undefined;

      if (normalizedCategory && !validCategories.includes(normalizedCategory)) {
        return {
          text: `알 수 없는 카테고리: ${category}\n\n사용 가능한 카테고리: ${validCategories.join(", ")}`,
        };
      }

      return {
        text: formatToolList(normalizedCategory as Parameters<typeof formatToolList>[0]),
        quickReplies: ["도구 통신", "도구 정보", "도구 실행"],
      };
    }

    case "channels": {
      return {
        text: formatChannelList(),
        quickReplies: ["전송 telegram", "전송 discord", "전송 slack"],
      };
    }

    case "bridge": {
      if (!agent) {
        return {
          text: "Moltbot 에이전트가 연결되지 않았습니다.\nGateway가 실행 중인지 확인해주세요.",
        };
      }

      const bridgeCmd = cmd.bridgeCmd;
      if (!bridgeCmd || bridgeCmd.error) {
        return {
          text: bridgeCmd?.error ?? "브리지 명령 파싱 실패",
        };
      }

      if (!bridgeCmd.channel || !bridgeCmd.recipient || !bridgeCmd.text) {
        return {
          text: "사용법: /전송 <채널> <받는사람> <메시지>\n\n예시:\n/전송 telegram @username 안녕하세요\n/전송 discord #channel Hello",
        };
      }

      const result = await agent.sendToChannel(
        bridgeCmd.channel,
        bridgeCmd.recipient,
        bridgeCmd.text,
        { userId, channel: "kakao" },
      );

      if (!result.success) {
        return {
          text: `메시지 전송 실패: ${result.error}`,
        };
      }

      logger.info(`[kakao] Bridge message sent to ${bridgeCmd.channel}:${bridgeCmd.recipient}`);
      return {
        text: `✅ ${bridgeCmd.channel} 채널의 ${bridgeCmd.recipient}에게 메시지를 전송했습니다.`,
      };
    }

    case "status": {
      if (!agent) {
        return {
          text: "📊 **Moltbot 상태**\n\n❌ 에이전트 미연결\n\nGateway가 실행 중인지 확인해주세요.",
        };
      }

      const status = await agent.getStatus();
      let text = "📊 **Moltbot 상태**\n\n";

      if (status.online) {
        text += `✅ Gateway: 온라인\n`;
        text += `📦 버전: ${status.version ?? "알 수 없음"}\n`;
        text += `🤖 Agent: ${status.agentId ?? "알 수 없음"}\n`;
        if (status.memoryStats) {
          text += `\n📚 메모리 상태:\n`;
          text += `• 파일: ${status.memoryStats.files}개\n`;
          text += `• 청크: ${status.memoryStats.chunks}개\n`;
        }
      } else {
        text += `❌ Gateway: 오프라인\n`;
        text += `오류: ${status.error ?? "연결 실패"}`;
      }

      return { text };
    }

    case "memory": {
      const query = cmd.args?.[0];
      if (!query) {
        return {
          text: "사용법: /기억 <검색어>\n\n예시: /기억 지난주 회의 내용",
        };
      }

      if (!agent) {
        return {
          text: "Moltbot 에이전트가 연결되지 않았습니다.",
        };
      }

      const result = await agent.searchMemory(query, { maxResults: 5 });

      if (!result.success) {
        return {
          text: `메모리 검색 실패: ${result.error}`,
        };
      }

      if (!result.results?.length) {
        return {
          text: `"${query}"에 대한 검색 결과가 없습니다.`,
        };
      }

      let text = `🔍 **"${query}" 검색 결과**\n\n`;
      for (const r of result.results) {
        text += `📄 ${r.path} (점수: ${(r.score * 100).toFixed(0)}%)\n`;
        text += `${r.snippet.slice(0, 200)}${r.snippet.length > 200 ? "..." : ""}\n\n`;
      }

      return { text };
    }

    case "help": {
      return {
        text: `📖 **MoA 명령어 도움말**

**쌍둥이 MoA 직접 호출**
• \`@노트북 ls -la\` - 단일 기기 명령
• \`@노트북,@태블릿 git pull\` - 다중 기기 동시 명령
• \`@모두 df -h\` - 모든 온라인 기기에 명령

**디바이스 관리**
• \`/기기\` - 내 쌍둥이 MoA 목록
• \`/연결상태\` - 실시간 연결 상태 (안정성 포함)
• \`/기기상태 <이름>\` - 특정 기기 상세 정보
• \`/기기등록\` - 새 기기 페어링 코드
• \`/확인 <ID>\` - 위험 명령 승인
• \`/거부 <ID>\` - 명령 거부 (크레딧 환불)
• \`/원격결과 <ID>\` - 실행 로그 확인

**메모리 동기화**
• \`/동기화 설정 <암호>\` - 동기화 시작
• \`/동기화 업로드\` - 메모리 업로드
• \`/동기화 다운로드\` - 메모리 다운로드
• \`/동기화 상태\` - 상태 확인

**Moltbot 도구**
• \`/도구\` - 도구 목록 보기
• \`/도구 <카테고리>\` - 카테고리별 도구

**채널 연동**
• \`/채널\` - 연결 가능한 채널 목록
• \`/전송 <채널> <받는사람> <메시지>\` - 메시지 전송

**메모리 검색**
• \`/기억 <검색어>\` - AI 메모리 검색

**상태 확인**
• \`/상태\` - Moltbot 상태 확인

**결제 & 구독**
• \`잔액\` - 크레딧 확인
• \`충전\` - 크레딧 충전
• \`/구독\` - 구독 플랜 보기
• \`/구독상태\` - 내 구독 확인

**알림 설정**
• \`/전화번호 010-1234-5678\` - 알림 받을 번호 등록
• 기기 등록 완료 시 Friend Talk으로 환영 메시지 전송

**설치**
• \`/설치\` - 다른 기기에 MoA 설치`,
        quickReplies: ["기기", "설치", "구독", "도움말"],
      };
    }

    // ============================================
    // Install & Subscription Commands
    // ============================================

    case "install": {
      // /설치 - 설치 링크 제공 (페어링 코드 포함)
      const supabase = getSupabase();
      let installUserId: string;

      const { data: existingUser } = await supabase
        .from("lawcall_users")
        .select("id")
        .eq("kakao_user_id", userId)
        .single();

      if (existingUser) {
        installUserId = existingUser.id;
      } else {
        const { data: newUser } = await supabase
          .from("lawcall_users")
          .insert({ kakao_user_id: userId })
          .select("id")
          .single();
        if (!newUser) {
          return { text: "사용자 등록에 실패했습니다." };
        }
        installUserId = newUser.id;
      }

      // 페어링 코드 생성
      const codeResult = await generatePairingCode(installUserId);
      if ("error" in codeResult) {
        return { text: codeResult.error };
      }

      const installUrl = `${DEFAULT_INSTALLER_CONFIG.installPageUrl}?code=${codeResult.code}`;
      const betaText = isBetaPeriod() ? "🎉 베타 기간 무료!" : "";

      return {
        text: `📲 **MoA 설치하기**
━━━━━━━━━━━━━━━━━━━━━━
${betaText}

🔗 **원클릭 설치 링크**
${installUrl}

📝 **페어링 코드**
\`${codeResult.code}\`
(10분간 유효)

💻 **지원 플랫폼**
${PLATFORM_INSTALLERS.map((p) => `${p.icon} ${p.displayName}`).join(" | ")}

설치 후 페어링 코드를 입력하면 자동으로 연결됩니다!`,
        quickReplies: ["기기", "구독", "도움말"],
      };
    }

    case "subscribe": {
      // /구독 [plan] - 구독 플랜 보기 또는 구독
      const planArg = cmd.args?.[0];

      if (!planArg) {
        // 플랜 목록 표시
        return {
          text: formatPlanComparison(),
          quickReplies: ["구독 베이직", "구독 프로", "구독상태"],
        };
      }

      // 플랜 구독 (결제 연동 필요 - 추후 구현)
      const planMap: Record<string, string> = {
        베이직: "basic",
        basic: "basic",
        프로: "pro",
        pro: "pro",
        엔터프라이즈: "enterprise",
        enterprise: "enterprise",
      };

      const planType = planMap[planArg.toLowerCase()];
      if (!planType) {
        return {
          text: `알 수 없는 플랜: ${planArg}\n\n사용 가능한 플랜: 베이직, 프로, 엔터프라이즈`,
          quickReplies: ["구독 베이직", "구독 프로", "구독상태"],
        };
      }

      // TODO: 결제 연동 (토스페이먼츠, 카카오페이 등)
      return {
        text: `💳 **${planArg} 구독 신청**

결제 시스템 준비 중입니다.
베타 기간 동안은 무료로 이용하실 수 있습니다!

문의: support@lawith.com`,
        quickReplies: ["구독상태", "기기", "도움말"],
      };
    }

    case "subscribe_status": {
      // /구독상태 - 내 구독 정보 표시
      const subscription = await getUserSubscription(userId);

      if (!subscription) {
        return {
          text: "구독 정보를 찾을 수 없습니다. 먼저 MoA를 설치해주세요.",
          quickReplies: ["설치", "구독"],
        };
      }

      return {
        text: formatSubscriptionStatus(subscription),
        quickReplies: ["구독", "기기", "도움말"],
      };
    }

    // ============================================
    // Device Status Commands
    // ============================================

    case "device_status": {
      // /연결상태 - 실시간 디바이스 상태 보기
      const supabase = getSupabase();
      const { data: statusUser } = await supabase
        .from("lawcall_users")
        .select("id")
        .eq("kakao_user_id", userId)
        .single();

      if (!statusUser) {
        return {
          text: "등록된 기기가 없습니다. /기기등록 명령으로 먼저 기기를 등록해주세요.",
          quickReplies: ["기기등록", "설치"],
        };
      }

      const deviceStatuses = await getDetailedDeviceStatus(statusUser.id);

      if (deviceStatuses.length === 0) {
        return {
          text: "등록된 기기가 없습니다.\n\n/설치 명령으로 다른 기기에 MoA를 설치하세요.",
          quickReplies: ["설치", "기기등록"],
        };
      }

      const statusText = formatDeviceStatusSummary(deviceStatuses);

      // Quick replies for online devices
      const quickReplies: string[] = [];
      for (const d of deviceStatuses) {
        if (d.isOnline) {
          quickReplies.push(`@${d.deviceName} `);
        }
      }
      quickReplies.push("기기등록", "설치");

      return { text: statusText, quickReplies: quickReplies.slice(0, 10) };
    }

    case "device_detail": {
      // /기기상태 <name> - 특정 기기 상세 상태
      const deviceName = cmd.args?.[0];
      if (!deviceName) {
        return {
          text: "사용법: /기기상태 <기기명>\n\n예시: /기기상태 노트북",
          quickReplies: ["연결상태", "기기"],
        };
      }

      const supabase = getSupabase();
      const { data: detailUser } = await supabase
        .from("lawcall_users")
        .select("id")
        .eq("kakao_user_id", userId)
        .single();

      if (!detailUser) {
        return { text: "사용자 정보를 찾을 수 없습니다." };
      }

      // Find device by name
      const allDevices = await getDetailedDeviceStatus(detailUser.id);
      const device = allDevices.find(
        (d) => d.deviceName.toLowerCase() === deviceName.toLowerCase()
      );

      if (!device) {
        const deviceNames = allDevices.map((d) => d.deviceName).join(", ");
        return {
          text: `"${deviceName}" 기기를 찾을 수 없습니다.\n\n등록된 기기: ${deviceNames || "없음"}`,
          quickReplies: ["연결상태", "기기"],
        };
      }

      const detailText = formatDeviceStatusDetail(device);

      return {
        text: detailText,
        quickReplies: [`@${device.deviceName} `, "연결상태", "기기"],
      };
    }

    // ============================================
    // Relay Commands
    // ============================================

    case "relay": {
      // /원격 <device_name> <command>
      if (!cmd.relayDevice || !cmd.relayCommand) {
        return {
          text: "사용법: /원격 <기기명> <명령>\n\n예시:\n/원격 노트북 ls ~/Desktop\n/원격 사무실PC 파일읽기 ~/memo.txt",
          quickReplies: ["기기", "기기등록", "원격상태"],
        };
      }

      // Get Supabase user ID for billing
      const supabase = getSupabase();
      const { data: relayUser } = await supabase
        .from("lawcall_users")
        .select("id")
        .eq("kakao_user_id", userId)
        .single();

      if (!relayUser) {
        return { text: "사용자 정보를 찾을 수 없습니다. 먼저 메시지를 보내 계정을 활성화해주세요." };
      }

      const result = await sendRelayCommand({
        userId: relayUser.id,
        targetDeviceName: cmd.relayDevice,
        commandText: cmd.relayCommand,
      });

      if (!result.success) {
        return { text: result.error ?? "명령 전송에 실패했습니다.", quickReplies: ["기기", "기기등록"] };
      }

      // If the command requires confirmation (dangerous command detected)
      if (result.confirmationRequired && result.safetyWarning) {
        return {
          text: result.safetyWarning,
          quickReplies: [`확인 ${result.commandId?.slice(0, 8)}`, `거부 ${result.commandId?.slice(0, 8)}`, "기기"],
        };
      }

      const config = getRelayBillingConfig();
      return {
        text: `"${cmd.relayDevice}" 기기로 명령을 전송했습니다.\n\n명령: ${cmd.relayCommand.slice(0, 100)}\n비용: ${config.commandCost} 크레딧\n\n실행 상태 확인: /원격결과 ${result.commandId?.slice(0, 8)}`,
        quickReplies: [`원격결과 ${result.commandId?.slice(0, 8)}`, "원격상태", "기기"],
      };
    }

    case "relay_multi": {
      // @노트북,@태블릿 git pull OR @모두 df -h (multi-device command)
      if (!cmd.relayDevices || !cmd.relayCommand) {
        return {
          text: "사용법:\n• @노트북,@태블릿 git pull (다중 기기)\n• @모두 df -h (모든 온라인 기기)",
          quickReplies: ["기기", "기기등록"],
        };
      }

      // Get Supabase user ID for billing
      const supabase = getSupabase();
      const { data: multiUser } = await supabase
        .from("lawcall_users")
        .select("id")
        .eq("kakao_user_id", userId)
        .single();

      if (!multiUser) {
        return { text: "사용자 정보를 찾을 수 없습니다. 먼저 메시지를 보내 계정을 활성화해주세요." };
      }

      const multiResult = await sendMultiDeviceCommand({
        userId: multiUser.id,
        targetDeviceNames: cmd.relayDevices,
        commandText: cmd.relayCommand,
      });

      const resultText = formatMultiDeviceResult(multiResult, cmd.relayCommand);

      // Build quick replies with command IDs for successful results
      const quickReplies: string[] = [];
      for (const r of multiResult.results) {
        if (r.success && r.commandId) {
          if (r.confirmationRequired) {
            quickReplies.push(`확인 ${r.commandId.slice(0, 8)}`);
          } else {
            quickReplies.push(`원격결과 ${r.commandId.slice(0, 8)}`);
          }
        }
      }
      quickReplies.push("기기");

      return { text: resultText, quickReplies: quickReplies.slice(0, 10) }; // KakaoTalk max 10 quick replies
    }

    case "relay_register": {
      // /기기등록 — generate pairing code
      const supabase = getSupabase();
      const { data: regUser } = await supabase
        .from("lawcall_users")
        .select("id")
        .eq("kakao_user_id", userId)
        .single();

      if (!regUser) {
        // Create user first
        const { data: newUser } = await supabase
          .from("lawcall_users")
          .insert({ kakao_user_id: userId })
          .select("id")
          .single();
        if (!newUser) {
          return { text: "사용자 등록에 실패했습니다." };
        }
        const codeResult = await generatePairingCode(newUser.id);
        if ("error" in codeResult) {
          return { text: codeResult.error };
        }
        return formatPairingCodeResponse(codeResult.code, codeResult.expiresAt);
      }

      const codeResult = await generatePairingCode(regUser.id);
      if ("error" in codeResult) {
        return { text: codeResult.error };
      }
      return formatPairingCodeResponse(codeResult.code, codeResult.expiresAt);
    }

    case "relay_devices": {
      // /기기 — list registered devices (쌍둥이 MoA 상태)
      const supabase = getSupabase();
      const { data: devUser } = await supabase
        .from("lawcall_users")
        .select("id")
        .eq("kakao_user_id", userId)
        .single();

      if (!devUser) {
        return { text: "등록된 기기가 없습니다. /기기등록 명령으로 먼저 기기를 등록해주세요.", quickReplies: ["기기등록"] };
      }

      const twinStatus = await getTwinMoAStatus(devUser.id);

      if (twinStatus.totalDevices === 0) {
        return {
          text: "등록된 기기가 없습니다.\n\n/기기등록 명령으로 기기를 등록해주세요.\n\n각 기기에 moltbot을 설치하면 모두 동일한 기억을 공유하는 쌍둥이 MoA가 됩니다!",
          quickReplies: ["기기등록"],
        };
      }

      const text = formatTwinMoAStatus(twinStatus);

      // Generate quick replies for online devices
      const quickReplies: string[] = [];
      for (const d of twinStatus.devices) {
        if (d.isOnline) {
          quickReplies.push(`@${d.name} `);
        }
      }
      quickReplies.push("기기등록", "원격상태");

      return { text, quickReplies: quickReplies.slice(0, 10) };
    }

    case "relay_remove": {
      // /기기삭제 <name>
      const deviceName = cmd.args?.[0];
      if (!deviceName) {
        return { text: "사용법: /기기삭제 <기기명>\n\n예시: /기기삭제 노트북" };
      }

      const supabase = getSupabase();
      const { data: rmUser } = await supabase
        .from("lawcall_users")
        .select("id")
        .eq("kakao_user_id", userId)
        .single();

      if (!rmUser) {
        return { text: "등록된 기기가 없습니다." };
      }

      const removed = await removeDevice(rmUser.id, deviceName);
      if (removed) {
        return { text: `"${deviceName}" 기기가 삭제되었습니다.`, quickReplies: ["기기"] };
      }
      return { text: `"${deviceName}" 기기를 찾을 수 없습니다.`, quickReplies: ["기기"] };
    }

    case "relay_status": {
      // /원격상태 — recent relay commands
      const supabase = getSupabase();
      const { data: statusUser } = await supabase
        .from("lawcall_users")
        .select("id")
        .eq("kakao_user_id", userId)
        .single();

      if (!statusUser) {
        return { text: "사용 이력이 없습니다.", quickReplies: ["기기등록"] };
      }

      const [recentCmds, stats] = await Promise.all([
        getRecentCommands(statusUser.id, 5),
        getRelayUsageStats(statusUser.id),
      ]);

      let text = `📊 **원격 명령 현황**\n\n`;
      text += `총 명령: ${stats.totalCommands}회 | 오늘: ${stats.commandsToday}회\n`;
      text += `사용 크레딧: ${stats.totalCreditsUsed}\n\n`;

      if (recentCmds.length > 0) {
        text += `**최근 명령:**\n`;
        for (const c of recentCmds) {
          const statusIcon = {
            pending: "⏳", awaiting_confirmation: "🔐", delivered: "📤", executing: "⚙️",
            completed: "✅", failed: "❌", expired: "⏰", cancelled: "🚫",
          }[c.status] ?? "❓";
          const preview = c.commandPreview ? ` \`${c.commandPreview.slice(0, 30)}\`` : "";
          const riskBadge = c.riskLevel === "high" ? " ⚠️" : "";
          text += `${statusIcon}${riskBadge} ${c.deviceName}:${preview} ${c.summary?.slice(0, 30) ?? c.status} (${formatTimeAgo(c.createdAt)})\n`;
          if (c.status === "awaiting_confirmation") {
            text += `   → /확인 ${c.id.slice(0, 8)} 또는 /거부 ${c.id.slice(0, 8)}\n`;
          } else if (c.status === "completed" || c.status === "executing") {
            text += `   → /원격결과 ${c.id.slice(0, 8)}\n`;
          }
        }
      } else {
        text += "최근 명령 이력이 없습니다.";
      }

      return { text, quickReplies: ["기기", "기기등록"] };
    }

    // ============================================
    // Confirmation & Monitoring Commands
    // ============================================

    case "relay_confirm": {
      // /확인 <id_prefix> — approve a dangerous command
      const idPrefix = cmd.args?.[0];
      if (!idPrefix) {
        return { text: "사용법: /확인 <명령ID>\n\n/원격상태에서 확인 대기 중인 명령의 ID를 확인하세요." };
      }

      const supabase = getSupabase();
      const { data: cfmUser } = await supabase
        .from("lawcall_users")
        .select("id")
        .eq("kakao_user_id", userId)
        .single();

      if (!cfmUser) {
        return { text: "사용자 정보를 찾을 수 없습니다." };
      }

      const cfmResult = await confirmCommand(idPrefix, cfmUser.id);
      if (!cfmResult.success) {
        return { text: cfmResult.error ?? "확인 처리에 실패했습니다.", quickReplies: ["원격상태"] };
      }

      return {
        text: `✅ 명령이 승인되었습니다.\n\n명령: \`${cfmResult.commandPreview?.slice(0, 100) ?? "알 수 없음"}\`\n\n기기로 전송 중입니다. 결과 확인: /원격결과 ${cfmResult.commandId?.slice(0, 8)}`,
        quickReplies: [`원격결과 ${cfmResult.commandId?.slice(0, 8)}`, "원격상태"],
      };
    }

    case "relay_reject": {
      // /거부 <id_prefix> — reject a dangerous command
      const idPrefix = cmd.args?.[0];
      if (!idPrefix) {
        return { text: "사용법: /거부 <명령ID>" };
      }

      const supabase = getSupabase();
      const { data: rejUser } = await supabase
        .from("lawcall_users")
        .select("id")
        .eq("kakao_user_id", userId)
        .single();

      if (!rejUser) {
        return { text: "사용자 정보를 찾을 수 없습니다." };
      }

      const rejResult = await rejectCommand(idPrefix, rejUser.id);
      if (!rejResult.success) {
        return { text: rejResult.error ?? "거부 처리에 실패했습니다.", quickReplies: ["원격상태"] };
      }

      const refundMsg = rejResult.refundedCredits
        ? `\n${rejResult.refundedCredits} 크레딧이 환불되었습니다.`
        : "";
      return {
        text: `🚫 명령이 취소되었습니다.${refundMsg}`,
        quickReplies: ["원격상태", "기기"],
      };
    }

    case "relay_result": {
      // /원격결과 <id_prefix> — view execution log
      const idPrefix = cmd.args?.[0];
      if (!idPrefix) {
        return { text: "사용법: /원격결과 <명령ID>\n\n/원격상태에서 명령 ID를 확인하세요." };
      }

      const supabase = getSupabase();
      const { data: resUser } = await supabase
        .from("lawcall_users")
        .select("id")
        .eq("kakao_user_id", userId)
        .single();

      if (!resUser) {
        return { text: "사용자 정보를 찾을 수 없습니다." };
      }

      // Find command by prefix
      const { data: cmds } = await supabase
        .from("relay_commands")
        .select("id")
        .eq("user_id", resUser.id)
        .like("id", `${idPrefix}%`)
        .limit(1);

      if (!cmds || cmds.length === 0) {
        return { text: "명령을 찾을 수 없습니다.", quickReplies: ["원격상태"] };
      }

      const execLog = await getExecutionLog(cmds[0].id, resUser.id);
      const statusLabel = {
        pending: "⏳ 대기 중", awaiting_confirmation: "🔐 확인 대기", delivered: "📤 전달됨",
        executing: "⚙️ 실행 중", completed: "✅ 완료", failed: "❌ 실패",
        expired: "⏰ 만료", cancelled: "🚫 취소",
      }[execLog.status] ?? execLog.status;

      let text = `📋 **명령 실행 상세**\n\n`;
      text += `상태: ${statusLabel}\n`;
      if (execLog.riskLevel) {
        const riskLabel = { low: "🟢 안전", medium: "🟡 주의", high: "🟠 위험" }[execLog.riskLevel] ?? execLog.riskLevel;
        text += `위험도: ${riskLabel}\n`;
      }
      if (execLog.commandPreview) {
        text += `명령: \`${execLog.commandPreview.slice(0, 100)}\`\n`;
      }

      // Show execution log
      if (execLog.log.length > 0) {
        text += `\n**실행 로그:**\n`;
        for (const entry of execLog.log.slice(-10)) {
          const time = new Date(entry.timestamp);
          const timeStr = `${time.getHours().toString().padStart(2, "0")}:${time.getMinutes().toString().padStart(2, "0")}:${time.getSeconds().toString().padStart(2, "0")}`;
          text += `[${timeStr}] ${entry.message}\n`;
          if (entry.data) {
            text += `  ${entry.data.slice(0, 200)}\n`;
          }
        }
      }

      // Show result if completed
      if (execLog.summary) {
        text += `\n**결과:**\n${execLog.summary.slice(0, 500)}`;
      }
      if (execLog.result?.output) {
        text += `\n**출력:**\n\`\`\`\n${execLog.result.output.slice(0, 500)}\n\`\`\``;
      }
      if (execLog.result?.error) {
        text += `\n**오류:**\n${execLog.result.error.slice(0, 300)}`;
      }

      return { text, quickReplies: ["원격상태", "기기"] };
    }

    // ============================================
    // Phone Number Registration
    // ============================================

    case "phone_register": {
      const phoneNumber = cmd.args?.[0];
      if (!phoneNumber) {
        return {
          text: "사용법: /전화번호 010-1234-5678\n\n전화번호를 등록하면 기기 연결 완료 시 카카오톡 Friend Talk으로 알림을 받을 수 있습니다.",
          quickReplies: ["기기등록", "도움말"],
        };
      }

      const supabase = getSupabase();
      // Ensure user exists
      let phoneUserId: string;
      const { data: existingPhoneUser } = await supabase
        .from("lawcall_users")
        .select("id")
        .eq("kakao_user_id", userId)
        .single();

      if (existingPhoneUser) {
        phoneUserId = existingPhoneUser.id;
      } else {
        const { data: newPhoneUser } = await supabase
          .from("lawcall_users")
          .insert({ kakao_user_id: userId })
          .select("id")
          .single();
        if (!newPhoneUser) {
          return { text: "사용자 등록에 실패했습니다." };
        }
        phoneUserId = newPhoneUser.id;
      }

      const storeResult = await storeUserPhoneNumber(userId, phoneNumber);

      if (!storeResult.success) {
        return {
          text: storeResult.error ?? "전화번호 저장에 실패했습니다.",
          quickReplies: ["도움말"],
        };
      }

      return {
        text: `✅ 전화번호가 등록되었습니다!\n\n등록 번호: ${phoneNumber}\n\n이제 기기를 등록하면 완료 시 Friend Talk으로 환영 메시지를 받으실 수 있습니다.\n\n기기를 등록하시려면 "기기등록"이라고 입력하세요.`,
        quickReplies: ["기기등록", "기기", "도움말"],
      };
    }

    default:
      return {
        text: "알 수 없는 명령입니다. /도움말을 입력해주세요.",
      };
  }
}

// ============================================
// Relay Helpers
// ============================================

function formatPairingCodeResponse(code: string, expiresAt: Date): { text: string; quickReplies?: string[] } {
  const minutes = Math.ceil((expiresAt.getTime() - Date.now()) / 60000);
  return {
    text: `🔗 **기기 페어링 코드**\n\n코드: **${code}**\n만료: ${minutes}분 후\n\n등록할 기기에서 다음 명령을 실행하세요:\n\nmoltbot relay pair --code ${code} --name "기기이름"\n\n또는 API로 직접 등록:\nPOST /api/relay/pair\n{"code": "${code}", "device": {"deviceName": "기기이름", "deviceType": "laptop"}}\n\n💡 전화번호를 등록하면 기기 연결 시 알림을 받을 수 있습니다.\n예: /전화번호 010-1234-5678`,
    quickReplies: ["기기", "도움말"],
  };
}

function formatTimeAgo(date: Date): string {
  const seconds = Math.floor((Date.now() - date.getTime()) / 1000);
  if (seconds < 60) return "방금 전";
  if (seconds < 3600) return `${Math.floor(seconds / 60)}분 전`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}시간 전`;
  return `${Math.floor(seconds / 86400)}일 전`;
}
