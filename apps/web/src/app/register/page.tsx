"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { COUNTRY_CODES, type CountryCode } from "@/lib/phone-validation";

/** Sorted country list: Korea first, then alphabetical by English name */
const SORTED_COUNTRIES: CountryCode[] = (() => {
  const kr = COUNTRY_CODES.find((c) => c.code === "KR")!;
  const rest = COUNTRY_CODES
    .filter((c) => c.code !== "KR")
    .sort((a, b) => a.nameEn.localeCompare(b.nameEn));
  return [kr, ...rest];
})();

export default function RegisterPage() {
  const router = useRouter();

  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [passwordConfirm, setPasswordConfirm] = useState("");
  const [passphrase, setPassphrase] = useState("");
  const [nickname, setNickname] = useState("");
  const [countryCode, setCountryCode] = useState("KR");
  const [phone, setPhone] = useState("");

  const [error, setError] = useState("");
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);

  const [modelStrategy, setModelStrategy] = useState("cost-efficient");

  const [showPassword, setShowPassword] = useState(false);
  const [showPassphrase, setShowPassphrase] = useState(false);

  // Get current country info
  const currentCountry = SORTED_COUNTRIES.find((c) => c.code === countryCode)!;

  // Client-side field validation on blur
  const validateField = (field: string, value: string) => {
    const errors = { ...fieldErrors };

    switch (field) {
      case "username":
        if (value && !/^[a-zA-Z0-9가-힣_]{2,30}$/.test(value)) {
          errors.username = "2~30자의 영문, 한글, 숫자, 밑줄(_)만 사용 가능";
        } else {
          delete errors.username;
        }
        break;
      case "email":
        if (value && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) {
          errors.email = "올바른 이메일 형식이 아닙니다";
        } else {
          delete errors.email;
        }
        break;
      case "password":
        if (value && value.length < 8) {
          errors.password = "최소 8자 이상";
        } else {
          delete errors.password;
        }
        if (passwordConfirm && value !== passwordConfirm) {
          errors.passwordConfirm = "비밀번호가 일치하지 않습니다";
        } else {
          delete errors.passwordConfirm;
        }
        break;
      case "passwordConfirm":
        if (value && value !== password) {
          errors.passwordConfirm = "비밀번호가 일치하지 않습니다";
        } else {
          delete errors.passwordConfirm;
        }
        break;
      case "passphrase":
        if (value && value.length < 4) {
          errors.passphrase = "최소 4자 이상";
        } else {
          delete errors.passphrase;
        }
        break;
    }

    setFieldErrors(errors);
  };

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

  const handleSubmit = async () => {
    setError("");
    setFieldErrors({});

    // Client-side validation
    if (!username.trim()) { setError("아이디를 입력해주세요."); return; }
    if (!email.trim()) { setError("이메일을 입력해주세요."); return; }
    if (!password) { setError("비밀번호를 입력해주세요."); return; }
    if (password !== passwordConfirm) { setError("비밀번호가 일치하지 않습니다."); return; }
    if (!passphrase) { setError("구문번호를 입력해주세요."); return; }
    if (!phone.trim()) { setError("휴대폰 번호를 입력해주세요."); return; }

    setLoading(true);

    try {
      const res = await fetch("/api/auth", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "register",
          username: username.trim(),
          email: email.trim(),
          password,
          passphrase,
          nickname: nickname.trim() || undefined,
          country_code: countryCode,
          phone: phone.trim(),
          model_strategy: modelStrategy,
        }),
      });

      let data;
      try {
        data = await res.json();
      } catch {
        setError(`서버 오류가 발생했습니다. (HTTP ${res.status})`);
        return;
      }

      if (data.success) {
        // Send verification email
        await fetch("/api/auth/email-verify", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: "send",
            email: email.trim(),
            user_id: data.user_id,
          }),
        });

        // Save pending verification info (not a full session yet)
        sessionStorage.setItem(
          "moa_pending_verification",
          JSON.stringify({
            user_id: data.user_id,
            email: email.trim(),
            username: data.username,
            display_name: data.display_name,
          }),
        );

        setSuccess(true);
        setTimeout(() => router.push("/verify-email"), 2000);
      } else {
        setError(data.error || "회원가입에 실패했습니다.");
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
      handleSubmit();
    }
  };

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
          <div style={{ fontSize: "3.5rem", marginBottom: "16px" }}>{"📧"}</div>
          <h2 style={{ fontSize: "1.5rem", fontWeight: 800, marginBottom: "12px" }}>
            이메일 인증이 필요합니다
          </h2>
          <p style={{ color: "var(--text-muted)", fontSize: "0.95rem", lineHeight: 1.6 }}>
            입력하신 이메일로 인증 코드를 발송했습니다.<br />
            잠시 후 인증 페이지로 이동합니다...
          </p>
        </div>
      </div>
    );
  }

  return (
    <div style={{
      display: "flex", alignItems: "center", justifyContent: "center",
      minHeight: "100vh", background: "var(--bg)", padding: "24px",
    }}>
      <div style={{
        width: "100%", maxWidth: "480px", padding: "40px 32px",
        background: "var(--bg-card)", borderRadius: "var(--radius-lg)",
        border: "1px solid var(--border)", boxShadow: "var(--shadow)",
      }}>
        {/* Header */}
        <div style={{ textAlign: "center", marginBottom: "32px" }}>
          <Link href="/" style={{ textDecoration: "none", color: "inherit" }}>
            <div style={{ fontSize: "3rem", marginBottom: "8px" }}>{"🤖"}</div>
            <h1 style={{ fontSize: "1.5rem", fontWeight: 800, marginBottom: "4px" }}>MoA 회원가입</h1>
          </Link>
          <p style={{ color: "var(--text-muted)", fontSize: "0.85rem" }}>
            계정을 만들고 AI 비서를 시작하세요
          </p>
        </div>

        {/* Form */}
        <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
          {/* Username */}
          <div>
            <label style={labelStyle}>아이디 <span style={requiredStyle}>*</span></label>
            <input
              type="text"
              placeholder="영문, 한글, 숫자, 밑줄 (2~30자)"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              onBlur={() => validateField("username", username)}
              onKeyDown={handleKeyDown}
              autoComplete="username"
              style={inputStyle}
            />
            {fieldErrors.username && <p style={fieldErrorStyle}>{fieldErrors.username}</p>}
          </div>

          {/* Email */}
          <div>
            <label style={labelStyle}>이메일 <span style={requiredStyle}>*</span></label>
            <input
              type="email"
              placeholder="example@email.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              onBlur={() => validateField("email", email)}
              onKeyDown={handleKeyDown}
              autoComplete="email"
              style={inputStyle}
            />
            {fieldErrors.email && <p style={fieldErrorStyle}>{fieldErrors.email}</p>}
            <p style={hintStyle}>이메일 인증에 사용됩니다</p>
          </div>

          {/* Nickname (optional) */}
          <div>
            <label style={labelStyle}>닉네임 <span style={{ color: "var(--text-muted)", fontSize: "0.75rem" }}>(선택)</span></label>
            <input
              type="text"
              placeholder="표시될 이름"
              value={nickname}
              onChange={(e) => setNickname(e.target.value)}
              onKeyDown={handleKeyDown}
              autoComplete="nickname"
              style={inputStyle}
            />
          </div>

          {/* AI Strategy Selection */}
          <div>
            <label style={labelStyle}>AI 모델 전략 <span style={requiredStyle}>*</span></label>
            <div style={{ display: "flex", gap: "10px" }}>
              {/* Cost-efficient */}
              <button
                type="button"
                onClick={() => setModelStrategy("cost-efficient")}
                style={{
                  flex: 1,
                  padding: "14px 12px",
                  borderRadius: "var(--radius)",
                  border: modelStrategy === "cost-efficient"
                    ? "2px solid #48bb78"
                    : "1px solid var(--border)",
                  background: modelStrategy === "cost-efficient"
                    ? "rgba(72,187,120,0.08)"
                    : "var(--bg)",
                  cursor: "pointer",
                  textAlign: "center",
                  transition: "all 0.2s",
                }}
              >
                <div style={{ fontSize: "1.4rem", marginBottom: "4px" }}>{"💰"}</div>
                <div style={{ fontSize: "0.85rem", fontWeight: 700, color: "var(--text)" }}>
                  가성비 전략
                </div>
                <div style={{ fontSize: "0.72rem", color: "var(--text-muted)", marginTop: "2px" }}>
                  Gemini 3.0 Flash 기본
                </div>
              </button>
              {/* Max-performance */}
              <button
                type="button"
                onClick={() => setModelStrategy("max-performance")}
                style={{
                  flex: 1,
                  padding: "14px 12px",
                  borderRadius: "var(--radius)",
                  border: modelStrategy === "max-performance"
                    ? "2px solid #667eea"
                    : "1px solid var(--border)",
                  background: modelStrategy === "max-performance"
                    ? "rgba(102,126,234,0.08)"
                    : "var(--bg)",
                  cursor: "pointer",
                  textAlign: "center",
                  transition: "all 0.2s",
                }}
              >
                <div style={{ fontSize: "1.4rem", marginBottom: "4px" }}>{"🧠"}</div>
                <div style={{ fontSize: "0.85rem", fontWeight: 700, color: "var(--text)" }}>
                  최고성능 전략
                </div>
                <div style={{ fontSize: "0.72rem", color: "var(--text-muted)", marginTop: "2px" }}>
                  Claude Opus 4.6 기본
                </div>
              </button>
            </div>
            <p style={hintStyle}>마이페이지에서 언제든 변경할 수 있습니다</p>
          </div>

          {/* Phone: Country Code + Number */}
          <div>
            <label style={labelStyle}>휴대폰 번호 <span style={requiredStyle}>*</span></label>
            <div style={{ display: "flex", gap: "8px" }}>
              {/* Country Code Selector */}
              <select
                value={countryCode}
                onChange={(e) => { setCountryCode(e.target.value); setPhone(""); }}
                style={{
                  ...inputStyle,
                  width: "180px",
                  flexShrink: 0,
                  cursor: "pointer",
                  appearance: "none",
                  backgroundImage: "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 12 12'%3E%3Cpath fill='%239a9ab0' d='M6 8L1 3h10z'/%3E%3C/svg%3E\")",
                  backgroundRepeat: "no-repeat",
                  backgroundPosition: "right 12px center",
                  paddingRight: "32px",
                }}
              >
                {SORTED_COUNTRIES.map((c) => (
                  <option key={`${c.code}-${c.dialCode}`} value={c.code}>
                    {c.dialCode} {c.name}
                  </option>
                ))}
              </select>

              {/* Phone Number */}
              <input
                type="tel"
                placeholder={currentCountry.example}
                value={phone}
                onChange={(e) => setPhone(e.target.value.replace(/[^\d\-\s]/g, ""))}
                onKeyDown={handleKeyDown}
                autoComplete="tel"
                style={{ ...inputStyle, flex: 1 }}
              />
            </div>
            <p style={hintStyle}>
              국가를 선택한 후 휴대폰 번호를 입력하세요 (예: {currentCountry.example})
            </p>
          </div>

          {/* Password */}
          <div>
            <label style={labelStyle}>비밀번호 <span style={requiredStyle}>*</span></label>
            <div style={{ position: "relative" }}>
              <input
                type={showPassword ? "text" : "password"}
                placeholder="8자 이상"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                onBlur={() => validateField("password", password)}
                onKeyDown={handleKeyDown}
                autoComplete="new-password"
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
            {fieldErrors.password && <p style={fieldErrorStyle}>{fieldErrors.password}</p>}
          </div>

          {/* Password Confirm */}
          <div>
            <label style={labelStyle}>비밀번호 확인 <span style={requiredStyle}>*</span></label>
            <input
              type="password"
              placeholder="비밀번호를 다시 입력"
              value={passwordConfirm}
              onChange={(e) => setPasswordConfirm(e.target.value)}
              onBlur={() => validateField("passwordConfirm", passwordConfirm)}
              onKeyDown={handleKeyDown}
              autoComplete="new-password"
              style={inputStyle}
            />
            {fieldErrors.passwordConfirm && <p style={fieldErrorStyle}>{fieldErrors.passwordConfirm}</p>}
          </div>

          {/* Passphrase (구문번호) */}
          <div>
            <label style={labelStyle}>구문번호 <span style={requiredStyle}>*</span></label>
            <div style={{ position: "relative" }}>
              <input
                type={showPassphrase ? "text" : "password"}
                placeholder="4자 이상 (추가 보안 인증용)"
                value={passphrase}
                onChange={(e) => setPassphrase(e.target.value)}
                onBlur={() => validateField("passphrase", passphrase)}
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
            {fieldErrors.passphrase && <p style={fieldErrorStyle}>{fieldErrors.passphrase}</p>}
            <p style={hintStyle}>로그인 시 비밀번호와 함께 사용되는 추가 보안 문구입니다</p>
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

          {/* Submit Button */}
          <button
            className="btn btn-primary"
            style={{ width: "100%", padding: "16px", fontSize: "1rem", fontWeight: 700, marginTop: "8px" }}
            onClick={handleSubmit}
            disabled={loading}
          >
            {loading ? "가입 처리 중..." : "회원가입"}
          </button>
        </div>

        {/* Footer */}
        <div style={{ textAlign: "center", marginTop: "24px" }}>
          <p style={{ color: "var(--text-muted)", fontSize: "0.85rem" }}>
            이미 계정이 있으신가요?{" "}
            <Link href="/login" style={{ color: "var(--primary)", fontWeight: 600 }}>로그인</Link>
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

const requiredStyle: React.CSSProperties = {
  color: "var(--danger)",
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

const fieldErrorStyle: React.CSSProperties = {
  color: "var(--danger)",
  fontSize: "0.75rem",
  marginTop: "4px",
};

const hintStyle: React.CSSProperties = {
  color: "var(--text-muted)",
  fontSize: "0.75rem",
  marginTop: "4px",
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
