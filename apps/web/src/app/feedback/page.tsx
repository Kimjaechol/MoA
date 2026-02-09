"use client";

import { useState } from "react";
import Link from "next/link";

type FeedbackType = "bug" | "feature" | "other";

interface FeedbackEntry {
  id: string;
  type: string;
  content: string;
  status: string;
  created_at: string;
}

const TYPE_LABELS: Record<string, string> = {
  bug: "버그 신고",
  feature: "기능 개선 요청",
  other: "기타",
};

const STATUS_LABELS: Record<string, { label: string; color: string }> = {
  pending: { label: "대기중", color: "var(--warning)" },
  reviewed: { label: "검토중", color: "var(--primary)" },
  resolved: { label: "해결됨", color: "var(--success)" },
};

export default function FeedbackPage() {
  // Form state
  const [type, setType] = useState<FeedbackType>("bug");
  const [email, setEmail] = useState("");
  const [content, setContent] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitResult, setSubmitResult] = useState<{
    ok: boolean;
    message: string;
  } | null>(null);

  // Lookup state
  const [lookupEmail, setLookupEmail] = useState("");
  const [lookupLoading, setLookupLoading] = useState(false);
  const [lookupError, setLookupError] = useState("");
  const [entries, setEntries] = useState<FeedbackEntry[]>([]);
  const [hasSearched, setHasSearched] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!content.trim()) { return; }

    setSubmitting(true);
    setSubmitResult(null);

    try {
      const res = await fetch("/api/feedback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type,
          email: email.trim() || null,
          content: content.trim(),
          userAgent:
            typeof navigator !== "undefined" ? navigator.userAgent : null,
        }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => null);
        throw new Error(data?.error ?? "제출에 실패했습니다.");
      }

      setSubmitResult({ ok: true, message: "건의사항이 성공적으로 제출되었습니다." });
      setContent("");
      setType("bug");
    } catch (err) {
      setSubmitResult({
        ok: false,
        message: err instanceof Error ? err.message : "제출에 실패했습니다.",
      });
    } finally {
      setSubmitting(false);
    }
  };

  const handleLookup = async () => {
    if (!lookupEmail.trim()) { return; }

    setLookupLoading(true);
    setLookupError("");
    setHasSearched(true);

    try {
      const res = await fetch(
        `/api/feedback?email=${encodeURIComponent(lookupEmail.trim())}`
      );
      if (!res.ok) { throw new Error("조회에 실패했습니다."); }
      const data = await res.json();
      setEntries(data.entries ?? []);
    } catch {
      setLookupError("건의사항을 불러오는데 실패했습니다.");
    } finally {
      setLookupLoading(false);
    }
  };

  const formatDate = (dateStr: string) => {
    const d = new Date(dateStr);
    return d.toLocaleDateString("ko-KR", {
      year: "numeric",
      month: "long",
      day: "numeric",
    });
  };

  const truncate = (text: string, max: number) => {
    if (text.length <= max) { return text; }
    return text.slice(0, max) + "...";
  };

  return (
    <div className="container" style={{ paddingTop: 100, paddingBottom: 80 }}>
      {/* Header */}
      <div className="section-header" style={{ marginBottom: 40 }}>
        <span className="section-badge">Feedback</span>
        <h2>건의사항 및 버그 신고</h2>
        <p>
          여러분의 소중한 의견을 보내주세요. 작성하신 내용은 관리자에게만
          전달됩니다.
        </p>
      </div>

      {/* Feedback form */}
      <div className="card" style={{ maxWidth: 640, margin: "0 auto 48px" }}>
        <form onSubmit={handleSubmit}>
          <div className="form-group">
            <label htmlFor="feedback-type">유형</label>
            <select
              id="feedback-type"
              className="form-select"
              value={type}
              onChange={(e) => setType(e.target.value as FeedbackType)}
            >
              <option value="bug">버그 신고</option>
              <option value="feature">기능 개선 요청</option>
              <option value="other">기타</option>
            </select>
          </div>

          <div className="form-group">
            <label htmlFor="feedback-email">
              이메일{" "}
              <span style={{ color: "var(--text-muted)", fontWeight: 400 }}>
                (선택사항 - 제출 내역 조회에 사용됩니다)
              </span>
            </label>
            <input
              id="feedback-email"
              type="email"
              className="form-input"
              placeholder="example@email.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </div>

          <div className="form-group">
            <label htmlFor="feedback-content">
              내용 <span style={{ color: "var(--danger)" }}>*</span>
            </label>
            <textarea
              id="feedback-content"
              className="form-textarea"
              placeholder="건의사항이나 버그 내용을 자세히 작성해주세요..."
              value={content}
              onChange={(e) => setContent(e.target.value)}
              required
              style={{ minHeight: 160 }}
            />
          </div>

          <button
            type="submit"
            className="btn btn-primary"
            disabled={submitting || !content.trim()}
            style={{
              width: "100%",
              opacity: submitting || !content.trim() ? 0.6 : 1,
              cursor:
                submitting || !content.trim() ? "not-allowed" : "pointer",
            }}
          >
            {submitting ? "제출 중..." : "제출하기"}
          </button>
        </form>

        {/* Submit result message */}
        {submitResult && (
          <div
            style={{
              marginTop: 16,
              padding: "12px 16px",
              borderRadius: "var(--radius)",
              background: submitResult.ok
                ? "rgba(72, 187, 120, 0.1)"
                : "rgba(252, 129, 129, 0.1)",
              border: `1px solid ${submitResult.ok ? "var(--success)" : "var(--danger)"}`,
              color: submitResult.ok ? "var(--success)" : "var(--danger)",
              fontSize: "0.9rem",
            }}
          >
            {submitResult.message}
          </div>
        )}
      </div>

      {/* Lookup section */}
      <div style={{ maxWidth: 640, margin: "0 auto" }}>
        <h3
          style={{
            fontSize: "1.25rem",
            marginBottom: 16,
            color: "var(--text-heading)",
          }}
        >
          내 건의사항 조회
        </h3>

        <div style={{ display: "flex", gap: 12, marginBottom: 24 }}>
          <input
            type="email"
            className="form-input"
            placeholder="제출 시 입력한 이메일을 입력하세요"
            value={lookupEmail}
            onChange={(e) => setLookupEmail(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                void handleLookup();
              }
            }}
            style={{ flex: 1 }}
          />
          <button
            className="btn btn-outline btn-sm"
            onClick={handleLookup}
            disabled={lookupLoading || !lookupEmail.trim()}
            style={{
              opacity: lookupLoading || !lookupEmail.trim() ? 0.5 : 1,
              cursor:
                lookupLoading || !lookupEmail.trim()
                  ? "not-allowed"
                  : "pointer",
              whiteSpace: "nowrap",
            }}
          >
            {lookupLoading ? "조회 중..." : "조회"}
          </button>
        </div>

        {/* Lookup error */}
        {lookupError && (
          <div
            style={{
              textAlign: "center",
              padding: 24,
              color: "var(--danger)",
            }}
          >
            <p>{lookupError}</p>
          </div>
        )}

        {/* Lookup results */}
        {hasSearched && !lookupLoading && !lookupError && (
          <>
            {entries.length === 0 ? (
              <div
                style={{
                  textAlign: "center",
                  padding: 32,
                  color: "var(--text-muted)",
                }}
              >
                해당 이메일로 제출된 건의사항이 없습니다.
              </div>
            ) : (
              <div
                style={{
                  display: "flex",
                  flexDirection: "column",
                  gap: 12,
                }}
              >
                {entries.map((entry) => {
                  const statusInfo = STATUS_LABELS[entry.status] ??
                    STATUS_LABELS.pending;
                  return (
                    <div
                      key={entry.id}
                      className="card"
                      style={{ padding: "20px 24px" }}
                    >
                      <div
                        style={{
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "space-between",
                          flexWrap: "wrap",
                          gap: 8,
                          marginBottom: 8,
                        }}
                      >
                        <div
                          style={{
                            display: "flex",
                            alignItems: "center",
                            gap: 10,
                          }}
                        >
                          <span className="tag">
                            {TYPE_LABELS[entry.type] ?? entry.type}
                          </span>
                          <span
                            style={{
                              color: "var(--text-muted)",
                              fontSize: "0.8rem",
                            }}
                          >
                            {formatDate(entry.created_at)}
                          </span>
                        </div>
                        <span
                          style={{
                            display: "inline-block",
                            padding: "3px 10px",
                            borderRadius: 12,
                            fontSize: "0.75rem",
                            fontWeight: 600,
                            color: statusInfo.color,
                            background: `${statusInfo.color}20`,
                            border: `1px solid ${statusInfo.color}40`,
                          }}
                        >
                          {statusInfo.label}
                        </span>
                      </div>
                      <p
                        style={{
                          color: "var(--text)",
                          fontSize: "0.9rem",
                          lineHeight: 1.6,
                        }}
                      >
                        {truncate(entry.content, 150)}
                      </p>
                    </div>
                  );
                })}
              </div>
            )}
          </>
        )}
      </div>

      {/* Back to home */}
      <div style={{ textAlign: "center", marginTop: 48 }}>
        <Link
          href="/"
          style={{ color: "var(--text-muted)", fontSize: "0.9rem" }}
        >
          홈으로 돌아가기
        </Link>
      </div>
    </div>
  );
}
