/**
 * Model Router - Multi-Provider LLM Routing
 *
 * Routes requests to appropriate LLM providers with:
 * - User API key priority
 * - Platform API fallback
 * - Free tier automatic switching
 * - Rate limit handling
 * - Complexity-based model selection (NEW)
 * - Privacy-aware local SLM routing (NEW)
 */

import {
  type LLMProvider,
  type ResolvedModel,
  resolveModel,
  getUserSettings,
  PROVIDERS,
  FREE_MODELS,
} from "./user-settings.js";
import { getCredits } from "./billing.js";
import {
  classifyComplexity,
  buildPremiumModelNotification,
  type ComplexityResult,
  type SuggestedModelTier,
} from "./complexity-classifier.js";
import {
  classifyPrivacy,
  canSendToExternalAPI,
  maskSensitiveData,
  type PrivacyResult,
} from "./privacy-classifier.js";
import {
  processThroughSLM,
  getMoAAgentStatus,
  type SLMRequest,
} from "./slm/index.js";

// ============================================
// Types
// ============================================

export interface ChatMessage {
  role: "user" | "assistant" | "system";
  content: string;
}

export interface ChatRequest {
  messages: ChatMessage[];
  model?: string;
  maxTokens?: number;
  temperature?: number;
  stream?: boolean;
}

export interface ChatResponse {
  content: string;
  model: string;
  provider: LLMProvider;
  usage: {
    inputTokens: number;
    outputTokens: number;
  };
  isFallback: boolean;
  isFree: boolean;
}

export interface RouterResult {
  success: boolean;
  response?: ChatResponse;
  error?: string;
  fallbackUsed?: boolean;
  fallbackProvider?: LLMProvider;
}

// ============================================
// Smart Routing Types (NEW)
// ============================================

export interface SmartRoutingAnalysis {
  complexity: ComplexityResult;
  privacy: PrivacyResult;
  suggestedTier: SuggestedModelTier;
  requiresUserConfirmation: boolean;
  requiresLocalProcessing: boolean;
}

export interface SmartRouterResult extends RouterResult {
  analysis?: SmartRoutingAnalysis;
  notificationMessage?: string;
  usedPremiumModel?: boolean;
  localProcessingRequired?: boolean;
}

export type UserConfirmationAction =
  | "use_premium" // 고급 모델 사용 (크레딧 차감)
  | "use_free" // 무료 모델로 시도
  | "register_api_key" // API 키 등록하러 가기
  | "cancel"; // 취소

export interface PendingPremiumRequest {
  kakaoUserId: string;
  originalMessage: string;
  analysis: SmartRoutingAnalysis;
  createdAt: Date;
  expiresAt: Date;
}

// ============================================
// Provider API Callers
// ============================================

async function callAnthropic(
  apiKey: string,
  model: string,
  messages: ChatMessage[],
  maxTokens: number,
): Promise<ChatResponse> {
  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      max_tokens: maxTokens,
      messages: messages.filter(m => m.role !== "system").map(m => ({
        role: m.role,
        content: m.content,
      })),
      system: messages.find(m => m.role === "system")?.content,
    }),
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: { message: response.statusText } }));
    throw new Error(error.error?.message ?? `Anthropic API error: ${response.status}`);
  }

  const data = await response.json() as {
    content: Array<{ type: string; text?: string }>;
    usage: { input_tokens: number; output_tokens: number };
  };

  const textContent = data.content.find(c => c.type === "text");

  return {
    content: textContent?.text ?? "",
    model,
    provider: "anthropic",
    usage: {
      inputTokens: data.usage.input_tokens,
      outputTokens: data.usage.output_tokens,
    },
    isFallback: false,
    isFree: false,
  };
}

async function callOpenAI(
  apiKey: string,
  model: string,
  messages: ChatMessage[],
  maxTokens: number,
): Promise<ChatResponse> {
  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      max_tokens: maxTokens,
      messages: messages.map(m => ({
        role: m.role,
        content: m.content,
      })),
    }),
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: { message: response.statusText } }));
    throw new Error(error.error?.message ?? `OpenAI API error: ${response.status}`);
  }

  const data = await response.json() as {
    choices: Array<{ message: { content: string } }>;
    usage: { prompt_tokens: number; completion_tokens: number };
  };

  return {
    content: data.choices[0]?.message?.content ?? "",
    model,
    provider: "openai",
    usage: {
      inputTokens: data.usage.prompt_tokens,
      outputTokens: data.usage.completion_tokens,
    },
    isFallback: false,
    isFree: false,
  };
}

