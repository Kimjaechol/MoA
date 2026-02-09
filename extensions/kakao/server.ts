/**
 * MoA (Master of AI) — Standalone Kakao Webhook Server
 *
 * Railway/Docker entry point that starts the Kakao webhook directly
 * without requiring the full OpenClaw gateway.
 *
 * Usage: ./node_modules/.bin/tsx extensions/kakao/server.ts
 *
 * ## Environment Variables
 *
 * ### Required
 * - PORT / KAKAO_WEBHOOK_PORT — Server port (default: 8788)
 * - KAKAO_APP_KEY / KAKAO_JAVASCRIPT_KEY — Kakao App Key
 * - KAKAO_ADMIN_KEY / KAKAO_REST_API_KEY — Kakao Admin Key
 *
 * ### LLM Provider (at least one required for AI chat)
 * - ANTHROPIC_API_KEY — Anthropic Claude API key
 * - OPENAI_API_KEY — OpenAI API key
 * - GOOGLE_API_KEY / GEMINI_API_KEY — Google Gemini API key
 * - GROQ_API_KEY — Groq API key
 * - MOA_MODEL — Override default model for the selected provider
 *
 * ### Supabase (for billing, sync, relay, phone storage)
 * - SUPABASE_URL — Supabase project URL
 * - SUPABASE_KEY — Supabase anon/service key
 *
 * ### Kakao Channel & Toast API (for Friend Talk / Alim Talk)
 * - KAKAO_CHANNEL_ID — Kakao Talk Channel ID
 * - KAKAO_SENDER_KEY — Kakao Talk Channel sender profile key
 * - TOAST_APP_KEY — NHN Cloud Toast App Key
 * - TOAST_SECRET_KEY — NHN Cloud Toast Secret Key
 *
 * ### Optional
 * - HOST — Bind address (default: 0.0.0.0)
 * - KAKAO_WEBHOOK_PATH — Webhook path (default: /kakao/webhook)
 * - MOA_INSTALL_URL — Override install page URL
 * - RAILWAY_PUBLIC_DOMAIN — Auto-set by Railway for public URL
 * - WHATSAPP_APP_SECRET — Meta App Secret for webhook signature verification (optional but recommended)
 * - LAWCALL_ENCRYPTION_KEY — Encryption key for relay commands
 * - RELAY_MAX_DEVICES — Max devices per user (default: 5)
 *
 * ### Owner Authentication (recommended for production)
 * - MOA_OWNER_SECRET — Secret phrase for owner authentication (if set, enables owner-only mode)
 * - MOA_OWNER_IDS — Pre-configured owner IDs (format: "kakao:id1,telegram:id2,discord:id3")
 * - MOA_DATA_DIR — Data directory for persisting auth state (default: .moa-data)
 */

// Immediate startup log — if you see this in Railway deploy logs,
// it means server.ts is running (not the OpenClaw CLI)
console.log(
  "[MoA] server.ts entry point loaded — this is the MoA webhook server, NOT OpenClaw CLI",
);

import type { RelayCallbacks } from "./src/relay/index.js";
import type { ResolvedKakaoAccount } from "./src/types.js";
import type { MoAMessageHandler } from "./src/channels/types.js";
import { resolveKakaoAccount, getDefaultKakaoConfig } from "./src/config.js";
import { handleInstallRequest } from "./src/installer/index.js";
import { handleSettingsRequest } from "./src/settings/index.js";
import { handlePaymentRequest } from "./src/payment/index.js";
import {
  sendWelcomeAfterPairing,
  isProactiveMessagingConfigured,
} from "./src/proactive-messaging.js";
import { generatePairingCode, handleRelayRequest } from "./src/relay/index.js";
import { isSupabaseConfigured } from "./src/supabase.js";
import { startKakaoWebhook } from "./src/webhook.js";
import {
  handleTelegramRequest,
  registerTelegramWebhook,
  getTelegramBotInfo,
  isTelegramConfigured,
  handleWhatsAppRequest,
  isWhatsAppConfigured,
  startDiscordGateway,
  stopDiscordGateway,
  isDiscordConfigured,
} from "./src/channels/index.js";
import {
  getLoadedSkills,
  getSkillsSystemPrompt,
  searchSkills,
  formatSkillCatalog,
  formatSkillDetail,
  getUserFriendlyRecommendedSkills,
} from "./src/skills/index.js";
import {
  logAction,
  updateActionStatus,
  getRecentActions,
  getUndoableActions,
  createCheckpoint,
  getCheckpoints,
  getMemoryHistory,
  undoAction,
  rollbackToCheckpoint,
  formatActionHistory,
  formatCheckpointList,
  formatMemoryHistory,
  assessCommandGravity,
  executePanic,
  isPanicLocked,
  releasePanicLock,
  cancelPendingCommand,
  getPendingCommands,
  guardianAngelCheck,
  formatGravityAssessment,
  formatPendingCommands,
  // Encrypted Vault
  initializeVault,
  createEncryptedBackup,
  restoreFromBackup,
  generateRecoveryKey,
  verifyRecoveryKey,
  listBackups,
  getBackupStats,
  runScheduledBackup,
  formatBackupList,
  formatRecoveryKey,
} from "./src/safety/index.js";
import {
  authenticateUser,
  isOwnerAuthEnabled,
  getRequiredPermission,
  getGuestDeniedResponse,
  wrapUserMessageForLLM,
  getSecuritySystemPrompt,
  hasUserSecret,
  setUserSecret,
  changeUserSecret,
  getUserSecretCount,
} from "./src/auth/index.js";

const PORT = parseInt(process.env.PORT ?? process.env.KAKAO_WEBHOOK_PORT ?? "8788", 10);
const HOST = process.env.HOST ?? "0.0.0.0";
const WEBHOOK_PATH = process.env.KAKAO_WEBHOOK_PATH ?? "/kakao/webhook";

/**
 * MoA install page URL — always use the public-facing domain.
 *
 * Vercel (moa.lawith.kr) proxies /install to Railway via rewrites,
 * so users always see a single consistent domain regardless of whether
 * they come from KakaoTalk, the website, or a direct link.
 *
 * NOTE: If MOA_INSTALL_URL is set in Railway env vars, delete it —
 * it is no longer used to avoid stale/wrong URLs.
 */
function getInstallUrl(): string {
  return "https://moa.lawith.kr/install";
}

// ============================================
// MoA Welcome & Onboarding Messages
// ============================================

