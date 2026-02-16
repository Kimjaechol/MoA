"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

interface ChatMessage {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  model_used?: string;
  created_at: string;
}

/** MoA category definitions */
const CATEGORIES = [
  { id: "daily", label: "일상비서", icon: "\u{1F3E0}", color: "#48bb78", desc: "일정, 날씨, 번역, 생활 도우미" },
  { id: "work", label: "업무보조", icon: "\u{1F4BC}", color: "#667eea", desc: "이메일, 보고서, 회의록, 데이터 분석" },
  { id: "document", label: "문서작업", icon: "\u{1F4C4}", color: "#9c27b0", desc: "문서 작성, 변환, 종합, 요약" },
  { id: "coding", label: "코딩작업", icon: "\u{1F4BB}", color: "#4caf50", desc: "코드 작성, 디버깅, 리뷰, 자동코딩" },
  { id: "image", label: "이미지작업", icon: "\u{1F3A8}", color: "#e91e63", desc: "이미지 생성, 편집, 분석, 변환" },
  { id: "music", label: "음악작업", icon: "\u{1F3B5}", color: "#ff9800", desc: "작곡, 편곡, 음악 분석, TTS" },
  { id: "interpreter", label: "실시간 통역", icon: "\u{1F5E3}\uFE0F", color: "#FF6B6B", desc: "한국어, 영어, 일본어, 중국어 등 25개 언어 실시간 통역" },
  { id: "other", label: "기타", icon: "\u2728", color: "#9a9ab0", desc: "기타 질문 및 자유 대화" },
] as const;

type CategoryId = (typeof CATEGORIES)[number]["id"];

/** Category-specific quick actions */
const CATEGORY_ACTIONS: Record<CategoryId, Array<{ icon: string; label: string; message: string }>> = {
  daily: [
    { icon: "\u{1F324}\uFE0F", label: "오늘 날씨", message: "오늘 날씨 알려줘" },
    { icon: "\u{1F4C5}", label: "일정 관리", message: "이번 주 일정을 정리해줘" },
    { icon: "\u{1F30D}", label: "번역", message: "이 문장을 영어로 번역해줘" },
    { icon: "\u{1F37D}\uFE0F", label: "맛집 추천", message: "근처 맛집 추천해줘" },
  ],
  work: [
    { icon: "\u{1F4E7}", label: "이메일 작성", message: "비즈니스 이메일 작성을 도와줘" },
    { icon: "\u{1F4CA}", label: "데이터 분석", message: "이 데이터를 분석해줘" },
    { icon: "\u{1F4DD}", label: "회의록 작성", message: "회의록을 정리해줘" },
    { icon: "\u{1F4C8}", label: "보고서 작성", message: "보고서를 작성해줘" },
  ],
  document: [
    { icon: "\u{1F4CB}", label: "문서 요약", message: "이 문서를 요약해줘" },
    { icon: "\u{1F4D1}", label: "종합문서 작성", message: "여러 자료를 종합해서 문서를 작성해줘" },
    { icon: "\u{1F4C4}", label: "형식 변환", message: "문서를 다른 형식으로 변환해줘" },
    { icon: "\u{1F3AF}", label: "PPTX 생성", message: "이 내용으로 발표 자료를 만들어줘" },
  ],
  coding: [
    { icon: "\u{1F527}", label: "코드 작성", message: "코드를 작성해줘" },
    { icon: "\u{1F41B}", label: "디버깅", message: "이 코드의 버그를 찾아줘" },
    { icon: "\u{1F504}", label: "자동코딩", message: "자동으로 코딩하고 에러를 수정해줘" },
    { icon: "\u{1F4D6}", label: "코드 리뷰", message: "이 코드를 리뷰해줘" },
  ],
  image: [
    { icon: "\u{1F5BC}\uFE0F", label: "이미지 생성", message: "이미지를 생성해줘" },
    { icon: "\u2702\uFE0F", label: "이미지 편집", message: "이 이미지를 편집해줘" },
    { icon: "\u{1F50D}", label: "이미지 분석", message: "이 이미지를 분석해줘" },
    { icon: "\u{1F3AD}", label: "스타일 변환", message: "이미지 스타일을 변환해줘" },
  ],
  music: [
    { icon: "\u{1F3BC}", label: "작곡", message: "멜로디를 만들어줘" },
    { icon: "\u{1F3A4}", label: "가사 작성", message: "노래 가사를 작성해줘" },
    { icon: "\u{1F50A}", label: "TTS 변환", message: "텍스트를 음성으로 변환해줘" },
    { icon: "\u{1F3B9}", label: "음악 분석", message: "이 곡을 분석해줘" },
  ],
  interpreter: [
    { icon: "\u{1F1F0}\u{1F1F7}", label: "한영 통역", message: "한국어-영어 실시간 통역 시작해줘" },
    { icon: "\u{1F1EF}\u{1F1F5}", label: "한일 통역", message: "한국어-일본어 실시간 통역 시작해줘" },
    { icon: "\u{1F1E8}\u{1F1F3}", label: "한중 통역", message: "한국어-중국어 실시간 통역 시작해줘" },
    { icon: "\u{1F310}", label: "언어 선택", message: "통역 가능한 언어 목록 보여줘" },
  ],
  other: [
    { icon: "\u{1F44B}", label: "안녕하세요", message: "안녕하세요!" },
    { icon: "\u2753", label: "무엇을 할 수 있나요?", message: "도움말" },
    { icon: "\u{1F4CA}", label: "모델 전략", message: "현재 모델 전략 정보 알려줘" },
    { icon: "\u{1F4E2}", label: "채널 안내", message: "지원하는 채널 알려줘" },
  ],
};

