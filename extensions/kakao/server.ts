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
 * - LAWCALL_ENCRYPTION_KEY — Encryption key for relay commands
 * - RELAY_MAX_DEVICES — Max devices per user (default: 5)
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
} from "./src/channels/index.js";
import { getLoadedSkills, getSkillsSystemPrompt } from "./src/skills/index.js";

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
- /기기등록 : 새 기기 페어링
- /기기 : 연결된 기기 목록
- @기기명 명령 : 특정 기기에 원격 명령 (예: @노트북 ls ~/Desktop)
- /도움말 : 전체 명령어 보기
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
 * AI message handler — handles greetings, install requests, and general AI chat
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

  // 3) Device registration → Generate pairing code
  if (isDeviceRegistration(utterance)) {
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

  // 5) Feature inquiry
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

  // 6) Usage examples inquiry
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

  // 7) General AI chat — use LLM with MoA-optimized system prompt
  const llm = detectLlmProvider();

  if (!llm) {
    return {
      text: '현재 AI 응답 기능이 준비 중입니다.\n\nMoA 에이전트를 설치하시면 더 강력한 AI 기능을 이용할 수 있습니다!\n\n"설치"라고 입력해보세요.',
      quickReplies: ["설치", "기능 소개", "도움말"],
    };
  }

  const systemPrompt = getMoASystemPrompt(channelId);

  try {
    let responseText: string;

    switch (llm.provider) {
      case "anthropic":
        responseText = await callAnthropic(llm.apiKey, llm.model, systemPrompt, params.text);
        break;
      case "openai":
        responseText = await callOpenAICompatible(
          llm.endpoint,
          llm.apiKey,
          llm.model,
          systemPrompt,
          params.text,
        );
        break;
      case "google":
        responseText = await callGemini(llm.apiKey, llm.model, systemPrompt, params.text);
        break;
      case "groq":
        responseText = await callOpenAICompatible(
          llm.endpoint,
          llm.apiKey,
          llm.model,
          systemPrompt,
          params.text,
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

    // Graceful shutdown
    const shutdown = async (signal: string) => {
      console.log(`[MoA] Received ${signal}, shutting down...`);
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
