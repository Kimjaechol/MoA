import Nav from "../components/Nav";
import DownloadSection from "../components/DownloadSection";
import WebChatPanel from "../components/WebChatPanel";

/* ============================================
   Data — Homepage content
   ============================================ */

const STATS = [
  { value: "100+", label: "AI 스킬" },
  { value: "15", label: "메신저 채널" },
  { value: "7", label: "LLM 프로바이더" },
  { value: "E2E", label: "암호화 보안" },
];

const WHY_MOA = [
  {
    icon: "\uD83D\uDCAC",
    title: "카카오톡으로 AI를 부르세요",
    desc: "복잡한 터미널이나 CLI가 필요 없습니다. 매일 사용하는 카카오톡에서 메시지를 보내듯 AI에게 지시하세요. 누구나 쉽게, 바로 사용할 수 있습니다.",
    highlight: "터미널 대신 카카오톡",
  },
  {
    icon: "\uD83D\uDD11",
    title: "내 API 키로 모든 AI 사용",
    desc: "마이페이지에서 Groq, Gemini, OpenAI, Claude 등의 API 키를 직접 관리하세요. 무료 키(Groq, Gemini)부터 유료 키까지, 입력한 키를 MoA가 전략에 따라 자동 운용합니다.",
    highlight: "내 키 = 내 AI",
  },
  {
    icon: "\uD83D\uDCB0",
    title: "AI 최저비용 자동 전략",
    desc: "내장 무료 SLM을 우선 사용하고, 유료 LLM의 무료 한도(Groq, Gemini 등)를 활용한 뒤, Kimi K2-0905 Groq 등 가성비 모델을 사용합니다. 이미 구독 중인 LLM이 있다면 우선 적용됩니다.",
    highlight: "Kimi K2 Groq 가성비",
  },
  {
    icon: "\uD83C\uDD93",
    title: "내장 SLM으로 완전 무료 사용",
    desc: "SLM(소형 언어 모델)이 내장되어 있어 LLM에 가입하지 않아도 온전히 무료로 사용할 수 있습니다. 물론 유료 AI를 사용하면 더 뛰어난 결과를 얻을 수 있습니다.",
    highlight: "내장 SLM = 영구 무료",
  },
  {
    icon: "\uD83C\uDF0D",
    title: "전 세계 언어 지원",
    desc: "한국어와 영어는 물론, SLM과 LLM이 지원하는 거의 모든 언어로 사용할 수 있습니다. 추후 더 많은 언어가 추가될 예정입니다.",
    highlight: "다국어 AI 에이전트",
  },
  {
    icon: "\uD83D\uDD12",
    title: "내 기기에 안심하고 설치",
    desc: "SHA-256 무결성 검증과 E2E 암호화로 보호됩니다. 자기학습 엔진은 네트워크 호출 없이 로컬에서만 동작하며, 동적 코드 실행이 없어 안전합니다.",
    highlight: "SHA-256 + E2E 암호화",
  },
  {
    icon: "\uD83C\uDFAF",
    title: "100+ 전문 스킬로 정확한 결과",
    desc: "범용 AI가 아닌 작업별 전문 스킬이 최적의 결과를 제공합니다. 웹 검색, 이미지 생성, 문서 작성, 데이터 분석까지 전문 도구가 자동으로 선택됩니다.",
    highlight: "범용이 아닌 전문 스킬",
  },
  {
    icon: "\uD83E\uDDE0",
    title: "쓸수록 똑똑해지는 자기 학습",
    desc: "사용자의 피드백을 기억하고 학습합니다. 교정 패턴, 선호 스타일, 자주 쓰는 명령을 자동으로 파악하여 점점 더 정확한 응답을 제공합니다.",
    highlight: "피드백 학습 엔진",
  },
];

const FEATURES = [
  {
    icon: "\uD83E\uDDE0",
    title: "여러 AI가 기억을 공유",
    desc: "GPT-4o, Claude, Gemini 등 어떤 AI를 사용하든 대화 맥락과 기억을 공유합니다. 노트북에서 시작한 대화를 휴대폰에서 이어가세요.",
  },
  {
    icon: "\uD83D\uDCAC",
    title: "카카오톡 원격제어",
    desc: "카카오톡으로 집/사무실 PC에 명령을 내리세요. 파일 전송, 앱 실행, 스크린샷 모두 가능합니다.",
  },
  {
    icon: "\uD83E\uDD16",
    title: "멀티 AI 대화",
    desc: "GPT-4o, Claude, Gemini 등 7개 LLM 프로바이더를 자유롭게 전환. 작업에 가장 적합한 AI가 자동 선택됩니다.",
  },
  {
    icon: "\uD83D\uDCC1",
    title: "파일 관리",
    desc: "기기 간 파일을 자유롭게 전송하고 관리하세요. 카카오톡으로 파일을 보내면 PC에 저장됩니다.",
  },
  {
    icon: "\uD83C\uDF99\uFE0F",
    title: "음성 AI",
    desc: "음성으로 AI와 대화하세요. 비동기 음성, 실시간 음성, 다국어 통역을 지원합니다.",
  },
  {
    icon: "\uD83D\uDD12",
    title: "E2E 암호화 보안",
    desc: "모든 통신은 종단 간 암호화로 보호됩니다. SHA-256 무결성 검증으로 코드 변조를 실시간 탐지합니다.",
  },
  {
    icon: "\uD83E\uDDE9",
    title: "AI 모델 전략 선택",
    desc: "가성비(Kimi K2 Groq 우선) 또는 최대성능 전략 중 선택. 마이페이지에서 API 키를 직접 관리하고 전략을 변경할 수 있습니다.",
  },
  {
    icon: "\uD83E\uDDEC",
    title: "자기 학습 엔진",
    desc: "피드백 수집, 컨텍스트 최적화, 무결성 검증. AI가 사용자에 맞게 진화하면서도 안전성을 유지합니다.",
  },
];

