import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";

/**
 * POST /api/payment/stripe/webhook
 * Stripe webhook — called by Stripe when payment events occur.
 *
 * Set this URL in Stripe Dashboard → Developers → Webhooks:
 *   https://mymoa.app/api/payment/stripe/webhook
 *
 * Events to listen for:
 *   - checkout.session.completed
 *   - invoice.paid
 *   - customer.subscription.deleted
 */

const SUBSCRIPTION_PLANS_USD: Record<string, { credits: number }> = {
  basic: { credits: 3000 },
  pro:   { credits: 15000 },
};

/** Verify Stripe webhook signature (HMAC-SHA256) */
function verifyStripeSignature(
  payload: string,
  sigHeader: string,
  secret: string,
): boolean {
  const elements = sigHeader.split(",");
  let timestamp = "";
  const signatures: string[] = [];

  for (const element of elements) {
    const [key, value] = element.split("=");
    if (key === "t") timestamp = value;
    if (key === "v1") signatures.push(value);
  }

  if (!timestamp || signatures.length === 0) return false;

  // Reject if timestamp is more than 5 minutes old
  const age = Math.abs(Date.now() / 1000 - parseInt(timestamp, 10));
  if (age > 300) return false;

  const signedPayload = `${timestamp}.${payload}`;
  const expectedSig = crypto
    .createHmac("sha256", secret)
    .update(signedPayload)
    .digest("hex");

  return signatures.some((sig) => {
    try {
      return crypto.timingSafeEqual(
        Buffer.from(expectedSig, "hex"),
        Buffer.from(sig, "hex"),
      );
    } catch {
      return false;
    }
  });
}

