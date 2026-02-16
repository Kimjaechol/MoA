/**
 * Shared credit system constants.
 * Separated from route.ts because Next.js route files
 * can only export HTTP method handlers.
 */

/** MoA server key multiplier: users pay 2x when using MoA's API keys */
export const ENV_KEY_MULTIPLIER = 2;

/**
 * Credit cost per model (base rate — multiply by ENV_KEY_MULTIPLIER for MoA key usage)
 *
 * Cross-verified pricing (2026-02):
 * - Groq: Free tier (Kimi K2, Llama 3.3)
 * - Gemini 2.5 Flash: $0.15/$0.60 per 1M tokens → ~2C/conversation
 * - DeepSeek Chat: $0.14/$0.28 per 1M tokens → ~1C/conversation
 * - GPT-4o Mini: $0.15/$0.60 per 1M tokens → ~2C/conversation
 * - Claude Haiku 4.5: $0.80/$4.00 per 1M tokens → ~6C/conversation
 * - GPT-4o: $2.50/$10.00 per 1M tokens → ~15C/conversation
 * - Claude Sonnet 4.5: $3.00/$15.00 per 1M tokens → ~22C/conversation
 * - GPT-5: $5.00/$15.00 per 1M tokens → ~25C/conversation
 * - Claude Opus 4.6: $15.00/$75.00 per 1M tokens → ~100C/conversation
 */
export const MODEL_CREDITS: Record<string, number> = {
  "local/slm-default": 0,
  "local/fallback": 0,
  "cache/hit": 0,
  "groq/kimi-k2-0905": 0,
  "groq/llama-3.3-70b-versatile": 0,
  "deepseek/deepseek-chat": 1,
  "gemini/gemini-2.5-flash": 2,
  "gemini/gemini-2.0-flash": 2,
  "gemini/gemini-3-flash": 2,
  "openai/gpt-4o-mini": 2,
  "mistral/mistral-small-latest": 2,
  "xai/grok-3-mini": 4,
  "anthropic/claude-haiku-4-5": 6,
  "mistral/mistral-large-latest": 6,
  "gemini/gemini-3-pro": 8,
  "xai/grok-3": 8,
  "openai/gpt-4o": 15,
  "anthropic/claude-sonnet-4-5": 22,
  "openai/gpt-5": 25,
  "anthropic/claude-opus-4-6": 100,
};

/** Plan quotas */
export const PLAN_QUOTAS: Record<string, { monthly: number; name: string; price: number }> = {
  free:  { monthly: 100,   name: "Free",  price: 0 },
  basic: { monthly: 3000,  name: "Basic", price: 9900 },
  pro:   { monthly: 15000, name: "Pro",   price: 29900 },
};

/** Credit packages */
export const CREDIT_PACKS = [
  { id: "pack_500",   credits: 500,   price: 5000,  label: "500 크레딧" },
  { id: "pack_1500",  credits: 1500,  price: 12000, label: "1,500 크레딧" },
  { id: "pack_5000",  credits: 5000,  price: 35000, label: "5,000 크레딧" },
  { id: "pack_15000", credits: 15000, price: 90000, label: "15,000 크레딧" },
];

/** Get credit cost for a model */
export function getModelCost(model: string): number {
  if (MODEL_CREDITS[model] !== undefined) return MODEL_CREDITS[model];
  if (model.startsWith("groq/")) return 0;
  if (model.startsWith("deepseek/")) return 1;
  if (model.startsWith("gemini/")) return 2;
  if (model.startsWith("mistral/")) return 4;
  if (model.startsWith("xai/")) return 6;
  if (model.startsWith("openai/")) return 15;
  if (model.startsWith("anthropic/")) return 22;
  return 0;
}

/**
 * Tool/Skill credit costs (per invocation)
 * Cross-verified actual API pricing (2026-02)
 */
export const TOOL_CREDITS: Record<string, number> = {
  // Free tools (no API key needed)
  weather: 0,
  calendar: 0,
  sports: 0,
  holidays: 0,
  air_quality: 0,
  qrcode: 0,
  travel_phrases: 0,
  legal_rag: 0,
  meme: 0,
  search_duckduckgo: 0,
  // Freemium (free with API key)
  translate_papago: 0,
  search_brave: 0,
  freepik: 0,
  // Paid (cheapest first)
  translate_google: 1,    // $20/1M chars, ~$0.0004/request
  navigation: 1,          // ~$0.0005/request
  translate_deepl: 2,     // $25/1M chars, ~$0.001/request
  search_perplexity: 2,   // $1/1000 queries
  live_translate: 3,      // Gemini Live ~$0.002/min
  search_google_cse: 7,   // $5/1000 queries
  image_stable_diffusion: 10, // ~$0.006/image
  image_dalle3: 54,       // $0.04/image
  image_dalle3_hd: 108,   // $0.08/image
  music_mubert: 27,       // ~$0.02/track
  music_suno: 68,         // $0.05/song
};

/** Get tool credit cost */
export function getToolCost(toolId: string): number {
  return TOOL_CREDITS[toolId] ?? 0;
}

/** Format credits compactly for chat display */
export function formatCreditsDisplay(credits: number): string {
  if (credits === 0) return "무료";
  if (credits < 10) return `${credits}C`;
  if (credits >= 10000) return `${(credits / 10000).toFixed(1)}만C`;
  return `${credits.toLocaleString()}C`;
}