const MOA_WELCOME_MESSAGE = `MoA 어시스턴트 채널에 방문해주셔서 감사합니다!

MoA(Master of AI)는 당신의 모든 기기를 하나의 AI로 연결하는 차세대 AI 에이전트입니다.

1. MoA란?
MoA는 노트북, 태블릿, 데스크탑 등 여러 기기에 설치되어 동일한 기억을 공유하는 AI 에이전트입니다. 한 기기에서 작업한 내용을 다른 기기에서도 이어서 할 수 있고, 카카오톡에서 명령을 보내면 연결된 기기에서 원격으로 실행됩니다.

2. MoA의 핵심 기능
- 쌍둥이 AI: 모든 기기가 같은 기억을 공유
- 원격 제어: 카카오톡에서 기기에 명령 전송
- AI 대화: 언제 어디서나 AI와 대화
- 파일 관리: 기기 간 파일 확인 및 관리
- 코드 실행: 원격으로 코드 작성 및 실행

3. MoA 활용 방법
- 외출 중 집 컴퓨터에 파일 확인 요청
- 카카오톡으로 노트북에 코드 실행 지시
- 여러 기기의 상태를 한눈에 확인
- AI에게 일상적인 질문이나 업무 도움 요청

4. MoA 사용 사례
- "회사 컴퓨터에 있는 보고서 내용 알려줘"
- "@노트북 git pull && npm run build"
- "어제 작업한 프로젝트 진행상황 알려줘"
- "오늘 일정 정리해줘"

지금 바로 MoA를 설치하고 AI의 새로운 경험을 시작하세요!
"설치" 라고 입력하시면 간편 설치를 안내해드립니다.`;

const MOA_INSTALL_GUIDE = `MoA 설치는 아주 간단합니다!

[1단계] 아래 "MoA 설치하기" 버튼을 클릭하세요.
사용하시는 기기(Windows/Mac/Linux)에 맞는 설치 파일이 다운로드됩니다. 다운로드된 파일을 더블클릭하면 자동으로 설치됩니다.

[2단계] 설치 완료 후 자동으로 열리는 페이지에서 "이 기기등록" 버튼을 클릭하세요.
6자리 페어링 코드가 발급됩니다.

[3단계] 같은 페이지에서 받은 6자리 코드를 입력하면 끝!
터미널이나 명령어 입력은 필요없습니다.

추가 기기도 같은 방법으로 등록하면 모든 기기가 하나의 AI로 연결됩니다!`;

// ============================================
// Account Config Builder
// ============================================

/**
 * Build a minimal account config from environment variables
 */
function buildAccountFromEnv(): ResolvedKakaoAccount | null {
  // Try resolving via standard config mechanism (reads env vars internally)
  const account = resolveKakaoAccount({
    cfg: {
      channels: {
        kakao: {
          accounts: {
            default: getDefaultKakaoConfig(),
          },
        },
      },
    },
    accountId: "default",
  });

  if (account) {
    // Override webhook settings from env
    account.config = {
      ...account.config,
      webhookPort: PORT,
      webhookPath: WEBHOOK_PATH,
    };
    return account;
  }

  // Build minimal account even without Kakao keys (webhook still works for health checks)
  return {
    accountId: "default",
    enabled: true,
    appKey: process.env.KAKAO_APP_KEY ?? process.env.KAKAO_JAVASCRIPT_KEY ?? "",
    adminKey: process.env.KAKAO_ADMIN_KEY ?? process.env.KAKAO_REST_API_KEY ?? "",
    channelId: process.env.KAKAO_CHANNEL_ID,
    senderKey: process.env.KAKAO_SENDER_KEY,
    toastAppKey: process.env.TOAST_APP_KEY,
    toastSecretKey: process.env.TOAST_SECRET_KEY,
    config: {
      ...getDefaultKakaoConfig(),
      webhookPort: PORT,
      webhookPath: WEBHOOK_PATH,
    },
  };
}

// ============================================
// LLM Provider Detection & API Calls
// ============================================

/**
 * Detect which LLM API key is available and return provider info
 */
function detectLlmProvider(): {
  provider: string;
  apiKey: string;
  model: string;
  endpoint: string;
} | null {
  // Priority: Anthropic > OpenAI > Google Gemini > Groq
  if (process.env.ANTHROPIC_API_KEY) {
    return {
      provider: "anthropic",
      apiKey: process.env.ANTHROPIC_API_KEY,
      model: process.env.MOA_MODEL ?? "claude-3-5-haiku-20241022",
      endpoint: "https://api.anthropic.com/v1/messages",
    };
  }
  if (process.env.OPENAI_API_KEY) {
    return {
      provider: "openai",
      apiKey: process.env.OPENAI_API_KEY,
      model: process.env.MOA_MODEL ?? "gpt-4o-mini",
      endpoint: "https://api.openai.com/v1/chat/completions",
    };
  }
  if (process.env.GOOGLE_API_KEY ?? process.env.GEMINI_API_KEY) {
    return {
      provider: "google",
      apiKey: (process.env.GOOGLE_API_KEY ?? process.env.GEMINI_API_KEY)!,
      model: process.env.MOA_MODEL ?? "gemini-2.0-flash",
      endpoint: "https://generativelanguage.googleapis.com/v1beta/models",
    };
  }
  if (process.env.GROQ_API_KEY) {
    return {
      provider: "groq",
      apiKey: process.env.GROQ_API_KEY,
      model: process.env.MOA_MODEL ?? "llama-3.3-70b-versatile",
      endpoint: "https://api.groq.com/openai/v1/chat/completions",
    };
  }
  return null;
}

/**
 * Call Anthropic API
 */
async function callAnthropic(
  apiKey: string,
  model: string,
  systemPrompt: string,
  userMessage: string,
): Promise<string> {
  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      max_tokens: 1000,
      system: systemPrompt,
      messages: [{ role: "user", content: userMessage }],
    }),
    signal: AbortSignal.timeout(25000),
  });

  if (!response.ok) {
    const err = (await response.json().catch(() => ({}))) as Record<string, unknown>;
    throw new Error(
      `Anthropic API ${response.status}: ${(err as { error?: { message?: string } }).error?.message ?? response.statusText}`,
    );
  }

  const data = (await response.json()) as { content: Array<{ type: string; text?: string }> };
  return data.content.find((c) => c.type === "text")?.text ?? "";
}

/**
 * Call OpenAI-compatible API (OpenAI, Groq)
 */
async function callOpenAICompatible(
  endpoint: string,
  apiKey: string,
  model: string,
  systemPrompt: string,
  userMessage: string,
): Promise<string> {
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      max_tokens: 1000,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userMessage },
      ],
    }),
    signal: AbortSignal.timeout(25000),
  });

  if (!response.ok) {
    const err = (await response.json().catch(() => ({}))) as Record<string, unknown>;
    throw new Error(
      `API ${response.status}: ${(err as { error?: { message?: string } }).error?.message ?? response.statusText}`,
    );
  }

  const data = (await response.json()) as { choices: Array<{ message: { content: string } }> };
  return data.choices[0]?.message?.content ?? "";
}

/**
 * Call Google Gemini API
 */
async function callGemini(
  apiKey: string,
  model: string,
  systemPrompt: string,
  userMessage: string,
): Promise<string> {
  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: systemPrompt }] },
        contents: [{ role: "user", parts: [{ text: userMessage }] }],
        generationConfig: { maxOutputTokens: 1000 },
      }),
      signal: AbortSignal.timeout(25000),
    },
  );

  if (!response.ok) {
    const err = (await response.json().catch(() => ({}))) as Record<string, unknown>;
    throw new Error(
      `Gemini API ${response.status}: ${(err as { error?: { message?: string } }).error?.message ?? response.statusText}`,
    );
  }

  const data = (await response.json()) as {
    candidates: Array<{ content: { parts: Array<{ text: string }> } }>;
  };
  return data.candidates?.[0]?.content?.parts?.map((p) => p.text).join("") ?? "";
}

// ============================================
// MoA System Prompt
// ============================================

