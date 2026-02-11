"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import Nav from "../../components/Nav";

/* ============================================
   Billing & Credits Page
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
  status: string;
  product_name: string;
  credits_granted: number;
  pay_method?: string;
  paid_at?: string;
  created_at: string;
}

const PLANS = [
  {
    id: "free",
    name: "Free",
    price: 0,
    priceLabel: "0원",
    period: "30일 체험",
    credits: 100,
    features: [
      "월 100 크레딧",
      "기본 AI 대화",
      "무료 SLM 무제한",
      "Groq/Gemini 무료 한도",
      "자체 API 키 사용 가능",
    ],
  },
  {
    id: "basic",
    name: "Basic",
    price: 9900,
    priceLabel: "9,900원",
    period: "월",
    credits: 3000,
    badge: "인기",
    highlight: true,
    features: [
      "월 3,000 크레딧",
      "AI 대화 무제한",
      "모든 LLM 모델 사용",
      "100+ 전문 스킬",
      "종합문서 작성",
      "자동코딩 시스템",
      "우선 지원",
    ],
  },
  {
    id: "pro",
    name: "Pro",
    price: 29900,
    priceLabel: "29,900원",
    period: "월",
    credits: 15000,
    features: [
      "월 15,000 크레딧",
      "AI 대화 무제한",
      "최고 성능 모델 우선",
      "모든 스킬 + 커스텀 API",
      "실시간 음성 AI",
      "전담 매니저",
      "커스텀 스킬 개발",
    ],
  },
];

const CREDIT_PACKS = [
  { id: "pack_500", credits: 500, price: 5000, priceLabel: "5,000원", perCredit: "10원" },
  { id: "pack_1500", credits: 1500, price: 12000, priceLabel: "12,000원", perCredit: "8원", badge: "인기" },
  { id: "pack_5000", credits: 5000, price: 35000, priceLabel: "35,000원", perCredit: "7원" },
  { id: "pack_15000", credits: 15000, price: 90000, priceLabel: "90,000원", perCredit: "6원", badge: "최고 할인" },
];

const MODEL_COSTS: Record<string, { name: string; cost: number; provider: string }> = {
  "local/slm-default": { name: "무료 SLM", cost: 0, provider: "MoA" },
  "groq/kimi-k2-0905": { name: "Kimi K2 (Groq)", cost: 1, provider: "Groq" },
  "gemini/gemini-2.5-flash": { name: "Gemini 2.5 Flash", cost: 2, provider: "Google" },
  "deepseek/deepseek-chat": { name: "DeepSeek Chat", cost: 3, provider: "DeepSeek" },
  "openai/gpt-4o-mini": { name: "GPT-4o Mini", cost: 3, provider: "OpenAI" },
  "openai/gpt-4o": { name: "GPT-4o", cost: 5, provider: "OpenAI" },
  "anthropic/claude-haiku-4-5": { name: "Claude Haiku 4.5", cost: 4, provider: "Anthropic" },
  "anthropic/claude-sonnet-4-5": { name: "Claude Sonnet 4.5", cost: 8, provider: "Anthropic" },
  "openai/gpt-5": { name: "GPT-5", cost: 10, provider: "OpenAI" },
  "anthropic/claude-opus-4-6": { name: "Claude Opus 4.6", cost: 15, provider: "Anthropic" },
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

  const loadData = useCallback(async () => {
    try {
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
        // Load payment history
        const histRes = await fetch("/api/payment", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "history", user_id: userId }),
        });
        if (histRes.ok) {
          const histData = await histRes.json();
          setPayments(histData.payments ?? []);
        }
      }
    } catch { /* silent */ }
  }, [userId]);

  useEffect(() => { loadData(); }, [loadData]);

  /** Handle subscription or credit pack purchase */
  const handlePurchase = async (productType: "subscription" | "credit_pack", productId: string) => {
    setProcessing(true);
    setMessage(null);

    try {
      // 1. Prepare payment
      const prepRes = await fetch("/api/payment", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "prepare",
          user_id: userId,
          product_type: productType,
          product_id: productId,
        }),
      });

      const prepData = await prepRes.json();
      if (!prepData.success) {
        setMessage({ type: "error", text: prepData.error ?? "결제 준비 실패" });
        return;
      }

      // 2. Open PortOne payment window
      const IMP = (window as unknown as { IMP?: { init: (id: string) => void; request_pay: (params: Record<string, unknown>, callback: (response: { success: boolean; imp_uid?: string; error_msg?: string }) => void) => void } }).IMP;

      if (!IMP) {
        // PortOne SDK not loaded — show manual instructions
        setMessage({
          type: "error",
          text: "결제 시스템 로딩 중입니다. 페이지를 새로고침 후 다시 시도해주세요.",
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
            // 3. Verify payment
            const verifyRes = await fetch("/api/payment", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                action: "verify",
                user_id: userId,
                imp_uid: response.imp_uid,
                payment_id: prepData.payment_id,
              }),
            });

            const verifyData = await verifyRes.json();
            if (verifyData.success) {
              setMessage({
                type: "success",
                text: `결제 완료! ${prepData.credits} 크레딧이 충전되었습니다.`,
              });
              loadData();
            } else {
              setMessage({ type: "error", text: verifyData.error ?? "결제 검증 실패" });
            }
          } else {
            setMessage({ type: "error", text: response.error_msg ?? "결제가 취소되었습니다." });
          }
        }
      );
    } catch {
      setMessage({ type: "error", text: "결제 처리 중 오류가 발생했습니다." });
    } finally {
      setProcessing(false);
    }
  };

  const handleCancelSubscription = async () => {
    if (!confirm("정말 구독을 취소하시겠습니까? 현재 결제 기간이 끝날 때까지는 계속 사용할 수 있습니다.")) return;

    try {
      const res = await fetch("/api/payment", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "cancel_subscription", user_id: userId }),
      });
      const data = await res.json();
      if (data.success) {
        setMessage({ type: "success", text: data.message });
        loadData();
      } else {
        setMessage({ type: "error", text: data.error ?? "구독 취소 실패" });
      }
    } catch {
      setMessage({ type: "error", text: "네트워크 오류" });
    }
  };

  const usagePercent = creditInfo
    ? Math.min(100, Math.round((creditInfo.monthly_used / Math.max(1, creditInfo.monthly_quota)) * 100))
    : 0;

  const planName = PLANS.find((p) => p.id === creditInfo?.plan)?.name ?? "Free";

  return (
    <>
      <Nav />
      {/* PortOne SDK */}
      <script src="https://cdn.iamport.kr/v1/iamport.js" async />

      <main style={{ paddingTop: "100px", minHeight: "100vh" }}>
        <div className="container" style={{ maxWidth: "1000px" }}>
          {/* Header */}
          <div style={{ marginBottom: "32px" }}>
            <Link href="/mypage" style={{ color: "var(--text-muted)", fontSize: "0.9rem", marginBottom: "16px", display: "inline-block" }}>
              &larr; 마이페이지
            </Link>
            <h1 style={{ fontSize: "2rem", fontWeight: 800, marginBottom: "8px" }}>
              결제 및 크레딧
            </h1>
            <p style={{ color: "var(--text-muted)" }}>
              요금제 선택, 크레딧 충전, 결제 내역을 관리하세요.
            </p>
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
                <p style={{ color: "var(--text-muted)", fontSize: "0.85rem", marginBottom: "4px" }}>내 크레딧 잔액</p>
                <div style={{ fontSize: "2.5rem", fontWeight: 800, color: "var(--primary)" }}>
                  {creditInfo?.balance?.toLocaleString() ?? "100"}
                </div>
                <p style={{ color: "var(--text-muted)", fontSize: "0.85rem" }}>
                  {planName} 플랜 &middot; 월 {creditInfo?.monthly_quota?.toLocaleString() ?? "100"} 크레딧
                </p>
              </div>
              <div style={{ minWidth: "200px" }}>
                <p style={{ fontSize: "0.8rem", color: "var(--text-muted)", marginBottom: "6px" }}>
                  이번 달 사용량: {creditInfo?.monthly_used ?? 0} / {creditInfo?.monthly_quota ?? 100}
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
                    리셋: {new Date(creditInfo.quota_reset_at).toLocaleDateString("ko-KR")}
                  </p>
                )}
              </div>
            </div>
          </div>

          {/* Tabs */}
          <div style={{ display: "flex", gap: "4px", marginBottom: "24px", borderBottom: "1px solid var(--border)", paddingBottom: "4px" }}>
            {([
              { id: "plans", label: "요금제" },
              { id: "credits", label: "크레딧 충전" },
              { id: "history", label: "결제 내역" },
            ] as const).map((tab) => (
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
              {PLANS.map((plan) => {
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
                        현재 플랜
                      </span>
                    )}
                    <h3 style={{ fontSize: "1.3rem", marginBottom: "8px", marginTop: "8px" }}>{plan.name}</h3>
                    <div style={{ marginBottom: "16px" }}>
                      <span style={{ fontSize: "2rem", fontWeight: 800 }}>{plan.priceLabel}</span>
                      {plan.price > 0 && <span style={{ color: "var(--text-muted)", fontSize: "0.9rem" }}>/{plan.period}</span>}
                      {plan.price === 0 && <span style={{ color: "var(--text-muted)", fontSize: "0.9rem" }}> ({plan.period})</span>}
                    </div>
                    <p style={{ color: "var(--primary)", fontWeight: 600, marginBottom: "16px", fontSize: "0.9rem" }}>
                      월 {plan.credits.toLocaleString()} 크레딧
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
                          구독 취소
                        </button>
                      ) : (
                        <button className="btn btn-outline" disabled style={{ width: "100%", fontSize: "0.85rem", opacity: 0.5 }}>
                          현재 사용 중
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
                          {processing ? "처리 중..." : `${plan.priceLabel}/월 구독하기`}
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
              {/* Credit Packs */}
              <h3 style={{ fontSize: "1.2rem", marginBottom: "16px" }}>크레딧 패키지</h3>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: "12px", marginBottom: "32px" }}>
                {CREDIT_PACKS.map((pack) => (
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
                    <p style={{ fontSize: "0.8rem", color: "var(--text-muted)", marginBottom: "8px" }}>크레딧</p>
                    <div style={{ fontSize: "1.2rem", fontWeight: 700, marginBottom: "4px" }}>
                      {pack.priceLabel}
                    </div>
                    <p style={{ fontSize: "0.75rem", color: "var(--success)", marginBottom: "12px" }}>
                      크레딧당 {pack.perCredit}
                    </p>
                    <button
                      className="btn btn-primary btn-sm"
                      onClick={() => handlePurchase("credit_pack", pack.id)}
                      disabled={processing}
                      style={{ width: "100%" }}
                    >
                      {processing ? "..." : "구매하기"}
                    </button>
                  </div>
                ))}
              </div>

              {/* Model Cost Table */}
              <h3 style={{ fontSize: "1.2rem", marginBottom: "16px" }}>모델별 크레딧 비용</h3>
              <div className="card" style={{ marginBottom: "48px", overflowX: "auto" }}>
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.85rem" }}>
                  <thead>
                    <tr style={{ borderBottom: "1px solid var(--border)" }}>
                      <th style={{ textAlign: "left", padding: "8px 12px", color: "var(--text-muted)" }}>모델</th>
                      <th style={{ textAlign: "left", padding: "8px 12px", color: "var(--text-muted)" }}>제공사</th>
                      <th style={{ textAlign: "right", padding: "8px 12px", color: "var(--text-muted)" }}>크레딧/요청</th>
                    </tr>
                  </thead>
                  <tbody>
                    {Object.entries(MODEL_COSTS).map(([id, info]) => (
                      <tr key={id} style={{ borderBottom: "1px solid var(--border)" }}>
                        <td style={{ padding: "8px 12px" }}>{info.name}</td>
                        <td style={{ padding: "8px 12px", color: "var(--text-muted)" }}>{info.provider}</td>
                        <td style={{ padding: "8px 12px", textAlign: "right", fontWeight: 600, color: info.cost === 0 ? "var(--success)" : "inherit" }}>
                          {info.cost === 0 ? "무료" : `${info.cost} 크레딧`}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}

          {/* === History Tab === */}
          {activeTab === "history" && (
            <>
              {/* Credit Usage */}
              <h3 style={{ fontSize: "1.2rem", marginBottom: "16px" }}>크레딧 사용 내역</h3>
              {transactions.length === 0 ? (
                <div className="card" style={{ textAlign: "center", padding: "40px", color: "var(--text-muted)", marginBottom: "32px" }}>
                  아직 사용 내역이 없습니다.
                </div>
              ) : (
                <div className="card" style={{ marginBottom: "32px", overflowX: "auto" }}>
                  <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.85rem" }}>
                    <thead>
                      <tr style={{ borderBottom: "1px solid var(--border)" }}>
                        <th style={{ textAlign: "left", padding: "8px 12px", color: "var(--text-muted)" }}>일시</th>
                        <th style={{ textAlign: "left", padding: "8px 12px", color: "var(--text-muted)" }}>유형</th>
                        <th style={{ textAlign: "left", padding: "8px 12px", color: "var(--text-muted)" }}>설명</th>
                        <th style={{ textAlign: "right", padding: "8px 12px", color: "var(--text-muted)" }}>금액</th>
                        <th style={{ textAlign: "right", padding: "8px 12px", color: "var(--text-muted)" }}>잔액</th>
                      </tr>
                    </thead>
                    <tbody>
                      {transactions.map((tx) => (
                        <tr key={tx.id} style={{ borderBottom: "1px solid var(--border)" }}>
                          <td style={{ padding: "8px 12px", whiteSpace: "nowrap" }}>
                            {new Date(tx.created_at).toLocaleString("ko-KR", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}
                          </td>
                          <td style={{ padding: "8px 12px" }}>
                            <span style={{
                              fontSize: "0.75rem", padding: "2px 8px", borderRadius: "8px",
                              background: tx.amount > 0 ? "rgba(72,187,120,0.15)" : "rgba(252,129,129,0.15)",
                              color: tx.amount > 0 ? "var(--success)" : "var(--danger)",
                            }}>
                              {tx.tx_type === "usage" ? "사용" : tx.tx_type === "purchase" ? "충전" : tx.tx_type === "subscription" ? "구독" : tx.tx_type === "monthly_reset" ? "리셋" : tx.tx_type}
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
              <h3 style={{ fontSize: "1.2rem", marginBottom: "16px" }}>결제 내역</h3>
              {payments.length === 0 ? (
                <div className="card" style={{ textAlign: "center", padding: "40px", color: "var(--text-muted)", marginBottom: "48px" }}>
                  아직 결제 내역이 없습니다.
                </div>
              ) : (
                <div className="card" style={{ marginBottom: "48px", overflowX: "auto" }}>
                  <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.85rem" }}>
                    <thead>
                      <tr style={{ borderBottom: "1px solid var(--border)" }}>
                        <th style={{ textAlign: "left", padding: "8px 12px", color: "var(--text-muted)" }}>일시</th>
                        <th style={{ textAlign: "left", padding: "8px 12px", color: "var(--text-muted)" }}>상품</th>
                        <th style={{ textAlign: "right", padding: "8px 12px", color: "var(--text-muted)" }}>금액</th>
                        <th style={{ textAlign: "center", padding: "8px 12px", color: "var(--text-muted)" }}>상태</th>
                        <th style={{ textAlign: "right", padding: "8px 12px", color: "var(--text-muted)" }}>크레딧</th>
                      </tr>
                    </thead>
                    <tbody>
                      {payments.map((pay) => (
                        <tr key={pay.id} style={{ borderBottom: "1px solid var(--border)" }}>
                          <td style={{ padding: "8px 12px", whiteSpace: "nowrap" }}>
                            {new Date(pay.paid_at ?? pay.created_at).toLocaleDateString("ko-KR")}
                          </td>
                          <td style={{ padding: "8px 12px" }}>{pay.product_name}</td>
                          <td style={{ padding: "8px 12px", textAlign: "right" }}>
                            {pay.amount.toLocaleString()}원
                          </td>
                          <td style={{ padding: "8px 12px", textAlign: "center" }}>
                            <span style={{
                              fontSize: "0.75rem", padding: "2px 8px", borderRadius: "8px",
                              background: pay.status === "paid" ? "rgba(72,187,120,0.15)" : "rgba(252,129,129,0.15)",
                              color: pay.status === "paid" ? "var(--success)" : "var(--danger)",
                            }}>
                              {pay.status === "paid" ? "결제완료" : pay.status === "pending" ? "대기중" : pay.status === "failed" ? "실패" : pay.status}
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
              마이페이지
            </Link>
            <Link href="/chat" className="btn btn-primary">
              채팅으로 가기
            </Link>
          </div>
        </div>
      </main>
    </>
  );
}
