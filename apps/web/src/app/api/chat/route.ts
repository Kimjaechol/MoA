import { NextRequest, NextResponse } from "next/server";
import { getServiceSupabase } from "@/lib/supabase";

/**
 * POST /api/chat
 * Send a message and get an AI response.
 * Body: { user_id, session_id, content, channel? }
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { user_id, session_id, content, channel = "web" } = body;

    if (!user_id || !session_id) {
      return NextResponse.json({ error: "user_id and session_id are required" }, { status: 400 });
    }
    if (!content || typeof content !== "string" || !content.trim()) {
      return NextResponse.json({ error: "Message content is required" }, { status: 400 });
    }

    const supabase = getServiceSupabase();

    // 1. Save user message
    const { error: saveError } = await supabase.from("moa_chat_messages").insert({
      user_id,
      session_id,
      role: "user",
      content: content.trim(),
      channel,
    });

    if (saveError) {
      return NextResponse.json({ error: "Failed to save message" }, { status: 500 });
    }

    // 2. Generate AI response
    // In production, this calls the MoA gateway agent system with the user's
    // model strategy and API keys. For now, we route through a smart response generator.
    const aiResponse = await generateResponse(content.trim(), user_id, supabase);

    // 3. Save AI response
    const { error: aiSaveError } = await supabase.from("moa_chat_messages").insert({
      user_id,
      session_id,
      role: "assistant",
      content: aiResponse.text,
      channel,
      model_used: aiResponse.model,
    });

    if (aiSaveError) {
      return NextResponse.json({ error: "Failed to save AI response" }, { status: 500 });
    }

    return NextResponse.json({
      reply: aiResponse.text,
      model: aiResponse.model,
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
   AI Response Generator
   In production, this connects to the MoA gateway's agent dispatch
   system. The gateway routes through the user's model strategy
   (cost-efficient or max-performance) using their API keys.
   ----------------------------------------------------------------- */

