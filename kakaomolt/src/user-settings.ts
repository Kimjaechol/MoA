/**
 * User Settings & Multi-Provider API Key Management
 *
 * Manages user preferences including:
 * - Multiple API keys for different providers
 * - Model selection and preferences
 * - Free tier fallback configuration
 */

import { createHash, createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { getSupabase, isSupabaseConfigured } from "./supabase.js";

// ============================================
// Types
// ============================================

export type LLMProvider =
  | "anthropic"  // Claude
  | "openai"     // GPT
  | "google"     // Gemini
  | "groq"       // Groq (Llama, Mixtral)
  | "together"   // Together AI
  | "openrouter"; // OpenRouter (multi-model)

export interface ProviderInfo {
  id: LLMProvider;
  name: string;
  displayName: string;
  keyPrefix: string;
  keyPattern: RegExp;
  website: string;
  freeCredits?: string;
  freeTier?: boolean;
  models: ModelInfo[];
}

export interface ModelInfo {
  id: string;
  name: string;
  provider: LLMProvider;
  inputPrice: number;  // per 1M tokens in KRW
  outputPrice: number; // per 1M tokens in KRW
  contextWindow: number;
  recommended?: boolean;
  free?: boolean;
}

export interface UserSettings {
  userId: string;
  kakaoUserId: string;
  preferredProvider: LLMProvider;
  preferredModel: string;
  apiKeys: Partial<Record<LLMProvider, string>>; // Encrypted
  autoFallback: boolean; // Auto-switch to free tier when credits run out
  /**
   * AI 모델 적용 모드
   * - "manual": 이용자가 직접 선택한 모델만 사용
   * - "cost_effective": 무료/가성비 우선 (기본값)
   * - "best_performance": 최고 성능 우선
   */
  modelMode: "manual" | "cost_effective" | "best_performance";
  createdAt: Date;
  updatedAt: Date;
}

// ============================================
// Provider & Model Registry
// ============================================

export const PROVIDERS: Record<LLMProvider, ProviderInfo> = {
  anthropic: {
    id: "anthropic",
    name: "Anthropic",
    displayName: "Anthropic (Claude)",
    keyPrefix: "sk-ant-",
    keyPattern: /^sk-ant-[a-zA-Z0-9_-]{20,}$/,
    website: "https://console.anthropic.com",
    models: [
      { id: "claude-3-5-haiku-20241022", name: "Claude 3.5 Haiku", provider: "anthropic", inputPrice: 800, outputPrice: 4000, contextWindow: 200000, recommended: true },
      { id: "claude-3-5-sonnet-20241022", name: "Claude 3.5 Sonnet", provider: "anthropic", inputPrice: 3000, outputPrice: 15000, contextWindow: 200000 },
      { id: "claude-sonnet-4-20250514", name: "Claude Sonnet 4", provider: "anthropic", inputPrice: 3000, outputPrice: 15000, contextWindow: 200000 },
      { id: "claude-opus-4-5-20251101", name: "Claude Opus 4.5", provider: "anthropic", inputPrice: 15000, outputPrice: 75000, contextWindow: 200000 },
    ],
  },
  openai: {
    id: "openai",
    name: "OpenAI",
    displayName: "OpenAI (GPT)",
    keyPrefix: "sk-",
    keyPattern: /^sk-[a-zA-Z0-9]{20,}$/,
    website: "https://platform.openai.com",
    models: [
      { id: "gpt-4o-mini", name: "GPT-4o Mini", provider: "openai", inputPrice: 150, outputPrice: 600, contextWindow: 128000, recommended: true },
      { id: "gpt-4o", name: "GPT-4o", provider: "openai", inputPrice: 2500, outputPrice: 10000, contextWindow: 128000 },
      { id: "o1-mini", name: "o1 Mini", provider: "openai", inputPrice: 3000, outputPrice: 12000, contextWindow: 128000 },
      { id: "o1", name: "o1", provider: "openai", inputPrice: 15000, outputPrice: 60000, contextWindow: 200000 },
    ],
  },
  google: {
    id: "google",
    name: "Google",
    displayName: "Google (Gemini)",
    keyPrefix: "AIza",
    keyPattern: /^AIza[a-zA-Z0-9_-]{35}$/,
    website: "https://aistudio.google.com",
    freeCredits: "월 1,500회 무료 (Gemini Flash)",
    freeTier: true,
    models: [
      { id: "gemini-2.0-flash", name: "Gemini 2.0 Flash", provider: "google", inputPrice: 0, outputPrice: 0, contextWindow: 1000000, recommended: true, free: true },
      { id: "gemini-1.5-flash", name: "Gemini 1.5 Flash", provider: "google", inputPrice: 75, outputPrice: 300, contextWindow: 1000000, free: true },
      { id: "gemini-1.5-pro", name: "Gemini 1.5 Pro", provider: "google", inputPrice: 1250, outputPrice: 5000, contextWindow: 2000000 },
    ],
  },
  groq: {
    id: "groq",
    name: "Groq",
    displayName: "Groq (초고속 무료)",
    keyPrefix: "gsk_",
    keyPattern: /^gsk_[a-zA-Z0-9]{50,}$/,
    website: "https://console.groq.com",
    freeCredits: "무료 (속도 제한만 있음)",
    freeTier: true,
    models: [
      { id: "llama-3.3-70b-versatile", name: "Llama 3.3 70B", provider: "groq", inputPrice: 0, outputPrice: 0, contextWindow: 128000, recommended: true, free: true },
      { id: "mixtral-8x7b-32768", name: "Mixtral 8x7B", provider: "groq", inputPrice: 0, outputPrice: 0, contextWindow: 32768, free: true },
      { id: "gemma2-9b-it", name: "Gemma 2 9B", provider: "groq", inputPrice: 0, outputPrice: 0, contextWindow: 8192, free: true },
    ],
  },
  together: {
    id: "together",
    name: "Together AI",
    displayName: "Together AI",
    keyPrefix: "",
    keyPattern: /^[a-f0-9]{64}$/,
    website: "https://api.together.xyz",
    freeCredits: "$25 무료 크레딧 (가입 시)",
    models: [
      { id: "meta-llama/Llama-3.3-70B-Instruct-Turbo", name: "Llama 3.3 70B Turbo", provider: "together", inputPrice: 88, outputPrice: 88, contextWindow: 128000, recommended: true },
      { id: "mistralai/Mixtral-8x22B-Instruct-v0.1", name: "Mixtral 8x22B", provider: "together", inputPrice: 120, outputPrice: 120, contextWindow: 65536 },
      { id: "Qwen/Qwen2.5-72B-Instruct-Turbo", name: "Qwen 2.5 72B", provider: "together", inputPrice: 120, outputPrice: 120, contextWindow: 32768 },
    ],
  },
  openrouter: {
    id: "openrouter",
    name: "OpenRouter",
    displayName: "OpenRouter (통합)",
    keyPrefix: "sk-or-",
    keyPattern: /^sk-or-[a-zA-Z0-9_-]{40,}$/,
    website: "https://openrouter.ai",
    freeCredits: "$1 무료 크레딧",
    models: [
      { id: "google/gemini-2.0-flash-exp:free", name: "Gemini 2.0 Flash (Free)", provider: "openrouter", inputPrice: 0, outputPrice: 0, contextWindow: 1000000, recommended: true, free: true },
      { id: "meta-llama/llama-3.3-70b-instruct:free", name: "Llama 3.3 70B (Free)", provider: "openrouter", inputPrice: 0, outputPrice: 0, contextWindow: 128000, free: true },
      { id: "anthropic/claude-3.5-haiku", name: "Claude 3.5 Haiku", provider: "openrouter", inputPrice: 800, outputPrice: 4000, contextWindow: 200000 },
    ],
  },
};

// All available models across all providers
export const ALL_MODELS: ModelInfo[] = Object.values(PROVIDERS).flatMap(p => p.models);

// Free models for fallback
export const FREE_MODELS: ModelInfo[] = ALL_MODELS.filter(m => m.free);

// ============================================
// 4단계 폴백 체인 (Fallback Chain)
// ============================================
//
// 1단계: 무료 고성능 모델 (Gemini Flash - 월 1,500회 무료)
// 2단계: 무료 차선 모델 (Groq - 완전 무료, 속도제한)
// 3단계: 유료 모델 - 성능 좋고 API 비용이 저렴한 순서
// 4단계: API 미설정 시 → 플랫폼 유료 API 사용
// ============================================

/** 1~2단계: 무료 폴백 체인 */
export const FREE_FALLBACK_CHAIN: { provider: LLMProvider; model: string; tier: string }[] = [
  { provider: "google", model: "gemini-2.0-flash", tier: "무료 고성능" },
  { provider: "groq", model: "llama-3.3-70b-versatile", tier: "무료" },
  { provider: "openrouter", model: "google/gemini-2.0-flash-exp:free", tier: "무료" },
];

/**
 * 3단계: 유료 폴백 체인 (성능 대비 가격이 좋은 순서)
 *
 * 정렬 기준: 성능/가격 비율 (가성비)
 * - Gemini 1.5 Pro: 높은 성능, 매우 저렴 (입력 1,250원/1M)
 * - GPT-4o Mini: 괜찮은 성능, 매우 저렴 (입력 150원/1M)
 * - Claude 3.5 Haiku: 빠르고 저렴 (입력 800원/1M)
 * - Together Llama 3.3: 오픈소스, 저렴 (입력 88원/1M)
 * - GPT-4o: 높은 성능, 중간 가격 (입력 2,500원/1M)
 * - Claude Sonnet 4: 높은 성능, 중간 가격 (입력 3,000원/1M)
 * - Claude Opus 4.5: 최고 성능, 고가 (입력 15,000원/1M)
 */
export const PAID_FALLBACK_CHAIN: { provider: LLMProvider; model: string; tier: string }[] = [
  { provider: "google", model: "gemini-1.5-pro", tier: "유료 가성비" },
  { provider: "openai", model: "gpt-4o-mini", tier: "유료 저렴" },
  { provider: "anthropic", model: "claude-3-5-haiku-latest", tier: "유료 저렴" },
  { provider: "together", model: "meta-llama/Llama-3.3-70B-Instruct-Turbo", tier: "유료 저렴" },
  { provider: "openai", model: "gpt-4o", tier: "유료 고성능" },
  { provider: "anthropic", model: "claude-sonnet-4-20250514", tier: "유료 고성능" },
  { provider: "anthropic", model: "claude-opus-4-5-20251101", tier: "유료 최고성능" },
];

/**
 * 최고 성능 우선 폴백 체인 ("최고 성능 AI 우선 적용" 모드)
 *
 * 성능이 가장 좋은 모델부터 시도, 비용은 부차적
 * Claude Opus 4.5 → GPT-4o → Claude Sonnet 4 → Gemini Pro → GPT-4o Mini → Haiku → Together
 */
export const PERFORMANCE_FALLBACK_CHAIN: { provider: LLMProvider; model: string; tier: string }[] = [
  { provider: "anthropic", model: "claude-opus-4-5-20251101", tier: "최고성능" },
  { provider: "openai", model: "gpt-4o", tier: "고성능" },
  { provider: "anthropic", model: "claude-sonnet-4-20250514", tier: "고성능" },
  { provider: "google", model: "gemini-1.5-pro", tier: "고성능" },
  { provider: "openai", model: "gpt-4o-mini", tier: "준수" },
  { provider: "anthropic", model: "claude-3-5-haiku-latest", tier: "빠름" },
  { provider: "together", model: "meta-llama/Llama-3.3-70B-Instruct-Turbo", tier: "오픈소스" },
];

// 이전 코드 호환용
export const FALLBACK_CHAIN = FREE_FALLBACK_CHAIN;

// ============================================
// Encryption Utilities
// ============================================

function getEncryptionKey(): Buffer {
  const key = process.env.OPENCLAW_ENCRYPTION_KEY ?? process.env.SUPABASE_SERVICE_KEY ?? "default-key-change-me";
  return createHash("sha256").update(key).digest();
}

function encryptApiKey(apiKey: string): string {
  const iv = randomBytes(16);
  const cipher = createCipheriv("aes-256-cbc", getEncryptionKey(), iv);
  let encrypted = cipher.update(apiKey, "utf8", "hex");
  encrypted += cipher.final("hex");
  return iv.toString("hex") + ":" + encrypted;
}

function decryptApiKey(encryptedKey: string): string {
  try {
    const [ivHex, encrypted] = encryptedKey.split(":");
    const iv = Buffer.from(ivHex, "hex");
    const decipher = createDecipheriv("aes-256-cbc", getEncryptionKey(), iv);
    let decrypted = decipher.update(encrypted, "hex", "utf8");
    decrypted += decipher.final("utf8");
    return decrypted;
  } catch {
    return "";
  }
}

// ============================================
// User Settings CRUD
// ============================================

/**
 * Hash user ID for privacy
 */
export function hashUserId(kakaoUserId: string): string {
  const salt = process.env.OPENCLAW_USER_SALT ?? "openclaw-default-salt";
  return createHash("sha256").update(kakaoUserId + salt).digest("hex");
}

/**
 * Get user settings (creates default if not exists)
 */
export async function getUserSettings(kakaoUserId: string): Promise<UserSettings> {
  const hashedId = hashUserId(kakaoUserId);

  if (!isSupabaseConfigured()) {
    // Development fallback
    return {
      userId: hashedId,
      kakaoUserId: hashedId,
      preferredProvider: "anthropic",
      preferredModel: "claude-3-5-haiku-20241022",
      apiKeys: {},
      autoFallback: true,
      modelMode: "cost_effective", // 기본값: 무료/가성비 우선
      createdAt: new Date(),
      updatedAt: new Date(),
    };
  }

  const supabase = getSupabase();

  // Try to get existing settings
  const { data: existing } = await supabase
    .from("user_settings")
    .select("*")
    .eq("kakao_user_id", hashedId)
    .single();

  if (existing) {
    // Decrypt API keys
    const apiKeys: Partial<Record<LLMProvider, string>> = {};
    if (existing.api_keys) {
      for (const [provider, encrypted] of Object.entries(existing.api_keys)) {
        if (encrypted && typeof encrypted === "string") {
          apiKeys[provider as LLMProvider] = decryptApiKey(encrypted);
        }
      }
    }

    return {
      userId: existing.id,
      kakaoUserId: existing.kakao_user_id,
      preferredProvider: existing.preferred_provider ?? "anthropic",
      preferredModel: existing.preferred_model ?? "claude-3-5-haiku-20241022",
      apiKeys,
      autoFallback: existing.auto_fallback ?? true,
      createdAt: new Date(existing.created_at),
      updatedAt: new Date(existing.updated_at),
    };
  }

  // Create default settings
  const { data: newSettings, error } = await supabase
    .from("user_settings")
    .insert({
      kakao_user_id: hashedId,
      preferred_provider: "anthropic",
      preferred_model: "claude-3-5-haiku-20241022",
      api_keys: {},
      auto_fallback: true,
    })
    .select()
    .single();

  if (error || !newSettings) {
    throw new Error(`Failed to create user settings: ${error?.message}`);
  }

  return {
    userId: newSettings.id,
    kakaoUserId: newSettings.kakao_user_id,
    preferredProvider: "anthropic",
    preferredModel: "claude-3-5-haiku-20241022",
    apiKeys: {},
    autoFallback: true,
    modelMode: "cost_effective",
    createdAt: new Date(newSettings.created_at),
    updatedAt: new Date(newSettings.updated_at),
  };
}

/**
 * Set API key for a specific provider
 */
export async function setProviderApiKey(
  kakaoUserId: string,
  provider: LLMProvider,
  apiKey: string,
): Promise<void> {
  const hashedId = hashUserId(kakaoUserId);
  const encryptedKey = encryptApiKey(apiKey);

  if (!isSupabaseConfigured()) {
    return;
  }

  const supabase = getSupabase();

  // Get existing settings first
  await getUserSettings(kakaoUserId);

  // Update API keys using JSONB set
  await supabase.rpc("set_user_api_key", {
    p_kakao_user_id: hashedId,
    p_provider: provider,
    p_encrypted_key: encryptedKey,
  });
}

/**
 * Remove API key for a specific provider
 */
export async function removeProviderApiKey(
  kakaoUserId: string,
  provider: LLMProvider,
): Promise<void> {
  const hashedId = hashUserId(kakaoUserId);

  if (!isSupabaseConfigured()) {
    return;
  }

  const supabase = getSupabase();

  await supabase.rpc("remove_user_api_key", {
    p_kakao_user_id: hashedId,
    p_provider: provider,
  });
}

/**
 * Set preferred model
 */
export async function setPreferredModel(
  kakaoUserId: string,
  provider: LLMProvider,
  modelId: string,
): Promise<void> {
  const hashedId = hashUserId(kakaoUserId);

  if (!isSupabaseConfigured()) {
    return;
  }

  const supabase = getSupabase();

  await supabase
    .from("user_settings")
    .update({
      preferred_provider: provider,
      preferred_model: modelId,
      updated_at: new Date().toISOString(),
    })
    .eq("kakao_user_id", hashedId);
}

/**
 * Toggle auto-fallback setting
 */
export async function setAutoFallback(
  kakaoUserId: string,
  enabled: boolean,
): Promise<void> {
  const hashedId = hashUserId(kakaoUserId);

  if (!isSupabaseConfigured()) {
    return;
  }

  const supabase = getSupabase();

  await supabase
    .from("user_settings")
    .update({
      auto_fallback: enabled,
      updated_at: new Date().toISOString(),
    })
    .eq("kakao_user_id", hashedId);
}

// ============================================
// API Key Validation
// ============================================

/**
 * Validate API key format for a provider
 */
export function isValidKeyFormat(provider: LLMProvider, apiKey: string): boolean {
  const providerInfo = PROVIDERS[provider];
  if (!providerInfo) { return false; }

  // Special case for Together AI (hex string)
  if (provider === "together") {
    return /^[a-f0-9]{64}$/i.test(apiKey);
  }

  return providerInfo.keyPattern.test(apiKey);
}

/**
 * Detect provider from API key
 */
export function detectProviderFromKey(apiKey: string): LLMProvider | null {
  if (apiKey.startsWith("sk-ant-")) { return "anthropic"; }
  if (apiKey.startsWith("AIza")) { return "google"; }
  if (apiKey.startsWith("gsk_")) { return "groq"; }
  if (apiKey.startsWith("sk-or-")) { return "openrouter"; }
  if (/^[a-f0-9]{64}$/i.test(apiKey)) { return "together"; }
  if (apiKey.startsWith("sk-")) { return "openai"; }
  return null;
}

/**
 * Validate API key by making a test request
 */
export async function validateApiKey(
  provider: LLMProvider,
  apiKey: string,
): Promise<{ valid: boolean; error?: string }> {
  try {
    switch (provider) {
      case "anthropic": {
        const response = await fetch("https://api.anthropic.com/v1/messages", {
          method: "POST",
          headers: {
            "x-api-key": apiKey,
            "anthropic-version": "2023-06-01",
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            model: "claude-3-haiku-20240307",
            max_tokens: 1,
            messages: [{ role: "user", content: "hi" }],
          }),
        });
        if (response.status === 401) {
          return { valid: false, error: "유효하지 않은 API 키입니다." };
        }
        return { valid: true };
      }

      case "openai": {
        const response = await fetch("https://api.openai.com/v1/models", {
          headers: { Authorization: `Bearer ${apiKey}` },
        });
        if (response.status === 401) {
          return { valid: false, error: "유효하지 않은 API 키입니다." };
        }
        return { valid: true };
      }

      case "google": {
        const response = await fetch(
          `https://generativelanguage.googleapis.com/v1/models?key=${apiKey}`,
        );
        if (response.status === 400 || response.status === 403) {
          return { valid: false, error: "유효하지 않은 API 키입니다." };
        }
        return { valid: true };
      }

      case "groq": {
        const response = await fetch("https://api.groq.com/openai/v1/models", {
          headers: { Authorization: `Bearer ${apiKey}` },
        });
        if (response.status === 401) {
          return { valid: false, error: "유효하지 않은 API 키입니다." };
        }
        return { valid: true };
      }

      case "together": {
        const response = await fetch("https://api.together.xyz/v1/models", {
          headers: { Authorization: `Bearer ${apiKey}` },
        });
        if (response.status === 401) {
          return { valid: false, error: "유효하지 않은 API 키입니다." };
        }
        return { valid: true };
      }

      case "openrouter": {
        const response = await fetch("https://openrouter.ai/api/v1/auth/key", {
          headers: { Authorization: `Bearer ${apiKey}` },
        });
        if (response.status === 401) {
          return { valid: false, error: "유효하지 않은 API 키입니다." };
        }
        return { valid: true };
      }

      default:
        return { valid: false, error: "지원하지 않는 프로바이더입니다." };
    }
  } catch {
    return { valid: false, error: "API 키 검증 중 오류가 발생했습니다." };
  }
}