function getMoASystemPrompt(channelId?: string): string {
  const channelName = channelId === "telegram" ? "텔레그램"
    : channelId === "whatsapp" ? "WhatsApp"
    : channelId === "discord" ? "Discord"
    : "카카오톡";

  const maxLen = channelId === "kakao" || !channelId ? 800 : 2000;

  // Build skills section dynamically
  const skillsPrompt = getSkillsSystemPrompt();

  return `당신은 MoA(Master of AI) 어시스턴트입니다.

## MoA란?
MoA는 사용자의 여러 기기(노트북, 태블릿, 데스크탑 등)에 설치되어 동일한 기억을 공유하는 AI 에이전트입니다.
${channelName}에서 명령을 보내면 연결된 기기에서 원격으로 실행할 수 있습니다.

## 지원 채널
MoA는 카카오톡, 텔레그램, WhatsApp, Discord 등 여러 메신저에서 동일하게 사용할 수 있습니다.
한 채널에서 등록한 기기는 다른 채널에서도 그대로 사용 가능합니다.

## 당신의 최우선 목표
사용자가 MoA 에이전트를 기기에 설치하도록 안내하고 유도하는 것이 가장 중요합니다.
대화 중 자연스럽게 MoA 설치의 장점을 알리고, "설치"라고 입력하면 설치 안내를 받을 수 있다고 알려주세요.

## MoA의 핵심 기능
- 쌍둥이 AI: 모든 기기가 같은 기억을 공유하는 AI
- 원격 제어: ${channelName}에서 "@기기명 명령"으로 기기에 원격 명령
- AI 대화: ${channelName}에서 언제든 AI와 대화
- 파일 관리: 외출 중에도 집/회사 컴퓨터 파일 확인
- 코드 실행: 원격으로 코드 작성 및 실행

## 주요 명령어
- 설치 : MoA 간편 설치 안내
- !비밀구문 [구문] : 본인 인증용 비밀구문 설정 (기기 등록 전 필수)
- !인증 [비밀구문] : 본인 인증 (기기 제어 활성화)
- /기기등록 : 새 기기 페어링 (비밀구문 설정 + 인증 후)
- /기기 : 연결된 기기 목록
- @기기명 명령 : 특정 기기에 원격 명령 (예: @노트북 ls ~/Desktop)
- /도움말 : 전체 명령어 보기
- !작업내역 : 최근 작업 기록 조회
- !체크포인트 [이름] : 현재 시점 저장 (되돌리기 가능)
- !되돌리기 [ID] : 특정 작업 되돌리기
- !복원 [체크포인트ID] : 체크포인트 시점으로 전체 복원
- !기억내역 : 장기 기억 버전 히스토리
- !비상정지 : 모든 대기 명령 취소 + 기기 잠금
- !취소 [ID] : 대기 중인 명령 취소
- !대기목록 : 실행 대기 중인 명령 조회
- !백업 : 수동 암호화 백업 생성
- !백업 목록 : 저장된 백업 목록 조회
- !백업 복원 [파일명] : 백업에서 복원
- !복구키 : 12단어 복구 키 발급
- !복구키 검증 [12단어] : 복구 키 검증
${skillsPrompt}
## 응답 규칙
- 한국어로 친절하고 자연스럽게 대화합니다
- 최대 ${maxLen}자 이내로 답변하세요
- 사용자가 MoA와 관련 없는 질문을 해도 친절히 답변하되, 자연스럽게 MoA 기능을 연결하세요
  예) "일정 관리 도와줘" → 답변 후 "MoA를 설치하면 컴퓨터에서 일정 파일을 직접 관리할 수도 있어요!"
- MoA가 아직 설치되지 않은 사용자에게는 대화 마무리에 설치를 부드럽게 권유하세요
- 확실하지 않은 정보는 그렇다고 솔직히 말씀하세요
- 스킬 관련 질문이 오면 해당 스킬의 기능을 안내하고, MoA를 설치하면 기기에서 직접 사용할 수 있다고 안내하세요

## 설치 안내 시
사용자가 설치에 관심을 보이면: "설치"라고 입력해주세요! 간편 설치 안내를 바로 보내드립니다.
설치 후 https://moa.lawith.kr/welcome 페이지에서 기기 등록(페어링)을 할 수 있습니다.

## 사용 사례 (사용자에게 설명할 때 활용)
- "회사에서 퇴근 후 집 컴퓨터에 있는 파일 확인"
- "@노트북 git pull && npm run build"
- "${channelName}으로 서버 상태 확인"
- "여러 기기에서 이어서 작업"`;
}

// ============================================
// Greeting / Install Detection
// ============================================

/** Check if message is a greeting or first-time visit */
function isGreeting(text: string): boolean {
  const greetings = [
    "안녕",
    "하이",
    "헬로",
    "hi",
    "hello",
    "hey",
    "반가",
    "처음",
    "시작",
    "뭐해",
    "누구",
    "소개",
    "알려줘",
    "뭐야",
  ];
  const normalized = text.toLowerCase().trim();
  return greetings.some((g) => normalized.includes(g)) || normalized.length <= 2;
}

/** Check if user is asking about installation */
function isInstallRequest(text: string): boolean {
  const installKeywords = [
    "설치",
    "install",
    "다운로드",
    "download",
    "받기",
    "시작하기",
    "어떻게 써",
    "사용법",
    "가입",
  ];
  const normalized = text.toLowerCase().trim();
  return installKeywords.some((k) => normalized.includes(k));
}

/** Check if user wants to register a device (pairing) */
function isDeviceRegistration(text: string): boolean {
  const keywords = ["기기등록", "기기 등록", "이 기기등록", "디바이스 등록", "페어링"];
  const normalized = text.toLowerCase().trim();
  return keywords.some((k) => normalized.includes(k));
}

// ============================================
// AI Message Handler
// ============================================

/**
 * AI message handler — handles greetings, install requests, and general AI chat.
 * All messages pass through owner authentication gate first.
 */
