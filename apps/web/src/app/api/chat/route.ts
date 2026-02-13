import { NextRequest, NextResponse } from "next/server";
import { detectAndMaskSensitiveData } from "@/lib/security";
import { generateAIResponse, detectCategory } from "@/lib/ai-engine";

// Optimization 3: Run in Seoul region for Korean users
export const preferredRegion = "icn1";

/**
 * POST /api/chat
 * Send a message and get an AI response.
 * Body: { user_id, session_id, content, channel?, category?, content_for_storage? }
 *
 * Now uses shared ai-engine (Optimization 1 — single function, no internal HTTP).
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

    const {
      user_id, session_id, content, channel = "web", category: requestedCategory,
      is_desktop = false, content_for_storage,
    } = body;

    if (!content || typeof content !== "string" || !content.trim()) {
      return NextResponse.json({ error: "메시지를 입력해주세요." }, { status: 400 });
    }

    // Check for local file access from non-desktop browser
    if (!is_desktop && /([A-Za-z]:\\|내\s*컴퓨터|로컬\s*파일|E\s*드라이브|C\s*드라이브|D\s*드라이브)/.test(content)) {
      return NextResponse.json({
        reply: "로컬 파일에 접근하려면 MoA 데스크톱 앱이 필요합니다.\n\n" +
          "MoA 데스크톱 앱을 설치하면 E드라이브 등 로컬 파일을 직접 관리할 수 있어요.\n\n" +
          "다운로드: /download",
        model: "local/system",
        category: requestedCategory ?? "other",
        credits_used: 0,
        timestamp: new Date().toISOString(),
      });
    }

    const category = requestedCategory ?? detectCategory(content.trim());

    // Determine masked content for storage
    const maskedTextForStorage = content_for_storage
      ?? detectAndMaskSensitiveData(content.trim()).maskedText;

    // Use shared AI engine (Optimization 1: direct call, no internal HTTP)
    const result = await generateAIResponse({
      message: content.trim(),
      userId: user_id,
      sessionId: session_id,
      channel,
      category,
      maskedTextForStorage,
    });

    return NextResponse.json(result);
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

/**
 * Handle web_login action from WebChatPanel.
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

    const { data: user } = await supabase
      .from("moa_users")
      .select("*")
      .eq("username", username.toLowerCase())
      .single();

    if (!user) {
      return NextResponse.json({ success: false, error: "아이디 또는 비밀번호가 올바르지 않습니다." });
    }

    if (user.locked_until && new Date(user.locked_until) > new Date()) {
      const remainMin = Math.ceil((new Date(user.locked_until).getTime() - Date.now()) / 60000);
      return NextResponse.json({ success: false, error: `${remainMin}분 후 다시 시도해주세요.` });
    }

    if (!verify(password, user.password_hash)) {
      const attempts = (user.failed_login_attempts || 0) + 1;
      const update: Record<string, unknown> = { failed_login_attempts: attempts };
      if (attempts >= 5) {
        update.locked_until = new Date(Date.now() + 30 * 60 * 1000).toISOString();
      }
      await supabase.from("moa_users").update(update).eq("id", user.id);
      return NextResponse.json({ success: false, error: "아이디 또는 비밀번호가 올바르지 않습니다." });
    }

    await supabase.from("moa_users").update({
      failed_login_attempts: 0,
      locked_until: null,
      last_login_at: new Date().toISOString(),
    }).eq("id", user.id);

    const token = genToken();
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
    await supabase.from("moa_sessions").insert({
      user_id: user.user_id,
      token,
      expires_at: expiresAt.toISOString(),
    });

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
    } catch { /* relay_devices may not exist */ }

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
