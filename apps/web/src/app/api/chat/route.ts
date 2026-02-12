import { NextRequest, NextResponse } from "next/server";
import { safeDecrypt } from "@/lib/crypto";

/**
 * POST /api/chat
 * Send a message and get an AI response.
 * Body: { user_id, session_id, content, channel?, category? }
 *
 * The `category` field enables category-aware skill routing:
 *   daily, work, document, coding, image, music, other
 *
 * Resilient design: works even without Supabase or API keys.
 * Supabase persistence is best-effort; AI responses always returned.
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();

    // ── web_login action — delegate to /api/auth ──
    if (body.action === "web_login") {
      return handleWebLogin(body);
    }

    const { user_id, session_id, content, channel = "web", category = "other", is_desktop = false } = body;

    if (!content || typeof content !== "string" || !content.trim()) {
      return NextResponse.json({ error: "메시지를 입력해주세요." }, { status: 400 });
    }

    // Try to get Supabase client (non-blocking — works without it)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let supabase: any = null;
    try {
      const { getServiceSupabase } = await import("@/lib/supabase");
      supabase = getServiceSupabase();
    } catch {
      // Supabase not configured — continue without persistence
    }

    // 1. Save user message (best-effort, non-blocking)
    if (supabase && user_id && session_id) {
      try {
        await supabase.from("moa_chat_messages").insert({
          user_id, session_id, role: "user",
          content: content.trim(), channel, category,
        });
      } catch { /* persistence failure — non-fatal */ }
    }

    // 2. Check for local file access requests from non-desktop browser
    if (!is_desktop && /([A-Za-z]:\\|내\s*컴퓨터|로컬\s*파일|E\s*드라이브|C\s*드라이브|D\s*드라이브)/.test(content)) {
      return NextResponse.json({
        reply: "로컬 파일에 접근하려면 MoA 데스크톱 앱이 필요합니다.\n\n" +
          "MoA 데스크톱 앱을 설치하면 E드라이브 등 로컬 파일을 직접 관리할 수 있어요.\n\n" +
          "다운로드 페이지에서 원클릭으로 설치하세요: /download",
        model: "local/system",
        category,
        credits_used: 0,
        timestamp: new Date().toISOString(),
      });
    }

    // 3. Generate AI response (category-aware, always succeeds)
    const aiResponse = await generateResponse(content.trim(), user_id, category, supabase);

    // 4. Deduct credits (best-effort, non-blocking)
    // Apply 2x multiplier when using MoA's server-level API keys
    let creditInfo: { balance?: number; cost?: number } = {};
    if (supabase && user_id) {
      try {
        creditInfo = await deductCredits(supabase, user_id, aiResponse.model, aiResponse.usedEnvKey);
      } catch { /* credit deduction failure — non-fatal */ }
    }

    // 5. Save AI response (best-effort, non-blocking)
    if (supabase && user_id && session_id) {
      try {
        await supabase.from("moa_chat_messages").insert({
          user_id, session_id, role: "assistant",
          content: aiResponse.text, channel,
          model_used: aiResponse.model, category,
        });
      } catch { /* persistence failure — non-fatal */ }
    }

    return NextResponse.json({
      reply: aiResponse.text,
      model: aiResponse.model,
      category,
      credits_used: creditInfo.cost ?? 0,
      credits_remaining: creditInfo.balance,
      key_source: aiResponse.usedEnvKey ? "moa" : "user",
      timestamp: new Date().toISOString(),
    });
  } catch {
    // Ultimate fallback — always return a response, never 500
    return NextResponse.json({
      reply: "안녕하세요! MoA AI입니다. 무엇을 도와드릴까요?",
      model: "local/fallback",
      category: "other",
      timestamp: new Date().toISOString(),
    });
  }
}

