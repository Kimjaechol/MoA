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

const QUICK_ACTIONS = [
  { icon: "👋", label: "안녕하세요", message: "안녕하세요!" },
  { icon: "❓", label: "무엇을 할 수 있나요?", message: "도움말" },
  { icon: "🌤️", label: "오늘 날씨", message: "오늘 날씨 알려줘" },
  { icon: "📊", label: "모델 전략", message: "현재 모델 전략 정보 알려줘" },
  { icon: "📢", label: "채널 안내", message: "지원하는 채널 알려줘" },
];

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
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, []);

  useEffect(() => { scrollToBottom(); }, [messages, scrollToBottom]);

  // Load history on mount
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
    })();
  }, [userId, sessionId]);

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
        }),
      });

      const data = await res.json();

      if (data.reply) {
        const aiMsg: ChatMessage = {
          id: `ai_${Date.now()}`,
          role: "assistant",
          content: data.reply,
          model_used: data.model,
          created_at: data.timestamp,
        };
        setMessages((prev) => [...prev, aiMsg]);
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
          <div className="chat-sidebar-section">
            <h3>채널 바로가기</h3>
            <div className="chat-channel-links">
              <Link href="/channels/kakaotalk" className="chat-channel-link">
                <span>{"🟡"}</span> 카카오톡
              </Link>
              <Link href="/channels/telegram" className="chat-channel-link">
                <span>{"✈️"}</span> 텔레그램
              </Link>
              <Link href="/channels/discord" className="chat-channel-link">
                <span>{"🎮"}</span> Discord
              </Link>
              <Link href="/channels/whatsapp" className="chat-channel-link">
                <span>{"📞"}</span> WhatsApp
              </Link>
              <Link href="/channels/line" className="chat-channel-link">
                <span>{"🟢"}</span> LINE
              </Link>
              <Link href="/channels" className="chat-channel-link" style={{ color: "var(--primary)" }}>
                모든 채널 보기 &rarr;
              </Link>
            </div>
          </div>
          <div className="chat-sidebar-section">
            <h3>바로가기</h3>
            <Link href="/mypage" className="chat-channel-link">
              <span>{"⚙️"}</span> 마이페이지 (API 키 관리)
            </Link>
            <Link href="/" className="chat-channel-link">
              <span>{"🏠"}</span> 홈으로
            </Link>
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
            <Link href="/channels" className="chat-header-channels">
              채널 허브
            </Link>
          </div>

          {/* Messages Area */}
          <div className="chat-messages">
            {messages.length === 0 && (
              <div className="chat-welcome">
                <div className="chat-welcome-icon">{"🤖"}</div>
                <h2>MoA에 오신 것을 환영합니다!</h2>
                <p>
                  카카오톡, 텔레그램, Discord 등 15개 채널에서
                  동일한 AI와 대화할 수 있습니다.
                  여기서 바로 시작해보세요!
                </p>
                <div className="chat-quick-actions">
                  {QUICK_ACTIONS.map((action) => (
                    <button
                      key={action.label}
                      className="chat-quick-btn"
                      onClick={() => sendMessage(action.message)}
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
                placeholder="MoA에게 메시지를 보내세요... (Enter로 전송, Shift+Enter로 줄바꿈)"
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
              >
                {sending ? "⏳" : "➤"}
              </button>
            </div>
            <p className="chat-input-hint">
              {"🔒"} E2E 암호화 &middot; 카카오톡에서도 동일한 대화 가능 &middot;{" "}
              <Link href="/channels">다른 채널로 연결</Link>
            </p>
          </div>
        </main>
      </div>
    </>
  );
}
