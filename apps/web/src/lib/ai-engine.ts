/**
 * Shared AI Engine — Core LLM logic extracted from /api/chat.
 *
 * Optimizations applied:
 *   1. No internal HTTP call — webhook handlers import this directly
 *   2. DB queries parallelized with Promise.all
 *   3. Semantic cache integration (optional, via @/lib/semantic-cache)
 *   4. Multi-turn conversation context with cross-channel history
 *   5. OpenClaw Agent integration — full agent capabilities when gateway is available
 *
 * OpenClaw Agent provides:
 *   - Pi RPC agent with tools (browsing, file management, code execution)
 *   - 100+ skills (weather, calendar, search, coding, etc.)
 *   - Memory/knowledge base with vector search
 *   - Browser automation via Playwright
 *   - Plugin/extension system (32+ extensions)
 *
 * When OPENCLAW_GATEWAY_URL is configured and the gateway is reachable,
 * messages are routed through the OpenClaw agent for enhanced responses.
 * Falls back to direct LLM calls when the agent is unavailable.
 *
 * This module runs on Node.js runtime (needs node:crypto for key decryption).
 */

import { safeDecrypt } from "@/lib/crypto";
import { detectAndMaskSensitiveData } from "@/lib/security";
import { sendToOpenClawAgent, isOpenClawAvailable, isOpenClawConfigured } from "@/lib/openclaw-bridge";

// ────────────────────────────────────────────
// Types
// ────────────────────────────────────────────

export interface AIResponse {
  text: string;
  model: string;
  usedEnvKey: boolean;
}

export interface ChatResult {
  reply: string;
  model: string;
  category: string;
  credits_used: number;
  credits_remaining?: number;
  key_source: "moa" | "user";
  timestamp: string;
}

/** Message format for LLM multi-turn conversation */
interface LLMMessage {
  role: "user" | "assistant";
  content: string;
}

// ────────────────────────────────────────────
// Conversation History
// ────────────────────────────────────────────

/** Max messages to load from DB for context (controls token budget) */
const MAX_HISTORY_MESSAGES = 20;

/** Max chars per historical message (truncate long ones to save tokens) */
const MAX_MESSAGE_LENGTH = 500;

/**
 * Merge consecutive same-role messages (required by Gemini, safe for all APIs).
 * Example: two consecutive "user" messages → one with content joined by newline.
 */
function normalizeMessages(messages: LLMMessage[]): LLMMessage[] {
  if (messages.length === 0) return messages;
  const result: LLMMessage[] = [{ ...messages[0] }];
  for (let i = 1; i < messages.length; i++) {
    const prev = result[result.length - 1];
    if (messages[i].role === prev.role) {
      prev.content += `\n${messages[i].content}`;
    } else {
      result.push({ ...messages[i] });
    }
  }
  return result;
}

/**
 * Load conversation history from Supabase.
 * Loads by user_id (cross-channel) so the AI can reference any channel's context.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function loadConversationHistory(supabase: any, userId: string): Promise<LLMMessage[]> {
  try {
    const { data } = await supabase
      .from("moa_chat_messages")
      .select("role, content, channel, created_at")
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(MAX_HISTORY_MESSAGES);

    if (!data || data.length === 0) return [];

    // Reverse to chronological order (oldest first) and build LLMMessage[]
    return (data as { role: string; content: string; channel: string; created_at: string }[])
      .reverse()
      .map((msg) => {
        const truncated = msg.content.length > MAX_MESSAGE_LENGTH
          ? msg.content.slice(0, MAX_MESSAGE_LENGTH) + "..."
          : msg.content;
        return {
          role: msg.role as "user" | "assistant",
          content: `[${msg.channel}] ${truncated}`,
        };
      });
  } catch {
    return [];
  }
}

/**
 * Build the full LLM messages array:
 *   history (from DB, cross-channel) + current user message.
 */
function buildLLMMessages(
  history: LLMMessage[],
  currentMessage: string,
  currentChannel: string,
): LLMMessage[] {
  const messages: LLMMessage[] = [...history];
  messages.push({
    role: "user",
    content: `[${currentChannel}] ${currentMessage}`,
  });
  return messages;
}

// ────────────────────────────────────────────
// Category Detection
// ────────────────────────────────────────────

export function detectCategory(text: string): string {
  const lower = text.toLowerCase();

  // Interpreter — must be checked first (통역 vs 번역 구분)
  if (/통역|실시간.*번역|동시.*번역|interpret|voice.*translat|simultaneous|한영.*통역|한일.*통역|한중.*통역|통역\s*모드|통역\s*시작/.test(lower)) return "interpreter";

  // Coding
  if (/코드|코딩|프로그래밍|디버그|디버깅|에러.*수정|debug|bug|function|class|import|git|code|script|program|api|error.*fix|리팩토링|refactor|자동\s*코딩/.test(lower)) return "coding";

  // Image
  if (/이미지|그림|사진|그려|일러스트|로고|디자인|image|photo|draw|generate.*image|dall-?e|midjourney|스타일.*변환|배경.*제거/.test(lower)) return "image";

  // Music
  if (/음악|노래|작곡|가사|편곡|멜로디|비트|music|song|compose|melody|beat|tts|음성.*변환/.test(lower)) return "music";

  // Document — "번역해줘" goes here (not interpreter), plus synthesis/slides
  if (/문서|보고서|요약|번역|pptx|docx|pdf|document|report|슬라이드|발표\s*자료|종합\s*문서|synthesis|summarize|변환/.test(lower)) return "document";

  // Work
  if (/이메일|업무|보고|회의|미팅|email|meeting|일정.*관리|프로젝트|task|notion|slack|airtable|업무.*지시/.test(lower)) return "work";

  // Daily life
  if (/날씨|일정|맛집|추천|여행|길\s*찾|weather|schedule|recipe|요리|레시피|뉴스|news|검색|search|알람|타이머/.test(lower)) return "daily";

  return "other";
}

