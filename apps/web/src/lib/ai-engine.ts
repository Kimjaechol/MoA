/**
 * Shared AI Engine — Core LLM logic extracted from /api/chat.
 *
 * Optimizations applied:
 *   1. No internal HTTP call — webhook handlers import this directly
 *   2. DB queries parallelized with Promise.all
 *   3. Semantic cache integration (optional, via @/lib/semantic-cache)
 *   4. Multi-turn conversation context with cross-channel history
 *
 * This module runs on Node.js runtime (needs node:crypto for key decryption).
 */

import { safeDecrypt } from "@/lib/crypto";
import { detectAndMaskSensitiveData } from "@/lib/security";

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
  if (/코드|코딩|프로그래밍|debug|bug|function|class|import|git|code/.test(lower)) return "coding";
  if (/문서|보고서|요약|번역|pptx|docx|pdf|document|report/.test(lower)) return "document";
  if (/이미지|그림|사진|그려|image|photo|draw/.test(lower)) return "image";
  if (/음악|노래|작곡|가사|music|song/.test(lower)) return "music";
  if (/이메일|업무|보고|회의|미팅|email|meeting/.test(lower)) return "work";
  if (/날씨|일정|번역|맛집|추천|weather|schedule/.test(lower)) return "daily";
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
  other: `You are MoA, a versatile AI assistant with 100+ skills across 15 channels. Help with any request.${LANGUAGE_RULE}${CROSS_CHANNEL_CONTEXT}`,
};

export const CATEGORY_SKILLS: Record<string, string[]> = {
  daily: ["weather", "calendar", "translate", "search", "news", "maps"],
  work: ["email", "notion", "airtable", "slack", "github", "calendar", "summarize"],
  document: ["summarize", "editor", "synthesis", "convert", "pptx", "pdf"],
  coding: ["code", "debug", "github", "autocode", "vision", "terminal"],
  image: ["fal-ai", "replicate", "vision", "image-edit", "style-transfer"],
  music: ["tts", "suno", "lyrics", "music-analysis", "podcast"],
  other: ["search", "translate", "summarize", "general"],
};

// ────────────────────────────────────────────
// Credit System
// ────────────────────────────────────────────

const MODEL_CREDIT_COSTS: Record<string, number> = {
  "local/slm-default": 0, "local/fallback": 0, "cache/hit": 0,
  "groq/kimi-k2-0905": 1, "groq/llama-3.3-70b-versatile": 1,
  "gemini/gemini-3.0-flash": 2, "gemini/gemini-2.5-flash": 2, "gemini/gemini-2.0-flash": 2,
  "deepseek/deepseek-chat": 3,
  "mistral/mistral-small": 3, "mistral/mistral-large": 6,
  "xai/grok-3-mini": 4, "xai/grok-3": 8,
  "openai/gpt-4o": 5, "openai/gpt-4o-mini": 3,
  "anthropic/claude-sonnet-4-5": 8, "anthropic/claude-haiku-4-5": 4,
  "openai/gpt-5": 10,
  "anthropic/claude-opus-4-6": 15,
};

function getCreditCost(model: string): number {
  if (MODEL_CREDIT_COSTS[model] !== undefined) return MODEL_CREDIT_COSTS[model];
  if (model.startsWith("groq/")) return 1;
  if (model.startsWith("gemini/")) return 2;
  if (model.startsWith("deepseek/")) return 3;
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
  } catch { /* fall through */ }
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
  } catch { /* fall through */ }
  return null;
}

const GEMINI_MODEL = "gemini-3.0-flash";

