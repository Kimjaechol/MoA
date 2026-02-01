/**
 * Credits & Billing System (Production - Supabase)
 *
 * Manages user credits for LLM API usage.
 * - Users with their own API key: FREE
 * - Users using platform API key: 2x cost in credits
 */

import { createHash, createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { getSupabase, isSupabaseConfigured } from "./supabase.js";

// Credit cost multiplier when using platform API
const PLATFORM_API_MULTIPLIER = 2;

// LLM model pricing (per 1M tokens, in credits)
// 1 credit = 1 KRW (Korean Won)
const MODEL_PRICING: Record<string, { input: number; output: number }> = {
  // Claude models
  "claude-opus-4-5-20251101": { input: 15000, output: 75000 },
  "claude-sonnet-4-20250514": { input: 3000, output: 15000 },
  "claude-3-5-sonnet-20241022": { input: 3000, output: 15000 },
  "claude-3-haiku-20240307": { input: 250, output: 1250 },
  // OpenAI models
  "gpt-4o": { input: 2500, output: 10000 },
  "gpt-4o-mini": { input: 150, output: 600 },
  "gpt-4-turbo": { input: 10000, output: 30000 },
  "gpt-3.5-turbo": { input: 500, output: 1500 },
};

// Default model if not specified
const DEFAULT_MODEL = "claude-3-haiku-20240307";

// Encryption key for API keys (32 bytes for AES-256)
function getEncryptionKey(): Buffer {
  const key = process.env.LAWCALL_ENCRYPTION_KEY ?? process.env.SUPABASE_SERVICE_KEY ?? "";
  return createHash("sha256").update(key).digest();
}

export interface UserAccount {
  id: string; // UUID from database
  kakaoUserId: string; // Hashed Kakao user ID
  credits: number; // Available credits
  totalSpent: number; // Total credits spent
  customApiKey?: string; // User's own API key (encrypted)
  customProvider?: "anthropic" | "openai"; // Provider for custom key
  createdAt: Date;
  updatedAt: Date;
}

export interface UsageRecord {
  id: string;
  userId: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  creditsUsed: number;
  usedPlatformKey: boolean;
  createdAt: Date;
}

export interface BillingResult {
  allowed: boolean;
  useCustomKey: boolean;
  customApiKey?: string;
  customProvider?: string;
  estimatedCost?: number;
  remainingCredits?: number;
  error?: string;
}

/**
 * Hash user ID for privacy (one-way hash)
 */
export function hashUserId(kakaoUserId: string): string {
  const salt = process.env.LAWCALL_USER_SALT ?? "lawcall-default-salt";
  return createHash("sha256").update(kakaoUserId + salt).digest("hex");
}

/**
 * Encrypt API key for storage
 */
function encryptApiKey(apiKey: string): string {
  const iv = randomBytes(16);
  const cipher = createCipheriv("aes-256-cbc", getEncryptionKey(), iv);
  let encrypted = cipher.update(apiKey, "utf8", "hex");
  encrypted += cipher.final("hex");
  return iv.toString("hex") + ":" + encrypted;
}

/**
 * Decrypt API key from storage
 */
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

/**
 * Get or create user account
 */
export async function getOrCreateUser(kakaoUserId: string): Promise<UserAccount> {
  const hashedId = hashUserId(kakaoUserId);

  if (!isSupabaseConfigured()) {
    // Fallback to in-memory for development
    return {
      id: hashedId,
      kakaoUserId: hashedId,
      credits: Number(process.env.LAWCALL_FREE_CREDITS ?? 1000),
      totalSpent: 0,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
  }

  const supabase = getSupabase();

  // Try to get existing user
  const { data: existingUser, error: fetchError } = await supabase
    .from("lawcall_users")
    .select("*")
    .eq("kakao_user_id", hashedId)
    .single();

  if (existingUser && !fetchError) {
    return {
      id: existingUser.id,
      kakaoUserId: existingUser.kakao_user_id,
      credits: existingUser.credits,
      totalSpent: existingUser.total_spent,
      customApiKey: existingUser.custom_api_key
        ? decryptApiKey(existingUser.custom_api_key)
        : undefined,
      customProvider: existingUser.custom_provider as "anthropic" | "openai" | undefined,
      createdAt: new Date(existingUser.created_at),
      updatedAt: new Date(existingUser.updated_at),
    };
  }

  // Create new user
  const defaultCredits = Number(process.env.LAWCALL_FREE_CREDITS ?? 1000);
  const { data: newUser, error: insertError } = await supabase
    .from("lawcall_users")
    .insert({
      kakao_user_id: hashedId,
      credits: defaultCredits,
      total_spent: 0,
    })
    .select()
    .single();

  if (insertError || !newUser) {
    throw new Error(`Failed to create user: ${insertError?.message}`);
  }

  return {
    id: newUser.id,
    kakaoUserId: newUser.kakao_user_id,
    credits: newUser.credits,
    totalSpent: newUser.total_spent,
    createdAt: new Date(newUser.created_at),
    updatedAt: new Date(newUser.updated_at),
  };
}

/**
 * Set user's custom API key
 */
export async function setUserApiKey(
  kakaoUserId: string,
  apiKey: string,
  provider: "anthropic" | "openai",
): Promise<void> {
  const hashedId = hashUserId(kakaoUserId);
  const encryptedKey = encryptApiKey(apiKey);

  if (!isSupabaseConfigured()) {
    return; // Skip in development
  }

  const supabase = getSupabase();

  // Ensure user exists
  await getOrCreateUser(kakaoUserId);

  const { error } = await supabase
    .from("lawcall_users")
    .update({
      custom_api_key: encryptedKey,
      custom_provider: provider,
    })
    .eq("kakao_user_id", hashedId);

  if (error) {
    throw new Error(`Failed to set API key: ${error.message}`);
  }
}

/**
 * Check if user has custom API key
 */
export async function hasCustomApiKey(kakaoUserId: string): Promise<boolean> {
  const user = await getOrCreateUser(kakaoUserId);
  return !!user.customApiKey;
}

/**
 * Calculate cost in credits for a request
 */
export function calculateCost(
  model: string,
  inputTokens: number,
  outputTokens: number,
  usePlatformKey: boolean,
): number {
  const pricing = MODEL_PRICING[model] ?? MODEL_PRICING[DEFAULT_MODEL];

  // Cost per token (pricing is per 1M tokens)
  const inputCost = (inputTokens / 1_000_000) * pricing.input;
  const outputCost = (outputTokens / 1_000_000) * pricing.output;
  let totalCost = inputCost + outputCost;

  // Apply multiplier if using platform key
  if (usePlatformKey) {
    totalCost *= PLATFORM_API_MULTIPLIER;
  }

  // Minimum 1 credit, round up
  return Math.max(1, Math.ceil(totalCost));
}

/**
 * Estimate cost before making request
 */
export function estimateCost(
  model: string,
  estimatedInputTokens: number,
  estimatedOutputTokens: number,
  usePlatformKey: boolean,
): number {
  return calculateCost(model, estimatedInputTokens, estimatedOutputTokens, usePlatformKey);
}

/**
 * Check if user can make a request
 */
export async function checkBilling(
  kakaoUserId: string,
  model: string = DEFAULT_MODEL,
  estimatedTokens: number = 1000,
): Promise<BillingResult> {
  const user = await getOrCreateUser(kakaoUserId);

  // If user has custom API key, allow for free
  if (user.customApiKey && user.customProvider) {
    return {
      allowed: true,
      useCustomKey: true,
      customApiKey: user.customApiKey,
      customProvider: user.customProvider,
      estimatedCost: 0,
      remainingCredits: user.credits,
    };
  }

  // Estimate cost for platform key usage
  const estimatedCost = estimateCost(model, estimatedTokens, estimatedTokens * 2, true);

  // Check if user has enough credits
  if (user.credits < estimatedCost) {
    return {
      allowed: false,
      useCustomKey: false,
      estimatedCost,
      remainingCredits: user.credits,
      error: `크레딧이 부족합니다. 필요: ${estimatedCost}, 보유: ${user.credits}`,
    };
  }

  return {
    allowed: true,
    useCustomKey: false,
    estimatedCost,
    remainingCredits: user.credits,
  };
}

/**
 * Deduct credits after successful request (atomic operation)
 */
export async function deductCredits(
  kakaoUserId: string,
  model: string,
  inputTokens: number,
  outputTokens: number,
  usedPlatformKey: boolean,
): Promise<{ creditsUsed: number; remainingCredits: number }> {
  // No charge if using custom key
  if (!usedPlatformKey) {
    const user = await getOrCreateUser(kakaoUserId);
    return { creditsUsed: 0, remainingCredits: user.credits };
  }

  const creditsUsed = calculateCost(model, inputTokens, outputTokens, true);
  const hashedId = hashUserId(kakaoUserId);

  if (!isSupabaseConfigured()) {
    // Fallback for development
    return { creditsUsed, remainingCredits: 1000 - creditsUsed };
  }

  const supabase = getSupabase();

  // Use atomic deduction function
  const { data, error } = await supabase.rpc("deduct_credits", {
    p_kakao_user_id: hashedId,
    p_amount: creditsUsed,
  });

  if (error) {
    console.error(`[billing] Failed to deduct credits: ${error.message}`);
    // Don't throw - still record the usage
  }

  const result = data?.[0];
  const newBalance = result?.new_balance ?? 0;

  // Record usage
  const user = await getOrCreateUser(kakaoUserId);
  await supabase.from("lawcall_usage").insert({
    user_id: user.id,
    model,
    input_tokens: inputTokens,
    output_tokens: outputTokens,
    credits_used: creditsUsed,
    used_platform_key: usedPlatformKey,
  });

  return { creditsUsed, remainingCredits: newBalance };
}

/**
 * Add credits to user account (after payment)
 */
export async function addCredits(kakaoUserId: string, amount: number): Promise<number> {
  const hashedId = hashUserId(kakaoUserId);

  if (!isSupabaseConfigured()) {
    return amount; // Fallback for development
  }

  const supabase = getSupabase();

  const { data, error } = await supabase.rpc("add_credits", {
    p_kakao_user_id: hashedId,
    p_amount: amount,
  });

  if (error) {
    throw new Error(`Failed to add credits: ${error.message}`);
  }

  return data?.[0]?.new_balance ?? amount;
}

/**
 * Get user's credit balance
 */
export async function getCredits(kakaoUserId: string): Promise<number> {
  const user = await getOrCreateUser(kakaoUserId);
  return user.credits;
}

/**
 * Get user's usage statistics
 */
export async function getUserStats(kakaoUserId: string): Promise<{
  credits: number;
  totalSpent: number;
  hasCustomKey: boolean;
  recentUsage: UsageRecord[];
}> {
  const user = await getOrCreateUser(kakaoUserId);

  let recentUsage: UsageRecord[] = [];

  if (isSupabaseConfigured()) {
    const supabase = getSupabase();
    const { data } = await supabase
      .from("lawcall_usage")
      .select("*")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false })
      .limit(10);

    if (data) {
      recentUsage = data.map(u => ({
        id: u.id,
        userId: u.user_id,
        model: u.model,
        inputTokens: u.input_tokens,
        outputTokens: u.output_tokens,
        creditsUsed: u.credits_used,
        usedPlatformKey: u.used_platform_key,
        createdAt: new Date(u.created_at),
      }));
    }
  }

  return {
    credits: user.credits,
    totalSpent: user.totalSpent,
    hasCustomKey: !!user.customApiKey,
    recentUsage,
  };
}

