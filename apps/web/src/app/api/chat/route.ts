import { NextRequest, NextResponse } from "next/server";

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
 * GET /api/chat?user_id=xxx&session_id=yyy
 * Fetch chat history for a session.
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const userId = searchParams.get("user_id");
    const sessionId = searchParams.get("session_id");
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

  // Get or initialize credits
  let { data: credits } = await supabase
    .from("moa_credits")
    .select("balance, monthly_used")
    .eq("user_id", userId)
    .single();

  if (!credits) {
    await supabase.from("moa_credits").insert({
      user_id: userId, balance: 100, monthly_quota: 100, monthly_used: 0, plan: "free",
      quota_reset_at: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
    });
    credits = { balance: 100, monthly_used: 0 };
  }

  // Allow usage even if balance is low (don't block chat)
  const newBalance = Math.max(0, credits.balance - cost);
  const newUsed = (credits.monthly_used ?? 0) + cost;

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

[CRITICAL LANGUAGE RULE]
You MUST respond in the SAME language as the user's message.
- If the user writes in Korean, respond ONLY in Korean. Never mix Japanese, Chinese, or any other language.
- If the user writes in Japanese, respond ONLY in Japanese.
- If the user writes in English, respond ONLY in English.
- If the user writes in Chinese, respond ONLY in Chinese.
- If the user explicitly requests a different language (e.g. "영어로 답해줘"), follow that instruction.
- English technical terms (API, URL, code snippets) are acceptable in any language.
- ABSOLUTELY DO NOT mix different Asian languages. For example, never use Japanese words (ありません, ちょっと, etc.) in a Korean response. This is strictly forbidden.
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
 * Attempt real LLM API call.
 * Priority: user's own keys (1x credit) > MoA server keys (2x credit).
 * Returns usedEnvKey=true when MoA's server-level API key was used.
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
  const envGroqKey = process.env.GROQ_API_KEY;
  const envDeepseekKey = process.env.DEEPSEEK_API_KEY;

  // User-provided keys (stored in DB → 1x credit)
  const userAnthropicKey = keys.find((k: { provider: string }) => k.provider === "anthropic")?.encrypted_key;
  const userOpenaiKey = keys.find((k: { provider: string }) => k.provider === "openai")?.encrypted_key;
  const userGeminiKey = keys.find((k: { provider: string }) => k.provider === "gemini")?.encrypted_key;
  const userGroqKey = keys.find((k: { provider: string }) => k.provider === "groq")?.encrypted_key;
  const userDeepseekKey = keys.find((k: { provider: string }) => k.provider === "deepseek")?.encrypted_key;

  // Helper: pick user key first (1x), fallback to env key (2x)
  const pickKey = (userKey?: string, envKey?: string): { key: string; isEnv: boolean } | null => {
    if (userKey) return { key: userKey, isEnv: false };
    if (envKey) return { key: envKey, isEnv: true };
    return null;
  };

  // Max-performance: use the best model available
  if (strategy === "max-performance") {
    const anthropicInfo = pickKey(userAnthropicKey, envAnthropicKey);
    if (anthropicInfo) {
      const result = await callAnthropic(anthropicInfo.key, enrichedSystem, message, "claude-opus-4-6");
      if (result) return { text: result, model: "anthropic/claude-opus-4-6", usedEnvKey: anthropicInfo.isEnv };
    }
    const openaiInfo = pickKey(userOpenaiKey, envOpenaiKey);
    if (openaiInfo) {
      const result = await callOpenAI(openaiInfo.key, enrichedSystem, message, "gpt-5");
      if (result) return { text: result, model: "openai/gpt-5", usedEnvKey: openaiInfo.isEnv };
    }
  }

  // Cost-efficient: try cheaper models first
  const groqInfo = pickKey(userGroqKey, envGroqKey);
  if (groqInfo) {
    const result = await callGroq(groqInfo.key, enrichedSystem, message);
    if (result) return { text: result, model: "groq/llama-3.3-70b-versatile", usedEnvKey: groqInfo.isEnv };
  }

  const geminiInfo = pickKey(userGeminiKey, envGeminiKey);
  if (geminiInfo) {
    const result = await callGemini(geminiInfo.key, enrichedSystem, message);
    if (result) return { text: result, model: "gemini/gemini-2.5-flash", usedEnvKey: geminiInfo.isEnv };
  }

  const deepseekInfo = pickKey(userDeepseekKey, envDeepseekKey);
  if (deepseekInfo) {
    const result = await callDeepSeek(deepseekInfo.key, enrichedSystem, message);
    if (result) return { text: result, model: "deepseek/deepseek-chat", usedEnvKey: deepseekInfo.isEnv };
  }

  // Fallback: try remaining env keys for OpenAI/Anthropic in cost-efficient mode
  if (strategy !== "max-performance") {
    const openaiInfo = pickKey(userOpenaiKey, envOpenaiKey);
    if (openaiInfo) {
      const result = await callOpenAI(openaiInfo.key, enrichedSystem, message, "gpt-4o-mini");
      if (result) return { text: result, model: "openai/gpt-4o-mini", usedEnvKey: openaiInfo.isEnv };
    }
    const anthropicInfo = pickKey(userAnthropicKey, envAnthropicKey);
    if (anthropicInfo) {
      const result = await callAnthropic(anthropicInfo.key, enrichedSystem, message, "claude-haiku-4-5");
      if (result) return { text: result, model: "anthropic/claude-haiku-4-5", usedEnvKey: anthropicInfo.isEnv };
    }
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

async function callGemini(key: string, system: string, message: string): Promise<string | null> {
  try {
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${key}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ contents: [{ parts: [{ text: `${system}\n\n${message}` }] }], generationConfig: { maxOutputTokens: 4096 } }),
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

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function selectModelName(strategy: string, keys: any[]): string {
  if (strategy === "max-performance") {
    if (keys.some((k: { provider: string }) => k.provider === "anthropic")) return "anthropic/claude-opus-4-6";
    if (keys.some((k: { provider: string }) => k.provider === "openai")) return "openai/gpt-5";
  }
  if (keys.some((k: { provider: string }) => k.provider === "groq")) return "groq/llama-3.3-70b-versatile";
  if (keys.some((k: { provider: string }) => k.provider === "gemini")) return "gemini/gemini-2.5-flash";
  if (keys.some((k: { provider: string }) => k.provider === "deepseek")) return "deepseek/deepseek-chat";
  return "local/slm-default";
}

function generateSmartResponse(message: string, category: string, model: string, _prefix: string): string {
  const lowerMsg = message.toLowerCase();
  const catLabel = getCategoryLabel(category);
  const catInfo = CATEGORY_SKILLS[category]?.join(", ") ?? "general";

  // Greeting patterns (Korean + English)
  if (/^(안녕|hi|hello|하이|반가|헬로|ㅎㅇ|moa|모아)/.test(lowerMsg)) {
    return `안녕하세요! MoA AI 에이전트입니다. 반갑습니다! 😊\n\n현재 **${catLabel}** 모드로 대화 중이에요.\n\n💡 이런 것들을 도와드릴 수 있어요:\n${getCategoryExamples(category)}\n\n무엇을 도와드릴까요?`;
  }

  // Help / capabilities
  if (/^(도움|help|뭐 할 수|기능|스킬|할 수 있)/.test(lowerMsg)) {
    return getCategoryHelp(category, "");
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
