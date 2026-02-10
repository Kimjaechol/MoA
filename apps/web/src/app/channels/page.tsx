"use client";

import Link from "next/link";
import Nav from "../../components/Nav";

const CHANNEL_DATA = [
  {
    id: "kakaotalk",
    name: "KakaoTalk",
    emoji: "\uD83D\uDFE1",
    color: "#FFE812",
    textColor: "#3B1E1E",
    desc: "한국에서 가장 많이 사용하는 메신저. 카카오톡 채널을 추가하면 바로 MoA와 대화를 시작할 수 있습니다.",
    connectLabel: "카카오톡에서 대화 시작",
    connectUrl: "https://pf.kakao.com/moa-ai",
    setupSteps: ["카카오톡 앱 열기", "MoA AI 채널 추가", "대화 시작!"],
    popular: true,
    category: "primary",
  },
  {
    id: "telegram",
    name: "Telegram",
    emoji: "\u2708\uFE0F",
    color: "#0088cc",
    textColor: "#ffffff",
    desc: "전 세계에서 가장 인기 있는 보안 메신저. @MoA_AI_Bot을 검색하여 바로 대화를 시작하세요.",
    connectLabel: "텔레그램에서 대화 시작",
    connectUrl: "https://t.me/MoA_AI_Bot",
    setupSteps: ["텔레그램 앱 열기", "@MoA_AI_Bot 검색", "Start 버튼 클릭"],
    popular: true,
    category: "primary",
  },
  {
    id: "discord",
    name: "Discord",
    emoji: "\uD83C\uDFAE",
    color: "#5865F2",
    textColor: "#ffffff",
    desc: "게이밍과 커뮤니티의 중심. MoA 봇을 서버에 초대하거나 DM으로 바로 대화하세요.",
    connectLabel: "Discord 봇 추가",
    connectUrl: "https://discord.com/oauth2/authorize?client_id=MOA_BOT_ID&permissions=274878023680&scope=bot",
    setupSteps: ["Discord 열기", "MoA 봇 초대 링크 클릭", "서버 선택 후 승인"],
    popular: true,
    category: "primary",
  },
  {
    id: "slack",
    name: "Slack",
    emoji: "\uD83D\uDCAC",
    color: "#4A154B",
    textColor: "#ffffff",
    desc: "업무용 메신저의 표준. Slack 워크스페이스에 MoA 앱을 설치하면 팀 전체가 AI를 사용할 수 있습니다.",
    connectLabel: "Slack에 MoA 추가",
    connectUrl: "https://slack.com/oauth/v2/authorize?client_id=MOA_SLACK_ID&scope=chat:write,commands",
    setupSteps: ["Slack 워크스페이스 열기", "MoA 앱 설치", "채널에서 /moa 명령어 사용"],
    popular: true,
    category: "primary",
  },
  {
    id: "signal",
    name: "Signal",
    emoji: "\uD83D\uDD12",
    color: "#3A76F0",
    textColor: "#ffffff",
    desc: "가장 강력한 E2E 암호화 메신저. MoA는 Signal의 보안을 완벽하게 지원합니다.",
    connectLabel: "Signal에서 대화 시작",
    connectUrl: "https://signal.me/#eu/MoA_AI",
    setupSteps: ["Signal 앱 열기", "MoA AI 연락처 추가", "메시지 보내기"],
    popular: false,
    category: "primary",
  },
  {
    id: "imessage",
    name: "iMessage",
    emoji: "\uD83D\uDCF1",
    color: "#34C759",
    textColor: "#ffffff",
    desc: "Apple 생태계의 기본 메신저. macOS나 iOS에서 iMessage로 MoA와 바로 대화하세요.",
    connectLabel: "iMessage로 대화 시작",
    connectUrl: "imessage://moa@lawith.kr",
    setupSteps: ["메시지 앱 열기", "moa@lawith.kr 입력", "메시지 전송"],
    popular: false,
    category: "primary",
  },
  {
    id: "line",
    name: "LINE",
    emoji: "\uD83D\uDFE2",
    color: "#06C755",
    textColor: "#ffffff",
    desc: "일본, 태국, 대만 등 아시아 최대 메신저. LINE 공식 계정을 추가하면 바로 시작됩니다.",
    connectLabel: "LINE에서 대화 시작",
    connectUrl: "https://line.me/R/ti/p/@moa-ai",
    setupSteps: ["LINE 앱 열기", "@moa-ai 친구 추가", "대화 시작"],
    popular: false,
    category: "primary",
  },
  {
    id: "whatsapp",
    name: "WhatsApp",
    emoji: "\uD83D\uDCDE",
    color: "#25D366",
    textColor: "#ffffff",
    desc: "전 세계 20억 사용자의 메신저. WhatsApp에서 MoA 번호로 메시지를 보내세요.",
    connectLabel: "WhatsApp에서 대화 시작",
    connectUrl: "https://wa.me/MoA_NUMBER?text=안녕하세요",
    setupSteps: ["WhatsApp 열기", "MoA 번호로 메시지", "자동 연결 완료"],
    popular: true,
    category: "primary",
  },
  {
    id: "matrix",
    name: "Matrix",
    emoji: "\uD83D\uDD35",
    color: "#0DBD8B",
    textColor: "#ffffff",
    desc: "분산형 오픈소스 메신저 프로토콜. Element 등 Matrix 클라이언트에서 MoA와 대화하세요.",
    connectLabel: "Matrix에서 대화 시작",
    connectUrl: "https://matrix.to/#/@moa-ai:matrix.org",
    setupSteps: ["Element 또는 Matrix 클라이언트 열기", "@moa-ai:matrix.org 검색", "대화 시작"],
    popular: false,
    category: "extended",
  },
  {
    id: "msteams",
    name: "MS Teams",
    emoji: "\uD83C\uDFE2",
    color: "#6264A7",
    textColor: "#ffffff",
    desc: "Microsoft 365 업무 환경의 중심. Teams에 MoA 앱을 설치하면 업무 중 AI를 바로 활용합니다.",
    connectLabel: "Teams에 MoA 추가",
    connectUrl: "https://teams.microsoft.com/l/app/MOA_TEAMS_ID",
    setupSteps: ["MS Teams 열기", "앱 스토어에서 MoA 검색", "설치 후 채팅에서 사용"],
    popular: false,
    category: "extended",
  },
  {
    id: "googlechat",
    name: "Google Chat",
    emoji: "\uD83D\uDCAC",
    color: "#1a73e8",
    textColor: "#ffffff",
    desc: "Google Workspace 사용자를 위한 채팅. Google Chat에서 MoA 봇으로 바로 대화하세요.",
    connectLabel: "Google Chat에서 대화 시작",
    connectUrl: "https://chat.google.com",
    setupSteps: ["Google Chat 열기", "MoA 봇 추가", "대화 시작"],
    popular: false,
    category: "extended",
  },
  {
    id: "mattermost",
    name: "Mattermost",
    emoji: "\uD83D\uDD37",
    color: "#0058CC",
    textColor: "#ffffff",
    desc: "온프레미스 지원 오픈소스 팀 메신저. 자체 서버에서 MoA 봇을 운용할 수 있습니다.",
    connectLabel: "Mattermost에서 사용",
    connectUrl: "#",
    setupSteps: ["Mattermost 관리자 설정", "MoA 봇 통합 추가", "채널에서 사용"],
    popular: false,
    category: "extended",
  },
  {
    id: "twitch",
    name: "Twitch",
    emoji: "\uD83D\uDFE3",
    color: "#9146FF",
    textColor: "#ffffff",
    desc: "라이브 스트리밍 플랫폼. Twitch 채팅에서 MoA 봇으로 실시간 AI 응답을 받으세요.",
    connectLabel: "Twitch에서 사용",
    connectUrl: "#",
    setupSteps: ["Twitch 스트리머 대시보드", "MoA 봇 연동", "채팅에서 !moa 명령어"],
    popular: false,
    category: "extended",
  },
  {
    id: "nostr",
    name: "Nostr",
    emoji: "\uD83E\uDD18",
    color: "#8B5CF6",
    textColor: "#ffffff",
    desc: "탈중앙화 소셜 프로토콜. Nostr 릴레이를 통해 MoA와 대화하세요.",
    connectLabel: "Nostr에서 대화 시작",
    connectUrl: "#",
    setupSteps: ["Nostr 클라이언트 열기", "MoA npub 추가", "DM 전송"],
    popular: false,
    category: "extended",
  },
  {
    id: "zalo",
    name: "Zalo",
    emoji: "\uD83D\uDFE6",
    color: "#0068FF",
    textColor: "#ffffff",
    desc: "베트남 최대 메신저. Zalo OA에서 MoA를 추가하고 바로 대화를 시작하세요.",
    connectLabel: "Zalo에서 대화 시작",
    connectUrl: "#",
    setupSteps: ["Zalo 앱 열기", "MoA OA 추가", "대화 시작"],
    popular: false,
    category: "extended",
  },
];

