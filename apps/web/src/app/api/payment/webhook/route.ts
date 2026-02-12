import { NextRequest, NextResponse } from "next/server";

/**
 * POST /api/payment/webhook
 * PortOne webhook — called by PortOne when payment status changes.
 *
 * Set this URL in PortOne dashboard:
 *   https://mymoa.app/api/payment/webhook
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { imp_uid, merchant_uid, status } = body;

    if (!imp_uid || !merchant_uid) {
      return NextResponse.json({ error: "Missing imp_uid or merchant_uid" }, { status: 400 });
    }

    let supabase;
    try {
      const { getServiceSupabase } = await import("@/lib/supabase");
      supabase = getServiceSupabase();
    } catch {
      return NextResponse.json({ error: "Database not configured" }, { status: 503 });
    }

    // Get PortOne token for verification
    const key = process.env.PORTONE_IMP_KEY;
    const secret = process.env.PORTONE_IMP_SECRET;

    if (!key || !secret) {
      return NextResponse.json({ error: "Payment gateway not configured" }, { status: 503 });
    }

    // Get access token
    const tokenRes = await fetch("https://api.iamport.kr/users/getToken", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ imp_key: key, imp_secret: secret }),
    });
    if (!tokenRes.ok) {
      console.error("[payment/webhook] Token request failed:", tokenRes.status);
      return NextResponse.json({ error: "Failed to get payment token" }, { status: 500 });
    }
    const tokenData = await tokenRes.json();
    const token = tokenData.response?.access_token;

    if (!token) {
      return NextResponse.json({ error: "Failed to get token" }, { status: 500 });
    }

    // Verify payment with PortOne
    const payRes = await fetch(`https://api.iamport.kr/payments/${encodeURIComponent(imp_uid)}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!payRes.ok) {
      console.error("[payment/webhook] Payment verification failed:", payRes.status);
      return NextResponse.json({ error: "Failed to verify payment" }, { status: 500 });
    }
    const payData = await payRes.json();
    const portonePayment = payData.response;

    if (!portonePayment) {
      return NextResponse.json({ error: "Payment not found in PortOne" }, { status: 404 });
    }

    // Get our payment record
    const { data: payment } = await supabase
      .from("moa_payments")
      .select("*")
      .eq("payment_id", merchant_uid)
      .single();

    if (!payment) {
      return NextResponse.json({ error: "Payment not found" }, { status: 404 });
    }

    // Handle different statuses
    if (status === "paid" && portonePayment.status === "paid") {
      if (payment.status === "paid") {
        return NextResponse.json({ success: true, message: "Already processed" });
      }

      // Verify amount
      if (portonePayment.amount !== payment.amount) {
        await supabase
          .from("moa_payments")
          .update({ status: "failed", imp_uid })
          .eq("payment_id", merchant_uid);
        return NextResponse.json({ error: "Amount mismatch" }, { status: 400 });
      }

      // Process success — add credits
      const userId = payment.user_id;
      const now = new Date().toISOString();

      await supabase
        .from("moa_payments")
        .update({
          status: "paid", imp_uid,
          pay_method: portonePayment.pay_method,
          card_name: portonePayment.card_name,
          card_number: portonePayment.card_number,
          receipt_url: portonePayment.receipt_url,
          paid_at: now,
        })
        .eq("payment_id", merchant_uid);

      if (payment.credits_granted > 0) {
        const { data: credits } = await supabase
          .from("moa_credits")
          .select("balance")
          .eq("user_id", userId)
          .single();

        const currentBalance = credits?.balance ?? 100;
        const newBalance = currentBalance + payment.credits_granted;

        await supabase
          .from("moa_credits")
          .update({ balance: newBalance, updated_at: now })
          .eq("user_id", userId);

        await supabase.from("moa_credit_transactions").insert({
          user_id: userId,
          amount: payment.credits_granted,
          balance_after: newBalance,
          tx_type: payment.product_type === "subscription" ? "subscription" : "purchase",
          description: `${payment.product_name} 결제 (webhook)`,
          reference_id: merchant_uid,
        });
      }
    } else if (status === "cancelled" || portonePayment.status === "cancelled") {
      await supabase
        .from("moa_payments")
        .update({ status: "canceled", imp_uid })
        .eq("payment_id", merchant_uid);
    } else if (status === "failed" || portonePayment.status === "failed") {
      await supabase
        .from("moa_payments")
        .update({ status: "failed", imp_uid })
        .eq("payment_id", merchant_uid);
    }

    return NextResponse.json({ success: true });
  } catch {
    return NextResponse.json({ error: "Webhook processing failed" }, { status: 500 });
  }
}
