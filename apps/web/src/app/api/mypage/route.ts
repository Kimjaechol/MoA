import { NextRequest, NextResponse } from "next/server";
import { getServiceSupabase } from "@/lib/supabase";
import { encryptAES256 } from "@/lib/crypto";
import {
  sendAlimtalkWithLog,
  hasAlreadySent,
  normalizePhone,
  isValidKoreanMobile,
} from "@/lib/alimtalk";
import { CHANNEL_INVITE_TEMPLATE } from "@/lib/alimtalk-templates";

const VALID_PROVIDERS = ["openai", "anthropic", "gemini", "groq", "deepseek", "mistral", "xai"];
const VALID_STRATEGIES = ["cost-efficient", "max-performance"];

/**
 * GET /api/mypage?user_id=xxx
 * Fetch user's API keys (hints only) and model strategy settings.
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const userId = searchParams.get("user_id");

    if (!userId) {
      return NextResponse.json({ error: "user_id is required" }, { status: 400 });
    }

    const supabase = getServiceSupabase();

    // Fetch API keys (only hints, not actual keys)
    const { data: keys, error: keysError } = await supabase
      .from("moa_user_api_keys")
      .select("id, provider, key_hint, is_active, created_at, updated_at")
      .eq("user_id", userId)
      .order("provider", { ascending: true });

    if (keysError) {
      return NextResponse.json({ error: "Failed to fetch API keys" }, { status: 500 });
    }

    // Fetch user settings
    const { data: settings, error: settingsError } = await supabase
      .from("moa_user_settings")
      .select("*")
      .eq("user_id", userId)
      .single();

    if (settingsError && settingsError.code !== "PGRST116") {
      return NextResponse.json({ error: "Failed to fetch settings" }, { status: 500 });
    }

    // Calculate trial status
    let trialStatus = null;
    if (settings) {
      const trialEnd = new Date(settings.trial_started_at);
      trialEnd.setDate(trialEnd.getDate() + settings.trial_days);
      const now = new Date();
      const daysLeft = Math.max(0, Math.ceil((trialEnd.getTime() - now.getTime()) / (1000 * 60 * 60 * 24)));
      trialStatus = {
        isTrialActive: daysLeft > 0,
        daysLeft,
        isPremium: settings.is_premium,
      };
    }

    // Mask phone number for display
    const maskedPhone = settings?.phone
      ? settings.phone.slice(0, 3) + "-****-" + settings.phone.slice(-4)
      : null;

    return NextResponse.json({
      apiKeys: keys ?? [],
      settings: settings ?? { model_strategy: "cost-efficient" },
      trialStatus,
      phone: maskedPhone,
      kakaoChannelAdded: settings?.kakao_channel_added ?? false,
    });
  } catch {
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

/**
 * POST /api/mypage
 * Actions: save_api_key, delete_api_key, update_strategy, init_user, update_phone
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { action, user_id } = body;

    if (!user_id || typeof user_id !== "string") {
      return NextResponse.json({ error: "user_id is required" }, { status: 400 });
    }

    const supabase = getServiceSupabase();

    switch (action) {
      // --- Save/Update API Key ---
      case "save_api_key": {
        const { provider, api_key } = body;

        if (!provider || !VALID_PROVIDERS.includes(provider)) {
          return NextResponse.json({ error: "Invalid provider" }, { status: 400 });
        }
        if (!api_key || typeof api_key !== "string" || !api_key.trim()) {
          return NextResponse.json({ error: "API key is required" }, { status: 400 });
        }

        const trimmedKey = api_key.trim();
        // Generate hint: show first 4 + last 4 chars
        const keyHint =
          trimmedKey.length > 8
            ? `${trimmedKey.slice(0, 4)}...${trimmedKey.slice(-4)}`
            : "****";

        // Encrypt the key with AES-256-GCM before storing
        let encryptedKey: string;
        try {
          encryptedKey = encryptAES256(trimmedKey);
        } catch (encErr) {
          console.error("[mypage] Encryption failed:", encErr);
          return NextResponse.json({ error: "API key encryption failed. Check MOA_ENCRYPTION_KEY." }, { status: 500 });
        }

        // Upsert: insert or update if user+provider already exists
        const { error } = await supabase
          .from("moa_user_api_keys")
          .upsert(
            {
              user_id,
              provider,
              encrypted_key: encryptedKey,
              key_hint: keyHint,
              is_active: true,
              updated_at: new Date().toISOString(),
            },
            { onConflict: "user_id,provider" }
          );

        if (error) {
          return NextResponse.json({ error: "Failed to save API key" }, { status: 500 });
        }

        return NextResponse.json({ success: true, key_hint: keyHint });
      }

      // --- Delete API Key ---
      case "delete_api_key": {
        const { provider: delProvider } = body;

        if (!delProvider || !VALID_PROVIDERS.includes(delProvider)) {
          return NextResponse.json({ error: "Invalid provider" }, { status: 400 });
        }

        const { error } = await supabase
          .from("moa_user_api_keys")
          .delete()
          .eq("user_id", user_id)
          .eq("provider", delProvider);

        if (error) {
          return NextResponse.json({ error: "Failed to delete API key" }, { status: 500 });
        }

        return NextResponse.json({ success: true });
      }

      // --- Update Model Strategy ---
      case "update_strategy": {
        const { strategy } = body;

        if (!strategy || !VALID_STRATEGIES.includes(strategy)) {
          return NextResponse.json({ error: "Invalid strategy" }, { status: 400 });
        }

        const { error } = await supabase
          .from("moa_user_settings")
          .upsert(
            {
              user_id,
              model_strategy: strategy,
              updated_at: new Date().toISOString(),
            },
            { onConflict: "user_id" }
          );

        if (error) {
          return NextResponse.json({ error: "Failed to update strategy" }, { status: 500 });
        }

        return NextResponse.json({ success: true, strategy });
      }

      // --- Initialize User (on signup) ---
      case "init_user": {
        const { strategy: initStrategy, phone: initPhone, nickname: initNickname } = body;
        const selectedStrategy = VALID_STRATEGIES.includes(initStrategy) ? initStrategy : "cost-efficient";

        // 전화번호 정규화 및 검증
        const normalizedPhone = initPhone ? normalizePhone(String(initPhone)) : null;
        const phoneValid = normalizedPhone ? isValidKoreanMobile(normalizedPhone) : false;

        const upsertData: Record<string, unknown> = {
          user_id,
          model_strategy: selectedStrategy,
          trial_started_at: new Date().toISOString(),
          trial_days: 30,
          is_premium: false,
        };

        if (normalizedPhone && phoneValid) {
          upsertData.phone = normalizedPhone;
        }

        const { error } = await supabase
          .from("moa_user_settings")
          .upsert(upsertData, { onConflict: "user_id" });

        if (error) {
          return NextResponse.json({ error: "Failed to initialize user" }, { status: 500 });
        }

        // 전화번호가 있으면 채널 추가 유도 알림톡 자동 발송
        let alimtalkResult = null;
        if (normalizedPhone && phoneValid) {
          const alreadySent = await hasAlreadySent({
            userId: user_id,
            templateCode: CHANNEL_INVITE_TEMPLATE.code,
          });

          if (!alreadySent) {
            alimtalkResult = await sendAlimtalkWithLog({
              userId: user_id,
              recipientNo: normalizedPhone,
              templateCode: CHANNEL_INVITE_TEMPLATE.code,
              templateParameter: {
                nickname: initNickname || "회원",
              },
            });
          }
        }

        return NextResponse.json({
          success: true,
          strategy: selectedStrategy,
          phoneRegistered: Boolean(normalizedPhone && phoneValid),
          alimtalkSent: alimtalkResult?.success ?? false,
        });
      }

      // --- Update Phone Number ---
      case "update_phone": {
        const { phone, nickname } = body;

        if (!phone || typeof phone !== "string") {
          return NextResponse.json({ error: "전화번호를 입력해 주세요." }, { status: 400 });
        }

        const normalized = normalizePhone(phone);
        if (!isValidKoreanMobile(normalized)) {
          return NextResponse.json(
            { error: "유효한 한국 휴대폰 번호를 입력해 주세요. (예: 010-1234-5678)" },
            { status: 400 },
          );
        }

        const { error } = await supabase
          .from("moa_user_settings")
          .upsert(
            {
              user_id,
              phone: normalized,
              updated_at: new Date().toISOString(),
            },
            { onConflict: "user_id" },
          );

        if (error) {
          return NextResponse.json({ error: "전화번호 저장 실패" }, { status: 500 });
        }

        // 채널 추가 유도 알림톡 자동 발송
        let alimtalkSent = false;
        const alreadySent = await hasAlreadySent({
          userId: user_id,
          templateCode: CHANNEL_INVITE_TEMPLATE.code,
        });

        if (!alreadySent) {
          const result = await sendAlimtalkWithLog({
            userId: user_id,
            recipientNo: normalized,
            templateCode: CHANNEL_INVITE_TEMPLATE.code,
            templateParameter: {
              nickname: nickname || "회원",
            },
          });
          alimtalkSent = result.success;
        }

        return NextResponse.json({
          success: true,
          phone: normalized.slice(0, 3) + "-****-" + normalized.slice(-4),
          alimtalkSent,
        });
      }

      default:
        return NextResponse.json({ error: "Invalid action" }, { status: 400 });
    }
  } catch {
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