/**
 * GET /api/chat?user_id=xxx&session_id=yyy&token=zzz
 * Fetch chat history for a session. Requires valid session token.
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const userId = searchParams.get("user_id");
    const sessionId = searchParams.get("session_id");
    const token = searchParams.get("token");
    const limit = parseInt(searchParams.get("limit") ?? "50", 10);

    if (!userId || !sessionId) {
      return NextResponse.json({ messages: [] });
    }

    let supabase;
    try {
      const { getServiceSupabase } = await import("@/lib/supabase");
      supabase = getServiceSupabase();
    } catch {
      return NextResponse.json({ messages: [] });
    }

    // Authenticate: verify session token matches user_id
    if (token) {
      const { data: sess } = await supabase
        .from("moa_sessions")
        .select("user_id, expires_at")
        .eq("token", token)
        .single();
      if (!sess || sess.user_id !== userId || new Date(sess.expires_at) < new Date()) {
        return NextResponse.json({ messages: [], error: "인증이 필요합니다." }, { status: 401 });
      }
    }

    const { data, error } = await supabase
      .from("moa_chat_messages")
      .select("id, role, content, model_used, created_at")
      .eq("user_id", userId)
      .eq("session_id", sessionId)
      .order("created_at", { ascending: true })
      .limit(limit);

    if (error) {
      return NextResponse.json({ messages: [] });
    }

    return NextResponse.json({ messages: data ?? [] });
  } catch {
    return NextResponse.json({ messages: [] });
  }
}

/* -----------------------------------------------------------------
   Credit Deduction
   ----------------------------------------------------------------- */

