import Nav from "../components/Nav";
import DownloadSection from "../components/DownloadSection";

/* ============================================
   Data
   ============================================ */

const FEATURES = [
  {
    icon: "\uD83E\uDDE0",
    title: "\uC30D\uB465\uC774 AI",
    desc: "\uBAA8\uB4E0 \uAE30\uAE30\uC5D0\uC11C \uB3D9\uC77C\uD55C AI \uAE30\uC5B5\uACFC \uB9E5\uB77D\uC744 \uACF5\uC720\uD569\uB2C8\uB2E4. \uB178\uD2B8\uBD81\uC5D0\uC11C \uC2DC\uC791\uD55C \uB300\uD654\uB97C \uD734\uB300\uD3F0\uC5D0\uC11C \uC774\uC5B4\uAC00\uC138\uC694.",
  },
  {
    icon: "\uD83D\uDCAC",
    title: "\uCE74\uCE74\uC624\uD1A1 \uC6D0\uACA9\uC81C\uC5B4",
    desc: "\uCE74\uCE74\uC624\uD1A1\uC73C\uB85C \uC9D1/\uC0AC\uBB34\uC2E4 PC\uC5D0 \uBA85\uB839\uC744 \uB0B4\uB9AC\uC138\uC694. \uD30C\uC77C \uC804\uC1A1, \uC571 \uC2E4\uD589, \uC2A4\uD06C\uB9B0\uC0F7 \uBAA8\uB450 \uAC00\uB2A5\uD569\uB2C8\uB2E4.",
  },
  {
    icon: "\uD83E\uDD16",
    title: "AI \uB300\uD654",
    desc: "GPT-4o, Claude, Gemini \uB4F1 \uCD5C\uC2E0 AI \uBAA8\uB378\uACFC \uC790\uC5F0\uC2A4\uB7EC\uC6B4 \uB300\uD654. \uCF54\uB4DC \uC791\uC131, \uBC88\uC5ED, \uC694\uC57D\uC744 \uD55C\uBC88\uC5D0.",
  },
  {
    icon: "\uD83D\uDCC1",
    title: "\uD30C\uC77C \uAD00\uB9AC",
    desc: "\uAE30\uAE30 \uAC04 \uD30C\uC77C\uC744 \uC790\uC720\uB86D\uAC8C \uC804\uC1A1\uD558\uACE0 \uAD00\uB9AC\uD558\uC138\uC694. \uCE74\uCE74\uC624\uD1A1\uC73C\uB85C \uD30C\uC77C\uC744 \uBCF4\uB0B4\uBA74 PC\uC5D0 \uC800\uC7A5\uB429\uB2C8\uB2E4.",
  },
  {
    icon: "\uD83C\uDF99\uFE0F",
    title: "\uC74C\uC131 AI",
    desc: "\uC74C\uC131\uC73C\uB85C AI\uC640 \uB300\uD654\uD558\uC138\uC694. \uBE44\uB3D9\uAE30 \uC74C\uC131, \uC2E4\uC2DC\uAC04 \uC74C\uC131, \uB2E4\uAD6D\uC5B4 \uD1B5\uC5ED\uC744 \uC9C0\uC6D0\uD569\uB2C8\uB2E4.",
  },
  {
    icon: "\uD83D\uDD12",
    title: "E2E \uC554\uD638\uD654 \uBCF4\uC548",
    desc: "\uBAA8\uB4E0 \uD1B5\uC2E0\uC740 \uC885\uB2E8 \uAC04 \uC554\uD638\uD654\uB85C \uBCF4\uD638\uB429\uB2C8\uB2E4. \uC5EC\uB7EC\uBD84\uC758 \uB370\uC774\uD130\uB294 \uC548\uC804\uD569\uB2C8\uB2E4.",
  },
];

const STEPS = [
  {
    num: "\u2460",
    title: "MoA \uC124\uCE58",
    desc: "Windows, macOS, Linux, Android, iOS\uC5D0\uC11C MoA\uB97C \uC124\uCE58\uD558\uC138\uC694.",
  },
  {
    num: "\u2461",
    title: "\uAE30\uAE30 \uB4F1\uB85D",
    desc: "6\uC790\uB9AC \uCF54\uB4DC\uB85C \uAE30\uAE30\uB97C \uAC04\uD3B8\uD558\uAC8C \uC5F0\uACB0\uD558\uC138\uC694.",
  },
  {
    num: "\u2462",
    title: "\uCE74\uCE74\uC624\uD1A1\uC5D0\uC11C \uBA85\uB839",
    desc: "\uCE74\uCE74\uC624\uD1A1 \uCC44\uD305\uBC29\uC5D0\uC11C AI\uC5D0\uAC8C \uBA85\uB839\uC744 \uB0B4\uB9AC\uBA74 \uB05D!",
  },
];

