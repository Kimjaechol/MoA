import { NextRequest, NextResponse } from "next/server";

/**
 * Payment API — PortOne (포트원) Integration
 *
 * Env vars needed:
 *   PORTONE_IMP_KEY       — PortOne REST API Key
 *   PORTONE_IMP_SECRET    — PortOne REST API Secret
 *   PORTONE_MERCHANT_ID   — Merchant UID prefix
 *
 * Flow:
 * 1. Frontend calls IMP.request_pay() with product info
 * 2. On success, frontend sends imp_uid to POST /api/payment (action: verify)
 * 3. Backend verifies with PortOne API → credits added
 */

const CREDIT_PACKS: Record<string, { credits: number; price: number; label: string }> = {
  pack_500:   { credits: 500,   price: 5000,  label: "500 크레딧" },
  pack_1500:  { credits: 1500,  price: 12000, label: "1,500 크레딧" },
  pack_5000:  { credits: 5000,  price: 35000, label: "5,000 크레딧" },
  pack_15000: { credits: 15000, price: 90000, label: "15,000 크레딧" },
};

const SUBSCRIPTION_PLANS: Record<string, { price: number; credits: number; label: string }> = {
  basic: { price: 9900,  credits: 3000,  label: "Basic 월간 구독" },
  pro:   { price: 29900, credits: 15000, label: "Pro 월간 구독" },
};

/** Get PortOne access token */
async function getPortOneToken(): Promise<string | null> {
  const key = process.env.PORTONE_IMP_KEY;
  const secret = process.env.PORTONE_IMP_SECRET;
  if (!key || !secret) return null;

  try {
    const res = await fetch("https://api.iamport.kr/users/getToken", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ imp_key: key, imp_secret: secret }),
    });
    const data = await res.json();
    return data.response?.access_token ?? null;
  } catch {
    return null;
  }
}

