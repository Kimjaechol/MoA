"use client";

import { useState, useRef, useCallback } from "react";
import Link from "next/link";
import Nav from "../../components/Nav";

/**
 * MoA Real-time Interpreter Page
 *
 * Text-based translation via /api/interpreter endpoint.
 * Supports 25+ languages, domain-specific modes, bidirectional translation.
 * Voice-based real-time interpretation available on desktop/mobile apps.
 */

interface Language {
  name: string;
  nativeName: string;
  flag: string;
}

interface TranslationResult {
  original: string;
  translated: string;
  source_lang: string;
  target_lang: string;
  source_name: string;
  target_name: string;
  model: string;
  timestamp: string;
}

const DOMAINS = [
  { id: "general", label: "일반", icon: "\uD83D\uDCAC" },
  { id: "business", label: "비즈니스", icon: "\uD83D\uDCBC" },
  { id: "medical", label: "의학", icon: "\uD83C\uDFE5" },
  { id: "legal", label: "법률", icon: "\u2696\uFE0F" },
  { id: "technical", label: "기술", icon: "\u2699\uFE0F" },
] as const;

const QUICK_PAIRS: Array<{ source: string; target: string; label: string }> = [
  { source: "ko", target: "en", label: "\uD83C\uDDF0\uD83C\uDDF7 \u2192 \uD83C\uDDFA\uD83C\uDDF8 \uD55C\u2192\uC601" },
  { source: "ko", target: "ja", label: "\uD83C\uDDF0\uD83C\uDDF7 \u2192 \uD83C\uDDEF\uD83C\uDDF5 \uD55C\u2192\uC77C" },
  { source: "ko", target: "zh", label: "\uD83C\uDDF0\uD83C\uDDF7 \u2192 \uD83C\uDDE8\uD83C\uDDF3 \uD55C\u2192\uC911" },
  { source: "en", target: "ko", label: "\uD83C\uDDFA\uD83C\uDDF8 \u2192 \uD83C\uDDF0\uD83C\uDDF7 \uC601\u2192\uD55C" },
  { source: "ja", target: "ko", label: "\uD83C\uDDEF\uD83C\uDDF5 \u2192 \uD83C\uDDF0\uD83C\uDDF7 \uC77C\u2192\uD55C" },
  { source: "en", target: "ja", label: "\uD83C\uDDFA\uD83C\uDDF8 \u2192 \uD83C\uDDEF\uD83C\uDDF5 \uC601\u2192\uC77C" },
];

