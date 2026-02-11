"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import Link from "next/link";
import Nav from "../../components/Nav";

interface ChatMessage {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  model_used?: string;
  created_at: string;
}

/** MoA category definitions */
const CATEGORIES = [
  { id: "daily", label: "일상비서", icon: "🏠", color: "#48bb78", desc: "일정, 날씨, 번역, 생활 도우미" },
  { id: "work", label: "업무보조", icon: "💼", color: "#667eea", desc: "이메일, 보고서, 회의록, 데이터 분석" },
  { id: "document", label: "문서작업", icon: "📄", color: "#9c27b0", desc: "문서 작성, 변환, 종합, 요약" },
  { id: "coding", label: "코딩작업", icon: "💻", color: "#4caf50", desc: "코드 작성, 디버깅, 리뷰, 자동코딩" },
  { id: "image", label: "이미지작업", icon: "🎨", color: "#e91e63", desc: "이미지 생성, 편집, 분석, 변환" },
  { id: "music", label: "음악작업", icon: "🎵", color: "#ff9800", desc: "작곡, 편곡, 음악 분석, TTS" },
  { id: "other", label: "기타", icon: "✨", color: "#9a9ab0", desc: "기타 질문 및 자유 대화" },
] as const;

type CategoryId = (typeof CATEGORIES)[number]["id"];

/** Category-specific quick actions */
const CATEGORY_ACTIONS: Record<CategoryId, Array<{ icon: string; label: string; message: string }>> = {
  daily: [
    { icon: "🌤️", label: "오늘 날씨", message: "오늘 날씨 알려줘" },
    { icon: "📅", label: "일정 관리", message: "이번 주 일정을 정리해줘" },
    { icon: "🌍", label: "번역", message: "이 문장을 영어로 번역해줘" },
    { icon: "🍽️", label: "맛집 추천", message: "근처 맛집 추천해줘" },
  ],
  work: [
    { icon: "📧", label: "이메일 작성", message: "비즈니스 이메일 작성을 도와줘" },
    { icon: "📊", label: "데이터 분석", message: "이 데이터를 분석해줘" },
    { icon: "📝", label: "회의록 작성", message: "회의록을 정리해줘" },
    { icon: "📈", label: "보고서 작성", message: "보고서를 작성해줘" },
  ],
  document: [
    { icon: "📋", label: "문서 요약", message: "이 문서를 요약해줘" },
    { icon: "📑", label: "종합문서 작성", message: "여러 자료를 종합해서 문서를 작성해줘" },
    { icon: "📄", label: "형식 변환", message: "문서를 다른 형식으로 변환해줘" },
    { icon: "🎯", label: "PPTX 생성", message: "이 내용으로 발표 자료를 만들어줘" },
  ],
  coding: [
    { icon: "🔧", label: "코드 작성", message: "코드를 작성해줘" },
    { icon: "🐛", label: "디버깅", message: "이 코드의 버그를 찾아줘" },
    { icon: "🔄", label: "자동코딩", message: "자동으로 코딩하고 에러를 수정해줘" },
    { icon: "📖", label: "코드 리뷰", message: "이 코드를 리뷰해줘" },
  ],
  image: [
    { icon: "🖼️", label: "이미지 생성", message: "이미지를 생성해줘" },
    { icon: "✂️", label: "이미지 편집", message: "이 이미지를 편집해줘" },
    { icon: "🔍", label: "이미지 분석", message: "이 이미지를 분석해줘" },
    { icon: "🎭", label: "스타일 변환", message: "이미지 스타일을 변환해줘" },
  ],
  music: [
    { icon: "🎼", label: "작곡", message: "멜로디를 만들어줘" },
    { icon: "🎤", label: "가사 작성", message: "노래 가사를 작성해줘" },
    { icon: "🔊", label: "TTS 변환", message: "텍스트를 음성으로 변환해줘" },
    { icon: "🎹", label: "음악 분석", message: "이 곡을 분석해줘" },
  ],
  other: [
    { icon: "👋", label: "안녕하세요", message: "안녕하세요!" },
    { icon: "❓", label: "무엇을 할 수 있나요?", message: "도움말" },
    { icon: "📊", label: "모델 전략", message: "현재 모델 전략 정보 알려줘" },
    { icon: "📢", label: "채널 안내", message: "지원하는 채널 알려줘" },
  ],
};