async function callGoogle(
  apiKey: string,
  model: string,
  messages: ChatMessage[],
  maxTokens: number,
): Promise<ChatResponse> {
  // Convert messages to Gemini format
  const contents = [];
  let systemInstruction: string | undefined;

  for (const msg of messages) {
    if (msg.role === "system") {
      systemInstruction = msg.content;
    } else {
      contents.push({
        role: msg.role === "assistant" ? "model" : "user",
        parts: [{ text: msg.content }],
      });
    }
  }

  const requestBody: Record<string, unknown> = {
    contents,
    generationConfig: {
      maxOutputTokens: maxTokens,
    },
  };

  if (systemInstruction) {
    requestBody.systemInstruction = { parts: [{ text: systemInstruction }] };
  }

  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(requestBody),
    },
  );

  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: { message: response.statusText } }));
    throw new Error(error.error?.message ?? `Google API error: ${response.status}`);
  }

  const data = await response.json() as {
    candidates: Array<{ content: { parts: Array<{ text: string }> } }>;
    usageMetadata?: { promptTokenCount: number; candidatesTokenCount: number };
  };

  const textParts = data.candidates?.[0]?.content?.parts?.filter(p => p.text) ?? [];
  const content = textParts.map(p => p.text).join("");

  return {
    content,
    model,
    provider: "google",
    usage: {
      inputTokens: data.usageMetadata?.promptTokenCount ?? 0,
      outputTokens: data.usageMetadata?.candidatesTokenCount ?? 0,
    },
    isFallback: false,
    isFree: true, // Gemini has generous free tier
  };
}

async function callGroq(
  apiKey: string,
  model: string,
  messages: ChatMessage[],
  maxTokens: number,
): Promise<ChatResponse> {
  const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      max_tokens: maxTokens,
      messages: messages.map(m => ({
        role: m.role,
        content: m.content,
      })),
    }),
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: { message: response.statusText } }));
    throw new Error(error.error?.message ?? `Groq API error: ${response.status}`);
  }

  const data = await response.json() as {
    choices: Array<{ message: { content: string } }>;
    usage: { prompt_tokens: number; completion_tokens: number };
  };

  return {
    content: data.choices[0]?.message?.content ?? "",
    model,
    provider: "groq",
    usage: {
      inputTokens: data.usage.prompt_tokens,
      outputTokens: data.usage.completion_tokens,
    },
    isFallback: false,
    isFree: true, // Groq is free
  };
}

async function callTogether(
  apiKey: string,
  model: string,
  messages: ChatMessage[],
  maxTokens: number,
): Promise<ChatResponse> {
  const response = await fetch("https://api.together.xyz/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      max_tokens: maxTokens,
      messages: messages.map(m => ({
        role: m.role,
        content: m.content,
      })),
    }),
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: { message: response.statusText } }));
    throw new Error(error.error?.message ?? `Together API error: ${response.status}`);
  }

  const data = await response.json() as {
    choices: Array<{ message: { content: string } }>;
    usage: { prompt_tokens: number; completion_tokens: number };
  };

  return {
    content: data.choices[0]?.message?.content ?? "",
    model,
    provider: "together",
    usage: {
      inputTokens: data.usage.prompt_tokens,
      outputTokens: data.usage.completion_tokens,
    },
    isFallback: false,
    isFree: false,
  };
}

async function callOpenRouter(
  apiKey: string,
  model: string,
  messages: ChatMessage[],
  maxTokens: number,
): Promise<ChatResponse> {
  const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      "HTTP-Referer": "https://kakaomolt.com",
      "X-Title": "KakaoMolt",
    },
    body: JSON.stringify({
      model,
      max_tokens: maxTokens,
      messages: messages.map(m => ({
        role: m.role,
        content: m.content,
      })),
    }),
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: { message: response.statusText } }));
    throw new Error(error.error?.message ?? `OpenRouter API error: ${response.status}`);
  }

  const data = await response.json() as {
    choices: Array<{ message: { content: string } }>;
    usage: { prompt_tokens: number; completion_tokens: number };
  };

  const isFreeModel = model.includes(":free");

  return {
    content: data.choices[0]?.message?.content ?? "",
    model,
    provider: "openrouter",
    usage: {
      inputTokens: data.usage.prompt_tokens,
      outputTokens: data.usage.completion_tokens,
    },
    isFallback: false,
    isFree: isFreeModel,
  };
}