/**
 * Format credits for display
 */
export function formatCredits(credits: number): string {
  if (credits >= 10000) {
    return `${(credits / 10000).toFixed(1)}만`;
  }
  return credits.toLocaleString();
}

/**
 * Get pricing info message
 */
export function getPricingMessage(): string {
  return `💳 크레딧 안내

📌 나만의 API 키 사용 시: 무료!
   - Anthropic: console.anthropic.com
   - OpenAI: platform.openai.com

📌 플랫폼 API 사용 시: 2배 비용
   - Claude Haiku: 약 1-2 크레딧/대화
   - Claude Sonnet: 약 10-20 크레딧/대화
   - GPT-4o-mini: 약 2-3 크레딧/대화

💰 크레딧 충전:
   "충전"이라고 말씀해주세요.`;
}

/**
 * Remove user's custom API key
 */
export async function removeUserApiKey(kakaoUserId: string): Promise<void> {
  const hashedId = hashUserId(kakaoUserId);

  if (!isSupabaseConfigured()) {
    return;
  }

  const supabase = getSupabase();

  await supabase
    .from("lawcall_users")
    .update({
      custom_api_key: null,
      custom_provider: null,
    })
    .eq("kakao_user_id", hashedId);
}

/**
 * Get user by ID (for admin purposes)
 */
export async function getUserById(userId: string): Promise<UserAccount | null> {
  if (!isSupabaseConfigured()) {
    return null;
  }

  const supabase = getSupabase();

  const { data, error } = await supabase
    .from("lawcall_users")
    .select("*")
    .eq("id", userId)
    .single();

  if (error || !data) {
    return null;
  }

  return {
    id: data.id,
    kakaoUserId: data.kakao_user_id,
    credits: data.credits,
    totalSpent: data.total_spent,
    customApiKey: data.custom_api_key ? decryptApiKey(data.custom_api_key) : undefined,
    customProvider: data.custom_provider as "anthropic" | "openai" | undefined,
    createdAt: new Date(data.created_at),
    updatedAt: new Date(data.updated_at),
  };
}
