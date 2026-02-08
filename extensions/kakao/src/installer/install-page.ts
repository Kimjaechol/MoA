/**
 * 웹 설치 페이지 생성기
 *
 * 플랫폼 자동 감지 및 원클릭 설치 제공
 */

import type { IncomingMessage, ServerResponse } from "node:http";
import {
  DEFAULT_INSTALLER_CONFIG,
  detectPlatform,
  getInstallerForPlatform,
  PLATFORM_INSTALLERS,
} from "./install-config.js";
import { getInstallScript, getOneClickInstaller } from "./install-scripts.js";

/**
 * 설치 페이지 HTML 생성
 */
/** Sanitize a string for safe HTML insertion (prevent XSS) */
function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function generateInstallPage(userAgent: string, pairingCode?: string): string {
  const detectedPlatform = detectPlatform(userAgent);
  const primaryInstaller = detectedPlatform ? getInstallerForPlatform(detectedPlatform) : null;
  // Sanitize pairing code — must be digits only, max 6 chars
  const safePairingCode = pairingCode
    ? escapeHtml(pairingCode.replace(/[^0-9]/g, "").slice(0, 6))
    : undefined;

  const html = `<!DOCTYPE html>
<html lang="ko">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>MoA 설치 - AI 어시스턴트</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 20px;
    }
    .container {
      background: white;
      border-radius: 20px;
      padding: 40px;
      max-width: 500px;
      width: 100%;
      box-shadow: 0 20px 60px rgba(0,0,0,0.3);
    }
    .logo {
      text-align: center;
      margin-bottom: 30px;
    }
    .logo h1 {
      font-size: 48px;
      margin-bottom: 10px;
    }
    .logo p {
      color: #666;
      font-size: 16px;
    }
    .version {
      background: #e8f5e9;
      color: #2e7d32;
      padding: 4px 12px;
      border-radius: 20px;
      font-size: 12px;
      display: inline-block;
      margin-top: 10px;
    }
    .primary-install {
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      color: white;
      border: none;
      padding: 20px 40px;
      border-radius: 12px;
      font-size: 18px;
      font-weight: bold;
      cursor: pointer;
      width: 100%;
      margin-bottom: 20px;
      transition: transform 0.2s, box-shadow 0.2s;
    }
    .primary-install:hover {
      transform: translateY(-2px);
      box-shadow: 0 10px 30px rgba(102, 126, 234, 0.4);
    }
    .primary-install .icon { font-size: 24px; margin-right: 10px; }
    .primary-install .platform { font-size: 14px; opacity: 0.9; }
    .command-box {
      background: #1a1a2e;
      color: #00ff88;
      padding: 15px;
      border-radius: 8px;
      font-family: 'Monaco', 'Menlo', monospace;
      font-size: 14px;
      margin-bottom: 20px;
      position: relative;
      overflow-x: auto;
    }
    .command-box code { white-space: nowrap; }
    .copy-btn {
      position: absolute;
      right: 10px;
      top: 50%;
      transform: translateY(-50%);
      background: #333;
      color: white;
      border: none;
      padding: 5px 10px;
      border-radius: 4px;
      cursor: pointer;
      font-size: 12px;
    }
    .copy-btn:hover { background: #555; }
    .other-platforms {
      margin-top: 30px;
      padding-top: 20px;
      border-top: 1px solid #eee;
    }
    .other-platforms h3 {
      font-size: 14px;
      color: #666;
      margin-bottom: 15px;
    }
    .platform-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(80px, 1fr));
      gap: 10px;
    }
    .platform-btn {
      background: #f5f5f5;
      border: 2px solid transparent;
      padding: 15px 10px;
      border-radius: 10px;
      cursor: pointer;
      text-align: center;
      transition: all 0.2s;
    }
    .platform-btn:hover {
      border-color: #667eea;
      background: #f0f0ff;
    }
    .platform-btn.active {
      border-color: #667eea;
      background: #e8e8ff;
    }
    .platform-btn .icon { font-size: 28px; display: block; margin-bottom: 5px; }
    .platform-btn .name { font-size: 12px; color: #333; }
    .pairing-section {
      background: #fff3e0;
      border: 2px solid #ff9800;
      border-radius: 12px;
      padding: 20px;
      margin-bottom: 20px;
      text-align: center;
    }
    .pairing-code {
      font-size: 32px;
      font-weight: bold;
      letter-spacing: 8px;
      color: #e65100;
      font-family: monospace;
    }
    .pairing-section p {
      color: #666;
      font-size: 14px;
      margin-top: 10px;
    }
    .features {
      margin-top: 30px;
      padding: 20px;
      background: #f8f9fa;
      border-radius: 12px;
    }
    .features h3 { margin-bottom: 15px; font-size: 16px; }
    .feature-item {
      display: flex;
      align-items: center;
      margin-bottom: 10px;
      font-size: 14px;
    }
    .feature-item .check {
      color: #4caf50;
      margin-right: 10px;
      font-size: 18px;
    }
    @media (max-width: 480px) {
      .container { padding: 25px; }
      .logo h1 { font-size: 36px; }
      .primary-install { padding: 15px 20px; font-size: 16px; }
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="logo">
      <h1>🤖 MoA</h1>
      <p>Master of AI - 쌍둥이 AI 어시스턴트</p>
      <span class="version">${DEFAULT_INSTALLER_CONFIG.version}</span>
    </div>

    ${
      safePairingCode
        ? `
    <div class="pairing-section">
      <div class="pairing-code">${safePairingCode}</div>
      <p>설치 후 이 코드로 연결하세요 (10분간 유효)</p>
    </div>
    `
        : ""
    }

    ${
      primaryInstaller
        ? `
    <button class="primary-install" onclick="install('${primaryInstaller.platform}')">
      <span class="icon">${primaryInstaller.icon}</span>
      ${primaryInstaller.displayName}에 설치하기
      <div class="platform">${primaryInstaller.description}</div>
    </button>

    <p id="post-download-msg" style="display:none; text-align:center; color:#4caf50; font-weight:600; margin-bottom:16px;">
      ✅ 다운로드가 시작되었습니다! 다운로드된 파일을 실행해주세요.
    </p>

    ${
      primaryInstaller.installCommand
        ? `
    <details style="margin-bottom:20px;">
      <summary style="cursor:pointer; color:#999; font-size:13px; text-align:center;">
        고급: 터미널 명령어로 설치
      </summary>
      <div class="command-box" style="margin-top:10px;">
        <code id="install-cmd">${primaryInstaller.installCommand}</code>
        <button class="copy-btn" onclick="copyCommand()">복사</button>
      </div>
    </details>
    `
        : ""
    }
    `
        : `
    <p style="text-align: center; color: #666; margin-bottom: 20px;">
      아래에서 플랫폼을 선택하세요
    </p>
    `
    }

    <div class="other-platforms">
      <h3>다른 플랫폼</h3>
      <div class="platform-grid">
        ${PLATFORM_INSTALLERS.map(
          (p) => `
        <button class="platform-btn ${p.platform === detectedPlatform ? "active" : ""}"
                onclick="selectPlatform('${p.platform}')">
          <span class="icon">${p.icon}</span>
          <span class="name">${p.displayName}</span>
        </button>
        `,
        ).join("")}
      </div>
    </div>

    <div class="features">
      <h3>✨ MoA로 할 수 있는 것</h3>
      <div class="feature-item"><span class="check">✓</span> 카카오톡으로 원격 PC 제어</div>
      <div class="feature-item"><span class="check">✓</span> 여러 기기 동시 명령</div>
      <div class="feature-item"><span class="check">✓</span> AI 기억 자동 동기화</div>
      <div class="feature-item"><span class="check">✓</span> 안전한 암호화 통신</div>
    </div>
  </div>

  <script>
    const installers = ${JSON.stringify(PLATFORM_INSTALLERS)};
    const pairingCode = ${safePairingCode ? `"${safePairingCode}"` : "null"};

    function install(platform) {
      const installer = installers.find(p => p.platform === platform);
      if (!installer) return;

      if (installer.appStoreUrl) {
        window.location.href = installer.appStoreUrl;
      } else if (installer.downloadUrl) {
        // Trigger one-click installer download
        var url = installer.downloadUrl + (pairingCode ? '?code=' + pairingCode : '');
        window.location.href = url;
        // Show post-download message
        var msg = document.getElementById('post-download-msg');
        if (msg) { msg.style.display = 'block'; }
      } else if (installer.installCommand) {
        copyCommand();
      }
    }

    function selectPlatform(platform) {
      const installer = installers.find(p => p.platform === platform);
      if (!installer) return;

      // 모든 버튼 비활성화
      document.querySelectorAll('.platform-btn').forEach(btn => btn.classList.remove('active'));
      // 선택한 버튼 활성화
      event.target.closest('.platform-btn').classList.add('active');

      // 설치 방법 표시
      install(platform);
    }

    function copyCommand() {
      const cmd = document.getElementById('install-cmd');
      if (!cmd) return;
      navigator.clipboard.writeText(cmd.textContent).then(() => {
        const btn = document.querySelector('.copy-btn');
        btn.textContent = '복사됨!';
        setTimeout(() => btn.textContent = '복사', 2000);
      });
    }
  </script>
</body>
</html>`;

  return html;
}

