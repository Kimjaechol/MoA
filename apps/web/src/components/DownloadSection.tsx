"use client";

import { useState, useEffect } from "react";
import { detectPlatform, PLATFORM_INFO, type Platform } from "../lib/detect-platform";

const PLATFORM_EMOJI: Record<string, string> = {
  windows: "\uD83E\uDE9F",
  macos: "\uD83C\uDF4E",
  linux: "\uD83D\uDC27",
  android: "\uD83E\uDD16",
  ios: "\uD83D\uDCF1",
};

const PLATFORM_ORDER: Exclude<Platform, null>[] = [
  "windows",
  "macos",
  "linux",
  "android",
  "ios",
];

const POST_DOWNLOAD_MSG: Record<string, string> = {
  windows:
    "다운로드된 MoA-Install.bat 파일을 더블클릭하면 자동으로 설치됩니다.",
  macos:
    "다운로드된 MoA-Install.command 파일을 더블클릭하면 자동으로 설치됩니다.",
  linux:
    "다운로드된 install.sh 파일을 터미널에서 bash install.sh 로 실행하세요.",
};

export default function DownloadSection() {
  const [detected, setDetected] = useState<Platform>(null);
  const [selected, setSelected] = useState<Exclude<Platform, null>>("windows");
  const [downloaded, setDownloaded] = useState(false);

  useEffect(() => {
    const p = detectPlatform(navigator.userAgent);
    if (p) {
      setDetected(p);
      setSelected(p);
    }
  }, []);

  // Reset download state when platform changes
  useEffect(() => {
    setDownloaded(false);
  }, [selected]);

  const info = PLATFORM_INFO[selected];

  return (
    <section id="download" style={{ background: "var(--bg-card)" }}>
      <div className="container">
        <div className="section-header">
          <span className="section-badge">Download</span>
          <h2>지금 바로 시작하세요</h2>
          <p>모든 플랫폼에서 MoA를 사용할 수 있습니다</p>
        </div>

        {/* Platform tabs */}
        <div
          style={{
            display: "flex",
            justifyContent: "center",
            gap: "8px",
            marginBottom: "48px",
            flexWrap: "wrap",
          }}
        >
          {PLATFORM_ORDER.map((key) => {
            const p = PLATFORM_INFO[key];
            const isActive = selected === key;
            const isDetected = detected === key;
            return (
              <button
                key={key}
                onClick={() => setSelected(key)}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: "8px",
                  padding: "12px 24px",
                  borderRadius: "var(--radius)",
                  border: isActive
                    ? "2px solid var(--primary)"
                    : "2px solid var(--border)",
                  background: isActive
                    ? "rgba(102, 126, 234, 0.15)"
                    : "transparent",
                  color: isActive ? "var(--text-heading)" : "var(--text-muted)",
                  cursor: "pointer",
                  fontWeight: 600,
                  fontSize: "0.95rem",
                  transition: "all 0.2s",
                }}
              >
                <span style={{ fontSize: "1.2rem" }}>
                  {PLATFORM_EMOJI[key]}
                </span>
                {p.name}
                {isDetected && (
                  <span
                    className="tag"
                    style={{ marginLeft: "4px", fontSize: "0.65rem" }}
                  >
                    현재 기기
                  </span>
                )}
              </button>
            );
          })}
        </div>

        {/* Install card */}
        <div
          className="card"
          style={{
            maxWidth: "640px",
            margin: "0 auto",
            textAlign: "center",
          }}
        >
          <div style={{ fontSize: "3rem", marginBottom: "16px" }}>
            {PLATFORM_EMOJI[selected]}
          </div>
          <h3 style={{ fontSize: "1.5rem", marginBottom: "8px" }}>
            MoA for {info.name}
          </h3>
          <p
            style={{
              color: "var(--text-muted)",
              marginBottom: "24px",
              fontSize: "0.95rem",
            }}
          >
            {info.desc}
          </p>

          <div
            style={{
              display: "flex",
              gap: "12px",
              justifyContent: "center",
              flexWrap: "wrap",
              marginBottom: "16px",
            }}
          >
            {info.downloadUrl && (
              <a
                href={info.downloadUrl}
                className="btn btn-primary"
                onClick={() => setDownloaded(true)}
                style={{ fontSize: "1.1rem", padding: "14px 32px" }}
              >
                설치하기
              </a>
            )}
            {info.storeUrl && (
              <a
                href={info.storeUrl}
                className="btn btn-primary"
                target="_blank"
                rel="noopener noreferrer"
                style={{ fontSize: "1.1rem", padding: "14px 32px" }}
              >
                {selected === "ios" ? "App Store" : "Google Play"}에서 받기
              </a>
            )}
          </div>

          {/* Post-download instruction */}
          {downloaded && POST_DOWNLOAD_MSG[selected] && (
            <p
              style={{
                color: "var(--success)",
                fontWeight: 600,
                fontSize: "0.95rem",
                marginBottom: "16px",
              }}
            >
              {POST_DOWNLOAD_MSG[selected]}
            </p>
          )}

          {/* Terminal command as secondary option */}
          {info.installCmd && (
            <details style={{ marginTop: "8px" }}>
              <summary
                style={{
                  cursor: "pointer",
                  color: "var(--text-muted)",
                  fontSize: "0.85rem",
                }}
              >
                고급: 터미널 명령어로 설치
              </summary>
              <div
                style={{
                  background: "var(--bg)",
                  borderRadius: "var(--radius)",
                  padding: "16px 20px",
                  marginTop: "12px",
                  fontFamily: "monospace",
                  fontSize: "0.85rem",
                  color: "var(--success)",
                  overflowX: "auto",
                  textAlign: "left",
                  border: "1px solid var(--border)",
                  position: "relative",
                }}
              >
                <code>{info.installCmd}</code>
                <button
                  className="btn btn-outline"
                  style={{
                    position: "absolute",
                    right: "8px",
                    top: "50%",
                    transform: "translateY(-50%)",
                    padding: "4px 12px",
                    fontSize: "0.75rem",
                  }}
                  onClick={() => {
                    navigator.clipboard.writeText(info.installCmd!);
                  }}
                >
                  복사
                </button>
              </div>
            </details>
          )}
        </div>
      </div>
    </section>
  );
}
