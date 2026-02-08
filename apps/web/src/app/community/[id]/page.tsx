"use client";

import { useState, useEffect, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";

interface Post {
  id: string;
  title: string;
  content: string;
  nickname: string;
  email?: string;
  createdAt: string;
  likeCount: number;
}

interface Comment {
  id: string;
  nickname: string;
  content: string;
  createdAt: string;
}

function getVisitorId(): string {
  if (typeof window === "undefined") return "";
  let id = localStorage.getItem("moa_visitor_id");
  if (!id) {
    id = crypto.randomUUID();
    localStorage.setItem("moa_visitor_id", id);
  }
  return id;
}

export default function PostDetailPage() {
  const params = useParams();
  const router = useRouter();
  const postId = params.id as string;

  const [post, setPost] = useState<Post | null>(null);
  const [comments, setComments] = useState<Comment[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  // Like state
  const [liked, setLiked] = useState(false);
  const [likeCount, setLikeCount] = useState(0);
  const [liking, setLiking] = useState(false);

  // Comment form
  const [commentNickname, setCommentNickname] = useState("");
  const [commentContent, setCommentContent] = useState("");
  const [submittingComment, setSubmittingComment] = useState(false);
  const [commentError, setCommentError] = useState("");

  const fetchPost = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const res = await fetch(`/api/community?id=${postId}`);
      if (!res.ok) throw new Error("Failed to fetch post");
      const data = await res.json();
      setPost(data.post);
      setLikeCount(data.post?.likeCount ?? 0);
      setComments(data.comments ?? []);
    } catch {
      setError("게시글을 불러오는데 실패했습니다.");
    } finally {
      setLoading(false);
    }
  }, [postId]);

  const fetchComments = useCallback(async () => {
    try {
      const res = await fetch(`/api/community/comments?postId=${postId}`);
      if (!res.ok) return;
      const data = await res.json();
      setComments(data.comments ?? []);
    } catch {
      // silently fail
    }
  }, [postId]);

  useEffect(() => {
    fetchPost();
  }, [fetchPost]);

  const handleLike = async () => {
    if (liking) return;
    setLiking(true);
    try {
      const visitorId = getVisitorId();
      const res = await fetch("/api/community/like", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ postId, visitorId }),
      });
      if (!res.ok) throw new Error("Like failed");
      const data = await res.json();
      setLiked(data.liked);
      setLikeCount(data.likeCount);
    } catch {
      // silently fail
    } finally {
      setLiking(false);
    }
  };

  const handleCommentSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!commentNickname.trim() || !commentContent.trim()) {
      setCommentError("닉네임과 내용을 모두 입력해주세요.");
      return;
    }
    setSubmittingComment(true);
    setCommentError("");
    try {
      const res = await fetch("/api/community/comments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          postId,
          nickname: commentNickname.trim(),
          content: commentContent.trim(),
        }),
      });
      if (!res.ok) throw new Error("Comment creation failed");
      setCommentContent("");
      await fetchComments();
    } catch {
      setCommentError("댓글 등록에 실패했습니다. 다시 시도해주세요.");
    } finally {
      setSubmittingComment(false);
    }
  };

  const formatDate = (dateStr: string) => {
    const d = new Date(dateStr);
    return d.toLocaleDateString("ko-KR", {
      year: "numeric",
      month: "long",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  };

  if (loading) {
    return (
      <div className="container" style={{ paddingTop: 100, paddingBottom: 80 }}>
        <div style={{ textAlign: "center", padding: 60 }}>
          <p style={{ color: "var(--text-muted)" }}>불러오는 중...</p>
        </div>
      </div>
    );
  }

  if (error || !post) {
    return (
      <div className="container" style={{ paddingTop: 100, paddingBottom: 80 }}>
        <div style={{ textAlign: "center", padding: 60 }}>
          <p style={{ color: "var(--danger)", marginBottom: 16 }}>
            {error || "게시글을 찾을 수 없습니다."}
          </p>
          <button
            className="btn btn-outline btn-sm"
            onClick={() => router.push("/community")}
          >
            목록으로 돌아가기
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="container" style={{ paddingTop: 100, paddingBottom: 80 }}>
      {/* Back button */}
      <div style={{ marginBottom: 24 }}>
        <Link
          href="/community"
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

      {/* Post content */}
      <article className="card" style={{ marginBottom: 32 }}>
        <h1
          style={{
            fontSize: "1.75rem",
            marginBottom: 16,
            color: "var(--text-heading)",
            lineHeight: 1.4,
          }}
        >
          {post.title}
        </h1>

        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 12,
            marginBottom: 24,
            paddingBottom: 20,
            borderBottom: "1px solid var(--border)",
          }}
        >
          <span className="tag">{post.nickname}</span>
          <span
            style={{
              color: "var(--text-muted)",
              fontSize: "0.85rem",
            }}
          >
            {formatDate(post.createdAt)}
          </span>
        </div>

        <div
          style={{
            color: "var(--text)",
            lineHeight: 1.8,
            fontSize: "1rem",
            whiteSpace: "pre-wrap",
            wordBreak: "break-word",
            marginBottom: 24,
          }}
        >
          {post.content}
        </div>

        {/* Like button */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            paddingTop: 20,
            borderTop: "1px solid var(--border)",
          }}
        >
          <button
            className={`like-btn${liked ? " liked" : ""}`}
            onClick={handleLike}
            disabled={liking}
            style={{ opacity: liking ? 0.6 : 1 }}
          >
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill={liked ? "currentColor" : "none"}
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" />
            </svg>
            {likeCount}
          </button>
        </div>
      </article>

      {/* Comments section */}
      <section>
        <h2
          style={{
            fontSize: "1.25rem",
            marginBottom: 24,
            color: "var(--text-heading)",
          }}
        >
          댓글 ({comments.length})
        </h2>

        {/* Comment form */}
        <form
          onSubmit={handleCommentSubmit}
          className="card"
          style={{ marginBottom: 24 }}
        >
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "1fr",
              gap: 16,
            }}
          >
            <div className="form-group" style={{ marginBottom: 0 }}>
              <label htmlFor="comment-nickname">닉네임</label>
              <input
                id="comment-nickname"
                type="text"
                className="form-input"
                placeholder="닉네임을 입력하세요"
                value={commentNickname}
                onChange={(e) => setCommentNickname(e.target.value)}
                maxLength={30}
                required
              />
            </div>
            <div className="form-group" style={{ marginBottom: 0 }}>
              <label htmlFor="comment-content">댓글</label>
              <textarea
                id="comment-content"
                className="form-textarea"
                placeholder="댓글을 남겨주세요..."
                value={commentContent}
                onChange={(e) => setCommentContent(e.target.value)}
                maxLength={1000}
                rows={3}
                required
              />
            </div>
          </div>

          {commentError && (
            <p
              style={{
                color: "var(--danger)",
                fontSize: "0.85rem",
                marginTop: 8,
              }}
            >
              {commentError}
            </p>
          )}

          <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 16 }}>
            <button
              type="submit"
              className="btn btn-primary btn-sm"
              disabled={submittingComment}
              style={{ opacity: submittingComment ? 0.6 : 1 }}
            >
              {submittingComment ? "등록 중..." : "댓글 등록"}
            </button>
          </div>
        </form>

        {/* Comment list */}
        {comments.length === 0 && (
          <div style={{ textAlign: "center", padding: 40 }}>
            <p style={{ color: "var(--text-muted)" }}>
              아직 댓글이 없습니다. 첫 댓글을 남겨보세요!
            </p>
          </div>
        )}

        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {comments.map((comment) => (
            <div
              key={comment.id}
              style={{
                padding: "16px 20px",
                background: "var(--bg-card)",
                border: "1px solid var(--border)",
                borderRadius: "var(--radius)",
              }}
            >
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 10,
                  marginBottom: 8,
                }}
              >
                <span
                  style={{
                    fontWeight: 600,
                    color: "var(--primary)",
                    fontSize: "0.9rem",
                  }}
                >
                  {comment.nickname}
                </span>
                <span
                  style={{
                    color: "var(--text-muted)",
                    fontSize: "0.8rem",
                  }}
                >
                  {formatDate(comment.createdAt)}
                </span>
              </div>
              <p
                style={{
                  color: "var(--text)",
                  fontSize: "0.95rem",
                  lineHeight: 1.6,
                  whiteSpace: "pre-wrap",
                  wordBreak: "break-word",
                }}
              >
                {comment.content}
              </p>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