/**
 * 설치 요청 핸들러
 */
/**
 * Serve install scripts (/install.sh, /install.ps1) and the install HTML page (/install)
 */
export function handleInstallRequest(req: IncomingMessage, res: ServerResponse): boolean {
  const url = new URL(req.url ?? "/", `http://${req.headers.host}`);

  // Serve macOS/Linux install script at /install.sh
  if (url.pathname === "/install.sh") {
    const hostHeader = Array.isArray(req.headers.host) ? req.headers.host[0] : req.headers.host;
    const script = getInstallScript("unix", hostHeader);
    res.writeHead(200, {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "public, max-age=300",
    });
    res.end(script);
    return true;
  }

  // Serve Windows install script at /install.ps1
  if (url.pathname === "/install.ps1") {
    const hostHeader = Array.isArray(req.headers.host) ? req.headers.host[0] : req.headers.host;
    const script = getInstallScript("windows", hostHeader);
    res.writeHead(200, {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "public, max-age=300",
    });
    res.end(script);
    return true;
  }

  // One-click installer for Windows: /install.bat
  if (url.pathname === "/install.bat") {
    const hostHeader = Array.isArray(req.headers.host) ? req.headers.host[0] : req.headers.host;
    const bat = getOneClickInstaller("windows", hostHeader);
    res.writeHead(200, {
      "Content-Type": "application/octet-stream",
      "Content-Disposition": 'attachment; filename="MoA-Install.bat"',
      "Cache-Control": "no-cache",
    });
    res.end(bat);
    return true;
  }

  // One-click installer for macOS: /install.command
  if (url.pathname === "/install.command") {
    const hostHeader = Array.isArray(req.headers.host) ? req.headers.host[0] : req.headers.host;
    const cmd = getOneClickInstaller("macos", hostHeader);
    res.writeHead(200, {
      "Content-Type": "application/octet-stream",
      "Content-Disposition": 'attachment; filename="MoA-Install.command"',
      "Cache-Control": "no-cache",
    });
    res.end(cmd);
    return true;
  }

  // /install 경로만 처리
  if (!url.pathname.startsWith("/install")) {
    return false;
  }

  const userAgent = req.headers["user-agent"] ?? "";
  const pairingCode = url.searchParams.get("code") ?? undefined;

  const html = generateInstallPage(userAgent, pairingCode);

  res.writeHead(200, {
    "Content-Type": "text/html; charset=utf-8",
    "Cache-Control": "no-cache",
  });
  res.end(html);

  return true;
}