// ────────────────────────────────────────────
// Language Rule & System Prompts
// ────────────────────────────────────────────

const LANGUAGE_RULE = `

[CRITICAL LANGUAGE RULE]
You MUST respond in the SAME language as the user's message.
사용자가 한국어로 말하면, 반드시 한국어로만 대답하세요.

- 한국어 응답 시: 일본어, 중국어, 러시아어를 절대 섞지 마세요.
- 한자(漢字)를 한국어 응답에 사용하지 마세요.
- If the user writes in English, respond ONLY in English.
- English technical terms (API, URL, code snippets) are acceptable in any language.
- ABSOLUTELY DO NOT mix different languages in a single response.
`;

const CROSS_CHANNEL_CONTEXT = `

[MULTI-CHANNEL CONVERSATION]
The user communicates through multiple channels (App, Telegram, Discord, KakaoTalk, Slack, LINE, WhatsApp, Signal, etc.).
Each message in the history is tagged with [channel_name] to indicate its origin.
Even across different channels, this is the SAME user's continuous conversation — always reference prior context when relevant.
Do NOT include a [channel_name] tag in your response — just reply naturally.
If the user references a prior conversation from another channel (e.g., "아까 텔레그램에서 물어본 것"), look up that channel's history and continue seamlessly.
`;

const CATEGORY_SYSTEM_PROMPTS: Record<string, string> = {
  daily: `You are a daily life assistant. Help with schedules, weather, translations, lifestyle tips, and general questions.${LANGUAGE_RULE}${CROSS_CHANNEL_CONTEXT}`,
  work: `You are a professional work assistant. Help with emails, reports, meeting notes, data analysis, and business tasks.${LANGUAGE_RULE}${CROSS_CHANNEL_CONTEXT}`,
  document: `You are a document specialist. Help with document creation, summarization, conversion, synthesis, and formatting.${LANGUAGE_RULE}${CROSS_CHANNEL_CONTEXT}`,
  coding: `You are an expert software engineer. Help with code writing, debugging, code review, and automated coding tasks. Include code snippets and technical details.${LANGUAGE_RULE}${CROSS_CHANNEL_CONTEXT}`,
  image: `You are an image/visual AI assistant. Help with image generation prompts, editing instructions, image analysis, and style transfer.${LANGUAGE_RULE}${CROSS_CHANNEL_CONTEXT}`,
  music: `You are a music AI assistant. Help with composition, lyrics writing, TTS, and music analysis.${LANGUAGE_RULE}${CROSS_CHANNEL_CONTEXT}`,
  interpreter: `You are a professional real-time interpreter powered by Gemini 2.5 Flash Native Audio. You provide instant, accurate translation between multiple languages (25+ supported). Preserve meaning, tone, and cultural nuances. Support bidirectional interpretation. When the user says "통역" or "통역 시작", guide them to select source and target languages, then begin real-time interpretation mode. Supported languages include: Korean, English, Japanese, Chinese (Simplified/Traditional), Spanish, French, German, Italian, Portuguese, Russian, Arabic, Hindi, Thai, Vietnamese, Indonesian, and more.

[INTERPRETER MODE RULES]
- When translating, always show: [원문] Original text → [번역] Translated text
- Preserve formality levels and cultural context
- For voice interpretation requests, guide users to use the MoA desktop or mobile app for real-time audio
- Support domain-specific vocabulary: business, medical, legal, technical
${LANGUAGE_RULE}${CROSS_CHANNEL_CONTEXT}`,
  other: `You are MoA, a versatile AI assistant with 100+ skills across 15 channels. Help with any request.${LANGUAGE_RULE}${CROSS_CHANNEL_CONTEXT}`,
};

export const CATEGORY_SKILLS: Record<string, string[]> = {
  daily: ["weather", "calendar", "translate", "search", "news", "maps"],
  work: ["email", "notion", "airtable", "slack", "github", "calendar", "summarize"],
  document: ["summarize", "editor", "synthesis", "convert", "pptx", "pdf"],
  coding: ["code", "debug", "github", "autocode", "vision", "terminal"],
  image: ["fal-ai", "replicate", "vision", "image-edit", "style-transfer"],
  music: ["tts", "suno", "lyrics", "music-analysis", "podcast"],
  interpreter: ["realtime-translate", "voice-interpret", "language-detect", "bidirectional-interpret", "gemini-live"],
  other: ["search", "translate", "summarize", "general"],
};

// ────────────────────────────────────────────
// Credit System
// ────────────────────────────────────────────