const USE_CASES = [
  {
    icon: "\uD83D\uDC54",
    role: "\uC9C1\uC7A5\uC778",
    title: "\uD1F4\uADFC \uD6C4 \uD30C\uC77C \uD655\uC778",
    desc: "\uD68C\uC0AC PC\uC5D0 \uB450\uACE0 \uC628 \uD30C\uC77C\uC744 \uCE74\uCE74\uC624\uD1A1\uC73C\uB85C \uBC14\uB85C \uBC1B\uC544\uBCF4\uC138\uC694. \uAE09\uD55C \uBB38\uC11C\uB3C4 \uC9D1\uC5D0\uC11C \uD655\uC778 \uAC00\uB2A5.",
  },
  {
    icon: "\uD83D\uDCBB",
    role: "\uAC1C\uBC1C\uC790",
    title: "\uC6D0\uACA9 \uBE4C\uB4DC/\uBC30\uD3EC",
    desc: "\uC678\uBD80\uC5D0\uC11C \uCE74\uCE74\uC624\uD1A1\uC73C\uB85C \uC11C\uBC84 \uC0C1\uD0DC \uD655\uC778, \uBE4C\uB4DC \uC2E4\uD589, \uB85C\uADF8 \uC870\uD68C\uB97C \uD55C\uBC88\uC5D0.",
  },
  {
    icon: "\uD83C\uDF93",
    role: "\uB300\uD559\uC0DD",
    title: "\uAE30\uAE30 \uAC04 \uB3D9\uAE30\uD654",
    desc: "\uB178\uD2B8\uBD81, \uD0DC\uBE14\uB9BF, \uD734\uB300\uD3F0 \uAC04 \uD544\uAE30\uC640 \uC790\uB8CC\uB97C \uC790\uC720\uB86D\uAC8C \uC774\uB3D9\uD558\uC138\uC694.",
  },
  {
    icon: "\uD83C\uDFA8",
    role: "\uD504\uB9AC\uB79C\uC11C",
    title: "\uC791\uC5C5 \uC694\uC57D \uBC0F \uAD00\uB9AC",
    desc: "\uC5EC\uB7EC \uD074\uB77C\uC774\uC5B8\uD2B8 \uC791\uC5C5\uC744 AI\uAC00 \uC790\uB3D9\uC73C\uB85C \uC694\uC57D\uD558\uACE0 \uC77C\uC815\uC744 \uAD00\uB9AC\uD574\uC90D\uB2C8\uB2E4.",
  },
];

const SKILLS = [
  { icon: "\u26C5", name: "\uB0A0\uC528" },
  { icon: "\uD83D\uDCC5", name: "\uAD6C\uAE00 \uCE98\uB9B0\uB354" },
  { icon: "\uD83D\uDCC6", name: "\uCE74\uCE74\uC624 \uCE98\uB9B0\uB354" },
  { icon: "\u26BD", name: "\uC2A4\uD3EC\uCE20 \uC77C\uC815" },
  { icon: "\uD83C\uDF89", name: "\uACF5\uD734\uC77C" },
  { icon: "\uD83C\uDF2B\uFE0F", name: "\uBBF8\uC138\uBA3C\uC9C0" },
  { icon: "\uD83D\uDDFA\uFE0F", name: "\uB0B4\uBE44\uAC8C\uC774\uC158" },
  { icon: "\uD83C\uDFA8", name: "\uCC3D\uC791 \uB3C4\uAD6C" },
];

const CHANNELS = [
  { name: "Telegram", emoji: "\u2708\uFE0F" },
  { name: "Discord", emoji: "\uD83C\uDFAE" },
  { name: "Slack", emoji: "\uD83D\uDCAC" },
  { name: "Signal", emoji: "\uD83D\uDD12" },
  { name: "iMessage", emoji: "\uD83D\uDCF1" },
  { name: "LINE", emoji: "\uD83D\uDFE2" },
  { name: "WhatsApp", emoji: "\uD83D\uDCDE" },
  { name: "Matrix", emoji: "\uD83D\uDD35" },
  { name: "MS Teams", emoji: "\uD83C\uDFE2" },
  { name: "Google Chat", emoji: "\uD83D\uDCAC" },
  { name: "Mattermost", emoji: "\uD83D\uDD37" },
  { name: "Twitch", emoji: "\uD83D\uDFE3" },
  { name: "Nostr", emoji: "\uD83E\uDD18" },
  { name: "Zalo", emoji: "\uD83D\uDFE6" },
  { name: "KakaoTalk", emoji: "\uD83D\uDFE1" },
];

