"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import Link from "next/link";

interface ChatMessage {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  model_used?: string;
  created_at: string;
}

interface DeviceInfo {
  deviceName: string;
  platform: string;
  status: string;
}

/**
 * WebChatPanel - 홈페이지 임베디드 웹 채팅
 *
 * 로그인 후 홈페이지 메인에 채팅창이 노출됩니다.
 * 공항 PC 등 어디서든 로그인하여 집/사무실의 MoA에 명령을 내릴 수 있습니다.
 */
export default function WebChatPanel() {
  const [loggedIn, setLoggedIn] = useState(false);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [loginError, setLoginError] = useState("");
  const [loginLoading, setLoginLoading] = useState(false);
  const [devices, setDevices] = useState<DeviceInfo[]>([]);
  const [selectedDevice, setSelectedDevice] = useState<string>("");

  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [sessionId] = useState(() => `web_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // Check if already logged in
  useEffect(() => {
    if (typeof window === "undefined") return;
    const saved = sessionStorage.getItem("moa_web_auth");
    if (saved) {
      try {
        const data = JSON.parse(saved);
        if (data.username && data.token) {
          setUsername(data.username);
          setDevices(data.devices || []);
          setSelectedDevice(data.selectedDevice || "");
          setLoggedIn(true);
        }
      } catch {
        /* ignore */
      }
    }
  }, []);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  useEffect(() => {
    if (loggedIn) inputRef.current?.focus();
  }, [loggedIn]);

  const handleLogin = async () => {
    if (!username.trim() || !password) {
      setLoginError("아이디와 비밀번호를 입력해주세요.");
      return;
    }

    setLoginLoading(true);
    setLoginError("");

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "web_login",
          username: username.trim(),
          password,
        }),
      });

      const data = await res.json();

      if (data.success) {
        const deviceList: DeviceInfo[] = (data.devices || []).map(
          (d: string | DeviceInfo) =>
            typeof d === "string"
              ? { deviceName: d, platform: "unknown", status: "online" }
              : d,
        );
        setDevices(deviceList);
        setSelectedDevice(deviceList[0]?.deviceName || "");
        setLoggedIn(true);
        setPassword("");

        sessionStorage.setItem(
          "moa_web_auth",
          JSON.stringify({
            username: username.trim(),
            token: data.token || "session",
            devices: deviceList,
            selectedDevice: deviceList[0]?.deviceName || "",
          }),
        );

        // No devices → show install prompt instead of chat
        if (deviceList.length === 0) {
          setMessages([
            {
              id: "no-device",
              role: "system",
              content: "등록된 기기가 없습니다. MoA 에이전트를 먼저 설치해주세요.",
              created_at: new Date().toISOString(),
            },
          ]);
        } else {
          // Welcome message
          setMessages([
            {
              id: "welcome",
              role: "assistant",
              content: `${username.trim()}님 환영합니다! 🤖\n\n등록된 기기 (${deviceList.length}대)에 연결되었습니다.\n메시지를 보내면 MoA AI가 응답합니다.`,
              created_at: new Date().toISOString(),
            },
          ]);
        }
      } else {
        setLoginError(data.error || "로그인에 실패했습니다.");
      }
    } catch {
      setLoginError("서버에 연결할 수 없습니다.");
    } finally {
      setLoginLoading(false);
    }
  };

  const handleLogout = () => {
    sessionStorage.removeItem("moa_web_auth");
    setLoggedIn(false);
    setMessages([]);
    setUsername("");
    setPassword("");
    setDevices([]);
    setSelectedDevice("");
  };

  const sendMessage = useCallback(
    async (text: string) => {
      if (!text.trim() || sending) return;

      const userMsg: ChatMessage = {
        id: `u_${Date.now()}`,
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
            user_id: username,
            session_id: sessionId,
            content: text.trim(),
            device: selectedDevice || undefined,
          }),
        });
        const data = await res.json();
        if (data.reply) {
          setMessages((prev) => [
            ...prev,
            {
              id: `a_${Date.now()}`,
              role: "assistant",
              content: data.reply,
              model_used: data.model,
              created_at: data.timestamp ?? new Date().toISOString(),
            },
          ]);
        }
      } catch {
        setMessages((prev) => [
          ...prev,
          {
            id: `e_${Date.now()}`,
            role: "system",
            content: "네트워크 오류가 발생했습니다. 다시 시도해주세요.",
            created_at: new Date().toISOString(),
          },
        ]);
      } finally {
        setSending(false);
        inputRef.current?.focus();
      }
    },
    [sending, username, sessionId, selectedDevice],
  );

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage(input);
    }
  };

  // ── Login form ──
  if (!loggedIn) {
    return (
      <div className="web-chat-login">
        <div className="web-chat-login-inner">
          <div style={{ textAlign: "center", marginBottom: "24px" }}>
            <div style={{ fontSize: "3rem", marginBottom: "8px" }}>{"\uD83E\uDD16"}</div>
            <h3 style={{ fontSize: "1.3rem", marginBottom: "4px" }}>MoA 웹 채팅</h3>
            <p style={{ color: "var(--text-muted)", fontSize: "0.85rem" }}>
              로그인하면 어디서든 MoA AI와 대화할 수 있습니다
            </p>
          </div>
          <div className="web-chat-field">
            <input
              type="text"
              placeholder="아이디"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") handleLogin(); }}
              autoComplete="username"
            />
          </div>
          <div className="web-chat-field">
            <input
              type="password"
              placeholder="비밀번호"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") handleLogin(); }}
              autoComplete="current-password"
            />
          </div>
          {loginError && (
            <p style={{ color: "#dc2626", fontSize: "0.85rem", textAlign: "center", marginBottom: "12px" }}>
              {loginError}
            </p>
          )}
          <button
            className="btn btn-primary"
            style={{ width: "100%", padding: "14px", fontSize: "1rem", fontWeight: 700 }}
            onClick={handleLogin}
            disabled={loginLoading}
          >
            {loginLoading ? "로그인 중..." : "로그인"}
          </button>
          <p style={{ color: "var(--text-muted)", fontSize: "0.8rem", textAlign: "center", marginTop: "16px" }}>
            MoA를 설치한 기기가 있어야 합니다.{" "}
            <a href="#download" style={{ color: "var(--primary)" }}>먼저 설치하기</a>
          </p>
        </div>
      </div>
    );
  }

  // ── No devices: show install prompt ──
  if (loggedIn && devices.length === 0) {
    return (
      <div className="web-chat-panel">
        <div style={{
          display: "flex", flexDirection: "column", alignItems: "center",
          justifyContent: "center", height: "100%", padding: "48px 24px",
          textAlign: "center",
        }}>
          <div style={{ fontSize: "3.5rem", marginBottom: "16px" }}>{"📱"}</div>
          <h3 style={{ fontSize: "1.3rem", fontWeight: 800, marginBottom: "8px" }}>
            먼저 MoA 에이전트를 설치하세요
          </h3>
          <p style={{ color: "var(--text-muted)", fontSize: "0.9rem", marginBottom: "24px", lineHeight: 1.6 }}>
            웹 채팅을 사용하려면 최소 1대의 기기에<br />MoA가 설치되어 있어야 합니다.
          </p>
          <div style={{ display: "flex", gap: "12px", flexWrap: "wrap", justifyContent: "center" }}>
            <Link
              href="/download"
              className="btn btn-primary"
              style={{ padding: "12px 28px", fontSize: "0.95rem", fontWeight: 700 }}
            >
              지금 다운로드
            </Link>
            <button
              className="btn btn-outline"
              style={{ padding: "12px 20px", fontSize: "0.85rem" }}
              onClick={handleLogout}
            >
              로그아웃
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ── Chat interface ──
  return (
    <div className="web-chat-panel">
      {/* Header */}
      <div className="web-chat-header">
        <div className="web-chat-header-left">
          <strong>MoA AI</strong>
          <span className="web-chat-status">{"\u25CF"} 연결됨</span>
          {devices.length > 1 && (
            <select
              className="web-chat-device-select"
              value={selectedDevice}
              onChange={(e) => setSelectedDevice(e.target.value)}
            >
              {devices.map((d) => (
                <option key={d.deviceName} value={d.deviceName}>
                  {d.deviceName}
                </option>
              ))}
            </select>
          )}
          {devices.length === 1 && (
            <span className="web-chat-device-badge">
              {devices[0].deviceName}
            </span>
          )}
        </div>
        <div className="web-chat-header-right">
          <a href="/chat" className="web-chat-expand">전체 화면</a>
          <button className="web-chat-logout" onClick={handleLogout}>
            로그아웃
          </button>
        </div>
      </div>

      {/* Messages */}
      <div className="web-chat-messages">
        {messages.map((msg) => (
          <div key={msg.id} className={`web-chat-msg web-chat-msg-${msg.role}`}>
            <div className="web-chat-msg-avatar">
              {msg.role === "user"
                ? "\uD83D\uDC64"
                : msg.role === "assistant"
                  ? "\uD83E\uDD16"
                  : "\u26A0\uFE0F"}
            </div>
            <div className="web-chat-msg-body">
              <div className="web-chat-msg-meta">
                <span className="web-chat-msg-sender">
                  {msg.role === "user"
                    ? username
                    : msg.role === "assistant"
                      ? "MoA"
                      : "시스템"}
                </span>
                <span className="web-chat-msg-time">
                  {new Date(msg.created_at).toLocaleTimeString("ko-KR", {
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                </span>
                {msg.model_used && (
                  <span className="web-chat-msg-model">{msg.model_used}</span>
                )}
              </div>
              <div className="web-chat-msg-text">
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
          <div className="web-chat-msg web-chat-msg-assistant">
            <div className="web-chat-msg-avatar">{"\uD83E\uDD16"}</div>
            <div className="web-chat-msg-body">
              <div className="chat-typing">
                <span></span>
                <span></span>
                <span></span>
              </div>
            </div>
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Input */}
      <div className="web-chat-input-area">
        <textarea
          ref={inputRef}
          className="web-chat-input"
          placeholder="MoA에게 메시지를 보내세요... (Enter로 전송)"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          rows={1}
          disabled={sending}
        />
        <button
          className="web-chat-send"
          onClick={() => sendMessage(input)}
          disabled={sending || !input.trim()}
        >
          {sending ? "\u23F3" : "\u27A4"}
        </button>
      </div>
    </div>
  );
}