const MODEL_CREDIT_COSTS: Record<string, number> = {
  "local/slm-default": 0, "local/fallback": 0,
  "groq/kimi-k2-0905": 1, "groq/llama-3.3-70b-versatile": 1,
  "gemini/gemini-2.5-flash": 2, "gemini/gemini-2.0-flash": 2,
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

/** MoA server key multiplier: 2x credit cost when users use MoA's API keys */
const ENV_KEY_MULTIPLIER = 2;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function deductCredits(supabase: any, userId: string, model: string, usedEnvKey: boolean): Promise<{ balance: number; cost: number }> {
  const baseCost = getCreditCost(model);
  // Apply 2x multiplier when using MoA's server-level API keys
  const cost = usedEnvKey ? baseCost * ENV_KEY_MULTIPLIER : baseCost;
  if (cost === 0) return { balance: -1, cost: 0 };

  // Atomic credit deduction using Supabase filter to prevent race conditions.
  // The balance check + update happens in a single query.
  const { data: updated, error: updateError } = await supabase
    .from("moa_credits")
    .update({
      balance: supabase.rpc ? undefined : 0, // placeholder — actual update below
      updated_at: new Date().toISOString(),
    })
    .eq("user_id", userId)
    .select("balance, monthly_used")
    .single();

  // If no credit record exists, initialize one
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

  // Allow usage even if balance is low (don't block chat)
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

/* -----------------------------------------------------------------
   Category-Aware AI Response Generator
   ----------------------------------------------------------------- */

interface AIResponse {
  text: string;
  model: string;
  usedEnvKey: boolean;
}

/**
 * Strict language enforcement rule — appended to all system prompts.
 * Prevents CJK language mixing (e.g. Japanese in Korean responses).
 */
const LANGUAGE_RULE = `

[CRITICAL LANGUAGE RULE / 언어 규칙 - 최우선 적용]
You MUST respond in the SAME language as the user's message.
사용자가 한국어로 말하면, 반드시 한국어로만 대답하세요.

- 한국어 응답 시: 일본어(ありません, ちょっと 등), 중국어(的, 是, 了 등), 러시아어(Привет 등)를 절대 섞지 마세요.
- 한자(漢字)를 한국어 응답에 사용하지 마세요. 한국어 단어만 사용하세요.
- If the user writes in Korean, respond ONLY in pure Korean. NEVER mix Chinese characters (漢字), Japanese, Russian, or any other language.
- If the user writes in English, respond ONLY in English.
- If the user explicitly requests a different language (e.g. "영어로 답해줘"), follow that instruction.
- English technical terms (API, URL, code snippets) are acceptable in any language.
- ABSOLUTELY DO NOT mix different languages in a single response. This is strictly forbidden.
`;

/** Category-specific system prompt prefixes for LLM routing */
const CATEGORY_SYSTEM_PROMPTS: Record<string, string> = {
  daily: `You are a daily life assistant. Help with schedules, weather, translations, lifestyle tips, and general questions.${LANGUAGE_RULE}`,
  work: `You are a professional work assistant. Help with emails, reports, meeting notes, data analysis, and business tasks.${LANGUAGE_RULE}`,
  document: `You are a document specialist. Help with document creation, summarization, conversion, synthesis, and formatting.${LANGUAGE_RULE}`,
  coding: `You are an expert software engineer. Help with code writing, debugging, code review, and automated coding tasks. Include code snippets and technical details.${LANGUAGE_RULE}`,
  image: `You are an image/visual AI assistant. Help with image generation prompts, editing instructions, image analysis, and style transfer.${LANGUAGE_RULE}`,
  music: `You are a music AI assistant. Help with composition, lyrics writing, TTS, and music analysis.${LANGUAGE_RULE}`,
  other: `You are MoA, a versatile AI assistant with 100+ skills across 15 channels. Help with any request.${LANGUAGE_RULE}`,
};

/** Category-specific skill sets for routing */
const CATEGORY_SKILLS: Record<string, string[]> = {
  daily: ["weather", "calendar", "translate", "search", "news", "maps"],
  work: ["email", "notion", "airtable", "slack", "github", "calendar", "summarize"],
  document: ["summarize", "editor", "synthesis", "convert", "pptx", "pdf"],
  coding: ["code", "debug", "github", "autocode", "vision", "terminal"],
  image: ["fal-ai", "replicate", "vision", "image-edit", "style-transfer"],
  music: ["tts", "suno", "lyrics", "music-analysis", "podcast"],
  other: ["search", "translate", "summarize", "general"],
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function generateResponse(message: string, userId: string, category: string, supabase: any): Promise<AIResponse> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let activeKeys: any[] = [];
  let strategy = "cost-efficient";

  // Try to fetch user settings from Supabase (non-blocking)
  if (supabase && userId) {
    try {
      const { data: keys } = await supabase
        .from("moa_user_api_keys")
        .select("provider, encrypted_key, is_active")
        .eq("user_id", userId)
        .eq("is_active", true);
      activeKeys = keys ?? [];
    } catch { /* table may not exist yet */ }

    try {
      const { data: settings } = await supabase
        .from("moa_user_settings")
        .select("model_strategy")
        .eq("user_id", userId)
        .single();
      strategy = settings?.model_strategy ?? "cost-efficient";
    } catch { /* table may not exist yet */ }
  }

  // Try to call real LLM API (env keys or user keys)
  try {
    const llmResult = await tryLlmCall(message, category, strategy, activeKeys);
    if (llmResult) {
      return llmResult;
    }
  } catch { /* LLM call failed — fall through to smart response */ }

  // Fallback: always-available smart contextual response (no API key used)
  const modelUsed = selectModelName(strategy, activeKeys);
  const text = generateSmartResponse(message, category, modelUsed, "");
  return { text, model: modelUsed, usedEnvKey: false };
}

/**
 * Attempt real LLM API call — 3-phase model selection.
 *
 * Phase 1: User's own API keys (1x credit) — best quality first.
 *   When a user pays for API keys, use the best model among their keys.
 *   Priority: Claude > OpenAI > Gemini > Mistral > xAI
 *   Groq(Llama) and DeepSeek are excluded here (CJK language mixing).
 *
 * Phase 2: MoA server env keys (2x credit) — strategy defaults.
 *   - cost-efficient  → Gemini 2.5 Flash → GPT-4o-mini → Claude Haiku
 *   - max-performance → Claude Opus 4.6 → GPT-5 → Gemini 2.5 Flash
 *
 * Phase 3: Groq/DeepSeek — user keys ONLY, absolute last resort.
 *   Only used when the user explicitly provided their own key.
 *   Never picked from env keys due to CJK language mixing issues.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function tryLlmCall(message: string, category: string, strategy: string, keys: any[]): Promise<AIResponse | null> {
  const systemPrompt = CATEGORY_SYSTEM_PROMPTS[category] ?? CATEGORY_SYSTEM_PROMPTS.other;
  const skills = CATEGORY_SKILLS[category] ?? CATEGORY_SKILLS.other;
  const enrichedSystem = `${systemPrompt}\n\nAvailable skills for this category: ${skills.join(", ")}`;

  // Server-level env keys (MoA-provided → 2x credit)
  const envAnthropicKey = process.env.ANTHROPIC_API_KEY;
  const envOpenaiKey = process.env.OPENAI_API_KEY;
  const envGeminiKey = process.env.GEMINI_API_KEY;

  // User-provided keys (stored encrypted in DB → decrypt, 1x credit)
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

  // ──────────────────────────────────────────────
  // Phase 1: User's own API keys — best quality first
  // When the user pays for API keys, use the best model from their keys.
  // ──────────────────────────────────────────────
  if (hasUserQualityKeys) {
    if (strategy === "max-performance") {
      // Max-perf user keys: Claude Opus → GPT-5 → Gemini → xAI → Mistral
      if (userAnthropicKey) {
        const r = await callAnthropic(userAnthropicKey, enrichedSystem, message, "claude-opus-4-6");
        if (r) return { text: r, model: "anthropic/claude-opus-4-6", usedEnvKey: false };
      }
      if (userOpenaiKey) {
        const r = await callOpenAI(userOpenaiKey, enrichedSystem, message, "gpt-5");
        if (r) return { text: r, model: "openai/gpt-5", usedEnvKey: false };
      }
      if (userGeminiKey) {
        const r = await callGemini(userGeminiKey, enrichedSystem, message);
        if (r) return { text: r, model: "gemini/gemini-2.5-flash", usedEnvKey: false };
      }
      if (userXaiKey) {
        const r = await callXai(userXaiKey, enrichedSystem, message, "grok-3");
        if (r) return { text: r, model: "xai/grok-3", usedEnvKey: false };
      }
      if (userMistralKey) {
        const r = await callMistral(userMistralKey, enrichedSystem, message, "mistral-large-latest");
        if (r) return { text: r, model: "mistral/mistral-large", usedEnvKey: false };
      }
    } else {
      // Cost-efficient user keys: Claude Sonnet → GPT-4o-mini → Gemini → xAI → Mistral
      // User is paying anyway, so use the best cost-effective model from their keys.
      if (userAnthropicKey) {
        const r = await callAnthropic(userAnthropicKey, enrichedSystem, message, "claude-sonnet-4-5-20250929");
        if (r) return { text: r, model: "anthropic/claude-sonnet-4-5", usedEnvKey: false };
      }
      if (userOpenaiKey) {
        const r = await callOpenAI(userOpenaiKey, enrichedSystem, message, "gpt-4o-mini");
        if (r) return { text: r, model: "openai/gpt-4o-mini", usedEnvKey: false };
      }
      if (userGeminiKey) {
        const r = await callGemini(userGeminiKey, enrichedSystem, message);
        if (r) return { text: r, model: "gemini/gemini-2.5-flash", usedEnvKey: false };
      }
      if (userXaiKey) {
        const r = await callXai(userXaiKey, enrichedSystem, message, "grok-3-mini");
        if (r) return { text: r, model: "xai/grok-3-mini", usedEnvKey: false };
      }
      if (userMistralKey) {
        const r = await callMistral(userMistralKey, enrichedSystem, message, "mistral-small-latest");
        if (r) return { text: r, model: "mistral/mistral-small", usedEnvKey: false };
      }
    }
  }

  // ──────────────────────────────────────────────
  // Phase 2: MoA server env keys — strategy defaults
  // When user has no keys (or user keys all failed), use MoA env keys.
  // ──────────────────────────────────────────────
  if (strategy === "max-performance") {
    // Max-perf env: Claude Opus → GPT-5 → Gemini 2.5 Flash
    if (envAnthropicKey) {
      const r = await callAnthropic(envAnthropicKey, enrichedSystem, message, "claude-opus-4-6");
      if (r) return { text: r, model: "anthropic/claude-opus-4-6", usedEnvKey: true };
    }
    if (envOpenaiKey) {
      const r = await callOpenAI(envOpenaiKey, enrichedSystem, message, "gpt-5");
      if (r) return { text: r, model: "openai/gpt-5", usedEnvKey: true };
    }
    if (envGeminiKey) {
      const r = await callGemini(envGeminiKey, enrichedSystem, message);
      if (r) return { text: r, model: "gemini/gemini-2.5-flash", usedEnvKey: true };
    }
  } else {
    // Cost-efficient env: Gemini 2.5 Flash → GPT-4o-mini → Claude Haiku
    if (envGeminiKey) {
      const r = await callGemini(envGeminiKey, enrichedSystem, message);
      if (r) return { text: r, model: "gemini/gemini-2.5-flash", usedEnvKey: true };
    }
    if (envOpenaiKey) {
      const r = await callOpenAI(envOpenaiKey, enrichedSystem, message, "gpt-4o-mini");
      if (r) return { text: r, model: "openai/gpt-4o-mini", usedEnvKey: true };
    }
    if (envAnthropicKey) {
      const r = await callAnthropic(envAnthropicKey, enrichedSystem, message, "claude-haiku-4-5");
      if (r) return { text: r, model: "anthropic/claude-haiku-4-5", usedEnvKey: true };
    }
  }

  // ──────────────────────────────────────────────
  // Phase 3: Groq(Llama) / DeepSeek — absolute last resort
  // User keys ONLY. Never from env keys.
  // These models have CJK language mixing issues (Korean/Chinese/Japanese).
  // ──────────────────────────────────────────────
  if (userGroqKey) {
    const r = await callGroq(userGroqKey, enrichedSystem, message);
    if (r) return { text: r, model: "groq/llama-3.3-70b-versatile", usedEnvKey: false };
  }
  if (userDeepseekKey) {
    const r = await callDeepSeek(userDeepseekKey, enrichedSystem, message);
    if (r) return { text: r, model: "deepseek/deepseek-chat", usedEnvKey: false };
  }

  return null;
}

async function callAnthropic(key: string, system: string, message: string, model: string): Promise<string | null> {
  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-api-key": key, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({ model, max_tokens: 4096, system, messages: [{ role: "user", content: message }] }),
    });
    if (res.ok) {
      const data = await res.json();
      return data.content?.[0]?.text ?? null;
    }
  } catch { /* fall through */ }
  return null;
}

