/**
 * Model Router - Multi-Provider LLM Routing
 *
 * Routes requests to appropriate LLM providers with:
 * - User API key priority
 * - Platform API fallback
 * - Free tier automatic switching
 * - Rate limit handling
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
 */
async function tryFallbackProviders(
  kakaoUserId: string,
  messages: ChatMessage[],
  maxTokens: number,
): Promise<ChatResponse | null> {
  const settings = await getUserSettings(kakaoUserId);

  // Fallback chain: Google Gemini -> Groq -> OpenRouter free
  const fallbacks: Array<{ provider: LLMProvider; model: string }> = [
    { provider: "google", model: "gemini-2.0-flash" },
    { provider: "groq", model: "llama-3.3-70b-versatile" },
    { provider: "openrouter", model: "google/gemini-2.0-flash-exp:free" },
  ];

  for (const fallback of fallbacks) {
    const apiKey = settings.apiKeys[fallback.provider] ?? getPlatformKey(fallback.provider);
    if (!apiKey) continue;

    try {
      const response = await callProvider(
        {
          provider: fallback.provider,
          model: fallback.model,
          apiKey,
          isFallback: true,
          isFree: true,
        },
        messages,
        maxTokens,
      );

      response.isFallback = true;
      response.isFree = true;
      return response;
    } catch {
      // Try next fallback
      continue;
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