// Cross-verified credit costs (synced with pricing-table.ts & credits.ts)
const MODEL_CREDIT_COSTS: Record<string, number> = {
  "local/slm-default": 0, "local/fallback": 0, "cache/hit": 0,
  "groq/kimi-k2-0905": 0, "groq/llama-3.3-70b-versatile": 0,
  "deepseek/deepseek-chat": 1,
  "gemini/gemini-3-flash": 2, "gemini/gemini-2.5-flash": 2, "gemini/gemini-2.0-flash": 2,
  "openai/gpt-4o-mini": 2,
  "mistral/mistral-small-latest": 2, "mistral/mistral-large-latest": 6,
  "xai/grok-3-mini": 4, "xai/grok-3": 8,
  "anthropic/claude-haiku-4-5": 6,
  "gemini/gemini-3-pro": 8,
  "openai/gpt-4o": 15,
  "anthropic/claude-sonnet-4-5": 22,
  "openai/gpt-5": 25,
  "anthropic/claude-opus-4-6": 100,
};

function getCreditCost(model: string): number {
  if (MODEL_CREDIT_COSTS[model] !== undefined) return MODEL_CREDIT_COSTS[model];
  if (model.startsWith("groq/")) return 0;
  if (model.startsWith("deepseek/")) return 1;
  if (model.startsWith("gemini/")) return 2;
  if (model.startsWith("mistral/")) return 4;
  if (model.startsWith("xai/")) return 5;
  if (model.startsWith("openai/")) return 5;
  if (model.startsWith("anthropic/")) return 8;
  return 0;
}

const ENV_KEY_MULTIPLIER = 2;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function deductCredits(supabase: any, userId: string, model: string, usedEnvKey: boolean): Promise<{ balance: number; cost: number }> {
  const baseCost = getCreditCost(model);
  const cost = usedEnvKey ? baseCost * ENV_KEY_MULTIPLIER : baseCost;
  if (cost === 0) return { balance: -1, cost: 0 };

  const { data: updated, error: updateError } = await supabase
    .from("moa_credits")
    .update({ updated_at: new Date().toISOString() })
    .eq("user_id", userId)
    .select("balance, monthly_used")
    .single();

  if (updateError || !updated) {
    await supabase.from("moa_credits").upsert({
      user_id: userId, balance: Math.max(0, 100 - cost), monthly_quota: 100, monthly_used: cost, plan: "free",
      quota_reset_at: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
    }, { onConflict: "user_id" });
    const keyLabel = usedEnvKey ? " (MoA 키 2x)" : "";
    await supabase.from("moa_credit_transactions").insert({
      user_id: userId, amount: -cost, balance_after: Math.max(0, 100 - cost),
      tx_type: "usage", description: `채팅 - ${model}${keyLabel}`, model_used: model,
    });
    return { balance: Math.max(0, 100 - cost), cost };
  }

  const newBalance = Math.max(0, updated.balance - cost);
  const newUsed = (updated.monthly_used ?? 0) + cost;

  await supabase
    .from("moa_credits")
    .update({ balance: newBalance, monthly_used: newUsed, updated_at: new Date().toISOString() })
    .eq("user_id", userId);

  const keyLabel = usedEnvKey ? " (MoA 키 2x)" : "";
  await supabase.from("moa_credit_transactions").insert({
    user_id: userId, amount: -cost, balance_after: newBalance,
    tx_type: "usage", description: `채팅 - ${model}${keyLabel}`, model_used: model,
  });

  return { balance: newBalance, cost };
}

// ────────────────────────────────────────────
// LLM Provider Calls (Multi-turn)
// ────────────────────────────────────────────

async function callAnthropic(key: string, system: string, messages: LLMMessage[], model: string): Promise<string | null> {
  try {
    const normalized = normalizeMessages(messages);
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-api-key": key, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({ model, max_tokens: 4096, system, messages: normalized }),
    });
    if (res.ok) {
      const data = await res.json();
      return data.content?.[0]?.text ?? null;
    }
    const errBody = await res.text().catch(() => "");
    console.error(`[ai-engine] Anthropic ${model} failed (${res.status}):`, errBody.slice(0, 200));
  } catch (err) {
    console.error(`[ai-engine] Anthropic ${model} error:`, err instanceof Error ? err.message : err);
  }
  return null;
}

async function callOpenAI(key: string, system: string, messages: LLMMessage[], model: string): Promise<string | null> {
  try {
    const normalized = normalizeMessages(messages);
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
      body: JSON.stringify({
        model,
        messages: [{ role: "system" as const, content: system }, ...normalized],
        max_tokens: 4096,
      }),
    });
    if (res.ok) {
      const data = await res.json();
      return data.choices?.[0]?.message?.content ?? null;
    }
    const errBody = await res.text().catch(() => "");
    console.error(`[ai-engine] OpenAI ${model} failed (${res.status}):`, errBody.slice(0, 200));
  } catch (err) {
    console.error(`[ai-engine] OpenAI ${model} error:`, err instanceof Error ? err.message : err);
  }
  return null;
}

// Primary: Gemini 3.0 Flash (official preview ID), fallbacks for older accounts
const GEMINI_MODELS = ["gemini-3-flash-preview", "gemini-2.5-flash-preview-04-17", "gemini-2.0-flash"];

