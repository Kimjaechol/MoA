"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import Nav from "../../components/Nav";

/* ============================================
   LLM Provider Configuration
   ============================================ */

const LLM_PROVIDERS = [
  {
    id: "groq",
    name: "Groq (Kimi K2-0905)",
    icon: "⚡",
    color: "#f97316",
    desc: "Kimi K2-0905 모델을 초고속 Groq 인프라에서 실행. 가성비 전략의 최우선 모델.",
    placeholder: "gsk_...",
    free: true,
    freeNote: "Groq 무료 계정으로 API key 발급 가능",
    docUrl: "https://console.groq.com/keys",
  },
  {
    id: "gemini",
    name: "Google Gemini",
    icon: "💎",
    color: "#4285f4",
    desc: "Gemini 2.5 Flash/Pro. Google AI Studio에서 무료 API key 발급 가능.",
    placeholder: "AIza...",
    free: true,
    freeNote: "Google AI Studio 무료 한도 제공",
    docUrl: "https://aistudio.google.com/apikey",
  },
  {
    id: "openai",
    name: "OpenAI (ChatGPT)",
    icon: "🤖",
    color: "#10a37f",
    desc: "GPT-4o, GPT-5, DALL-E, Whisper, Sora 등 사용 가능.",
    placeholder: "sk-...",
    free: false,
    freeNote: null,
    docUrl: "https://platform.openai.com/api-keys",
  },
  {
    id: "anthropic",
    name: "Anthropic (Claude)",
    icon: "🧠",
    color: "#d4a574",
    desc: "Claude Opus, Sonnet, Haiku. 코드, 분석, 긴 문서에 강점.",
    placeholder: "sk-ant-...",
    free: false,
    freeNote: null,
    docUrl: "https://console.anthropic.com/settings/keys",
  },
  {
    id: "deepseek",
    name: "DeepSeek",
    icon: "🔬",
    color: "#1e40af",
    desc: "DeepSeek Chat/R1. 코딩 및 수학적 추론에 특화된 가성비 모델.",
    placeholder: "sk-...",
    free: false,
    freeNote: null,
    docUrl: "https://platform.deepseek.com/api_keys",
  },
  {
    id: "mistral",
    name: "Mistral AI",
    icon: "🌊",
    color: "#ff7000",
    desc: "Mistral Large/Medium. 유럽 기반 고성능 오픈소스 LLM.",
    placeholder: "...",
    free: false,
    freeNote: null,
    docUrl: "https://console.mistral.ai/api-keys",
  },
  {
    id: "xai",
    name: "xAI (Grok)",
    icon: "🚀",
    color: "#1da1f2",
    desc: "Grok 3. 실시간 웹 검색과 이미지 생성 기능 내장.",
    placeholder: "xai-...",
    free: false,
    freeNote: null,
    docUrl: "https://console.x.ai",
  },
];

const STRATEGY_OPTIONS = [
  {
    id: "cost-efficient",
    icon: "💰",
    title: "최저비용 (가성비 전략)",
    color: "#48bb78",
    desc: "무료 SLM부터 시작하여 단계적으로 상위 모델을 사용합니다.",
    tiers: [
      "① 무료 내장 SLM",
      "② 유료 LLM 무료 한도 (Groq, Gemini 등)",
      "③ 유료 LLM 가성비 (Kimi K2 Groq → Gemini Flash → DeepSeek 등)",
      "④ 유료 LLM 최고 (Opus, GPT-5 등)",
    ],
    note: "이미 구독 중인 유료 LLM이 있다면 해당 모델이 우선 적용됩니다.",
  },
  {
    id: "max-performance",
    icon: "🧠",
    title: "최고지능 (최대성능 전략)",
    color: "#667eea",
    desc: "현 시점 최고 성능의 AI를 항상 사용합니다.",
    tiers: [
      "① 최고 성능 단일 모델 (Opus, GPT-5 등)",
      "② 병렬 멀티 모델 (5개+ 최고급 AI 동시 처리)",
    ],
    note: "복잡한 요청은 자동으로 여러 최고급 모델을 병렬 실행합니다.",
  },
];

/* ============================================
   MyPage Component
   ============================================ */

