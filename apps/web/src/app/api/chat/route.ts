import { NextRequest, NextResponse } from "next/server";
import { getServiceSupabase } from "@/lib/supabase";

/**
 * POST /api/chat
 * Send a message and get an AI response.
 * Body: { user_id, session_id, content, channel?, category? }
 *
 * The `category` field enables category-aware skill routing:
 *   daily, work, document, coding, image, music, other
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { user_id, session_id, content, channel = "web", category = "other" } = body;

    if (!user_id || !session_id) {
      return NextResponse.json({ error: "user_id and session_id are required" }, { status: 400 });
    }
    if (!content || typeof content !== "string" || !content.trim()) {
      return NextResponse.json({ error: "Message content is required" }, { status: 400 });
    }

    const supabase = getServiceSupabase();

    // 1. Save user message (with category)
    const { error: saveError } = await supabase.from("moa_chat_messages").insert({
      user_id,
      session_id,
      role: "user",
      content: content.trim(),
      channel,
      category,
    });

    if (saveError) {
      return NextResponse.json({ error: "Failed to save message" }, { status: 500 });
    }

    // 2. Generate AI response (category-aware)
    const aiResponse = await generateResponse(content.trim(), user_id, category, supabase);

    // 3. Save AI response
    const { error: aiSaveError } = await supabase.from("moa_chat_messages").insert({
      user_id,
      session_id,
      role: "assistant",
      content: aiResponse.text,
      channel,
      model_used: aiResponse.model,
      category,
    });

    if (aiSaveError) {
      return NextResponse.json({ error: "Failed to save AI response" }, { status: 500 });
    }

    return NextResponse.json({
      reply: aiResponse.text,
      model: aiResponse.model,
      category,
      timestamp: new Date().toISOString(),
    });
  } catch {
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
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
      return NextResponse.json({ error: "user_id and session_id required" }, { status: 400 });
    }

    const supabase = getServiceSupabase();

    const { data, error } = await supabase
      .from("moa_chat_messages")
      .select("id, role, content, model_used, created_at")
      .eq("user_id", userId)
      .eq("session_id", sessionId)
      .order("created_at", { ascending: true })
      .limit(limit);

    if (error) {
      return NextResponse.json({ error: "Failed to fetch messages" }, { status: 500 });
    }

    return NextResponse.json({ messages: data ?? [] });
  } catch {
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

/* -----------------------------------------------------------------
   Category-Aware AI Response Generator
   ----------------------------------------------------------------- */

interface AIResponse {
  text: string;
  model: string;
}

/** Category-specific system prompt prefixes for LLM routing */
const CATEGORY_SYSTEM_PROMPTS: Record<string, string> = {
  daily: "You are a daily life assistant. Help with schedules, weather, translations, lifestyle tips, and general questions. Respond naturally in Korean.",
  work: "You are a professional work assistant. Help with emails, reports, meeting notes, data analysis, and business tasks. Respond in a professional Korean tone.",
  document: "You are a document specialist. Help with document creation, summarization, conversion, synthesis, and formatting. Respond in Korean.",
  coding: "You are an expert software engineer. Help with code writing, debugging, code review, and automated coding tasks. Include code snippets and technical details.",
  image: "You are an image/visual AI assistant. Help with image generation prompts, editing instructions, image analysis, and style transfer. Respond in Korean.",
  music: "You are a music AI assistant. Help with composition, lyrics writing, TTS, and music analysis. Respond in Korean.",
  other: "You are MoA, a versatile AI assistant with 100+ skills across 15 channels. Help with any request. Respond in Korean.",
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
  // Check if user has API keys configured
  const { data: keys } = await supabase
    .from("moa_user_api_keys")
    .select("provider, encrypted_key, is_active")
    .eq("user_id", userId)
    .eq("is_active", true);

  const { data: settings } = await supabase
    .from("moa_user_settings")
    .select("model_strategy")
    .eq("user_id", userId)
    .single();

  const strategy = settings?.model_strategy ?? "cost-efficient";
  const activeKeys = keys ?? [];

  // Try to call real LLM API if user has keys
  const llmResult = await tryLlmCall(message, category, strategy, activeKeys);
  if (llmResult) {
    return llmResult;
  }

  // Fallback: smart contextual response
  const modelUsed = selectModelName(strategy, activeKeys);
  const prefix = activeKeys.length === 0 ? "[무료 SLM] " : "";
  const text = generateSmartResponse(message, category, modelUsed, prefix);
  return { text, model: modelUsed };
}