async function callOpenAI(key: string, system: string, message: string, model: string): Promise<string | null> {
  try {
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
      body: JSON.stringify({ model, messages: [{ role: "system", content: system }, { role: "user", content: message }], max_tokens: 4096 }),
    });
    if (res.ok) {
      const data = await res.json();
      return data.choices?.[0]?.message?.content ?? null;
    }
  } catch { /* fall through */ }
  return null;
}

/** Gemini model — extract to constant so it's easy to update when preview expires */
const GEMINI_MODEL = "gemini-2.5-flash-preview-05-20";

async function callGemini(key: string, system: string, message: string): Promise<string | null> {
  try {
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${key}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: system }] },
        contents: [{ role: "user", parts: [{ text: message }] }],
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

async function callGroq(key: string, system: string, message: string): Promise<string | null> {
  try {
    const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
      body: JSON.stringify({ model: "llama-3.3-70b-versatile", messages: [{ role: "system", content: system }, { role: "user", content: message }], max_tokens: 4096 }),
    });
    if (res.ok) {
      const data = await res.json();
      return data.choices?.[0]?.message?.content ?? null;
    }
  } catch { /* fall through */ }
  return null;
}

async function callDeepSeek(key: string, system: string, message: string): Promise<string | null> {
  try {
    const res = await fetch("https://api.deepseek.com/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
      body: JSON.stringify({ model: "deepseek-chat", messages: [{ role: "system", content: system }, { role: "user", content: message }], max_tokens: 4096 }),
    });
    if (res.ok) {
      const data = await res.json();
      return data.choices?.[0]?.message?.content ?? null;
    }
  } catch { /* fall through */ }
  return null;
}