async function callGemini(key: string, system: string, messages: LLMMessage[]): Promise<string | null> {
  try {
    const normalized = normalizeMessages(messages);
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${key}`, {
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
      return data.candidates?.[0]?.content?.parts?.[0]?.text ?? null;
    }
  } catch { /* fall through */ }
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
  } catch { /* fall through */ }
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
  } catch { /* fall through */ }
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
  } catch { /* fall through */ }
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
  } catch { /* fall through */ }
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

  const envAnthropicKey = process.env.ANTHROPIC_API_KEY;
  const envOpenaiKey = process.env.OPENAI_API_KEY;
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

  // Phase 1: User's own API keys — best quality first
  if (hasUserQualityKeys) {
    if (strategy === "max-performance") {
      if (userAnthropicKey) { const r = await callAnthropic(userAnthropicKey, enrichedSystem, messages, "claude-opus-4-6"); if (r) return { text: r, model: "anthropic/claude-opus-4-6", usedEnvKey: false }; }
      if (userOpenaiKey) { const r = await callOpenAI(userOpenaiKey, enrichedSystem, messages, "gpt-5"); if (r) return { text: r, model: "openai/gpt-5", usedEnvKey: false }; }
      if (userGeminiKey) { const r = await callGemini(userGeminiKey, enrichedSystem, messages); if (r) return { text: r, model: "gemini/gemini-3.0-flash", usedEnvKey: false }; }
      if (userXaiKey) { const r = await callXai(userXaiKey, enrichedSystem, messages, "grok-3"); if (r) return { text: r, model: "xai/grok-3", usedEnvKey: false }; }
      if (userMistralKey) { const r = await callMistral(userMistralKey, enrichedSystem, messages, "mistral-large-latest"); if (r) return { text: r, model: "mistral/mistral-large", usedEnvKey: false }; }
    } else {
      if (userAnthropicKey) { const r = await callAnthropic(userAnthropicKey, enrichedSystem, messages, "claude-sonnet-4-5-20250929"); if (r) return { text: r, model: "anthropic/claude-sonnet-4-5", usedEnvKey: false }; }
      if (userOpenaiKey) { const r = await callOpenAI(userOpenaiKey, enrichedSystem, messages, "gpt-4o-mini"); if (r) return { text: r, model: "openai/gpt-4o-mini", usedEnvKey: false }; }
      if (userGeminiKey) { const r = await callGemini(userGeminiKey, enrichedSystem, messages); if (r) return { text: r, model: "gemini/gemini-3.0-flash", usedEnvKey: false }; }
      if (userXaiKey) { const r = await callXai(userXaiKey, enrichedSystem, messages, "grok-3-mini"); if (r) return { text: r, model: "xai/grok-3-mini", usedEnvKey: false }; }
      if (userMistralKey) { const r = await callMistral(userMistralKey, enrichedSystem, messages, "mistral-small-latest"); if (r) return { text: r, model: "mistral/mistral-small", usedEnvKey: false }; }
    }
  }

  // Phase 2: MoA server env keys (2x credit)
  if (strategy === "max-performance") {
    if (envAnthropicKey) { const r = await callAnthropic(envAnthropicKey, enrichedSystem, messages, "claude-opus-4-6"); if (r) return { text: r, model: "anthropic/claude-opus-4-6", usedEnvKey: true }; }
    if (envOpenaiKey) { const r = await callOpenAI(envOpenaiKey, enrichedSystem, messages, "gpt-5"); if (r) return { text: r, model: "openai/gpt-5", usedEnvKey: true }; }
    if (envGeminiKey) { const r = await callGemini(envGeminiKey, enrichedSystem, messages); if (r) return { text: r, model: "gemini/gemini-3.0-flash", usedEnvKey: true }; }
  } else {
    if (envGeminiKey) { const r = await callGemini(envGeminiKey, enrichedSystem, messages); if (r) return { text: r, model: "gemini/gemini-3.0-flash", usedEnvKey: true }; }
    if (envOpenaiKey) { const r = await callOpenAI(envOpenaiKey, enrichedSystem, messages, "gpt-4o-mini"); if (r) return { text: r, model: "openai/gpt-4o-mini", usedEnvKey: true }; }
    if (envAnthropicKey) { const r = await callAnthropic(envAnthropicKey, enrichedSystem, messages, "claude-haiku-4-5"); if (r) return { text: r, model: "anthropic/claude-haiku-4-5", usedEnvKey: true }; }
  }

  // Phase 3: Groq/DeepSeek — user keys ONLY (CJK mixing issues)
  if (userGroqKey) { const r = await callGroq(userGroqKey, enrichedSystem, messages); if (r) return { text: r, model: "groq/llama-3.3-70b-versatile", usedEnvKey: false }; }
  if (userDeepseekKey) { const r = await callDeepSeek(userDeepseekKey, enrichedSystem, messages); if (r) return { text: r, model: "deepseek/deepseek-chat", usedEnvKey: false }; }

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
    if (has("openai")) return "openai/gpt-5";
    if (has("gemini")) return "gemini/gemini-3.0-flash";
    if (has("xai")) return "xai/grok-3";
    if (has("mistral")) return "mistral/mistral-large";
  } else {
    if (has("anthropic")) return "anthropic/claude-sonnet-4-5";
    if (has("openai")) return "openai/gpt-4o-mini";
    if (has("gemini")) return "gemini/gemini-3.0-flash";
    if (has("xai")) return "xai/grok-3-mini";
    if (has("mistral")) return "mistral/mistral-small";
  }
  if (strategy === "max-performance") return "anthropic/claude-opus-4-6";
  return "gemini/gemini-3.0-flash";
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

  // ── Build multi-turn messages for LLM ──
  const llmMessages = buildLLMMessages(conversationHistory, message.trim(), channel);

  // ── Try semantic cache first (based on current message only) ──
  let aiResponse: AIResponse | null = null;
  try {
    const { getCachedResponse, setCachedResponse } = await import("@/lib/semantic-cache");
    const cached = await getCachedResponse(message, category);
    if (cached) {
      aiResponse = { text: cached, model: "cache/hit", usedEnvKey: false };
    }

    // If cache miss, call LLM with full history and cache the result
    if (!aiResponse) {
      try {
        aiResponse = await tryLlmCall(llmMessages, category, strategy, activeKeys);
        if (aiResponse) {
          // Cache in background (don't await)
          setCachedResponse(message, category, aiResponse.text).catch(() => {});
        }
      } catch { /* LLM failed */ }
    }
  } catch {
    // Semantic cache not available — call LLM directly with full history
    try {
      aiResponse = await tryLlmCall(llmMessages, category, strategy, activeKeys);
    } catch { /* LLM failed */ }
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

  return {
    reply: aiResponse.text,
    model: aiResponse.model,
    category,
    credits_used: creditInfo.cost ?? 0,
    credits_remaining: creditInfo.balance,
    key_source: aiResponse.usedEnvKey ? "moa" : "user",
    timestamp: new Date().toISOString(),
  };
}
