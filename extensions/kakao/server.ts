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
import { MoltbotGatewayClient } from "./src/moltbot/gateway-client.js";
import { resolveKakaoAccount, getDefaultKakaoConfig } from "./src/config.js";
import { handleInstallRequest } from "./src/installer/index.js";
import { handleSettingsRequest } from "./src/settings/index.js";
import { handlePaymentRequest } from "./src/payment/index.js";
import {
  sendWelcomeAfterPairing,
  isProactiveMessagingConfigured,
} from "./src/proactive-messaging.js";
import { createNotificationService } from "./src/notification-service.js";
import { listAlimTalkTemplateCodes } from "./src/alimtalk-templates.js";
import {
  markAsChannelFriend,
  startWeatherScheduler,
  generateShareContent,
  getOrCreateReferralCode,
  checkDeviceControlRedirection,
} from "./src/channel-engagement.js";
import { handleRelayRequest } from "./src/relay/index.js";
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
  handleSlackRequest,
  isSlackConfigured,
  handleLineRequest,
  isLineConfigured,
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
  grantOwnerAuth,
  getRequiredPermission,
  getGuestDeniedResponse,
  wrapUserMessageForLLM,
  getSecuritySystemPrompt,
  hasUserSecret,
  setUserSecret,
  verifyUserSecret,
  changeUserSecret,
  getUserSecretCount,
  // User Accounts
  findAccountByUsername,
  findAccountByChannel,
  verifyPassword,
  linkChannel,
  hasAnyAccount,
  getAccountCount,
} from "./src/auth/index.js";

const PORT = parseInt(process.env.PORT ?? process.env.KAKAO_WEBHOOK_PORT ?? "8788", 10);
const HOST = process.env.HOST ?? "0.0.0.0";
const WEBHOOK_PATH = process.env.KAKAO_WEBHOOK_PATH ?? "/kakao/webhook";

// ============================================
// OpenClaw Gateway Integration (optional)
// ============================================
//
// When the OpenClaw gateway runs alongside MoA (e.g. via railway-start.sh),
// AI messages are routed through the full OpenClaw agent which provides:
//   - Memory search (vector + FTS)
//   - Tool execution (bash, file ops, browsing)
//   - 104 built-in skills
//   - Multi-turn conversation with context
//   - Heartbeat & cron (proactive AI)
//
// If the gateway is unavailable, MoA falls back to direct LLM API calls.
// End users never need to configure this — the operator sets it once.
//
let openclawGateway: MoltbotGatewayClient | null = null;
let openclawGatewayOnline = false;

/**
 * MoA install page URL — always use the public-facing domain.
 *
 * Vercel (mymoa.app) proxies /install to Railway via rewrites,
 * so users always see a single consistent domain regardless of whether
 * they come from KakaoTalk, the website, or a direct link.
 *
 * NOTE: If MOA_INSTALL_URL is set in Railway env vars, delete it —
 * it is no longer used to avoid stale/wrong URLs.
 */