const VOICE_MODES = [
  {
    icon: "\uD83C\uDF99\uFE0F",
    title: "\uBE44\uB3D9\uAE30 \uC74C\uC131",
    latency: "2\u20134\uCD08",
    desc: "\uC74C\uC131 \uBA54\uC2DC\uC9C0\uB97C \uBCF4\uB0B4\uBA74 AI\uAC00 \uC74C\uC131\uC73C\uB85C \uB2F5\uBCC0\uD569\uB2C8\uB2E4. \uCE74\uCE74\uC624\uD1A1, \uD154\uB808\uADF8\uB7A8 \uB4F1\uC5D0\uC11C \uC0AC\uC6A9 \uAC00\uB2A5.",
  },
  {
    icon: "\uD83D\uDD0A",
    title: "\uC2E4\uC2DC\uAC04 \uC74C\uC131",
    latency: "200\u2013500ms",
    desc: "\uC804\uD654 \uD1B5\uD654\uCC98\uB7FC \uC2E4\uC2DC\uAC04\uC73C\uB85C AI\uC640 \uB300\uD654\uD558\uC138\uC694. \uCD08\uC800\uC9C0\uC5F0 \uC74C\uC131 \uC751\uB2F5.",
  },
  {
    icon: "\uD83C\uDF0D",
    title: "\uD1B5\uC5ED",
    latency: "\uB2E4\uAD6D\uC5B4",
    desc: "\uC2E4\uC2DC\uAC04 \uB2E4\uAD6D\uC5B4 \uD1B5\uC5ED\uC744 \uC9C0\uC6D0\uD569\uB2C8\uB2E4. \uC5B8\uC5B4 \uC7A5\uBCBD \uC5C6\uC774 \uC18C\uD1B5\uD558\uC138\uC694.",
  },
];

