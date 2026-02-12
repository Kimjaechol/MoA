"use client";

import { useState, useRef, useEffect, useCallback } from "react";

interface WidgetMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  created_at: string;
}

export default function ChatWidget() {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<WidgetMessage[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const getUserId = useCallback(() => {
    if (typeof window === "undefined") return "anonymous";
    let id = localStorage.getItem("moa_user_id");
    if (!id) {
      id = `user_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      localStorage.setItem("moa_user_id", id);
    }
    return id;
  }, []);

  const getSessionId = useCallback(() => {
    if (typeof window === "undefined") return "widget_default";
    let sid = localStorage.getItem("moa_widget_session");
    if (!sid) {
      sid = `widget_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      localStorage.setItem("moa_widget_session", sid);
    }
    return sid;
  }, []);

  useEffect(() => {
    if (open) {
      messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
      inputRef.current?.focus();
    }
  }, [open, messages]);

  const sendMessage = async () => {
    if (!input.trim() || sending) return;
    const text = input.trim();

    const userMsg: WidgetMessage = {
      id: `u_${Date.now()}`,
      role: "user",
      content: text,
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
          user_id: getUserId(),
          session_id: getSessionId(),
          content: text,
        }),
      });
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }
      const data = await res.json();
      if (data.error) {
        throw new Error(data.error);
      }
      if (data.reply) {
        setMessages((prev) => [
          ...prev,
          {
            id: `a_${Date.now()}`,
            role: "assistant",
            content: data.reply,
            created_at: data.timestamp ?? new Date().toISOString(),
          },
        ]);
      }
    } catch {
      setMessages((prev) => [
        ...prev,
        {
          id: `e_${Date.now()}`,
          role: "assistant",
          content: "\uC624\uB958\uAC00 \uBC1C\uC0DD\uD588\uC2B5\uB2C8\uB2E4. \uB2E4\uC2DC \uC2DC\uB3C4\uD574\uC8FC\uC138\uC694.",
          created_at: new Date().toISOString(),
        },
      ]);
    } finally {
      setSending(false);
    }
  };

  return (
    <>
      {/* Floating button */}
      <button
        className="chat-widget-fab"
        onClick={() => setOpen(!open)}
        aria-label={open ? "\uCC44\uD305 \uB2EB\uAE30" : "MoA\uC640 \uCC44\uD305"}
      >
        {open ? "\u2715" : "\uD83D\uDCAC"}
      </button>

      {/* Chat panel */}
      {open && (
        <div className="chat-widget-panel">
          <div className="chat-widget-header">
            <div>
              <strong>MoA AI</strong>
              <span style={{ fontSize: "0.75rem", color: "rgba(255,255,255,0.7)", marginLeft: "8px" }}>
                {"\u25CF"} \uC628\uB77C\uC778
              </span>
            </div>
            <a href="/chat" style={{ fontSize: "0.75rem", color: "rgba(255,255,255,0.8)" }}>
              \uC804\uCCB4 \uD654\uBA74 &rarr;
            </a>
          </div>

          <div className="chat-widget-messages">
            {messages.length === 0 && (
              <div style={{ textAlign: "center", padding: "32px 16px", color: "var(--text-muted)" }}>
                <div style={{ fontSize: "2.5rem", marginBottom: "12px" }}>{"\uD83E\uDD16"}</div>
                <p style={{ fontSize: "0.85rem" }}>
                  MoA AI\uC5D0\uAC8C \uBB34\uC5C7\uC774\uB4E0 \uBB3C\uC5B4\uBCF4\uC138\uC694!
                </p>
              </div>
            )}
            {messages.map((msg) => (
              <div key={msg.id} className={`chat-widget-msg chat-widget-msg-${msg.role}`}>
                {msg.content.split("\n").map((line, i) => (
                  <span key={i}>
                    {line}
                    {i < msg.content.split("\n").length - 1 && <br />}
                  </span>
                ))}
              </div>
            ))}
            {sending && (
              <div className="chat-widget-msg chat-widget-msg-assistant">
                <span className="chat-typing-dots">
                  <span></span><span></span><span></span>
                </span>
              </div>
            )}
            <div ref={messagesEndRef} />
          </div>

          <div className="chat-widget-input-area">
            <input
              ref={inputRef}
              type="text"
              className="chat-widget-input"
              placeholder="\uBA54\uC2DC\uC9C0\uB97C \uC785\uB825\uD558\uC138\uC694..."
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") sendMessage(); }}
              disabled={sending}
            />
            <button
              className="chat-widget-send"
              onClick={sendMessage}
              disabled={sending || !input.trim()}
            >
              {"\u27A4"}
            </button>
          </div>
        </div>
      )}
    </>
  );
}