function getInstallUrl(): string {
  return "https://mymoa.app/install";
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

[2단계] 설치 완료 후 자동으로 열리는 페이지에서 회원가입을 해주세요.
아이디, 비밀번호, 기기 이름을 설정하면 자동으로 기기가 등록됩니다.

[3단계] 이미 회원가입을 하셨다면 로그인만 하면 됩니다!
새 기기에서 로그인하면 자동으로 새 기기가 등록됩니다.

[4단계] 카카오톡에서 "사용자 인증" 버튼을 눌러 로그인하세요.
아이디+비밀번호로 인증하면 모든 MoA 기능을 사용할 수 있습니다.
보안 강화를 위해 구문번호 설정도 권장합니다!`;

// ============================================
// Pending Auth State (카카오톡 GUI 인증)
// ============================================

/**
 * 인증 상태 추적
 *
 * 사용자 인증 (credentials): 아이디 + 비밀번호 → MoA 사용을 위한 로그인
 * 구문 인증 (passphrase_setup): 구문번호 신규 설정 → setUserSecret()
 * 구문 인증 (passphrase_verify): 크리티컬 작업 시 구문번호 재확인 → verifyUserSecret()
 *
 * 구문번호는 로그인이 아니라 기기제어 등 위험한 작업 시 "진짜 주인인가?" 재확인용.
 * (sudo 같은 개념 — 제3자가 채팅창에서 기기제어를 요청하는 위험 방지)
 */
interface PendingAuth {
  expiresAt: number;
  step: "credentials" | "passphrase_setup" | "passphrase_verify";
  /** 계정 인증 완료 후 저장된 사용자명 */
  username?: string;
  /** 구문 인증 완료 후 실행할 원래 명령 (크리티컬 작업 재확인 시) */
  pendingCommand?: string;
}
const pendingAuthUsers = new Map<string, PendingAuth>();
const AUTH_PENDING_TTL_MS = 5 * 60 * 1000; // 5분

/** 구문 인증 통과 시각 — 일정 시간 내 재인증 불필요 */
const passphraseVerifiedAt = new Map<string, number>();
const PASSPHRASE_GRACE_PERIOD_MS = 10 * 60 * 1000; // 10분 유예

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

/** Max response tokens — configurable via MOA_MAX_TOKENS (default 1000, lower = faster for Kakao 5s limit) */
const MOA_MAX_TOKENS = Math.max(1, Math.min(4096, Number(process.env.MOA_MAX_TOKENS) || 1000));

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
      max_tokens: MOA_MAX_TOKENS,
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
      max_tokens: MOA_MAX_TOKENS,
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
        generationConfig: { maxOutputTokens: MOA_MAX_TOKENS },
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
- 사용자 인증 : 아이디+비밀번호 로그인
- !구문번호 [문구] : 구문번호 설정 (기기 제어 시 본인 재확인용)
- /기기 : 연결된 기기 목록
- @기기명 명령 : 특정 기기에 원격 명령 (구문번호 설정 시 본인 확인 후 실행)
- /도움말 : 전체 명령어 보기
- !작업내역 : 최근 작업 기록 조회
- !체크포인트 [이름] : 현재 시점 저장 (되돌리기 가능)
- !되돌리기 [ID] : 특정 작업 되돌리기
- !복원 [체크포인트ID] : 체크포인트 시점으로 전체 복원
- !기억내역 : 장기 기억 버전 히스토리
- !비상정지 : 모든 대기 명령 취소 + 기기 잠금
- !취소 [ID] : 대기 중인 명령 취소
- !대기목록 : 실행 대기 중인 명령 조회
- !백업 : 백업 설정 페이지 안내 (톡서랍 개념, 별도 백업 비밀번호)
- !복원 : 백업 복원 페이지 안내
- !백업 목록 : 저장된 백업 목록 조회
- !복구키 : 복구키 안내 (백업 비밀번호 분실 시 재설정용)
- !복구키 검증 [12단어] : 복구 키 검증
- /날씨 : 현재 날씨 확인
- /날씨알림 해제 : 아침 날씨 알림 끄기
- /날씨알림 설정 : 아침 날씨 알림 켜기
- 친구초대 : 카카오톡으로 MoA 친구에게 공유하기
${skillsPrompt}
## 응답 규칙
- 한국어로 친절하고 자연스럽게 대화합니다
- 최대 ${maxLen}자 이내로 답변하세요
- 사용자가 MoA와 관련 없는 질문을 해도 친절히 답변하되, 자연스럽게 MoA 기능을 연결하세요
  예) "일정 관리 도와줘" → 답변 후 "MoA를 설치하면 컴퓨터에서 일정 파일을 직접 관리할 수도 있어요!"
- MoA가 아직 설치되지 않은 사용자에게는 대화 마무리에 설치를 부드럽게 권유하세요
- 확실하지 않은 정보는 그렇다고 솔직히 말씀하세요
- 스킬 관련 질문이 오면 해당 스킬의 기능을 안내하고, MoA를 설치하면 기기에서 직접 사용할 수 있다고 안내하세요
- 대화가 잘 이루어지고 있을 때, 가끔 자연스럽게 "친구초대"를 언급하세요. 예: "MoA가 마음에 드시면 '친구초대'를 입력해서 친구에게도 알려주세요!"
- 매일 아침 날씨 알림 기능이 있다고 알려주세요. 채널 친구에게 매일 아침 7:30에 날씨를 알려줍니다.

## 설치 안내 시
사용자가 설치에 관심을 보이면: "설치"라고 입력해주세요! 간편 설치 안내를 바로 보내드립니다.
설치 후 https://mymoa.app/welcome 페이지에서 회원가입/로그인으로 기기를 등록할 수 있습니다.
카카오톡에서 "사용자 인증" 버튼을 누르면 아이디+비밀번호로 로그인합니다.
로그인 후 구문번호 설정을 권장합니다 — 기기 제어 등 중요한 작업 시 구문번호로 본인 재확인합니다.
(제3자가 채팅창에서 기기 제어를 요청하는 위험을 방지합니다)

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

  // Mark user as channel friend on first KakaoTalk interaction (async, non-blocking)
  if (channelId === "kakao") {
    markAsChannelFriend(params.userId).catch(() => {});
  }

  // ── Pending Auth 처리 ("사용자 인증" 또는 구문 인증 대기 중) ──
  const pendingKey = `${channelId}:${params.userId}`;
  const pending = pendingAuthUsers.get(pendingKey);
  if (pending && Date.now() < pending.expiresAt) {

    // ── 구문번호 설정 (첫 로그인 후 권장) ──
    if (pending.step === "passphrase_setup" && pending.username) {
      const secret = utterance.trim();
      const error = setUserSecret(params.userId, channelId, secret);
      if (error) {
        return {
          text: `구문번호 설정 실패: ${error}\n\n다시 입력해주세요. (4자 이상)`,
        };
      }
      pendingAuthUsers.delete(pendingKey);
      return {
        text: `구문번호가 설정되었습니다!\n\n${pending.username}님, 기기 제어 등 중요한 작업 시 구문번호로 본인 확인을 요청합니다.\n이를 통해 제3자의 무단 사용을 방지할 수 있습니다.`,
        quickReplies: ["기기 목록", "도움말"],
      };
    }

    // ── 구문 인증: 크리티컬 작업 재확인 ──
    if (pending.step === "passphrase_verify") {
      if (verifyUserSecret(params.userId, channelId, utterance)) {
        passphraseVerifiedAt.set(pendingKey, Date.now());
        pendingAuthUsers.delete(pendingKey);
        // 보류된 명령이 있으면 재실행
        if (pending.pendingCommand) {
          const linkedAccount = findAccountByChannel(channelId, params.userId);
          const name = linkedAccount?.username ?? "";
          return {
            text: `구문 인증 완료! ${name}님\n\n명령을 다시 입력해주세요.`,
            quickReplies: ["도움말"],
          };
        }
        return {
          text: "구문 인증 완료! 10분간 추가 인증 없이 기기 제어가 가능합니다.",
          quickReplies: ["기기 목록", "도움말"],
        };
      }
      return {
        text: "구문번호가 일치하지 않습니다.\n다시 입력해주세요.",
        quickReplies: ["사용자 인증", "도움말"],
      };
    }

    // ── 사용자 인증: 아이디 + 비밀번호 (로그인) ──
    if (pending.step === "credentials") {
      const linkedAccount = findAccountByChannel(channelId, params.userId);
      let authUsername: string | null = null;

      // Case A: already linked → password only
      if (linkedAccount && verifyPassword(linkedAccount.username, utterance)) {
        authUsername = linkedAccount.username;
      }

      // Case B: not linked → "아이디 비밀번호" format
      if (!authUsername) {
        const parts = utterance.split(/\s+/);
        if (parts.length >= 2) {
          const tryUsername = parts[0];
          const tryPassword = parts.slice(1).join(" ");
          if (verifyPassword(tryUsername, tryPassword)) {
            linkChannel(tryUsername, channelId, params.userId);
            authUsername = tryUsername;
          }
        }
      }

      if (authUsername) {
        grantOwnerAuth(params.userId, channelId);
        pendingAuthUsers.delete(pendingKey);

        // 구문번호 미설정 → 설정 권장
        if (!hasUserSecret(params.userId, channelId)) {
          pendingAuthUsers.set(pendingKey, {
            expiresAt: Date.now() + AUTH_PENDING_TTL_MS,
            step: "passphrase_setup",
            username: authUsername,
          });
          return {
            text: `인증 성공! ${authUsername}님, 환영합니다.\n\n[구문번호 설정 안내]\n구문번호란?\n카카오톡에서 기기 제어(@기기명 명령) 등 중요한 작업을 실행할 때 본인 재확인용으로 사용하는 비밀 문구입니다.\n\n왜 필요한가요?\n카카오톡 채팅창은 다른 사람이 볼 수 있어, 제3자가 기기 제어 명령을 입력할 위험이 있습니다. 구문번호를 설정하면 기기 제어 전에 항상 본인 확인을 요청하므로 무단 사용을 방지할 수 있습니다.\n\n사용 방법:\n기기 제어 명령 입력 시 → 구문번호 입력 요청 → 인증 후 10분간 추가 인증 없이 사용 가능\n\n구문번호를 입력하세요. (4자 이상)\n예: 나의비밀문장\n\n지금 설정하지 않으려면 아무 명령이나 입력하세요.`,
            quickReplies: ["기기 목록", "도움말"],
          };
        }

        return {
          text: `인증 성공! ${authUsername}님, 환영합니다.\n\n이제 모든 MoA 기능을 사용할 수 있습니다.`,
          quickReplies: ["기기 목록", "도움말"],
        };
      }

      // 인증 실패
      return {
        text: "인증에 실패했습니다.\n\n아이디와 비밀번호를 정확히 입력해주세요.\n형식: 아이디 비밀번호\n\n예: myid mypassword",
        quickReplies: ["사용자 인증", "설치", "도움말"],
      };
    }
  }
  // Clean up expired pending
  if (pending) pendingAuthUsers.delete(pendingKey);

  // ── "사용자 인증" 버튼 처리 (로그인) ──────────
  if (/^(?:사용자\s*인증|인증하기|인증)$/i.test(utterance)) {
    const linkedAccount = findAccountByChannel(channelId, params.userId);

    // Case 1: 이미 연동된 계정 → 비밀번호만 요청
    if (linkedAccount) {
      pendingAuthUsers.set(pendingKey, {
        expiresAt: Date.now() + AUTH_PENDING_TTL_MS,
        step: "credentials",
      });
      return {
        text: `${linkedAccount.username}님, 비밀번호를 입력해주세요.`,
      };
    }

    // Case 2: 계정 미연동 → 아이디 + 비밀번호 요청
    pendingAuthUsers.set(pendingKey, {
      expiresAt: Date.now() + AUTH_PENDING_TTL_MS,
      step: "credentials",
    });
    return {
      text: `MoA에 접속하기 위하여 아이디와 비밀번호를 입력해주세요.\n\n형식: 아이디 비밀번호\n예: myid mypassword\n\n아직 MoA 계정이 없으시다면 "설치"를 입력하여 회원가입해주세요!`,
      quickReplies: ["설치", "도움말"],
    };
  }

  // ── Owner Authentication Gate ──────────────────────────────
  const auth = authenticateUser(params.userId, channelId, utterance);

  // Handle auth attempts (!인증 <secret> — backward compat)
  if (auth.isAuthAttempt) {
    // Release panic lock on successful re-auth
    if (auth.authSuccess && isPanicLocked()) {
      releasePanicLock();
    }
    return {
      text: auth.authMessage ?? "인증 처리 중 오류가 발생했습니다.",
      quickReplies: auth.authSuccess ? ["기기 목록", "도움말"] : ["사용자 인증", "설치"],
    };
  }

  // ── 구문번호 설정 (!구문번호, !비밀구문 — 기기 제어 시 본인 재확인용) ─────
  const secretSetMatch = utterance.match(/^[!!/](?:구문번호|구문 번호|비밀구문|비밀 구문|secret)\s+(.+)$/i);
  if (secretSetMatch && !secretSetMatch[1].match(/^(?:변경|change)/i)) {
    const newSecret = secretSetMatch[1].trim();

    if (hasUserSecret(params.userId, channelId)) {
      return {
        text: "이미 구문번호가 설정되어 있습니다.\n\n변경하려면:\n!구문번호 변경 [현재구문번호] [새구문번호]",
        quickReplies: ["도움말"],
      };
    }

    const error = setUserSecret(params.userId, channelId, newSecret);
    if (error) {
      return { text: `구문번호 설정 실패: ${error}`, quickReplies: ["도움말"] };
    }

    return {
      text: `구문번호가 설정되었습니다!\n\n기기 제어(@기기명 명령) 시 구문번호로 본인 확인을 요청합니다.\n인증 후 10분간 추가 인증 없이 사용 가능합니다.`,
      quickReplies: ["기기 목록", "도움말"],
    };
  }

  // !구문번호 변경 [현재] [새]
  const secretChangeMatch = utterance.match(
    /^[!!/](?:구문번호|구문 번호|비밀구문|비밀 구문|secret)\s*(?:변경|change)\s+(\S+)\s+(\S+)$/i,
  );
  if (secretChangeMatch) {
    const oldSecret = secretChangeMatch[1];
    const newSecret = secretChangeMatch[2];
    const error = changeUserSecret(params.userId, channelId, oldSecret, newSecret);
    if (error) {
      return { text: `구문번호 변경 실패: ${error}`, quickReplies: ["도움말"] };
    }
    return {
      text: "구문번호가 변경되었습니다.\n다음 기기 제어 시 새 구문번호를 사용해주세요.",
      quickReplies: ["기기 목록", "도움말"],
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
      text: "비상정지 상태입니다. 기기 제어가 잠겨 있습니다.\n\n재개하려면 \"사용자 인증\" 버튼을 눌러 다시 인증해주세요.",
      quickReplies: ["사용자 인증", "!작업내역"],
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
      text: "인증이 해제되었습니다.\n다시 인증하려면 \"사용자 인증\" 버튼을 눌러주세요.",
      quickReplies: ["사용자 인증", "도움말"],
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

    // !백업 — 백업 GUI 페이지로 안내 (톡서랍 개념: 사용자의 명시적 요청 시에만 백업)
    if (utterance.match(/^[!!/](?:백업|backup)$/i)) {
      return {
        text: `MoA 백업 안내\n\n아래 페이지에서 백업을 설정하세요.\n\n[백업 흐름]\n1. 로그인 (MoA 계정)\n2. 백업 비밀번호 설정 (백업 전용 별도 비밀번호)\n3. 12단어 복구키 발급 → 종이에 적어두세요\n4. AI 기억이 암호화되어 서버에 보관됩니다\n\n백업 비밀번호 분실 시 복구키(12단어)로 재설정 가능`,
        buttons: [{ label: "백업 설정하기", url: "https://mymoa.app/backup" }],
        quickReplies: ["!복원", "!백업 목록", "도움말"],
      };
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

    // !복원 — 백업 복원 GUI 안내
    if (utterance.match(/^[!!/](?:복원|restore)$/i)) {
      return {
        text: `MoA 복원 안내\n\n아래 페이지의 "복원" 탭에서 백업을 복원하세요.\n\n필요한 것:\n1. MoA 계정 (아이디 + 비밀번호)\n2. 백업 비밀번호 (백업 시 설정한 비밀번호)\n\n백업 비밀번호를 잊으셨다면 복구키(12단어)로 재설정할 수 있습니다.`,
        buttons: [{ label: "복원 페이지", url: "https://mymoa.app/backup" }],
        quickReplies: ["!백업", "!백업 목록", "도움말"],
      };
    }

    // !백업 복원 [파일명] — 채팅에서 복원 안내 (GUI로 유도)
    const restoreBackupMatch = utterance.match(/^[!!/](?:백업|backup)\s*(?:복원|restore)/i);
    if (restoreBackupMatch) {
      return {
        text: `백업 복원은 아래 페이지의 "복원" 탭에서 진행해주세요.\n백업 비밀번호가 필요합니다.`,
        buttons: [{ label: "복원 페이지", url: "https://mymoa.app/backup" }],
        quickReplies: ["!백업 목록", "도움말"],
      };
    }

    // !복구키 — 백업 페이지로 안내 (복구키는 첫 백업 시 발급)
    if (utterance.match(/^[!!/](?:복구키|복구 키|recovery\s*key)$/i)) {
      return {
        text: `복구키는 첫 백업 시 자동으로 발급됩니다.\n\n복구키(12단어)는 백업 비밀번호를 잊었을 때\n비밀번호를 재설정하기 위한 수단입니다.\n\n복구키로 비밀번호 재설정이 필요하면\n아래 페이지에서 진행하세요.`,
        buttons: [{ label: "백업 & 복원 페이지", url: "https://mymoa.app/backup" }],
        quickReplies: ["!백업", "!복원", "도움말"],
      };
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

  // ── Device command: Passphrase + Gravity + Guardian Angel + Logging ─────
  if (auth.role === "owner" && utterance.startsWith("@")) {
    const deviceMatch = utterance.match(/^@(\S+)\s+(.+)$/);
    if (deviceMatch) {
      const commandText = deviceMatch[2];
      const deviceName = deviceMatch[1];

      // 0. Passphrase re-verification for critical device commands
      //    구문번호가 설정된 사용자는 기기 제어 시 구문 인증 필요 (유예 기간 내 제외)
      if (hasUserSecret(params.userId, channelId)) {
        const lastVerified = passphraseVerifiedAt.get(pendingKey);
        const inGracePeriod = lastVerified && (Date.now() - lastVerified) < PASSPHRASE_GRACE_PERIOD_MS;
        if (!inGracePeriod) {
          pendingAuthUsers.set(pendingKey, {
            expiresAt: Date.now() + AUTH_PENDING_TTL_MS,
            step: "passphrase_verify",
            pendingCommand: utterance,
          });
          return {
            text: `기기 제어를 위해 구문번호를 입력해주세요.\n\n명령: @${deviceName} ${commandText.slice(0, 30)}${commandText.length > 30 ? "..." : ""}`,
          };
        }
      }

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

  // ── Auto Auth Prompt for guests with accounts ──────────────
  if (auth.role === "guest" && hasAnyAccount()) {
    const requiredAction = getRequiredPermission(utterance);
    if (requiredAction) {
      return {
        text: `이 기능은 인증된 사용자만 이용할 수 있습니다.\n\n아래 "사용자 인증" 버튼을 눌러주세요.\nMoA에 접속하기 위하여 가입시 설정하신 아이디와 비밀번호로 인증해주세요.`,
        quickReplies: ["사용자 인증", "설치", "도움말"],
      };
    }
  }

  // 0.5) Help command (/도움말)
  if (utterance.match(/^[/!]?도움말$/i) || utterance === "/help") {
    return {
      text: `MoA 전체 명령어 안내

[기본 명령]
- 설치 : MoA 간편 설치 안내
- 사용자 인증 : 아이디+비밀번호 로그인
- 기능 소개 : MoA 기능 안내
- 스킬 목록 : 사용 가능한 스킬 보기

[기기 제어] (인증 필요)
- /기기 : 연결된 기기 목록
- @기기명 명령 : 기기에 원격 명령

[보안]
- !구문번호 [문구] : 구문번호 설정
- !비상정지 : 모든 명령 취소 + 잠금

[작업 관리] (인증 필요)
- !작업내역 : 최근 작업 기록
- !체크포인트 [이름] : 현재 시점 저장
- !되돌리기 [ID] : 작업 되돌리기
- !백업 : 백업 설정

[날씨 & 알림]
- /날씨 : 현재 날씨 확인
- /날씨알림 해제 : 아침 날씨 알림 끄기
- /날씨알림 설정 : 아침 날씨 알림 켜기

[공유]
- 친구초대 : 카카오톡으로 MoA 공유하기`,
      quickReplies: ["설치", "기능 소개", "스킬 목록"],
    };
  }

  // 0.6) Weather command (/날씨)
  if (utterance.match(/^[/!]?날씨$/i) || utterance === "/weather") {
    try {
      const weatherResp = await fetch("https://wttr.in/Seoul?format=j1", {
        signal: AbortSignal.timeout(5000),
      });
      if (weatherResp.ok) {
        const weatherJson = (await weatherResp.json()) as {
          current_condition?: Array<{
            temp_C: string;
            FeelsLikeC: string;
            humidity: string;
            weatherCode: string;
          }>;
          weather?: Array<{
            maxtempC: string;
            mintempC: string;
          }>;
        };
        const cur = weatherJson.current_condition?.[0];
        const forecast = weatherJson.weather?.[0];
        if (cur) {
          const now = new Date();
          const dateStr = `${now.getMonth() + 1}월 ${now.getDate()}일`;
          return {
            text: `${dateStr} 서울 날씨\n\n현재: ${cur.temp_C}°C (체감 ${cur.FeelsLikeC}°C)\n습도: ${cur.humidity}%${forecast ? `\n최저 ${forecast.mintempC}°C / 최고 ${forecast.maxtempC}°C` : ""}`,
            quickReplies: ["도움말"],
          };
        }
      }
    } catch {
      // Fall through to error message
    }
    return {
      text: "날씨 정보를 가져오지 못했습니다. 잠시 후 다시 시도해주세요.",
      quickReplies: ["도움말"],
    };
  }

  // 0.7) Weather notification opt-in/out
  if (utterance.match(/^[/!]?날씨알림\s*(해제|끄기|off)$/i)) {
    if (isSupabaseConfigured()) {
      const supabase = (await import("./src/supabase.js")).getSupabase();
      await supabase
        .from("lawcall_users")
        .update({ weather_opt_out: true })
        .eq("kakao_user_id", params.userId);
    }
    return {
      text: "매일 아침 날씨 알림이 해제되었습니다.\n\n다시 받으시려면 '/날씨알림 설정'을 입력하세요.",
      quickReplies: ["도움말"],
    };
  }
  if (utterance.match(/^[/!]?날씨알림\s*(설정|켜기|on)$/i)) {
    if (isSupabaseConfigured()) {
      const supabase = (await import("./src/supabase.js")).getSupabase();
      await supabase
        .from("lawcall_users")
        .update({ weather_opt_out: false })
        .eq("kakao_user_id", params.userId);
    }
    return {
      text: "매일 아침 7:30에 날씨 알림을 보내드립니다!\n\n해제하시려면 '/날씨알림 해제'를 입력하세요.",
      quickReplies: ["도움말"],
    };
  }

  // 1) Greeting → Return welcome message with install button
  if (isGreeting(utterance)) {
    const quickReplies = hasAnyAccount()
      ? ["사용자 인증", "설치", "기능 소개"]
      : ["설치", "기능 소개"];
    return {
      text: MOA_WELCOME_MESSAGE,
      buttons: [{ label: "MoA 설치하기", url: getInstallUrl() }],
      quickReplies,
    };
  }

  // 2) Install request → Return install guide with install + welcome buttons
  if (isInstallRequest(utterance)) {
    return {
      text: MOA_INSTALL_GUIDE,
      buttons: [{ label: "MoA 설치하기", url: getInstallUrl() }],
      quickReplies: ["사용자 인증", "기능 소개", "도움말"],
    };
  }

  // 3) Device registration → Direct to welcome page for login/signup
  if (isDeviceRegistration(utterance)) {
    return {
      text: `기기 등록은 MoA를 설치한 후 웹 페이지에서 진행됩니다.

[기기 등록 방법]
1. 기기에 MoA를 설치합니다.
2. 설치 후 자동으로 열리는 페이지에서 회원가입 또는 로그인을 합니다.
3. 로그인하면 기기가 자동으로 등록됩니다!

이미 MoA를 설치하셨다면 아래 페이지에서 로그인해주세요:
https://mymoa.app/welcome`,
      buttons: [
        { label: "MoA 설치하기", url: getInstallUrl() },
        { label: "기기 등록 (로그인)", url: "https://mymoa.app/welcome" },
      ],
      quickReplies: ["설치", "도움말"],
    };
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

  // 7) Sharing / referral command
  const shareKeywords = ["공유", "추천", "친구초대", "친구 초대", "share", "invite", "홍보"];
  if (shareKeywords.some((k) => utterance.toLowerCase().includes(k))) {
    const supabaseReady = isSupabaseConfigured();
    let referralCode = `moa-share`;
    if (supabaseReady) {
      const supabase = (await import("./src/supabase.js")).getSupabase();
      const { data: shareUser } = await supabase
        .from("lawcall_users")
        .select("id")
        .eq("kakao_user_id", params.userId)
        .single();
      if (shareUser) {
        referralCode = await getOrCreateReferralCode(shareUser.id);
      }
    }
    const linkedAccount = findAccountByChannel(channelId, params.userId);
    const shareContent = generateShareContent({
      referrerName: linkedAccount?.username,
      referralCode,
    });
    return {
      text: shareContent.text,
      quickReplies: shareContent.quickReplies,
    };
  }

  // 7.5) Device control redirection for unauthenticated users
  if (utterance.startsWith("@") && auth.role === "guest") {
    const redirect = checkDeviceControlRedirection(utterance, false);
    if (redirect.shouldRedirect) {
      return {
        text: redirect.message ?? "인증이 필요합니다.",
        quickReplies: ["사용자 인증", "설치", "도움말"],
      };
    }
  }

  // 8) General AI chat
  //    Route: OpenClaw agent (memory + tools + skills) → direct LLM fallback

  // 8a) Try OpenClaw gateway first — full agent with memory, tools, 104 skills
  if (openclawGateway) {
    try {
      const gwResponse = await openclawGateway.sendMessage({
        userId: params.userId,
        text: utterance,
        sessionKey: `${channelId}:${params.userId}`,
        useMemory: true,
        systemPrompt: getMoASystemPrompt(channelId) + getSecuritySystemPrompt(isOwnerAuthEnabled()),
      });
      if (gwResponse.success && gwResponse.text) {
        openclawGatewayOnline = true;
        let responseText = gwResponse.text;
        if (responseText.length > maxLen) {
          responseText = responseText.slice(0, maxLen - 3) + "...";
        }
        return {
          text: responseText,
          quickReplies: channelId === "kakao" ? ["설치", "도움말"] : undefined,
        };
      }
      // Gateway returned empty/failed — fall through to direct LLM
    } catch (err) {
      openclawGatewayOnline = false;
      console.warn(`[MoA] OpenClaw gateway error, falling back to direct LLM: ${err instanceof Error ? err.message : err}`);
    }
  }

  // 8b) Fallback: Direct LLM API call (works without OpenClaw gateway)
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
  const accountCount = getAccountCount();
  const userSecretCount = getUserSecretCount();
  if (accountCount > 0 || userSecretCount > 0 || process.env.MOA_OWNER_SECRET) {
    const parts = [];
    if (accountCount > 0) parts.push(`${accountCount} account(s)`);
    if (userSecretCount > 0) parts.push(`${userSecretCount} user secret(s)`);
    if (process.env.MOA_OWNER_SECRET) parts.push("admin master key set");
    console.log(`[MoA] Owner auth: ENABLED (${parts.join(", ")})`);
  } else {
    console.log(
      "[MoA] Owner auth: DISABLED (users can register at /welcome, or set MOA_OWNER_SECRET for admin)",
    );
  }

  // Check Supabase
  if (isSupabaseConfigured()) {
    console.log("[MoA] Supabase: configured (billing & sync enabled)");
  } else {
    console.log("[MoA] Supabase: not configured (billing & sync disabled, AI chat still works)");
  }

  // Check proactive messaging (Friend Talk / Alim Talk)
  const notificationService = createNotificationService(account);
  if (notificationService.isConfigured()) {
    const templateCodes = listAlimTalkTemplateCodes();
    console.log(`[MoA] Proactive messaging: configured (Friend Talk + AlimTalk enabled)`);
    console.log(`[MoA] AlimTalk templates: ${templateCodes.length} defined (${templateCodes.join(", ")})`);
  } else {
    console.log(
      "[MoA] Proactive messaging: not configured (set TOAST_APP_KEY, TOAST_SECRET_KEY, KAKAO_SENDER_KEY)",
    );
  }

  // Load skills
  const skills = getLoadedSkills();
  console.log(`[MoA] Skills: ${skills.length} loaded (${skills.filter((s) => s.eligible).length} eligible)`);

  // Check OpenClaw gateway (provides agent with memory, tools, skills, heartbeat, cron)
  const gatewayUrl = process.env.MOA_OPENCLAW_GATEWAY_URL;
  if (gatewayUrl) {
    openclawGateway = new MoltbotGatewayClient({
      url: gatewayUrl,
      agentId: process.env.OPENCLAW_AGENT_ID ?? "main",
    });
    try {
      const gwStatus = await openclawGateway.checkStatus();
      openclawGatewayOnline = gwStatus.online;
      if (gwStatus.online) {
        console.log(`[MoA] OpenClaw gateway: CONNECTED (${gatewayUrl}, v${gwStatus.version ?? "?"})`);
        if (gwStatus.memoryStatus) {
          console.log(`[MoA] OpenClaw memory: ${gwStatus.memoryStatus.files} files, ${gwStatus.memoryStatus.chunks} chunks`);
        }
      } else {
        console.log(`[MoA] OpenClaw gateway: configured but offline (${gatewayUrl})`);
      }
    } catch (err) {
      console.log(`[MoA] OpenClaw gateway: connection failed (${err instanceof Error ? err.message : err})`);
    }
  } else {
    console.log("[MoA] OpenClaw gateway: not configured (set MOA_OPENCLAW_GATEWAY_URL to enable agent features)");
  }

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
      if (notificationService.isConfigured()) {
        // Try AlimTalk first (works even for non-friends), fallback to FriendTalk
        const { getUserPhoneNumberById } = await import("./src/proactive-messaging.js");
        const phone = await getUserPhoneNumberById(userId);
        if (phone) {
          const result = await notificationService.notifyDevicePaired(phone, deviceName);
          console.log(`[MoA] Device paired notification: ${result.method} ${result.success ? "OK" : result.error}`);
        } else {
          console.log("[MoA] No phone number for device paired notification — skipping");
        }
      } else if (isProactiveMessagingConfigured(account)) {
        // Legacy: FriendTalk only
        await sendWelcomeAfterPairing(userId, deviceName, account);
      }
    },

    // Event-driven immediate response: push result to user's chat within seconds
    onResultReceived: async ({ userId, deviceName, commandId, status, resultSummary }) => {
      const statusText = status === "completed" ? "완료" : "실패";
      console.log(`[MoA] Command ${statusText}: ${commandId.slice(0, 8)} from ${deviceName}`);

      // Try multi-channel notification (free-first: Gateway → FCM/APNs → AlimTalk)
      if (notificationService.isConfigured()) {
        const { getUserPhoneNumberById } = await import("./src/proactive-messaging.js");
        const phone = await getUserPhoneNumberById(userId);
        if (phone) {
          const result = await notificationService.notifyCommandResult(phone, {
            deviceName,
            commandText: "원격 명령",
            status: statusText,
            resultSummary: resultSummary || "(결과 없음)",
            commandId: commandId.slice(0, 8),
          });
          console.log(`[MoA] Result push: ${result.method} ${result.success ? "OK" : result.error}`);
        }
      }

      // Also try OpenClaw gateway broadcast (reaches WebSocket-connected clients)
      if (openclawGateway && openclawGatewayOnline) {
        try {
          await openclawGateway.sendMessage({
            userId,
            text: `[기기 ${deviceName}] 명령 ${statusText}: ${resultSummary || "(완료)"}`,
            sessionKey: `relay:${userId}`,
          });
        } catch {
          // Gateway broadcast is best-effort
        }
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
            openclawGateway: openclawGatewayOnline,
            kakao: hasKeys,
            telegram: isTelegramConfigured(),
            whatsapp: isWhatsAppConfigured(),
            discord: isDiscordConfigured(),
            slack: isSlackConfigured(),
            line: isLineConfigured(),
            ownerAuth: isOwnerAuthEnabled(),
            accounts: getAccountCount(),
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
        // Slack webhook (/slack/webhook)
        if (handleSlackRequest(req, res, aiOnMessage, console)) {
          return true;
        }
        // LINE webhook (/line/webhook)
        if (handleLineRequest(req, res, aiOnMessage, console)) {
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
    console.log(`[MoA] Backup page: ${localBase}/backup`);
    console.log(`[MoA] Payment API: ${localBase}/payment/*`);
    console.log(`[MoA] Relay API: ${localBase}/api/relay/*`);
    console.log(`[MoA] Settings page: ${localBase}/settings`);
    console.log(`[MoA] Health check: ${localBase}/health`);

    // Log WhatsApp webhook
    if (isWhatsAppConfigured()) {
      console.log(`[MoA] WhatsApp webhook: ${localBase}/whatsapp/webhook`);
    }

    // Log Slack webhook
    if (isSlackConfigured()) {
      console.log(`[MoA] Slack webhook: ${localBase}/slack/webhook`);
    }

    // Log LINE webhook
    if (isLineConfigured()) {
      console.log(`[MoA] LINE webhook: ${localBase}/line/webhook`);
    }

    // Register Telegram webhook if configured
    if (isTelegramConfigured()) {
      const publicDomain = process.env.RAILWAY_PUBLIC_DOMAIN;
      const publicUrl = publicDomain
        ? `https://${publicDomain}/telegram/webhook`
        : "https://mymoa.app/telegram/webhook";
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

    // Start daily weather greeting scheduler
    let weatherScheduler: { stop: () => void } | null = null;
    if (notificationService.isConfigured()) {
      weatherScheduler = startWeatherScheduler(account);
    } else {
      console.log("[MoA] Weather scheduler: disabled (proactive messaging not configured)");
    }

    // Graceful shutdown
    const shutdown = async (signal: string) => {
      console.log(`[MoA] Received ${signal}, shutting down...`);
      weatherScheduler?.stop();
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
