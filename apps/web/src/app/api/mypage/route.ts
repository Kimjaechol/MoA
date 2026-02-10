import { NextRequest, NextResponse } from "next/server";
import { getServiceSupabase } from "@/lib/supabase";

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

    return NextResponse.json({
      apiKeys: keys ?? [],
      settings: settings ?? { model_strategy: "cost-efficient" },
      trialStatus,
    });
  } catch {
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

/**
 * POST /api/mypage
 * Actions: save_api_key, delete_api_key, update_strategy, init_user
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

        // Upsert: insert or update if user+provider already exists
        const { error } = await supabase
          .from("moa_user_api_keys")
          .upsert(
            {
              user_id,
              provider,
              encrypted_key: trimmedKey, // TODO: encrypt with AES-256 in production
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
        const { strategy: initStrategy } = body;
        const selectedStrategy = VALID_STRATEGIES.includes(initStrategy) ? initStrategy : "cost-efficient";

        const { error } = await supabase
          .from("moa_user_settings")
          .upsert(
            {
              user_id,
              model_strategy: selectedStrategy,
              trial_started_at: new Date().toISOString(),
              trial_days: 30,
              is_premium: false,
            },
            { onConflict: "user_id" }
          );

        if (error) {
          return NextResponse.json({ error: "Failed to initialize user" }, { status: 500 });
        }

        return NextResponse.json({ success: true, strategy: selectedStrategy });
      }

      default:
        return NextResponse.json({ error: "Invalid action" }, { status: 400 });
    }
  } catch {
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