const SKILL_CATEGORIES = [
  {
    icon: "\uD83D\uDD0D",
    name: "검색 & 정보",
    color: "#667eea",
    skills: [
      "Brave Search",
      "Perplexity AI",
      "Google Search",
      "Serper API",
      "뉴스 수집기",
      "날씨",
      "미세먼지",
      "공휴일",
    ],
  },
  {
    icon: "\uD83D\uDCCB",
    name: "생산성 & 업무",
    color: "#48bb78",
    skills: [
      "Notion",
      "Airtable",
      "Slack API",
      "GitHub",
      "Google 캘린더",
      "카카오 캘린더",
      "Parallel AI",
      "요약",
    ],
  },
  {
    icon: "\uD83C\uDFA8",
    name: "미디어 생성",
    color: "#f093fb",
    skills: [
      "FAL AI 이미지",
      "Gamma 프레젠테이션",
      "AudioPod 팟캐스트",
      "Kokoro TTS",
      "Imagen 3 포트레이트",
      "Sora 2 영상",
      "FFmpeg 편집",
      "텍스트-이미지",
    ],
  },
  {
    icon: "\uD83E\uDD16",
    name: "AI & 머신러닝",
    color: "#ecc94b",
    skills: [
      "Gemini",
      "HuggingFace 학습",
      "Replicate API",
      "ChromaDB 메모리",
      "HF TrackIO",
      "Nano Banana Pro",
      "임베딩",
      "장문 분석",
    ],
  },
  {
    icon: "\uD83D\uDEE1\uFE0F",
    name: "보안 & 시스템",
    color: "#fc8181",
    skills: [
      "보안 점검",
      "홈 어시스턴트",
      "시스템 모니터링",
      "스포츠 일정",
      "내비게이션",
      "GOG 게임",
      "ClawHub",
      "McPorter",
    ],
  },
  {
    icon: "\uD83E\uDDEC",
    name: "자기 학습",
    color: "#9f7aea",
    skills: [
      "피드백 학습",
      "컨텍스트 최적화",
      "무결성 검증",
      "3단계 폴백",
      "교정 패턴 인식",
      "에러 복구 학습",
      "토큰 최적화",
      "핵심 구문 추출",
    ],
  },
];

const MODEL_STRATEGIES = [
  {
    id: "cost-efficient",
    icon: "\uD83D\uDCB0",
    title: "최저비용 (가성비 전략)",
    color: "#48bb78",
    desc: "비용을 최소화하면서 최적의 결과를 제공합니다. 회원가입 시 기본 설정되며, 앱에서 언제든지 변경 가능합니다.",
    tiers: [
      { step: "1", label: "무료 내장 SLM", detail: "기본 대화/요약을 무료로 처리", tag: "무료" },
      { step: "2", label: "유료 LLM 무료 한도", detail: "Groq, Gemini 등의 무료 범위 활용", tag: "무료" },
      { step: "3", label: "유료 LLM 가성비 버전", detail: "Kimi K2-0905 Groq → Gemini Flash → DeepSeek 등", tag: "유료" },
      { step: "4", label: "유료 LLM 최고 버전", detail: "Opus, GPT-5 등 프리미엄 모델", tag: "유료" },
    ],
    note: "이미 구독 중인 유료 LLM이 있다면 해당 모델이 우선 적용됩니다. 마이페이지에서 API 키를 직접 관리하세요.",
  },
  {
    id: "max-performance",
    icon: "\uD83E\uDDE0",
    title: "최고지능 (최대성능 전략)",
    color: "#667eea",
    desc: "현 시점 최고 성능의 AI를 항상 사용합니다. 복잡한 요청은 여러 AI가 동시에 처리하여 최상의 결과를 선택합니다.",
    tiers: [
      { step: "1", label: "최고 성능 단일 모델", detail: "Opus, GPT-5, Gemini Pro 등 최신 모델", tag: "프리미엄" },
      { step: "2", label: "병렬 멀티 모델", detail: "5개 이상 최고급 AI가 동시 처리 후 최적 결과 선택", tag: "프리미엄" },
    ],
    note: "1개 모델로 처리가 어려운 복잡한 요청은 자동으로 여러 최고급 모델을 병렬 실행합니다.",
  },
];

