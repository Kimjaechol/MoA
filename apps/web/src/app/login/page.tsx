"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

export default function LoginPage() {
  const router = useRouter();

  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [passphrase, setPassphrase] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [showPassphrase, setShowPassphrase] = useState(false);

  // Redirect if already logged in
  useEffect(() => {
    if (typeof window === "undefined") return;
    const saved = sessionStorage.getItem("moa_web_auth");
    if (saved) {
      try {
        const data = JSON.parse(saved);
        if (data.token) {
          router.push("/chat");
        }
      } catch { /* ignore */ }
    }
  }, [router]);

  const handleLogin = async () => {
    setError("");

    if (!username.trim()) { setError("아이디를 입력해주세요."); return; }
    if (!password) { setError("비밀번호를 입력해주세요."); return; }
    if (!passphrase) { setError("구문번호를 입력해주세요."); return; }

    setLoading(true);

    try {
      const res = await fetch("/api/auth", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "login",
          username: username.trim(),
          password,
          passphrase,
        }),
      });

      const data = await res.json();

      if (data.success) {
        sessionStorage.setItem(
          "moa_web_auth",
          JSON.stringify({
            username: data.username,
            token: data.token,
            user_id: data.user_id,
            display_name: data.display_name,
            devices: data.devices || [],
          }),
        );
        router.push("/chat");
      } else if (data.email_verification_required) {
        // Redirect to email verification page
        sessionStorage.setItem(
          "moa_pending_verification",
          JSON.stringify({
            user_id: data.user_id,
            email: data.email,
            username: data.username,
          }),
        );
        // Resend verification code
        await fetch("/api/auth/email-verify", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: "resend",
            user_id: data.user_id,
          }),
        });
        router.push("/verify-email");
      } else {
        setError(data.error || "로그인에 실패했습니다.");
      }
    } catch {
      setError("서버에 연결할 수 없습니다. 잠시 후 다시 시도해주세요.");
    } finally {
      setLoading(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleLogin();
    }
  };

  return (
    <div style={{
      display: "flex", alignItems: "center", justifyContent: "center",
      minHeight: "100vh", background: "var(--bg)", padding: "24px",
    }}>
      <div style={{
        width: "100%", maxWidth: "420px", padding: "40px 32px",
        background: "var(--bg-card)", borderRadius: "var(--radius-lg)",
        border: "1px solid var(--border)", boxShadow: "var(--shadow)",
      }}>
        {/* Header */}
        <div style={{ textAlign: "center", marginBottom: "32px" }}>
          <Link href="/" style={{ textDecoration: "none", color: "inherit" }}>
            <div style={{ fontSize: "3rem", marginBottom: "8px" }}>{"🤖"}</div>
            <h1 style={{ fontSize: "1.5rem", fontWeight: 800, marginBottom: "4px" }}>MoA 로그인</h1>
          </Link>
          <p style={{ color: "var(--text-muted)", fontSize: "0.85rem" }}>
            로그인하면 어디서든 MoA AI와 대화할 수 있습니다
          </p>
        </div>

        {/* Form */}
        <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
          {/* Username */}
          <div>
            <label style={labelStyle}>아이디</label>
            <input
              type="text"
              placeholder="아이디를 입력하세요"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              onKeyDown={handleKeyDown}
              autoComplete="username"
              style={inputStyle}
            />
          </div>

          {/* Password */}
          <div>
            <label style={labelStyle}>비밀번호</label>
            <div style={{ position: "relative" }}>
              <input
                type={showPassword ? "text" : "password"}
                placeholder="비밀번호를 입력하세요"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                onKeyDown={handleKeyDown}
                autoComplete="current-password"
                style={{ ...inputStyle, paddingRight: "48px" }}
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                style={toggleBtnStyle}
                tabIndex={-1}
              >
                {showPassword ? "🙈" : "👁"}
              </button>
            </div>
          </div>

          {/* Passphrase */}
          <div>
            <label style={labelStyle}>구문번호</label>
            <div style={{ position: "relative" }}>
              <input
                type={showPassphrase ? "text" : "password"}
                placeholder="구문번호를 입력하세요"
                value={passphrase}
                onChange={(e) => setPassphrase(e.target.value)}
                onKeyDown={handleKeyDown}
                autoComplete="off"
                style={{ ...inputStyle, paddingRight: "48px" }}
              />
              <button
                type="button"
                onClick={() => setShowPassphrase(!showPassphrase)}
                style={toggleBtnStyle}
                tabIndex={-1}
              >
                {showPassphrase ? "🙈" : "👁"}
              </button>
            </div>
          </div>

          {/* Error Message */}
          {error && (
            <div style={{
              padding: "12px 16px", borderRadius: "var(--radius)",
              background: "rgba(252,129,129,0.1)", border: "1px solid rgba(252,129,129,0.3)",
              color: "var(--danger)", fontSize: "0.85rem", textAlign: "center",
            }}>
              {error}
            </div>
          )}

          {/* Submit */}
          <button
            className="btn btn-primary"
            style={{ width: "100%", padding: "16px", fontSize: "1rem", fontWeight: 700, marginTop: "8px" }}
            onClick={handleLogin}
            disabled={loading}
          >
            {loading ? "로그인 중..." : "로그인"}
          </button>
        </div>

        {/* Footer */}
        <div style={{ textAlign: "center", marginTop: "24px" }}>
          <p style={{ color: "var(--text-muted)", fontSize: "0.85rem" }}>
            계정이 없으신가요?{" "}
            <Link href="/register" style={{ color: "var(--primary)", fontWeight: 600 }}>회원가입</Link>
          </p>
        </div>
      </div>
    </div>
  );
}

// ── Inline styles ──

const labelStyle: React.CSSProperties = {
  display: "block",
  fontSize: "0.85rem",
  fontWeight: 600,
  marginBottom: "6px",
  color: "var(--text)",
};

const inputStyle: React.CSSProperties = {
  width: "100%",
  padding: "12px 16px",
  borderRadius: "var(--radius)",
  border: "1px solid var(--border)",
  background: "var(--bg)",
  color: "var(--text)",
  fontSize: "0.95rem",
  outline: "none",
  transition: "border-color 0.2s",
};

const toggleBtnStyle: React.CSSProperties = {
  position: "absolute",
  right: "12px",
  top: "50%",
  transform: "translateY(-50%)",
  background: "none",
  border: "none",
  cursor: "pointer",
  fontSize: "1rem",
  padding: "4px",
};