async function callGemini(key: string, system: string, messages: LLMMessage[]): Promise<string | null> {
  const normalized = normalizeMessages(messages);
  // Try multiple Gemini model names in case some are unavailable
  for (const model of GEMINI_MODELS) {
    try {
      const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: system }] },
          contents: normalized.map((m) => ({
            role: m.role === "assistant" ? "model" : "user",
            parts: [{ text: m.content }],
          })),
          generationConfig: { maxOutputTokens: 4096 },
        }),
      });
      if (res.ok) {
        const data = await res.json();
        const text = data.candidates?.[0]?.content?.parts?.[0]?.text ?? null;
        if (text) return text;
      }
      const errBody = await res.text().catch(() => "");
      console.warn(`[ai-engine] Gemini ${model} failed (${res.status}):`, errBody.slice(0, 200));
    } catch (err) {
      console.warn(`[ai-engine] Gemini ${model} error:`, err instanceof Error ? err.message : err);
    }
  }
  return null;
}

async function callGroq(key: string, system: string, messages: LLMMessage[]): Promise<string | null> {
  try {
    const normalized = normalizeMessages(messages);
    const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
      body: JSON.stringify({
        model: "llama-3.3-70b-versatile",
        messages: [{ role: "system" as const, content: system }, ...normalized],
        max_tokens: 4096,
      }),
    });
    if (res.ok) {
      const data = await res.json();
      return data.choices?.[0]?.message?.content ?? null;
    }
    const errBody = await res.text().catch(() => "");
    console.error(`[ai-engine] Groq failed (${res.status}):`, errBody.slice(0, 200));
  } catch (err) {
    console.error("[ai-engine] Groq error:", err instanceof Error ? err.message : err);
  }
  return null;
}

async function callDeepSeek(key: string, system: string, messages: LLMMessage[]): Promise<string | null> {
  try {
    const normalized = normalizeMessages(messages);
    const res = await fetch("https://api.deepseek.com/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
      body: JSON.stringify({
        model: "deepseek-chat",
        messages: [{ role: "system" as const, content: system }, ...normalized],
        max_tokens: 4096,
      }),
    });
    if (res.ok) {
      const data = await res.json();
      return data.choices?.[0]?.message?.content ?? null;
    }
    const errBody = await res.text().catch(() => "");
    console.error(`[ai-engine] DeepSeek failed (${res.status}):`, errBody.slice(0, 200));
  } catch (err) {
    console.error("[ai-engine] DeepSeek error:", err instanceof Error ? err.message : err);
  }
  return null;
}

async function callXai(key: string, system: string, messages: LLMMessage[], model: string): Promise<string | null> {
  try {
    const normalized = normalizeMessages(messages);
    const res = await fetch("https://api.x.ai/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
      body: JSON.stringify({
        model,
        messages: [{ role: "system" as const, content: system }, ...normalized],
        max_tokens: 4096,
      }),
    });
    if (res.ok) {
      const data = await res.json();
      return data.choices?.[0]?.message?.content ?? null;
    }
    const errBody = await res.text().catch(() => "");
    console.error(`[ai-engine] xAI ${model} failed (${res.status}):`, errBody.slice(0, 200));
  } catch (err) {
    console.error(`[ai-engine] xAI ${model} error:`, err instanceof Error ? err.message : err);
  }
  return null;
}

async function callMistral(key: string, system: string, messages: LLMMessage[], model: string): Promise<string | null> {
  try {
    const normalized = normalizeMessages(messages);
    const res = await fetch("https://api.mistral.ai/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
      body: JSON.stringify({
        model,
        messages: [{ role: "system" as const, content: system }, ...normalized],
        max_tokens: 4096,
      }),
    });
    if (res.ok) {
      const data = await res.json();
      return data.choices?.[0]?.message?.content ?? null;
    }
    const errBody = await res.text().catch(() => "");
    console.error(`[ai-engine] Mistral ${model} failed (${res.status}):`, errBody.slice(0, 200));
  } catch (err) {
    console.error(`[ai-engine] Mistral ${model} error:`, err instanceof Error ? err.message : err);
  }
  return null;
}

// ────────────────────────────────────────────
// 3-Phase Model Selection (tryLlmCall)
// ────────────────────────────────────────────