const STEPS = [
  {
    num: "\u2460",
    title: "MoA 설치",
    desc: "Windows, macOS, Linux, Android, iOS에서 1분 안에 설치 완료. 기기는 자동 등록되고 이름만 설정하면 됩니다.",
  },
  {
    num: "\u2461",
    title: "2단계 보안 인증",
    desc: "기기 인증 + 사용자 인증(아이디/암호 + 구문번호)으로 2중 3중 보안. 제3자는 절대 접근할 수 없습니다.",
  },
  {
    num: "\u2462",
    title: "카카오톡에서 시작",
    desc: "카카오톡에서 AI에게 메시지를 보내면 끝! 바로 사용할 수 있습니다.",
  },
];

const USE_CASES = [
  {
    icon: "\uD83D\uDC54",
    role: "직장인",
    title: "퇴근 후 원격 업무",
    desc: "카카오톡으로 회사 PC의 파일을 받아보고, 이메일을 요약하고, 보고서 초안을 AI가 작성해줍니다. 급한 업무도 집에서 해결.",
  },
  {
    icon: "\uD83D\uDCBB",
    role: "개발자",
    title: "코드 리뷰 & 배포",
    desc: "GitHub 스킬로 PR 확인, 코드 분석, 빌드 실행까지. HuggingFace로 ML 모델 학습 상태도 실시간 모니터링.",
  },
  {
    icon: "\uD83C\uDF93",
    role: "학생",
    title: "학습 도우미",
    desc: "Perplexity로 논문 검색, Gamma로 발표 자료 제작, 음성 AI로 외국어 학습. 모든 기기에서 이어서 공부.",
  },
  {
    icon: "\uD83C\uDFA8",
    role: "크리에이터",
    title: "콘텐츠 제작",
    desc: "FAL AI로 이미지 생성, AudioPod로 팟캐스트 제작, Kokoro TTS로 나레이션. AI가 창작 파트너가 됩니다.",
  },
];

const CHANNELS = [
  { name: "KakaoTalk", emoji: "\uD83D\uDFE1", id: "kakaotalk", connectUrl: "https://pf.kakao.com/moa-ai" },
  { name: "Telegram", emoji: "\u2708\uFE0F", id: "telegram", connectUrl: "https://t.me/MoA_AI_Bot" },
  { name: "Discord", emoji: "\uD83C\uDFAE", id: "discord", connectUrl: "https://discord.com/oauth2/authorize?client_id=MOA_BOT_ID&permissions=274878023680&scope=bot" },
  { name: "Slack", emoji: "\uD83D\uDCAC", id: "slack", connectUrl: "https://slack.com/oauth/v2/authorize?client_id=MOA_SLACK_ID" },
  { name: "Signal", emoji: "\uD83D\uDD12", id: "signal", connectUrl: "https://signal.me/#eu/MoA_AI" },
  { name: "iMessage", emoji: "\uD83D\uDCF1", id: "imessage", connectUrl: "imessage://moa@mymoa.app" },
  { name: "LINE", emoji: "\uD83D\uDFE2", id: "line", connectUrl: "https://line.me/R/ti/p/@moa-ai" },
  { name: "WhatsApp", emoji: "\uD83D\uDCDE", id: "whatsapp", connectUrl: "https://wa.me/MoA_NUMBER" },
  { name: "Matrix", emoji: "\uD83D\uDD35", id: "matrix", connectUrl: "https://matrix.to/#/@moa-ai:matrix.org" },
  { name: "MS Teams", emoji: "\uD83C\uDFE2", id: "msteams", connectUrl: "https://teams.microsoft.com/l/app/MOA_TEAMS_ID" },
  { name: "Google Chat", emoji: "\uD83D\uDCAC", id: "googlechat", connectUrl: "https://chat.google.com" },
  { name: "Mattermost", emoji: "\uD83D\uDD37", id: "mattermost", connectUrl: "#" },
  { name: "Twitch", emoji: "\uD83D\uDFE3", id: "twitch", connectUrl: "#" },
  { name: "Nostr", emoji: "\uD83E\uDD18", id: "nostr", connectUrl: "#" },
  { name: "Zalo", emoji: "\uD83D\uDFE6", id: "zalo", connectUrl: "#" },
];

const VOICE_MODES = [
  {
    icon: "\uD83C\uDF99\uFE0F",
    title: "비동기 음성",
    latency: "2\u20134초",
    desc: "음성 메시지를 보내면 AI가 음성으로 답변합니다. 카카오톡, 텔레그램 등에서 사용 가능.",
  },
  {
    icon: "\uD83D\uDD0A",
    title: "실시간 음성",
    latency: "200\u2013500ms",
    desc: "전화 통화처럼 실시간으로 AI와 대화하세요. 초저지연 음성 응답.",
  },
  {
    icon: "\uD83C\uDF0D",
    title: "다국어 통역",
    latency: "실시간",
    desc: "실시간 다국어 통역을 지원합니다. 언어 장벽 없이 소통하세요.",
  },
];