export default function InterpreterPage() {
  const [languages, setLanguages] = useState<Record<string, Language>>({});
  const [sourceLang, setSourceLang] = useState("ko");
  const [targetLang, setTargetLang] = useState("en");
  const [domain, setDomain] = useState("general");
  const [inputText, setInputText] = useState("");
  const [isTranslating, setIsTranslating] = useState(false);
  const [history, setHistory] = useState<TranslationResult[]>([]);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // Fetch supported languages on mount
  const languagesLoaded = useRef(false);
  if (!languagesLoaded.current) {
    languagesLoaded.current = true;
    fetch("/api/interpreter")
      .then((res) => res.json())
      .then((data) => {
        if (data.languages) setLanguages(data.languages);
      })
      .catch(() => {});
  }

  const swapLanguages = useCallback(() => {
    setSourceLang(targetLang);
    setTargetLang(sourceLang);
  }, [sourceLang, targetLang]);

  const translate = useCallback(async () => {
    if (!inputText.trim() || isTranslating) return;
    setIsTranslating(true);
    setError(null);

    try {
      const res = await fetch("/api/interpreter", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          text: inputText.trim(),
          source_lang: sourceLang,
          target_lang: targetLang,
          domain,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Translation failed");
        return;
      }

      setHistory((prev) => [data as TranslationResult, ...prev]);
      setInputText("");
      inputRef.current?.focus();
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setIsTranslating(false);
    }
  }, [inputText, sourceLang, targetLang, domain, isTranslating]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        translate();
      }
    },
    [translate],
  );

  const langOptions = Object.entries(languages).map(([code, info]) => ({
    code,
    label: `${info.flag} ${info.nativeName}`,
  }));

  return (
    <div style={{ minHeight: "100vh", background: "linear-gradient(180deg, #0a0a1a 0%, #1a1a2e 100%)", color: "#e0e0e0" }}>
      <Nav />

      <main style={{ maxWidth: 900, margin: "0 auto", padding: "40px 20px" }}>
        {/* Header */}
        <div style={{ textAlign: "center", marginBottom: 40 }}>
          <h1 style={{ fontSize: 36, fontWeight: 800, margin: 0, background: "linear-gradient(135deg, #FF6B6B, #ee5a24)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent" }}>
            {"\uD83D\uDDE3\uFE0F"} {"\uC2E4\uC2DC\uAC04 \uD1B5\uC5ED"}
          </h1>
          <p style={{ fontSize: 16, color: "#9a9ab0", marginTop: 8 }}>
            25{"\uAC1C"} {"\uC5B8\uC5B4"} {"\uC2E4\uC2DC\uAC04"} {"\uD1B5\uC5ED"} &middot; {"\uBE44\uC988\uB2C8\uC2A4"} &middot; {"\uC758\uD559"} &middot; {"\uBC95\uB960"} &middot; {"\uAE30\uC220"} {"\uC804\uBB38"} {"\uBAA8\uB4DC"} {"\uC9C0\uC6D0"}
          </p>
        </div>

        {/* Quick language pair buttons */}
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8, justifyContent: "center", marginBottom: 24 }}>
          {QUICK_PAIRS.map((pair) => (
            <button
              key={`${pair.source}-${pair.target}`}
              onClick={() => { setSourceLang(pair.source); setTargetLang(pair.target); }}
              style={{
                padding: "8px 16px",
                borderRadius: 20,
                border: sourceLang === pair.source && targetLang === pair.target ? "2px solid #FF6B6B" : "1px solid #333",
                background: sourceLang === pair.source && targetLang === pair.target ? "rgba(255,107,107,0.15)" : "rgba(255,255,255,0.05)",
                color: "#e0e0e0",
                cursor: "pointer",
                fontSize: 14,
                fontWeight: 600,
                transition: "all 0.2s",
              }}
            >
              {pair.label}
            </button>
          ))}
        </div>

        {/* Language selector + domain */}
        <div style={{ display: "flex", gap: 12, alignItems: "center", marginBottom: 16, flexWrap: "wrap" }}>
          <select
            value={sourceLang}
            onChange={(e) => setSourceLang(e.target.value)}
            style={{ flex: 1, minWidth: 160, padding: "10px 14px", borderRadius: 10, border: "1px solid #333", background: "#1a1a2e", color: "#e0e0e0", fontSize: 15 }}
          >
            {langOptions.map((l) => (
              <option key={l.code} value={l.code}>{l.label}</option>
            ))}
          </select>

          <button
            onClick={swapLanguages}
            style={{ padding: "10px 16px", borderRadius: 10, border: "1px solid #333", background: "rgba(255,255,255,0.05)", color: "#FF6B6B", cursor: "pointer", fontSize: 18, fontWeight: 700 }}
            title="Swap languages"
          >
            {"\u21C4"}
          </button>

          <select
            value={targetLang}
            onChange={(e) => setTargetLang(e.target.value)}
            style={{ flex: 1, minWidth: 160, padding: "10px 14px", borderRadius: 10, border: "1px solid #333", background: "#1a1a2e", color: "#e0e0e0", fontSize: 15 }}
          >
            {langOptions.map((l) => (
              <option key={l.code} value={l.code}>{l.label}</option>
            ))}
          </select>

          <select
            value={domain}
            onChange={(e) => setDomain(e.target.value)}
            style={{ minWidth: 120, padding: "10px 14px", borderRadius: 10, border: "1px solid #333", background: "#1a1a2e", color: "#e0e0e0", fontSize: 14 }}
          >
            {DOMAINS.map((d) => (
              <option key={d.id} value={d.id}>{d.icon} {d.label}</option>
            ))}
          </select>
        </div>

        {/* Input area */}
        <div style={{ position: "relative", marginBottom: 24 }}>
          <textarea
            ref={inputRef}
            value={inputText}
            onChange={(e) => setInputText(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={"\uD1B5\uC5ED\uD560 \uD14D\uC2A4\uD2B8\uB97C \uC785\uB825\uD558\uC138\uC694... (Enter: \uD1B5\uC5ED, Shift+Enter: \uC904\uBC14\uAFC8)"}
            rows={4}
            style={{
              width: "100%",
              padding: "16px 80px 16px 16px",
              borderRadius: 14,
              border: "1px solid #333",
              background: "#12121e",
              color: "#e0e0e0",
              fontSize: 16,
              lineHeight: 1.6,
              resize: "vertical",
              outline: "none",
              fontFamily: "inherit",
              boxSizing: "border-box",
            }}
          />
          <button
            onClick={translate}
            disabled={isTranslating || !inputText.trim()}
            style={{
              position: "absolute",
              right: 12,
              bottom: 12,
              padding: "10px 20px",
              borderRadius: 10,
              border: "none",
              background: isTranslating ? "#555" : "linear-gradient(135deg, #FF6B6B, #ee5a24)",
              color: "#fff",
              fontSize: 15,
              fontWeight: 700,
              cursor: isTranslating ? "not-allowed" : "pointer",
            }}
          >
            {isTranslating ? "\uD1B5\uC5ED \uC911..." : "\uD1B5\uC5ED"}
          </button>
        </div>

        {error && (
          <div style={{ padding: "12px 16px", borderRadius: 10, background: "rgba(255,77,77,0.15)", border: "1px solid #ff4d4d", color: "#ff6b6b", marginBottom: 16, fontSize: 14 }}>
            {error}
          </div>
        )}

        {/* Translation history */}
        {history.length > 0 && (
          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            <h2 style={{ fontSize: 18, fontWeight: 700, color: "#9a9ab0", margin: 0 }}>
              {"\uD1B5\uC5ED \uACB0\uACFC"} ({history.length})
            </h2>

            {history.map((item, i) => (
              <div
                key={`${item.timestamp}-${i}`}
                style={{ borderRadius: 14, border: "1px solid #222", background: "#12121e", overflow: "hidden" }}
              >
                {/* Original */}
                <div style={{ padding: "16px 20px", borderBottom: "1px solid #222" }}>
                  <div style={{ fontSize: 12, color: "#9a9ab0", marginBottom: 6, fontWeight: 600 }}>
                    {languages[item.source_lang]?.flag} {item.source_name}
                  </div>
                  <div style={{ fontSize: 16, lineHeight: 1.6, whiteSpace: "pre-wrap" }}>
                    {item.original}
                  </div>
                </div>

                {/* Translated */}
                <div style={{ padding: "16px 20px", background: "rgba(255,107,107,0.04)" }}>
                  <div style={{ fontSize: 12, color: "#FF6B6B", marginBottom: 6, fontWeight: 600 }}>
                    {languages[item.target_lang]?.flag} {item.target_name}
                  </div>
                  <div style={{ fontSize: 16, lineHeight: 1.6, whiteSpace: "pre-wrap" }}>
                    {item.translated}
                  </div>
                </div>

                {/* Meta */}
                <div style={{ padding: "8px 20px", borderTop: "1px solid #222", display: "flex", justifyContent: "space-between", fontSize: 11, color: "#666" }}>
                  <span>{item.model}</span>
                  <button
                    onClick={() => navigator.clipboard.writeText(item.translated)}
                    style={{ background: "none", border: "none", color: "#666", cursor: "pointer", fontSize: 11 }}
                  >
                    {"\uD83D\uDCCB"} {"\uBCF5\uC0AC"}
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Empty state */}
        {history.length === 0 && !error && (
          <div style={{ textAlign: "center", padding: "60px 20px", color: "#555" }}>
            <div style={{ fontSize: 48, marginBottom: 16 }}>{"\uD83C\uDF10"}</div>
            <p style={{ fontSize: 16, marginBottom: 8 }}>{"\uD14D\uC2A4\uD2B8\uB97C \uC785\uB825\uD558\uBA74 \uC2E4\uC2DC\uAC04\uC73C\uB85C \uD1B5\uC5ED\uD569\uB2C8\uB2E4"}</p>
            <p style={{ fontSize: 13, color: "#444" }}>
              {"\uC74C\uC131 \uC2E4\uC2DC\uAC04 \uD1B5\uC5ED\uC740"} <Link href="/download" style={{ color: "#FF6B6B" }}>MoA {"\uB370\uC2A4\uD06C\uD1B1/\uBAA8\uBC14\uC77C \uC571"}</Link>{"\uC5D0\uC11C \uC9C0\uC6D0\uB429\uB2C8\uB2E4"}
            </p>
          </div>
        )}

        {/* Voice interpreter promo */}
        <div style={{
          marginTop: 40,
          padding: "24px",
          borderRadius: 16,
          background: "linear-gradient(135deg, rgba(255,107,107,0.1), rgba(238,90,36,0.1))",
          border: "1px solid rgba(255,107,107,0.2)",
        }}>
          <h3 style={{ fontSize: 18, fontWeight: 700, margin: "0 0 8px 0", color: "#FF6B6B" }}>
            {"\uD83C\uDF99\uFE0F"} {"\uC74C\uC131 \uC2E4\uC2DC\uAC04 \uD1B5\uC5ED"}
          </h3>
          <p style={{ fontSize: 14, color: "#9a9ab0", margin: "0 0 12px 0", lineHeight: 1.6 }}>
            MoA {"\uB370\uC2A4\uD06C\uD1B1/\uBAA8\uBC14\uC77C \uC571\uC744 \uC124\uCE58\uD558\uBA74"} Gemini 2.5 Flash Native Audio{"\uB85C"} {"\uC2E4\uC2DC\uAC04 \uC74C\uC131 \uD1B5\uC5ED\uC774 \uAC00\uB2A5\uD569\uB2C8\uB2E4."}
            {"\uB9C8\uC774\uD06C\uB97C \uD0A4\uACE0 \uB9D0\uD558\uBA74"} 320-800ms {"\uC774\uB0B4\uC758 \uC9C0\uC5F0\uC73C\uB85C \uD1B5\uC5ED\uB429\uB2C8\uB2E4."}
          </p>
          <div style={{ display: "flex", gap: 12 }}>
            <Link href="/download" style={{
              display: "inline-block",
              padding: "10px 20px",
              borderRadius: 10,
              background: "linear-gradient(135deg, #FF6B6B, #ee5a24)",
              color: "#fff",
              fontWeight: 700,
              fontSize: 14,
              textDecoration: "none",
            }}>
              {"\uC571 \uB2E4\uC6B4\uB85C\uB4DC"}
            </Link>
          </div>
        </div>
      </main>
    </div>
  );
}