/**
 * 3-phase model selection with multi-turn messages:
 *   Phase 1: User's own API keys (1x credit) — best quality first
 *   Phase 2: MoA server env keys (2x credit) — strategy defaults
 *   Phase 3: Groq/DeepSeek — user keys ONLY (CJK mixing issues)
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function tryLlmCall(messages: LLMMessage[], category: string, strategy: string, keys: any[]): Promise<AIResponse | null> {
  const systemPrompt = CATEGORY_SYSTEM_PROMPTS[category] ?? CATEGORY_SYSTEM_PROMPTS.other;
  const skills = CATEGORY_SKILLS[category] ?? CATEGORY_SKILLS.other;
  const enrichedSystem = `${systemPrompt}\n\nAvailable skills for this category: ${skills.join(", ")}`;

  // Server env keys — only Anthropic + Gemini used for Phase 2 (pay-to-use, 2x credit)
  // Groq/DeepSeek/OpenAI/xAI/Mistral: user must provide their own keys
  const envAnthropicKey = process.env.ANTHROPIC_API_KEY;
  const envGeminiKey = process.env.GEMINI_API_KEY;

  const decryptKey = (provider: string) => {
    const raw = keys.find((k: { provider: string }) => k.provider === provider)?.encrypted_key;
    return raw ? safeDecrypt(raw) : undefined;
  };
  const userAnthropicKey = decryptKey("anthropic");
  const userOpenaiKey = decryptKey("openai");
  const userGeminiKey = decryptKey("gemini");
  const userMistralKey = decryptKey("mistral");
  const userXaiKey = decryptKey("xai");
  const userGroqKey = decryptKey("groq");
  const userDeepseekKey = decryptKey("deepseek");

  const hasUserQualityKeys = !!(userAnthropicKey || userOpenaiKey || userGeminiKey || userMistralKey || userXaiKey);

  console.info(`[ai-engine] Strategy: ${strategy} | User keys: ${keys.length} (quality: ${hasUserQualityKeys}) | Server keys: anthropic=${!!envAnthropicKey} gemini=${!!envGeminiKey}`);

  // Phase 1: User's own API keys — best quality first
  if (hasUserQualityKeys) {
    if (strategy === "max-performance") {
      if (userAnthropicKey) { const r = await callAnthropic(userAnthropicKey, enrichedSystem, messages, "claude-opus-4-6"); if (r) return { text: r, model: "anthropic/claude-opus-4-6", usedEnvKey: false }; }
      if (userOpenaiKey) { const r = await callOpenAI(userOpenaiKey, enrichedSystem, messages, "gpt-4o"); if (r) return { text: r, model: "openai/gpt-4o", usedEnvKey: false }; }
      if (userGeminiKey) { const r = await callGemini(userGeminiKey, enrichedSystem, messages); if (r) return { text: r, model: "gemini/gemini-3-flash", usedEnvKey: false }; }
      if (userXaiKey) { const r = await callXai(userXaiKey, enrichedSystem, messages, "grok-3"); if (r) return { text: r, model: "xai/grok-3", usedEnvKey: false }; }
      if (userMistralKey) { const r = await callMistral(userMistralKey, enrichedSystem, messages, "mistral-large-latest"); if (r) return { text: r, model: "mistral/mistral-large", usedEnvKey: false }; }
    } else {
      if (userGeminiKey) { const r = await callGemini(userGeminiKey, enrichedSystem, messages); if (r) return { text: r, model: "gemini/gemini-3-flash", usedEnvKey: false }; }
      if (userOpenaiKey) { const r = await callOpenAI(userOpenaiKey, enrichedSystem, messages, "gpt-4o-mini"); if (r) return { text: r, model: "openai/gpt-4o-mini", usedEnvKey: false }; }
      if (userAnthropicKey) { const r = await callAnthropic(userAnthropicKey, enrichedSystem, messages, "claude-sonnet-4-5-20250929"); if (r) return { text: r, model: "anthropic/claude-sonnet-4-5", usedEnvKey: false }; }
      if (userXaiKey) { const r = await callXai(userXaiKey, enrichedSystem, messages, "grok-3-mini"); if (r) return { text: r, model: "xai/grok-3-mini", usedEnvKey: false }; }
      if (userMistralKey) { const r = await callMistral(userMistralKey, enrichedSystem, messages, "mistral-small-latest"); if (r) return { text: r, model: "mistral/mistral-small", usedEnvKey: false }; }
    }
  }

  // Phase 2: MoA server env keys (2x credit)
  //   가성비 → Gemini 3.0 Flash only
  //   최고성능 → Claude Opus 4.6 (fallback to Gemini)
  // Groq/DeepSeek are NOT offered via server keys — user must provide their own.
  if (strategy === "max-performance") {
    if (envAnthropicKey) { const r = await callAnthropic(envAnthropicKey, enrichedSystem, messages, "claude-opus-4-6"); if (r) return { text: r, model: "anthropic/claude-opus-4-6", usedEnvKey: true }; }
    if (envGeminiKey) { const r = await callGemini(envGeminiKey, enrichedSystem, messages); if (r) return { text: r, model: "gemini/gemini-3-flash", usedEnvKey: true }; }
  } else {
    if (envGeminiKey) { const r = await callGemini(envGeminiKey, enrichedSystem, messages); if (r) return { text: r, model: "gemini/gemini-3-flash", usedEnvKey: true }; }
    if (envAnthropicKey) { const r = await callAnthropic(envAnthropicKey, enrichedSystem, messages, "claude-haiku-4-5-20251001"); if (r) return { text: r, model: "anthropic/claude-haiku-4-5", usedEnvKey: true }; }
  }

  // Phase 3: User Groq/DeepSeek keys (not from env)
  if (userGroqKey) { const r = await callGroq(userGroqKey, enrichedSystem, messages); if (r) return { text: r, model: "groq/llama-3.3-70b-versatile", usedEnvKey: false }; }
  if (userDeepseekKey) { const r = await callDeepSeek(userDeepseekKey, enrichedSystem, messages); if (r) return { text: r, model: "deepseek/deepseek-chat", usedEnvKey: false }; }

  console.error("[ai-engine] ALL LLM providers failed — falling back to local response");
  return null;
}

// ────────────────────────────────────────────
// Smart Fallback Response (no LLM needed)
// ────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function selectModelName(strategy: string, keys: any[]): string {
  const has = (p: string) => keys.some((k: { provider: string }) => k.provider === p);
  if (strategy === "max-performance") {
    if (has("anthropic")) return "anthropic/claude-opus-4-6";
    if (has("openai")) return "openai/gpt-4o";
    if (has("gemini")) return "gemini/gemini-3-flash";
    if (has("xai")) return "xai/grok-3";
    if (has("mistral")) return "mistral/mistral-large";
  } else {
    if (has("gemini")) return "gemini/gemini-3-flash";
    if (has("anthropic")) return "anthropic/claude-sonnet-4-5";
    if (has("openai")) return "openai/gpt-4o-mini";
    if (has("xai")) return "xai/grok-3-mini";
    if (has("mistral")) return "mistral/mistral-small";
  }
  if (strategy === "max-performance") return "anthropic/claude-opus-4-6";
  return "gemini/gemini-3-flash";
}

function getCategoryLabel(category: string): string {
  const labels: Record<string, string> = {
    daily: "일상비서", work: "업무보조", document: "문서작업",
    coding: "코딩작업", image: "이미지작업", music: "음악작업", other: "기타",
  };
  return labels[category] ?? "기타";
}

function getCategoryExamples(category: string): string {
  const examples: Record<string, string> = {
    daily: "• 날씨 알려줘\n• 영어로 번역해줘\n• 맛집 추천해줘",
    work: "• 이메일 초안 작성해줘\n• 데이터 분석 도와줘\n• 보고서 작성해줘",
    document: "• 문서 요약해줘\n• PPTX로 변환해줘\n• 종합문서 작성해줘",
    coding: "• 코드 작성해줘\n• 버그 찾아줘\n• 코드 리뷰해줘",
    image: "• 이미지 생성해줘\n• 스타일 변환해줘\n• 이미지 분석해줘",
    music: "• 작곡해줘\n• 가사 작성해줘\n• TTS 변환해줘",
    other: "• 뭘 할 수 있어?\n• 채널 안내해줘\n• 자유롭게 질문하세요",
  };
  return examples[category] ?? examples.other;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function generateSmartResponse(message: string, category: string, model: string, _keys: any[]): string {
  const lowerMsg = message.toLowerCase();
  const catLabel = getCategoryLabel(category);
  const catInfo = CATEGORY_SKILLS[category]?.join(", ") ?? "general";

  if (/^(안녕|hi|hello|하이|반가|헬로|ㅎㅇ|moa|모아)/.test(lowerMsg)) {
    return `안녕하세요! MoA AI 에이전트입니다. 반갑습니다!\n\n현재 **${catLabel}** 모드로 대화 중이에요.\n\n${getCategoryExamples(category)}\n\n무엇을 도와드릴까요?`;
  }
  if (/^(도움|help|뭐 할 수|기능|스킬|할 수 있)/.test(lowerMsg)) {
    return `**${catLabel}** 모드 기능:\n활용 가능: ${catInfo}\n\n웹: https://mymoa.app`;
  }
  if (/다운로드|download|설치|install|앱/.test(lowerMsg)) {
    return `MoA 앱 다운로드: https://mymoa.app/download`;
  }

  return `네, 말씀을 잘 들었습니다!\n\n> "${message.slice(0, 100)}${message.length > 100 ? "..." : ""}"\n\n현재 **${catLabel}** 모드에서 대화 중이에요.\n활용 가능한 스킬: ${catInfo}\n\nAPI 키가 설정되면 실시간 AI가 더 정확하게 답변해드립니다.\nhttps://mymoa.app/mypage`;
}

// ────────────────────────────────────────────
// Skill Auto-Dispatch
// ────────────────────────────────────────────

/**
 * Detect if the message requires a dedicated skill endpoint and call it.
 * Returns a response if a skill handled the request, null otherwise.
 */
