import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { randomBytes } from "node:crypto";
import type { KakaoIncomingMessage, KakaoSkillResponse, ResolvedKakaoAccount } from "./types.js";
import { createKakaoApiClient } from "./api-client.js";
import { getConsultationButton, isLegalQuestion } from "./lawcall-router.js";
import {
  handleBillingCommand,
  preBillingCheck,
  postBillingDeduct,
  getCreditStatusMessage,
} from "./billing-handler.js";
import { handleSyncCommand, isSyncCommand, type SyncCommandContext } from "./sync/index.js";
import { getSupabase } from "./supabase.js";
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
  getRelayUsageStats,
  getRelayBillingConfig,
} from "./relay/index.js";

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
  }) => Promise<{ text: string; quickReplies?: string[] }>;
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
      // Step 0: Check for sync commands (/동기화, /sync)
      if (isSyncCommand(utterance)) {
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

      // Step 0.5: Check for Moltbot-specific commands
      const moltbotCmd = parseMoltbotCommand(utterance);
      if (moltbotCmd.isCommand) {
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

      // Step 1: Check for billing commands (잔액, 충전, API키 등록 등)
      const billingCmd = await handleBillingCommand(userId, utterance);
      if (billingCmd.handled) {
        let response: KakaoSkillResponse;
        if (billingCmd.paymentUrl) {
          // Build response with payment link button
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

      // Step 3: Call the message handler (this will route to Moltbot agent)
      const usedPlatformKey = !billingCheck.billingCheck?.useCustomKey;
      const result = await onMessage({
        userId,
        userType,
        text: utterance,
        botId,
        blockId,
        timestamp: Date.now(),
      });

      // Step 4: Post-billing deduct (if using platform API key)
      // Estimate tokens: ~4 chars per token for Korean
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

      // Step 5: Append credit status to response (if charged)
      const creditMessage = await getCreditStatusMessage(userId, billingResult.creditsUsed, usedPlatformKey);
      const finalText = result.text + creditMessage;

      // Check if this is a legal question and add consultation button
      let response: KakaoSkillResponse;

      if (isLegalQuestion(utterance) || isLegalQuestion(result.text)) {
        const consultButton = getConsultationButton(utterance);
        response = apiClient.buildTextWithButtonResponse(
          finalText,
          consultButton.label,
          consultButton.url,
          result.quickReplies,
        );
        logger.info(`[kakao] Detected legal question, added ${consultButton.category} link`);
      } else {
        response = apiClient.buildSkillResponse(finalText, result.quickReplies);
      }

      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(response));

      logger.info(
        `[kakao] Sent response to ${userId.slice(0, 8)}...: "${result.text.slice(0, 50)}${result.text.length > 50 ? "..." : ""}" (credits: -${billingResult.creditsUsed})`,
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
  type?: "tools" | "channels" | "bridge" | "status" | "memory" | "help" | "relay" | "relay_register" | "relay_devices" | "relay_remove" | "relay_status";
  args?: string[];
  bridgeCmd?: ReturnType<typeof parseBridgeCommand>;
  /** For relay commands: target device name */
  relayDevice?: string;
  /** For relay commands: the command text to send */
  relayCommand?: string;
}

/**
 * Parse Moltbot-specific commands
 */
function parseMoltbotCommand(message: string): MoltbotCommand {
  const trimmed = message.trim();

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

**원격 제어 (Relay)**
• \`/기기등록\` - 새 기기 페어링 코드 발급
• \`/기기\` - 등록된 기기 목록
• \`/원격 <기기명> <명령>\` - 원격 명령 전송
• \`/기기삭제 <기기명>\` - 기기 등록 해제
• \`/원격상태\` - 원격 명령 이력

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

**결제**
• \`잔액\` - 크레딧 확인
• \`충전\` - 크레딧 충전`,
        quickReplies: ["기기", "기기등록", "원격상태", "도구"],
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

      const config = getRelayBillingConfig();
      return {
        text: `"${cmd.relayDevice}" 기기로 명령을 전송했습니다.\n\n명령: ${cmd.relayCommand.slice(0, 100)}\n비용: ${config.commandCost} 크레딧\n\n기기가 명령을 실행하면 결과를 알려드리겠습니다.`,
        quickReplies: ["원격상태", "기기"],
      };
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
      // /기기 — list registered devices
      const supabase = getSupabase();
      const { data: devUser } = await supabase
        .from("lawcall_users")
        .select("id")
        .eq("kakao_user_id", userId)
        .single();

      if (!devUser) {
        return { text: "등록된 기기가 없습니다. /기기등록 명령으로 먼저 기기를 등록해주세요.", quickReplies: ["기기등록"] };
      }

      const devices = await listUserDevices(devUser.id);

      if (devices.length === 0) {
        return {
          text: "등록된 기기가 없습니다.\n\n/기기등록 명령으로 기기를 등록해주세요.",
          quickReplies: ["기기등록"],
        };
      }

      let text = `📱 **등록된 기기 (${devices.length}개)**\n\n`;
      for (const d of devices) {
        const status = d.isOnline ? "🟢 온라인" : "🔴 오프라인";
        const lastSeen = d.lastSeenAt
          ? `마지막 접속: ${formatTimeAgo(d.lastSeenAt)}`
          : "접속 기록 없음";
        text += `**${d.deviceName}** (${d.deviceType})\n`;
        text += `${status} | ${d.platform ?? "알 수 없음"} | ${lastSeen}\n\n`;
      }
      text += `\n사용법: /원격 <기기명> <명령>`;

      return { text, quickReplies: ["기기등록", "원격상태"] };
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
            pending: "⏳", delivered: "📤", executing: "⚙️",
            completed: "✅", failed: "❌", expired: "⏰", cancelled: "🚫",
          }[c.status] ?? "❓";
          text += `${statusIcon} ${c.deviceName}: ${c.summary?.slice(0, 50) ?? c.status} (${formatTimeAgo(c.createdAt)})\n`;
        }
      } else {
        text += "최근 명령 이력이 없습니다.";
      }

      return { text, quickReplies: ["기기", "기기등록"] };
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
    text: `🔗 **기기 페어링 코드**\n\n코드: **${code}**\n만료: ${minutes}분 후\n\n등록할 기기에서 다음 명령을 실행하세요:\n\nmoltbot relay pair --code ${code} --name "기기이름"\n\n또는 API로 직접 등록:\nPOST /api/relay/pair\n{"code": "${code}", "device": {"deviceName": "기기이름", "deviceType": "laptop"}}`,
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