const PRICING = [
  {
    name: "Free",
    price: "0",
    period: "베타 기간 30일",
    badge: "베타",
    features: [
      "기기 1대 연결",
      "AI 대화 일 50회",
      "내장 SLM 무제한 사용",
      "기본 스킬 (날씨, 캘린더 등)",
      "카카오톡 연동",
      "무료 LLM 한도 내 사용 (Groq, Gemini)",
      "본인 API 키 보유 시 모든 LLM 사용 가능",
    ],
  },
  {
    name: "Basic",
    price: "9,900",
    period: "원/월",
    badge: "인기",
    highlight: true,
    features: [
      "기기 3대 연결",
      "AI 대화 무제한",
      "모든 LLM 사용 (마이페이지에서 API 키 관리)",
      "100+ 모든 스킬 사용",
      "파일 전송 무제한",
      "음성 AI (비동기)",
      "자기 학습 엔진",
      "AI 모델 전략 선택 (가성비/최대성능)",
      "우선 지원",
    ],
  },
  {
    name: "Pro",
    price: "29,900",
    period: "원/월",
    badge: null,
    features: [
      "기기 무제한 연결",
      "AI 대화 무제한",
      "모든 스킬 + 커스텀 API",
      "파일 전송 무제한",
      "실시간 음성 + 통역",
      "자기 학습 엔진 (고급)",
      "3단계 스마트 폴백",
      "전담 매니저",
      "커스텀 스킬 개발",
    ],
  },
];

/* ============================================
   Page Component
   ============================================ */

