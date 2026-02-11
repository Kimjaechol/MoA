"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import Nav from "../../components/Nav";
import { detectPlatform, type Platform } from "../../lib/detect-platform";

/* ============================================
   MoA Download Page
   One-click install for all platforms.
   ============================================ */

/** GitHub releases base URL */
const RELEASES_BASE = "https://github.com/Kimjaechol/MoA/releases/latest/download";

interface PlatformDownload {
  name: string;
  icon: string;
  desc: string;
  primaryAction: string;
  primaryUrl: string;
  secondaryAction?: string;
  secondaryUrl?: string;
  terminalCmd?: string;
  steps: string[];
}

const DOWNLOADS: Record<Exclude<Platform, null>, PlatformDownload> = {
  windows: {
    name: "Windows",
    icon: "\uD83E\uDE9F",
    desc: "Windows 10/11 (64-bit)",
    primaryAction: "MoA 설치하기 (.exe)",
    primaryUrl: `${RELEASES_BASE}/MoA-Setup-latest.exe`,
    terminalCmd: `powershell -c "irm https://moa.lawith.kr/install.ps1 | iex"`,
    steps: [
      "위 버튼을 클릭하여 설치 파일을 다운로드합니다",
      "다운로드된 MoA-Setup.exe를 더블클릭합니다",
      "설치가 자동으로 완료되고 MoA가 실행됩니다",
    ],
  },
  macos: {
    name: "macOS",
    icon: "\uD83C\uDF4E",
    desc: "macOS 12+ (Apple Silicon / Intel)",
    primaryAction: "MoA 설치하기 (.dmg)",
    primaryUrl: `${RELEASES_BASE}/MoA-latest-mac.dmg`,
    terminalCmd: `curl -fsSL https://moa.lawith.kr/install.sh | bash`,
    steps: [
      "위 버튼을 클릭하여 DMG 파일을 다운로드합니다",
      "DMG를 열고 MoA 아이콘을 Applications 폴더로 드래그합니다",
      "Launchpad에서 MoA를 실행합니다",
    ],
  },
  linux: {
    name: "Linux",
    icon: "\uD83D\uDC27",
    desc: "Ubuntu 20.04+, Debian 11+, Fedora 35+",
    primaryAction: "MoA 설치하기 (.AppImage)",
    primaryUrl: `${RELEASES_BASE}/MoA-latest-linux.AppImage`,
    secondaryAction: ".deb 패키지",
    secondaryUrl: `${RELEASES_BASE}/MoA-latest-linux.deb`,
    terminalCmd: `curl -fsSL https://moa.lawith.kr/install.sh | bash`,
    steps: [
      "위 버튼을 클릭하여 AppImage를 다운로드합니다",
      "파일에 실행 권한을 부여합니다: chmod +x MoA-*.AppImage",
      "더블클릭하여 실행합니다",
    ],
  },
  android: {
    name: "Android",
    icon: "\uD83E\uDD16",
    desc: "Android 10+ (스마트폰, 태블릿)",
    primaryAction: "Google Play에서 받기",
    primaryUrl: "https://play.google.com/store/apps/details?id=com.lawith.moa",
    secondaryAction: "APK 직접 다운로드",
    secondaryUrl: `${RELEASES_BASE}/MoA-latest.apk`,
    steps: [
      "Google Play 스토어에서 'MoA'를 검색합니다",
      "'설치' 버튼을 누릅니다",
      "설치 완료 후 앱을 실행합니다",
    ],
  },
  ios: {
    name: "iOS / iPadOS",
    icon: "\uD83D\uDCF1",
    desc: "iPhone, iPad (iOS 15+)",
    primaryAction: "App Store에서 받기",
    primaryUrl: "https://apps.apple.com/app/moa-ai-assistant/id0000000000",
    steps: [
      "App Store에서 'MoA'를 검색합니다",
      "'받기' 버튼을 누릅니다",
      "설치 완료 후 앱을 실행합니다",
    ],
  },
};

const PLATFORM_ORDER: Exclude<Platform, null>[] = ["windows", "macos", "linux", "android", "ios"];