async function trySkillDispatch(
  message: string,
  category: string,
  userId: string,
): Promise<AIResponse | null> {
  const lower = message.toLowerCase();
  const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || process.env.VERCEL_URL
    ? `https://${process.env.VERCEL_URL}`
    : "http://localhost:3000";

  try {
    // ── Interpreter: auto-translate when text + language pair detected ──
    if (category === "interpreter") {
      const langMatch = message.match(
        /(?:(.+?)(?:를|을|)\s*)?(?:(한국어|영어|일본어|중국어|스페인어|프랑스어|독일어|Korean|English|Japanese|Chinese|Spanish|French|German))(?:로|으로)\s*(?:번역|통역|바꿔|변환)/i,
      );
      if (langMatch) {
        const langMap: Record<string, string> = {
          한국어: "ko", 영어: "en", 일본어: "ja", 중국어: "zh",
          스페인어: "es", 프랑스어: "fr", 독일어: "de",
          korean: "ko", english: "en", japanese: "ja", chinese: "zh",
          spanish: "es", french: "fr", german: "de",
        };
        const targetLang = langMap[langMatch[2].toLowerCase()] || "en";
        // Extract source text (everything before the language instruction, or use context)
        const sourceText = langMatch[1]?.trim() || message.replace(/(?:한국어|영어|일본어|중국어|스페인어|프랑스어|독일어|Korean|English|Japanese|Chinese|Spanish|French|German)(?:로|으로)\s*(?:번역|통역|바꿔|변환)/gi, "").trim();
        if (sourceText.length > 2) {
          const sourceLang = /[가-힣]/.test(sourceText) ? "ko" : "en";
          const res = await fetch(`${baseUrl}/api/interpreter`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              text: sourceText,
              source_lang: sourceLang,
              target_lang: targetLang,
              user_id: userId,
            }),
          });
          if (res.ok) {
            const data = await res.json();
            if (data.translated_text) {
              return {
                text: `[원문] ${sourceText}\n[번역] ${data.translated_text}`,
                model: `skill/interpreter`,
                usedEnvKey: false,
              };
            }
          }
        }
      }
    }

    // ── Autocode: detect explicit coding task requests ──
    if (category === "coding" && /자동\s*코딩|코드\s*(?:작성|생성|만들어)|autocode|코딩\s*해줘/.test(lower)) {
      const res = await fetch(`${baseUrl}/api/autocode`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          goal: message,
          framework: "nextjs",
          model: "auto",
          iteration: 1,
        }),
      });
      if (res.ok) {
        const data = await res.json();
        if (data.code) {
          return {
            text: `**자동 코딩 완료** (${data.model})\n\n\`\`\`\n${data.code.slice(0, 3000)}\n\`\`\``,
            model: "skill/autocode",
            usedEnvKey: false,
          };
        }
      }
    }
  } catch (err) {
    console.warn("[ai-engine] Skill dispatch failed:", err instanceof Error ? err.message : err);
  }

  // No skill matched — let the LLM handle it
  return null;
}

