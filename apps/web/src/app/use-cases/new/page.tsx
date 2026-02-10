"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";

export default function NewUseCasePage() {
  const router = useRouter();

  const [nickname, setNickname] = useState("");
  const [email, setEmail] = useState("");
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!nickname.trim() || !title.trim() || !content.trim()) {
      setError("닉네임, 제목, 내용은 필수 입력 항목입니다.");
      return;
    }

    setSubmitting(true);
    setError("");

    try {
      const res = await fetch("/api/use-cases", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          nickname: nickname.trim(),
          email: email.trim() || undefined,
          title: title.trim(),
          content: content.trim(),
        }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Failed to create post");
      }

      router.push("/use-cases");
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "게시글 등록에 실패했습니다. 다시 시도해주세요."
      );
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="container" style={{ paddingTop: 100, paddingBottom: 80 }}>
      {/* Back button */}
      <div style={{ marginBottom: 24 }}>
        <Link
          href="/use-cases"
          className="btn btn-outline btn-sm"
          style={{ gap: 6 }}
        >
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <line x1="19" y1="12" x2="5" y2="12" />
            <polyline points="12 19 5 12 12 5" />
          </svg>
          목록으로
        </Link>
      </div>

      {/* Header */}
      <div className="section-header" style={{ marginBottom: 40 }}>
        <span className="section-badge">New Use Case</span>
        <h2>새 사용사례 공유하기</h2>
        <p>MoA를 어떻게 활용하고 계신지 알려주세요</p>
      </div>

      {/* Form */}
      <form
        onSubmit={handleSubmit}
        className="card"
        style={{ maxWidth: 720, margin: "0 auto" }}
      >
        <div className="form-group">
          <label htmlFor="nickname">
            닉네임 <span style={{ color: "var(--danger)" }}>*</span>
          </label>
          <input
            id="nickname"
            type="text"
            className="form-input"
            placeholder="닉네임을 입력하세요"
            value={nickname}
            onChange={(e) => setNickname(e.target.value)}
            maxLength={30}
            required
          />
        </div>

        <div className="form-group">
          <label htmlFor="email">
            이메일{" "}
            <span style={{ color: "var(--text-muted)", fontWeight: 400 }}>
              (선택 - 수정/삭제 시 필요)
            </span>
          </label>
          <input
            id="email"
            type="email"
            className="form-input"
            placeholder="email@example.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            maxLength={100}
          />
        </div>

        <div className="form-group">
          <label htmlFor="title">
            제목 <span style={{ color: "var(--danger)" }}>*</span>
          </label>
          <input
            id="title"
            type="text"
            className="form-input"
            placeholder="사용사례 제목을 입력하세요"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            maxLength={100}
            required
          />
        </div>

        <div className="form-group">
          <label htmlFor="content">
            내용 <span style={{ color: "var(--danger)" }}>*</span>
          </label>
          <textarea
            id="content"
            className="form-textarea"
            placeholder="MoA를 어떻게 활용하고 계신지 자세히 적어주세요..."
            value={content}
            onChange={(e) => setContent(e.target.value)}
            maxLength={5000}
            rows={10}
            style={{ minHeight: 200 }}
            required
          />
          <p
            style={{
              color: "var(--text-muted)",
              fontSize: "0.8rem",
              marginTop: 4,
              textAlign: "right",
            }}
          >
            {content.length} / 5000
          </p>
        </div>

        {error && (
          <div
            style={{
              padding: "12px 16px",
              background: "rgba(252, 129, 129, 0.1)",
              border: "1px solid var(--danger)",
              borderRadius: "var(--radius)",
              color: "var(--danger)",
              fontSize: "0.9rem",
              marginBottom: 20,
            }}
          >
            {error}
          </div>
        )}

        <div
          style={{
            display: "flex",
            justifyContent: "flex-end",
            gap: 12,
          }}
        >
          <Link href="/use-cases" className="btn btn-outline">
            취소
          </Link>
          <button
            type="submit"
            className="btn btn-primary"
            disabled={submitting}
            style={{ opacity: submitting ? 0.6 : 1 }}
          >
            {submitting ? "등록 중..." : "등록하기"}
          </button>
        </div>
      </form>
    </div>
  );
}
