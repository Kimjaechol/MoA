"use client";

import { useParams } from "next/navigation";
import Link from "next/link";
import Nav from "../../../components/Nav";

/* ============================================
   Channel detail data
   ============================================ */

interface ChannelDetail {
  name: string;
  emoji: string;
  color: string;
  textColor: string;
  tagline: string;
  description: string;
  connectUrl: string;
  connectLabel: string;
  features: string[];
  setupGuide: Array<{ step: number; title: string; detail: string }>;
  tips: string[];
  supportedActions: string[];
}

const CHANNEL_DETAILS: Record<string, ChannelDetail> = {
  kakaotalk: {
    name: "KakaoTalk",
    emoji: "🟡",
    color: "#FFE812",
    textColor: "#3B1E1E",
    tagline: "한국 최대 메신저에서 AI를 만나세요",
    description: "5,000만 한국인이 매일 사용하는 카카오톡에서 MoA AI와 대화하세요. 채널을 추가하는 것만으로 바로 시작할 수 있습니다. 별도 앱 설치 없이 익숙한 환경에서 AI를 활용하세요.",
    connectUrl: "https://pf.kakao.com/moa-ai",
    connectLabel: "카카오톡 채널 추가하기",
    features: ["메시지로 AI 대화", "파일 전송/수신", "음성 메시지 지원", "원격 PC 제어", "그룹채팅 AI 호출", "스킬 명령어 사용"],
    setupGuide: [
      { step: 1, title: "카카오톡 앱 열기", detail: "휴대폰에서 카카오톡 앱을 열어주세요." },
      { step: 2, title: "MoA AI 채널 검색", detail: "채널 탭에서 'MoA AI'를 검색하거나 아래 버튼을 클릭하세요." },
      { step: 3, title: "채널 추가", detail: "MoA AI 채널을 추가하면 자동으로 친구 목록에 등록됩니다." },
      { step: 4, title: "대화 시작!", detail: "카카오톡처럼 메시지를 보내면 AI가 바로 응답합니다. '안녕'으로 시작해보세요!" },
    ],
    tips: ["그룹채팅에서는 @MoA로 호출하세요", "음성 메시지를 보내면 음성 AI가 응답합니다", "파일을 보내면 자동으로 분석/요약합니다"],
    supportedActions: ["텍스트 대화", "음성 메시지", "파일 전송", "이미지 분석", "원격 명령"],
  },
  telegram: {
    name: "Telegram",
    emoji: "✈️",
    color: "#0088cc",
    textColor: "#ffffff",
    tagline: "전 세계에서 가장 빠른 AI 대화",
    description: "Telegram의 빠른 속도와 보안을 그대로 활용하여 MoA AI와 대화하세요. 봇 API를 통해 최적화된 응답을 제공합니다.",
    connectUrl: "https://t.me/MoA_AI_Bot",
    connectLabel: "텔레그램에서 대화 시작",
    features: ["초고속 응답", "인라인 버튼 명령", "Markdown 포맷 지원", "파일/미디어 전송", "그룹 채팅 AI", "봇 명령어 (/moa, /help)"],
    setupGuide: [
      { step: 1, title: "Telegram 앱 열기", detail: "모바일 또는 데스크톱에서 Telegram을 열어주세요." },
      { step: 2, title: "@MoA_AI_Bot 검색", detail: "검색창에서 @MoA_AI_Bot을 검색하세요." },
      { step: 3, title: "Start 버튼 클릭", detail: "봇 프로필에서 Start 버튼을 누르면 바로 연결됩니다." },
      { step: 4, title: "메시지 보내기", detail: "일반 메시지를 보내면 AI가 즉시 응답합니다." },
    ],
    tips: ["/help 명령어로 사용 가능한 기능 확인", "그룹에 봇을 초대하면 팀 전체가 사용 가능", "Secret Chat에서도 사용 가능"],
    supportedActions: ["텍스트 대화", "음성 메시지", "파일 전송", "이미지 분석", "인라인 버튼", "봇 명령어", "그룹 채팅"],
  },
  discord: {
    name: "Discord",
    emoji: "🎮",
    color: "#5865F2",
    textColor: "#ffffff",
    tagline: "커뮤니티에 AI를 초대하세요",
    description: "Discord 서버에 MoA 봇을 초대하면 모든 멤버가 AI를 사용할 수 있습니다. DM으로 개인 대화도 가능합니다.",
    connectUrl: "https://discord.com/oauth2/authorize?client_id=MOA_BOT_ID&permissions=274878023680&scope=bot",
    connectLabel: "Discord 봇 초대하기",
    features: ["서버 봇 + DM", "스레드 지원", "임베드 응답", "Slash 명령어", "반응 피드백", "파일 첨부 분석"],
    setupGuide: [
      { step: 1, title: "Discord 열기", detail: "데스크톱 또는 모바일에서 Discord를 열어주세요." },
      { step: 2, title: "봇 초대 링크 클릭", detail: "아래 버튼을 클릭하여 MoA 봇을 서버에 초대하세요." },
      { step: 3, title: "서버 선택 & 권한 승인", detail: "MoA 봇을 초대할 서버를 선택하고 권한을 승인하세요." },
      { step: 4, title: "채널에서 @MoA 호출", detail: "@MoA 멘션으로 AI를 호출하거나 /moa 명령어를 사용하세요." },
    ],
    tips: ["/moa help로 모든 명령어 확인", "DM으로 보내면 비공개 대화 가능", "스레드에서 호출하면 주제별 대화 가능"],
    supportedActions: ["텍스트 대화", "파일 첨부", "스레드", "Slash 명령어", "반응", "임베드"],
  },
  whatsapp: {
    name: "WhatsApp",
    emoji: "📞",
    color: "#25D366",
    textColor: "#ffffff",
    tagline: "20억 사용자의 메신저에서 AI를",
    description: "전 세계에서 가장 많이 사용되는 메신저 WhatsApp에서 MoA와 대화하세요.",
    connectUrl: "https://wa.me/MoA_NUMBER?text=안녕하세요",
    connectLabel: "WhatsApp에서 대화 시작",
    features: ["텍스트/음성 대화", "미디어 전송", "그룹 채팅 AI", "Web 자동화", "읽음 확인", "비동기 음성"],
    setupGuide: [
      { step: 1, title: "WhatsApp 열기", detail: "WhatsApp 앱을 열어주세요." },
      { step: 2, title: "MoA 번호로 메시지", detail: "아래 버튼을 클릭하여 MoA 번호로 메시지를 보내세요." },
      { step: 3, title: "자동 연결 완료", detail: "첫 메시지를 보내면 자동으로 MoA와 연결됩니다." },
    ],
    tips: ["음성 메시지를 보내면 음성 AI가 응답", "이미지를 보내면 자동 분석", "그룹에서는 @MoA로 호출"],
    supportedActions: ["텍스트 대화", "음성 메시지", "미디어 전송", "그룹 채팅"],
  },
  slack: {
    name: "Slack",
    emoji: "💬",
    color: "#4A154B",
    textColor: "#ffffff",
    tagline: "업무 환경에 AI를 통합하세요",
    description: "Slack 워크스페이스에 MoA를 설치하면 팀 전체가 AI를 활용할 수 있습니다.",
    connectUrl: "https://slack.com/oauth/v2/authorize?client_id=MOA_SLACK_ID&scope=chat:write,commands",
    connectLabel: "Slack에 MoA 추가",
    features: ["Slash 명령어", "스레드 지원", "채널 통합", "DM AI 대화", "파일 분석", "Socket Mode"],
    setupGuide: [
      { step: 1, title: "Slack 워크스페이스 열기", detail: "Slack 앱 또는 웹을 열어주세요." },
      { step: 2, title: "MoA 앱 설치", detail: "아래 버튼으로 MoA 앱을 워크스페이스에 설치하세요." },
      { step: 3, title: "/moa 명령어 사용", detail: "채널에서 /moa 명령어를 입력하면 바로 사용 가능합니다." },
    ],
    tips: ["/moa help로 모든 명령어 확인", "DM으로 보내면 비공개 AI 대화", "스레드에서 AI를 호출하면 맥락 유지"],
    supportedActions: ["텍스트 대화", "Slash 명령어", "스레드", "파일 분석", "DM"],
  },
  signal: {
    name: "Signal",
    emoji: "🔒",
    color: "#3A76F0",
    textColor: "#ffffff",
    tagline: "최고 보안 메신저에서 AI를",
    description: "Signal의 업계 최고 E2E 암호화와 함께 MoA AI를 사용하세요.",
    connectUrl: "https://signal.me/#eu/MoA_AI",
    connectLabel: "Signal에서 대화 시작",
    features: ["E2E 암호화", "텍스트/음성 대화", "미디어 전송", "그룹 채팅", "반응 지원", "보안 메시지"],
    setupGuide: [
      { step: 1, title: "Signal 앱 열기", detail: "Signal 앱을 열어주세요." },
      { step: 2, title: "MoA AI 연락처 추가", detail: "아래 버튼으로 MoA 연락처를 추가하세요." },
      { step: 3, title: "메시지 전송", detail: "Signal 메시지를 보내면 AI가 응답합니다." },
    ],
    tips: ["모든 대화는 Signal의 E2E 암호화로 보호", "음성 메시지로도 AI 호출 가능"],
    supportedActions: ["텍스트 대화", "음성 메시지", "미디어 전송", "반응"],
  },
  imessage: {
    name: "iMessage",
    emoji: "📱",
    color: "#34C759",
    textColor: "#ffffff",
    tagline: "Apple 생태계의 AI 파트너",
    description: "macOS와 iOS의 기본 메시지 앱에서 MoA AI와 대화하세요. 별도 앱 설치 없이 iMessage로 바로 사용할 수 있습니다.",
    connectUrl: "imessage://moa@lawith.kr",
    connectLabel: "iMessage로 대화 시작",
    features: ["Apple 기기 네이티브", "iCloud 동기", "텍스트/미디어", "그룹 채팅 지원", "Siri 연동 가능", "멘션 지원"],
    setupGuide: [
      { step: 1, title: "메시지 앱 열기", detail: "Mac 또는 iPhone의 메시지 앱을 열어주세요." },
      { step: 2, title: "수신자에 moa@lawith.kr 입력", detail: "새 메시지를 작성하고 수신자에 입력하세요." },
      { step: 3, title: "메시지 전송", detail: "메시지를 보내면 MoA AI가 응답합니다." },
    ],
    tips: ["Mac과 iPhone 모두 iCloud로 동기", "그룹채팅에서는 @MoA로 호출", "이미지를 보내면 자동 분석"],
    supportedActions: ["텍스트 대화", "미디어 전송", "그룹 채팅", "멘션"],
  },
  line: {
    name: "LINE",
    emoji: "🟢",
    color: "#06C755",
    textColor: "#ffffff",
    tagline: "아시아 최대 메신저에서 AI를",
    description: "일본, 태국, 대만 등 아시아 최대 메신저 LINE에서 MoA AI와 대화하세요.",
    connectUrl: "https://line.me/R/ti/p/@moa-ai",
    connectLabel: "LINE에서 대화 시작",
    features: ["공식 계정 통합", "텍스트/미디어 대화", "그룹 채팅 AI", "리치 메뉴 지원", "스탬프 연동", "다국어 지원"],
    setupGuide: [
      { step: 1, title: "LINE 앱 열기", detail: "LINE 앱을 열어주세요." },
      { step: 2, title: "@moa-ai 친구 추가", detail: "ID 검색에서 @moa-ai를 찾아 친구 추가하세요." },
      { step: 3, title: "대화 시작", detail: "메시지를 보내면 AI가 응답합니다." },
    ],
    tips: ["리치 메뉴로 빠른 기능 접근", "일본어/한국어/영어 모두 지원"],
    supportedActions: ["텍스트 대화", "미디어 전송", "그룹 채팅", "리치 메뉴"],
  },
};