/**
 * OpenClaw-inspired sidebar navigation structure.
 * Organized into logical groups like the OpenClaw Control UI:
 *   Chat → main chat (always visible)
 *   Tools → AI-powered tools and skills
 *   Control → channels, billing, community
 *   Settings → profile, downloads, config
 */
const NAV_GROUPS = [
  {
    label: "AI 도구",
    items: [
      { href: "/synthesis", icon: "\u{1F4D1}", label: "종합문서" },
      { href: "/autocode", icon: "\u{1F916}", label: "AI 자동코딩" },
      { href: "/editor", icon: "\u{1F4DD}", label: "문서 에디터" },
      { href: "/interpreter", icon: "\u{1F5E3}\uFE0F", label: "실시간 통역" },
    ],
  },
  {
    label: "채널",
    items: [
      { href: "/channels", icon: "\u{1F4E1}", label: "채널 허브" },
      { href: "/community", icon: "\u{1F465}", label: "커뮤니티" },
      { href: "/use-cases", icon: "\u{1F4A1}", label: "활용 사례" },
    ],
  },
  {
    label: "설정",
    items: [
      { href: "/mypage", icon: "\u2699\uFE0F", label: "마이페이지" },
      { href: "/billing", icon: "\u{1F4B3}", label: "결제/크레딧" },
      { href: "/download", icon: "\u{1F4E5}", label: "앱 다운로드" },
      { href: "/feedback", icon: "\u{1F4AC}", label: "피드백" },
    ],
  },
];

/** Declare moaDesktop type for Electron desktop app integration */
declare global {
  interface Window {
    moaDesktop?: {
      isDesktopApp: () => Promise<boolean>;
      systemInfo: () => Promise<{ platform: string; hostname: string; drives: string[] }>;
      listDirectory: (path: string) => Promise<{ name: string; isDirectory: boolean; size: number }[]>;
      readFile: (path: string, encoding?: string) => Promise<string>;
      writeFile: (path: string, content: string) => Promise<boolean>;
      openDialog: (options: { type: string }) => Promise<string[]>;
      openExternal: (path: string) => Promise<void>;
      executeCommand: (cmd: string) => Promise<{ stdout: string; stderr: string }>;
    };
  }
}