// ============================================
// Main Router
// ============================================

/**
 * Call LLM provider
 */
async function callProvider(
  resolved: ResolvedModel,
  messages: ChatMessage[],
  maxTokens: number,
): Promise<ChatResponse> {
  switch (resolved.provider) {
    case "anthropic":
      return callAnthropic(resolved.apiKey, resolved.model, messages, maxTokens);
    case "openai":
      return callOpenAI(resolved.apiKey, resolved.model, messages, maxTokens);
    case "google":
      return callGoogle(resolved.apiKey, resolved.model, messages, maxTokens);
    case "groq":
      return callGroq(resolved.apiKey, resolved.model, messages, maxTokens);
    case "together":
      return callTogether(resolved.apiKey, resolved.model, messages, maxTokens);
    case "openrouter":
      return callOpenRouter(resolved.apiKey, resolved.model, messages, maxTokens);
    default:
      throw new Error(`Unsupported provider: ${resolved.provider}`);
  }
}

/**
 * Route chat request to appropriate provider
 */
export async function routeChat(
  kakaoUserId: string,
  request: ChatRequest,
): Promise<RouterResult> {
  const maxTokens = request.maxTokens ?? 4096;

  // Get user's credit balance
  const credits = await getCredits(kakaoUserId);
  const hasCredits = credits > 0;

  // Resolve which model to use
  const resolved = await resolveModel(kakaoUserId, hasCredits);

  if ("error" in resolved) {
    return {
      success: false,
      error: resolved.error,
    };
  }

  try {
    const response = await callProvider(resolved, request.messages, maxTokens);

    // Update response with fallback info
    response.isFallback = resolved.isFallback;
    response.isFree = resolved.isFree;

    return {
      success: true,
      response,
      fallbackUsed: resolved.isFallback,
      fallbackProvider: resolved.isFallback ? resolved.provider : undefined,
    };
  } catch (err) {
    // If primary provider fails, try fallback
    if (!resolved.isFallback) {
      const fallbackResult = await tryFallbackProviders(kakaoUserId, request.messages, maxTokens);
      if (fallbackResult) {
        return {
          success: true,
          response: fallbackResult,
          fallbackUsed: true,
          fallbackProvider: fallbackResult.provider,
        };
      }
    }

    return {
      success: false,
      error: err instanceof Error ? err.message : "LLM 요청 실패",
    };
  }
}

/**
 * Try fallback providers when primary fails
 *
 * 폴백 순서:
 * 1. 무료 모델 (Gemini Flash → Groq → OpenRouter 무료)
 * 2. 유료 모델 가성비순 (Gemini Pro → GPT-4o Mini → Claude Haiku → ...)
 */