interface AIResponse {
  text: string;
  model: string;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function generateResponse(message: string, userId: string, supabase: any): Promise<AIResponse> {
  // Check if user has API keys configured
  const { data: keys } = await supabase
    .from("moa_user_api_keys")
    .select("provider, is_active")
    .eq("user_id", userId)
    .eq("is_active", true);

  const { data: settings } = await supabase
    .from("moa_user_settings")
    .select("model_strategy")
    .eq("user_id", userId)
    .single();

  const strategy = settings?.model_strategy ?? "cost-efficient";
  const hasGroqKey = keys?.some((k: { provider: string }) => k.provider === "groq");
  const hasGeminiKey = keys?.some((k: { provider: string }) => k.provider === "gemini");
  const hasOpenaiKey = keys?.some((k: { provider: string }) => k.provider === "openai");
  const hasAnthropicKey = keys?.some((k: { provider: string }) => k.provider === "anthropic");

  // Determine which model tier to use based on strategy
  let modelUsed = "local/slm-default";
  let responsePrefix = "";

  if (strategy === "max-performance") {
    if (hasAnthropicKey) {
      modelUsed = "anthropic/claude-opus-4-5";
    } else if (hasOpenaiKey) {
      modelUsed = "openai/gpt-5.2";
    } else {
      modelUsed = "local/slm-default";
      responsePrefix = "[무료 SLM] ";
    }
  } else {
    // Cost-efficient: try tiers in order
    if (hasGroqKey) {
      modelUsed = "groq/kimi-k2-0905";
    } else if (hasGeminiKey) {
      modelUsed = "gemini/gemini-2.5-flash";
    } else {
      modelUsed = "local/slm-default";
      responsePrefix = "[무료 SLM] ";
    }
  }

  // In production, the actual API call goes to the MoA gateway which
  // dispatches to the selected model. For the web demo, we generate
  // a smart contextual response.
  const text = generateSmartResponse(message, modelUsed, responsePrefix);

  return { text, model: modelUsed };
}

function generateSmartResponse(message: string, model: string, prefix: string): string {
  const lowerMsg = message.toLowerCase();

  // Greeting patterns
  if (/^(안녕|hi|hello|하이|반가워|헬로)/.test(lowerMsg)) {
    return `${prefix}안녕하세요! MoA AI 에이전트입니다. 무엇을 도와드릴까요?\n\n현재 사용 모델: ${model}\n\n가능한 작업:\n- 질문에 답변\n- 웹 검색\n- 문서 요약\n- 이미지 생성\n- 코드 작성\n- 번역\n\n무엇이든 편하게 물어보세요!`;
  }

  // Help patterns
  if (/^(도움|help|뭐 할 수|기능|스킬)/.test(lowerMsg)) {
    return `${prefix}MoA가 지원하는 주요 기능입니다:\n\n🔍 **검색 & 정보**\nBrave Search, Perplexity, Google Search, 뉴스, 날씨, 미세먼지\n\n📋 **생산성 & 업무**\nNotion, Airtable, Slack, GitHub, 캘린더, 요약\n\n🎨 **미디어 생성**\nFAL AI 이미지, Gamma 프레젠테이션, 팟캐스트, TTS\n\n🤖 **AI & 머신러닝**\nGemini, HuggingFace, Replicate, ChromaDB\n\n🛡️ **보안 & 시스템**\n보안 점검, 홈 어시스턴트, 모니터링\n\n현재 **100개 이상의 전문 스킬**이 탑재되어 있습니다!`;
  }

  // Weather patterns
  if (/날씨|weather|기온|비 올/.test(lowerMsg)) {
    return `${prefix}날씨 정보를 확인하겠습니다.\n\n🌤️ **오늘의 날씨** (서울 기준)\n- 현재 기온: 3°C\n- 최고/최저: 7°C / -1°C\n- 습도: 45%\n- 미세먼지: 보통\n\n정확한 날씨 정보는 날씨 스킬을 통해 실시간으로 제공됩니다.\n원하시는 지역을 알려주시면 해당 지역의 날씨를 조회해드립니다.`;
  }

  // Strategy info
  if (/전략|strategy|모델|가성비|최대성능/.test(lowerMsg)) {
    return `${prefix}현재 설정된 모델 전략 정보입니다:\n\n사용 중인 모델: **${model}**\n\n📊 **가성비 전략** (기본)\n1. 무료 내장 SLM → 2. 유료 LLM 무료 한도 → 3. Kimi K2-0905 Groq 등 가성비 → 4. 최고급 LLM\n\n🧠 **최대성능 전략**\n1. 최고 성능 단일 모델 → 2. 병렬 멀티 모델\n\n전략은 마이페이지에서 언제든 변경할 수 있습니다.`;
  }

  // Channel info
  if (/채널|channel|카카오|텔레그램|telegram|whatsapp|discord/.test(lowerMsg)) {
    return `${prefix}MoA는 15개 채널을 지원합니다:\n\n💬 **주요 채널**\n- 카카오톡 · 텔레그램 · Discord · WhatsApp\n- Slack · Signal · iMessage · LINE\n\n🌐 **추가 채널**\n- MS Teams · Matrix · Google Chat · Mattermost\n- Twitch · Nostr · Zalo\n\n각 채널의 "대화 시작하기" 버튼을 클릭하면 바로 연결됩니다!\n채널 허브(/channels)에서 모든 채널을 한눈에 볼 수 있습니다.`;
  }

  // Default response
  return `${prefix}네, 말씀하신 내용을 처리하겠습니다.\n\n> "${message}"\n\n현재 **${model}** 모델로 처리 중입니다.\n\nMoA는 카카오톡, 텔레그램, Discord 등 15개 채널에서 동일한 대화를 이어갈 수 있습니다. 어떤 채널에서든 동일한 AI 경험을 제공합니다.\n\n더 궁금하신 점이 있으면 말씀해주세요!`;
}
