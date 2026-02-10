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
  { icon: "\uD83D\uDC4B", label: "\uC548\uB155\uD558\uC138\uC694", message: "\uC548\uB155\uD558\uC138\uC694!" },
  { icon: "\u2753", label: "\uBB34\uC5C7\uC744 \uD560 \uC218 \uC788\uB098\uC694?", message: "\uB3C4\uC6C0\uB9D0" },
  { icon: "\uD83C\uDF24\uFE0F", label: "\uC624\uB298 \uB0A0\uC528", message: "\uC624\uB298 \uB0A0\uC528 \uC54C\uB824\uC918" },
  { icon: "\uD83D\uDCCA", label: "\uBAA8\uB378 \uC804\uB7B5", message: "\uD604\uC7AC \uBAA8\uB378 \uC804\uB7B5 \uC815\uBCF4 \uC54C\uB824\uC918" },
  { icon: "\uD83D\uDCE2", label: "\uCC44\uB110 \uC548\uB0B4", message: "\uC9C0\uC6D0\uD558\uB294 \uCC44\uB110 \uC54C\uB824\uC918" },
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
        content: "\uB124\uD2B8\uC6CC\uD06C \uC624\uB958\uAC00 \uBC1C\uC0DD\uD588\uC2B5\uB2C8\uB2E4. \uB2E4\uC2DC \uC2DC\uB3C4\uD574\uC8FC\uC138\uC694.",
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
            <h2>\uD83D\uDCAC MoA \uCC44\uD305</h2>
            <button className="chat-sidebar-close" onClick={() => setSidebarOpen(false)}>
              {"\u2715"}
            </button>
          </div>
          <button className="chat-new-btn" onClick={startNewSession}>
            + \uC0C8 \uB300\uD654
          </button>
          <div className="chat-sidebar-section">
            <h3>\uCC44\uB110 \uBC14\uB85C\uAC00\uAE30</h3>
            <div className="chat-channel-links">
              <Link href="/channels/kakaotalk" className="chat-channel-link">
                <span>\uD83D\uDFE1</span> \uCE74\uCE74\uC624\uD1A1
              </Link>
              <Link href="/channels/telegram" className="chat-channel-link">
                <span>\u2708\uFE0F</span> \uD154\uB808\uADF8\uB7A8
              </Link>
              <Link href="/channels/discord" className="chat-channel-link">
                <span>\uD83C\uDFAE</span> Discord
              </Link>
              <Link href="/channels/whatsapp" className="chat-channel-link">
                <span>\uD83D\uDCDE</span> WhatsApp
              </Link>
              <Link href="/channels/line" className="chat-channel-link">
                <span>\uD83D\uDFE2</span> LINE
              </Link>
              <Link href="/channels" className="chat-channel-link" style={{ color: "var(--primary)" }}>
                \uBAA8\uB4E0 \uCC44\uB110 \uBCF4\uAE30 &rarr;
              </Link>
            </div>
          </div>
          <div className="chat-sidebar-section">
            <h3>\uBC14\uB85C\uAC00\uAE30</h3>
            <Link href="/mypage" className="chat-channel-link">
              <span>\u2699\uFE0F</span> \uB9C8\uC774\uD398\uC774\uC9C0 (API \uD0A4 \uAD00\uB9AC)
            </Link>
            <Link href="/" className="chat-channel-link">
              <span>\uD83C\uDFE0</span> \uD648\uC73C\uB85C
            </Link>
          </div>
        </aside>

        {/* Main Chat Area */}
        <main className="chat-main">
          {/* Chat Header */}
          <div className="chat-header">
            <button className="chat-menu-btn" onClick={() => setSidebarOpen(true)}>
              {"\u2630"}
            </button>
            <div className="chat-header-title">
              <h1>MoA AI</h1>
              <span className="chat-header-status">
                {"\u25CF"} \uC628\uB77C\uC778 &middot; 15\uAC1C \uCC44\uB110 \uC5F0\uB3D9
              </span>
            </div>
            <Link href="/channels" className="chat-header-channels">
              \uCC44\uB110 \uD5C8\uBE0C
            </Link>
          </div>

          {/* Messages Area */}
          <div className="chat-messages">
            {messages.length === 0 && (
              <div className="chat-welcome">
                <div className="chat-welcome-icon">{"\uD83E\uDD16"}</div>
                <h2>MoA\uC5D0 \uC624\uC2E0 \uAC83\uC744 \uD658\uC601\uD569\uB2C8\uB2E4!</h2>
                <p>
                  \uCE74\uCE74\uC624\uD1A1, \uD154\uB808\uADF8\uB7A8, Discord \uB4F1 15\uAC1C \uCC44\uB110\uC5D0\uC11C
                  \uB3D9\uC77C\uD55C AI\uC640 \uB300\uD654\uD560 \uC218 \uC788\uC2B5\uB2C8\uB2E4.
                  \uC5EC\uAE30\uC11C \uBC14\uB85C \uC2DC\uC791\uD574\uBCF4\uC138\uC694!
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
                  {msg.role === "user" ? "\uD83D\uDC64" : msg.role === "assistant" ? "\uD83E\uDD16" : "\u26A0\uFE0F"}
                </div>
                <div className="chat-msg-body">
                  <div className="chat-msg-meta">
                    <span className="chat-msg-sender">
                      {msg.role === "user" ? "\uB098" : msg.role === "assistant" ? "MoA" : "\uC2DC\uC2A4\uD15C"}
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
                <div className="chat-msg-avatar">{"\uD83E\uDD16"}</div>
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
                placeholder="MoA\uC5D0\uAC8C \uBA54\uC2DC\uC9C0\uB97C \uBCF4\uB0B4\uC138\uC694... (Enter\uB85C \uC804\uC1A1, Shift+Enter\uB85C \uC904\uBC14\uAFBC)"
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
                {sending ? "\u23F3" : "\u27A4"}
              </button>
            </div>
            <p className="chat-input-hint">
              \uD83D\uDD12 E2E \uC554\uD638\uD654 &middot; \uCE74\uCE74\uC624\uD1A1\uC5D0\uC11C\uB3C4 \uB3D9\uC77C\uD55C \uB300\uD654 \uAC00\uB2A5 &middot;{" "}
              <Link href="/channels">\uB2E4\uB978 \uCC44\uB110\uB85C \uC5F0\uACB0</Link>
            </p>
          </div>
        </main>
      </div>
    </>
  );
}