async function tryFallbackProviders(
  kakaoUserId: string,
  messages: ChatMessage[],
  maxTokens: number,
): Promise<ChatResponse | null> {
  const settings = await getUserSettings(kakaoUserId);
  const credits = await getCredits(kakaoUserId);
  const hasCredits = credits > 0;

  // 1단계: 무료 모델 먼저 시도
  const freeFallbacks: Array<{ provider: LLMProvider; model: string }> = [
    { provider: "google", model: "gemini-2.0-flash" },
    { provider: "groq", model: "llama-3.3-70b-versatile" },
    { provider: "openrouter", model: "google/gemini-2.0-flash-exp:free" },
  ];

  for (const fallback of freeFallbacks) {
    const apiKey = settings.apiKeys[fallback.provider] ?? getPlatformKey(fallback.provider);
    if (!apiKey) continue;

    try {
      const response = await callProvider(
        { provider: fallback.provider, model: fallback.model, apiKey, isFallback: true, isFree: true },
        messages, maxTokens,
      );
      response.isFallback = true;
      response.isFree = true;
      return response;
    } catch {
      continue;
    }
  }

  // 2단계: 유료 모델 가성비순 (사용자 키 우선, 없으면 플랫폼 키 + 크레딧)
  const paidFallbacks: Array<{ provider: LLMProvider; model: string }> = [
    { provider: "google", model: "gemini-1.5-pro" },
    { provider: "openai", model: "gpt-4o-mini" },
    { provider: "anthropic", model: "claude-3-5-haiku-latest" },
    { provider: "together", model: "meta-llama/Llama-3.3-70B-Instruct-Turbo" },
    { provider: "openai", model: "gpt-4o" },
    { provider: "anthropic", model: "claude-sonnet-4-20250514" },
  ];

  for (const fallback of paidFallbacks) {
    // 사용자 키가 있으면 무료 (isFree=true)
    const userKey = settings.apiKeys[fallback.provider];
    if (userKey) {
      try {
        const response = await callProvider(
          { provider: fallback.provider, model: fallback.model, apiKey: userKey, isFallback: true, isFree: true },
          messages, maxTokens,
        );
        response.isFallback = true;
        response.isFree = true;
        return response;
      } catch {
        continue;
      }
    }

    // 사용자 키 없으면 플랫폼 API 사용 (크레딧 차감, 2배)
    if (hasCredits) {
      const platformKey = getPlatformKey(fallback.provider);
      if (platformKey) {
        try {
          const response = await callProvider(
            { provider: fallback.provider, model: fallback.model, apiKey: platformKey, isFallback: true, isFree: false },
            messages, maxTokens,
          );
          response.isFallback = true;
          response.isFree = false;
          return response;
        } catch {
          continue;
        }
      }
    }
  }

  return null;
}

/**
 * Get platform API key
 */
function getPlatformKey(provider: LLMProvider): string | undefined {
  switch (provider) {
    case "anthropic":
      return process.env.ANTHROPIC_API_KEY;
    case "openai":
      return process.env.OPENAI_API_KEY;
    case "google":
      return process.env.GOOGLE_API_KEY ?? process.env.GEMINI_API_KEY;
    case "groq":
      return process.env.GROQ_API_KEY;
    case "together":
      return process.env.TOGETHER_API_KEY;
    case "openrouter":
      return process.env.OPENROUTER_API_KEY;
    default:
      return undefined;
  }
}

// ============================================
// Utility Functions
// ============================================

/**
 * Get friendly provider name
 */
export function getProviderDisplayName(provider: LLMProvider): string {
  return PROVIDERS[provider]?.displayName ?? provider;
}

/**
 * Get friendly model name
 */
export function getModelDisplayName(provider: LLMProvider, modelId: string): string {
  const model = PROVIDERS[provider]?.models.find(m => m.id === modelId);
  return model?.name ?? modelId;
}

/**
 * Format response with provider info
 */
export function formatResponseWithInfo(result: RouterResult): string {
  if (!result.success || !result.response) {
    return result.error ?? "오류가 발생했습니다.";
  }

  let text = result.response.content;

  // Add fallback notice if used
  if (result.fallbackUsed && result.fallbackProvider) {
    const providerName = getProviderDisplayName(result.fallbackProvider);
    text += `\n\n💡 _${providerName} 무료 모델로 자동 전환되었습니다._`;
  }

  return text;
}

/**
 * Get warning message when credits are low
 */
export function getLowCreditWarning(credits: number, hasApiKey: boolean): string | null {
  if (hasApiKey) return null;

  if (credits <= 0) {
    return `⚠️ 크레딧이 모두 소진되었습니다.

🆓 무료로 계속 사용하려면:
1. "API키 등록"이라고 말씀해주세요
2. Google Gemini API 키 등록 (무료!)

💳 또는 "충전"으로 크레딧을 충전하세요.`;
  }

  if (credits < 100) {
    return `⚠️ 크레딧이 부족합니다 (${credits} 남음)

💡 무료 API 키를 등록하면 무료로 이용 가능합니다!
"API키 등록"이라고 말씀해주세요.`;
  }

  return null;
}

/**
 * Get token count estimate (rough approximation)
 */
export function estimateTokens(text: string): number {
  // Rough estimate: ~4 characters per token for Korean
  return Math.ceil(text.length / 4);
}

// ============================================
// Smart Routing (NEW)
// ============================================

// 대기 중인 고급 모델 요청 저장소 (메모리)
const pendingPremiumRequests = new Map<string, PendingPremiumRequest>();

