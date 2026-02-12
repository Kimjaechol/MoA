"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import Nav from "../../components/Nav";

/* ============================================
   Billing & Credits Page
   Dual-currency: KRW (PortOne) + USD (Stripe)
   ============================================ */

interface CreditInfo {
  balance: number;
  plan: string;
  monthly_quota: number;
  monthly_used: number;
  quota_reset_at?: string;
}

interface Transaction {
  id: string;
  amount: number;
  balance_after: number;
  tx_type: string;
  description: string;
  model_used?: string;
  created_at: string;
}

interface Payment {
  id: string;
  payment_id: string;
  amount: number;
  currency?: string;
  payment_gateway?: string;
  status: string;
  product_name: string;
  credits_granted: number;
  pay_method?: string;
  paid_at?: string;
  created_at: string;
}

type Currency = "krw" | "usd";

/* --- KRW pricing (PortOne) --- */

const PLANS_KRW = [
  {
    id: "free", name: "Free", price: 0, priceLabel: "0\uc6d0", period: "30\uc77c \uccb4\ud5d8", credits: 100,
    features: ["\uc6d4 100 \ud06c\ub808\ub527", "\uae30\ubcf8 AI \ub300\ud654", "\ubb34\ub8cc SLM \ubb34\uc81c\ud55c", "Groq/Gemini \ubb34\ub8cc \ud55c\ub3c4", "\uc790\uccb4 API \ud0a4 \uc0ac\uc6a9 \uac00\ub2a5"],
  },
  {
    id: "basic", name: "Basic", price: 9900, priceLabel: "9,900\uc6d0", period: "\uc6d4", credits: 3000,
    badge: "\uc778\uae30", highlight: true,
    features: ["\uc6d4 3,000 \ud06c\ub808\ub527", "AI \ub300\ud654 \ubb34\uc81c\ud55c", "\ubaa8\ub4e0 LLM \ubaa8\ub378 \uc0ac\uc6a9", "100+ \uc804\ubb38 \uc2a4\ud0ac", "\uc885\ud569\ubb38\uc11c \uc791\uc131", "\uc790\ub3d9\ucf54\ub529 \uc2dc\uc2a4\ud15c", "\uc6b0\uc120 \uc9c0\uc6d0"],
  },
  {
    id: "pro", name: "Pro", price: 29900, priceLabel: "29,900\uc6d0", period: "\uc6d4", credits: 15000,
    features: ["\uc6d4 15,000 \ud06c\ub808\ub527", "AI \ub300\ud654 \ubb34\uc81c\ud55c", "\ucd5c\uace0 \uc131\ub2a5 \ubaa8\ub378 \uc6b0\uc120", "\ubaa8\ub4e0 \uc2a4\ud0ac + \ucee4\uc2a4\ud140 API", "\uc2e4\uc2dc\uac04 \uc74c\uc131 AI", "\uc804\ub2f4 \ub9e4\ub2c8\uc800", "\ucee4\uc2a4\ud140 \uc2a4\ud0ac \uac1c\ubc1c"],
  },
];

const CREDIT_PACKS_KRW = [
  { id: "pack_500", credits: 500, price: 5000, priceLabel: "5,000\uc6d0", perCredit: "10\uc6d0" },
  { id: "pack_1500", credits: 1500, price: 12000, priceLabel: "12,000\uc6d0", perCredit: "8\uc6d0", badge: "\uc778\uae30" },
  { id: "pack_5000", credits: 5000, price: 35000, priceLabel: "35,000\uc6d0", perCredit: "7\uc6d0" },
  { id: "pack_15000", credits: 15000, price: 90000, priceLabel: "90,000\uc6d0", perCredit: "6\uc6d0", badge: "\ucd5c\uace0 \ud560\uc778" },
];

/* --- USD pricing (Stripe) --- */

const PLANS_USD = [
  {
    id: "free", name: "Free", price: 0, priceLabel: "$0", period: "30-day trial", credits: 100,
    features: ["100 credits/mo", "Basic AI chat", "Free SLM unlimited", "Groq/Gemini free tier", "Own API key support"],
  },
  {
    id: "basic", name: "Basic", price: 799, priceLabel: "$7.99", period: "mo", credits: 3000,
    badge: "Popular", highlight: true,
    features: ["3,000 credits/mo", "Unlimited AI chat", "All LLM models", "100+ expert skills", "Document creation", "Auto-coding system", "Priority support"],
  },
  {
    id: "pro", name: "Pro", price: 2499, priceLabel: "$24.99", period: "mo", credits: 15000,
    features: ["15,000 credits/mo", "Unlimited AI chat", "Top-tier models priority", "All skills + custom API", "Real-time voice AI", "Dedicated manager", "Custom skill development"],
  },
];

const CREDIT_PACKS_USD = [
  { id: "pack_500", credits: 500, price: 399, priceLabel: "$3.99", perCredit: "$0.008" },
  { id: "pack_1500", credits: 1500, price: 999, priceLabel: "$9.99", perCredit: "$0.007", badge: "Popular" },
  { id: "pack_5000", credits: 5000, price: 2999, priceLabel: "$29.99", perCredit: "$0.006" },
  { id: "pack_15000", credits: 15000, price: 7499, priceLabel: "$74.99", perCredit: "$0.005", badge: "Best Deal" },
];

