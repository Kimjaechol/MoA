/**
 * Shared credit system constants.
 * Separated from route.ts because Next.js route files
 * can only export HTTP method handlers.
 */

/** MoA server key multiplier: users pay 2x when using MoA's API keys */
export const ENV_KEY_MULTIPLIER = 2;

/** Credit cost per model (base rate — multiply by ENV_KEY_MULTIPLIER for MoA key usage) */
export const MODEL_CREDITS: Record<string, number> = {
  "local/slm-default": 0,
  "local/fallback": 0,
  "groq/kimi-k2-0905": 1,
  "groq/llama-3.3-70b-versatile": 1,
  "gemini/gemini-2.5-flash": 2,
  "gemini/gemini-2.0-flash": 2,
  "deepseek/deepseek-chat": 3,
  "openai/gpt-4o": 5,
  "openai/gpt-4o-mini": 3,
  "anthropic/claude-sonnet-4-5": 8,
  "anthropic/claude-haiku-4-5": 4,
  "openai/gpt-5": 10,
  "anthropic/claude-opus-4-6": 15,
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
  if (model.startsWith("groq/")) return 1;
  if (model.startsWith("gemini/")) return 2;
  if (model.startsWith("deepseek/")) return 3;
  if (model.startsWith("openai/")) return 5;
  if (model.startsWith("anthropic/")) return 8;
  return 0;
}