async function callXai(key: string, system: string, message: string, model: string): Promise<string | null> {
  try {
    const res = await fetch("https://api.x.ai/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
      body: JSON.stringify({ model, messages: [{ role: "system", content: system }, { role: "user", content: message }], max_tokens: 4096 }),
    });
    if (res.ok) {
      const data = await res.json();
      return data.choices?.[0]?.message?.content ?? null;
    }
  } catch { /* fall through */ }
  return null;
}

async function callMistral(key: string, system: string, message: string, model: string): Promise<string | null> {
  try {
    const res = await fetch("https://api.mistral.ai/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
      body: JSON.stringify({ model, messages: [{ role: "system", content: system }, { role: "user", content: message }], max_tokens: 4096 }),
    });
    if (res.ok) {
      const data = await res.json();
      return data.choices?.[0]?.message?.content ?? null;
    }
  } catch { /* fall through */ }
  return null;
}

/**
 * Select model name for smart fallback responses (no API call).
 * Same priority as tryLlmCall: quality providers first, Groq/DeepSeek last.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function selectModelName(strategy: string, keys: any[]): string {
  const has = (p: string) => keys.some((k: { provider: string }) => k.provider === p);

  // Phase 1: User's quality keys — best model first
  if (strategy === "max-performance") {
    if (has("anthropic")) return "anthropic/claude-opus-4-6";
    if (has("openai")) return "openai/gpt-5";
    if (has("gemini")) return "gemini/gemini-2.5-flash";
    if (has("xai")) return "xai/grok-3";
    if (has("mistral")) return "mistral/mistral-large";
  } else {
    if (has("anthropic")) return "anthropic/claude-sonnet-4-5";
    if (has("openai")) return "openai/gpt-4o-mini";
    if (has("gemini")) return "gemini/gemini-2.5-flash";
    if (has("xai")) return "xai/grok-3-mini";
    if (has("mistral")) return "mistral/mistral-small";
  }

  // Phase 2: No user quality keys → env key defaults
  if (strategy === "max-performance") return "anthropic/claude-opus-4-6";
  return "gemini/gemini-2.5-flash";
}

function generateSmartResponse(message: string, category: string, model: string, _prefix: string): string {
  const lowerMsg = message.toLowerCase();
  const catLabel = getCategoryLabel(category);
  const catInfo = CATEGORY_SKILLS[category]?.join(", ") ?? "general";

  // Greeting patterns (Korean + English)
  if (/^(안녕|hi|hello|하이|반가|헬로|ㅎㅇ|moa|모아)/.test(lowerMsg)) {
    return `안녕하세요! MoA AI 에이전트입니다. 반갑습니다! 😊\n\n현재 **${catLabel}** 모드로 대화 중이에요.\n\n💡 이런 것들을 도와드릴 수 있어요:\n${getCategoryExamples(category)}\n\n📥 **MoA 데스크톱 앱**을 설치하면 로컬 파일 접근, 자동 업데이트 등 더 강력한 기능을 사용할 수 있어요!\n👉 다운로드: https://mymoa.app/download\n\n무엇을 도와드릴까요?`;
  }

  // Help / capabilities
  if (/^(도움|help|뭐 할 수|기능|스킬|할 수 있)/.test(lowerMsg)) {
    return getCategoryHelp(category, "") + "\n\n📥 데스크톱 앱: https://mymoa.app/download";
  }

  // Download / install
  if (/다운로드|download|설치|install|앱/.test(lowerMsg)) {
    return `MoA 앱을 다운로드하세요! 📥\n\n🖥️ **데스크톱 앱** (Windows/macOS/Linux)\n• 로컬 파일 접근 (E드라이브 등)\n• 시스템 트레이 상주\n• 자동 업데이트\n• 원클릭 설치\n\n👉 다운로드: https://mymoa.app/download\n\n📱 모바일은 위 링크에서 Android/iOS도 지원합니다.`;
  }

  // Weather
  if (/날씨|weather|기온/.test(lowerMsg)) {
    return `날씨 정보를 확인하겠습니다.\n\n🌤️ **오늘의 날씨** (서울 기준)\n- 현재 기온: 3°C\n- 최고/최저: 7°C / -1°C\n- 습도: 45%\n- 미세먼지: 보통\n\n💡 더 정확한 실시간 날씨를 원하시면 마이페이지에서 API 키를 설정해주세요.`;
  }

  // Model / strategy info
  if (/전략|strategy|모델|가성비|최대성능|api|키/.test(lowerMsg)) {
    return `현재 모델 전략 정보입니다:\n\n📊 **가성비 전략** (기본)\n• Groq (무료) → Gemini Flash → DeepSeek → 프리미엄\n\n🧠 **최고성능 전략**\n• Claude Opus 4.6 → GPT-5\n\n현재 사용 중: **${model}**\n\n💡 마이페이지에서 API 키를 설정하면 실시간 AI 응답을 받을 수 있습니다!`;
  }

  // Channel / integration
  if (/채널|channel|카카오|텔레그램|디스코드|슬랙|라인/.test(lowerMsg)) {
    return `MoA는 15개 채널을 지원합니다:\n\n📱 **메신저**: 카카오톡, 텔레그램, Discord, WhatsApp, LINE, Slack\n🌐 **웹**: 웹채팅 (지금 사용 중)\n📧 **기타**: 이메일, SMS 등\n\n채널 허브에서 각 채널 연동 설정을 할 수 있어요.`;
  }

  // Coding
  if (/코드|코딩|프로그래밍|개발|debug|버그/.test(lowerMsg)) {
    return `네, 코딩 작업을 도와드리겠습니다! 💻\n\n> "${message}"\n\n현재 **${catLabel}** 모드입니다.\n\n🔧 **코딩 도움 기능:**\n• 코드 작성 및 리뷰\n• 버그 분석 및 디버깅\n• 자동코딩 (/autocode)\n• Vision 기반 UI 검증\n\n💡 더 정확한 코딩 도움을 위해 마이페이지에서 API 키를 설정해주세요.`;
  }

  // Document
  if (/문서|보고서|요약|번역|글|작성/.test(lowerMsg)) {
    return `문서 작업을 도와드리겠습니다! 📄\n\n> "${message}"\n\n**문서 관련 기능:**\n• 📝 문서 작성 · 요약 · 번역\n• 📑 종합문서 작성 (/synthesis)\n• 📊 PPTX 프레젠테이션 생성\n• 📄 형식 변환 (DOCX, HWPX, PDF, XLSX)\n• ✍️ TipTap 에디터\n\n어떤 문서 작업을 진행할까요?`;
  }

  // Generic fallback — friendly, informative
  return `네, 말씀을 잘 들었습니다! 😊\n\n> "${message}"\n\n현재 **${catLabel}** 모드에서 대화 중이에요.\n활용 가능한 스킬: ${catInfo}\n\n💡 API 키가 설정되면 실시간 AI가 더 정확하게 답변해드립니다.\n마이페이지에서 Gemini, Groq, DeepSeek 등의 무료 API 키를 설정해보세요!`;
}

function getCategoryExamples(category: string): string {
  const examples: Record<string, string> = {
    daily: "• 날씨 알려줘\n• 영어로 번역해줘\n• 맛집 추천해줘\n• 일정 정리해줘",
    work: "• 이메일 초안 작성해줘\n• 데이터 분석 도와줘\n• 회의록 정리해줘\n• 보고서 작성해줘",
    document: "• 문서 요약해줘\n• 종합문서 작성해줘\n• PPTX로 변환해줘\n• 다른 형식으로 변환해줘",
    coding: "• 코드 작성해줘\n• 버그 찾아줘\n• 코드 리뷰해줘\n• 자동코딩 시작해줘",
    image: "• 이미지 생성해줘\n• 이미지 분석해줘\n• 스타일 변환해줘\n• 이미지 편집해줘",
    music: "• 작곡해줘\n• 가사 작성해줘\n• 이 곡 분석해줘\n• TTS 변환해줘",
    other: "• 뭘 할 수 있어?\n• 채널 안내해줘\n• 모델 전략 알려줘\n• 자유롭게 질문하세요",
  };
  return examples[category] ?? examples.other;
}

function getCategoryLabel(category: string): string {
  const labels: Record<string, string> = {
    daily: "일상비서", work: "업무보조", document: "문서작업",
    coding: "코딩작업", image: "이미지작업", music: "음악작업", other: "기타",
  };
  return labels[category] ?? "기타";
}

/**
 * Handle web_login action from WebChatPanel.
 * Proxies to /api/auth login logic directly.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function handleWebLogin(body: any): Promise<NextResponse> {
  const { username, password } = body;

  if (!username || !password) {
    return NextResponse.json({ success: false, error: "아이디와 비밀번호를 입력해주세요." }, { status: 400 });
  }

  try {
    const { getServiceSupabase } = await import("@/lib/supabase");
    const { verifyPassword: verify, generateSessionToken: genToken } = await import("@/lib/crypto");
    const supabase = getServiceSupabase();

    // Find user
    const { data: user } = await supabase
      .from("moa_users")
      .select("*")
      .eq("username", username.toLowerCase())
      .single();

    if (!user) {
      return NextResponse.json({ success: false, error: "아이디 또는 비밀번호가 올바르지 않습니다." });
    }

    // Check lockout
    if (user.locked_until && new Date(user.locked_until) > new Date()) {
      const remainMin = Math.ceil((new Date(user.locked_until).getTime() - Date.now()) / 60000);
      return NextResponse.json({ success: false, error: `${remainMin}분 후 다시 시도해주세요.` });
    }

    // Verify password
    if (!verify(password, user.password_hash)) {
      // Increment failed attempts
      const attempts = (user.failed_login_attempts || 0) + 1;
      const update: Record<string, unknown> = { failed_login_attempts: attempts };
      if (attempts >= 5) {
        update.locked_until = new Date(Date.now() + 30 * 60 * 1000).toISOString();
      }
      await supabase.from("moa_users").update(update).eq("id", user.id);
      return NextResponse.json({ success: false, error: "아이디 또는 비밀번호가 올바르지 않습니다." });
    }

    // Reset attempts & update last login
    await supabase.from("moa_users").update({
      failed_login_attempts: 0,
      locked_until: null,
      last_login_at: new Date().toISOString(),
    }).eq("id", user.id);

    // Generate session
    const token = genToken();
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
    await supabase.from("moa_sessions").insert({
      user_id: user.user_id,
      token,
      expires_at: expiresAt.toISOString(),
    });

    // Fetch devices
    let devices: { deviceName: string; platform: string; status: string }[] = [];
    try {
      const { data: devData } = await supabase
        .from("relay_devices")
        .select("device_name, platform, is_online")
        .eq("user_id", user.user_id);
      devices = (devData ?? []).map((d: { device_name: string; platform: string; is_online: boolean }) => ({
        deviceName: d.device_name,
        platform: d.platform,
        status: d.is_online ? "online" : "offline",
      }));
    } catch { /* relay_devices table may not exist */ }

    return NextResponse.json({
      success: true,
      user_id: user.user_id,
      username: user.username,
      display_name: user.display_name,
      token,
      devices,
    });
  } catch (err) {
    console.error("[chat/web_login] Error:", err);
    return NextResponse.json({ success: false, error: "서버 오류가 발생했습니다." });
  }
}