const primaryChannels = CHANNEL_DATA.filter((ch) => ch.category === "primary");
const extendedChannels = CHANNEL_DATA.filter((ch) => ch.category === "extended");

export default function ChannelsPage() {
  return (
    <>
      <Nav />
      <main style={{ paddingTop: "100px", minHeight: "100vh" }}>
        <div className="container">
          {/* Header */}
          <div className="section-header">
            <span className="section-badge">15개 채널</span>
            <h1 style={{ fontSize: "clamp(1.8rem, 4vw, 2.5rem)", fontWeight: 800, marginBottom: "12px" }}>
              어디서든 클릭 한 번으로{" "}
              <span style={{ background: "var(--gradient)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent" }}>
                AI와 대화
              </span>
            </h1>
            <p style={{ maxWidth: "700px", margin: "0 auto 16px" }}>
              익숙한 메신저를 선택하고 바로 MoA와 대화를 시작하세요.
              모든 채널에서 동일한 AI, 동일한 기억, 동일한 스킬을 사용할 수 있습니다.
            </p>
            <div style={{ display: "flex", gap: "12px", justifyContent: "center", flexWrap: "wrap" }}>
              <Link href="/chat" className="btn btn-primary">
                웹에서 바로 채팅 시작
              </Link>
              <Link href="#all-channels" className="btn btn-outline">
                모든 채널 보기
              </Link>
            </div>
          </div>

          {/* Web Chat Promotion */}
          <section style={{ marginBottom: "64px" }}>
            <div
              className="card channel-web-chat-card"
              style={{
                maxWidth: "800px",
                margin: "0 auto",
                background: "linear-gradient(135deg, rgba(102,126,234,0.15), rgba(118,75,162,0.15))",
                border: "2px solid rgba(102,126,234,0.3)",
                textAlign: "center",
                padding: "48px 32px",
              }}
            >
              <div style={{ fontSize: "4rem", marginBottom: "16px" }}>{"\uD83D\uDCBB"}</div>
              <h2 style={{ fontSize: "1.5rem", marginBottom: "8px" }}>
                웹 채팅 - 설치 없이 바로 시작
              </h2>
              <p style={{ color: "var(--text-muted)", fontSize: "1rem", marginBottom: "24px", maxWidth: "500px", margin: "0 auto 24px" }}>
                별도 앱 설치 없이 웹 브라우저에서 바로 MoA와 대화할 수 있습니다.
                대화 내역은 자동 저장되며, 다른 채널로 이어갈 수 있습니다.
              </p>
              <Link href="/chat" className="btn btn-primary btn-lg">
                지금 바로 채팅 시작하기
              </Link>
            </div>
          </section>

          {/* Primary Channels */}
          <section id="all-channels" style={{ marginBottom: "48px" }}>
            <h2 style={{ fontSize: "1.5rem", fontWeight: 700, marginBottom: "8px" }}>
              주요 채널
            </h2>
            <p style={{ color: "var(--text-muted)", marginBottom: "24px" }}>
              가장 많이 사용되는 메신저에서 MoA와 대화하세요
            </p>
            <div className="grid-2">
              {primaryChannels.map((ch) => (
                <div key={ch.id} className="card channel-card" style={{ position: "relative", overflow: "hidden" }}>
                  <div
                    style={{
                      position: "absolute",
                      top: 0,
                      left: 0,
                      right: 0,
                      height: "4px",
                      background: ch.color,
                    }}
                  />
                  {ch.popular && (
                    <span className="channel-popular-badge">인기</span>
                  )}
                  <div style={{ display: "flex", alignItems: "center", gap: "14px", marginBottom: "12px", marginTop: "8px" }}>
                    <span style={{ fontSize: "2.5rem" }}>{ch.emoji}</span>
                    <div>
                      <h3 style={{ fontSize: "1.2rem" }}>{ch.name}</h3>
                    </div>
                  </div>
                  <p style={{ color: "var(--text-muted)", fontSize: "0.9rem", marginBottom: "16px", lineHeight: 1.6 }}>
                    {ch.desc}
                  </p>

                  {/* Setup steps */}
                  <div style={{ marginBottom: "16px" }}>
                    <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
                      {ch.setupSteps.map((step, i) => (
                        <span
                          key={step}
                          style={{
                            fontSize: "0.75rem",
                            padding: "4px 10px",
                            borderRadius: "12px",
                            background: `${ch.color}15`,
                            color: ch.color,
                            border: `1px solid ${ch.color}30`,
                          }}
                        >
                          {i + 1}. {step}
                        </span>
                      ))}
                    </div>
                  </div>

                  <div style={{ display: "flex", gap: "8px" }}>
                    <a
                      href={ch.connectUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="btn btn-sm"
                      style={{
                        background: ch.color,
                        color: ch.textColor,
                        flex: 1,
                        textAlign: "center",
                      }}
                    >
                      {ch.connectLabel}
                    </a>
                    <Link
                      href={`/channels/${ch.id}`}
                      className="btn btn-sm btn-outline"
                    >
                      상세
                    </Link>
                  </div>
                </div>
              ))}
            </div>
          </section>

          {/* Extended Channels */}
          <section style={{ marginBottom: "48px" }}>
            <h2 style={{ fontSize: "1.5rem", fontWeight: 700, marginBottom: "8px" }}>
              추가 채널
            </h2>
            <p style={{ color: "var(--text-muted)", marginBottom: "24px" }}>
              업무, 커뮤니티, 특수 환경을 위한 추가 채널
            </p>
            <div className="grid-3">
              {extendedChannels.map((ch) => (
                <div key={ch.id} className="card channel-card" style={{ position: "relative", overflow: "hidden" }}>
                  <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: "3px", background: ch.color }} />
                  <div style={{ display: "flex", alignItems: "center", gap: "12px", marginBottom: "10px", marginTop: "4px" }}>
                    <span style={{ fontSize: "2rem" }}>{ch.emoji}</span>
                    <h3 style={{ fontSize: "1.05rem" }}>{ch.name}</h3>
                  </div>
                  <p style={{ color: "var(--text-muted)", fontSize: "0.85rem", marginBottom: "16px", lineHeight: 1.5 }}>
                    {ch.desc}
                  </p>
                  <div style={{ display: "flex", gap: "8px" }}>
                    <a
                      href={ch.connectUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="btn btn-sm"
                      style={{ background: ch.color, color: ch.textColor, flex: 1, textAlign: "center" }}
                    >
                      {ch.connectLabel}
                    </a>
                    <Link href={`/channels/${ch.id}`} className="btn btn-sm btn-outline">
                      상세
                    </Link>
                  </div>
                </div>
              ))}
            </div>
          </section>

          {/* Cross-channel feature */}
          <section style={{ marginBottom: "64px" }}>
            <div
              className="card"
              style={{
                maxWidth: "800px",
                margin: "0 auto",
                textAlign: "center",
                padding: "40px 32px",
              }}
            >
              <h3 style={{ fontSize: "1.3rem", marginBottom: "16px" }}>
                모든 채널에서 하나의 AI
              </h3>
              <div className="grid-3" style={{ gap: "24px", marginBottom: "24px" }}>
                <div>
                  <div style={{ fontSize: "2rem", marginBottom: "8px" }}>{"\uD83E\uDDE0"}</div>
                  <h4 style={{ fontSize: "0.95rem", marginBottom: "4px" }}>기억 공유</h4>
                  <p style={{ color: "var(--text-muted)", fontSize: "0.85rem" }}>
                    카카오톡에서 시작한 대화를 텔레그램에서 이어가세요
                  </p>
                </div>
                <div>
                  <div style={{ fontSize: "2rem", marginBottom: "8px" }}>{"\uD83D\uDD12"}</div>
                  <h4 style={{ fontSize: "0.95rem", marginBottom: "4px" }}>E2E 암호화</h4>
                  <p style={{ color: "var(--text-muted)", fontSize: "0.85rem" }}>
                    모든 채널에서 종단 간 암호화로 보안 유지
                  </p>
                </div>
                <div>
                  <div style={{ fontSize: "2rem", marginBottom: "8px" }}>{"\uD83C\uDFAF"}</div>
                  <h4 style={{ fontSize: "0.95rem", marginBottom: "4px" }}>100+ 스킬</h4>
                  <p style={{ color: "var(--text-muted)", fontSize: "0.85rem" }}>
                    어떤 채널에서든 동일한 100개 이상의 전문 스킬 사용
                  </p>
                </div>
              </div>
              <Link href="/chat" className="btn btn-primary">
                지금 바로 대화 시작하기
              </Link>
            </div>
          </section>
        </div>
      </main>
    </>
  );
}