export default function ChatPage() {
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

  const [sessionId] = useState(() => {
    if (typeof window !== "undefined") {
      let sid = sessionStorage.getItem("moa_chat_session");
      if (!sid) {
        sid = `session_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
        sessionStorage.setItem("moa_chat_session", sid);
      }
      return sid;
    }
    return "session_default";
  });

  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [selectedCategory, setSelectedCategory] = useState<CategoryId>("other");
  const [creditBalance, setCreditBalance] = useState<number | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, []);

  useEffect(() => { scrollToBottom(); }, [messages, scrollToBottom]);

  // Load saved category
  useEffect(() => {
    if (typeof window !== "undefined") {
      const saved = localStorage.getItem("moa_category");
      if (saved && CATEGORIES.some((c) => c.id === saved)) {
        setSelectedCategory(saved as CategoryId);
      }
    }
  }, []);

  // Load history and credits on mount
  useEffect(() => {
    (async () => {
      try {
        const res = await fetch(`/api/chat?user_id=${encodeURIComponent(userId)}&session_id=${encodeURIComponent(sessionId)}`);
        if (!res.ok) return;
        const data = await res.json();
        if (data.messages?.length) {
          setMessages(data.messages);
        }
      } catch { /* ignore */ }
      // Load credit balance
      try {
        const credRes = await fetch(`/api/credits?user_id=${encodeURIComponent(userId)}`);
        if (credRes.ok) {
          const credData = await credRes.json();
          setCreditBalance(credData.balance ?? null);
        }
      } catch { /* ignore */ }
    })();
  }, [userId, sessionId]);

  const handleCategoryChange = (catId: CategoryId) => {
    setSelectedCategory(catId);
    if (typeof window !== "undefined") {
      localStorage.setItem("moa_category", catId);
    }
  };

  const sendMessage = async (text: string) => {
    if (!text.trim() || sending) return;

    const userMsg: ChatMessage = {
      id: `temp_${Date.now()}`,
      role: "user",
      content: text.trim(),
      created_at: new Date().toISOString(),
    };

    setMessages((prev) => [...prev, userMsg]);
    setInput("");
    setSending(true);

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          user_id: userId,
          session_id: sessionId,
          content: text.trim(),
          category: selectedCategory,
        }),
      });

      const data = await res.json();

      if (data.reply) {
        const aiMsg: ChatMessage = {
          id: `ai_${Date.now()}`,
          role: "assistant",
          content: data.reply,
          model_used: data.model,
          created_at: data.timestamp ?? new Date().toISOString(),
        };
        setMessages((prev) => [...prev, aiMsg]);
        // Update credit balance from response
        if (data.credits_remaining !== undefined) {
          setCreditBalance(data.credits_remaining);
        }
      } else if (data.error) {
        const errorMsg: ChatMessage = {
          id: `err_${Date.now()}`,
          role: "system",
          content: `오류: ${data.error}`,
          created_at: new Date().toISOString(),
        };
        setMessages((prev) => [...prev, errorMsg]);
      }
    } catch {
      const errorMsg: ChatMessage = {
        id: `err_${Date.now()}`,
        role: "system",
        content: "네트워크 오류가 발생했습니다. 다시 시도해주세요.",
        created_at: new Date().toISOString(),
      };
      setMessages((prev) => [...prev, errorMsg]);
    } finally {
      setSending(false);
      inputRef.current?.focus();
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage(input);
    }
  };

  const startNewSession = () => {
    const newSid = `session_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    sessionStorage.setItem("moa_chat_session", newSid);
    setMessages([]);
    window.location.reload();
  };

  const currentCategory = CATEGORIES.find((c) => c.id === selectedCategory)!;
  const quickActions = CATEGORY_ACTIONS[selectedCategory];

  return (
    <>
      <Nav />
      <div className="chat-layout">
        {/* Sidebar */}
        <aside className={`chat-sidebar ${sidebarOpen ? "open" : ""}`}>
          <div className="chat-sidebar-header">
            <h2>{"💬"} MoA 채팅</h2>
            <button className="chat-sidebar-close" onClick={() => setSidebarOpen(false)}>
              {"✕"}
            </button>
          </div>
          <button className="chat-new-btn" onClick={startNewSession}>
            + 새 대화
          </button>

          {/* Category Selection in Sidebar */}
          <div className="chat-sidebar-section">
            <h3>카테고리</h3>
            <div className="chat-category-list">
              {CATEGORIES.map((cat) => (
                <button
                  key={cat.id}
                  className={`chat-category-item ${selectedCategory === cat.id ? "active" : ""}`}
                  onClick={() => handleCategoryChange(cat.id)}
                  style={{ "--cat-color": cat.color } as React.CSSProperties}
                >
                  <span className="chat-category-icon">{cat.icon}</span>
                  <div className="chat-category-info">
                    <span className="chat-category-name">{cat.label}</span>
                    <span className="chat-category-desc">{cat.desc}</span>
                  </div>
                </button>
              ))}
            </div>
          </div>

          <div className="chat-sidebar-section">
            <h3>바로가기</h3>
            <div className="chat-channel-links">
              <Link href="/synthesis" className="chat-channel-link">
                <span>{"📑"}</span> 종합문서 작성
              </Link>
              <Link href="/autocode" className="chat-channel-link">
                <span>{"🤖"}</span> AI 자동코딩
              </Link>
              <Link href="/editor" className="chat-channel-link">
                <span>{"📝"}</span> 문서 에디터
              </Link>
              <Link href="/channels" className="chat-channel-link">
                <span>{"📡"}</span> 채널 허브
              </Link>
              <Link href="/mypage" className="chat-channel-link">
                <span>{"⚙️"}</span> 마이페이지
              </Link>
              <Link href="/" className="chat-channel-link">
                <span>{"🏠"}</span> 홈으로
              </Link>
            </div>
          </div>
        </aside>

        {/* Main Chat Area */}
        <main className="chat-main">
          {/* Chat Header */}
          <div className="chat-header">
            <button className="chat-menu-btn" onClick={() => setSidebarOpen(true)}>
              {"☰"}
            </button>
            <div className="chat-header-title">
              <h1>MoA AI</h1>
              <span className="chat-header-status">
                {"●"} 온라인 &middot; 15개 채널 연동
              </span>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
              {creditBalance !== null && (
                <Link href="/billing" style={{
                  fontSize: "0.75rem", padding: "4px 10px", borderRadius: "12px",
                  background: creditBalance < 10 ? "rgba(252,129,129,0.15)" : "rgba(102,126,234,0.15)",
                  color: creditBalance < 10 ? "var(--danger)" : "var(--primary)",
                  textDecoration: "none", fontWeight: 600,
                }}>
                  {creditBalance.toLocaleString()} 크레딧
                </Link>
              )}
              <div className="chat-header-category" style={{ "--cat-color": currentCategory.color } as React.CSSProperties}>
                <span>{currentCategory.icon}</span>
                <span>{currentCategory.label}</span>
              </div>
            </div>
          </div>

          {/* Category Bar */}
          <div className="chat-category-bar">
            {CATEGORIES.map((cat) => (
              <button
                key={cat.id}
                className={`chat-cat-chip ${selectedCategory === cat.id ? "active" : ""}`}
                onClick={() => handleCategoryChange(cat.id)}
                style={{ "--cat-color": cat.color } as React.CSSProperties}
              >
                <span>{cat.icon}</span>
                <span>{cat.label}</span>
              </button>
            ))}
          </div>

          {/* Messages Area */}
          <div className="chat-messages">
            {messages.length === 0 && (
              <div className="chat-welcome">
                <div className="chat-welcome-icon" style={{ color: currentCategory.color }}>
                  {currentCategory.icon}
                </div>
                <h2>{currentCategory.label} 모드</h2>
                <p>{currentCategory.desc}</p>
                <p style={{ fontSize: "0.85rem", color: "var(--text-muted)", marginTop: -16 }}>
                  카테고리를 선택하면 MoA가 관련 스킬을 우선적으로 활용합니다.
                </p>
                <div className="chat-quick-actions">
                  {quickActions.map((action) => (
                    <button
                      key={action.label}
                      className="chat-quick-btn"
                      onClick={() => sendMessage(action.message)}
                      style={{ borderColor: `${currentCategory.color}40` }}
                    >
                      <span>{action.icon}</span>
                      {action.label}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {messages.map((msg) => (
              <div key={msg.id} className={`chat-msg chat-msg-${msg.role}`}>
                <div className="chat-msg-avatar">
                  {msg.role === "user" ? "👤" : msg.role === "assistant" ? "🤖" : "⚠️"}
                </div>
                <div className="chat-msg-body">
                  <div className="chat-msg-meta">
                    <span className="chat-msg-sender">
                      {msg.role === "user" ? "나" : msg.role === "assistant" ? "MoA" : "시스템"}
                    </span>
                    <span className="chat-msg-time">
                      {new Date(msg.created_at).toLocaleTimeString("ko-KR", {
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </span>
                    {msg.model_used && (
                      <span className="chat-msg-model">{msg.model_used}</span>
                    )}
                  </div>
                  <div className="chat-msg-text">
                    {msg.content.split("\n").map((line, i) => (
                      <span key={i}>
                        {line}
                        {i < msg.content.split("\n").length - 1 && <br />}
                      </span>
                    ))}
                  </div>
                </div>
              </div>
            ))}

            {sending && (
              <div className="chat-msg chat-msg-assistant">
                <div className="chat-msg-avatar">{"🤖"}</div>
                <div className="chat-msg-body">
                  <div className="chat-typing">
                    <span></span><span></span><span></span>
                  </div>
                </div>
              </div>
            )}

            <div ref={messagesEndRef} />
          </div>

          {/* Input Area */}
          <div className="chat-input-area">
            <div className="chat-input-wrapper">
              <textarea
                ref={inputRef}
                className="chat-input"
                placeholder={`${currentCategory.label} 모드 — MoA에게 메시지를 보내세요... (Enter로 전송)`}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                rows={1}
                disabled={sending}
              />
              <button
                className="chat-send-btn"
                onClick={() => sendMessage(input)}
                disabled={sending || !input.trim()}
                style={{ background: sending ? undefined : currentCategory.color }}
              >
                {sending ? "⏳" : "➤"}
              </button>
            </div>
            <p className="chat-input-hint">
              {"🔒"} E2E 암호화 &middot;{" "}
              <Link href="/synthesis">종합문서</Link> &middot;{" "}
              <Link href="/autocode">자동코딩</Link> &middot;{" "}
              <Link href="/editor">에디터</Link> &middot;{" "}
              <Link href="/channels">다른 채널</Link>
            </p>
          </div>
        </main>
      </div>
    </>
  );
}