export default function DownloadPage() {
  const [detected, setDetected] = useState<Platform>(null);
  const [selected, setSelected] = useState<Exclude<Platform, null>>("windows");
  const [copied, setCopied] = useState(false);
  const [showPWA, setShowPWA] = useState(false);

  useEffect(() => {
    const p = detectPlatform(navigator.userAgent);
    if (p) {
      setDetected(p);
      setSelected(p);
    }
    // Check PWA install prompt availability
    const handler = () => setShowPWA(true);
    window.addEventListener("beforeinstallprompt", handler);
    return () => window.removeEventListener("beforeinstallprompt", handler);
  }, []);

  const info = DOWNLOADS[selected];

  const handleCopy = (text: string) => {
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <>
      <Nav />
      <main style={{ paddingTop: "100px", minHeight: "100vh" }}>
        <div className="container" style={{ maxWidth: "900px" }}>
          {/* Header */}
          <div style={{ textAlign: "center", marginBottom: "40px" }}>
            <h1 style={{ fontSize: "2.5rem", fontWeight: 900, marginBottom: "12px" }}>
              MoA 다운로드
            </h1>
            <p style={{ color: "var(--text-muted)", fontSize: "1.1rem", maxWidth: "600px", margin: "0 auto" }}>
              원클릭으로 설치하세요. 모든 플랫폼에서 100+ AI 에이전트를 바로 사용할 수 있습니다.
            </p>
          </div>

          {/* Platform Tabs */}
          <div style={{ display: "flex", justifyContent: "center", gap: "8px", marginBottom: "40px", flexWrap: "wrap" }}>
            {PLATFORM_ORDER.map((key) => {
              const d = DOWNLOADS[key];
              const isActive = selected === key;
              const isDetected = detected === key;
              return (
                <button
                  key={key}
                  onClick={() => { setSelected(key); setCopied(false); }}
                  style={{
                    display: "inline-flex", alignItems: "center", gap: "8px",
                    padding: "12px 24px", borderRadius: "var(--radius)",
                    border: isActive ? "2px solid var(--primary)" : "2px solid var(--border)",
                    background: isActive ? "rgba(102,126,234,0.15)" : "transparent",
                    color: isActive ? "var(--text-heading)" : "var(--text-muted)",
                    cursor: "pointer", fontWeight: 600, fontSize: "0.95rem", transition: "all 0.2s",
                  }}
                >
                  <span style={{ fontSize: "1.2rem" }}>{d.icon}</span>
                  {d.name}
                  {isDetected && (
                    <span className="tag" style={{ marginLeft: "4px", fontSize: "0.65rem" }}>
                      현재 기기
                    </span>
                  )}
                </button>
              );
            })}
          </div>

          {/* Download Card */}
          <div className="card" style={{ maxWidth: "640px", margin: "0 auto 32px", textAlign: "center" }}>
            <div style={{ fontSize: "4rem", marginBottom: "16px" }}>{info.icon}</div>
            <h2 style={{ fontSize: "1.8rem", marginBottom: "8px" }}>MoA for {info.name}</h2>
            <p style={{ color: "var(--text-muted)", marginBottom: "28px" }}>{info.desc}</p>

            {/* Primary Download Button */}
            <div style={{ display: "flex", gap: "12px", justifyContent: "center", flexWrap: "wrap", marginBottom: "20px" }}>
              <a
                href={info.primaryUrl}
                className="btn btn-primary"
                style={{ fontSize: "1.15rem", padding: "16px 40px", fontWeight: 700 }}
              >
                {info.primaryAction}
              </a>
              {info.secondaryUrl && (
                <a
                  href={info.secondaryUrl}
                  className="btn btn-outline"
                  style={{ fontSize: "0.95rem", padding: "14px 28px" }}
                >
                  {info.secondaryAction}
                </a>
              )}
            </div>

            {/* PWA Install Option */}
            {showPWA && (selected === "android" || selected === "ios") && (
              <p style={{ color: "var(--success)", fontSize: "0.9rem", marginBottom: "16px" }}>
                또는 브라우저에서 바로 설치: 주소창 옆의 "설치" 아이콘을 클릭하세요
              </p>
            )}

            {/* Install Steps */}
            <div style={{ textAlign: "left", marginTop: "24px", padding: "16px 20px", background: "rgba(255,255,255,0.03)", borderRadius: "var(--radius)" }}>
              <h4 style={{ fontSize: "0.9rem", color: "var(--text-muted)", marginBottom: "12px" }}>설치 방법</h4>
              <ol style={{ margin: 0, paddingLeft: "20px", display: "flex", flexDirection: "column", gap: "8px" }}>
                {info.steps.map((step, i) => (
                  <li key={i} style={{ fontSize: "0.85rem", color: "var(--text-muted)" }}>{step}</li>
                ))}
              </ol>
            </div>

            {/* Terminal Command (Advanced) */}
            {info.terminalCmd && (
              <details style={{ marginTop: "16px" }}>
                <summary style={{ cursor: "pointer", color: "var(--text-muted)", fontSize: "0.85rem" }}>
                  고급: 터미널 명령어로 설치
                </summary>
                <div style={{
                  background: "var(--bg)", borderRadius: "var(--radius)", padding: "14px 20px", marginTop: "8px",
                  fontFamily: "monospace", fontSize: "0.85rem", color: "var(--success)", overflowX: "auto",
                  textAlign: "left", border: "1px solid var(--border)", position: "relative",
                }}>
                  <code>{info.terminalCmd}</code>
                  <button
                    className="btn btn-outline"
                    style={{ position: "absolute", right: "8px", top: "50%", transform: "translateY(-50%)", padding: "4px 12px", fontSize: "0.75rem" }}
                    onClick={() => handleCopy(info.terminalCmd!)}
                  >
                    {copied ? "복사됨!" : "복사"}
                  </button>
                </div>
              </details>
            )}
          </div>

          {/* All Platforms Summary */}
          <div className="card" style={{ maxWidth: "640px", margin: "0 auto 32px" }}>
            <h3 style={{ fontSize: "1.1rem", marginBottom: "16px" }}>모든 플랫폼 지원</h3>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: "12px" }}>
              {PLATFORM_ORDER.map((key) => {
                const d = DOWNLOADS[key];
                return (
                  <div key={key} style={{ display: "flex", alignItems: "center", gap: "10px", padding: "8px", borderRadius: "8px", background: "rgba(255,255,255,0.03)" }}>
                    <span style={{ fontSize: "1.5rem" }}>{d.icon}</span>
                    <div>
                      <div style={{ fontWeight: 600, fontSize: "0.85rem" }}>{d.name}</div>
                      <div style={{ fontSize: "0.75rem", color: "var(--text-muted)" }}>{d.desc.split("(")[0]}</div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Feature highlights */}
          <div style={{ maxWidth: "640px", margin: "0 auto 48px", textAlign: "center" }}>
            <h3 style={{ fontSize: "1.2rem", marginBottom: "16px" }}>데스크톱 앱 추가 기능</h3>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: "12px" }}>
              {[
                { icon: "\uD83D\uDCC2", title: "로컬 파일 접근", desc: "E드라이브 등 파일 직접 관리" },
                { icon: "\uD83D\uDDA5\uFE0F", title: "시스템 트레이", desc: "백그라운드에서 항상 실행" },
                { icon: "\u26A1", title: "원클릭 설치", desc: "다운로드 후 바로 사용" },
                { icon: "\uD83D\uDD04", title: "자동 업데이트", desc: "항상 최신 버전 유지" },
              ].map((f) => (
                <div key={f.title} className="card" style={{ textAlign: "center", padding: "20px" }}>
                  <div style={{ fontSize: "2rem", marginBottom: "8px" }}>{f.icon}</div>
                  <div style={{ fontWeight: 700, fontSize: "0.9rem", marginBottom: "4px" }}>{f.title}</div>
                  <div style={{ fontSize: "0.8rem", color: "var(--text-muted)" }}>{f.desc}</div>
                </div>
              ))}
            </div>
          </div>

          {/* Footer */}
          <div style={{ textAlign: "center", marginBottom: "64px" }}>
            <Link href="/chat" className="btn btn-primary" style={{ marginRight: "12px" }}>
              웹에서 바로 사용하기
            </Link>
            <Link href="/" className="btn btn-outline">
              홈으로
            </Link>
          </div>
        </div>
      </main>
    </>
  );
}