const PRICING = [
  {
    name: "Free",
    price: "0",
    period: "\uBCA0\uD0C0 \uAE30\uAC04 30\uC77C",
    badge: "\uBCA0\uD0C0",
    features: [
      "\uAE30\uAE30 1\uB300 \uC5F0\uACB0",
      "AI \uB300\uD654 \uC77C 50\uD68C",
      "\uAE30\uBCF8 \uC2A4\uD0AC",
      "\uCE74\uCE74\uC624\uD1A1 \uC5F0\uB3D9",
    ],
  },
  {
    name: "Basic",
    price: "9,900",
    period: "\uC6D0/\uC6D4",
    badge: "\uC778\uAE30",
    highlight: true,
    features: [
      "\uAE30\uAE30 3\uB300 \uC5F0\uACB0",
      "AI \uB300\uD654 \uBB34\uC81C\uD55C",
      "\uBAA8\uB4E0 \uC2A4\uD0AC \uC0AC\uC6A9",
      "\uD30C\uC77C \uC804\uC1A1 \uBB34\uC81C\uD55C",
      "\uC74C\uC131 AI",
      "\uC6B0\uC120 \uC9C0\uC6D0",
    ],
  },
  {
    name: "Pro",
    price: "29,900",
    period: "\uC6D0/\uC6D4",
    badge: null,
    features: [
      "\uAE30\uAE30 \uBB34\uC81C\uD55C \uC5F0\uACB0",
      "AI \uB300\uD654 \uBB34\uC81C\uD55C",
      "\uBAA8\uB4E0 \uC2A4\uD0AC + API",
      "\uD30C\uC77C \uC804\uC1A1 \uBB34\uC81C\uD55C",
      "\uC2E4\uC2DC\uAC04 \uC74C\uC131 + \uD1B5\uC5ED",
      "\uC804\uB2F4 \uB9E4\uB2C8\uC800",
      "\uCEE4\uC2A4\uD140 \uC2A4\uD0AC \uAC1C\uBC1C",
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

      {/* ── Hero ── */}
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
            Next-Gen AI Agent
          </span>
          <h1
            style={{
              fontSize: "clamp(2.2rem, 5vw, 3.8rem)",
              fontWeight: 800,
              marginBottom: "24px",
              lineHeight: 1.2,
            }}
          >
            {"\uBAA8\uB4E0 \uAE30\uAE30\uB97C "}
            <span
              style={{
                background: "var(--gradient)",
                WebkitBackgroundClip: "text",
                WebkitTextFillColor: "transparent",
              }}
            >
              {"\uD558\uB098\uC758 AI"}
            </span>
            {"\uB85C \uC5F0\uACB0\uD558\uC138\uC694"}
          </h1>
          <p
            style={{
              fontSize: "clamp(1rem, 2vw, 1.25rem)",
              color: "var(--text-muted)",
              maxWidth: "640px",
              margin: "0 auto 40px",
            }}
          >
            MoA\uB294 \uB178\uD2B8\uBD81, \uD0DC\uBE14\uB9BF, \uB370\uC2A4\uD06C\uD1B1\uC744 \uD558\uB098\uC758 AI\uB85C \uC5F0\uACB0\uD558\uB294 \uCC28\uC138\uB300 AI \uC5D0\uC774\uC804\uD2B8\uC785\uB2C8\uB2E4. \uCE74\uCE74\uC624\uD1A1\uC5D0\uC11C \uC6D0\uACA9 \uC81C\uC5B4, AI \uB300\uD654, \uD30C\uC77C \uAD00\uB9AC\uB97C \uD55C\uBC88\uC5D0.
          </p>
          <div style={{ display: "flex", gap: "16px", justifyContent: "center", flexWrap: "wrap" }}>
            <a href="#download" className="btn btn-primary btn-lg">
              {"\uC9C0\uAE08 \uB2E4\uC6B4\uB85C\uB4DC"}
            </a>
            <a href="#features" className="btn btn-outline btn-lg">
              {"\uC790\uC138\uD788 \uC54C\uC544\uBCF4\uAE30"}
            </a>
          </div>
        </div>
      </section>

      {/* ── Features ── */}
      <section id="features">
        <div className="container">
          <div className="section-header">
            <span className="section-badge">{"\uAE30\uB2A5"}</span>
            <h2>{"\uD558\uB098\uC758 AI\uB85C \uBAA8\uB4E0 \uAC83\uC744"}</h2>
            <p>MoA\uAC00 \uC81C\uACF5\uD558\uB294 \uD575\uC2EC \uAE30\uB2A5\uB4E4\uC744 \uC0B4\uD3B4\uBCF4\uC138\uC694</p>
          </div>
          <div className="grid-3">
            {FEATURES.map((f) => (
              <div className="card" key={f.title}>
                <div style={{ fontSize: "2.5rem", marginBottom: "16px" }}>
                  {f.icon}
                </div>
                <h3 style={{ fontSize: "1.25rem", marginBottom: "8px" }}>
                  {f.title}
                </h3>
                <p style={{ color: "var(--text-muted)", fontSize: "0.95rem" }}>
                  {f.desc}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── How It Works ── */}
      <section
        id="how-it-works"
        style={{ background: "var(--bg-card)" }}
      >
        <div className="container">
          <div className="section-header">
            <span className="section-badge">{"\uC0AC\uC6A9\uBC95"}</span>
            <h2>{"\uC2DC\uC791\uC740 \uAC04\uB2E8\uD569\uB2C8\uB2E4"}</h2>
            <p>3\uB2E8\uACC4\uB9CC\uC73C\uB85C MoA\uB97C \uC2DC\uC791\uD560 \uC218 \uC788\uC2B5\uB2C8\uB2E4</p>
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

      {/* ── Use Cases ── */}
      <section id="use-cases">
        <div className="container">
          <div className="section-header">
            <span className="section-badge">{"\uC0AC\uC6A9 \uC0AC\uB840"}</span>
            <h2>{"\uC774\uB7F0 \uBD84\uB4E4\uC774 \uC0AC\uC6A9\uD569\uB2C8\uB2E4"}</h2>
            <p>{"\uB2E4\uC591\uD55C \uC0C1\uD669\uC5D0\uC11C MoA\uAC00 \uB3C4\uC640\uB4DC\uB9BD\uB2C8\uB2E4"}</p>
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
        </div>
      </section>

      {/* ── Skills ── */}
      <section id="skills" style={{ background: "var(--bg-card)" }}>
        <div className="container">
          <div className="section-header">
            <span className="section-badge">{"\uC2A4\uD0AC"}</span>
            <h2>AI\uC5D0\uAC8C \uB354 \uB9CE\uC740 \uB2A5\uB825\uC744</h2>
            <p>{"\uB2E4\uC591\uD55C \uC2A4\uD0AC\uC744 \uCD94\uAC00\uD558\uC5EC AI\uC758 \uB2A5\uB825\uC744 \uD655\uC7A5\uD558\uC138\uC694"}</p>
          </div>
          <div className="grid-4">
            {SKILLS.map((s) => (
              <div
                className="card"
                key={s.name}
                style={{ textAlign: "center", padding: "24px" }}
              >
                <div style={{ fontSize: "2.5rem", marginBottom: "12px" }}>
                  {s.icon}
                </div>
                <h4 style={{ fontSize: "1rem" }}>{s.name}</h4>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Channels ── */}
      <section id="channels">
        <div className="container">
          <div className="section-header">
            <span className="section-badge">{"\uCC44\uB110"}</span>
            <h2>15\uAC1C \uCC44\uB110, \uD558\uB098\uC758 AI</h2>
            <p>{"\uC5B4\uB514\uC11C\uB4E0 \uC775\uC219\uD55C \uBA54\uC2E0\uC800\uB85C AI\uC640 \uB300\uD654\uD558\uC138\uC694"}</p>
          </div>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fill, minmax(140px, 1fr))",
              gap: "16px",
              maxWidth: "900px",
              margin: "0 auto",
            }}
          >
            {CHANNELS.map((ch) => (
              <div
                className="card"
                key={ch.name}
                style={{
                  textAlign: "center",
                  padding: "20px 12px",
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
                  }}
                >
                  {ch.name}
                </span>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Voice ── */}
      <section id="voice" style={{ background: "var(--bg-card)" }}>
        <div className="container">
          <div className="section-header">
            <span className="section-badge">{"\uC74C\uC131 AI"}</span>
            <h2>{"\uBAA9\uC18C\uB9AC\uB85C AI\uC640 \uC18C\uD1B5\uD558\uC138\uC694"}</h2>
            <p>{"\uC138 \uAC00\uC9C0 \uC74C\uC131 \uBAA8\uB4DC\uB85C \uC790\uC5F0\uC2A4\uB7EC\uC6B4 AI \uACBD\uD5D8"}</p>
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

      {/* ── Pricing ── */}
      <section id="pricing">
        <div className="container">
          <div className="section-header">
            <span className="section-badge">{"\uC694\uAE08\uC81C"}</span>
            <h2>{"\uD569\uB9AC\uC801\uC778 \uC694\uAE08\uC81C"}</h2>
            <p>{"\uBCA0\uD0C0 \uAE30\uAC04 \uB3D9\uC548 \uBB34\uB8CC\uB85C \uCCB4\uD5D8\uD574\uBCF4\uC138\uC694"}</p>
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
                    {tier.price === "0" ? "\uBB34\uB8CC" : `${tier.price}\uC6D0`}
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
                  href="#download"
                  className={`btn ${tier.highlight ? "btn-primary" : "btn-outline"}`}
                  style={{ width: "100%" }}
                >
                  {tier.price === "0" ? "\uBB34\uB8CC\uB85C \uC2DC\uC791" : "\uC2DC\uC791\uD558\uAE30"}
                </a>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Download ── */}
      <DownloadSection />

      {/* ── Footer ── */}
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
              href="https://discord.gg/moa-community"
              target="_blank"
              rel="noopener noreferrer"
              style={{ color: "var(--text-muted)", fontSize: "0.95rem" }}
            >
              {"\uCEE4\uBBA4\uB2C8\uD2F0"}
            </a>
            <a
              href="https://github.com/lawith/moa/issues"
              target="_blank"
              rel="noopener noreferrer"
              style={{ color: "var(--text-muted)", fontSize: "0.95rem" }}
            >
              {"\uAC74\uC758\uC0AC\uD56D"}
            </a>
            <a
              href="https://github.com/lawith/moa"
              target="_blank"
              rel="noopener noreferrer"
              style={{ color: "var(--text-muted)", fontSize: "0.95rem" }}
            >
              GitHub
            </a>
            <a
              href="https://pf.kakao.com/moa-ai"
              target="_blank"
              rel="noopener noreferrer"
              style={{ color: "var(--text-muted)", fontSize: "0.95rem" }}
            >
              {"\uCE74\uCE74\uC624\uD1A1 \uCC44\uB110"}
            </a>
          </div>
          <p
            style={{
              color: "var(--text-muted)",
              fontSize: "0.85rem",
            }}
          >
            &copy; {new Date().getFullYear()} MoA (Master of AI). All rights
            reserved.
          </p>
        </div>
      </footer>
    </>
  );
}