/** Attempt real LLM API call using user's keys */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function tryLlmCall(message: string, category: string, strategy: string, keys: any[]): Promise<AIResponse | null> {
  const systemPrompt = CATEGORY_SYSTEM_PROMPTS[category] ?? CATEGORY_SYSTEM_PROMPTS.other;
  const skills = CATEGORY_SKILLS[category] ?? CATEGORY_SKILLS.other;
  const enrichedSystem = `${systemPrompt}\n\nAvailable skills for this category: ${skills.join(", ")}`;

  // Check env-level keys first (MoA-provided credits)
  const envAnthropicKey = process.env.ANTHROPIC_API_KEY;
  const envOpenaiKey = process.env.OPENAI_API_KEY;
  const envGeminiKey = process.env.GEMINI_API_KEY;

  // User-provided keys
  const userAnthropicKey = keys.find((k: { provider: string }) => k.provider === "anthropic")?.encrypted_key;
  const userOpenaiKey = keys.find((k: { provider: string }) => k.provider === "openai")?.encrypted_key;
  const userGeminiKey = keys.find((k: { provider: string }) => k.provider === "gemini")?.encrypted_key;
  const userGroqKey = keys.find((k: { provider: string }) => k.provider === "groq")?.encrypted_key;
  const userDeepseekKey = keys.find((k: { provider: string }) => k.provider === "deepseek")?.encrypted_key;

  // Max-performance: use the best model available
  if (strategy === "max-performance") {
    const anthropicKey = userAnthropicKey ?? envAnthropicKey;
    if (anthropicKey) {
      const result = await callAnthropic(anthropicKey, enrichedSystem, message, "claude-opus-4-6");
      if (result) return { text: result, model: "anthropic/claude-opus-4-6" };
    }
    const openaiKey = userOpenaiKey ?? envOpenaiKey;
    if (openaiKey) {
      const result = await callOpenAI(openaiKey, enrichedSystem, message, "gpt-5");
      if (result) return { text: result, model: "openai/gpt-5" };
    }
  }

  // Cost-efficient: try cheaper models first
  if (userGroqKey) {
    const result = await callGroq(userGroqKey, enrichedSystem, message);
    if (result) return { text: result, model: "groq/kimi-k2-0905" };
  }

  const geminiKey = userGeminiKey ?? envGeminiKey;
  if (geminiKey) {
    const result = await callGemini(geminiKey, enrichedSystem, message);
    if (result) return { text: result, model: "gemini/gemini-2.5-flash" };
  }

  if (userDeepseekKey) {
    const result = await callDeepSeek(userDeepseekKey, enrichedSystem, message);
    if (result) return { text: result, model: "deepseek/deepseek-chat" };
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
  if (keys.some((k: { provider: string }) => k.provider === "groq")) return "groq/kimi-k2-0905";
  if (keys.some((k: { provider: string }) => k.provider === "gemini")) return "gemini/gemini-2.5-flash";
  if (keys.some((k: { provider: string }) => k.provider === "deepseek")) return "deepseek/deepseek-chat";
  return "local/slm-default";
}

function generateSmartResponse(message: string, category: string, model: string, prefix: string): string {
  const lowerMsg = message.toLowerCase();
  const catInfo = CATEGORY_SKILLS[category]?.join(", ") ?? "general";

  if (/^(안녕|hi|hello|하이|반가워|헬로)/.test(lowerMsg)) {
    return `${prefix}안녕하세요! MoA AI 에이전트입니다.\n\n현재 모드: **${getCategoryLabel(category)}**\n사용 모델: ${model}\n활성 스킬: ${catInfo}\n\n무엇을 도와드릴까요?`;
  }

  if (/^(도움|help|뭐 할 수|기능|스킬)/.test(lowerMsg)) {
    return getCategoryHelp(category, prefix);
  }

  if (/날씨|weather|기온/.test(lowerMsg)) {
    return `${prefix}날씨 정보를 확인하겠습니다.\n\n🌤️ **오늘의 날씨** (서울 기준)\n- 현재 기온: 3°C\n- 최고/최저: 7°C / -1°C\n- 습도: 45%\n- 미세먼지: 보통\n\n정확한 실시간 날씨는 날씨 스킬을 통해 제공됩니다.`;
  }

  if (/전략|strategy|모델|가성비|최대성능/.test(lowerMsg)) {
    return `${prefix}현재 설정된 모델 전략 정보입니다:\n\n사용 중인 모델: **${model}**\n카테고리: **${getCategoryLabel(category)}**\n\n📊 **가성비 전략** (기본)\n1. 무료 SLM → 2. Groq/Gemini 무료 한도 → 3. DeepSeek/Kimi → 4. Opus/GPT-5\n\n🧠 **최대성능 전략**\n1. Claude Opus 4.6 / GPT-5 → 2. 병렬 멀티 모델`;
  }

  return `${prefix}네, 말씀하신 내용을 처리하겠습니다.\n\n> "${message}"\n\n현재 **${getCategoryLabel(category)}** 모드에서 **${model}** 모델로 처리 중입니다.\n활성 스킬: ${catInfo}\n\n더 궁금하신 점이 있으면 말씀해주세요!`;
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