export default function MyPage() {
  // Simulated user - in production, use auth context
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

  const [apiKeys, setApiKeys] = useState<
    Record<string, { key_hint: string; is_active: boolean }>
  >({});
  const [strategy, setStrategy] = useState("cost-efficient");
  const [trialStatus, setTrialStatus] = useState<{
    isTrialActive: boolean;
    daysLeft: number;
    isPremium: boolean;
  } | null>(null);
  const [creditBalance, setCreditBalance] = useState<number | null>(null);
  const [creditPlan, setCreditPlan] = useState("free");

  const [phone, setPhone] = useState<string | null>(null);
  const [phoneInput, setPhoneInput] = useState("");
  const [phoneEditing, setPhoneEditing] = useState(false);
  const [phoneSaving, setPhoneSaving] = useState(false);
  const [kakaoChannelAdded, setKakaoChannelAdded] = useState(false);

  // Channel linking state
  const [linkedChannels, setLinkedChannels] = useState<
    Array<{ channel: string; channelUserId: string; displayName: string; lastMessageAt: string | null }>
  >([]);
  const [channelLinking, setChannelLinking] = useState<string | null>(null);
  const [channelIdInput, setChannelIdInput] = useState("");
  const [channelDisplayInput, setChannelDisplayInput] = useState("");
  const [channelSaving, setChannelSaving] = useState(false);

  const [editingProvider, setEditingProvider] = useState<string | null>(null);
  const [keyInput, setKeyInput] = useState("");
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);

  // Load user data
  const loadUserData = useCallback(async () => {
    try {
      const res = await fetch(`/api/mypage?user_id=${encodeURIComponent(userId)}`);
      if (!res.ok) return;
      const data = await res.json();

      const keyMap: Record<string, { key_hint: string; is_active: boolean }> = {};
      for (const k of data.apiKeys ?? []) {
        keyMap[k.provider] = { key_hint: k.key_hint, is_active: k.is_active };
      }
      setApiKeys(keyMap);

      if (data.settings?.model_strategy) {
        setStrategy(data.settings.model_strategy);
      }
      if (data.trialStatus) {
        setTrialStatus(data.trialStatus);
      }
      if (data.phone) {
        setPhone(data.phone);
      }
      if (data.kakaoChannelAdded) {
        setKakaoChannelAdded(true);
      }
    } catch {
      // Silent fail on load
    }

    // Load credit balance
    try {
      const credRes = await fetch(`/api/credits?user_id=${encodeURIComponent(userId)}`);
      if (credRes.ok) {
        const credData = await credRes.json();
        setCreditBalance(credData.balance ?? 100);
        setCreditPlan(credData.plan ?? "free");
      }
    } catch { /* silent */ }

    // Load linked channels
    try {
      const token = localStorage.getItem("moa_session_token") ?? "";
      const chRes = await fetch(
        `/api/channels/link?user_id=${encodeURIComponent(userId)}&token=${encodeURIComponent(token)}`,
      );
      if (chRes.ok) {
        const chData = await chRes.json();
        setLinkedChannels(chData.channels ?? []);
      }
    } catch { /* silent */ }
  }, [userId]);

  useEffect(() => {
    loadUserData();
  }, [loadUserData]);

  // Save API key
  const handleSaveKey = async (provider: string) => {
    if (!keyInput.trim()) return;
    setSaving(true);
    setMessage(null);

    try {
      const res = await fetch("/api/mypage", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "save_api_key",
          user_id: userId,
          provider,
          api_key: keyInput.trim(),
        }),
      });

      const data = await res.json();
      if (data.success) {
        setApiKeys((prev) => ({
          ...prev,
          [provider]: { key_hint: data.key_hint, is_active: true },
        }));
        setEditingProvider(null);
        setKeyInput("");
        setMessage({ type: "success", text: `${provider} API key가 저장되었습니다.` });
      } else {
        setMessage({ type: "error", text: data.error || "저장 실패" });
      }
    } catch {
      setMessage({ type: "error", text: "네트워크 오류가 발생했습니다." });
    } finally {
      setSaving(false);
    }
  };

  // Delete API key
  const handleDeleteKey = async (provider: string) => {
    if (!confirm(`${provider} API key를 삭제하시겠습니까?`)) return;

    try {
      const res = await fetch("/api/mypage", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "delete_api_key",
          user_id: userId,
          provider,
        }),
      });

      const data = await res.json();
      if (data.success) {
        setApiKeys((prev) => {
          const next = { ...prev };
          delete next[provider];
          return next;
        });
        setMessage({ type: "success", text: `${provider} API key가 삭제되었습니다.` });
      }
    } catch {
      setMessage({ type: "error", text: "삭제 실패" });
    }
  };

  // Update strategy
  const handleStrategyChange = async (newStrategy: string) => {
    setStrategy(newStrategy);

    try {
      await fetch("/api/mypage", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "update_strategy",
          user_id: userId,
          strategy: newStrategy,
        }),
      });
      setMessage({ type: "success", text: `모델 전략이 변경되었습니다.` });
    } catch {
      setMessage({ type: "error", text: "전략 변경 실패" });
    }
  };

  // Save phone number
  const handleSavePhone = async () => {
    if (!phoneInput.trim()) return;
    setPhoneSaving(true);
    setMessage(null);

    try {
      const res = await fetch("/api/mypage", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "update_phone",
          user_id: userId,
          phone: phoneInput.trim(),
        }),
      });

      const data = await res.json();
      if (data.success) {
        setPhone(data.phone);
        setPhoneEditing(false);
        setPhoneInput("");
        setMessage({
          type: "success",
          text: data.alimtalkSent
            ? "휴대폰 번호가 저장되었습니다. 카카오톡 채널 추가 안내가 발송되었습니다!"
            : "휴대폰 번호가 저장되었습니다.",
        });
      } else {
        setMessage({ type: "error", text: data.error || "저장 실패" });
      }
    } catch {
      setMessage({ type: "error", text: "네트워크 오류가 발생했습니다." });
    } finally {
      setPhoneSaving(false);
    }
  };

  // Resend channel invite
  const handleResendChannelInvite = async () => {
    setMessage(null);
    try {
      const res = await fetch("/api/alimtalk", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "send_channel_invite",
          user_id: userId,
        }),
      });

      const data = await res.json();
      if (data.success) {
        setMessage({
          type: "success",
          text: data.skipped
            ? data.reason
            : "카카오톡 채널 추가 안내가 발송되었습니다!",
        });
      } else {
        setMessage({ type: "error", text: data.error || "발송 실패" });
      }
    } catch {
      setMessage({ type: "error", text: "네트워크 오류가 발생했습니다." });
    }
  };

  // Link channel account
  const handleLinkChannel = async (channel: string) => {
    if (!channelIdInput.trim()) return;
    setChannelSaving(true);
    setMessage(null);

    try {
      const token = localStorage.getItem("moa_session_token") ?? "";
      const res = await fetch("/api/channels/link", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "link",
          user_id: userId,
          token,
          channel,
          channel_user_id: channelIdInput.trim(),
          display_name: channelDisplayInput.trim() || undefined,
        }),
      });

      const data = await res.json();
      if (data.success) {
        setLinkedChannels((prev) => [
          ...prev,
          {
            channel,
            channelUserId: channelIdInput.trim(),
            displayName: channelDisplayInput.trim() || `${channel} user`,
            lastMessageAt: null,
          },
        ]);
        setChannelLinking(null);
        setChannelIdInput("");
        setChannelDisplayInput("");
        setMessage({ type: "success", text: `${channel} 계정이 연결되었습니다.` });
      } else {
        setMessage({ type: "error", text: data.error || "연결 실패" });
      }
    } catch {
      setMessage({ type: "error", text: "네트워크 오류가 발생했습니다." });
    } finally {
      setChannelSaving(false);
    }
  };

  // Unlink channel account
  const handleUnlinkChannel = async (channel: string, channelUserId: string) => {
    if (!confirm(`${channel} 계정 연결을 해제하시겠습니까?`)) return;

    try {
      const token = localStorage.getItem("moa_session_token") ?? "";
      const res = await fetch("/api/channels/link", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "unlink",
          user_id: userId,
          token,
          channel,
          channel_user_id: channelUserId,
        }),
      });

      const data = await res.json();
      if (data.success) {
        setLinkedChannels((prev) =>
          prev.filter((c) => !(c.channel === channel && c.channelUserId === channelUserId)),
        );
        setMessage({ type: "success", text: `${channel} 계정 연결이 해제되었습니다.` });
      }
    } catch {
      setMessage({ type: "error", text: "연결 해제 실패" });
    }
  };

  const configuredCount = Object.keys(apiKeys).length;
  const hasAnyPaidKey = Object.keys(apiKeys).some(
    (p) => !LLM_PROVIDERS.find((lp) => lp.id === p)?.free
  );

  return (
    <>
      <Nav />
      <main style={{ paddingTop: "100px", minHeight: "100vh" }}>
        <div className="container" style={{ maxWidth: "900px" }}>
          {/* Header */}
          <div style={{ marginBottom: "48px" }}>
            <Link
              href="/"
              style={{ color: "var(--text-muted)", fontSize: "0.9rem", marginBottom: "16px", display: "inline-block" }}
            >
              &larr; 홈으로 돌아가기
            </Link>
            <h1 style={{ fontSize: "2rem", fontWeight: 800, marginBottom: "8px" }}>
              마이페이지
            </h1>
            <p style={{ color: "var(--text-muted)", fontSize: "1rem" }}>
              API 키를 관리하고 AI 모델 전략을 설정하세요. MoA는 입력된 API 키를 활용하여 선택한 전략에 따라 모델을 운용합니다.
            </p>
          </div>

          {/* Status message */}
          {message && (
            <div
              style={{
                padding: "12px 16px",
                borderRadius: "var(--radius)",
                marginBottom: "24px",
                background: message.type === "success" ? "rgba(72,187,120,0.15)" : "rgba(252,129,129,0.15)",
                border: `1px solid ${message.type === "success" ? "var(--success)" : "var(--danger)"}`,
                color: message.type === "success" ? "var(--success)" : "var(--danger)",
                fontSize: "0.9rem",
              }}
            >
              {message.text}
            </div>
          )}

          {/* Credit & Plan Status Banner */}
          <div
            className="card"
            style={{
              marginBottom: "32px",
              background: "linear-gradient(135deg, rgba(102,126,234,0.1), rgba(118,75,162,0.1))",
              border: "1px solid rgba(102,126,234,0.3)",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: "16px" }}>
              <div>
                <h3 style={{ fontSize: "1.1rem", marginBottom: "4px" }}>
                  {trialStatus?.isPremium
                    ? "👑 프리미엄 회원"
                    : trialStatus?.isTrialActive
                      ? `🎁 무료 체험 (${trialStatus.daysLeft}일 남음)`
                      : "🎁 무료 체험 (30일)"}
                </h3>
                <p style={{ color: "var(--text-muted)", fontSize: "0.875rem" }}>
                  {hasAnyPaidKey
                    ? "✅ 유료 LLM API 키가 등록되어 있어 모든 기능을 사용할 수 있습니다."
                    : "⚠️ 유료 LLM API 키가 없으면 무료 범위 내에서만 사용 가능합니다. (무료 SLM + 유료 LLM 무료 한도)"}
                </p>
              </div>
              <div style={{ display: "flex", gap: "24px", alignItems: "center" }}>
                <div style={{ textAlign: "center" }}>
                  <div style={{ fontSize: "1.5rem", fontWeight: 800, color: "var(--primary)" }}>
                    {creditBalance !== null ? creditBalance.toLocaleString() : "100"}
                  </div>
                  <div style={{ fontSize: "0.75rem", color: "var(--text-muted)" }}>크레딧 잔액</div>
                </div>
                <div style={{ textAlign: "center" }}>
                  <div style={{ fontSize: "1.5rem", fontWeight: 800, color: "var(--primary)" }}>
                    {configuredCount}/{LLM_PROVIDERS.length}
                  </div>
                  <div style={{ fontSize: "0.75rem", color: "var(--text-muted)" }}>API 키 등록</div>
                </div>
              </div>
            </div>
            <div style={{ marginTop: "16px", display: "flex", gap: "12px", flexWrap: "wrap" }}>
              <Link href="/billing" className="btn btn-sm btn-primary">
                {creditPlan === "free" ? "요금제 업그레이드" : "결제 및 크레딧 관리"}
              </Link>
              <span style={{ fontSize: "0.8rem", color: "var(--text-muted)", alignSelf: "center" }}>
                현재 플랜: <strong>{creditPlan === "free" ? "Free" : creditPlan === "basic" ? "Basic" : "Pro"}</strong>
              </span>
            </div>
          </div>

          {/* ===== Phone & KakaoTalk Channel ===== */}
          <section style={{ marginBottom: "48px" }}>
            <h2 style={{ fontSize: "1.5rem", fontWeight: 700, marginBottom: "8px" }}>
              카카오톡 연동
            </h2>
            <p style={{ color: "var(--text-muted)", fontSize: "0.9rem", marginBottom: "24px" }}>
              휴대폰 번호를 등록하면 카카오톡 채널 추가 안내가 자동으로 발송됩니다.
              채널을 추가하면 카카오톡으로 MoA AI에게 직접 질문하고 지시할 수 있습니다.
            </p>

            <div
              className="card"
              style={{
                padding: "24px",
                border: kakaoChannelAdded
                  ? "1px solid rgba(72,187,120,0.5)"
                  : "1px solid var(--border)",
              }}
            >
              {/* Phone number section */}
              <div style={{ marginBottom: "20px" }}>
                <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "12px" }}>
                  <span style={{ fontSize: "1.3rem" }}>{"📱"}</span>
                  <h3 style={{ fontSize: "1rem", fontWeight: 600 }}>휴대폰 번호</h3>
                  {phone && (
                    <span
                      style={{
                        fontSize: "0.7rem",
                        padding: "2px 8px",
                        borderRadius: "8px",
                        background: "rgba(72,187,120,0.15)",
                        color: "var(--success)",
                        fontWeight: 600,
                      }}
                    >
                      등록됨
                    </span>
                  )}
                </div>

                {phone && !phoneEditing ? (
                  <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
                    <code
                      style={{
                        fontSize: "0.95rem",
                        background: "rgba(0,0,0,0.2)",
                        padding: "6px 12px",
                        borderRadius: "6px",
                        color: "var(--text-muted)",
                      }}
                    >
                      {phone}
                    </code>
                    <button
                      onClick={() => { setPhoneEditing(true); setPhoneInput(""); }}
                      style={{
                        background: "none",
                        border: "none",
                        color: "var(--primary)",
                        cursor: "pointer",
                        fontSize: "0.8rem",
                      }}
                    >
                      변경
                    </button>
                  </div>
                ) : (
                  <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
                    <input
                      type="tel"
                      className="form-input"
                      placeholder="010-1234-5678"
                      value={phoneInput}
                      onChange={(e) => setPhoneInput(e.target.value)}
                      style={{ flex: 1, maxWidth: "280px", fontSize: "0.9rem" }}
                      autoFocus={phoneEditing}
                    />
                    <button
                      className="btn btn-sm btn-primary"
                      onClick={handleSavePhone}
                      disabled={phoneSaving || !phoneInput.trim()}
                    >
                      {phoneSaving ? "저장 중..." : "저장"}
                    </button>
                    {phoneEditing && (
                      <button
                        className="btn btn-sm btn-outline"
                        onClick={() => { setPhoneEditing(false); setPhoneInput(""); }}
                      >
                        취소
                      </button>
                    )}
                  </div>
                )}
                <p style={{ fontSize: "0.8rem", color: "var(--text-muted)", marginTop: "8px" }}>
                  번호 저장 시 카카오톡 채널 추가 안내 알림톡이 자동 발송됩니다.
                </p>
              </div>

              {/* KakaoTalk Channel Status */}
              <div
                style={{
                  borderTop: "1px solid var(--border)",
                  paddingTop: "20px",
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "12px" }}>
                  <span style={{ fontSize: "1.3rem" }}>{"💬"}</span>
                  <h3 style={{ fontSize: "1rem", fontWeight: 600 }}>카카오톡 채널</h3>
                  {kakaoChannelAdded ? (
                    <span
                      style={{
                        fontSize: "0.7rem",
                        padding: "2px 8px",
                        borderRadius: "8px",
                        background: "rgba(72,187,120,0.15)",
                        color: "var(--success)",
                        fontWeight: 600,
                      }}
                    >
                      연결됨
                    </span>
                  ) : (
                    <span
                      style={{
                        fontSize: "0.7rem",
                        padding: "2px 8px",
                        borderRadius: "8px",
                        background: "rgba(236,201,75,0.15)",
                        color: "var(--warning)",
                        fontWeight: 600,
                      }}
                    >
                      미연결
                    </span>
                  )}
                </div>

                {kakaoChannelAdded ? (
                  <p style={{ color: "var(--success)", fontSize: "0.9rem" }}>
                    카카오톡으로 MoA AI와 대화할 수 있습니다.
                  </p>
                ) : (
                  <div>
                    <p style={{ color: "var(--text-muted)", fontSize: "0.9rem", marginBottom: "12px" }}>
                      카카오톡 채널을 추가하면 카카오톡에서 바로 AI에게 질문할 수 있습니다.
                    </p>
                    <div style={{ display: "flex", gap: "12px", flexWrap: "wrap" }}>
                      <a
                        href="https://pf.kakao.com/_xoMoAC"
                        target="_blank"
                        rel="noopener noreferrer"
                        className="btn btn-sm"
                        style={{ background: "#FEE500", color: "#191919", fontWeight: 600 }}
                      >
                        카카오톡 채널 추가하기
                      </a>
                      {phone && (
                        <button
                          className="btn btn-sm btn-outline"
                          onClick={handleResendChannelInvite}
                          style={{ fontSize: "0.8rem" }}
                        >
                          알림톡 다시 받기
                        </button>
                      )}
                    </div>
                  </div>
                )}
              </div>
            </div>
          </section>

          {/* ===== Cross-Channel Linking ===== */}
          <section style={{ marginBottom: "48px" }}>
            <h2 style={{ fontSize: "1.5rem", fontWeight: 700, marginBottom: "8px" }}>
              채널 연동 관리
            </h2>
            <p style={{ color: "var(--text-muted)", fontSize: "0.9rem", marginBottom: "24px" }}>
              텔레그램, 디스코드 등 다른 채널의 계정을 연결하면 크레딧, API 키, 설정을 모든 채널에서 공유할 수 있습니다.
            </p>

            <div className="card" style={{ padding: "24px" }}>
              {/* Linked channels list */}
              {linkedChannels.length > 0 && (
                <div style={{ marginBottom: "20px" }}>
                  <h3 style={{ fontSize: "1rem", fontWeight: 600, marginBottom: "12px" }}>
                    연결된 채널
                  </h3>
                  <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
                    {linkedChannels.map((ch) => {
                      const channelInfo: Record<string, { icon: string; name: string; color: string }> = {
                        kakaotalk: { icon: "\uD83D\uDFE1", name: "KakaoTalk", color: "#FFE812" },
                        kakao: { icon: "\uD83D\uDFE1", name: "KakaoTalk", color: "#FFE812" },
                        telegram: { icon: "\u2708\uFE0F", name: "Telegram", color: "#0088cc" },
                        discord: { icon: "\uD83C\uDFAE", name: "Discord", color: "#5865F2" },
                        slack: { icon: "\uD83D\uDCAC", name: "Slack", color: "#4A154B" },
                        whatsapp: { icon: "\uD83D\uDCDE", name: "WhatsApp", color: "#25D366" },
                        signal: { icon: "\uD83D\uDD12", name: "Signal", color: "#3A76F0" },
                        imessage: { icon: "\uD83D\uDCF1", name: "iMessage", color: "#34C759" },
                        line: { icon: "\uD83D\uDFE2", name: "LINE", color: "#06C755" },
                        msteams: { icon: "\uD83C\uDFE2", name: "MS Teams", color: "#6264A7" },
                        googlechat: { icon: "\uD83D\uDCE8", name: "Google Chat", color: "#1a73e8" },
                        matrix: { icon: "\uD83D\uDD35", name: "Matrix", color: "#0DBD8B" },
                        mattermost: { icon: "\uD83D\uDD37", name: "Mattermost", color: "#0058CC" },
                        "nextcloud-talk": { icon: "\u2601\uFE0F", name: "Nextcloud Talk", color: "#0082c9" },
                        twitch: { icon: "\uD83D\uDFE3", name: "Twitch", color: "#9146FF" },
                        nostr: { icon: "\uD83E\uDD18", name: "Nostr", color: "#8B5CF6" },
                        zalo: { icon: "\uD83D\uDFE6", name: "Zalo", color: "#0068FF" },
                        bluebubbles: { icon: "\uD83D\uDCAD", name: "BlueBubbles", color: "#1DA1F2" },
                        tlon: { icon: "\uD83D\uDE80", name: "Tlon (Urbit)", color: "#2D3748" },
                        web: { icon: "\uD83C\uDF10", name: "Web", color: "#667eea" },
                      };
                      const info = channelInfo[ch.channel] ?? { icon: "📡", name: ch.channel, color: "var(--text-muted)" };

                      return (
                        <div
                          key={`${ch.channel}-${ch.channelUserId}`}
                          style={{
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "space-between",
                            padding: "10px 14px",
                            borderRadius: "8px",
                            background: "rgba(0,0,0,0.15)",
                          }}
                        >
                          <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                            <span style={{ fontSize: "1.2rem" }}>{info.icon}</span>
                            <div>
                              <span style={{ fontWeight: 600, fontSize: "0.9rem", color: info.color }}>
                                {info.name}
                              </span>
                              <span style={{ fontSize: "0.8rem", color: "var(--text-muted)", marginLeft: "8px" }}>
                                {ch.displayName} ({ch.channelUserId.slice(0, 8)}...)
                              </span>
                            </div>
                          </div>
                          <button
                            onClick={() => handleUnlinkChannel(ch.channel, ch.channelUserId)}
                            style={{
                              background: "none",
                              border: "none",
                              color: "var(--danger)",
                              cursor: "pointer",
                              fontSize: "0.8rem",
                            }}
                          >
                            연결 해제
                          </button>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Add new channel */}
              <div style={{ borderTop: linkedChannels.length > 0 ? "1px solid var(--border)" : "none", paddingTop: linkedChannels.length > 0 ? "20px" : "0" }}>
                <h3 style={{ fontSize: "1rem", fontWeight: 600, marginBottom: "12px" }}>
                  새 채널 연결
                </h3>
                <p style={{ fontSize: "0.85rem", color: "var(--text-muted)", marginBottom: "16px" }}>
                  각 채널의 봇에게 메시지를 보내면 자동으로 채널 사용자 ID가 생성됩니다.
                  봇에게 <code>/credits</code> 명령을 보내면 현재 사용자 ID를 확인할 수 있습니다.
                </p>

                {channelLinking ? (
                  <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
                    <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
                      <input
                        type="text"
                        className="form-input"
                        placeholder="채널 사용자 ID"
                        value={channelIdInput}
                        onChange={(e) => setChannelIdInput(e.target.value)}
                        style={{ flex: 1, fontSize: "0.9rem" }}
                        autoFocus
                      />
                      <input
                        type="text"
                        className="form-input"
                        placeholder="표시 이름 (선택)"
                        value={channelDisplayInput}
                        onChange={(e) => setChannelDisplayInput(e.target.value)}
                        style={{ flex: 1, fontSize: "0.9rem" }}
                      />
                    </div>
                    <div style={{ display: "flex", gap: "8px" }}>
                      <button
                        className="btn btn-sm btn-primary"
                        onClick={() => handleLinkChannel(channelLinking)}
                        disabled={channelSaving || !channelIdInput.trim()}
                      >
                        {channelSaving ? "연결 중..." : "연결"}
                      </button>
                      <button
                        className="btn btn-sm btn-outline"
                        onClick={() => { setChannelLinking(null); setChannelIdInput(""); setChannelDisplayInput(""); }}
                      >
                        취소
                      </button>
                    </div>
                  </div>
                ) : (
                  <div style={{ display: "flex", gap: "10px", flexWrap: "wrap" }}>
                    {[
                      // Primary channels
                      { id: "kakaotalk", icon: "\uD83D\uDFE1", name: "KakaoTalk", cat: "primary" },
                      { id: "telegram", icon: "\u2708\uFE0F", name: "Telegram", cat: "primary" },
                      { id: "discord", icon: "\uD83C\uDFAE", name: "Discord", cat: "primary" },
                      { id: "slack", icon: "\uD83D\uDCAC", name: "Slack", cat: "primary" },
                      { id: "whatsapp", icon: "\uD83D\uDCDE", name: "WhatsApp", cat: "primary" },
                      { id: "signal", icon: "\uD83D\uDD12", name: "Signal", cat: "primary" },
                      { id: "imessage", icon: "\uD83D\uDCF1", name: "iMessage", cat: "primary" },
                      { id: "line", icon: "\uD83D\uDFE2", name: "LINE", cat: "primary" },
                      // Extended channels
                      { id: "msteams", icon: "\uD83C\uDFE2", name: "MS Teams", cat: "extended" },
                      { id: "googlechat", icon: "\uD83D\uDCE8", name: "Google Chat", cat: "extended" },
                      { id: "matrix", icon: "\uD83D\uDD35", name: "Matrix", cat: "extended" },
                      { id: "mattermost", icon: "\uD83D\uDD37", name: "Mattermost", cat: "extended" },
                      { id: "nextcloud-talk", icon: "\u2601\uFE0F", name: "Nextcloud Talk", cat: "extended" },
                      // Advanced channels
                      { id: "twitch", icon: "\uD83D\uDFE3", name: "Twitch", cat: "advanced" },
                      { id: "nostr", icon: "\uD83E\uDD18", name: "Nostr", cat: "advanced" },
                      { id: "zalo", icon: "\uD83D\uDFE6", name: "Zalo", cat: "advanced" },
                      { id: "bluebubbles", icon: "\uD83D\uDCAD", name: "BlueBubbles", cat: "advanced" },
                      { id: "tlon", icon: "\uD83D\uDE80", name: "Tlon", cat: "advanced" },
                    ]
                      .filter((ch) => !linkedChannels.some((lc) => lc.channel === ch.id))
                      .map((ch) => (
                        <button
                          key={ch.id}
                          className="btn btn-sm btn-outline"
                          onClick={() => setChannelLinking(ch.id)}
                          style={{
                            display: "flex",
                            alignItems: "center",
                            gap: "6px",
                            opacity: ch.cat === "advanced" ? 0.7 : 1,
                          }}
                        >
                          <span>{ch.icon}</span>
                          <span>{ch.name}</span>
                        </button>
                      ))}
                  </div>
                )}
              </div>
            </div>
          </section>

          {/* ===== Model Strategy Selection ===== */}
          <section style={{ marginBottom: "48px" }}>
            <h2 style={{ fontSize: "1.5rem", fontWeight: 700, marginBottom: "8px" }}>
              AI 모델 전략
            </h2>
            <p style={{ color: "var(--text-muted)", fontSize: "0.9rem", marginBottom: "24px" }}>
              회원가입 시 설정한 전략을 언제든지 변경할 수 있습니다.
            </p>

            <div className="grid-2" style={{ gap: "16px" }}>
              {STRATEGY_OPTIONS.map((opt) => {
                const isSelected = strategy === opt.id;
                return (
                  <button
                    key={opt.id}
                    onClick={() => handleStrategyChange(opt.id)}
                    className="card mypage-strategy-card"
                    style={{
                      textAlign: "left",
                      cursor: "pointer",
                      border: isSelected ? `2px solid ${opt.color}` : "1px solid var(--border)",
                      position: "relative",
                      overflow: "hidden",
                    }}
                  >
                    {isSelected && (
                      <div
                        style={{
                          position: "absolute",
                          top: "12px",
                          right: "12px",
                          background: opt.color,
                          color: "white",
                          padding: "2px 10px",
                          borderRadius: "10px",
                          fontSize: "0.7rem",
                          fontWeight: 700,
                        }}
                      >
                        선택됨
                      </div>
                    )}
                    <div
                      style={{
                        position: "absolute",
                        top: 0,
                        left: 0,
                        right: 0,
                        height: isSelected ? "3px" : "0px",
                        background: opt.color,
                        transition: "height 0.2s",
                      }}
                    />
                    <div style={{ display: "flex", alignItems: "center", gap: "10px", marginBottom: "12px", marginTop: "4px" }}>
                      <span style={{ fontSize: "2rem" }}>{opt.icon}</span>
                      <h3 style={{ fontSize: "1.05rem" }}>{opt.title}</h3>
                    </div>
                    <p style={{ color: "var(--text-muted)", fontSize: "0.85rem", marginBottom: "12px" }}>
                      {opt.desc}
                    </p>
                    <div style={{ display: "flex", flexDirection: "column", gap: "4px", marginBottom: "12px" }}>
                      {opt.tiers.map((tier) => (
                        <span
                          key={tier}
                          style={{
                            fontSize: "0.8rem",
                            color: "var(--text-muted)",
                            padding: "4px 0",
                          }}
                        >
                          {tier}
                        </span>
                      ))}
                    </div>
                    <p style={{ fontSize: "0.75rem", color: opt.color, fontStyle: "italic" }}>
                      {opt.note}
                    </p>
                  </button>
                );
              })}
            </div>
          </section>

          {/* ===== API Key Management ===== */}
          <section style={{ marginBottom: "48px" }}>
            <h2 style={{ fontSize: "1.5rem", fontWeight: 700, marginBottom: "8px" }}>
              LLM API 키 관리
            </h2>
            <p style={{ color: "var(--text-muted)", fontSize: "0.9rem", marginBottom: "8px" }}>
              각 LLM 서비스의 API 키를 입력하면 MoA가 선택한 전략에 따라 자동으로 활용합니다.
              API 키는 이용자가 직접 관리하며, MoA는 입력된 키로만 모델을 운용합니다.
            </p>
            <div
              style={{
                padding: "12px 16px",
                borderRadius: "var(--radius)",
                marginBottom: "24px",
                background: "rgba(236,201,75,0.1)",
                border: "1px solid rgba(236,201,75,0.3)",
                fontSize: "0.85rem",
                color: "var(--warning)",
              }}
            >
              <strong>{"🔐"} 보안 안내:</strong> API 키는 암호화되어 저장되며, MoA 서버에서도 원문을 볼 수 없습니다.
              키는 오직 AI 모델 요청 시에만 복호화되어 사용됩니다.
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
              {LLM_PROVIDERS.map((provider) => {
                const configured = apiKeys[provider.id];
                const isEditing = editingProvider === provider.id;

                return (
                  <div
                    key={provider.id}
                    className="card mypage-provider-card"
                    style={{
                      padding: "20px 24px",
                      border: configured
                        ? `1px solid ${provider.color}40`
                        : "1px solid var(--border)",
                    }}
                  >
                    <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: "16px" }}>
                      <div style={{ flex: 1 }}>
                        <div style={{ display: "flex", alignItems: "center", gap: "10px", marginBottom: "6px" }}>
                          <span style={{ fontSize: "1.5rem" }}>{provider.icon}</span>
                          <h3 style={{ fontSize: "1rem", fontWeight: 600 }}>{provider.name}</h3>
                          {provider.free && (
                            <span
                              style={{
                                fontSize: "0.7rem",
                                padding: "2px 8px",
                                borderRadius: "8px",
                                background: "rgba(72,187,120,0.15)",
                                color: "var(--success)",
                                fontWeight: 600,
                              }}
                            >
                              무료 가능
                            </span>
                          )}
                          {configured && (
                            <span
                              style={{
                                fontSize: "0.7rem",
                                padding: "2px 8px",
                                borderRadius: "8px",
                                background: `${provider.color}20`,
                                color: provider.color,
                                fontWeight: 600,
                              }}
                            >
                              등록됨
                            </span>
                          )}
                        </div>
                        <p style={{ color: "var(--text-muted)", fontSize: "0.85rem", marginBottom: "8px" }}>
                          {provider.desc}
                        </p>
                        {provider.freeNote && (
                          <p style={{ fontSize: "0.8rem", color: "var(--success)", fontStyle: "italic" }}>
                            {provider.freeNote}
                          </p>
                        )}
                        {configured && !isEditing && (
                          <div style={{ marginTop: "8px", display: "flex", alignItems: "center", gap: "12px" }}>
                            <code
                              style={{
                                fontSize: "0.85rem",
                                background: "rgba(0,0,0,0.2)",
                                padding: "4px 10px",
                                borderRadius: "6px",
                                color: "var(--text-muted)",
                              }}
                            >
                              {configured.key_hint}
                            </code>
                            <button
                              onClick={() => {
                                setEditingProvider(provider.id);
                                setKeyInput("");
                              }}
                              style={{
                                background: "none",
                                border: "none",
                                color: "var(--primary)",
                                cursor: "pointer",
                                fontSize: "0.8rem",
                              }}
                            >
                              변경
                            </button>
                            <button
                              onClick={() => handleDeleteKey(provider.id)}
                              style={{
                                background: "none",
                                border: "none",
                                color: "var(--danger)",
                                cursor: "pointer",
                                fontSize: "0.8rem",
                              }}
                            >
                              삭제
                            </button>
                          </div>
                        )}
                      </div>

                      {/* Action button (right side) */}
                      {!configured && !isEditing && (
                        <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: "8px" }}>
                          <button
                            className="btn btn-sm btn-outline"
                            onClick={() => {
                              setEditingProvider(provider.id);
                              setKeyInput("");
                            }}
                          >
                            키 등록
                          </button>
                          <a
                            href={provider.docUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            style={{ fontSize: "0.75rem", color: "var(--text-muted)" }}
                          >
                            키 발급 방법 &rarr;
                          </a>
                        </div>
                      )}
                    </div>

                    {/* Editing mode */}
                    {isEditing && (
                      <div style={{ marginTop: "16px", display: "flex", gap: "8px", alignItems: "center" }}>
                        <input
                          type="password"
                          className="form-input"
                          placeholder={provider.placeholder}
                          value={keyInput}
                          onChange={(e) => setKeyInput(e.target.value)}
                          style={{ flex: 1, fontSize: "0.9rem" }}
                          autoFocus
                        />
                        <button
                          className="btn btn-sm btn-primary"
                          onClick={() => handleSaveKey(provider.id)}
                          disabled={saving || !keyInput.trim()}
                        >
                          {saving ? "저장 중..." : "저장"}
                        </button>
                        <button
                          className="btn btn-sm btn-outline"
                          onClick={() => {
                            setEditingProvider(null);
                            setKeyInput("");
                          }}
                        >
                          취소
                        </button>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </section>

          {/* ===== Free Trial Policy ===== */}
          <section style={{ marginBottom: "48px" }}>
            <div
              className="card"
              style={{
                background: "linear-gradient(135deg, rgba(72,187,120,0.05), rgba(102,126,234,0.05))",
                border: "1px solid var(--border)",
              }}
            >
              <h3 style={{ fontSize: "1.15rem", marginBottom: "16px" }}>
                {"📋"} 무료 체험 정책
              </h3>
              <div style={{ display: "flex", flexDirection: "column", gap: "12px", fontSize: "0.9rem", color: "var(--text-muted)" }}>
                <div style={{ display: "flex", alignItems: "flex-start", gap: "10px" }}>
                  <span style={{ color: "var(--success)", fontWeight: 700, flexShrink: 0 }}>{"✅"}</span>
                  <span>
                    <strong>유료 LLM API 키 보유 시:</strong> 무료 체험 기간 동안 본인의 API 키로 모든 기능을 제한 없이 사용할 수 있습니다. 선택한 전략(가성비/최대성능)에 따라 모델이 자동 운용됩니다.
                  </span>
                </div>
                <div style={{ display: "flex", alignItems: "flex-start", gap: "10px" }}>
                  <span style={{ color: "var(--warning)", fontWeight: 700, flexShrink: 0 }}>{"⚠️"}</span>
                  <span>
                    <strong>유료 LLM API 키 미보유 시:</strong> 무료 체험 기간 동안 무료 범위 내에서만 사용 가능합니다. ({"①"} 무료 내장 SLM + {"②"} 유료 LLM의 무료 한도까지만)
                  </span>
                </div>
                <div style={{ display: "flex", alignItems: "flex-start", gap: "10px" }}>
                  <span style={{ color: "var(--primary)", fontWeight: 700, flexShrink: 0 }}>{"💡"}</span>
                  <span>
                    <strong>Groq와 Gemini는 무료 API 키를 제공합니다.</strong> 위 두 서비스에서 무료 API 키를 발급받으면 가성비 전략의 핵심 모델(Kimi K2-0905, Gemini 2.5 Flash)을 무료로 사용할 수 있습니다.
                  </span>
                </div>
              </div>
            </div>
          </section>

          {/* Back to home */}
          <div style={{ textAlign: "center", marginBottom: "64px" }}>
            <Link href="/" className="btn btn-outline">
              홈으로 돌아가기
            </Link>
          </div>
        </div>
      </main>
    </>
  );
}
