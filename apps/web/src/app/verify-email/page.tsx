"use client";

import { useState, useEffect, useRef } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

export default function VerifyEmailPage() {
  const router = useRouter();

  const [code, setCode] = useState(["", "", "", "", "", ""]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [resending, setResending] = useState(false);
  const [resendCooldown, setResendCooldown] = useState(0);
  const [success, setSuccess] = useState(false);
  const [userInfo, setUserInfo] = useState<{ user_id: string; email: string; username: string } | null>(null);

  const inputRefs = useRef<(HTMLInputElement | null)[]>([]);

  // Load pending verification info
  useEffect(() => {
    if (typeof window === "undefined") return;
    const pending = sessionStorage.getItem("moa_pending_verification");
    if (pending) {
      try {
        const data = JSON.parse(pending);
        if (data.user_id && data.email) {
          setUserInfo(data);
          return;
        }
      } catch { /* ignore */ }
    }
    // No pending verification - redirect to register
    router.push("/register");
  }, [router]);

  // Resend cooldown timer
  useEffect(() => {
    if (resendCooldown <= 0) return;
    const timer = setTimeout(() => setResendCooldown((c) => c - 1), 1000);
    return () => clearTimeout(timer);
  }, [resendCooldown]);

  // Auto-focus first input
  useEffect(() => {
    inputRefs.current[0]?.focus();
  }, [userInfo]);

  const handleCodeChange = (index: number, value: string) => {
    if (!/^\d*$/.test(value)) return; // Only digits

    const newCode = [...code];
    newCode[index] = value.slice(-1); // Only last digit
    setCode(newCode);

    // Auto-advance to next input
    if (value && index < 5) {
      inputRefs.current[index + 1]?.focus();
    }

    // Auto-submit when all 6 digits entered
    if (newCode.every((d) => d) && value) {
      handleVerify(newCode.join(""));
    }
  };

  const handleKeyDown = (index: number, e: React.KeyboardEvent) => {
    if (e.key === "Backspace" && !code[index] && index > 0) {
      inputRefs.current[index - 1]?.focus();
    }
  };

  const handlePaste = (e: React.ClipboardEvent) => {
    e.preventDefault();
    const pasted = e.clipboardData.getData("text").replace(/\D/g, "").slice(0, 6);
    if (pasted.length === 6) {
      const newCode = pasted.split("");
      setCode(newCode);
      inputRefs.current[5]?.focus();
      handleVerify(pasted);
    }
  };

  const handleVerify = async (codeStr: string) => {
    if (!userInfo || loading) return;

    setError("");
    setLoading(true);

    try {
      const res = await fetch("/api/auth/email-verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "verify",
          user_id: userInfo.user_id,
          code: codeStr,
        }),
      });

      const data = await res.json();

      if (data.success && data.token) {
        setSuccess(true);

        // Save session and clean up
        sessionStorage.setItem(
          "moa_web_auth",
          JSON.stringify({
            username: userInfo.username,
            token: data.token,
            user_id: userInfo.user_id,
          }),
        );
        sessionStorage.removeItem("moa_pending_verification");

        setTimeout(() => router.push("/chat"), 2000);
      } else {
        setError(data.error || "인증에 실패했습니다.");
        setCode(["", "", "", "", "", ""]);
        inputRefs.current[0]?.focus();
      }
    } catch {
      setError("서버에 연결할 수 없습니다.");
    } finally {
      setLoading(false);
    }
  };

  const handleResend = async () => {
    if (!userInfo || resending || resendCooldown > 0) return;

    setResending(true);
    setError("");

    try {
      const res = await fetch("/api/auth/email-verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "resend",
          user_id: userInfo.user_id,
        }),
      });

      const data = await res.json();

      if (data.success) {
        setResendCooldown(60); // 60 second cooldown
        setCode(["", "", "", "", "", ""]);
        inputRefs.current[0]?.focus();
      } else {
        setError(data.error || "재발송에 실패했습니다.");
      }
    } catch {
      setError("서버에 연결할 수 없습니다.");
    } finally {
      setResending(false);
    }
  };

  if (!userInfo) {
    return (
      <div style={{
        display: "flex", alignItems: "center", justifyContent: "center",
        minHeight: "100vh", background: "var(--bg)",
      }}>
        <div style={{ color: "var(--text-muted)" }}>로딩 중...</div>
      </div>
    );
  }

  if (success) {
    return (
      <div style={{
        display: "flex", alignItems: "center", justifyContent: "center",
        minHeight: "100vh", background: "var(--bg)",
      }}>
        <div style={{
          textAlign: "center", maxWidth: "420px", padding: "48px 32px",
          background: "var(--bg-card)", borderRadius: "var(--radius-lg)",
          border: "1px solid var(--border)", boxShadow: "var(--shadow)",
        }}>
          <div style={{ fontSize: "3.5rem", marginBottom: "16px" }}>{"🎉"}</div>
          <h2 style={{ fontSize: "1.5rem", fontWeight: 800, marginBottom: "12px" }}>
            이메일 인증 완료!
          </h2>
          <p style={{ color: "var(--text-muted)", fontSize: "0.95rem", lineHeight: 1.6 }}>
            환영합니다! 잠시 후 채팅 페이지로 이동합니다...
          </p>
        </div>
      </div>
    );
  }

  // Mask email: show first 3 chars + domain
  const maskedEmail = userInfo.email.replace(
    /^(.{3}).*@/,
    "$1***@",
  );

  return (
    <div style={{
      display: "flex", alignItems: "center", justifyContent: "center",
      minHeight: "100vh", background: "var(--bg)", padding: "24px",
    }}>
      <div style={{
        width: "100%", maxWidth: "420px", padding: "40px 32px",
        background: "var(--bg-card)", borderRadius: "var(--radius-lg)",
        border: "1px solid var(--border)", boxShadow: "var(--shadow)",
        textAlign: "center",
      }}>
        {/* Header */}
        <div style={{ fontSize: "3rem", marginBottom: "16px" }}>{"📧"}</div>
        <h1 style={{ fontSize: "1.3rem", fontWeight: 800, marginBottom: "8px" }}>이메일 인증</h1>
        <p style={{ color: "var(--text-muted)", fontSize: "0.85rem", marginBottom: "32px", lineHeight: 1.6 }}>
          <strong>{maskedEmail}</strong>로 6자리 인증 코드를 보냈습니다.<br />
          10분 내에 입력해주세요.
        </p>

        {/* 6-digit code input */}
        <div style={{
          display: "flex", gap: "8px", justifyContent: "center", marginBottom: "24px",
        }}>
          {code.map((digit, i) => (
            <input
              key={i}
              ref={(el) => { inputRefs.current[i] = el; }}
              type="text"
              inputMode="numeric"
              maxLength={1}
              value={digit}
              onChange={(e) => handleCodeChange(i, e.target.value)}
              onKeyDown={(e) => handleKeyDown(i, e)}
              onPaste={i === 0 ? handlePaste : undefined}
              style={{
                width: "48px",
                height: "56px",
                textAlign: "center",
                fontSize: "1.5rem",
                fontWeight: 700,
                borderRadius: "var(--radius)",
                border: `2px solid ${digit ? "var(--primary)" : "var(--border)"}`,
                background: "var(--bg)",
                color: "var(--text)",
                outline: "none",
                transition: "border-color 0.2s",
              }}
              disabled={loading}
            />
          ))}
        </div>

        {/* Error */}
        {error && (
          <div style={{
            padding: "10px 16px", borderRadius: "var(--radius)",
            background: "rgba(252,129,129,0.1)", border: "1px solid rgba(252,129,129,0.3)",
            color: "var(--danger)", fontSize: "0.85rem", marginBottom: "16px",
          }}>
            {error}
          </div>
        )}

        {/* Verify Button */}
        <button
          className="btn btn-primary"
          style={{ width: "100%", padding: "14px", fontSize: "1rem", fontWeight: 700, marginBottom: "16px" }}
          onClick={() => handleVerify(code.join(""))}
          disabled={loading || code.some((d) => !d)}
        >
          {loading ? "확인 중..." : "인증하기"}
        </button>

        {/* Resend */}
        <div>
          <button
            onClick={handleResend}
            disabled={resending || resendCooldown > 0}
            style={{
              background: "none",
              border: "none",
              color: resendCooldown > 0 ? "var(--text-muted)" : "var(--primary)",
              fontSize: "0.85rem",
              cursor: resendCooldown > 0 ? "default" : "pointer",
              textDecoration: resendCooldown > 0 ? "none" : "underline",
            }}
          >
            {resending
              ? "발송 중..."
              : resendCooldown > 0
                ? `재발송 (${resendCooldown}초 후)`
                : "인증 코드 재발송"}
          </button>
        </div>

        {/* Back link */}
        <div style={{ marginTop: "24px" }}>
          <Link href="/register" style={{ color: "var(--text-muted)", fontSize: "0.8rem" }}>
            다른 이메일로 가입하기
          </Link>
        </div>
      </div>
    </div>
  );
}