// ============================================
// Model Resolution & Fallback
// ============================================

export interface ResolvedModel {
  provider: LLMProvider;
  model: string;
  apiKey: string;
  isFallback: boolean;
  isFree: boolean;
}

/**
 * Resolve which model to use for a request
 *
 * 모드별 폴백 체인:
 *
 * [manual] 이용자 직접 선택 모드
 *   → 선택한 모델만 사용, 실패 시 에러
 *
 * [cost_effective] 무료/가성비 우선 (기본값)
 *   → 무료 → 유료 가성비순 → 플랫폼 API → 에러
 *
 * [best_performance] 최고 성능 우선
 *   → 최고성능 유료 → 무료 → 플랫폼 API → 에러
 */
export async function resolveModel(
  kakaoUserId: string,
  hasCredits: boolean,
): Promise<ResolvedModel | { error: string }> {
  const settings = await getUserSettings(kakaoUserId);
  const mode = settings.modelMode ?? "cost_effective";

  // ============================================
  // [manual] 이용자 직접 선택 모드
  // 사용자가 지정한 모델만 사용, 폴백 없음
  // ============================================
  if (mode === "manual") {
    const key = settings.apiKeys[settings.preferredProvider] ?? getPlatformApiKey(settings.preferredProvider);
    if (key) {
      const isFree = !!settings.apiKeys[settings.preferredProvider];
      if (!isFree && !hasCredits) {
        return {
          error: [
            `"${settings.preferredModel}" 모델을 사용하려면 크레딧이 필요합니다.`,
            "",
            "API 키를 직접 등록하거나 크레딧을 충전해주세요.",
            '또는 "AI 모드 가성비"로 변경하면 무료 모델을 자동 사용합니다.',
          ].join("\n"),
        };
      }
      return {
        provider: settings.preferredProvider,
        model: settings.preferredModel,
        apiKey: key,
        isFallback: false,
        isFree,
      };
    }
    return {
      error: [
        `"${settings.preferredModel}" 모델의 API 키가 없습니다.`,
        "",
        "API 키를 등록하거나, 다른 모드를 선택해주세요:",
        '• "AI 모드 가성비" → 무료/저렴한 모델 자동 적용',
        '• "AI 모드 최고성능" → 최고 성능 모델 우선 적용',
      ].join("\n"),
    };
  }

  // ============================================
  // [best_performance] 최고 성능 우선 모드
  // 성능 좋은 유료 모델 먼저 → 무료 → 플랫폼 API
  // ============================================
  if (mode === "best_performance") {
    // 사용자 API 키로 최고 성능 모델 먼저
    for (const fallback of PERFORMANCE_FALLBACK_CHAIN) {
      const key = settings.apiKeys[fallback.provider];
      if (key) {
        return {
          provider: fallback.provider,
          model: fallback.model,
          apiKey: key,
          isFallback: false,
          isFree: true,
        };
      }
    }

    // 플랫폼 크레딧으로 최고 성능 모델
    if (hasCredits) {
      for (const fallback of PERFORMANCE_FALLBACK_CHAIN) {
        const platformKey = getPlatformApiKey(fallback.provider);
        if (platformKey) {
          return {
            provider: fallback.provider,
            model: fallback.model,
            apiKey: platformKey,
            isFallback: false,
            isFree: false,
          };
        }
      }
    }

    // 크레딧도 없으면 무료 모델이라도 사용
    for (const fallback of FREE_FALLBACK_CHAIN) {
      const key = settings.apiKeys[fallback.provider] ?? getPlatformApiKey(fallback.provider);
      if (key) {
        return {
          provider: fallback.provider,
          model: fallback.model,
          apiKey: key,
          isFallback: true,
          isFree: true,
        };
      }
    }

    return {
      error: [
        "최고 성능 모델을 사용하려면 API 키 또는 크레딧이 필요합니다.",
        "",
        "API 키를 등록하거나 크레딧을 충전해주세요.",
        '또는 "AI 모드 가성비"로 변경하면 무료 모델을 자동 사용합니다.',
      ].join("\n"),
    };
  }

  // ============================================
  // [cost_effective] 무료/가성비 우선 모드 (기본값)
  // 무료 → 유료 가성비순 → 플랫폼 API → 에러
  // ============================================

  // 사용자가 직접 선택한 선호 모델이 있고 키가 있으면 우선
  const preferredKey = settings.apiKeys[settings.preferredProvider];
  if (preferredKey) {
    return {
      provider: settings.preferredProvider,
      model: settings.preferredModel,
      apiKey: preferredKey,
      isFallback: false,
      isFree: true,
    };
  }

  // 1단계: 무료 모델
  if (settings.autoFallback) {
    for (const fallback of FREE_FALLBACK_CHAIN) {
      const key = settings.apiKeys[fallback.provider] ?? getPlatformApiKey(fallback.provider);
      if (key) {
        return {
          provider: fallback.provider,
          model: fallback.model,
          apiKey: key,
          isFallback: true,
          isFree: true,
        };
      }
    }
  }

  // 2단계: 유료 모델 (사용자 API 키, 가성비순)
  for (const fallback of PAID_FALLBACK_CHAIN) {
    const key = settings.apiKeys[fallback.provider];
    if (key) {
      return {
        provider: fallback.provider,
        model: fallback.model,
        apiKey: key,
        isFallback: true,
        isFree: true,
      };
    }
  }

  // 3단계: 플랫폼 유료 API (가성비순)
  if (hasCredits) {
    for (const fallback of PAID_FALLBACK_CHAIN) {
      const platformKey = getPlatformApiKey(fallback.provider);
      if (platformKey) {
        return {
          provider: fallback.provider,
          model: fallback.model,
          apiKey: platformKey,
          isFallback: false,
          isFree: false,
        };
      }
    }
  }

  // 4단계: 안내
  return {
    error: [
      "사용 가능한 API 키가 없습니다.",
      "",
      "🆓 무료로 사용하는 방법:",
      '"Gemini 무료" → Google Gemini API 키 등록 (월 1,500회 무료)',
      '"Groq 무료" → Groq API 키 등록 (완전 무료)',
      "",
      "💰 유료 사용: 크레딧을 충전하면 모든 모델을 사용할 수 있습니다.",
    ].join("\n"),
  };
}