/** Verify payment with PortOne */
async function verifyPayment(impUid: string, token: string) {
  try {
    const res = await fetch(`https://api.iamport.kr/payments/${impUid}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const data = await res.json();
    return data.response ?? null;
  } catch {
    return null;
  }
}

/**
 * Validate session token and return user_id.
 * Used to ensure all payment operations are authenticated.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function authenticateRequest(supabase: any, token: string | undefined): Promise<{ user_id: string } | null> {
  if (!token || typeof token !== "string") return null;
  const { data, error } = await supabase
    .from("moa_sessions")
    .select("user_id, expires_at")
    .eq("token", token)
    .single();
  if (error || !data) return null;
  if (new Date(data.expires_at) < new Date()) return null;
  return { user_id: data.user_id };
}

/**
 * POST /api/payment
 * Actions: prepare, verify, history, cancel
 *
 * All actions require a valid session token for authentication.
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { action, user_id, token } = body;

    if (!user_id) {
      return NextResponse.json({ error: "user_id required" }, { status: 400 });
    }

    let supabase;
    try {
      const { getServiceSupabase } = await import("@/lib/supabase");
      supabase = getServiceSupabase();
    } catch {
      return NextResponse.json({ error: "Database not configured" }, { status: 503 });
    }

    // Authenticate: verify session token matches user_id
    const session = await authenticateRequest(supabase, token);
    if (!session || session.user_id !== user_id) {
      return NextResponse.json({ error: "인증이 필요합니다. 다시 로그인해주세요." }, { status: 401 });
    }

    switch (action) {
      // --- Prepare payment (create order record) ---
      case "prepare": {
        const { product_type, product_id } = body;

        let amount: number;
        let productName: string;
        let creditsToGrant: number;

        if (product_type === "credit_pack") {
          const pack = CREDIT_PACKS[product_id];
          if (!pack) return NextResponse.json({ error: "Invalid pack" }, { status: 400 });
          amount = pack.price;
          productName = pack.label;
          creditsToGrant = pack.credits;
        } else if (product_type === "subscription") {
          const plan = SUBSCRIPTION_PLANS[product_id];
          if (!plan) return NextResponse.json({ error: "Invalid plan" }, { status: 400 });
          amount = plan.price;
          productName = plan.label;
          creditsToGrant = plan.credits;
        } else {
          return NextResponse.json({ error: "Invalid product_type" }, { status: 400 });
        }

        const paymentId = `moa_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

        await supabase.from("moa_payments").insert({
          user_id,
          payment_id: paymentId,
          amount,
          status: "pending",
          product_type,
          product_name: productName,
          credits_granted: creditsToGrant,
        });

        return NextResponse.json({
          success: true,
          payment_id: paymentId,
          amount,
          product_name: productName,
          credits: creditsToGrant,
          // PortOne params for frontend
          portone: {
            merchant_uid: paymentId,
            name: productName,
            amount,
            currency: "KRW",
          },
        });
      }

      // --- Verify payment after PortOne callback ---
      case "verify": {
        const { imp_uid, payment_id } = body;

        if (!imp_uid || !payment_id) {
          return NextResponse.json({ error: "imp_uid and payment_id required" }, { status: 400 });
        }

        // Get our payment record
        const { data: payment } = await supabase
          .from("moa_payments")
          .select("*")
          .eq("payment_id", payment_id)
          .single();

        if (!payment) {
          return NextResponse.json({ error: "Payment not found" }, { status: 404 });
        }

        if (payment.status === "paid") {
          return NextResponse.json({ success: true, already_paid: true });
        }

        // Verify with PortOne
        const token = await getPortOneToken();
        if (!token) {
          // PortOne not configured — for testing, auto-approve
          if (process.env.NODE_ENV === "development" || process.env.PAYMENT_TEST_MODE === "true") {
            return await processPaymentSuccess(supabase, payment, imp_uid);
          }
          return NextResponse.json({ error: "Payment gateway not configured" }, { status: 503 });
        }

        const portonePayment = await verifyPayment(imp_uid, token);
        if (!portonePayment) {
          return NextResponse.json({ error: "Failed to verify payment" }, { status: 500 });
        }

        // Amount mismatch check (prevent tampering)
        if (portonePayment.amount !== payment.amount) {
          await supabase
            .from("moa_payments")
            .update({ status: "failed", imp_uid })
            .eq("payment_id", payment_id);
          return NextResponse.json({ error: "Payment amount mismatch" }, { status: 400 });
        }

        if (portonePayment.status !== "paid") {
          await supabase
            .from("moa_payments")
            .update({ status: "failed", imp_uid })
            .eq("payment_id", payment_id);
          return NextResponse.json({ error: `Payment status: ${portonePayment.status}` }, { status: 400 });
        }

        return await processPaymentSuccess(supabase, payment, imp_uid, portonePayment);
      }

      // --- Payment history ---
      case "history": {
        const limit = body.limit ?? 20;
        const { data: payments } = await supabase
          .from("moa_payments")
          .select("*")
          .eq("user_id", user_id)
          .order("created_at", { ascending: false })
          .limit(limit);

        return NextResponse.json({ payments: payments ?? [] });
      }

      // --- Cancel subscription ---
      case "cancel_subscription": {
        const { data: sub } = await supabase
          .from("moa_subscriptions")
          .select("*")
          .eq("user_id", user_id)
          .eq("status", "active")
          .single();

        if (!sub) {
          return NextResponse.json({ error: "No active subscription" }, { status: 404 });
        }

        await supabase
          .from("moa_subscriptions")
          .update({
            status: "canceled",
            canceled_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          })
          .eq("id", sub.id);

        // Downgrade to free on next period
        return NextResponse.json({
          success: true,
          message: `구독이 취소되었습니다. ${new Date(sub.current_period_end).toLocaleDateString("ko-KR")}까지 현재 플랜이 유지됩니다.`,
        });
      }

      default:
        return NextResponse.json({ error: "Invalid action" }, { status: 400 });
    }
  } catch {
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

/** Process successful payment — add credits, update subscription */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function processPaymentSuccess(supabase: any, payment: any, impUid: string, portoneData?: any) {
  const userId = payment.user_id;
  const now = new Date().toISOString();

  // Update payment record
  await supabase
    .from("moa_payments")
    .update({
      status: "paid",
      imp_uid: impUid,
      pay_method: portoneData?.pay_method ?? "test",
      card_name: portoneData?.card_name,
      card_number: portoneData?.card_number,
      receipt_url: portoneData?.receipt_url,
      paid_at: now,
    })
    .eq("payment_id", payment.payment_id);

  // Add credits
  if (payment.credits_granted > 0) {
    // Get or create credit record
    let { data: credits } = await supabase
      .from("moa_credits")
      .select("balance")
      .eq("user_id", userId)
      .single();

    if (!credits) {
      await supabase.from("moa_credits").insert({
        user_id: userId, balance: 100, monthly_quota: 100, monthly_used: 0, plan: "free",
        quota_reset_at: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
      });
      credits = { balance: 100 };
    }

    const newBalance = credits.balance + payment.credits_granted;
    const planUpdate: Record<string, unknown> = {
      balance: newBalance,
      updated_at: now,
    };

    // If subscription, upgrade plan
    if (payment.product_type === "subscription") {
      const planId = payment.amount === 9900 ? "basic" : "pro";
      const quota = SUBSCRIPTION_PLANS[planId]?.credits ?? 3000;
      planUpdate.plan = planId;
      planUpdate.monthly_quota = quota;
      planUpdate.monthly_used = 0;
      planUpdate.quota_reset_at = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();

      // Create/update subscription record
      await supabase.from("moa_subscriptions").upsert({
        user_id: userId,
        plan: planId,
        status: "active",
        amount: payment.amount,
        current_period_start: now,
        current_period_end: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
        payment_method: portoneData?.card_name ?? "card",
        updated_at: now,
      }, { onConflict: "user_id" });

      // Also update user settings
      await supabase
        .from("moa_user_settings")
        .upsert({ user_id: userId, is_premium: true, updated_at: now }, { onConflict: "user_id" });
    }

    await supabase.from("moa_credits").update(planUpdate).eq("user_id", userId);

    // Log transaction
    await supabase.from("moa_credit_transactions").insert({
      user_id: userId,
      amount: payment.credits_granted,
      balance_after: newBalance,
      tx_type: payment.product_type === "subscription" ? "subscription" : "purchase",
      description: `${payment.product_name} 결제`,
      reference_id: payment.payment_id,
    });
  }

  return NextResponse.json({
    success: true,
    credits_added: payment.credits_granted,
    payment_id: payment.payment_id,
  });
}

/**
 * GET /api/payment?user_id=xxx
 * Get subscription status and available products.
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const userId = searchParams.get("user_id");

    if (!userId) {
      return NextResponse.json({ error: "user_id required" }, { status: 400 });
    }

    let supabase;
    try {
      const { getServiceSupabase } = await import("@/lib/supabase");
      supabase = getServiceSupabase();
    } catch {
      return NextResponse.json({
        subscription: null,
        packs: CREDIT_PACKS,
        plans: SUBSCRIPTION_PLANS,
      });
    }

    const { data: sub } = await supabase
      .from("moa_subscriptions")
      .select("*")
      .eq("user_id", userId)
      .eq("status", "active")
      .single();

    return NextResponse.json({
      subscription: sub ?? null,
      packs: CREDIT_PACKS,
      plans: SUBSCRIPTION_PLANS,
    });
  } catch {
    return NextResponse.json({
      subscription: null,
      packs: CREDIT_PACKS,
      plans: SUBSCRIPTION_PLANS,
    });
  }
}