export default function Home() {
  return (
    <>
      <Nav />

      {/* == Hero == */}
      <section
        id="hero"
        style={{
          minHeight: "100vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          textAlign: "center",
          paddingTop: "64px",
          background:
            "radial-gradient(ellipse at 50% 0%, rgba(102,126,234,0.15) 0%, transparent 60%)",
        }}
      >
        <div className="container animate-in">
          <span className="section-badge" style={{ marginBottom: "24px" }}>
            Next-Gen AI Agent &middot; 100+ Skills
          </span>
          <h1
            style={{
              fontSize: "clamp(2.2rem, 5vw, 3.8rem)",
              fontWeight: 800,
              marginBottom: "24px",
              lineHeight: 1.2,
            }}
          >
            {"카카오톡으로 "}
            <span
              style={{
                background: "var(--gradient)",
                WebkitBackgroundClip: "text",
                WebkitTextFillColor: "transparent",
              }}
            >
              AI를 부르세요
            </span>
          </h1>
          <p
            style={{
              fontSize: "clamp(1rem, 2vw, 1.25rem)",
              color: "var(--text-muted)",
              maxWidth: "700px",
              margin: "0 auto 20px",
            }}
          >
            MoA는 카카오톡 한 줄로 AI를 제어하는 차세대 에이전트입니다.
            마이페이지에서 API 키를 관리하고, Kimi K2-0905 Groq 등 가성비 모델부터 최고급 LLM까지.
            100개 이상의 전문 스킬과 2가지 모델 전략으로 항상 최적의 결과를 제공합니다.
          </p>
          <p
            style={{
              fontSize: "0.95rem",
              color: "var(--text-muted)",
              maxWidth: "600px",
              margin: "0 auto 40px",
              opacity: 0.8,
            }}
          >
            터미널이 아닌 카카오톡에서. 복잡한 설정 없이. 누구나 바로 시작할 수 있습니다.
          </p>
          <div style={{ display: "flex", gap: "16px", justifyContent: "center", flexWrap: "wrap" }}>
            <a href="/download" className="btn btn-primary btn-lg">
              앱 다운로드
            </a>
            <a href="#why-moa" className="btn btn-outline btn-lg">
              왜 MoA인가?
            </a>
          </div>
        </div>
      </section>

      {/* == Web Chat (로그인 후 임베디드 채팅) == */}
      <section id="web-chat" style={{ padding: "0 0 40px" }}>
        <div className="container" style={{ maxWidth: "800px" }}>
          <WebChatPanel />
        </div>
      </section>

      {/* == Stats Bar == */}
      <section
        style={{
          padding: "40px 0",
          background: "var(--bg-card)",
          borderTop: "1px solid var(--border)",
          borderBottom: "1px solid var(--border)",
        }}
      >
        <div className="container">
          <div className="stats-bar">
            {STATS.map((s) => (
              <div key={s.label} className="stat-item">
                <span className="stat-value">{s.value}</span>
                <span className="stat-label">{s.label}</span>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* == Why MoA == */}
      <section id="why-moa">
        <div className="container">
          <div className="section-header">
            <span className="section-badge">왜 MoA인가</span>
            <h2>다른 AI 도구와는 차원이 다릅니다</h2>
            <p>
              CLI 기반 AI 도구들과 달리, MoA는 누구나 안전하고 저렴하게 사용할 수 있도록 설계되었습니다
            </p>
          </div>
          <div className="grid-4">
            {WHY_MOA.map((item) => (
              <div className="card why-card" key={item.title}>
                <div style={{ fontSize: "2.5rem", marginBottom: "16px" }}>
                  {item.icon}
                </div>
                <h3 style={{ fontSize: "1.25rem", marginBottom: "8px" }}>
                  {item.title}
                </h3>
                <p style={{ color: "var(--text-muted)", fontSize: "0.95rem", marginBottom: "12px" }}>
                  {item.desc}
                </p>
                <span className="tag">{item.highlight}</span>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* == Features == */}
      <section id="features" style={{ background: "var(--bg-card)" }}>
        <div className="container">
          <div className="section-header">
            <span className="section-badge">핵심 기능</span>
            <h2>하나의 AI로 모든 것을</h2>
            <p>MoA가 제공하는 8가지 핵심 기능을 살펴보세요</p>
          </div>
          <div className="grid-4">
            {FEATURES.map((f) => (
              <div className="card" key={f.title}>
                <div style={{ fontSize: "2.5rem", marginBottom: "16px" }}>
                  {f.icon}
                </div>
                <h3 style={{ fontSize: "1.1rem", marginBottom: "8px" }}>
                  {f.title}
                </h3>
                <p style={{ color: "var(--text-muted)", fontSize: "0.9rem" }}>
                  {f.desc}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* == Skills Showcase == */}
      <section id="skills">
        <div className="container">
          <div className="section-header">
            <span className="section-badge">100+ 스킬</span>
            <h2>전문 AI 스킬 생태계</h2>
            <p>6개 카테고리의 100개 이상의 전문 스킬이 최적의 결과를 제공합니다</p>
          </div>
          <div className="grid-3">
            {SKILL_CATEGORIES.map((cat) => (
              <div className="card skill-category-card" key={cat.name}>
                <div style={{ display: "flex", alignItems: "center", gap: "12px", marginBottom: "20px" }}>
                  <span style={{ fontSize: "2rem" }}>{cat.icon}</span>
                  <h3 style={{ fontSize: "1.15rem" }}>{cat.name}</h3>
                </div>
                <div className="skill-tags">
                  {cat.skills.map((skill) => (
                    <span
                      key={skill}
                      className="skill-tag"
                      style={{ borderColor: `${cat.color}40`, color: cat.color }}
                    >
                      {skill}
                    </span>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* == Model Strategy Selection == */}
      <section id="model-strategy" style={{ background: "var(--bg-card)" }}>
        <div className="container">
          <div className="section-header">
            <span className="section-badge">AI 모델 전략</span>
            <h2>나에게 맞는 AI 전략을 선택하세요</h2>
            <p>
              회원가입 시 선택하고, MoA 앱에서 언제든지 변경할 수 있습니다
            </p>
          </div>
          <div className="grid-2">
            {MODEL_STRATEGIES.map((strat) => (
              <div
                className="card"
                key={strat.id}
                style={{
                  border: `2px solid ${strat.color}40`,
                  position: "relative",
                  overflow: "hidden",
                }}
              >
                <div
                  style={{
                    position: "absolute",
                    top: 0,
                    left: 0,
                    right: 0,
                    height: "4px",
                    background: strat.color,
                  }}
                />
                <div style={{ display: "flex", alignItems: "center", gap: "12px", marginBottom: "16px", marginTop: "8px" }}>
                  <span style={{ fontSize: "2.5rem" }}>{strat.icon}</span>
                  <h3 style={{ fontSize: "1.2rem" }}>{strat.title}</h3>
                </div>
                <p style={{ color: "var(--text-muted)", fontSize: "0.9rem", marginBottom: "20px", lineHeight: 1.6 }}>
                  {strat.desc}
                </p>
                <div style={{ display: "flex", flexDirection: "column", gap: "10px", marginBottom: "16px" }}>
                  {strat.tiers.map((tier) => (
                    <div
                      key={tier.step}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: "12px",
                        padding: "10px 14px",
                        background: "rgba(0,0,0,0.15)",
                        borderRadius: "var(--radius)",
                        borderLeft: `3px solid ${strat.color}`,
                      }}
                    >
                      <span
                        style={{
                          fontSize: "0.75rem",
                          fontWeight: 700,
                          color: strat.color,
                          background: `${strat.color}20`,
                          padding: "2px 8px",
                          borderRadius: "10px",
                          whiteSpace: "nowrap",
                        }}
                      >
                        {tier.tag}
                      </span>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontWeight: 600, fontSize: "0.9rem", color: "var(--text-heading)" }}>
                          {tier.step}. {tier.label}
                        </div>
                        <div style={{ fontSize: "0.8rem", color: "var(--text-muted)" }}>
                          {tier.detail}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
                <p style={{ fontSize: "0.8rem", color: strat.color, fontStyle: "italic", lineHeight: 1.5 }}>
                  {strat.note}
                </p>
              </div>
            ))}
          </div>
          <div style={{ textAlign: "center", marginTop: "40px" }}>
            <p style={{ color: "var(--text-muted)", fontSize: "0.95rem", maxWidth: "700px", margin: "0 auto 20px" }}>
              GPT-4o, Claude, Gemini, DeepSeek, Kimi K2-0905 (Groq), Mistral, Grok 등 모든 주요 AI를 지원합니다.
              마이페이지에서 각 LLM의 API 키를 직접 관리하고, 선택한 전략에 따라 MoA가 자동으로 모델을 운용합니다.
            </p>
            <a href="/mypage" className="btn btn-outline btn-sm">
              마이페이지에서 API 키 관리하기
            </a>
          </div>

          {/* Free Trial Policy */}
          <div
            style={{
              marginTop: "48px",
              padding: "24px 32px",
              borderRadius: "var(--radius-lg)",
              background: "rgba(0,0,0,0.15)",
              border: "1px solid var(--border)",
              maxWidth: "800px",
              margin: "48px auto 0",
            }}
          >
            <h3 style={{ fontSize: "1.1rem", marginBottom: "16px", textAlign: "center" }}>
              무료 체험 정책
            </h3>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: "16px", fontSize: "0.9rem" }}>
              <div style={{ padding: "16px", borderRadius: "var(--radius)", background: "rgba(72,187,120,0.08)", border: "1px solid rgba(72,187,120,0.2)" }}>
                <div style={{ fontWeight: 700, color: "var(--success)", marginBottom: "8px" }}>
                  {"\u2705"} API 키 보유 시
                </div>
                <p style={{ color: "var(--text-muted)", fontSize: "0.85rem" }}>
                  본인의 유료 LLM API 키로 무료 체험 기간 동안 모든 기능을 제한 없이 사용할 수 있습니다.
                </p>
              </div>
              <div style={{ padding: "16px", borderRadius: "var(--radius)", background: "rgba(236,201,75,0.08)", border: "1px solid rgba(236,201,75,0.2)" }}>
                <div style={{ fontWeight: 700, color: "var(--warning)", marginBottom: "8px" }}>
                  {"\u26A0\uFE0F"} API 키 미보유 시
                </div>
                <p style={{ color: "var(--text-muted)", fontSize: "0.85rem" }}>
                  무료 범위 내에서만 사용 가능합니다. (무료 SLM + 유료 LLM 무료 한도까지만)
                </p>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* == Self-Learning Engine == */}
      <section id="self-learning">
        <div className="container">
          <div className="section-header">
            <span className="section-badge">자기 학습</span>
            <h2>쓸수록 똑똑해지는 AI</h2>
            <p>MoA의 자기 학습 엔진이 사용자에 맞게 진화합니다</p>
          </div>
          <div className="grid-3">
            <div className="card" style={{ textAlign: "center" }}>
              <div style={{ fontSize: "3rem", marginBottom: "16px" }}>
                {"\uD83D\uDCDD"}
              </div>
              <h3 style={{ fontSize: "1.15rem", marginBottom: "8px" }}>
                피드백 수집기
              </h3>
              <p style={{ color: "var(--text-muted)", fontSize: "0.9rem" }}>
                &ldquo;아니, 그게 아니라&rdquo; &ldquo;다시 해줘&rdquo; 같은 교정 패턴을 한국어/영어로 인식하여 자동 학습합니다.
              </p>
            </div>
            <div className="card" style={{ textAlign: "center" }}>
              <div style={{ fontSize: "3rem", marginBottom: "16px" }}>
                {"\u26A1"}
              </div>
              <h3 style={{ fontSize: "1.15rem", marginBottom: "8px" }}>
                컨텍스트 최적화
              </h3>
              <p style={{ color: "var(--text-muted)", fontSize: "0.9rem" }}>
                토큰 예산 내에서 가장 중요한 정보를 우선 배치. 핵심 구문 추출로 효율적인 대화를 유지합니다.
              </p>
            </div>
            <div className="card" style={{ textAlign: "center" }}>
              <div style={{ fontSize: "3rem", marginBottom: "16px" }}>
                {"\uD83D\uDEE1\uFE0F"}
              </div>
              <h3 style={{ fontSize: "1.15rem", marginBottom: "8px" }}>
                무결성 검증
              </h3>
              <p style={{ color: "var(--text-muted)", fontSize: "0.9rem" }}>
                SHA-256 해시로 학습 데이터의 무결성을 실시간 검증. 네트워크 호출 없이 로컬에서만 동작하여 안전합니다.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* == How It Works == */}
      <section
        id="how-it-works"
        style={{ background: "var(--bg-card)" }}
      >
        <div className="container">
          <div className="section-header">
            <span className="section-badge">사용법</span>
            <h2>3단계로 시작하세요</h2>
            <p>복잡한 설정 없이, 누구나 바로 시작할 수 있습니다</p>
          </div>
          <div className="grid-3">
            {STEPS.map((s) => (
              <div
                className="card"
                key={s.title}
                style={{ textAlign: "center" }}
              >
                <div
                  style={{
                    fontSize: "3rem",
                    marginBottom: "16px",
                    background: "var(--gradient)",
                    WebkitBackgroundClip: "text",
                    WebkitTextFillColor: "transparent",
                  }}
                >
                  {s.num}
                </div>
                <h3 style={{ fontSize: "1.25rem", marginBottom: "8px" }}>
                  {s.title}
                </h3>
                <p style={{ color: "var(--text-muted)", fontSize: "0.95rem" }}>
                  {s.desc}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* == Use Cases == */}
      <section id="use-cases">
        <div className="container">
          <div className="section-header">
            <span className="section-badge">활용 사례</span>
            <h2>이런 분들이 사용합니다</h2>
            <p>다양한 상황에서 MoA가 도와드립니다</p>
          </div>
          <div className="grid-2">
            {USE_CASES.map((uc) => (
              <div className="card" key={uc.title}>
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "12px",
                    marginBottom: "16px",
                  }}
                >
                  <span style={{ fontSize: "2rem" }}>{uc.icon}</span>
                  <div>
                    <span className="tag">{uc.role}</span>
                    <h3 style={{ fontSize: "1.15rem", marginTop: "4px" }}>
                      {uc.title}
                    </h3>
                  </div>
                </div>
                <p style={{ color: "var(--text-muted)", fontSize: "0.95rem" }}>
                  {uc.desc}
                </p>
              </div>
            ))}
          </div>
          <div style={{ textAlign: "center", marginTop: "32px" }}>
            <a href="/use-cases" className="btn btn-outline">
              사용사례 더 보기
            </a>
          </div>
        </div>
      </section>

      {/* == Channels == */}
      <section id="channels" style={{ background: "var(--bg-card)" }}>
        <div className="container">
          <div className="section-header">
            <span className="section-badge">채널</span>
            <h2>15개 채널, 하나의 AI</h2>
            <p>클릭 한 번으로 익숙한 메신저에서 바로 AI와 대화하세요</p>
          </div>

          {/* Web Chat CTA */}
          <div style={{ textAlign: "center", marginBottom: "32px" }}>
            <a href="/chat" className="btn btn-primary btn-lg">
              {"\uD83D\uDCBB"} 웹에서 바로 채팅 시작
            </a>
          </div>

          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fill, minmax(150px, 1fr))",
              gap: "16px",
              maxWidth: "900px",
              margin: "0 auto",
            }}
          >
            {CHANNELS.map((ch) => (
              <a
                href={`/channels/${ch.id}`}
                className="card channel-home-card"
                key={ch.name}
                style={{
                  textAlign: "center",
                  padding: "20px 12px",
                  textDecoration: "none",
                  display: "block",
                  cursor: "pointer",
                }}
              >
                <div style={{ fontSize: "2rem", marginBottom: "8px" }}>
                  {ch.emoji}
                </div>
                <span
                  style={{
                    fontSize: "0.85rem",
                    fontWeight: 600,
                    color: "var(--text-muted)",
                    display: "block",
                    marginBottom: "8px",
                  }}
                >
                  {ch.name}
                </span>
                <span
                  style={{
                    fontSize: "0.7rem",
                    color: "var(--primary)",
                    fontWeight: 500,
                  }}
                >
                  대화 시작 &rarr;
                </span>
              </a>
            ))}
          </div>
          <div style={{ textAlign: "center", marginTop: "32px" }}>
            <a href="/channels" className="btn btn-outline">
              모든 채널 상세보기 &amp; 연결하기
            </a>
          </div>
        </div>
      </section>

      {/* == Voice == */}
      <section id="voice">
        <div className="container">
          <div className="section-header">
            <span className="section-badge">음성 AI</span>
            <h2>목소리로 AI와 소통하세요</h2>
            <p>세 가지 음성 모드로 자연스러운 AI 경험</p>
          </div>
          <div className="grid-3">
            {VOICE_MODES.map((v) => (
              <div className="card" key={v.title} style={{ textAlign: "center" }}>
                <div style={{ fontSize: "3rem", marginBottom: "16px" }}>
                  {v.icon}
                </div>
                <h3 style={{ fontSize: "1.25rem", marginBottom: "4px" }}>
                  {v.title}
                </h3>
                <span
                  className="tag"
                  style={{ marginBottom: "16px", display: "inline-block" }}
                >
                  {v.latency}
                </span>
                <p style={{ color: "var(--text-muted)", fontSize: "0.95rem" }}>
                  {v.desc}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* == Pricing == */}
      <section id="pricing" style={{ background: "var(--bg-card)" }}>
        <div className="container">
          <div className="section-header">
            <span className="section-badge">요금제</span>
            <h2>합리적인 요금제</h2>
            <p>베타 기간 동안 무료로 체험해보세요</p>
          </div>
          <div className="grid-3">
            {PRICING.map((tier) => (
              <div
                className="card"
                key={tier.name}
                style={{
                  textAlign: "center",
                  position: "relative",
                  border: tier.highlight
                    ? "2px solid var(--primary)"
                    : undefined,
                }}
              >
                {tier.badge && (
                  <span
                    className="tag"
                    style={{
                      position: "absolute",
                      top: "16px",
                      right: "16px",
                    }}
                  >
                    {tier.badge}
                  </span>
                )}
                <h3
                  style={{
                    fontSize: "1.3rem",
                    marginBottom: "8px",
                    marginTop: "8px",
                  }}
                >
                  {tier.name}
                </h3>
                <div style={{ marginBottom: "8px" }}>
                  <span
                    style={{
                      fontSize: "2.5rem",
                      fontWeight: 800,
                      color: "var(--text-heading)",
                    }}
                  >
                    {tier.price === "0" ? "무료" : `${tier.price}원`}
                  </span>
                </div>
                <p
                  style={{
                    color: "var(--text-muted)",
                    fontSize: "0.875rem",
                    marginBottom: "24px",
                  }}
                >
                  {tier.period}
                </p>
                <ul
                  style={{
                    listStyle: "none",
                    textAlign: "left",
                    marginBottom: "24px",
                  }}
                >
                  {tier.features.map((feat) => (
                    <li
                      key={feat}
                      style={{
                        padding: "8px 0",
                        borderBottom: "1px solid var(--border)",
                        color: "var(--text)",
                        fontSize: "0.95rem",
                      }}
                    >
                      {"\u2713 "}{feat}
                    </li>
                  ))}
                </ul>
                <a
                  href="/download"
                  className={`btn ${tier.highlight ? "btn-primary" : "btn-outline"}`}
                  style={{ width: "100%" }}
                >
                  {tier.price === "0" ? "무료로 시작" : "시작하기"}
                </a>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* == Download == */}
      <DownloadSection />

      {/* == Footer == */}
      <footer
        style={{
          borderTop: "1px solid var(--border)",
          padding: "48px 0",
          textAlign: "center",
        }}
      >
        <div className="container">
          <div
            style={{
              display: "flex",
              justifyContent: "center",
              gap: "32px",
              marginBottom: "24px",
              flexWrap: "wrap",
            }}
          >
            <a
              href="/community"
              style={{ color: "var(--text-muted)", fontSize: "0.95rem" }}
            >
              커뮤니티
            </a>
            <a
              href="/use-cases"
              style={{ color: "var(--text-muted)", fontSize: "0.95rem" }}
            >
              사용사례
            </a>
            <a
              href="/feedback"
              style={{ color: "var(--text-muted)", fontSize: "0.95rem" }}
            >
              건의사항
            </a>
            <a
              href="/mypage"
              style={{ color: "var(--text-muted)", fontSize: "0.95rem" }}
            >
              마이페이지
            </a>
            <a
              href="https://discord.gg/moa-community"
              target="_blank"
              rel="noopener noreferrer"
              style={{ color: "var(--text-muted)", fontSize: "0.95rem" }}
            >
              Discord
            </a>
            <a
              href="https://pf.kakao.com/moa-ai"
              target="_blank"
              rel="noopener noreferrer"
              style={{ color: "var(--text-muted)", fontSize: "0.95rem" }}
            >
              카카오톡 채널
            </a>
          </div>
          <div
            style={{
              color: "var(--text-muted)",
              fontSize: "0.8rem",
              lineHeight: "1.8",
              marginTop: "8px",
              borderTop: "1px solid var(--border)",
              paddingTop: "20px",
            }}
          >
            <p style={{ marginBottom: "4px" }}>
              상호: 로콜 &nbsp;|&nbsp; 대표: 김재철 &nbsp;|&nbsp;
              사업자등록번호: 685-21-02314
            </p>
            <p style={{ marginBottom: "4px" }}>
              업종: 정보통신업 / 포털 및 기타 인터넷 정보 매개 서비스업
            </p>
            <p style={{ marginBottom: "4px" }}>
              소재지: 서울특별시 강동구 동남로75길 19, 제지하2층 제1호
              (명일동, 명일빌딩)
            </p>
            <p style={{ marginTop: "12px" }}>
              &copy; {new Date().getFullYear()} MoA (Master of AI). All rights
              reserved.
            </p>
            <p
              style={{
                marginTop: "8px",
                fontSize: "0.72rem",
                color: "var(--text-muted)",
                opacity: 0.7,
              }}
            >
              본 서비스는 OpenClaw(MIT License)의 코드를 일부 포함하고
              있으며, 보안을 대폭 강화하고 기능을 풍부하게 보강하였습니다.
            </p>
          </div>
        </div>
      </footer>

    </>
  );
}