/**
 * Model cost table (same for both currencies — credits, not money)
 */
const MODEL_COSTS: Record<string, { name: string; ownKeyCost: number; moaKeyCost: number; provider: string }> = {
  "local/slm-default": { name: "Free SLM", ownKeyCost: 0, moaKeyCost: 0, provider: "MoA" },
  "groq/kimi-k2-0905": { name: "Kimi K2 (Groq)", ownKeyCost: 1, moaKeyCost: 2, provider: "Groq" },
  "gemini/gemini-2.5-flash": { name: "Gemini 2.5 Flash", ownKeyCost: 2, moaKeyCost: 4, provider: "Google" },
  "deepseek/deepseek-chat": { name: "DeepSeek Chat", ownKeyCost: 3, moaKeyCost: 6, provider: "DeepSeek" },
  "openai/gpt-4o-mini": { name: "GPT-4o Mini", ownKeyCost: 3, moaKeyCost: 6, provider: "OpenAI" },
  "openai/gpt-4o": { name: "GPT-4o", ownKeyCost: 5, moaKeyCost: 10, provider: "OpenAI" },
  "anthropic/claude-haiku-4-5": { name: "Claude Haiku 4.5", ownKeyCost: 4, moaKeyCost: 8, provider: "Anthropic" },
  "anthropic/claude-sonnet-4-5": { name: "Claude Sonnet 4.5", ownKeyCost: 8, moaKeyCost: 16, provider: "Anthropic" },
  "openai/gpt-5": { name: "GPT-5", ownKeyCost: 10, moaKeyCost: 20, provider: "OpenAI" },
  "anthropic/claude-opus-4-6": { name: "Claude Opus 4.6", ownKeyCost: 15, moaKeyCost: 30, provider: "Anthropic" },
};

