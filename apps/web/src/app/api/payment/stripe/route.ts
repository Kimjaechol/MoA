import { NextRequest, NextResponse } from "next/server";

/**
 * Payment API — Stripe Integration (International)
 *
 * Env vars needed:
 *   STRIPE_SECRET_KEY        — Stripe Secret Key (sk_live_... or sk_test_...)
 *   STRIPE_PUBLISHABLE_KEY   — Stripe Publishable Key (pk_live_... or pk_test_...)
 *   STRIPE_WEBHOOK_SECRET    — Stripe Webhook Signing Secret (whsec_...)
 *   NEXT_PUBLIC_BASE_URL     — App base URL (e.g. https://mymoa.app)
 *
 * Flow:
 * 1. Frontend calls POST /api/payment/stripe (action: create_checkout)
 * 2. Backend creates Stripe Checkout Session
 * 3. Frontend redirects to Stripe-hosted payment page
 * 4. On success, Stripe webhook fires → credits added
 * 5. Frontend redirects to success URL
 */

const STRIPE_API = "https://api.stripe.com/v1";

/** USD credit packs */
const CREDIT_PACKS_USD: Record<string, { credits: number; price: number; label: string }> = {
  pack_500:   { credits: 500,   price: 399,   label: "500 Credits" },
  pack_1500:  { credits: 1500,  price: 999,   label: "1,500 Credits" },
  pack_5000:  { credits: 5000,  price: 2999,  label: "5,000 Credits" },
  pack_15000: { credits: 15000, price: 7499,  label: "15,000 Credits" },
};

/** USD subscription plans */
const SUBSCRIPTION_PLANS_USD: Record<string, { price: number; credits: number; label: string }> = {
  basic: { price: 799,   credits: 3000,  label: "Basic Monthly" },
  pro:   { price: 2499,  credits: 15000, label: "Pro Monthly" },
};

