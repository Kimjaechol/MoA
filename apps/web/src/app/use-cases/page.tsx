"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";

interface Post {
  id: string;
  title: string;
  content: string;
  nickname: string;
  createdAt: string;
  likeCount: number;
  commentCount: number;
}

const POSTS_PER_PAGE = 10;

export default function UseCasesPage() {
  const [posts, setPosts] = useState<Post[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const totalPages = Math.max(1, Math.ceil(total / POSTS_PER_PAGE));

  const fetchPosts = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const res = await fetch(
        `/api/use-cases?page=${page}&limit=${POSTS_PER_PAGE}`
      );
      if (!res.ok) throw new Error("Failed to fetch posts");
      const data = await res.json();
      setPosts(data.posts ?? []);
      setTotal(data.total ?? 0);
    } catch {
      setError("게시글을 불러오는데 실패했습니다.");
    } finally {
      setLoading(false);
    }
  }, [page]);

  useEffect(() => {
    fetchPosts();
  }, [fetchPosts]);

  const formatDate = (dateStr: string) => {
    const d = new Date(dateStr);
    return d.toLocaleDateString("ko-KR", {
      year: "numeric",
      month: "long",
      day: "numeric",
    });
  };

  const truncate = (text: string, max: number) => {
    if (text.length <= max) return text;
    return text.slice(0, max) + "...";
  };

  return (
    <div className="container" style={{ paddingTop: 100, paddingBottom: 80 }}>
      {/* Header */}
      <div className="section-header" style={{ marginBottom: 40 }}>
        <span className="section-badge">Use Cases</span>
        <h2>MoA 사용사례</h2>
        <p>MoA를 어떻게 활용하고 계신지 공유해주세요</p>
      </div>

      {/* Action bar */}
      <div
        style={{
          display: "flex",
          justifyContent: "flex-end",
          marginBottom: 24,
        }}
      >
        <Link href="/use-cases/new" className="btn btn-primary">
          새 사용사례 공유하기
        </Link>
      </div>

      {/* Loading state */}
      {loading && (
        <div style={{ textAlign: "center", padding: 60 }}>
          <p style={{ color: "var(--text-muted)" }}>불러오는 중...</p>
        </div>
      )}

      {/* Error state */}
      {error && (
        <div
          style={{
            textAlign: "center",
            padding: 60,
            color: "var(--danger)",
          }}
        >
          <p>{error}</p>
          <button
            className="btn btn-outline btn-sm"
            style={{ marginTop: 16 }}
            onClick={fetchPosts}
          >
            다시 시도
          </button>
        </div>
      )}

      {/* Empty state */}
      {!loading && !error && posts.length === 0 && (
        <div style={{ textAlign: "center", padding: 60 }}>
          <p style={{ color: "var(--text-muted)", marginBottom: 16 }}>
            아직 공유된 사용사례가 없습니다.
          </p>
          <Link href="/use-cases/new" className="btn btn-primary btn-sm">
            첫 번째 사용사례를 공유해보세요!
          </Link>
        </div>
      )}

      {/* Post list */}
      {!loading && !error && posts.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          {posts.map((post) => (
            <Link
              key={post.id}
              href={`/use-cases/${post.id}`}
              style={{ textDecoration: "none" }}
            >
              <div className="card" style={{ cursor: "pointer" }}>
                <h3
                  style={{
                    fontSize: "1.25rem",
                    marginBottom: 8,
                    color: "var(--text-heading)",
                  }}
                >
                  {post.title}
                </h3>
                <p
                  style={{
                    color: "var(--text-muted)",
                    fontSize: "0.95rem",
                    marginBottom: 16,
                    lineHeight: 1.6,
                  }}
                >
                  {truncate(post.content, 100)}
                </p>
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    flexWrap: "wrap",
                    gap: 12,
                  }}
                >
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 12,
                    }}
                  >
                    <span className="tag">{post.nickname}</span>
                    <span
                      style={{
                        color: "var(--text-muted)",
                        fontSize: "0.8rem",
                      }}
                    >
                      {formatDate(post.createdAt)}
                    </span>
                  </div>
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 16,
                      color: "var(--text-muted)",
                      fontSize: "0.85rem",
                    }}
                  >
                    <span
                      style={{
                        display: "inline-flex",
                        alignItems: "center",
                        gap: 4,
                      }}
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
                        <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" />
                      </svg>
                      {post.likeCount}
                    </span>
                    <span
                      style={{
                        display: "inline-flex",
                        alignItems: "center",
                        gap: 4,
                      }}
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
                        <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
                      </svg>
                      {post.commentCount}
                    </span>
                  </div>
                </div>
              </div>
            </Link>
          ))}
        </div>
      )}

      {/* Pagination */}
      {!loading && !error && totalPages > 1 && (
        <div
          style={{
            display: "flex",
            justifyContent: "center",
            alignItems: "center",
            gap: 16,
            marginTop: 40,
          }}
        >
          <button
            className="btn btn-outline btn-sm"
            disabled={page <= 1}
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            style={{
              opacity: page <= 1 ? 0.4 : 1,
              cursor: page <= 1 ? "not-allowed" : "pointer",
            }}
          >
            이전
          </button>
          <span style={{ color: "var(--text-muted)", fontSize: "0.9rem" }}>
            {page} / {totalPages}
          </span>
          <button
            className="btn btn-outline btn-sm"
            disabled={page >= totalPages}
            onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
            style={{
              opacity: page >= totalPages ? 0.4 : 1,
              cursor: page >= totalPages ? "not-allowed" : "pointer",
            }}
          >
            다음
          </button>
        </div>
      )}

      {/* Back to home */}
      <div style={{ textAlign: "center", marginTop: 40 }}>
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