async function aiOnMessage(params: {
  userId: string;
  userType: string;
  text: string;
  botId: string;
  blockId: string;
  timestamp: number;
  channel?: import("./src/channels/types.js").ChannelContext;
}): Promise<{
  text: string;
  quickReplies?: string[];
  buttons?: Array<{ label: string; url: string }>;
}> {
  const utterance = params.text.trim();
  const channelId = params.channel?.channelId ?? "kakao";
  const maxLen = params.channel?.maxMessageLength ?? 950;

  // ── Owner Authentication Gate ──────────────────────────────
  const auth = authenticateUser(params.userId, channelId, utterance);

  // Handle auth attempts (!인증 <secret>)
  if (auth.isAuthAttempt) {
    // Release panic lock on successful re-auth
    if (auth.authSuccess && isPanicLocked()) {
      releasePanicLock();
    }
    return {
      text: auth.authMessage ?? "인증 처리 중 오류가 발생했습니다.",
      quickReplies: auth.authSuccess ? ["기기 목록", "도움말"] : ["설치", "기능 소개"],
    };
  }

  // ── Secret Phrase Setup (비밀구문 설정 — 누구나 가능) ─────
  const secretSetMatch = utterance.match(/^[!!/](?:비밀구문|비밀 구문|secret)\s+(.+)$/i);
  if (secretSetMatch) {
    const newSecret = secretSetMatch[1].trim();

    // Check if user already has a secret → need to use change command
    if (hasUserSecret(params.userId, channelId)) {
      return {
        text: "이미 비밀구문이 설정되어 있습니다.\n\n변경하려면:\n!비밀구문 변경 [현재구문] [새구문]\n\n인증하려면:\n!인증 [비밀구문]",
        quickReplies: ["!인증", "도움말"],
      };
    }

    const error = setUserSecret(params.userId, channelId, newSecret);
    if (error) {
      return { text: `비밀구문 설정 실패: ${error}`, quickReplies: ["도움말"] };
    }

    return {
      text: `비밀구문이 설정되었습니다!\n\n이제 "!인증 [비밀구문]"으로 본인 인증을 할 수 있습니다.\n인증 후 기기 등록과 제어가 가능합니다.\n\n기기를 등록하시려면 "기기등록"을 입력하세요.`,
      quickReplies: ["!인증", "기기등록", "도움말"],
    };
  }

  // !비밀구문 변경 [현재구문] [새구문]
  const secretChangeMatch = utterance.match(
    /^[!!/](?:비밀구문|비밀 구문|secret)\s*(?:변경|change)\s+(\S+)\s+(\S+)$/i,
  );
  if (secretChangeMatch) {
    const oldSecret = secretChangeMatch[1];
    const newSecret = secretChangeMatch[2];
    const error = changeUserSecret(params.userId, channelId, oldSecret, newSecret);
    if (error) {
      return { text: `비밀구문 변경 실패: ${error}`, quickReplies: ["도움말"] };
    }
    return {
      text: "비밀구문이 변경되었습니다.\n다음 인증 시 새 비밀구문을 사용해주세요.",
      quickReplies: ["!인증", "도움말"],
    };
  }

  // ── Panic Button (누구나, 언제든) ─────────────────────────
  if (utterance.match(/^[!!/](?:비상정지|비상 정지|panic|stop|긴급|emergency)$/i)) {
    if (auth.role !== "owner") {
      return { text: "비상정지는 인증된 주인만 사용할 수 있습니다.", quickReplies: ["설치"] };
    }
    const result = executePanic(params.userId, channelId);
    return { text: result.message, quickReplies: ["!작업내역"] };
  }

  // ── Cancel pending command ─────────────────────────────────
  const cancelMatch = utterance.match(/^[!!/](?:취소|cancel)\s*(\S+)?$/i);
  if (cancelMatch && auth.role === "owner") {
    const commandId = cancelMatch[1];
    if (commandId) {
      const cancelled = cancelPendingCommand(commandId);
      return {
        text: cancelled ? `명령 ${commandId}가 취소되었습니다.` : `대기 중인 명령 ${commandId}를 찾을 수 없습니다.`,
        quickReplies: ["!대기목록", "!작업내역"],
      };
    }
    // No ID — show pending list
    const pending = getPendingCommands();
    return {
      text: formatPendingCommands(pending),
      quickReplies: ["!비상정지", "!작업내역"],
    };
  }

  // ── Show pending commands ──────────────────────────────────
  if (utterance.match(/^[!!/](?:대기목록|대기 목록|pending)$/i) && auth.role === "owner") {
    const pending = getPendingCommands();
    return {
      text: formatPendingCommands(pending),
      quickReplies: ["!비상정지", "!작업내역"],
    };
  }

  // ── Panic lock check (block device commands during lockdown) ─
  if (isPanicLocked() && auth.role === "owner" && utterance.startsWith("@")) {
    return {
      text: "🚨 비상정지 상태입니다. 기기 제어가 잠겨 있습니다.\n\n재개하려면 \"!인증 [비밀구문]\"으로 다시 인증하세요.",
      quickReplies: ["!작업내역", "!체크포인트 목록"],
    };
  }

  // If guest, check if this action requires owner permission
  if (auth.role === "guest") {
    const requiredAction = getRequiredPermission(utterance);
    if (requiredAction) {
      // Block owner-only action for guests
      const denied = getGuestDeniedResponse(requiredAction);
      return denied;
    }
    // Guest is allowed for greeting/install/feature/skill/general chat — continue below
  }

  // Handle owner deauth command
  if (auth.role === "owner" && utterance.match(/^[!!/]인증해제$/)) {
    const { revokeOwnerAuth } = await import("./src/auth/index.js");
    revokeOwnerAuth(params.userId, channelId);
    return {
      text: "주인 인증이 해제되었습니다.\n다시 인증하려면 \"!인증 [비밀구문]\"을 입력하세요.",
      quickReplies: ["도움말"],
    };
  }

  // ── Safety Commands (owner only) ──────────────────────────
  if (auth.role === "owner") {
    // !작업내역 — 최근 작업 기록 조회
    if (utterance.match(/^[!!/](?:작업내역|작업 내역|작업기록|history)$/i)) {
      const actions = getRecentActions(15);
      return {
        text: formatActionHistory(actions, maxLen),
        quickReplies: ["!체크포인트 목록", "!되돌리기 목록", "도움말"],
      };
    }

    // !되돌리기 [ID] — 특정 작업 되돌리기
    const undoMatch = utterance.match(/^[!!/](?:되돌리기|되돌려|undo)\s+(\S+)$/i);
    if (undoMatch) {
      const result = undoAction(undoMatch[1]);
      return {
        text: result.message,
        quickReplies: ["!작업내역", "!체크포인트 목록"],
      };
    }

    // !되돌리기 목록 — 되돌릴 수 있는 작업 목록
    if (utterance.match(/^[!!/](?:되돌리기|undo)\s*(?:목록|list)?$/i)) {
      const undoable = getUndoableActions(10);
      if (undoable.length === 0) {
        return {
          text: "되돌릴 수 있는 작업이 없습니다.",
          quickReplies: ["!작업내역", "!체크포인트 목록"],
        };
      }
      return {
        text: formatActionHistory(undoable, maxLen),
        quickReplies: ["!작업내역", "!체크포인트 목록"],
      };
    }

    // !체크포인트 [이름] — 체크포인트 생성
    const cpCreateMatch = utterance.match(/^[!!/](?:체크포인트|checkpoint|저장)\s+(.+)$/i);
    if (cpCreateMatch && !cpCreateMatch[1].match(/^(?:목록|list)$/i)) {
      const cpName = cpCreateMatch[1].trim();
      const cp = createCheckpoint({
        name: cpName,
        description: `수동 체크포인트: ${cpName}`,
        auto: false,
        userId: params.userId,
        channelId,
      });
      return {
        text: `체크포인트가 생성되었습니다!\n\n📌 ${cp.name}\nID: ${cp.id}\n시각: ${new Date(cp.createdAt).toLocaleString("ko-KR")}\n\n이 시점으로 언제든 되돌릴 수 있습니다.\n"!복원 ${cp.id}"`,
        quickReplies: ["!체크포인트 목록", "!작업내역"],
      };
    }

    // !체크포인트 목록 — 체크포인트 목록 조회
    if (utterance.match(/^[!!/](?:체크포인트|checkpoint)\s*(?:목록|list)?$/i)) {
      const checkpointList = getCheckpoints(15);
      return {
        text: formatCheckpointList(checkpointList, maxLen),
        quickReplies: ["!작업내역", "도움말"],
      };
    }

    // !복원 [체크포인트 ID] — 체크포인트로 되돌리기
    const restoreMatch = utterance.match(/^[!!/](?:복원|restore|롤백|rollback)\s+(\S+)$/i);
    if (restoreMatch) {
      const result = rollbackToCheckpoint(restoreMatch[1]);
      return {
        text: result.message,
        quickReplies: ["!작업내역", "!체크포인트 목록"],
      };
    }

    // !기억내역 — 장기 기억 버전 히스토리
    if (utterance.match(/^[!!/](?:기억내역|기억 내역|기억히스토리|memory\s*history)$/i)) {
      const history = getMemoryHistory(10);
      return {
        text: formatMemoryHistory(history, maxLen),
        quickReplies: ["!체크포인트 목록", "!작업내역"],
      };
    }

    // !기억복원 [버전] — 장기 기억 특정 버전으로 되돌리기
    const memRestoreMatch = utterance.match(/^[!!/](?:기억복원|memory\s*restore)\s+v?(\d+)$/i);
    if (memRestoreMatch) {
      const { restoreMemoryToVersion } = await import("./src/safety/index.js");
      const version = parseInt(memRestoreMatch[1], 10);
      const restored = restoreMemoryToVersion(version);
      if (restored) {
        return {
          text: `장기 기억이 v${version}으로 복원되었습니다.\n\n사유: ${restored.reason}\n시각: ${new Date(restored.createdAt).toLocaleString("ko-KR")}`,
          quickReplies: ["!기억내역", "!작업내역"],
        };
      }
      return {
        text: `v${version} 버전의 기억을 찾을 수 없습니다.\n"!기억내역"으로 사용 가능한 버전을 확인하세요.`,
        quickReplies: ["!기억내역"],
      };
    }

    // ── Encrypted Vault Commands ──────────────────────────────

    // !백업 — 수동 암호화 백업 생성
    if (utterance.match(/^[!!/](?:백업|backup)$/i)) {
      const secret = process.env.MOA_OWNER_SECRET;
      if (!secret) {
        return {
          text: "MOA_OWNER_SECRET이 설정되지 않아 백업을 생성할 수 없습니다.\n환경변수를 설정해주세요.",
          quickReplies: ["도움말"],
        };
      }
      try {
        const backupData = { timestamp: Date.now(), source: "manual", channelId };
        const result = createEncryptedBackup(backupData, secret, "manual");
        return {
          text: `암호화 백업이 생성되었습니다!\n\n파일: ${result.filePath.split("/").pop()}\n크기: ${(result.size / 1024).toFixed(1)}KB\n암호화: AES-256-GCM\n\n복원: "!백업 복원 [파일명]"`,
          quickReplies: ["!백업 목록", "!복구키", "!작업내역"],
        };
      } catch (err) {
        return {
          text: `백업 생성 중 오류가 발생했습니다.\n${err instanceof Error ? err.message : String(err)}`,
          quickReplies: ["!작업내역"],
        };
      }
    }

    // !백업 목록 — 백업 목록 조회
    if (utterance.match(/^[!!/](?:백업|backup)\s*(?:목록|list)$/i)) {
      const backups = listBackups();
      return {
        text: formatBackupList(backups, maxLen),
        quickReplies: ["!백업", "!복구키", "!작업내역"],
      };
    }

    // !백업 통계 — 백업 용량/통계
    if (utterance.match(/^[!!/](?:백업|backup)\s*(?:통계|stats|상태|status)$/i)) {
      const stats = getBackupStats();
      const lines = [
        "암호화 백업 통계",
        "",
        `총 파일: ${stats.totalFiles}개`,
        `총 크기: ${stats.totalSizeKB}KB`,
      ];
      for (const [type, info] of Object.entries(stats.byType)) {
        lines.push(`  ${type}: ${info.count}개 (${(info.size / 1024).toFixed(1)}KB)`);
      }
      if (stats.newestBackup) {
        lines.push(`\n최신: ${new Date(stats.newestBackup).toLocaleString("ko-KR")}`);
      }
      if (stats.oldestBackup) {
        lines.push(`최초: ${new Date(stats.oldestBackup).toLocaleString("ko-KR")}`);
      }
      return {
        text: lines.join("\n"),
        quickReplies: ["!백업 목록", "!백업", "!작업내역"],
      };
    }

    // !백업 복원 [파일명] — 암호화 백업 복원
    const restoreBackupMatch = utterance.match(/^[!!/](?:백업|backup)\s*(?:복원|restore)\s+(.+)$/i);
    if (restoreBackupMatch) {
      const secret = process.env.MOA_OWNER_SECRET;
      if (!secret) {
        return {
          text: "MOA_OWNER_SECRET이 설정되지 않아 복원할 수 없습니다.",
          quickReplies: ["도움말"],
        };
      }
      const fileName = restoreBackupMatch[1].trim();
      // Find the backup file
      const backups = listBackups();
      const target = backups.find((b) => b.fileName === fileName || b.filePath.endsWith(fileName));
      if (!target) {
        return {
          text: `"${fileName}" 백업 파일을 찾을 수 없습니다.\n\n"!백업 목록"으로 사용 가능한 백업을 확인하세요.`,
          quickReplies: ["!백업 목록"],
        };
      }
      const restored = restoreFromBackup(target.filePath, secret);
      if (restored) {
        return {
          text: `백업이 복원되었습니다!\n\n파일: ${target.fileName}\n시각: ${new Date(restored.timestamp).toLocaleString("ko-KR")}\n무결성: ${restored.verified ? "검증 완료" : "검증 실패 (데이터 손상 가능)"}`,
          quickReplies: ["!작업내역", "!백업 목록"],
        };
      }
      return {
        text: "백업 복원에 실패했습니다.\n비밀구문이 올바른지 확인하세요.",
        quickReplies: ["!백업 목록", "!복구키"],
      };
    }

    // !복구키 — 12단어 복구 키 발급
    if (utterance.match(/^[!!/](?:복구키|복구 키|recovery\s*key)$/i)) {
      try {
        const result = generateRecoveryKey();
        return {
          text: formatRecoveryKey(result),
          quickReplies: ["!백업 목록", "!작업내역"],
        };
      } catch (err) {
        return {
          text: `복구 키 발급 중 오류가 발생했습니다.\n${err instanceof Error ? err.message : String(err)}`,
          quickReplies: ["!작업내역"],
        };
      }
    }

    // !복구키 검증 [12단어] — 복구 키 검증
    const verifyMatch = utterance.match(/^[!!/](?:복구키|복구 키|recovery\s*key)\s*(?:검증|verify)\s+(.+)$/i);
    if (verifyMatch) {
      const words = verifyMatch[1].trim().split(/\s+/);
      if (words.length !== 12) {
        return {
          text: `복구 키는 12단어입니다. ${words.length}단어가 입력되었습니다.\n\n사용법: !복구키 검증 단어1 단어2 ... 단어12`,
          quickReplies: ["!복구키"],
        };
      }
      const valid = verifyRecoveryKey(words);
      return {
        text: valid
          ? "복구 키가 확인되었습니다! 이 키로 백업을 복원할 수 있습니다."
          : "복구 키가 일치하지 않습니다.\n올바른 12단어를 입력했는지 확인하세요.",
        quickReplies: ["!백업 목록", "!작업내역"],
      };
    }
  }

  // ── Device command: Gravity + Guardian Angel + Logging ─────
  if (auth.role === "owner" && utterance.startsWith("@")) {
    const deviceMatch = utterance.match(/^@(\S+)\s+(.+)$/);
    if (deviceMatch) {
      const commandText = deviceMatch[2];
      const deviceName = deviceMatch[1];

      // 1. Gravity assessment
      const gravity = assessCommandGravity(commandText);

      // 2. Guardian Angel check (for medium+ gravity)
      if (gravity.score >= 5) {
        const guardian = guardianAngelCheck(commandText, gravity);
        if (guardian.shouldBlock) {
          logAction({
            type: "device_command",
            summary: `@${deviceName} 명령 보류 (Guardian Angel)`,
            detail: utterance,
            reversibility: "reversible",
            userId: params.userId,
            channelId,
            deviceName,
          });
          return {
            text: guardian.additionalWarning ?? "이 명령의 실행이 보류되었습니다.",
            quickReplies: ["!취소", "!작업내역"],
          };
        }
        // Non-blocking warning
        if (guardian.additionalWarning && gravity.action === "confirm_required") {
          logAction({
            type: "device_command",
            summary: `@${deviceName} — 확인 대기 (위험도 ${gravity.score}/10)`,
            detail: utterance,
            reversibility: "partially_reversible",
            userId: params.userId,
            channelId,
            deviceName,
          });
          return {
            text: `${formatGravityAssessment(gravity)}\n${gravity.warning ?? ""}\n\n${guardian.additionalWarning}`,
            quickReplies: ["!확인", "!취소"],
          };
        }
      }

      // 3. Heavy commands → require confirmation
      if (gravity.action === "confirm_required" || gravity.action === "delayed_execution") {
        logAction({
          type: "device_command",
          summary: `@${deviceName} — 확인 대기 (위험도 ${gravity.score}/10)`,
          detail: utterance,
          reversibility: "partially_reversible",
          userId: params.userId,
          channelId,
          deviceName,
        });
        return {
          text: `${formatGravityAssessment(gravity)}\n${gravity.warning ?? ""}`,
          quickReplies: ["!확인", "!취소", "!작업내역"],
        };
      }

      // 4. Medium commands → auto checkpoint before execution
      if (gravity.action === "checkpoint_and_execute") {
        createCheckpoint({
          name: `pre-${deviceName}-${new Date().toISOString().slice(11, 19)}`,
          description: `@${deviceName} 명령 실행 전 자동 체크포인트`,
          auto: true,
          userId: params.userId,
          channelId,
        });
      }

      // 5. Log the action
      const action = logAction({
        type: "device_command",
        summary: `@${deviceName}에 명령 전송`,
        detail: utterance,
        reversibility: gravity.score >= 7 ? "partially_reversible" : "reversible",
        userId: params.userId,
        channelId,
        deviceName,
      });
      console.log(`[Safety] Device command ${action.id}: gravity=${gravity.score} — ${commandText.slice(0, 60)}`);
    }
  }

  // 1) Greeting → Return welcome message with install button
  if (isGreeting(utterance)) {
    return {
      text: MOA_WELCOME_MESSAGE,
      buttons: [{ label: "MoA 설치하기", url: getInstallUrl() }],
      quickReplies: ["설치", "이 기기등록", "기능 소개"],
    };
  }

  // 2) Install request → Return install guide with install + register buttons
  if (isInstallRequest(utterance)) {
    return {
      text: MOA_INSTALL_GUIDE,
      buttons: [{ label: "MoA 설치하기", url: getInstallUrl() }],
      quickReplies: ["이 기기등록", "기능 소개", "도움말"],
    };
  }

  // 3) Device registration → Check secret first, then generate pairing code
  if (isDeviceRegistration(utterance)) {
    // Step 1: Must set a secret phrase before pairing
    if (!hasUserSecret(params.userId, channelId)) {
      return {
        text: `기기 등록 전에 비밀구문을 먼저 설정해주세요.\n\n비밀구문은 본인 확인에 사용되며, 다른 사람이 내 기기를 제어하는 것을 방지합니다.\n\n아래와 같이 입력하세요:\n!비밀구문 [나만 아는 문장]\n\n예시:\n!비밀구문 커피는아메리카노가좋아\n\n비밀구문 설정 후 다시 "기기등록"을 입력하시면 됩니다.`,
        quickReplies: ["설치", "도움말"],
      };
    }

    // Step 2: Must be authenticated (after setting secret)
    if (auth.role !== "owner") {
      return {
        text: `기기를 등록하려면 먼저 인증해주세요.\n\n!인증 [내 비밀구문]`,
        quickReplies: ["도움말"],
      };
    }

    if (!isSupabaseConfigured()) {
      return {
        text: `기기 등록 기능이 현재 준비 중입니다.\n\nMoA가 설치되어 있지 않다면, 먼저 설치를 진행해주세요!`,
        buttons: [{ label: "MoA 설치하기", url: getInstallUrl() }],
        quickReplies: ["설치", "도움말"],
      };
    }

    try {
      const result = await generatePairingCode(params.userId);
      if (result.success && result.code) {
        return {
          text: `기기 등록을 위한 페어링 코드가 발급되었습니다!\n\n🔑 페어링 코드: ${result.code}\n⏰ 유효시간: 10분\n\n[사용 방법]\nMoA가 설치된 PC의 브라우저에서 아래 페이지를 열고 코드를 입력하세요:\nhttps://moa.lawith.kr/welcome\n\n(설치 직후라면 이미 열려 있습니다!)\n\n연결이 완료되면 카카오톡에서 바로 PC를 제어할 수 있습니다!`,
          quickReplies: ["기능 소개", "사용 사례", "도움말"],
        };
      }
      return {
        text: `페어링 코드 발급 중 문제가 발생했습니다.\n${result.error ?? "잠시 후 다시 시도해주세요."}\n\nMoA가 아직 설치되어 있지 않다면, 먼저 설치를 진행해주세요!`,
        buttons: [{ label: "MoA 설치하기", url: getInstallUrl() }],
        quickReplies: ["이 기기등록", "설치", "도움말"],
      };
    } catch (err) {
      console.error("[MoA] Pairing code generation error:", err);
      return {
        text: `페어링 코드 발급 중 오류가 발생했습니다.\n잠시 후 다시 시도해주세요.`,
        quickReplies: ["이 기기등록", "설치", "도움말"],
      };
    }
  }

  // 4) Feature inquiry
  const featureKeywords = ["기능", "뭘 할 수", "뭘 해", "할 수 있"];
  if (featureKeywords.some((k) => utterance.includes(k))) {
    return {
      text: `MoA의 핵심 기능을 소개합니다!

1. 쌍둥이 AI
여러 기기에 MoA를 설치하면 모든 기기가 동일한 기억을 공유합니다. 한 기기에서 나눈 대화를 다른 기기에서도 이어갈 수 있어요.

2. 카카오톡 원격 제어
"@노트북 ls ~/Desktop" 처럼 카카오톡에서 바로 기기에 명령을 보낼 수 있습니다.

3. AI 대화
일상적인 질문, 코딩 도움, 번역, 요약 등 무엇이든 물어보세요.

4. 파일 관리
외출 중에도 집이나 회사 컴퓨터의 파일을 확인하고 관리할 수 있습니다.

5. 다중 기기 동시 명령
"@모두 git pull" 처럼 모든 기기에 한 번에 명령을 보낼 수도 있습니다.

아래 버튼을 눌러 지금 바로 시작하세요!`,
      buttons: [{ label: "MoA 설치하기", url: getInstallUrl() }],
      quickReplies: ["설치", "이 기기등록", "사용 사례"],
    };
  }

  // 5) Usage examples inquiry
  const usageKeywords = ["사용 사례", "사례", "예시", "활용", "어떻게 활용"];
  if (usageKeywords.some((k) => utterance.includes(k))) {
    return {
      text: `MoA 실제 사용 사례를 보여드릴게요!

[직장인 A씨]
카카오톡에서 "@회사PC 보고서.docx 내용 알려줘"
→ 퇴근 후에도 회사 컴퓨터 파일을 바로 확인

[개발자 B씨]
카카오톡에서 "@서버 git pull && npm run deploy"
→ 지하철에서도 서버 배포 가능

[대학생 C씨]
카카오톡에서 "@노트북,@태블릿 동기화 시작"
→ 노트북과 태블릿의 AI 기억을 동기화

[프리랜서 D씨]
"오늘 작업 요약해줘"
→ 여러 기기에서 작업한 내용을 AI가 종합 요약

MoA를 설치하면 이 모든 것이 가능합니다!
아래 버튼을 눌러 바로 시작하세요!`,
      buttons: [{ label: "MoA 설치하기", url: getInstallUrl() }],
      quickReplies: ["설치", "이 기기등록", "기능 소개"],
    };
  }

  // 6) Skill marketplace queries
  const skillKeywords = ["스킬", "skill", "마켓", "market", "스킬 목록", "스킬 검색"];
  const isSkillQuery = skillKeywords.some((k) => utterance.toLowerCase().includes(k));
  if (isSkillQuery) {
    // Check for search: "스킬 검색 날씨" or "스킬 음악"
    const searchMatch = utterance.match(/스킬\s*(?:검색|찾기|search)?\s+(.+)/i);
    if (searchMatch) {
      const query = searchMatch[1].trim();
      const results = searchSkills(query);
      if (results.length > 0) {
        const detail = results.length === 1 ? formatSkillDetail(results[0]) : formatSkillCatalog(results, maxLen);
        return {
          text: detail,
          quickReplies: ["스킬 목록", "설치", "도움말"],
        };
      }
      return {
        text: `"${query}"에 대한 스킬을 찾지 못했습니다.\n\n"스킬 목록"을 입력하면 사용 가능한 전체 스킬을 볼 수 있습니다.`,
        quickReplies: ["스킬 목록", "설치", "도움말"],
      };
    }

    // Show catalog
    const skills = getUserFriendlyRecommendedSkills();
    return {
      text: formatSkillCatalog(skills, maxLen),
      quickReplies: ["설치", "기능 소개", "도움말"],
    };
  }

  // 7) General AI chat — use LLM with MoA-optimized system prompt
  const llm = detectLlmProvider();

  if (!llm) {
    return {
      text: '현재 AI 응답 기능이 준비 중입니다.\n\nMoA 에이전트를 설치하시면 더 강력한 AI 기능을 이용할 수 있습니다!\n\n"설치"라고 입력해보세요.',
      quickReplies: ["설치", "기능 소개", "도움말"],
    };
  }

  // Build injection-resistant system prompt and sanitized user message
  const baseSystemPrompt = getMoASystemPrompt(channelId);
  const securityAddition = getSecuritySystemPrompt(isOwnerAuthEnabled());
  const systemPrompt = baseSystemPrompt + securityAddition;

  const userName = params.channel?.userName ?? params.userId;
  const userMessage = isOwnerAuthEnabled()
    ? wrapUserMessageForLLM(params.text, auth.role, userName)
    : params.text;

  try {
    let responseText: string;

    switch (llm.provider) {
      case "anthropic":
        responseText = await callAnthropic(llm.apiKey, llm.model, systemPrompt, userMessage);
        break;
      case "openai":
        responseText = await callOpenAICompatible(
          llm.endpoint,
          llm.apiKey,
          llm.model,
          systemPrompt,
          userMessage,
        );
        break;
      case "google":
        responseText = await callGemini(llm.apiKey, llm.model, systemPrompt, userMessage);
        break;
      case "groq":
        responseText = await callOpenAICompatible(
          llm.endpoint,
          llm.apiKey,
          llm.model,
          systemPrompt,
          userMessage,
        );
        break;
      default:
        responseText = "지원되지 않는 AI 제공자입니다.";
    }

    // Truncate to channel's limit
    const truncateAt = maxLen - 3;
    if (responseText.length > maxLen) {
      responseText = responseText.slice(0, truncateAt) + "...";
    }

    return {
      text: responseText,
      quickReplies: channelId === "kakao" ? ["설치", "도움말"] : undefined,
    };
  } catch (err) {
    console.error(`[MoA] LLM API error (${llm.provider}/${llm.model}):`, err);
    return {
      text: `AI 응답 생성 중 오류가 발생했습니다.\n\n${err instanceof Error ? err.message : String(err)}\n\nMoA 에이전트를 설치하시면 더 안정적인 AI를 이용할 수 있습니다.\n"설치"라고 입력해보세요.`,
      quickReplies: ["설치", "도움말"],
    };
  }
}