/* ============================================
   Default data for channels without detailed info
   ============================================ */

function getDefaultDetail(channelId: string): ChannelDetail {
  return {
    name: channelId.charAt(0).toUpperCase() + channelId.slice(1),
    emoji: "💬",
    color: "#667eea",
    textColor: "#ffffff",
    tagline: `${channelId}에서 MoA AI와 대화하세요`,
    description: `${channelId} 채널을 통해 MoA AI와 쉽게 대화할 수 있습니다.`,
    connectUrl: "#",
    connectLabel: `${channelId}에서 대화 시작`,
    features: ["텍스트 대화", "미디어 전송", "100+ 스킬 사용"],
    setupGuide: [
      { step: 1, title: `${channelId} 앱 열기`, detail: "앱을 열어주세요." },
      { step: 2, title: "MoA 검색 및 추가", detail: "MoA AI를 검색하여 추가하세요." },
      { step: 3, title: "대화 시작", detail: "메시지를 보내면 AI가 응답합니다." },
    ],
    tips: ["모든 채널에서 동일한 AI 경험", "기억이 채널 간 공유됩니다"],
    supportedActions: ["텍스트 대화", "미디어 전송"],
  };
}

export default function ChannelDetailPage() {
  const params = useParams();
  const channelId = params.channel as string;
  const ch = CHANNEL_DETAILS[channelId] ?? getDefaultDetail(channelId);

  return (
    <>
      <Nav />
      <main style={{ paddingTop: "100px", minHeight: "100vh" }}>
        <div className="container" style={{ maxWidth: "900px" }}>
          {/* Breadcrumb */}
          <div style={{ marginBottom: "32px" }}>
            <Link href="/channels" style={{ color: "var(--text-muted)", fontSize: "0.9rem" }}>
              &larr; 모든 채널
            </Link>
          </div>

          {/* Channel Header */}
          <div style={{ textAlign: "center", marginBottom: "48px" }}>
            <div style={{ fontSize: "4rem", marginBottom: "16px" }}>{ch.emoji}</div>
            <h1 style={{ fontSize: "2.2rem", fontWeight: 800, marginBottom: "8px" }}>
              {ch.name}
            </h1>
            <p style={{ color: "var(--text-muted)", fontSize: "1.1rem", marginBottom: "24px" }}>
              {ch.tagline}
            </p>
            <a
              href={ch.connectUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="btn btn-lg"
              style={{ background: ch.color, color: ch.textColor, minWidth: "280px" }}
            >
              {ch.connectLabel}
            </a>
          </div>

          {/* Description */}
          <div className="card" style={{ marginBottom: "32px", padding: "24px 32px" }}>
            <p style={{ fontSize: "1rem", lineHeight: 1.8, color: "var(--text)" }}>
              {ch.description}
            </p>
          </div>

          {/* Features */}
          <section style={{ marginBottom: "32px" }}>
            <h2 style={{ fontSize: "1.3rem", fontWeight: 700, marginBottom: "16px" }}>
              {"✨"} 지원 기능
            </h2>
            <div style={{ display: "flex", flexWrap: "wrap", gap: "10px" }}>
              {ch.features.map((feat) => (
                <span
                  key={feat}
                  style={{
                    padding: "8px 16px",
                    borderRadius: "20px",
                    background: `${ch.color}15`,
                    color: ch.color,
                    border: `1px solid ${ch.color}30`,
                    fontSize: "0.9rem",
                    fontWeight: 500,
                  }}
                >
                  {feat}
                </span>
              ))}
            </div>
          </section>

          {/* Setup Guide */}
          <section style={{ marginBottom: "32px" }}>
            <h2 style={{ fontSize: "1.3rem", fontWeight: 700, marginBottom: "16px" }}>
              {"📋"} 설정 가이드
            </h2>
            <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
              {ch.setupGuide.map((step) => (
                <div
                  key={step.step}
                  className="card"
                  style={{
                    display: "flex",
                    alignItems: "flex-start",
                    gap: "16px",
                    padding: "20px 24px",
                    borderLeft: `4px solid ${ch.color}`,
                  }}
                >
                  <span
                    style={{
                      width: "32px",
                      height: "32px",
                      borderRadius: "50%",
                      background: ch.color,
                      color: ch.textColor,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      fontSize: "0.85rem",
                      fontWeight: 700,
                      flexShrink: 0,
                    }}
                  >
                    {step.step}
                  </span>
                  <div>
                    <h3 style={{ fontSize: "1rem", marginBottom: "4px" }}>{step.title}</h3>
                    <p style={{ color: "var(--text-muted)", fontSize: "0.9rem" }}>{step.detail}</p>
                  </div>
                </div>
              ))}
            </div>
          </section>

          {/* Tips */}
          <section style={{ marginBottom: "32px" }}>
            <h2 style={{ fontSize: "1.3rem", fontWeight: 700, marginBottom: "16px" }}>
              {"💡"} 팁
            </h2>
            <div className="card" style={{ padding: "20px 24px" }}>
              <ul style={{ listStyle: "none", display: "flex", flexDirection: "column", gap: "8px" }}>
                {ch.tips.map((tip) => (
                  <li key={tip} style={{ color: "var(--text-muted)", fontSize: "0.9rem" }}>
                    {"✓"} {tip}
                  </li>
                ))}
              </ul>
            </div>
          </section>

          {/* Actions supported */}
          <section style={{ marginBottom: "48px" }}>
            <h2 style={{ fontSize: "1.3rem", fontWeight: 700, marginBottom: "16px" }}>
              {"⚡"} 지원 작업
            </h2>
            <div style={{ display: "flex", flexWrap: "wrap", gap: "8px" }}>
              {ch.supportedActions.map((action) => (
                <span
                  key={action}
                  className="tag"
                  style={{ fontSize: "0.85rem", padding: "6px 14px" }}
                >
                  {action}
                </span>
              ))}
            </div>
          </section>

          {/* CTA */}
          <div style={{ textAlign: "center", marginBottom: "64px" }}>
            <a
              href={ch.connectUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="btn btn-lg"
              style={{ background: ch.color, color: ch.textColor, minWidth: "280px", marginBottom: "16px" }}
            >
              {ch.connectLabel}
            </a>
            <div style={{ display: "flex", gap: "12px", justifyContent: "center", marginTop: "16px" }}>
              <Link href="/chat" className="btn btn-outline btn-sm">
                웹에서 바로 채팅
              </Link>
              <Link href="/channels" className="btn btn-outline btn-sm">
                다른 채널 보기
              </Link>
            </div>
          </div>
        </div>
      </main>
    </>
  );
}