export async function POST(request: NextRequest) {
  try {
    const rawBody = await request.text();
    const sigHeader = request.headers.get("stripe-signature");
    const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

    // Verify signature if webhook secret is configured
    if (webhookSecret) {
      if (!sigHeader || !verifyStripeSignature(rawBody, sigHeader, webhookSecret)) {
        console.error("[stripe/webhook] Signature verification failed");
        return NextResponse.json({ error: "Invalid signature" }, { status: 400 });
      }
    }

    const event = JSON.parse(rawBody);

    let supabase;
    try {
      const { getServiceSupabase } = await import("@/lib/supabase");
      supabase = getServiceSupabase();
    } catch {
      return NextResponse.json({ error: "Database not configured" }, { status: 503 });
    }

    switch (event.type) {
      // --- Checkout completed (one-time or first subscription payment) ---
      case "checkout.session.completed": {
        const session = event.data.object;
        const paymentId = session.client_reference_id ?? session.metadata?.payment_id;

        if (!paymentId) {
          console.error("[stripe/webhook] No payment_id in checkout session");
          return NextResponse.json({ error: "Missing payment_id" }, { status: 400 });
        }

        // Get our payment record
        const { data: payment } = await supabase
          .from("moa_payments")
          .select("*")
          .eq("payment_id", paymentId)
          .single();

        if (!payment) {
          console.error("[stripe/webhook] Payment not found:", paymentId);
          return NextResponse.json({ error: "Payment not found" }, { status: 404 });
        }

        // Already processed
        if (payment.status === "paid") {
          return NextResponse.json({ success: true, message: "Already processed" });
        }

        // Verify payment status
        if (session.payment_status !== "paid") {
          return NextResponse.json({ success: true, message: "Payment not yet completed" });
        }

        const userId = payment.user_id;
        const now = new Date().toISOString();

        // Update payment record
        await supabase
          .from("moa_payments")
          .update({
            status: "paid",
            stripe_session_id: session.id,
            pay_method: session.payment_method_types?.[0] ?? "card",
            paid_at: now,
          })
          .eq("payment_id", paymentId);

        // Add credits
        if (payment.credits_granted > 0) {
          const { data: credits } = await supabase
            .from("moa_credits")
            .select("balance")
            .eq("user_id", userId)
            .single();

          const currentBalance = credits?.balance ?? 100;
          const newBalance = currentBalance + payment.credits_granted;

          const planUpdate: Record<string, unknown> = {
            balance: newBalance,
            updated_at: now,
          };

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

            if (session.subscription) {
              subData.stripe_subscription_id = session.subscription;
            }

            await supabase.from("moa_subscriptions").upsert(subData, { onConflict: "user_id" });

            await supabase
              .from("moa_user_settings")
              .upsert({ user_id: userId, is_premium: true, updated_at: now }, { onConflict: "user_id" });
          }

          // Upsert credits (create if not exists)
          if (!credits) {
            await supabase.from("moa_credits").insert({
              user_id: userId,
              balance: 100,
              monthly_quota: 100,
              monthly_used: 0,
              plan: "free",
              quota_reset_at: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
            });
          }

          await supabase.from("moa_credits").update(planUpdate).eq("user_id", userId);

          // Log transaction
          await supabase.from("moa_credit_transactions").insert({
            user_id: userId,
            amount: payment.credits_granted,
            balance_after: newBalance,
            tx_type: payment.product_type === "subscription" ? "subscription" : "purchase",
            description: `${payment.product_name} (Stripe webhook)`,
            reference_id: paymentId,
          });
        }

        return NextResponse.json({ success: true });
      }

      // --- Recurring subscription invoice paid ---
      case "invoice.paid": {
        const invoice = event.data.object;
        const subscriptionId = invoice.subscription;

        if (!subscriptionId) {
          return NextResponse.json({ success: true, message: "No subscription" });
        }

        // Find the subscription in our DB
        const { data: sub } = await supabase
          .from("moa_subscriptions")
          .select("*")
          .eq("stripe_subscription_id", subscriptionId)
          .eq("status", "active")
          .single();

        if (!sub) {
          return NextResponse.json({ success: true, message: "Subscription not found" });
        }

        const userId = sub.user_id;
        const now = new Date().toISOString();
        const planId = sub.plan;
        const creditsToGrant = SUBSCRIPTION_PLANS_USD[planId]?.credits ?? 3000;

        // Update subscription period
        await supabase
          .from("moa_subscriptions")
          .update({
            current_period_start: now,
            current_period_end: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
            updated_at: now,
          })
          .eq("id", sub.id);

        // Add monthly credits
        const { data: credits } = await supabase
          .from("moa_credits")
          .select("balance")
          .eq("user_id", userId)
          .single();

        const currentBalance = credits?.balance ?? 0;
        const newBalance = currentBalance + creditsToGrant;

        await supabase
          .from("moa_credits")
          .update({
            balance: newBalance,
            monthly_used: 0,
            quota_reset_at: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
            updated_at: now,
          })
          .eq("user_id", userId);

        // Log renewal payment
        const renewalPaymentId = `moa_stripe_renew_${Date.now()}`;
        await supabase.from("moa_payments").insert({
          user_id: userId,
          payment_id: renewalPaymentId,
          amount: invoice.amount_paid,
          currency: "usd",
          status: "paid",
          product_type: "subscription",
          product_name: `${sub.plan === "pro" ? "Pro" : "Basic"} Monthly (Renewal)`,
          credits_granted: creditsToGrant,
          payment_gateway: "stripe",
          stripe_session_id: subscriptionId,
          pay_method: "card",
          paid_at: now,
        });

        await supabase.from("moa_credit_transactions").insert({
          user_id: userId,
          amount: creditsToGrant,
          balance_after: newBalance,
          tx_type: "subscription",
          description: `${sub.plan === "pro" ? "Pro" : "Basic"} Monthly renewal (Stripe)`,
          reference_id: renewalPaymentId,
        });

        return NextResponse.json({ success: true });
      }

      // --- Subscription canceled/deleted ---
      case "customer.subscription.deleted": {
        const subscription = event.data.object;
        const subscriptionId = subscription.id;

        const { data: sub } = await supabase
          .from("moa_subscriptions")
          .select("*")
          .eq("stripe_subscription_id", subscriptionId)
          .single();

        if (sub) {
          await supabase
            .from("moa_subscriptions")
            .update({
              status: "canceled",
              canceled_at: new Date().toISOString(),
              updated_at: new Date().toISOString(),
            })
            .eq("id", sub.id);

          // Downgrade to free
          await supabase
            .from("moa_credits")
            .update({
              plan: "free",
              monthly_quota: 100,
              updated_at: new Date().toISOString(),
            })
            .eq("user_id", sub.user_id);

          await supabase
            .from("moa_user_settings")
            .upsert(
              { user_id: sub.user_id, is_premium: false, updated_at: new Date().toISOString() },
              { onConflict: "user_id" },
            );
        }

        return NextResponse.json({ success: true });
      }

      default:
        return NextResponse.json({ success: true, message: `Unhandled event: ${event.type}` });
    }
  } catch (err) {
    console.error("[stripe/webhook] Error:", err);
    return NextResponse.json({ error: "Webhook processing failed" }, { status: 500 });
  }
}