/**
 * 스마트 라우팅: 복잡도 + 프라이버시 기반 모델 선택
 *
 * 1. 메시지 복잡도 분석
 * 2. 프라이버시 민감도 분석
 * 3. 적절한 모델 티어 결정
 * 4. 사용자 확인 필요시 알림 생성
 */
export async function smartRouteChat(
  kakaoUserId: string,
  userMessage: string,
  request: ChatRequest,
): Promise<SmartRouterResult> {
  // 1. 복잡도 분석
  const complexity = classifyComplexity(userMessage);

  // 2. 프라이버시 분석
  const privacy = classifyPrivacy(userMessage);

  // 3. 분석 결과 종합
  const analysis: SmartRoutingAnalysis = {
    complexity,
    privacy,
    suggestedTier: privacy.shouldUseLocalSLM ? "local" : complexity.suggestedTier,
    requiresUserConfirmation: complexity.requiresUserConfirmation && !privacy.shouldUseLocalSLM,
    requiresLocalProcessing: privacy.shouldUseLocalSLM,
  };

  // 4. 로컬 처리가 필요한 경우 (민감 정보)
  if (analysis.requiresLocalProcessing) {
    // Try to process through local SLM
    const agentStatus = getMoAAgentStatus();

    if (agentStatus.slmReady) {
      // Convert request to SLM format
      const slmRequest: SLMRequest = {
        messages: request.messages.map(m => ({
          role: m.role,
          content: m.content,
        })),
        maxTokens: request.maxTokens,
        temperature: request.temperature,
      };

      const slmResult = await processThroughSLM(userMessage, slmRequest, {
        forceLocal: true, // Force local for privacy
      });

      if (slmResult.success && slmResult.response) {
        return {
          success: true,
          response: {
            content: slmResult.response.content,
            model: slmResult.response.model,
            provider: "local" as LLMProvider,
            usage: {
              inputTokens: slmResult.response.usage.promptTokens,
              outputTokens: slmResult.response.usage.completionTokens,
            },
            isFallback: false,
            isFree: true, // Local processing is free
          },
          analysis,
          localProcessingRequired: true,
          notificationMessage: `🔒 개인정보 보호를 위해 로컬 AI로 처리했습니다.\n${privacy.warningMessage || ""}`,
        };
      }
    }

    // Local SLM not available - warn user but allow cloud fallback with masking
    return {
      success: false,
      localProcessingRequired: true,
      analysis,
      notificationMessage: `⚠️ 민감한 정보가 감지되었습니다.\n${privacy.warningMessage}\n\n로컬 AI가 준비되지 않아 처리할 수 없습니다.\n"MoA 설치"라고 입력하여 로컬 AI를 설치하세요.`,
      error: "LOCAL_PROCESSING_REQUIRED",
    };
  }

  // 5. 사용자 설정 및 크레딧 확인
  const settings = await getUserSettings(kakaoUserId);
  const credits = await getCredits(kakaoUserId);

  // 고급 모델용 API 키 확인
  const hasPremiumApiKey =
    !!settings.apiKeys.anthropic ||
    !!settings.apiKeys.openai ||
    !!settings.apiKeys.google;

  // 6. 고급 모델이 필요하고 API 키가 없는 경우 → 사용자 확인 필요
  if (analysis.requiresUserConfirmation && !hasPremiumApiKey) {
    const notification = buildPremiumModelNotification(complexity, false, credits);

    if (notification.required) {
      // 대기 요청 저장
      const pending: PendingPremiumRequest = {
        kakaoUserId,
        originalMessage: userMessage,
        analysis,
        createdAt: new Date(),
        expiresAt: new Date(Date.now() + 5 * 60 * 1000), // 5분 후 만료
      };
      pendingPremiumRequests.set(kakaoUserId, pending);

      return {
        success: false,
        analysis,
        notificationMessage: notification.message,
        error: "PREMIUM_CONFIRMATION_REQUIRED",
      };
    }
  }

  // 7. 고급 모델이 필요하고 API 키가 있는 경우 → 자동 사용
  if (analysis.suggestedTier === "premium" && hasPremiumApiKey) {
    const notification = buildPremiumModelNotification(complexity, true, credits);

    const result = await routeChatWithTier(kakaoUserId, request, "premium");

    return {
      ...result,
      analysis,
      notificationMessage: notification.message,
      usedPremiumModel: true,
    };
  }

  // 8. 일반 라우팅 (복잡도 기반)
  const result = await routeChatWithTier(kakaoUserId, request, analysis.suggestedTier);

  return {
    ...result,
    analysis,
  };
}