export default function BillingPage() {
  const [userId] = useState(() => {
    if (typeof window !== "undefined") {
      let id = localStorage.getItem("moa_user_id");
      if (!id) {
        id = `user_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
        localStorage.setItem("moa_user_id", id);
      }
      return id;
    }
    return "anonymous";
  });

  const [creditInfo, setCreditInfo] = useState<CreditInfo | null>(null);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [payments, setPayments] = useState<Payment[]>([]);
  const [activeTab, setActiveTab] = useState<"plans" | "credits" | "history">("plans");
  const [processing, setProcessing] = useState(false);
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);
  const [currency, setCurrency] = useState<Currency>("krw");

  const plans = currency === "krw" ? PLANS_KRW : PLANS_USD;
  const creditPacks = currency === "krw" ? CREDIT_PACKS_KRW : CREDIT_PACKS_USD;
  const i18n = currency === "krw"
    ? {
        creditBalance: "\ub0b4 \ud06c\ub808\ub527 \uc794\uc561",
        plan: "\ud50c\ub79c",
        monthlyCredits: "\uc6d4",
        usageThisMonth: "\uc774\ubc88 \ub2ec \uc0ac\uc6a9\ub7c9",
        reset: "\ub9ac\uc14b",
        tabs: { plans: "\uc694\uae08\uc81c", credits: "\ud06c\ub808\ub527 \ucda9\uc804", history: "\uacb0\uc81c \ub0b4\uc5ed" },
        creditPackages: "\ud06c\ub808\ub527 \ud328\ud0a4\uc9c0",
        credits: "\ud06c\ub808\ub527",
        buy: "\uad6c\ub9e4\ud558\uae30",
        perCredit: "\ud06c\ub808\ub527\ub2f9",
        subscribe: "\uad6c\ub3c5\ud558\uae30",
        currentPlan: "\ud604\uc7ac \ud50c\ub79c",
        inUse: "\ud604\uc7ac \uc0ac\uc6a9 \uc911",
        cancelSub: "\uad6c\ub3c5 \ucde8\uc18c",
        processing: "\ucc98\ub9ac \uc911...",
        modelCosts: "\ubaa8\ub378\ubcc4 \ud06c\ub808\ub527 \ube44\uc6a9",
        modelCostsDesc: "\uc790\uccb4 API \ud0a4\ub97c \ub4f1\ub85d\ud558\uba74 1x \uc694\uae08, MoA \ud0a4\ub97c \uc0ac\uc6a9\ud558\uba74 2x \uc694\uae08\uc774 \uc801\uc6a9\ub429\ub2c8\ub2e4.",
        savingTipTitle: "\ud06c\ub808\ub527 \uc808\uc57d \ud301",
        savingTipDesc: "\ub9c8\uc774\ud398\uc774\uc9c0\uc5d0\uc11c \uc790\uccb4 API \ud0a4\ub97c \ub4f1\ub85d\ud558\uba74 \ud06c\ub808\ub527\uc774 \uc808\ubc18\ub9cc \ucc28\uac10\ub429\ub2c8\ub2e4. Groq, Gemini \ub4f1 \ubb34\ub8cc API \ud0a4\ub97c \ubc1c\uae09\ubc1b\uc544 \ub4f1\ub85d\ud558\uba74 \ub354 \ub9ce\uc740 \ub300\ud654\ub97c \ud560 \uc218 \uc788\uc5b4\uc694!",
        savingTipLink: "\ub9c8\uc774\ud398\uc774\uc9c0\uc5d0\uc11c API \ud0a4 \ub4f1\ub85d\ud558\uae30",
        creditUsageHistory: "\ud06c\ub808\ub527 \uc0ac\uc6a9 \ub0b4\uc5ed",
        noUsageHistory: "\uc544\uc9c1 \uc0ac\uc6a9 \ub0b4\uc5ed\uc774 \uc5c6\uc2b5\ub2c8\ub2e4.",
        paymentHistory: "\uacb0\uc81c \ub0b4\uc5ed",
        noPaymentHistory: "\uc544\uc9c1 \uacb0\uc81c \ub0b4\uc5ed\uc774 \uc5c6\uc2b5\ub2c8\ub2e4.",
        confirmCancel: "\uc815\ub9d0 \uad6c\ub3c5\uc744 \ucde8\uc18c\ud558\uc2dc\uaca0\uc2b5\ub2c8\uae4c? \ud604\uc7ac \uacb0\uc81c \uae30\uac04\uc774 \ub05d\ub0a0 \ub54c\uae4c\uc9c0\ub294 \uacc4\uc18d \uc0ac\uc6a9\ud560 \uc218 \uc788\uc2b5\ub2c8\ub2e4.",
        headerTitle: "\uacb0\uc81c \ubc0f \ud06c\ub808\ub527",
        headerDesc: "\uc694\uae08\uc81c \uc120\ud0dd, \ud06c\ub808\ub527 \ucda9\uc804, \uacb0\uc81c \ub0b4\uc5ed\uc744 \uad00\ub9ac\ud558\uc138\uc694.",
        mypage: "\ub9c8\uc774\ud398\uc774\uc9c0",
        goToChat: "\ucc44\ud305\uc73c\ub85c \uac00\uae30",
      }
    : {
        creditBalance: "Credit Balance",
        plan: "Plan",
        monthlyCredits: "/mo",
        usageThisMonth: "Usage this month",
        reset: "Reset",
        tabs: { plans: "Plans", credits: "Buy Credits", history: "History" },
        creditPackages: "Credit Packages",
        credits: "credits",
        buy: "Buy",
        perCredit: "per credit",
        subscribe: "Subscribe",
        currentPlan: "Current",
        inUse: "Current Plan",
        cancelSub: "Cancel",
        processing: "Processing...",
        modelCosts: "Model Credit Costs",
        modelCostsDesc: "Register your own API key for 1x rate, or use MoA keys at 2x rate.",
        savingTipTitle: "Credit Saving Tip",
        savingTipDesc: "Register your own API keys on My Page to pay only half the credits. Get free API keys from Groq, Gemini, and more!",
        savingTipLink: "Register API Keys on My Page",
        creditUsageHistory: "Credit Usage History",
        noUsageHistory: "No usage history yet.",
        paymentHistory: "Payment History",
        noPaymentHistory: "No payment history yet.",
        confirmCancel: "Cancel your subscription? You can continue using it until the end of the current billing period.",
        headerTitle: "Billing & Credits",
        headerDesc: "Choose a plan, buy credits, and manage your payment history.",
        mypage: "My Page",
        goToChat: "Go to Chat",
      };

  const getToken = useCallback(() => {
    if (typeof window !== "undefined") {
      return localStorage.getItem("moa_session_token") ?? undefined;
    }
    return undefined;
  }, []);

  const loadData = useCallback(async () => {
    try {
      const token = getToken();
      const [creditsRes, paymentRes] = await Promise.all([
        fetch(`/api/credits?user_id=${encodeURIComponent(userId)}&history=true`),
        fetch(`/api/payment?user_id=${encodeURIComponent(userId)}`),
      ]);

      if (creditsRes.ok) {
        const data = await creditsRes.json();
        setCreditInfo({
          balance: data.balance,
          plan: data.plan,
          monthly_quota: data.monthly_quota,
          monthly_used: data.monthly_used,
          quota_reset_at: data.quota_reset_at,
        });
        setTransactions(data.history ?? []);
      }

      if (paymentRes.ok) {
        // Load payment history (both PortOne and Stripe)
        const histRes = await fetch("/api/payment", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "history", user_id: userId, token }),
        });
        if (histRes.ok) {
          const histData = await histRes.json();
          setPayments(histData.payments ?? []);
        }
      }
    } catch { /* silent */ }
  }, [userId, getToken]);

  useEffect(() => { loadData(); }, [loadData]);

  // Handle Stripe redirect success
  useEffect(() => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    const stripeSuccess = params.get("stripe_success");
    const paymentId = params.get("payment_id");

    if (stripeSuccess === "true" && paymentId) {
      // Verify Stripe payment
      const token = getToken();
      fetch("/api/payment/stripe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "verify",
          user_id: userId,
          payment_id: paymentId,
          token,
        }),
      })
        .then((res) => res.json())
        .then((data) => {
          if (data.success) {
            setMessage({
              type: "success",
              text: data.already_paid
                ? "Payment already confirmed!"
                : `Payment complete! ${data.credits_added ?? ""} credits added.`,
            });
            loadData();
          } else {
            setMessage({
              type: "success",
              text: "Payment is being processed. Credits will be added shortly.",
            });
          }
        })
        .catch(() => {
          setMessage({ type: "success", text: "Payment submitted. Credits will be added once confirmed." });
        });

      // Clean up URL
      window.history.replaceState({}, "", "/billing");
    }

    if (params.get("stripe_cancel") === "true") {
      setMessage({ type: "error", text: currency === "krw" ? "\uacb0\uc81c\uac00 \ucde8\uc18c\ub418\uc5c8\uc2b5\ub2c8\ub2e4." : "Payment was canceled." });
      window.history.replaceState({}, "", "/billing");
    }
  }, [userId, getToken, loadData, currency]);

  /** Handle KRW purchase via PortOne */
  const handlePurchaseKRW = async (productType: "subscription" | "credit_pack", productId: string) => {
    setProcessing(true);
    setMessage(null);

    try {
      const token = getToken();
      const prepRes = await fetch("/api/payment", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "prepare",
          user_id: userId,
          product_type: productType,
          product_id: productId,
          token,
        }),
      });

      const prepData = await prepRes.json();
      if (!prepData.success) {
        setMessage({ type: "error", text: prepData.error ?? "\uacb0\uc81c \uc900\ube44 \uc2e4\ud328" });
        return;
      }

      const IMP = (window as unknown as { IMP?: { init: (id: string) => void; request_pay: (params: Record<string, unknown>, callback: (response: { success: boolean; imp_uid?: string; error_msg?: string }) => void) => void } }).IMP;

      if (!IMP) {
        setMessage({
          type: "error",
          text: "\uacb0\uc81c \uc2dc\uc2a4\ud15c \ub85c\ub529 \uc911\uc785\ub2c8\ub2e4. \ud398\uc774\uc9c0\ub97c \uc0c8\ub85c\uace0\uce68 \ud6c4 \ub2e4\uc2dc \uc2dc\ub3c4\ud574\uc8fc\uc138\uc694.",
        });
        return;
      }

      const merchantId = process.env.NEXT_PUBLIC_PORTONE_MERCHANT_ID ?? "imp00000000";
      IMP.init(merchantId);

      IMP.request_pay(
        {
          pg: "html5_inicis",
          pay_method: "card",
          merchant_uid: prepData.payment_id,
          name: prepData.product_name,
          amount: prepData.amount,
          buyer_name: "MoA User",
          m_redirect_url: `${window.location.origin}/billing?payment_id=${prepData.payment_id}`,
        },
        async (response: { success: boolean; imp_uid?: string; error_msg?: string }) => {
          if (response.success && response.imp_uid) {
            const verifyRes = await fetch("/api/payment", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                action: "verify",
                user_id: userId,
                imp_uid: response.imp_uid,
                payment_id: prepData.payment_id,
                token,
              }),
            });

            const verifyData = await verifyRes.json();
            if (verifyData.success) {
              setMessage({
                type: "success",
                text: `\uacb0\uc81c \uc644\ub8cc! ${prepData.credits} \ud06c\ub808\ub527\uc774 \ucda9\uc804\ub418\uc5c8\uc2b5\ub2c8\ub2e4.`,
              });
              loadData();
            } else {
              setMessage({ type: "error", text: verifyData.error ?? "\uacb0\uc81c \uac80\uc99d \uc2e4\ud328" });
            }
          } else {
            setMessage({ type: "error", text: response.error_msg ?? "\uacb0\uc81c\uac00 \ucde8\uc18c\ub418\uc5c8\uc2b5\ub2c8\ub2e4." });
          }
        }
      );
    } catch {
      setMessage({ type: "error", text: "\uacb0\uc81c \ucc98\ub9ac \uc911 \uc624\ub958\uac00 \ubc1c\uc0dd\ud588\uc2b5\ub2c8\ub2e4." });
    } finally {
      setProcessing(false);
    }
  };

  /** Handle USD purchase via Stripe Checkout */
  const handlePurchaseUSD = async (productType: "subscription" | "credit_pack", productId: string) => {
    setProcessing(true);
    setMessage(null);

    try {
      const token = getToken();
      const res = await fetch("/api/payment/stripe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "create_checkout",
          user_id: userId,
          product_type: productType,
          product_id: productId,
          token,
        }),
      });

      const data = await res.json();
      if (!data.success || !data.checkout_url) {
        setMessage({ type: "error", text: data.error ?? "Failed to create checkout session" });
        return;
      }

      // Redirect to Stripe Checkout
      window.location.href = data.checkout_url;
    } catch {
      setMessage({ type: "error", text: "Payment processing error. Please try again." });
    } finally {
      setProcessing(false);
    }
  };

  const handlePurchase = (productType: "subscription" | "credit_pack", productId: string) => {
    if (currency === "krw") {
      handlePurchaseKRW(productType, productId);
    } else {
      handlePurchaseUSD(productType, productId);
    }
  };

  const handleCancelSubscription = async () => {
    if (!confirm(i18n.confirmCancel)) return;

    try {
      const token = getToken();
      const endpoint = currency === "usd" ? "/api/payment/stripe" : "/api/payment";
      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "cancel_subscription", user_id: userId, token }),
      });
      const data = await res.json();
      if (data.success) {
        setMessage({ type: "success", text: data.message });
        loadData();
      } else {
        setMessage({ type: "error", text: data.error ?? "Failed to cancel" });
      }
    } catch {
      setMessage({ type: "error", text: "Network error" });
    }
  };

  const usagePercent = creditInfo
    ? Math.min(100, Math.round((creditInfo.monthly_used / Math.max(1, creditInfo.monthly_quota)) * 100))
    : 0;

  const planName = plans.find((p) => p.id === creditInfo?.plan)?.name ?? "Free";

  const formatAmount = (amount: number, cur?: string) => {
    const c = cur ?? (currency === "krw" ? "krw" : "usd");
    if (c === "usd") return `$${(amount / 100).toFixed(2)}`;
    return `${amount.toLocaleString()}\uc6d0`;
  };

  return (
    <>
      <Nav />
      {/* PortOne SDK (only needed for KRW) */}
      {currency === "krw" && (
        <script src="https://cdn.iamport.kr/v1/iamport.js" async />
      )}

      <main style={{ paddingTop: "100px", minHeight: "100vh" }}>
        <div className="container" style={{ maxWidth: "1000px" }}>
          {/* Header */}
          <div style={{ marginBottom: "32px" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: "12px" }}>
              <div>
                <Link href="/mypage" style={{ color: "var(--text-muted)", fontSize: "0.9rem", marginBottom: "16px", display: "inline-block" }}>
                  &larr; {i18n.mypage}
                </Link>
                <h1 style={{ fontSize: "2rem", fontWeight: 800, marginBottom: "8px" }}>
                  {i18n.headerTitle}
                </h1>
                <p style={{ color: "var(--text-muted)" }}>
                  {i18n.headerDesc}
                </p>
              </div>

              {/* Currency Toggle */}
              <div style={{
                display: "flex", gap: "0", borderRadius: "8px", overflow: "hidden",
                border: "1px solid var(--border)", marginTop: "28px",
              }}>
                <button
                  onClick={() => setCurrency("krw")}
                  style={{
                    padding: "8px 16px", border: "none", cursor: "pointer",
                    fontSize: "0.85rem", fontWeight: 600,
                    background: currency === "krw" ? "var(--primary)" : "var(--card-bg)",
                    color: currency === "krw" ? "white" : "var(--text-muted)",
                  }}
                >
                  KRW (\uc6d0)
                </button>
                <button
                  onClick={() => setCurrency("usd")}
                  style={{
                    padding: "8px 16px", border: "none", cursor: "pointer",
                    fontSize: "0.85rem", fontWeight: 600,
                    background: currency === "usd" ? "var(--primary)" : "var(--card-bg)",
                    color: currency === "usd" ? "white" : "var(--text-muted)",
                  }}
                >
                  USD ($)
                </button>
              </div>
            </div>
          </div>

          {/* Status message */}
          {message && (
            <div style={{
              padding: "12px 16px", borderRadius: "var(--radius)", marginBottom: "24px",
              background: message.type === "success" ? "rgba(72,187,120,0.15)" : "rgba(252,129,129,0.15)",
              border: `1px solid ${message.type === "success" ? "var(--success)" : "var(--danger)"}`,
              color: message.type === "success" ? "var(--success)" : "var(--danger)",
              fontSize: "0.9rem",
            }}>
              {message.text}
            </div>
          )}

          {/* Credit Balance Card */}
          <div className="card" style={{
            marginBottom: "32px",
            background: "linear-gradient(135deg, rgba(102,126,234,0.15), rgba(118,75,162,0.15))",
            border: "1px solid rgba(102,126,234,0.3)",
          }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: "20px" }}>
              <div>
                <p style={{ color: "var(--text-muted)", fontSize: "0.85rem", marginBottom: "4px" }}>{i18n.creditBalance}</p>
                <div style={{ fontSize: "2.5rem", fontWeight: 800, color: "var(--primary)" }}>
                  {creditInfo?.balance?.toLocaleString() ?? "100"}
                </div>
                <p style={{ color: "var(--text-muted)", fontSize: "0.85rem" }}>
                  {planName} {i18n.plan} &middot; {creditInfo?.monthly_quota?.toLocaleString() ?? "100"} {i18n.credits}{i18n.monthlyCredits}
                </p>
              </div>
              <div style={{ minWidth: "200px" }}>
                <p style={{ fontSize: "0.8rem", color: "var(--text-muted)", marginBottom: "6px" }}>
                  {i18n.usageThisMonth}: {creditInfo?.monthly_used ?? 0} / {creditInfo?.monthly_quota ?? 100}
                </p>
                <div style={{
                  height: "8px", borderRadius: "4px", background: "rgba(255,255,255,0.1)", overflow: "hidden",
                }}>
                  <div style={{
                    height: "100%", borderRadius: "4px", width: `${usagePercent}%`,
                    background: usagePercent > 80 ? "var(--danger)" : "var(--primary)",
                    transition: "width 0.3s",
                  }} />
                </div>
                {creditInfo?.quota_reset_at && (
                  <p style={{ fontSize: "0.75rem", color: "var(--text-muted)", marginTop: "4px" }}>
                    {i18n.reset}: {new Date(creditInfo.quota_reset_at).toLocaleDateString(currency === "krw" ? "ko-KR" : "en-US")}
                  </p>
                )}
              </div>
            </div>
          </div>

          {/* Tabs */}
          <div style={{ display: "flex", gap: "4px", marginBottom: "24px", borderBottom: "1px solid var(--border)", paddingBottom: "4px" }}>
            {([
              { id: "plans" as const, label: i18n.tabs.plans },
              { id: "credits" as const, label: i18n.tabs.credits },
              { id: "history" as const, label: i18n.tabs.history },
            ]).map((tab) => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                style={{
                  padding: "8px 20px", border: "none", borderRadius: "8px 8px 0 0",
                  background: activeTab === tab.id ? "var(--primary)" : "transparent",
                  color: activeTab === tab.id ? "white" : "var(--text-muted)",
                  cursor: "pointer", fontSize: "0.9rem", fontWeight: 600,
                }}
              >
                {tab.label}
              </button>
            ))}
          </div>

          {/* === Plans Tab === */}
          {activeTab === "plans" && (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: "16px", marginBottom: "48px" }}>
              {plans.map((plan) => {
                const isCurrent = creditInfo?.plan === plan.id;
                return (
                  <div
                    key={plan.id}
                    className="card"
                    style={{
                      border: plan.highlight ? "2px solid var(--primary)" : isCurrent ? "2px solid var(--success)" : "1px solid var(--border)",
                      position: "relative",
                    }}
                  >
                    {plan.badge && (
                      <span style={{
                        position: "absolute", top: "-10px", right: "16px",
                        background: "var(--primary)", color: "white",
                        padding: "2px 12px", borderRadius: "10px",
                        fontSize: "0.75rem", fontWeight: 700,
                      }}>
                        {plan.badge}
                      </span>
                    )}
                    {isCurrent && (
                      <span style={{
                        position: "absolute", top: "-10px", left: "16px",
                        background: "var(--success)", color: "white",
                        padding: "2px 12px", borderRadius: "10px",
                        fontSize: "0.75rem", fontWeight: 700,
                      }}>
                        {i18n.currentPlan}
                      </span>
                    )}
                    <h3 style={{ fontSize: "1.3rem", marginBottom: "8px", marginTop: "8px" }}>{plan.name}</h3>
                    <div style={{ marginBottom: "16px" }}>
                      <span style={{ fontSize: "2rem", fontWeight: 800 }}>{plan.priceLabel}</span>
                      {plan.price > 0 && <span style={{ color: "var(--text-muted)", fontSize: "0.9rem" }}>/{plan.period}</span>}
                      {plan.price === 0 && <span style={{ color: "var(--text-muted)", fontSize: "0.9rem" }}> ({plan.period})</span>}
                    </div>
                    <p style={{ color: "var(--primary)", fontWeight: 600, marginBottom: "16px", fontSize: "0.9rem" }}>
                      {plan.credits.toLocaleString()} {i18n.credits}{i18n.monthlyCredits}
                    </p>
                    <ul style={{ listStyle: "none", padding: 0, margin: "0 0 20px 0", display: "flex", flexDirection: "column", gap: "8px" }}>
                      {plan.features.map((f) => (
                        <li key={f} style={{ fontSize: "0.85rem", color: "var(--text-muted)" }}>
                          {"✓"} {f}
                        </li>
                      ))}
                    </ul>
                    {isCurrent ? (
                      plan.id !== "free" ? (
                        <button
                          className="btn btn-outline"
                          onClick={handleCancelSubscription}
                          style={{ width: "100%", fontSize: "0.85rem" }}
                        >
                          {i18n.cancelSub}
                        </button>
                      ) : (
                        <button className="btn btn-outline" disabled style={{ width: "100%", fontSize: "0.85rem", opacity: 0.5 }}>
                          {i18n.inUse}
                        </button>
                      )
                    ) : (
                      plan.price > 0 && (
                        <button
                          className="btn btn-primary"
                          onClick={() => handlePurchase("subscription", plan.id)}
                          disabled={processing}
                          style={{ width: "100%", fontSize: "0.85rem" }}
                        >
                          {processing ? i18n.processing : `${plan.priceLabel}/${plan.period} ${i18n.subscribe}`}
                        </button>
                      )
                    )}
                  </div>
                );
              })}
            </div>
          )}

          {/* === Credits Tab === */}
          {activeTab === "credits" && (
            <>
              <h3 style={{ fontSize: "1.2rem", marginBottom: "16px" }}>{i18n.creditPackages}</h3>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: "12px", marginBottom: "32px" }}>
                {creditPacks.map((pack) => (
                  <div key={pack.id} className="card" style={{ textAlign: "center", position: "relative" }}>
                    {pack.badge && (
                      <span style={{
                        position: "absolute", top: "-8px", right: "12px",
                        background: "var(--primary)", color: "white",
                        padding: "2px 10px", borderRadius: "8px",
                        fontSize: "0.7rem", fontWeight: 700,
                      }}>
                        {pack.badge}
                      </span>
                    )}
                    <div style={{ fontSize: "2rem", fontWeight: 800, color: "var(--primary)", margin: "8px 0" }}>
                      {pack.credits.toLocaleString()}
                    </div>
                    <p style={{ fontSize: "0.8rem", color: "var(--text-muted)", marginBottom: "8px" }}>{i18n.credits}</p>
                    <div style={{ fontSize: "1.2rem", fontWeight: 700, marginBottom: "4px" }}>
                      {pack.priceLabel}
                    </div>
                    <p style={{ fontSize: "0.75rem", color: "var(--success)", marginBottom: "12px" }}>
                      {pack.perCredit} {i18n.perCredit}
                    </p>
                    <button
                      className="btn btn-primary btn-sm"
                      onClick={() => handlePurchase("credit_pack", pack.id)}
                      disabled={processing}
                      style={{ width: "100%" }}
                    >
                      {processing ? "..." : i18n.buy}
                    </button>
                  </div>
                ))}
              </div>

              {/* Model Cost Table */}
              <h3 style={{ fontSize: "1.2rem", marginBottom: "8px" }}>{i18n.modelCosts}</h3>
              <p style={{ color: "var(--text-muted)", fontSize: "0.85rem", marginBottom: "16px" }}>
                {i18n.modelCostsDesc}
              </p>
              <div className="card" style={{ marginBottom: "24px", overflowX: "auto" }}>
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.85rem" }}>
                  <thead>
                    <tr style={{ borderBottom: "1px solid var(--border)" }}>
                      <th style={{ textAlign: "left", padding: "8px 12px", color: "var(--text-muted)" }}>
                        {currency === "krw" ? "\ubaa8\ub378" : "Model"}
                      </th>
                      <th style={{ textAlign: "left", padding: "8px 12px", color: "var(--text-muted)" }}>
                        {currency === "krw" ? "\uc81c\uacf5\uc0ac" : "Provider"}
                      </th>
                      <th style={{ textAlign: "right", padding: "8px 12px", color: "var(--text-muted)" }}>
                        {currency === "krw" ? "\uc790\uccb4 \ud0a4 (1x)" : "Own Key (1x)"}
                      </th>
                      <th style={{ textAlign: "right", padding: "8px 12px", color: "var(--text-muted)" }}>
                        {currency === "krw" ? "MoA \ud0a4 (2x)" : "MoA Key (2x)"}
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {Object.entries(MODEL_COSTS).map(([id, info]) => (
                      <tr key={id} style={{ borderBottom: "1px solid var(--border)" }}>
                        <td style={{ padding: "8px 12px" }}>{info.name}</td>
                        <td style={{ padding: "8px 12px", color: "var(--text-muted)" }}>{info.provider}</td>
                        <td style={{ padding: "8px 12px", textAlign: "right", fontWeight: 600, color: info.ownKeyCost === 0 ? "var(--success)" : "inherit" }}>
                          {info.ownKeyCost === 0 ? (currency === "krw" ? "\ubb34\ub8cc" : "Free") : `${info.ownKeyCost} ${i18n.credits}`}
                        </td>
                        <td style={{ padding: "8px 12px", textAlign: "right", fontWeight: 600, color: info.moaKeyCost === 0 ? "var(--success)" : "var(--text-muted)" }}>
                          {info.moaKeyCost === 0 ? (currency === "krw" ? "\ubb34\ub8cc" : "Free") : `${info.moaKeyCost} ${i18n.credits}`}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* API Key savings tip */}
              <div className="card" style={{
                marginBottom: "48px",
                background: "rgba(72,187,120,0.08)",
                border: "1px solid rgba(72,187,120,0.3)",
              }}>
                <h4 style={{ fontSize: "1rem", marginBottom: "8px" }}>
                  {i18n.savingTipTitle}
                </h4>
                <p style={{ color: "var(--text-muted)", fontSize: "0.85rem", lineHeight: 1.6 }}>
                  {i18n.savingTipDesc}
                </p>
                <div style={{ marginTop: "12px" }}>
                  <Link href="/mypage" style={{ color: "var(--primary)", fontSize: "0.85rem", fontWeight: 600 }}>
                    {i18n.savingTipLink} &rarr;
                  </Link>
                </div>
              </div>
            </>
          )}

          {/* === History Tab === */}
          {activeTab === "history" && (
            <>
              {/* Credit Usage */}
              <h3 style={{ fontSize: "1.2rem", marginBottom: "16px" }}>{i18n.creditUsageHistory}</h3>
              {transactions.length === 0 ? (
                <div className="card" style={{ textAlign: "center", padding: "40px", color: "var(--text-muted)", marginBottom: "32px" }}>
                  {i18n.noUsageHistory}
                </div>
              ) : (
                <div className="card" style={{ marginBottom: "32px", overflowX: "auto" }}>
                  <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.85rem" }}>
                    <thead>
                      <tr style={{ borderBottom: "1px solid var(--border)" }}>
                        <th style={{ textAlign: "left", padding: "8px 12px", color: "var(--text-muted)" }}>
                          {currency === "krw" ? "\uc77c\uc2dc" : "Date"}
                        </th>
                        <th style={{ textAlign: "left", padding: "8px 12px", color: "var(--text-muted)" }}>
                          {currency === "krw" ? "\uc720\ud615" : "Type"}
                        </th>
                        <th style={{ textAlign: "left", padding: "8px 12px", color: "var(--text-muted)" }}>
                          {currency === "krw" ? "\uc124\uba85" : "Description"}
                        </th>
                        <th style={{ textAlign: "right", padding: "8px 12px", color: "var(--text-muted)" }}>
                          {currency === "krw" ? "\uae08\uc561" : "Amount"}
                        </th>
                        <th style={{ textAlign: "right", padding: "8px 12px", color: "var(--text-muted)" }}>
                          {currency === "krw" ? "\uc794\uc561" : "Balance"}
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {transactions.map((tx) => (
                        <tr key={tx.id} style={{ borderBottom: "1px solid var(--border)" }}>
                          <td style={{ padding: "8px 12px", whiteSpace: "nowrap" }}>
                            {new Date(tx.created_at).toLocaleString(currency === "krw" ? "ko-KR" : "en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}
                          </td>
                          <td style={{ padding: "8px 12px" }}>
                            <span style={{
                              fontSize: "0.75rem", padding: "2px 8px", borderRadius: "8px",
                              background: tx.amount > 0 ? "rgba(72,187,120,0.15)" : "rgba(252,129,129,0.15)",
                              color: tx.amount > 0 ? "var(--success)" : "var(--danger)",
                            }}>
                              {tx.tx_type === "usage" ? (currency === "krw" ? "\uc0ac\uc6a9" : "Usage")
                                : tx.tx_type === "purchase" ? (currency === "krw" ? "\ucda9\uc804" : "Purchase")
                                : tx.tx_type === "subscription" ? (currency === "krw" ? "\uad6c\ub3c5" : "Subscription")
                                : tx.tx_type === "monthly_reset" ? (currency === "krw" ? "\ub9ac\uc14b" : "Reset")
                                : tx.tx_type}
                            </span>
                          </td>
                          <td style={{ padding: "8px 12px", color: "var(--text-muted)" }}>
                            {tx.description}
                          </td>
                          <td style={{
                            padding: "8px 12px", textAlign: "right", fontWeight: 600,
                            color: tx.amount > 0 ? "var(--success)" : "var(--danger)",
                          }}>
                            {tx.amount > 0 ? `+${tx.amount}` : tx.amount}
                          </td>
                          <td style={{ padding: "8px 12px", textAlign: "right" }}>
                            {tx.balance_after}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              {/* Payment History */}
              <h3 style={{ fontSize: "1.2rem", marginBottom: "16px" }}>{i18n.paymentHistory}</h3>
              {payments.length === 0 ? (
                <div className="card" style={{ textAlign: "center", padding: "40px", color: "var(--text-muted)", marginBottom: "48px" }}>
                  {i18n.noPaymentHistory}
                </div>
              ) : (
                <div className="card" style={{ marginBottom: "48px", overflowX: "auto" }}>
                  <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.85rem" }}>
                    <thead>
                      <tr style={{ borderBottom: "1px solid var(--border)" }}>
                        <th style={{ textAlign: "left", padding: "8px 12px", color: "var(--text-muted)" }}>
                          {currency === "krw" ? "\uc77c\uc2dc" : "Date"}
                        </th>
                        <th style={{ textAlign: "left", padding: "8px 12px", color: "var(--text-muted)" }}>
                          {currency === "krw" ? "\uc0c1\ud488" : "Product"}
                        </th>
                        <th style={{ textAlign: "right", padding: "8px 12px", color: "var(--text-muted)" }}>
                          {currency === "krw" ? "\uae08\uc561" : "Amount"}
                        </th>
                        <th style={{ textAlign: "center", padding: "8px 12px", color: "var(--text-muted)" }}>
                          {currency === "krw" ? "\uc0c1\ud0dc" : "Status"}
                        </th>
                        <th style={{ textAlign: "right", padding: "8px 12px", color: "var(--text-muted)" }}>
                          {currency === "krw" ? "\ud06c\ub808\ub527" : "Credits"}
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {payments.map((pay) => (
                        <tr key={pay.id} style={{ borderBottom: "1px solid var(--border)" }}>
                          <td style={{ padding: "8px 12px", whiteSpace: "nowrap" }}>
                            {new Date(pay.paid_at ?? pay.created_at).toLocaleDateString(currency === "krw" ? "ko-KR" : "en-US")}
                          </td>
                          <td style={{ padding: "8px 12px" }}>
                            {pay.product_name}
                            {pay.payment_gateway === "stripe" && (
                              <span style={{ fontSize: "0.7rem", color: "var(--text-muted)", marginLeft: "4px" }}>(Stripe)</span>
                            )}
                          </td>
                          <td style={{ padding: "8px 12px", textAlign: "right" }}>
                            {formatAmount(pay.amount, pay.currency)}
                          </td>
                          <td style={{ padding: "8px 12px", textAlign: "center" }}>
                            <span style={{
                              fontSize: "0.75rem", padding: "2px 8px", borderRadius: "8px",
                              background: pay.status === "paid" ? "rgba(72,187,120,0.15)" : "rgba(252,129,129,0.15)",
                              color: pay.status === "paid" ? "var(--success)" : "var(--danger)",
                            }}>
                              {pay.status === "paid" ? (currency === "krw" ? "\uacb0\uc81c\uc644\ub8cc" : "Paid")
                                : pay.status === "pending" ? (currency === "krw" ? "\ub300\uae30\uc911" : "Pending")
                                : pay.status === "failed" ? (currency === "krw" ? "\uc2e4\ud328" : "Failed")
                                : pay.status}
                            </span>
                          </td>
                          <td style={{ padding: "8px 12px", textAlign: "right", color: "var(--primary)", fontWeight: 600 }}>
                            +{pay.credits_granted.toLocaleString()}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </>
          )}

          {/* Footer nav */}
          <div style={{ textAlign: "center", marginBottom: "64px" }}>
            <Link href="/mypage" className="btn btn-outline" style={{ marginRight: "12px" }}>
              {i18n.mypage}
            </Link>
            <Link href="/chat" className="btn btn-primary">
              {i18n.goToChat}
            </Link>
          </div>
        </div>
      </main>
    </>
  );
}