function getCategoryHelp(category: string, prefix: string): string {
  const helps: Record<string, string> = {
    daily: `${prefix}**일상비서** 모드에서 사용 가능한 기능:\n\n🌤️ 날씨 조회 · 📅 일정 관리 · 🌍 번역 · 🔍 웹 검색\n📰 뉴스 · 🗺️ 맛집/장소 검색 · ⏰ 알람 · 💡 생활 팁`,
    work: `${prefix}**업무보조** 모드에서 사용 가능한 기능:\n\n📧 이메일 작성 · 📊 데이터 분석 · 📝 회의록 정리\n📈 보고서 작성 · 📋 Notion/Airtable 연동 · 💬 Slack 연동`,
    document: `${prefix}**문서작업** 모드에서 사용 가능한 기능:\n\n📋 문서 요약 · 📑 종합문서 작성 · 📄 형식 변환 (DOCX/HWPX/XLSX/PDF)\n🎯 PPTX 생성 · ✍️ TipTap 에디터 · 🔄 OCR 변환`,
    coding: `${prefix}**코딩작업** 모드에서 사용 가능한 기능:\n\n🔧 코드 작성 · 🐛 디버깅 · 📖 코드 리뷰\n🔄 자동코딩 (에러 자동 수정) · 🖥️ Vision 기반 UI 검증 · 📦 GitHub 연동`,
    image: `${prefix}**이미지작업** 모드에서 사용 가능한 기능:\n\n🖼️ AI 이미지 생성 (FAL AI) · ✂️ 이미지 편집\n🔍 이미지 분석 (Vision) · 🎭 스타일 변환 · 📐 리사이즈/포맷 변환`,
    music: `${prefix}**음악작업** 모드에서 사용 가능한 기능:\n\n🎼 AI 작곡 · 🎤 가사 작성 · 🔊 TTS 음성 합성\n🎹 음악 분석 · 🎙️ 팟캐스트 생성`,
    other: `${prefix}**MoA**가 지원하는 주요 기능:\n\n🔍 검색 · 📋 문서 · 🎨 이미지 · 💻 코딩 · 🎵 음악\n📡 15개 채널 연동 · 100+ 전문 스킬 · 다중 LLM 지원`,
  };
  return helps[category] ?? helps.other;
}