// ────────────────────────────────────────────
// Main Entry Point: generateAIResponse
// ────────────────────────────────────────────

/**
 * Generate an AI response for any channel.
 * This is the shared core — called directly by webhooks (no internal HTTP).
 *
 * Multi-turn: Loads recent conversation history (cross-channel, by user_id)
 * and passes it to the LLM for contextual responses.
 *
 * Optimization 4: DB queries parallelized with Promise.all.
 */
export async function generateAIResponse(params: {
  message: string;
  userId: string;
  sessionId: string;
  channel: string;
  category?: string;
  maskedTextForStorage?: string;
}): Promise<ChatResult> {
  const { message, userId, sessionId, channel } = params;
  const category = params.category ?? detectCategory(message);

  // Determine storage content (masking)
  const storageContent = params.maskedTextForStorage
    ?? detectAndMaskSensitiveData(message.trim()).maskedText;

  // Try to get Supabase (non-blocking)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let supabase: any = null;
  try {
    const { getServiceSupabase } = await import("@/lib/supabase");
    supabase = getServiceSupabase();
  } catch { /* Supabase not configured */ }

  // ── Optimization 4: Parallelize DB lookups ──
  // Fetch user keys + settings + conversation history + save user message simultaneously
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let activeKeys: any[] = [];
  let strategy = "cost-efficient";
  let conversationHistory: LLMMessage[] = [];

  if (supabase && userId) {
    const [keysResult, settingsResult, historyResult] = await Promise.all([
      supabase
        .from("moa_user_api_keys")
        .select("provider, encrypted_key, is_active")
        .eq("user_id", userId)
        .eq("is_active", true)
        .then((r: { data: unknown }) => r.data)
        .catch(() => null),
      supabase
        .from("moa_user_settings")
        .select("model_strategy")
        .eq("user_id", userId)
        .single()
        .then((r: { data: unknown }) => r.data)
        .catch(() => null),
      // Load conversation history (cross-channel, by user_id, recent first)
      loadConversationHistory(supabase, userId),
      // Save user message in parallel (best-effort)
      sessionId ? supabase.from("moa_chat_messages").insert({
        user_id: userId, session_id: sessionId, role: "user",
        content: storageContent, channel, category,
      }).catch(() => {}) : Promise.resolve(),
    ]);

    activeKeys = keysResult ?? [];
    strategy = settingsResult?.model_strategy ?? "cost-efficient";
    conversationHistory = historyResult;
  }

  // ── Skill auto-dispatch: route specific tasks to dedicated endpoints ──
  const skillResult = await trySkillDispatch(message.trim(), category, userId);
  if (skillResult) {
    // Skill handled the request — save response and return
    if (supabase && userId && sessionId) {
      await supabase.from("moa_chat_messages").insert({
        user_id: userId, session_id: sessionId, role: "assistant",
        content: skillResult.text, channel, model_used: skillResult.model, category,
      }).catch(() => {});
    }
    return {
      reply: skillResult.text,
      model: skillResult.model,
      category,
      credits_used: 0,
      credits_remaining: undefined,
      key_source: "user",
      timestamp: new Date().toISOString(),
    };
  }

  // ── Credit pre-check: ensure user can afford an LLM call ──
  // If using server env keys (Phase 2), check balance before making the call
  const hasUserKeys = activeKeys.length > 0;
  let userBalance: number | null = null;
  if (supabase && userId && !hasUserKeys) {
    try {
      const { data: creditData } = await supabase
        .from("moa_credits")
        .select("balance")
        .eq("user_id", userId)
        .single();
      userBalance = creditData?.balance ?? null;

      // Estimate cost: server key usage = base cost × 2
      const estimatedModel = strategy === "max-performance"
        ? "anthropic/claude-opus-4-6"
        : "gemini/gemini-3-flash";
      const estimatedCost = getCreditCost(estimatedModel) * ENV_KEY_MULTIPLIER;

      if (userBalance !== null && userBalance < estimatedCost) {
        return {
          reply: `크레딧이 부족합니다. 현재 잔액: ${userBalance} 크레딧\n\n` +
            `예상 비용: ${estimatedCost} 크레딧 (MoA 키 사용 시 2배)\n\n` +
            `크레딧을 충전하거나 직접 API 키를 등록하면 무료로 이용할 수 있습니다.\n` +
            `https://mymoa.app/mypage`,
          model: "system/credit-check",
          category,
          credits_used: 0,
          credits_remaining: userBalance,
          key_source: "moa",
          timestamp: new Date().toISOString(),
        };
      }
    } catch {
      // Credit check failed — proceed anyway (best-effort)
    }
  }

  // ── Build multi-turn messages for LLM ──
  const llmMessages = buildLLMMessages(conversationHistory, message.trim(), channel);

  // ── Try semantic cache first (based on current message only) ──
  let aiResponse: AIResponse | null = null;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let setCachedResponseFn: any = null;
  try {
    const { getCachedResponse, setCachedResponse } = await import("@/lib/semantic-cache");
    setCachedResponseFn = setCachedResponse;
    const cached = await getCachedResponse(message, category);
    if (cached) {
      aiResponse = { text: cached, model: "cache/hit", usedEnvKey: false };
    }
  } catch {
    // Semantic cache not available — no-op
  }

  // ── Try OpenClaw Agent first (full agent capabilities) ──
  // When the OpenClaw gateway is available, route through it for:
  // tools, skills, memory, browser automation, and richer responses.
  if (!aiResponse && isOpenClawConfigured()) {
    try {
      const agentResult = await sendToOpenClawAgent({
        message: message.trim(),
        userId,
        sessionKey: `moa:${channel}:${userId}`,
        channel,
        category,
      });
      if (agentResult && agentResult.text) {
        const toolInfo = agentResult.toolsUsed.length > 0
          ? ` [tools: ${agentResult.toolsUsed.join(", ")}]`
          : "";
        console.info(`[ai-engine] OpenClaw agent responded (${agentResult.model})${toolInfo}`);
        aiResponse = {
          text: agentResult.text,
          model: `openclaw/${agentResult.model}`,
          usedEnvKey: false,
        };
        if (setCachedResponseFn) {
          setCachedResponseFn(message, category, agentResult.text).catch(() => {});
        }
      }
    } catch (agentErr) {
      console.warn("[ai-engine] OpenClaw agent failed, falling back to direct LLM:", agentErr instanceof Error ? agentErr.message : agentErr);
    }
  }

  // Call LLM directly if no cache hit and no agent response
  if (!aiResponse) {
    try {
      aiResponse = await tryLlmCall(llmMessages, category, strategy, activeKeys);
      if (aiResponse && setCachedResponseFn) {
        setCachedResponseFn(message, category, aiResponse.text).catch(() => {});
      }
    } catch (llmErr) {
      console.error("[ai-engine] tryLlmCall threw:", llmErr instanceof Error ? llmErr.message : llmErr);
    }
  }

  // Fallback: smart response (no actual LLM call — zero credit cost)
  if (!aiResponse) {
    const text = generateSmartResponse(message, category, "local/fallback", activeKeys);
    aiResponse = { text, model: "local/fallback", usedEnvKey: false };
  }

  // ── Optimization 4: Parallelize credit deduction + response save ──
  let creditInfo: { balance?: number; cost?: number } = {};
  if (supabase && userId) {
    const [creditResult] = await Promise.all([
      deductCredits(supabase, userId, aiResponse.model, aiResponse.usedEnvKey).catch(() => ({})),
      sessionId ? supabase.from("moa_chat_messages").insert({
        user_id: userId, session_id: sessionId, role: "assistant",
        content: aiResponse.text, channel, model_used: aiResponse.model, category,
      }).catch(() => {}) : Promise.resolve(),
    ]);
    creditInfo = creditResult;
  }

  // ── Replit-style: append credit usage footer to response ──
  const creditCost = creditInfo.cost ?? 0;
  let replyText = aiResponse.text;
  if (creditCost > 0) {
    const modelName = aiResponse.model.split("/").pop() ?? aiResponse.model;
    const keyLabel = aiResponse.usedEnvKey ? " (MoA 키)" : "";
    replyText += `\n\n─\n⚡ ${modelName}${keyLabel} | ${creditCost}C 사용`;
  }

  return {
    reply: replyText,
    model: aiResponse.model,
    category,
    credits_used: creditCost,
    credits_remaining: creditInfo.balance,
    key_source: aiResponse.usedEnvKey ? "moa" : "user",
    timestamp: new Date().toISOString(),
  };
}