/**
 * AI 모드 변경
 */
export async function setModelMode(
  kakaoUserId: string,
  mode: "manual" | "cost_effective" | "best_performance",
): Promise<void> {
  const hashedId = hashUserId(kakaoUserId);

  if (isSupabaseConfigured()) {
    const supabase = getSupabase();
    await supabase
      .from("user_settings")
      .update({ model_mode: mode, updated_at: new Date().toISOString() })
      .eq("kakao_user_id", hashedId);
  }
}

/**
 * Get platform API key for a provider
 */
function getPlatformApiKey(provider: LLMProvider): string | undefined {
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
// Message Formatting
// ============================================

/**
 * Get API guide message with all providers
 */
export function getApiKeyGuideMessage(): string {
  const lines = [
    "🔑 **API 키 등록 안내**",
    "",
    "API 키를 등록하면 무료로 이용할 수 있습니다!",
    "",
    "━━━━━━━━━━━━━━━━━━━━",
    "",
  ];

  // Highlight free options first
  lines.push("🆓 **무료로 시작하기 (추천)**");
  lines.push("");

  const freeProviders = Object.values(PROVIDERS).filter(p => p.freeTier || p.freeCredits);
  for (const p of freeProviders) {
    lines.push(`📌 ${p.displayName}`);
    if (p.freeCredits) {
      lines.push(`   💰 ${p.freeCredits}`);
    }
    lines.push(`   🌐 ${p.website}`);
    lines.push("");
  }

  lines.push("━━━━━━━━━━━━━━━━━━━━");
  lines.push("");
  lines.push("📋 **등록 방법**");
  lines.push("");
  lines.push('API 키를 그대로 입력하면 자동 인식됩니다:');
  lines.push("");
  lines.push("예시:");
  lines.push("• `AIzaSy...` (Google Gemini)");
  lines.push("• `gsk_...` (Groq)");
  lines.push("• `sk-ant-...` (Anthropic)");
  lines.push("• `sk-...` (OpenAI)");
  lines.push("");
  lines.push("⚠️ 키는 AES-256으로 암호화되어 안전하게 저장됩니다.");

  return lines.join("\n");
}

/**
 * Get model selection message
 */
export function getModelSelectionMessage(currentProvider: LLMProvider, currentModel: string): string {
  const lines = [
    "🤖 **모델 선택**",
    "",
    `현재 모델: ${currentModel}`,
    "",
    "━━━━━━━━━━━━━━━━━━━━",
    "",
  ];

  for (const [providerId, provider] of Object.entries(PROVIDERS)) {
    lines.push(`**${provider.displayName}**`);
    for (const model of provider.models) {
      const current = providerId === currentProvider && model.id === currentModel ? " ✓" : "";
      const free = model.free ? " 🆓" : "";
      const recommended = model.recommended ? " ⭐" : "";
      lines.push(`• ${model.name}${free}${recommended}${current}`);
    }
    lines.push("");
  }

  lines.push("━━━━━━━━━━━━━━━━━━━━");
  lines.push("");
  lines.push("변경하려면 모델 이름을 입력하세요:");
  lines.push('"모델 변경 gemini", "모델 변경 haiku"');

  return lines.join("\n");
}

/**
 * Get user's API key status message
 */
export function getApiKeyStatusMessage(settings: UserSettings): string {
  const lines = [
    "🔑 **API 키 상태**",
    "",
  ];

  const registeredKeys: string[] = [];
  const availableProviders: string[] = [];

  for (const [providerId, provider] of Object.entries(PROVIDERS)) {
    const hasKey = !!settings.apiKeys[providerId as LLMProvider];
    if (hasKey) {
      registeredKeys.push(`✅ ${provider.displayName}`);
    } else {
      availableProviders.push(provider.displayName);
    }
  }

  if (registeredKeys.length > 0) {
    lines.push("**등록된 키:**");
    lines.push(...registeredKeys);
    lines.push("");
  } else {
    lines.push("❌ 등록된 API 키가 없습니다.");
    lines.push("");
  }

  lines.push(`🤖 현재 모델: ${settings.preferredModel}`);
  lines.push(`🔄 자동 전환: ${settings.autoFallback ? "켜짐" : "꺼짐"}`);

  if (availableProviders.length > 0 && registeredKeys.length < 2) {
    lines.push("");
    lines.push('💡 "API키 등록"이라고 말씀하시면 무료 API 키를 등록할 수 있어요!');
  }

  return lines.join("\n");
}

/**
 * Parse model change command
 */
export function parseModelChangeCommand(message: string): {
  isCommand: boolean;
  provider?: LLMProvider;
  model?: string;
} {
  const normalized = message.trim().toLowerCase();

  // Pattern: "모델 변경 xxx" or "모델 xxx"
  const match = normalized.match(/모델\s*(변경)?\s+(.+)/);
  if (!match) {
    return { isCommand: false };
  }

  const query = match[2].trim();

  // Search for matching model
  for (const [providerId, provider] of Object.entries(PROVIDERS)) {
    for (const model of provider.models) {
      const modelNameLower = model.name.toLowerCase();
      const modelIdLower = model.id.toLowerCase();

      if (
        modelNameLower.includes(query) ||
        modelIdLower.includes(query) ||
        query.includes(modelNameLower.split(" ")[0]) // Match first word (e.g., "gemini", "haiku")
      ) {
        return {
          isCommand: true,
          provider: providerId as LLMProvider,
          model: model.id,
        };
      }
    }
  }

  return { isCommand: true }; // Command recognized but model not found
}

/**
 * Parse API key from message and detect provider
 */
export function parseApiKeyFromMessage(message: string): {
  provider: LLMProvider;
  apiKey: string;
} | null {
  // Try to extract API key patterns
  const patterns = [
    { pattern: /sk-ant-[a-zA-Z0-9_-]{20,}/, provider: "anthropic" as LLMProvider },
    { pattern: /AIza[a-zA-Z0-9_-]{35}/, provider: "google" as LLMProvider },
    { pattern: /gsk_[a-zA-Z0-9]{50,}/, provider: "groq" as LLMProvider },
    { pattern: /sk-or-[a-zA-Z0-9_-]{40,}/, provider: "openrouter" as LLMProvider },
    { pattern: /\b[a-f0-9]{64}\b/i, provider: "together" as LLMProvider },
    { pattern: /sk-[a-zA-Z0-9]{20,}/, provider: "openai" as LLMProvider }, // Must be last (catches sk-ant- otherwise)
  ];

  for (const { pattern, provider } of patterns) {
    const match = message.match(pattern);
    if (match) {
      // Make sure it's not sk-ant- for openai
      if (provider === "openai" && match[0].startsWith("sk-ant-")) {
        continue;
      }
      return { provider, apiKey: match[0] };
    }
  }

  return null;
}