// ============================================
// Server Bootstrap
// ============================================

async function main() {
  console.log(`[MoA] Starting standalone webhook server...`);
  console.log(`[MoA] PORT=${PORT}, HOST=${HOST}, PATH=${WEBHOOK_PATH}`);

  const account = buildAccountFromEnv();
  if (!account) {
    console.error("[MoA] Failed to build account config");
    process.exit(1);
  }

  const hasKeys = !!(account.appKey || account.adminKey);
  if (!hasKeys) {
    console.warn("[MoA] WARNING: No Kakao API keys configured (KAKAO_ADMIN_KEY or KAKAO_APP_KEY)");
    console.warn("[MoA] Webhook will start but message handling may be limited");
  }

  // Detect LLM provider
  const llm = detectLlmProvider();
  if (llm) {
    console.log(`[MoA] LLM provider: ${llm.provider} (model: ${llm.model})`);
  } else {
    console.warn(
      "[MoA] WARNING: No LLM API key found. Set ANTHROPIC_API_KEY, OPENAI_API_KEY, GOOGLE_API_KEY, or GROQ_API_KEY",
    );
  }

  // Check owner authentication
  const userSecretCount = getUserSecretCount();
  if (userSecretCount > 0 || process.env.MOA_OWNER_SECRET) {
    const parts = [];
    if (userSecretCount > 0) parts.push(`${userSecretCount} user(s) with secrets`);
    if (process.env.MOA_OWNER_SECRET) parts.push("admin master key set");
    console.log(`[MoA] Owner auth: ENABLED (${parts.join(", ")})`);
  } else {
    console.log(
      "[MoA] Owner auth: DISABLED (users can set secrets via !비밀구문, or set MOA_OWNER_SECRET for admin)",
    );
  }

  // Check Supabase
  if (isSupabaseConfigured()) {
    console.log("[MoA] Supabase: configured (billing & sync enabled)");
  } else {
    console.log("[MoA] Supabase: not configured (billing & sync disabled, AI chat still works)");
  }

  // Check proactive messaging (Friend Talk)
  if (isProactiveMessagingConfigured(account)) {
    console.log("[MoA] Proactive messaging: configured (Friend Talk enabled)");
  } else {
    console.log(
      "[MoA] Proactive messaging: not configured (set TOAST_APP_KEY, TOAST_SECRET_KEY, KAKAO_SENDER_KEY)",
    );
  }

  // Load skills
  const skills = getLoadedSkills();
  console.log(`[MoA] Skills: ${skills.length} loaded (${skills.filter((s) => s.eligible).length} eligible)`);

  // Initialize encrypted vault and run scheduled backup
  if (process.env.MOA_OWNER_SECRET) {
    try {
      initializeVault();
      const backupResult = runScheduledBackup(
        { timestamp: Date.now(), source: "auto", type: "server_start" },
        process.env.MOA_OWNER_SECRET,
      );
      const created = [
        backupResult.daily && "daily",
        backupResult.weekly && "weekly",
        backupResult.monthly && "monthly",
      ].filter(Boolean);
      if (created.length > 0) {
        console.log(`[MoA] Vault: auto backup created (${created.join(", ")})`);
      } else {
        console.log("[MoA] Vault: initialized (backups up to date)");
      }
    } catch (err) {
      console.warn("[MoA] Vault: initialization failed:", err instanceof Error ? err.message : err);
    }
  } else {
    console.log("[MoA] Vault: disabled (set MOA_OWNER_SECRET to enable encrypted backups)");
  }

  // Check Telegram
  if (isTelegramConfigured()) {
    const botInfo = await getTelegramBotInfo();
    if (botInfo) {
      console.log(`[MoA] Telegram: configured (bot: @${botInfo.username})`);
    } else {
      console.log("[MoA] Telegram: token set but bot info unavailable");
    }
  } else {
    console.log("[MoA] Telegram: not configured (set TELEGRAM_BOT_TOKEN)");
  }

  // Check WhatsApp
  if (isWhatsAppConfigured()) {
    console.log("[MoA] WhatsApp: configured (Cloud API)");
  } else {
    console.log("[MoA] WhatsApp: not configured (set WHATSAPP_TOKEN, WHATSAPP_PHONE_NUMBER_ID)");
  }

  // Check Discord
  if (isDiscordConfigured()) {
    console.log("[MoA] Discord: configured (Gateway bot)");
  } else {
    console.log("[MoA] Discord: not configured (set DISCORD_BOT_TOKEN)");
  }

  // Build relay callbacks for proactive messaging
  const relayCallbacks: RelayCallbacks = {
    onPairingComplete: async ({ userId, deviceId, deviceName }) => {
      console.log(`[MoA] Device paired: ${deviceName} (${deviceId}) for user ${userId}`);
      if (isProactiveMessagingConfigured(account)) {
        await sendWelcomeAfterPairing(userId, deviceName, account);
      }
    },
  };

  try {
    const webhook = await startKakaoWebhook({
      account,
      port: PORT,
      host: HOST,
      path: WEBHOOK_PATH,
      onMessage: aiOnMessage,
      logger: console,
      // Mount install page, relay API, payment routes, and channel webhooks
      requestInterceptor: (req, res) => {
        // Enhanced health check with channel status (JSON)
        const urlPath = req.url?.split("?")[0] ?? "";
        if (urlPath === "/health" && req.method === "GET") {
          const status = {
            status: "ok",
            kakao: hasKeys,
            telegram: isTelegramConfigured(),
            whatsapp: isWhatsAppConfigured(),
            discord: isDiscordConfigured(),
            ownerAuth: isOwnerAuthEnabled(),
            registeredUsers: getUserSecretCount(),
            vault: !!process.env.MOA_OWNER_SECRET,
            skills: getLoadedSkills().length,
            eligibleSkills: getLoadedSkills().filter((s) => s.eligible).length,
          };
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify(status));
          return true;
        }
        // Try install page first (/install, /welcome, etc.)
        if (handleInstallRequest(req, res)) {
          return true;
        }
        // Telegram webhook (/telegram/webhook)
        if (handleTelegramRequest(req, res, aiOnMessage, console)) {
          return true;
        }
        // WhatsApp webhook (/whatsapp/webhook)
        if (handleWhatsAppRequest(req, res, aiOnMessage, console)) {
          return true;
        }
        // Settings page (/settings/*)
        if (handleSettingsRequest(req, res)) {
          return true;
        }
        // Payment callbacks (/payment/*)
        if (handlePaymentRequest(req, res, console)) {
          return true;
        }
        // Relay API (/api/relay/*) — with pairing callbacks
        return handleRelayRequest(req, res, console, relayCallbacks);
      },
    });

    const localBase = `http://${HOST === "0.0.0.0" ? "localhost" : HOST}:${PORT}`;
    console.log(`[MoA] Webhook server started at ${webhook.url}`);
    console.log(`[MoA] Install page: ${localBase}/install`);
    console.log(`[MoA] Welcome page: ${localBase}/welcome`);
    console.log(`[MoA] Payment API: ${localBase}/payment/*`);
    console.log(`[MoA] Relay API: ${localBase}/api/relay/*`);
    console.log(`[MoA] Settings page: ${localBase}/settings`);
    console.log(`[MoA] Health check: ${localBase}/health`);

    // Log WhatsApp webhook
    if (isWhatsAppConfigured()) {
      console.log(`[MoA] WhatsApp webhook: ${localBase}/whatsapp/webhook`);
    }

    // Register Telegram webhook if configured
    if (isTelegramConfigured()) {
      const publicDomain = process.env.RAILWAY_PUBLIC_DOMAIN;
      const publicUrl = publicDomain
        ? `https://${publicDomain}/telegram/webhook`
        : "https://moa.lawith.kr/telegram/webhook";
      console.log(`[MoA] Telegram webhook: ${localBase}/telegram/webhook`);
      await registerTelegramWebhook(publicUrl);
    }

    // Start Discord Gateway if configured
    if (isDiscordConfigured()) {
      const discordStarted = await startDiscordGateway(aiOnMessage, console);
      if (discordStarted) {
        console.log("[MoA] Discord Gateway: connecting... (bot will appear online shortly)");
      } else {
        console.log("[MoA] Discord Gateway: failed to start");
      }
    }

    // Graceful shutdown
    const shutdown = async (signal: string) => {
      console.log(`[MoA] Received ${signal}, shutting down...`);
      stopDiscordGateway();
      await webhook.stop();
      process.exit(0);
    };

    process.on("SIGTERM", () => shutdown("SIGTERM"));
    process.on("SIGINT", () => shutdown("SIGINT"));
  } catch (err) {
    console.error("[MoA] Failed to start webhook server:", err);
    process.exit(1);
  }
}

main();