/** Make a Stripe API request */
async function stripeRequest(
  endpoint: string,
  method: "GET" | "POST",
  body?: Record<string, string>,
): Promise<{ ok: boolean; data: Record<string, unknown> }> {
  const secretKey = process.env.STRIPE_SECRET_KEY;
  if (!secretKey) {
    return { ok: false, data: { error: "Stripe not configured" } };
  }

  const options: RequestInit = {
    method,
    headers: {
      Authorization: `Bearer ${secretKey}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
  };

  if (body && method === "POST") {
    options.body = new URLSearchParams(body).toString();
  }

  try {
    const res = await fetch(`${STRIPE_API}${endpoint}`, options);
    const data = await res.json();
    return { ok: res.ok, data };
  } catch {
    return { ok: false, data: { error: "Stripe API request failed" } };
  }
}

/**
 * Validate session token and return user_id.
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
 * POST /api/payment/stripe
 * Actions: create_checkout, verify, history
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

    // Authenticate
    const session = await authenticateRequest(supabase, token);
    if (!session || session.user_id !== user_id) {
      return NextResponse.json({ error: "Authentication required. Please log in again." }, { status: 401 });
    }

    switch (action) {
      // --- Create Stripe Checkout Session ---
      case "create_checkout": {
        const { product_type, product_id } = body;
        const baseUrl = process.env.NEXT_PUBLIC_BASE_URL ?? "https://mymoa.app";

        let priceInCents: number;
        let productName: string;
        let creditsToGrant: number;

        if (product_type === "credit_pack") {
          const pack = CREDIT_PACKS_USD[product_id];
          if (!pack) return NextResponse.json({ error: "Invalid pack" }, { status: 400 });
          priceInCents = pack.price;
          productName = pack.label;
          creditsToGrant = pack.credits;
        } else if (product_type === "subscription") {
          const plan = SUBSCRIPTION_PLANS_USD[product_id];
          if (!plan) return NextResponse.json({ error: "Invalid plan" }, { status: 400 });
          priceInCents = plan.price;
          productName = plan.label;
          creditsToGrant = plan.credits;
        } else {
          return NextResponse.json({ error: "Invalid product_type" }, { status: 400 });
        }

        const paymentId = `moa_stripe_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

        // Create our payment record first
        await supabase.from("moa_payments").insert({
          user_id,
          payment_id: paymentId,
          amount: priceInCents,
          currency: "usd",
          status: "pending",
          product_type,
          product_name: productName,
          credits_granted: creditsToGrant,
          payment_gateway: "stripe",
        });

        // Create Stripe Checkout Session
        const checkoutParams: Record<string, string> = {
          "mode": product_type === "subscription" ? "subscription" : "payment",
          "success_url": `${baseUrl}/billing?stripe_success=true&payment_id=${paymentId}`,
          "cancel_url": `${baseUrl}/billing?stripe_cancel=true`,
          "client_reference_id": paymentId,
          "line_items[0][price_data][currency]": "usd",
          "line_items[0][price_data][product_data][name]": `MoA ${productName}`,
          "line_items[0][price_data][product_data][description]": `${creditsToGrant.toLocaleString()} credits for MoA AI Assistant`,
          "line_items[0][price_data][unit_amount]": String(priceInCents),
          "line_items[0][quantity]": "1",
          "metadata[payment_id]": paymentId,
          "metadata[user_id]": user_id,
          "metadata[product_type]": product_type,
          "metadata[credits]": String(creditsToGrant),
        };

        if (product_type === "subscription") {
          checkoutParams["line_items[0][price_data][recurring][interval]"] = "month";
        }

        const { ok, data: checkoutData } = await stripeRequest("/checkout/sessions", "POST", checkoutParams);

        if (!ok || !checkoutData.url) {
          console.error("[stripe] Checkout session creation failed:", checkoutData);
          // Clean up pending payment
          await supabase
            .from("moa_payments")
            .update({ status: "failed" })
            .eq("payment_id", paymentId);
          return NextResponse.json({ error: "Failed to create checkout session" }, { status: 500 });
        }

        // Store Stripe session ID
        await supabase
          .from("moa_payments")
          .update({ stripe_session_id: checkoutData.id })
          .eq("payment_id", paymentId);

        return NextResponse.json({
          success: true,
          payment_id: paymentId,
          checkout_url: checkoutData.url,
          amount: priceInCents,
          currency: "usd",
          product_name: productName,
          credits: creditsToGrant,
        });
      }

      // --- Verify Stripe payment (called after redirect) ---
      case "verify": {
        const { payment_id } = body;

        if (!payment_id) {
          return NextResponse.json({ error: "payment_id required" }, { status: 400 });
        }

        const { data: payment } = await supabase
          .from("moa_payments")
          .select("*")
          .eq("payment_id", payment_id)
          .eq("payment_gateway", "stripe")
          .single();

        if (!payment) {
          return NextResponse.json({ error: "Payment not found" }, { status: 404 });
        }

        if (payment.status === "paid") {
          return NextResponse.json({ success: true, already_paid: true });
        }

        // Check Stripe session status
        if (payment.stripe_session_id) {
          const { ok, data: sessionData } = await stripeRequest(
            `/checkout/sessions/${payment.stripe_session_id}`,
            "GET",
          );

          if (ok && sessionData.payment_status === "paid") {
            return await processStripeSuccess(supabase, payment, sessionData);
          }
        }

        return NextResponse.json({
          success: false,
          status: payment.status,
          message: "Payment is still being processed. It will be confirmed via webhook.",
        });
      }

      // --- Payment history (Stripe only) ---
      case "history": {
        const limit = body.limit ?? 20;
        const { data: payments } = await supabase
          .from("moa_payments")
          .select("*")
          .eq("user_id", user_id)
          .eq("payment_gateway", "stripe")
          .order("created_at", { ascending: false })
          .limit(limit);

        return NextResponse.json({ payments: payments ?? [] });
      }

      // --- Cancel Stripe subscription ---
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

        // Cancel in Stripe if we have a subscription ID
        if (sub.stripe_subscription_id) {
          const { ok } = await stripeRequest(
            `/subscriptions/${sub.stripe_subscription_id}`,
            "POST",
            { cancel_at_period_end: "true" },
          );
          if (!ok) {
            return NextResponse.json({ error: "Failed to cancel subscription with Stripe" }, { status: 500 });
          }
        }

        await supabase
          .from("moa_subscriptions")
          .update({
            status: "canceled",
            canceled_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          })
          .eq("id", sub.id);

        const endDate = sub.current_period_end
          ? new Date(sub.current_period_end).toLocaleDateString("en-US")
          : "end of current period";

        return NextResponse.json({
          success: true,
          message: `Subscription canceled. Your plan will remain active until ${endDate}.`,
        });
      }

      default:
        return NextResponse.json({ error: "Invalid action" }, { status: 400 });
    }
  } catch {
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

/** Process successful Stripe payment — add credits, update subscription */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function processStripeSuccess(supabase: any, payment: any, stripeSession: any) {
  const userId = payment.user_id;
  const now = new Date().toISOString();

  // Update payment record
  await supabase
    .from("moa_payments")
    .update({
      status: "paid",
      stripe_session_id: stripeSession.id,
      pay_method: stripeSession.payment_method_types?.[0] ?? "card",
      receipt_url: stripeSession.receipt_url ?? null,
      paid_at: now,
    })
    .eq("payment_id", payment.payment_id);

  // Add credits
  if (payment.credits_granted > 0) {
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
      const planId = payment.amount <= 1000 ? "basic" : "pro";
      const quota = SUBSCRIPTION_PLANS_USD[planId]?.credits ?? 3000;
      planUpdate.plan = planId;
      planUpdate.monthly_quota = quota;
      planUpdate.monthly_used = 0;
      planUpdate.quota_reset_at = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();

      // Create/update subscription record
      const subData: Record<string, unknown> = {
        user_id: userId,
        plan: planId,
        status: "active",
        amount: payment.amount,
        current_period_start: now,
        current_period_end: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
        payment_method: "stripe",
        updated_at: now,
      };

      if (stripeSession.subscription) {
        subData.stripe_subscription_id = stripeSession.subscription;
      }

      await supabase.from("moa_subscriptions").upsert(subData, { onConflict: "user_id" });

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
      description: `${payment.product_name} (Stripe)`,
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
 * GET /api/payment/stripe?user_id=xxx
 * Get available products with USD pricing.
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const userId = searchParams.get("user_id");

    let subscription = null;

    if (userId) {
      try {
        const { getServiceSupabase } = await import("@/lib/supabase");
        const supabase = getServiceSupabase();
        const { data: sub } = await supabase
          .from("moa_subscriptions")
          .select("*")
          .eq("user_id", userId)
          .eq("status", "active")
          .single();
        subscription = sub ?? null;
      } catch { /* DB not configured */ }
    }

    return NextResponse.json({
      subscription,
      currency: "usd",
      packs: CREDIT_PACKS_USD,
      plans: SUBSCRIPTION_PLANS_USD,
      stripe_configured: Boolean(process.env.STRIPE_SECRET_KEY),
    });
  } catch {
    return NextResponse.json({
      subscription: null,
      currency: "usd",
      packs: CREDIT_PACKS_USD,
      plans: SUBSCRIPTION_PLANS_USD,
      stripe_configured: false,
    });
  }
}