export default function ChatPage() {
  const router = useRouter();
  const [hasAgent, setHasAgent] = useState<boolean | null>(null); // null = checking
  const [redirectCountdown, setRedirectCountdown] = useState(3);

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
  const [expandedCat, setExpandedCat] = useState<string | null>(null);
  const [isDesktop, setIsDesktop] = useState(false);
  const [showCreditPopup, setShowCreditPopup] = useState(false);
  const [agentStatus, setAgentStatus] = useState<"online" | "offline" | "checking">("checking");
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set());
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const lastMessageCountRef = useRef(0);

  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, []);

  // Check if user has at least 1 registered device/agent
  useEffect(() => {
    if (typeof window === "undefined") return;

    // Desktop app (Electron) always has an agent
    if (window.moaDesktop) {
      setHasAgent(true);
      return;
    }

    const saved = sessionStorage.getItem("moa_web_auth");
    if (saved) {
      try {
        const data = JSON.parse(saved);
        if (data.devices && data.devices.length > 0) {
          setHasAgent(true);
          return;
        }
      } catch { /* ignore */ }
    }
    // No auth or no devices
    setHasAgent(false);
  }, []);

  // Countdown and redirect to download page
  useEffect(() => {
    if (hasAgent !== false) return;
    if (redirectCountdown <= 0) {
      router.push("/download");
      return;
    }
    const timer = setTimeout(() => setRedirectCountdown((c) => c - 1), 1000);
    return () => clearTimeout(timer);
  }, [hasAgent, redirectCountdown, router]);

  useEffect(() => { scrollToBottom(); }, [messages, scrollToBottom]);

  // Detect desktop app (Electron)
  useEffect(() => {
    if (typeof window !== "undefined" && window.moaDesktop) {
      window.moaDesktop.isDesktopApp().then((v) => setIsDesktop(v)).catch(() => {});
    }
  }, []);

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
          lastMessageCountRef.current = data.messages.length;
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

  // Heartbeat polling: Check for proactive agent messages every 5 seconds
  // This is what makes MoA a proactive AI agent — it can send follow-up
  // messages even when the user hasn't sent anything new.
  useEffect(() => {
    const pollInterval = setInterval(async () => {
      try {
        const res = await fetch(
          `/api/chat?user_id=${encodeURIComponent(userId)}&session_id=${encodeURIComponent(sessionId)}&limit=5`,
        );
        if (!res.ok) return;
        const data = await res.json();
        const serverMessages = data.messages ?? [];

        // If server has more messages than we have, there's a new proactive message
        if (serverMessages.length > 0) {
          setMessages((prev) => {
            const existingIds = new Set(prev.map((m) => m.id));
            const newMsgs = serverMessages.filter(
              (m: ChatMessage) => !existingIds.has(m.id),
            );
            if (newMsgs.length > 0) {
              return [...prev, ...newMsgs];
            }
            return prev;
          });
        }
      } catch { /* ignore polling errors */ }
    }, 5000);

    return () => clearInterval(pollInterval);
  }, [userId, sessionId]);

  // Agent status check
  useEffect(() => {
    const checkStatus = async () => {
      try {
        const res = await fetch("/api/gateway/status");
        if (res.ok) {
          const data = await res.json();
          setAgentStatus(data.online || data.openclaw?.available ? "online" : "offline");
        } else {
          setAgentStatus("offline");
        }
      } catch {
        setAgentStatus("offline");
      }
    };
    checkStatus();
    const interval = setInterval(checkStatus, 60000); // Check every minute
    return () => clearInterval(interval);
  }, []);

  const handleCategoryChange = (catId: CategoryId) => {
    setSelectedCategory(catId);
    setExpandedCat(null);
    if (typeof window !== "undefined") {
      localStorage.setItem("moa_category", catId);
    }
  };

  /** Handle local file operations via desktop app */
  const handleDesktopFileOp = async (text: string): Promise<string | null> => {
    if (!isDesktop || !window.moaDesktop) return null;

    const lower = text.toLowerCase();

    // Pattern: list directory / folder contents
    const listMatch = text.match(/([A-Za-z]:[\\/][^\s]*|\/[^\s]+)\s*(폴더|디렉토리|파일|리스트|목록)/i)
      || text.match(/(폴더|디렉토리|파일|리스트|목록).+?([A-Za-z]:[\\/][^\s]*|\/[^\s]+)/i)
      || (lower.includes("리스트") || lower.includes("목록") || lower.includes("파일")) && text.match(/([A-Za-z]:[\\/]?)/i);

    if (listMatch) {
      const dirPath = typeof listMatch[1] === "string" && listMatch[1].includes(":")
        ? listMatch[1] : (typeof listMatch[2] === "string" ? listMatch[2] : null);
      if (dirPath) {
        try {
          const items = await window.moaDesktop.listDirectory(dirPath.replace(/\//g, "\\"));
          const folders = items.filter((i) => i.isDirectory).map((i) => i.name);
          const files = items.filter((i) => !i.isDirectory).map((i) => i.name);
          let result = `**${dirPath}** 디렉토리 내용:\n\n`;
          if (folders.length) result += `**폴더 (${folders.length}개):**\n${folders.map((f) => `- ${f}/`).join("\n")}\n\n`;
          if (files.length) result += `**파일 (${files.length}개):**\n${files.map((f) => `- ${f}`).join("\n")}`;
          if (!folders.length && !files.length) result += "(비어있는 디렉토리)";
          return result;
        } catch (err) {
          return `${dirPath} 디렉토리에 접근할 수 없습니다: ${err}`;
        }
      }
    }

    return null;
  };

  const sendMessage = async (text: string) => {
    if (!text.trim() || sending) return;

    // If credits are already known to be 0, show popup immediately
    // (server will also reject, but this saves a round-trip)
    if (creditBalance !== null && creditBalance <= 0) {
      setShowCreditPopup(true);
    }

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
      // Try local file operations first if running in desktop app
      const localResult = await handleDesktopFileOp(text.trim());
      if (localResult) {
        const aiMsg: ChatMessage = {
          id: `ai_${Date.now()}`,
          role: "assistant",
          content: localResult,
          model_used: "desktop/local",
          created_at: new Date().toISOString(),
        };
        setMessages((prev) => [...prev, aiMsg]);
        return;
      }

      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          user_id: userId,
          session_id: sessionId,
          content: text.trim(),
          category: selectedCategory,
          is_desktop: isDesktop,
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
        if (data.credits_remaining !== undefined) {
          setCreditBalance(data.credits_remaining);
        }
        // Show credit exhaustion popup when credits are depleted
        if (data.model === "system/credit-check" || (data.credits_remaining !== undefined && data.credits_remaining <= 0)) {
          setShowCreditPopup(true);
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

  // Show redirect notice if no agent installed
  if (hasAgent === false) {
    return (
      <div style={{
        display: "flex", alignItems: "center", justifyContent: "center",
        minHeight: "100vh", background: "var(--bg)",
      }}>
        <div style={{
          textAlign: "center", maxWidth: "480px", padding: "48px 32px",
          background: "var(--card)", borderRadius: "16px",
          border: "1px solid var(--border)", boxShadow: "0 8px 32px rgba(0,0,0,0.3)",
        }}>
          <div style={{ fontSize: "4rem", marginBottom: "16px" }}>{"📱"}</div>
          <h2 style={{ fontSize: "1.5rem", fontWeight: 800, marginBottom: "12px" }}>
            먼저 MoA 에이전트를 설치하세요
          </h2>
          <p style={{ color: "var(--text-muted)", fontSize: "0.95rem", marginBottom: "8px", lineHeight: 1.6 }}>
            웹 채팅을 사용하려면 최소 1대의 기기에 MoA가 설치되어 있어야 합니다.
          </p>
          <p style={{ color: "var(--text-muted)", fontSize: "0.85rem", marginBottom: "24px" }}>
            {redirectCountdown}초 후 다운로드 페이지로 이동합니다...
          </p>
          <div style={{ display: "flex", gap: "12px", justifyContent: "center" }}>
            <Link
              href="/download"
              className="btn btn-primary"
              style={{ padding: "14px 32px", fontSize: "1rem", fontWeight: 700 }}
            >
              지금 다운로드
            </Link>
            <Link
              href="/"
              className="btn btn-outline"
              style={{ padding: "14px 24px", fontSize: "0.95rem" }}
            >
              홈으로
            </Link>
          </div>
        </div>
      </div>
    );
  }

  // Still checking — show loading
  if (hasAgent === null) {
    return (
      <div style={{
        display: "flex", alignItems: "center", justifyContent: "center",
        minHeight: "100vh", background: "var(--bg)",
      }}>
        <div style={{ color: "var(--text-muted)", fontSize: "1rem" }}>로딩 중...</div>
      </div>
    );
  }

  return (
    <div className="chat-layout">
      {/* Sidebar — OpenClaw-inspired grouped navigation */}
      <aside className={`chat-sidebar ${sidebarOpen ? "open" : ""}`}>
        <div className="chat-sidebar-header">
          <Link href="/" style={{ textDecoration: "none", color: "inherit", fontWeight: 800, fontSize: "1.3rem" }}>MoA</Link>
          <button className="chat-sidebar-close" onClick={() => setSidebarOpen(false)}>
            {"\u2715"}
          </button>
        </div>

        {/* Chat — always at top, like OpenClaw */}
        <button className="chat-new-btn" onClick={startNewSession}>
          + 새 대화
        </button>

        {/* Agent Status Indicator */}
        <div style={{
          padding: "8px 16px", fontSize: "0.75rem",
          display: "flex", alignItems: "center", gap: "6px",
          color: agentStatus === "online" ? "#48bb78" : agentStatus === "checking" ? "#9a9ab0" : "#fc8181",
        }}>
          <span style={{
            width: "8px", height: "8px", borderRadius: "50%",
            background: agentStatus === "online" ? "#48bb78" : agentStatus === "checking" ? "#9a9ab0" : "#fc8181",
            display: "inline-block",
            animation: agentStatus === "online" ? "pulse 2s infinite" : "none",
          }} />
          {agentStatus === "online" ? "에이전트 연결됨" : agentStatus === "checking" ? "연결 확인 중..." : "직접 LLM 모드"}
        </div>

        {/* Grouped Navigation — OpenClaw-style collapsible groups */}
        {NAV_GROUPS.map((group) => (
          <div key={group.label} className="chat-sidebar-section">
            <h3
              onClick={() => setCollapsedGroups((prev) => {
                const next = new Set(prev);
                if (next.has(group.label)) next.delete(group.label);
                else next.add(group.label);
                return next;
              })}
              style={{ cursor: "pointer", userSelect: "none", display: "flex", alignItems: "center", justifyContent: "space-between" }}
            >
              {group.label}
              <span style={{ fontSize: "0.6rem", opacity: 0.5 }}>
                {collapsedGroups.has(group.label) ? "\u25B6" : "\u25BC"}
              </span>
            </h3>
            {!collapsedGroups.has(group.label) && (
              <div className="chat-channel-links">
                {group.items.map((item) => (
                  <Link key={item.href} href={item.href} className="chat-channel-link" onClick={() => setSidebarOpen(false)}>
                    <span>{item.icon}</span> {item.label}
                  </Link>
                ))}
              </div>
            )}
          </div>
        ))}
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
              <span style={{
                display: "inline-block", width: "6px", height: "6px", borderRadius: "50%",
                background: agentStatus === "online" ? "#48bb78" : "#fc8181",
                marginRight: "4px",
              }} />
              {agentStatus === "online" ? "에이전트 연결" : "LLM 모드"}
              {isDesktop && (
                <span style={{ marginLeft: "8px", fontSize: "0.7rem", background: "rgba(102,126,234,0.2)", padding: "2px 8px", borderRadius: "8px" }}>
                  Desktop
                </span>
              )}
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
          </div>
        </div>

        {/* Category Bar — single location for category selection with descriptions */}
        <div className="chat-category-bar">
          {CATEGORIES.map((cat) => (
            <div key={cat.id} style={{ position: "relative" }}>
              <button
                className={`chat-cat-chip ${selectedCategory === cat.id ? "active" : ""}`}
                onClick={() => handleCategoryChange(cat.id)}
                onMouseEnter={() => setExpandedCat(cat.id)}
                onMouseLeave={() => setExpandedCat(null)}
                style={{ "--cat-color": cat.color } as React.CSSProperties}
              >
                <span>{cat.icon}</span>
                <span>{cat.label}</span>
              </button>
              {/* Tooltip showing category description */}
              {expandedCat === cat.id && (
                <div style={{
                  position: "absolute", top: "100%", left: "50%", transform: "translateX(-50%)",
                  background: "var(--card)", border: "1px solid var(--border)", borderRadius: "8px",
                  padding: "8px 12px", fontSize: "0.75rem", color: "var(--text-muted)",
                  whiteSpace: "nowrap", zIndex: 10, marginTop: "4px",
                  boxShadow: "0 4px 12px rgba(0,0,0,0.3)",
                }}>
                  {cat.desc}
                </div>
              )}
            </div>
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

          {messages.map((msg) => {
            const isHeartbeat = msg.model_used?.startsWith("heartbeat/");
            const isAgent = msg.model_used?.startsWith("openclaw/");
            return (
              <div key={msg.id} className={`chat-msg chat-msg-${msg.role}${isHeartbeat ? " chat-msg-heartbeat" : ""}`}>
                <div className="chat-msg-avatar">
                  {msg.role === "user" ? "\u{1F464}" : isHeartbeat ? "\u{1F49A}" : isAgent ? "\u{1F9E0}" : msg.role === "assistant" ? "\u{1F916}" : "\u26A0\uFE0F"}
                </div>
                <div className="chat-msg-body">
                  <div className="chat-msg-meta">
                    <span className="chat-msg-sender">
                      {msg.role === "user" ? "나" : isHeartbeat ? "MoA (능동)" : isAgent ? "MoA Agent" : msg.role === "assistant" ? "MoA" : "시스템"}
                    </span>
                    <span className="chat-msg-time">
                      {new Date(msg.created_at).toLocaleTimeString("ko-KR", {
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </span>
                    {msg.model_used && (
                      <span className="chat-msg-model" title={msg.model_used}>
                        {isHeartbeat ? "능동형 응답" : isAgent ? "Agent" : msg.model_used.split("/").pop()}
                      </span>
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
            );
          })}

          {sending && (
            <div className="chat-msg chat-msg-assistant">
              <div className="chat-msg-avatar">{"\u{1F916}"}</div>
              <div className="chat-msg-body">
                <div className="chat-typing">
                  <span></span><span></span><span></span>
                </div>
              </div>
            </div>
          )}

          <div ref={messagesEndRef} />
        </div>

        {/* Input Area — clean, no redundant links */}
        <div className="chat-input-area">
          <div className="chat-input-wrapper">
            <textarea
              ref={inputRef}
              className="chat-input"
              placeholder={`${currentCategory.label} 모드 \u2014 MoA에게 메시지를 보내세요... (Enter로 전송)`}
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
              {sending ? "\u23F3" : "\u27A4"}
            </button>
          </div>
        </div>
      </main>

      {/* Credit Exhaustion Popup */}
      {showCreditPopup && (
        <div
          style={{
            position: "fixed", inset: 0, zIndex: 1000,
            background: "rgba(0,0,0,0.6)", backdropFilter: "blur(4px)",
            display: "flex", alignItems: "center", justifyContent: "center",
          }}
          onClick={() => setShowCreditPopup(false)}
        >
          <div
            style={{
              background: "var(--card)", borderRadius: "20px",
              border: "1px solid var(--border)", padding: "36px 32px",
              maxWidth: "420px", width: "90%", textAlign: "center",
              boxShadow: "0 16px 48px rgba(0,0,0,0.4)",
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ fontSize: "3rem", marginBottom: "12px" }}>{"💳"}</div>
            <h2 style={{ fontSize: "1.3rem", fontWeight: 800, marginBottom: "8px" }}>
              크레딧이 부족합니다
            </h2>
            <p style={{ color: "var(--text-muted)", fontSize: "0.9rem", lineHeight: 1.6, marginBottom: "24px" }}>
              AI 응답을 계속 받으려면 크레딧을 충전하거나{"\n"}
              직접 API 키를 등록해주세요.
            </p>
            <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
              <button
                onClick={() => { setShowCreditPopup(false); router.push("/mypage"); }}
                style={{
                  padding: "14px 24px", fontSize: "1rem", fontWeight: 700,
                  borderRadius: "12px", border: "2px solid var(--primary)",
                  background: "transparent", color: "var(--primary)",
                  cursor: "pointer", transition: "all 0.2s",
                }}
              >
                {"🔑"} API 키 직접 입력 (무료)
              </button>
              <button
                onClick={() => { setShowCreditPopup(false); router.push("/billing"); }}
                style={{
                  padding: "14px 24px", fontSize: "1rem", fontWeight: 700,
                  borderRadius: "12px", border: "none",
                  background: "var(--primary)", color: "#fff",
                  cursor: "pointer", transition: "all 0.2s",
                }}
              >
                {"💰"} 크레딧 구매
              </button>
            </div>
            <p style={{ color: "var(--text-muted)", fontSize: "0.75rem", marginTop: "16px" }}>
              API 키를 등록하면 크레딧 차감 없이 무제한 사용 가능합니다.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