/**
 * 특정 티어로 라우팅
 */
async function routeChatWithTier(
  kakaoUserId: string,
  request: ChatRequest,
  tier: SuggestedModelTier,
): Promise<RouterResult> {
  const maxTokens = request.maxTokens ?? 4096;
  const settings = await getUserSettings(kakaoUserId);
  const credits = await getCredits(kakaoUserId);

  // 티어별 모델 목록
  const tierModels: Record<SuggestedModelTier, Array<{ provider: LLMProvider; model: string }>> = {
    free: [
      { provider: "google", model: "gemini-2.0-flash" },
      { provider: "groq", model: "llama-3.3-70b-versatile" },
      { provider: "openrouter", model: "google/gemini-2.0-flash-exp:free" },
    ],
    cheap: [
      { provider: "anthropic", model: "claude-3-5-haiku-latest" },
      { provider: "openai", model: "gpt-4o-mini" },
      { provider: "google", model: "gemini-1.5-pro" },
    ],
    premium: [
      { provider: "anthropic", model: "claude-opus-4-5-20251101" },
      { provider: "openai", model: "gpt-5.2" },
      { provider: "google", model: "gemini-3-pro-preview" },
    ],
    local: [], // 로컬은 별도 처리
  };

  const models = tierModels[tier] || tierModels.free;

  // 각 모델 시도
  for (const { provider, model } of models) {
    // 사용자 키 우선
    const userKey = settings.apiKeys[provider];
    if (userKey) {
      try {
        const response = await callProvider(
          { provider, model, apiKey: userKey, isFallback: false, isFree: true },
          request.messages,
          maxTokens,
        );
        return { success: true, response };
      } catch {
        continue;
      }
    }

    // 플랫폼 키 (크레딧 필요)
    if (credits > 0 || tier === "free") {
      const platformKey = getPlatformKey(provider);
      if (platformKey) {
        try {
          const response = await callProvider(
            { provider, model, apiKey: platformKey, isFallback: false, isFree: tier === "free" },
            request.messages,
            maxTokens,
          );
          return { success: true, response };
        } catch {
          continue;
        }
      }
    }
  }

  // 모든 모델 실패 시 폴백
  return routeChat(kakaoUserId, request);
}

/**
 * 사용자 확인 후 고급 모델 요청 처리
 */
export async function handlePremiumConfirmation(
  kakaoUserId: string,
  action: UserConfirmationAction,
  request?: ChatRequest,
): Promise<SmartRouterResult> {
  const pending = pendingPremiumRequests.get(kakaoUserId);

  if (!pending) {
    return {
      success: false,
      error: "대기 중인 요청이 없습니다.",
    };
  }

  // 만료 확인
  if (new Date() > pending.expiresAt) {
    pendingPremiumRequests.delete(kakaoUserId);
    return {
      success: false,
      error: "요청이 만료되었습니다. 다시 시도해주세요.",
    };
  }

  // 대기 요청 삭제
  pendingPremiumRequests.delete(kakaoUserId);

  switch (action) {
    case "use_premium": {
      // 크레딧으로 고급 모델 사용
      const credits = await getCredits(kakaoUserId);
      if (credits < 100) {
        return {
          success: false,
          error: "크레딧이 부족합니다. 충전 후 다시 시도해주세요.",
          notificationMessage: `💰 현재 잔액: ${credits} 크레딧\n\n"충전"이라고 입력하여 크레딧을 충전하세요.`,
        };
      }

      // 원본 메시지로 요청 생성
      const chatRequest: ChatRequest = request ?? {
        messages: [{ role: "user", content: pending.originalMessage }],
      };

      return routeChatWithTier(kakaoUserId, chatRequest, "premium").then((result) => ({
        ...result,
        analysis: pending.analysis,
        usedPremiumModel: true,
        notificationMessage: `🧠 고급 모델을 사용합니다. (크레딧 차감)`,
      }));
    }

    case "use_free": {
      // 무료 모델로 시도
      const chatRequest: ChatRequest = request ?? {
        messages: [{ role: "user", content: pending.originalMessage }],
      };

      return routeChatWithTier(kakaoUserId, chatRequest, "free").then((result) => ({
        ...result,
        analysis: pending.analysis,
        notificationMessage: `🆓 무료 모델로 처리합니다. (품질이 낮을 수 있습니다)`,
      }));
    }

    case "register_api_key":
      return {
        success: false,
        analysis: pending.analysis,
        notificationMessage: `🔑 API 키 등록 안내

다음 중 하나를 등록하시면 무료로 고급 모델을 사용할 수 있습니다:

1️⃣ **Anthropic Claude**
   → https://console.anthropic.com
   → "API키 등록 anthropic sk-ant-xxx"

2️⃣ **OpenAI GPT**
   → https://platform.openai.com
   → "API키 등록 openai sk-xxx"

3️⃣ **Google Gemini** (무료!)
   → https://aistudio.google.com
   → "API키 등록 google AIza..."`,
        error: "API_KEY_REGISTRATION",
      };

    case "cancel":
    default:
      return {
        success: false,
        analysis: pending.analysis,
        notificationMessage: "요청이 취소되었습니다.",
        error: "CANCELLED",
      };
  }
}

