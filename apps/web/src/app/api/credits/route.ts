import { NextRequest, NextResponse } from "next/server";

/**
 * Credit System API
 *
 * Model costs (credits per request):
 *   local/slm-default: 0    (free fallback)
 *   groq/*:            1    (free tier)
 *   gemini/*:          2
 *   deepseek/*:        3
 *   openai/gpt-4o:     5
 *   anthropic/sonnet:  8
 *   openai/gpt-5:     10
 *   anthropic/opus:   15
 *
 * Plans:
 *   free:  100 credits/month
 *   basic: 3,000 credits/month (9,900 KRW)
 *   pro:  15,000 credits/month (29,900 KRW)
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

function getModelCost(model: string): number {
  if (MODEL_CREDITS[model] !== undefined) return MODEL_CREDITS[model];
  // Fallback by provider prefix
  if (model.startsWith("groq/")) return 1;
  if (model.startsWith("gemini/")) return 2;
  if (model.startsWith("deepseek/")) return 3;
  if (model.startsWith("openai/")) return 5;
  if (model.startsWith("anthropic/")) return 8;
  return 0; // unknown = free
}

/**
 * GET /api/credits?user_id=xxx
 * Returns credit balance, plan info, transaction history.
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const userId = searchParams.get("user_id");
    const includeHistory = searchParams.get("history") === "true";

    if (!userId) {
      return NextResponse.json({ error: "user_id required" }, { status: 400 });
    }

    let supabase;
    try {
      const { getServiceSupabase } = await import("@/lib/supabase");
      supabase = getServiceSupabase();
    } catch {
      return NextResponse.json({
        balance: 100, plan: "free", monthly_quota: 100, monthly_used: 0,
        packs: CREDIT_PACKS, plans: PLAN_QUOTAS, history: [],
      });
    }

    // Get or create credit record
    let { data: credits } = await supabase
      .from("moa_credits")
      .select("*")
      .eq("user_id", userId)
      .single();

    if (!credits) {
      // Initialize new user with free plan
      const { data: newCredits } = await supabase
        .from("moa_credits")
        .insert({
          user_id: userId,
          balance: 100,
          monthly_quota: 100,
          monthly_used: 0,
          plan: "free",
          quota_reset_at: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
        })
        .select()
        .single();
      credits = newCredits ?? { balance: 100, plan: "free", monthly_quota: 100, monthly_used: 0 };
    }

    // Check if monthly quota needs reset
    if (credits.quota_reset_at && new Date(credits.quota_reset_at) <= new Date()) {
      const planQuota = PLAN_QUOTAS[credits.plan]?.monthly ?? 100;
      await supabase
        .from("moa_credits")
        .update({
          monthly_used: 0,
          monthly_quota: planQuota,
          balance: credits.balance + planQuota,
          quota_reset_at: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq("user_id", userId);

      // Log the reset
      await supabase.from("moa_credit_transactions").insert({
        user_id: userId,
        amount: planQuota,
        balance_after: credits.balance + planQuota,
        tx_type: "monthly_reset",
        description: `월간 크레딧 리셋 (${credits.plan} 플랜)`,
      });

      credits.balance += planQuota;
      credits.monthly_used = 0;
    }

    // Optionally include transaction history
    let history: unknown[] = [];
    if (includeHistory) {
      const { data: txData } = await supabase
        .from("moa_credit_transactions")
        .select("*")
        .eq("user_id", userId)
        .order("created_at", { ascending: false })
        .limit(50);
      history = txData ?? [];
    }

    return NextResponse.json({
      balance: credits.balance,
      plan: credits.plan,
      monthly_quota: credits.monthly_quota,
      monthly_used: credits.monthly_used,
      quota_reset_at: credits.quota_reset_at,
      packs: CREDIT_PACKS,
      plans: PLAN_QUOTAS,
      model_costs: MODEL_CREDITS,
      env_key_multiplier: ENV_KEY_MULTIPLIER,
      history,
    });
  } catch {
    return NextResponse.json({
      balance: 100, plan: "free", monthly_quota: 100, monthly_used: 0,
      packs: CREDIT_PACKS, plans: PLAN_QUOTAS, history: [],
    });
  }
}

/**
 * POST /api/credits
 * Actions: deduct, add, check
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { action, user_id } = body;

    if (!user_id) {
      return NextResponse.json({ error: "user_id required" }, { status: 400 });
    }

    let supabase;
    try {
      const { getServiceSupabase } = await import("@/lib/supabase");
      supabase = getServiceSupabase();
    } catch {
      // Without Supabase, always allow (no deduction)
      return NextResponse.json({ success: true, balance: 100, cost: 0 });
    }

    switch (action) {
      case "deduct": {
        const { model, description, reference_id } = body;
        const cost = getModelCost(model ?? "local/slm-default");

        if (cost === 0) {
          return NextResponse.json({ success: true, balance: -1, cost: 0, free: true });
        }

        // Get current balance
        let { data: credits } = await supabase
          .from("moa_credits")
          .select("balance, monthly_used, plan")
          .eq("user_id", user_id)
          .single();

        if (!credits) {
          // Auto-init
          await supabase.from("moa_credits").insert({
            user_id, balance: 100, monthly_quota: 100, monthly_used: 0, plan: "free",
            quota_reset_at: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
          });
          credits = { balance: 100, monthly_used: 0, plan: "free" };
        }

        if (credits.balance < cost) {
          return NextResponse.json({
            success: false,
            error: "크레딧이 부족합니다. 충전하거나 요금제를 업그레이드하세요.",
            balance: credits.balance,
            cost,
            plan: credits.plan,
          }, { status: 402 });
        }

        const newBalance = credits.balance - cost;
        const newUsed = (credits.monthly_used ?? 0) + cost;

        await supabase
          .from("moa_credits")
          .update({
            balance: newBalance,
            monthly_used: newUsed,
            updated_at: new Date().toISOString(),
          })
          .eq("user_id", user_id);

        await supabase.from("moa_credit_transactions").insert({
          user_id,
          amount: -cost,
          balance_after: newBalance,
          tx_type: "usage",
          description: description ?? `AI 사용 - ${model}`,
          model_used: model,
          reference_id,
        });

        return NextResponse.json({ success: true, balance: newBalance, cost, model });
      }

      case "add": {
        const { amount, tx_type = "purchase", description: addDesc, reference_id: addRef } = body;

        if (!amount || amount <= 0) {
          return NextResponse.json({ error: "Invalid amount" }, { status: 400 });
        }

        let { data: credits } = await supabase
          .from("moa_credits")
          .select("balance")
          .eq("user_id", user_id)
          .single();

        if (!credits) {
          await supabase.from("moa_credits").insert({
            user_id, balance: 100, monthly_quota: 100, monthly_used: 0, plan: "free",
            quota_reset_at: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
          });
          credits = { balance: 100 };
        }

        const newBalance = credits.balance + amount;

        await supabase
          .from("moa_credits")
          .update({ balance: newBalance, updated_at: new Date().toISOString() })
          .eq("user_id", user_id);

        await supabase.from("moa_credit_transactions").insert({
          user_id,
          amount,
          balance_after: newBalance,
          tx_type,
          description: addDesc ?? `크레딧 ${amount}개 충전`,
          reference_id: addRef,
        });

        return NextResponse.json({ success: true, balance: newBalance, added: amount });
      }

      case "check": {
        const { model: checkModel } = body;
        const cost = getModelCost(checkModel ?? "local/slm-default");

        if (cost === 0) {
          return NextResponse.json({ allowed: true, cost: 0, free: true });
        }

        const { data: credits } = await supabase
          .from("moa_credits")
          .select("balance, plan")
          .eq("user_id", user_id)
          .single();

        const balance = credits?.balance ?? 100;
        return NextResponse.json({
          allowed: balance >= cost,
          cost,
          balance,
          plan: credits?.plan ?? "free",
        });
      }

      default:
        return NextResponse.json({ error: "Invalid action" }, { status: 400 });
    }
  } catch {
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