/**
 * 사용자 응답이 고급 모델 확인인지 확인
 */
export function isPremiumConfirmationResponse(message: string): UserConfirmationAction | null {
  const normalized = message.trim().toLowerCase();

  // 고급 모델 사용
  if (/^(고급\s*모델|프리미엄|premium|고급|use\s*premium)/i.test(normalized)) {
    return "use_premium";
  }

  // 무료로 시도
  if (/^(무료|무료로|free|try\s*free|무료\s*시도)/i.test(normalized)) {
    return "use_free";
  }

  // API 키 등록
  if (/^(api\s*키|apikey|키\s*등록|register)/i.test(normalized)) {
    return "register_api_key";
  }

  // 취소
  if (/^(취소|cancel|아니|no)/i.test(normalized)) {
    return "cancel";
  }

  return null;
}

/**
 * 대기 중인 고급 모델 요청 확인
 */
export function hasPendingPremiumRequest(kakaoUserId: string): boolean {
  const pending = pendingPremiumRequests.get(kakaoUserId);
  if (!pending) return false;

  // 만료 확인
  if (new Date() > pending.expiresAt) {
    pendingPremiumRequests.delete(kakaoUserId);
    return false;
  }

  return true;
}

/**
 * 스마트 라우팅 분석만 수행 (라우팅 없이)
 */
export function analyzeMessage(message: string): SmartRoutingAnalysis {
  const complexity = classifyComplexity(message);
  const privacy = classifyPrivacy(message);

  return {
    complexity,
    privacy,
    suggestedTier: privacy.shouldUseLocalSLM ? "local" : complexity.suggestedTier,
    requiresUserConfirmation: complexity.requiresUserConfirmation && !privacy.shouldUseLocalSLM,
    requiresLocalProcessing: privacy.shouldUseLocalSLM,
  };
}

/**
 * 분석 결과를 사용자 친화적 메시지로 변환
 */
export function formatAnalysisSummary(analysis: SmartRoutingAnalysis): string {
  const { complexity, privacy } = analysis;

  let summary = "";

  // 복잡도 정보
  const complexityEmoji =
    complexity.level === "simple" ? "🟢" :
    complexity.level === "general" ? "🟡" :
    complexity.level === "complex" ? "🟠" : "🔴";

  summary += `${complexityEmoji} 복잡도: ${complexity.score}/5 (${complexity.reason})\n`;

  // 프라이버시 정보
  if (privacy.isPrivate) {
    const privacyEmoji = privacy.level === "critical" ? "🔴" : privacy.level === "sensitive" ? "🟠" : "🟡";
    summary += `${privacyEmoji} 민감도: ${privacy.reason}\n`;
  }

  // 추천 모델
  const tierLabels: Record<SuggestedModelTier, string> = {
    free: "🆓 무료 모델",
    cheap: "💰 저렴한 모델",
    premium: "🧠 고급 모델",
    local: "🔒 로컬 처리",
  };
  summary += `📍 추천: ${tierLabels[analysis.suggestedTier]}`;

  return summary;
}
