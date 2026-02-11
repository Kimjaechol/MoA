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

    <div id="post-download-msg" style="display:none; text-align:left; background:#f0fdf4; border:1px solid #bbf7d0; border-radius:12px; padding:16px 20px; margin-bottom:16px;">
      <p style="color:#16a34a; font-weight:700; margin-bottom:8px;">✅ 다운로드가 시작되었습니다!</p>
      <p style="color:#333; font-size:14px; margin-bottom:4px;">1. 다운로드된 파일을 <b>더블클릭</b>하여 설치하세요.</p>
      <p style="color:#333; font-size:14px; margin-bottom:4px;">2. 설치 완료 후 자동으로 열리는 페이지에서 기기를 등록합니다.</p>
      <p style="color:#333; font-size:14px;">3. 카카오톡 MoA 채널에서 <b>"이 기기등록"</b>으로 받은 코드를 입력하면 연결 완료!</p>
    </div>

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
 * 설치 완료 후 로그인/회원가입 페이지
 *
 * 3단계 흐름:
 * 1. 로그인/회원가입 (아이디 + 비밀번호)
 * 2. 기기 등록 (기기 이름 확인 — 로그인 시만, 중복 자동 방지)
 * 3. 완료 (설정 파일 다운로드)
 *
 * 회원가입은 첫 기기이므로 1→3 바로 진행 (기기 이름 폼에 포함)
 */
function generateWelcomePage(): string {
  return `<!DOCTYPE html>
<html lang="ko">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>MoA - \uB85C\uADF8\uC778</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Malgun Gothic', sans-serif;
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
      max-width: 440px;
      width: 100%;
      box-shadow: 0 20px 60px rgba(0,0,0,0.3);
    }
    .header { text-align: center; margin-bottom: 32px; }
    .header .logo { font-size: 48px; }
    .header h1 { font-size: 24px; color: #1a1a2e; margin: 8px 0 4px; }
    .header .subtitle { color: #666; font-size: 14px; }
    .step-view { display: none; }
    .step-view.active { display: block; }
    .form-group { margin-bottom: 16px; }
    .form-group label {
      display: block; font-size: 13px; font-weight: 600; color: #555; margin-bottom: 6px;
    }
    .form-group input {
      width: 100%; padding: 12px 16px; border: 2px solid #e5e7eb;
      border-radius: 10px; font-size: 15px; outline: none; transition: border-color 0.2s;
    }
    .form-group input:focus {
      border-color: #667eea; box-shadow: 0 0 0 3px rgba(102,126,234,0.15);
    }
    .form-group input::placeholder { color: #aaa; }
    .submit-btn {
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      color: white; border: none; padding: 14px; border-radius: 12px;
      font-size: 16px; font-weight: 700; cursor: pointer; width: 100%; margin-top: 8px;
      transition: transform 0.2s, box-shadow 0.2s, opacity 0.2s;
    }
    .submit-btn:hover:not(:disabled) {
      transform: translateY(-2px); box-shadow: 0 8px 24px rgba(102,126,234,0.4);
    }
    .submit-btn:disabled { opacity: 0.5; cursor: not-allowed; }
    .status-msg { margin-top: 12px; font-size: 14px; text-align: center; min-height: 20px; }
    .status-msg.error { color: #dc2626; }
    .status-msg.loading { color: #667eea; }
    .status-msg.success { color: #16a34a; font-weight: 600; }
    .toggle-link { text-align: center; margin-top: 20px; font-size: 14px; color: #666; }
    .toggle-link a { color: #667eea; text-decoration: none; font-weight: 600; cursor: pointer; }
    .toggle-link a:hover { text-decoration: underline; }
    .existing-devices {
      background: #f8f9fa; border-radius: 10px; padding: 12px 16px;
      margin-bottom: 16px; font-size: 13px; color: #555;
    }
    .existing-devices b { color: #333; }
    .existing-devices .dev-list { margin-top: 6px; }
    .existing-devices .dev-item {
      display: inline-block; background: #e5e7eb; border-radius: 6px;
      padding: 3px 10px; margin: 3px 4px 3px 0; font-size: 12px; color: #333;
    }
    /* Success section */
    .success-section { text-align: center; }
    .success-section .icon { font-size: 56px; margin-bottom: 16px; }
    .success-section h2 { font-size: 20px; color: #16a34a; margin-bottom: 8px; }
    .success-section .detail {
      font-size: 14px; color: #555; margin-bottom: 20px; line-height: 1.7;
    }
    .success-section .device-info {
      background: #f0fdf4; border: 1px solid #bbf7d0; border-radius: 12px;
      padding: 16px; margin-bottom: 20px; text-align: left; font-size: 14px; color: #333;
    }
    .success-section .device-info .row {
      display: flex; justify-content: space-between; padding: 4px 0;
    }
    .success-section .device-info .row .label { color: #666; }
    .success-section .device-info .row .value { font-weight: 600; }
    .activate-btn {
      background: #22c55e; color: white; border: none; padding: 14px 32px;
      border-radius: 12px; font-size: 16px; font-weight: 700; cursor: pointer;
      width: 100%; transition: transform 0.2s;
    }
    .activate-btn:hover {
      transform: translateY(-2px); box-shadow: 0 8px 24px rgba(34,197,94,0.3);
    }
    .success-section .next-steps {
      background: #fffbeb; border: 1px solid #fde68a; border-radius: 12px;
      padding: 16px; margin-top: 20px; text-align: left; font-size: 13px;
      color: #78350f; line-height: 1.7;
    }
    .success-section .next-steps b { color: #92400e; }
    .footer { text-align: center; margin-top: 24px; color: #999; font-size: 12px; }
    .footer a { color: #667eea; text-decoration: none; }
    @media (max-width: 480px) {
      .container { padding: 28px 20px; }
      .header .logo { font-size: 40px; }
      .header h1 { font-size: 20px; }
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <div class="logo">&#x1F916;</div>
      <h1>MoA</h1>
      <p class="subtitle">Master of AI - AI \uC5B4\uC2DC\uC2A4\uD134\uD2B8</p>
    </div>

    <!-- Step 1a: Login Form (default) -->
    <div id="step-login" class="step-view active">
      <div class="form-group">
        <label for="login-username">\uC544\uC774\uB514</label>
        <input type="text" id="login-username" placeholder="\uC544\uC774\uB514\uB97C \uC785\uB825\uD558\uC138\uC694" autocomplete="username">
      </div>
      <div class="form-group">
        <label for="login-password">\uBE44\uBC00\uBC88\uD638</label>
        <input type="password" id="login-password" placeholder="\uBE44\uBC00\uBC88\uD638\uB97C \uC785\uB825\uD558\uC138\uC694" autocomplete="current-password">
      </div>
      <button class="submit-btn" id="login-btn" onclick="handleLogin()">\uB85C\uADF8\uC778</button>
      <div class="status-msg" id="login-status"></div>
      <div class="toggle-link">
        \uACC4\uC815\uC774 \uC5C6\uC73C\uC2E0\uAC00\uC694? <a onclick="showStep('step-signup')">\uD68C\uC6D0\uAC00\uC785</a>
      </div>
    </div>

    <!-- Step 1b: Signup Form -->
    <div id="step-signup" class="step-view">
      <div class="form-group">
        <label for="signup-username">\uC544\uC774\uB514</label>
        <input type="text" id="signup-username" placeholder="\uC0AC\uC6A9\uD560 \uC544\uC774\uB514 (2\uC790 \uC774\uC0C1)" autocomplete="username">
      </div>
      <div class="form-group">
        <label for="signup-password">\uBE44\uBC00\uBC88\uD638</label>
        <input type="password" id="signup-password" placeholder="\uBE44\uBC00\uBC88\uD638 (4\uC790 \uC774\uC0C1)" autocomplete="new-password">
      </div>
      <div class="form-group">
        <label for="signup-confirm">\uBE44\uBC00\uBC88\uD638 \uD655\uC778</label>
        <input type="password" id="signup-confirm" placeholder="\uBE44\uBC00\uBC88\uD638\uB97C \uB2E4\uC2DC \uC785\uB825\uD558\uC138\uC694" autocomplete="new-password">
      </div>
      <div class="form-group">
        <label for="signup-device">\uAE30\uAE30 \uC774\uB984</label>
        <input type="text" id="signup-device" placeholder="\uC774 \uAE30\uAE30\uC758 \uC774\uB984 (\uC608: \uB0B4 \uB178\uD2B8\uBD81)">
      </div>
      <button class="submit-btn" id="signup-btn" onclick="handleSignup()">\uD68C\uC6D0\uAC00\uC785</button>
      <div class="status-msg" id="signup-status"></div>
      <div class="toggle-link">
        \uC774\uBBF8 \uACC4\uC815\uC774 \uC788\uC73C\uC2E0\uAC00\uC694? <a onclick="showStep('step-login')">\uB85C\uADF8\uC778</a>
      </div>
    </div>

    <!-- Step 2: Device Registration (login only — shown after credential verify) -->
    <div id="step-device" class="step-view">
      <p style="font-size:15px; color:#333; margin-bottom:16px; text-align:center;">
        <b id="device-welcome-user"></b>\uB2D8, \uD658\uC601\uD569\uB2C8\uB2E4!<br>
        <span style="color:#666; font-size:13px;">\uC0C8 \uAE30\uAE30\uB97C \uB4F1\uB85D\uD574\uC8FC\uC138\uC694.</span>
      </p>
      <div id="existing-devices-box" class="existing-devices" style="display:none;">
        <b>\uAE30\uC874 \uB4F1\uB85D\uB41C \uAE30\uAE30:</b>
        <div class="dev-list" id="existing-dev-list"></div>
      </div>
      <div class="form-group">
        <label for="device-name">\uC0C8 \uAE30\uAE30 \uC774\uB984</label>
        <input type="text" id="device-name" placeholder="\uC774 \uAE30\uAE30\uC758 \uC774\uB984">
      </div>
      <button class="submit-btn" id="device-btn" onclick="handleDeviceRegister()">\uAE30\uAE30 \uB4F1\uB85D</button>
      <div class="status-msg" id="device-status"></div>
    </div>

    <!-- Step 3: Success -->
    <div id="step-success" class="step-view success-section">
      <div class="icon">&#x1F389;</div>
      <h2 id="success-title">\uAE30\uAE30 \uB4F1\uB85D \uC644\uB8CC!</h2>
      <div class="detail" id="success-detail">\uC774\uC81C \uCE74\uCE74\uC624\uD1A1\uC5D0\uC11C \uC774 \uCEF4\uD4E8\uD130\uB97C \uC81C\uC5B4\uD560 \uC218 \uC788\uC2B5\uB2C8\uB2E4.</div>
      <div class="device-info">
        <div class="row"><span class="label">\uAE30\uAE30 \uC774\uB984</span><span class="value" id="info-device"></span></div>
        <div class="row"><span class="label">\uD50C\uB7AB\uD3FC</span><span class="value" id="info-platform"></span></div>
        <div class="row"><span class="label">\uB4F1\uB85D \uC0C1\uD0DC</span><span class="value" id="info-status"></span></div>
      </div>
      <button class="activate-btn" onclick="downloadActivation()">\uC124\uC815 \uD30C\uC77C \uB2E4\uC6B4\uB85C\uB4DC</button>
      <div class="status-msg success" id="activate-status" style="margin-top:12px;"></div>
      <div class="next-steps">
        <b>\uB2E4\uC74C \uB2E8\uACC4:</b><br>
        1. \uB2E4\uC6B4\uB85C\uB4DC\uB41C \uD30C\uC77C\uC744 <b>\uB354\uBE14\uD074\uB9AD</b>\uD558\uC5EC \uC124\uC815\uC744 \uC644\uB8CC\uD558\uC138\uC694.<br>
        2. <b>\uCE74\uCE74\uC624\uD1A1</b>\uC5D0\uC11C MoA \uCC44\uB110\uC744 \uC5F4\uACE0 "\uC0AC\uC6A9\uC790 \uC778\uC99D" \uBC84\uD2BC\uC744 \uB20C\uB7EC\uC8FC\uC138\uC694.<br>
        3. \uAC00\uC785\uC2DC \uC124\uC815\uD55C \uC544\uC774\uB514\uC640 \uBE44\uBC00\uBC88\uD638\uB85C \uB85C\uADF8\uC778\uD558\uBA74 \uC778\uC99D \uC644\uB8CC!<br>
        4. \uAD6C\uBB38\uBC88\uD638 \uC124\uC815 \uAD8C\uC7A5 \u2014 \uAE30\uAE30 \uC81C\uC5B4 \uC2DC \uBCF8\uC778 \uC7AC\uD655\uC778\uC73C\uB85C \uBCF4\uC548\uC774 \uAC15\uD654\uB429\uB2C8\uB2E4.<br>
        5. <a href="/backup" style="color:#667eea; font-weight:600;">\uBC31\uC5C5 \uC124\uC815</a> \u2014 AI \uAE30\uC5B5\uC744 \uC554\uD638\uD654 \uBC31\uC5C5\uD558\uACE0 12\uB2E8\uC5B4 \uBCF5\uAD6C\uD0A4\uB97C \uBC1C\uAE09\uBC1B\uC73C\uC138\uC694.
      </div>
      <div style="margin-top:16px; display:flex; gap:10px;">
        <a href="https://pf.kakao.com/moa-ai" target="_blank" rel="noopener noreferrer"
           style="flex:1; display:block; text-align:center; padding:12px; background:#FEE500; color:#3C1E1E; border-radius:10px; font-weight:700; text-decoration:none; font-size:14px;">
          \uCE74\uCE74\uC624\uD1A1\uC73C\uB85C \uC774\uB3D9
        </a>
        <button onclick="resetWelcome()"
                style="flex:1; padding:12px; background:#f1f5f9; color:#475569; border:none; border-radius:10px; font-weight:600; cursor:pointer; font-size:14px;">
          \uC0C8\uB85C \uC2DC\uC791\uD558\uAE30
        </button>
      </div>
    </div>

    <div class="footer">
      <a href="https://mymoa.app">mymoa.app</a> &middot; Master of AI
    </div>
  </div>

  <script>
    // ── Platform detection ──
    var isWindows = navigator.userAgent.indexOf('Win') !== -1;
    var isMac = navigator.userAgent.indexOf('Mac') !== -1;
    var isAndroid = navigator.userAgent.indexOf('Android') !== -1;
    var isiOS = /iPhone|iPad|iPod/.test(navigator.userAgent);

    var detectedPlatform = 'Linux';
    var detectedType = 'desktop';
    if (isWindows) { detectedPlatform = 'Windows'; detectedType = 'desktop'; }
    else if (isMac) { detectedPlatform = 'macOS'; detectedType = 'laptop'; }
    else if (isAndroid) { detectedPlatform = 'Android'; detectedType = 'mobile'; }
    else if (isiOS) { detectedPlatform = 'iOS'; detectedType = 'mobile'; }

    var baseDeviceName = detectedPlatform === 'Windows' ? 'My Windows PC'
      : detectedPlatform === 'macOS' ? 'My Mac'
      : detectedPlatform === 'Android' ? 'My Android'
      : detectedPlatform === 'iOS' ? 'My iPhone'
      : 'My Linux PC';

    // Set default device name for signup form
    document.getElementById('signup-device').value = baseDeviceName;
    document.getElementById('login-username').focus();

    // ── State (with persistence to survive page refresh) ──
    var authResult = null;
    var loginCredentials = null; // { username, password } saved after step 1

    // Restore previous auth state from sessionStorage (prevents login loop)
    try {
      var savedAuth = sessionStorage.getItem('moa_auth_result');
      var savedCreds = sessionStorage.getItem('moa_login_creds');
      if (savedAuth) authResult = JSON.parse(savedAuth);
      if (savedCreds) loginCredentials = JSON.parse(savedCreds);
    } catch(e) {}

    function saveAuthState() {
      try {
        if (authResult) sessionStorage.setItem('moa_auth_result', JSON.stringify(authResult));
        if (loginCredentials) sessionStorage.setItem('moa_login_creds', JSON.stringify(loginCredentials));
      } catch(e) {}
    }

    // ── Step navigation ──
    function showStep(stepId) {
      var views = document.querySelectorAll('.step-view');
      for (var i = 0; i < views.length; i++) views[i].classList.remove('active');
      document.getElementById(stepId).classList.add('active');
      // Focus first input in new step
      var firstInput = document.getElementById(stepId).querySelector('input');
      if (firstInput) firstInput.focus();
    }

    // ── Device name de-duplication ──
    function getUniqueDeviceName(existingDevices) {
      if (!existingDevices || existingDevices.length === 0) return baseDeviceName;
      var names = existingDevices.map(function(n) { return n.toLowerCase(); });
      if (names.indexOf(baseDeviceName.toLowerCase()) === -1) return baseDeviceName;
      var i = 2;
      while (names.indexOf((baseDeviceName + ' ' + i).toLowerCase()) !== -1) { i++; }
      return baseDeviceName + ' ' + i;
    }

    // ── Step 1a: Login ──
    function handleLogin() {
      var username = document.getElementById('login-username').value.trim();
      var password = document.getElementById('login-password').value;
      var status = document.getElementById('login-status');
      var btn = document.getElementById('login-btn');

      if (!username || !password) {
        status.className = 'status-msg error';
        status.textContent = '\\uC544\\uC774\\uB514\\uC640 \\uBE44\\uBC00\\uBC88\\uD638\\uB97C \\uC785\\uB825\\uD574\\uC8FC\\uC138\\uC694.';
        return;
      }

      status.className = 'status-msg loading';
      status.textContent = '\\uB85C\\uADF8\\uC778 \\uC911...';
      btn.disabled = true;

      // Step 1: verify credentials only (no device)
      fetch('/api/relay/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: username, password: password })
      })
      .then(function(r) { return r.json(); })
      .then(function(data) {
        if (data.success) {
          loginCredentials = { username: username, password: password };
          saveAuthState();
          // Show device registration step with de-duplicated name
          var existing = data.existingDevices || [];
          document.getElementById('device-welcome-user').textContent = username;
          document.getElementById('device-name').value = getUniqueDeviceName(existing);
          // Show existing devices list
          if (existing.length > 0) {
            var box = document.getElementById('existing-devices-box');
            var list = document.getElementById('existing-dev-list');
            list.innerHTML = '';
            for (var i = 0; i < existing.length; i++) {
              var span = document.createElement('span');
              span.className = 'dev-item';
              span.textContent = existing[i];
              list.appendChild(span);
            }
            box.style.display = 'block';
          }
          showStep('step-device');
        } else {
          status.className = 'status-msg error';
          status.textContent = data.error || '\\uB85C\\uADF8\\uC778\\uC5D0 \\uC2E4\\uD328\\uD588\\uC2B5\\uB2C8\\uB2E4.';
          btn.disabled = false;
        }
      })
      .catch(function() {
        status.className = 'status-msg error';
        status.textContent = '\\uC11C\\uBC84\\uC5D0 \\uC5F0\\uACB0\\uD560 \\uC218 \\uC5C6\\uC2B5\\uB2C8\\uB2E4.';
        btn.disabled = false;
      });
    }

    // ── Step 2: Device registration (login flow only) ──
    function handleDeviceRegister() {
      if (!loginCredentials) return;
      var deviceName = document.getElementById('device-name').value.trim() || baseDeviceName;
      var status = document.getElementById('device-status');
      var btn = document.getElementById('device-btn');

      status.className = 'status-msg loading';
      status.textContent = '\\uAE30\\uAE30 \\uB4F1\\uB85D \\uC911...';
      btn.disabled = true;

      fetch('/api/relay/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username: loginCredentials.username,
          password: loginCredentials.password,
          device: { deviceName: deviceName, deviceType: detectedType, platform: detectedPlatform }
        })
      })
      .then(function(r) { return r.json(); })
      .then(function(data) {
        if (data.success) {
          authResult = {
            deviceToken: data.deviceToken,
            deviceName: deviceName,
            platform: detectedPlatform,
            username: loginCredentials.username,
            registeredAt: new Date().toISOString()
          };
          saveAuthState();
          document.getElementById('success-title').textContent =
            data.isNewDevice !== false ? '\\uAE30\\uAE30 \\uB4F1\\uB85D \\uC644\\uB8CC!' : '\\uB85C\\uADF8\\uC778 \\uC131\\uACF5!';
          document.getElementById('success-detail').textContent =
            data.isNewDevice !== false
              ? '\\uC0C8 \\uAE30\\uAE30\\uAC00 \\uB4F1\\uB85D\\uB418\\uC5C8\\uC2B5\\uB2C8\\uB2E4. \\uC544\\uB798 \\uC124\\uC815 \\uD30C\\uC77C\\uC744 \\uB2E4\\uC6B4\\uB85C\\uB4DC\\uD574\\uC8FC\\uC138\\uC694.'
              : '\\uAE30\\uC874 \\uAE30\\uAE30\\uB85C \\uB85C\\uADF8\\uC778\\uB418\\uC5C8\\uC2B5\\uB2C8\\uB2E4.';
          document.getElementById('info-device').textContent = deviceName;
          document.getElementById('info-platform').textContent = detectedPlatform;
          document.getElementById('info-status').textContent =
            data.isNewDevice !== false ? '\\uC2E0\\uADDC \\uB4F1\\uB85D' : '\\uAE30\\uC874 \\uAE30\\uAE30';
          showStep('step-success');
          downloadActivation();
        } else {
          status.className = 'status-msg error';
          status.textContent = data.error || '\\uAE30\\uAE30 \\uB4F1\\uB85D\\uC5D0 \\uC2E4\\uD328\\uD588\\uC2B5\\uB2C8\\uB2E4.';
          btn.disabled = false;
        }
      })
      .catch(function() {
        status.className = 'status-msg error';
        status.textContent = '\\uC11C\\uBC84\\uC5D0 \\uC5F0\\uACB0\\uD560 \\uC218 \\uC5C6\\uC2B5\\uB2C8\\uB2E4.';
        btn.disabled = false;
      });
    }

    // ── Step 1b: Signup (includes device in one step) ──
    function handleSignup() {
      var username = document.getElementById('signup-username').value.trim();
      var password = document.getElementById('signup-password').value;
      var confirm = document.getElementById('signup-confirm').value;
      var status = document.getElementById('signup-status');
      var btn = document.getElementById('signup-btn');
      var deviceName = document.getElementById('signup-device').value.trim() || baseDeviceName;

      if (!username || !password) {
        status.className = 'status-msg error';
        status.textContent = '\\uC544\\uC774\\uB514\\uC640 \\uBE44\\uBC00\\uBC88\\uD638\\uB97C \\uC785\\uB825\\uD574\\uC8FC\\uC138\\uC694.';
        return;
      }
      if (password !== confirm) {
        status.className = 'status-msg error';
        status.textContent = '\\uBE44\\uBC00\\uBC88\\uD638\\uAC00 \\uC77C\\uCE58\\uD558\\uC9C0 \\uC54A\\uC2B5\\uB2C8\\uB2E4.';
        return;
      }

      status.className = 'status-msg loading';
      status.textContent = '\\uD68C\\uC6D0\\uAC00\\uC785 \\uC911...';
      btn.disabled = true;

      fetch('/api/relay/auth/signup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username: username, password: password,
          device: { deviceName: deviceName, deviceType: detectedType, platform: detectedPlatform }
        })
      })
      .then(function(r) { return r.json(); })
      .then(function(data) {
        if (data.success) {
          authResult = {
            deviceToken: data.deviceToken,
            deviceName: deviceName,
            platform: detectedPlatform,
            username: username,
            registeredAt: new Date().toISOString()
          };
          loginCredentials = { username: username, password: password };
          saveAuthState();
          document.getElementById('success-title').textContent = '\\uD68C\\uC6D0\\uAC00\\uC785 \\uC644\\uB8CC!';
          document.getElementById('success-detail').textContent =
            '\\uACC4\\uC815\\uC774 \\uC0DD\\uC131\\uB418\\uACE0 \\uAE30\\uAE30\\uAC00 \\uB4F1\\uB85D\\uB418\\uC5C8\\uC2B5\\uB2C8\\uB2E4.';
          document.getElementById('info-device').textContent = deviceName;
          document.getElementById('info-platform').textContent = detectedPlatform;
          document.getElementById('info-status').textContent = '\\uC2E0\\uADDC \\uB4F1\\uB85D';
          showStep('step-success');
          downloadActivation();
        } else {
          status.className = 'status-msg error';
          status.textContent = data.error || '\\uD68C\\uC6D0\\uAC00\\uC785\\uC5D0 \\uC2E4\\uD328\\uD588\\uC2B5\\uB2C8\\uB2E4.';
          btn.disabled = false;
        }
      })
      .catch(function() {
        status.className = 'status-msg error';
        status.textContent = '\\uC11C\\uBC84\\uC5D0 \\uC5F0\\uACB0\\uD560 \\uC218 \\uC5C6\\uC2B5\\uB2C8\\uB2E4.';
        btn.disabled = false;
      });
    }

    // ── Enter key support ──
    document.getElementById('login-password').addEventListener('keydown', function(e) {
      if (e.key === 'Enter') handleLogin();
    });
    document.getElementById('signup-confirm').addEventListener('keydown', function(e) {
      if (e.key === 'Enter') handleSignup();
    });
    document.getElementById('device-name').addEventListener('keydown', function(e) {
      if (e.key === 'Enter') handleDeviceRegister();
    });

    // ── Auto-restore on page refresh (prevents login loop) ──
    if (authResult && authResult.deviceToken) {
      // Already registered — skip straight to success/complete view
      document.getElementById('info-device').textContent = authResult.deviceName || '';
      document.getElementById('info-platform').textContent = authResult.platform || detectedPlatform;
      document.getElementById('info-status').textContent = '\\uB4F1\\uB85D \\uC644\\uB8CC';
      document.getElementById('success-title').textContent = '\\uC124\\uC815 \\uC644\\uB8CC!';
      document.getElementById('success-detail').textContent =
        '\\uC774\\uBBF8 \\uAE30\\uAE30\\uAC00 \\uB4F1\\uB85D\\uB418\\uC5C8\\uC2B5\\uB2C8\\uB2E4. \\uC544\\uB798 \\uB2E8\\uACC4\\uB97C \\uB530\\uB77C\\uC8FC\\uC138\\uC694.';
      showStep('step-success');
      // Show helpful status
      var actStatus = document.getElementById('activate-status');
      if (actStatus) {
        actStatus.textContent = '\\uC124\\uC815 \\uD30C\\uC77C\\uC774 \\uC774\\uBBF8 \\uB2E4\\uC6B4\\uB85C\\uB4DC\\uB418\\uC5C8\\uC2B5\\uB2C8\\uB2E4. \\uD30C\\uC77C\\uC744 \\uC2E4\\uD589\\uD588\\uB2E4\\uBA74 \\uCE74\\uCE74\\uC624\\uD1A1\\uC73C\\uB85C \\uC774\\uB3D9\\uD558\\uC138\\uC694.';
      }
    }

    // ── Activation file download ──
    function downloadActivation() {
      if (!authResult || !authResult.deviceToken) return;
      var config = JSON.stringify(authResult);
      var filename, content, mimeType;

      if (isWindows) {
        filename = 'MoA-Activate.bat';
        mimeType = 'application/octet-stream';
        var batConfig = config.replace(/%/g, '%%');
        content = '@echo off\\r\\n'
          + 'chcp 65001 >nul 2>&1\\r\\n'
          + 'set "CONFIG_DIR=%APPDATA%\\\\MoA"\\r\\n'
          + 'if not exist "%CONFIG_DIR%" mkdir "%CONFIG_DIR%"\\r\\n'
          + '(echo ' + batConfig + ')>"%CONFIG_DIR%\\\\device.json"\\r\\n'
          + 'echo.\\r\\n'
          + 'echo   MoA \\uAE30\\uAE30 \\uC5F0\\uACB0\\uC774 \\uC644\\uB8CC\\uB418\\uC5C8\\uC2B5\\uB2C8\\uB2E4!\\r\\n'
          + 'echo   \\uC774\\uC81C \\uCE74\\uCE74\\uC624\\uD1A1 MoA \\uCC44\\uB110\\uC5D0\\uC11C \\uBA85\\uB839\\uC744 \\uBCF4\\uB0B4\\uBCF4\\uC138\\uC694.\\r\\n'
          + 'echo.\\r\\n'
          + 'timeout /t 5 >nul\\r\\n';
      } else {
        filename = isMac ? 'MoA-Activate.command' : 'MoA-Activate.sh';
        mimeType = 'application/octet-stream';
        content = '#!/bin/bash\\n'
          + 'CONFIG_DIR="$HOME/.config/moa"\\n'
          + 'mkdir -p "$CONFIG_DIR"\\n'
          + "cat > \\"$CONFIG_DIR/device.json\\" << 'MOAEOF'\\n"
          + config + '\\n'
          + 'MOAEOF\\n'
          + 'chmod 600 "$CONFIG_DIR/device.json"\\n'
          + 'echo ""\\n'
          + 'echo "  MoA \\uAE30\\uAE30 \\uC5F0\\uACB0\\uC774 \\uC644\\uB8CC\\uB418\\uC5C8\\uC2B5\\uB2C8\\uB2E4!"\\n'
          + 'echo "  \\uC774\\uC81C \\uCE74\\uCE74\\uC624\\uD1A1 MoA \\uCC44\\uB110\\uC5D0\\uC11C \\uBA85\\uB839\\uC744 \\uBCF4\\uB0B4\\uBCF4\\uC138\\uC694."\\n'
          + 'echo ""\\n'
          + 'sleep 3\\n';
      }

      var blob = new Blob([content], { type: mimeType });
      var url = URL.createObjectURL(blob);
      var a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      var actStatus = document.getElementById('activate-status');
      if (actStatus) {
        actStatus.textContent = '\\uB2E4\\uC6B4\\uB85C\\uB4DC\\uB41C ' + filename + ' \\uD30C\\uC77C\\uC744 \\uB354\\uBE14\\uD074\\uB9AD\\uD558\\uBA74 \\uC124\\uC815\\uC774 \\uC644\\uB8CC\\uB429\\uB2C8\\uB2E4!';
      }
    }

    // ── Reset (clear saved state and start fresh) ──
    function resetWelcome() {
      try {
        sessionStorage.removeItem('moa_auth_result');
        sessionStorage.removeItem('moa_login_creds');
      } catch(e) {}
      authResult = null;
      loginCredentials = null;
      showStep('step-login');
    }
  </script>
</body>
</html>`;
}

/**
 * 백업 & 복원 페이지
 *
 * ## 개념 (톡서랍/톡클라우드와 동일)
 * - 백업 비밀번호: 서버 백업 시 암호화에 사용하는 별도 비밀번호 (로그인 비밀번호와 분리)
 * - 복구키(12단어): 백업 비밀번호 분실 시 비밀번호를 재설정하는 니모닉
 *
 * ## 흐름
 * [백업 탭]
 *   첫 백업: 로그인 → 백업 비밀번호 설정 → 복구키 12단어 표시 → 완료
 *   이후 백업: 로그인 → 백업 비밀번호 입력 → 완료
 *
 * [복원 탭]
 *   로그인 → 백업 비밀번호 입력 → 복원 완료
 *
 * [비밀번호 찾기]
 *   로그인 → 12단어 복구키 입력 → 새 비밀번호 설정 → 완료
 */
function generateBackupPage(): string {
  return `<!DOCTYPE html>
<html lang="ko">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>MoA - 백업 & 복원</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Malgun Gothic', sans-serif;
      background: linear-gradient(135deg, #1e3a5f 0%, #2d1b69 100%);
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
      max-width: 480px;
      width: 100%;
      box-shadow: 0 20px 60px rgba(0,0,0,0.3);
    }
    .header { text-align: center; margin-bottom: 24px; }
    .header .icon { font-size: 48px; }
    .header h1 { font-size: 22px; color: #1a1a2e; margin: 8px 0 4px; }
    .header .subtitle { color: #666; font-size: 14px; line-height: 1.6; }
    /* Tab bar */
    .tab-bar {
      display: flex; gap: 4px; margin-bottom: 24px;
      background: #f1f5f9; border-radius: 12px; padding: 4px;
    }
    .tab-btn {
      flex: 1; padding: 10px 8px; border: none; border-radius: 10px;
      font-size: 14px; font-weight: 600; cursor: pointer;
      background: transparent; color: #64748b; transition: all 0.2s;
    }
    .tab-btn.active { background: white; color: #1e3a5f; box-shadow: 0 2px 8px rgba(0,0,0,0.08); }
    .tab-btn:hover:not(.active) { color: #334155; }
    .step-view { display: none; }
    .step-view.active { display: block; }
    .form-group { margin-bottom: 16px; }
    .form-group label {
      display: block; font-size: 13px; font-weight: 600; color: #555; margin-bottom: 6px;
    }
    .form-group input, .form-group textarea {
      width: 100%; padding: 12px 16px; border: 2px solid #e5e7eb;
      border-radius: 10px; font-size: 15px; outline: none; transition: border-color 0.2s;
      font-family: inherit;
    }
    .form-group input:focus, .form-group textarea:focus {
      border-color: #1e3a5f; box-shadow: 0 0 0 3px rgba(30,58,95,0.15);
    }
    .form-group input::placeholder { color: #aaa; }
    .submit-btn {
      background: linear-gradient(135deg, #1e3a5f 0%, #2d1b69 100%);
      color: white; border: none; padding: 14px; border-radius: 12px;
      font-size: 16px; font-weight: 700; cursor: pointer; width: 100%; margin-top: 8px;
      transition: transform 0.2s, box-shadow 0.2s, opacity 0.2s;
    }
    .submit-btn:hover:not(:disabled) {
      transform: translateY(-2px); box-shadow: 0 8px 24px rgba(30,58,95,0.4);
    }
    .submit-btn:disabled { opacity: 0.5; cursor: not-allowed; }
    .status-msg { margin-top: 12px; font-size: 14px; text-align: center; min-height: 20px; }
    .status-msg.error { color: #dc2626; }
    .status-msg.loading { color: #1e3a5f; }
    .status-msg.success { color: #16a34a; font-weight: 600; }
    .info-box {
      background: #f0f4ff; border: 1px solid #c7d2fe; border-radius: 12px;
      padding: 16px; margin-bottom: 20px; font-size: 13px; color: #3730a3; line-height: 1.7;
    }
    .info-box b { color: #1e1b4b; }
    .link-btn {
      background: none; border: none; color: #667eea; font-size: 13px;
      cursor: pointer; text-decoration: underline; padding: 0; margin-top: 8px;
    }
    /* Recovery key grid */
    .recovery-section { text-align: center; }
    .recovery-section h2 { font-size: 20px; color: #1e3a5f; margin-bottom: 8px; }
    .recovery-section .desc {
      font-size: 14px; color: #555; margin-bottom: 20px; line-height: 1.6;
    }
    .word-grid {
      display: grid; grid-template-columns: 1fr 1fr; gap: 8px; margin-bottom: 20px;
    }
    .word-card {
      background: #f8fafc; border: 2px solid #e2e8f0; border-radius: 10px;
      padding: 10px 12px; text-align: left; font-size: 15px; color: #1e293b;
    }
    .word-card .num { font-size: 11px; color: #94a3b8; font-weight: 700; margin-right: 6px; }
    .word-card .word { font-weight: 600; font-family: 'Monaco', 'Menlo', monospace; }
    .warning-box {
      background: #fef3c7; border: 2px solid #f59e0b; border-radius: 12px;
      padding: 16px; margin-bottom: 20px; font-size: 13px; color: #92400e;
      line-height: 1.7; text-align: left;
    }
    .warning-box b { color: #78350f; }
    .confirm-check {
      display: flex; align-items: center; gap: 10px; margin: 16px 0;
      font-size: 14px; color: #333; cursor: pointer;
    }
    .confirm-check input[type="checkbox"] {
      width: 20px; height: 20px; accent-color: #1e3a5f; cursor: pointer;
    }
    .result-box {
      background: #f0fdf4; border: 1px solid #bbf7d0; border-radius: 12px;
      padding: 16px; margin: 16px 0; text-align: left; font-size: 14px; color: #333;
    }
    .result-box .row { display: flex; justify-content: space-between; padding: 4px 0; }
    .result-box .row .label { color: #666; }
    .result-box .row .value { font-weight: 600; }
    .footer { text-align: center; margin-top: 24px; color: #999; font-size: 12px; }
    .footer a { color: #1e3a5f; text-decoration: none; }
    @media (max-width: 480px) {
      .container { padding: 28px 20px; }
      .header .icon { font-size: 40px; }
      .tab-btn { font-size: 13px; padding: 8px 4px; }
      .word-grid { gap: 6px; }
      .word-card { padding: 8px 10px; font-size: 14px; }
    }
    @media print {
      body { background: white; }
      .container { box-shadow: none; max-width: 100%; }
      .submit-btn, .footer, .confirm-check, .tab-bar, .link-btn { display: none !important; }
      .word-card { border: 1px solid #000; }
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <div class="icon">&#x1F512;</div>
      <h1>MoA &#xBC31;&#xC5C5; &amp; &#xBCF5;&#xC6D0;</h1>
      <p class="subtitle">AI &#xAE30;&#xC5B5;&#xACFC; &#xC124;&#xC815;&#xC744; &#xC548;&#xC804;&#xD558;&#xAC8C; &#xBCF4;&#xAD00;&#xD569;&#xB2C8;&#xB2E4;</p>
    </div>

    <!-- Tab bar -->
    <div class="tab-bar">
      <button class="tab-btn active" onclick="switchTab('backup')">&#xBC31;&#xC5C5;</button>
      <button class="tab-btn" onclick="switchTab('restore')">&#xBCF5;&#xC6D0;</button>
    </div>

    <!-- ======== BACKUP TAB ======== -->

    <!-- Backup Step 1: Login + Backup Password -->
    <div id="backup-step-auth" class="step-view active">
      <div class="info-box">
        <b>&#xBC31;&#xC5C5;&#xC774;&#xB780;?</b><br>
        MoA&#xC758; AI &#xAE30;&#xC5B5;&#xACFC; &#xC124;&#xC815;&#xC744; &#xC554;&#xD638;&#xD654;&#xD558;&#xC5EC; &#xC11C;&#xBC84;&#xC5D0; &#xBCF4;&#xAD00;&#xD569;&#xB2C8;&#xB2E4;.<br>
        &#xBC31;&#xC5C5; &#xBE44;&#xBC00;&#xBC88;&#xD638;&#xB97C; &#xBD84;&#xC2E4;&#xD558;&#xBA74; <b>&#xBCF5;&#xAD6C;&#xD0A4;</b>(12&#xB2E8;&#xC5B4;)&#xB85C; &#xBE44;&#xBC00;&#xBC88;&#xD638;&#xB97C; &#xC7AC;&#xC124;&#xC815;&#xD560; &#xC218; &#xC788;&#xC2B5;&#xB2C8;&#xB2E4;.<br><br>
        &#xCE74;&#xCE74;&#xC624;&#xD1A1; &#xD1A1;&#xC11C;&#xB78D;&#xACFC; &#xB3D9;&#xC77C;&#xD55C; &#xAC1C;&#xB150;&#xC785;&#xB2C8;&#xB2E4;.
      </div>
      <div class="form-group">
        <label for="b-username">&#xC544;&#xC774;&#xB514;</label>
        <input type="text" id="b-username" placeholder="MoA &#xC544;&#xC774;&#xB514;" autocomplete="username">
      </div>
      <div class="form-group">
        <label for="b-password">&#xBE44;&#xBC00;&#xBC88;&#xD638;</label>
        <input type="password" id="b-password" placeholder="MoA &#xBE44;&#xBC00;&#xBC88;&#xD638;" autocomplete="current-password">
      </div>
      <div class="form-group">
        <label for="b-backup-pw" id="b-backup-pw-label">&#xBC31;&#xC5C5; &#xBE44;&#xBC00;&#xBC88;&#xD638;</label>
        <input type="password" id="b-backup-pw" placeholder="&#xBC31;&#xC5C5;&#xC6A9; &#xBE44;&#xBC00;&#xBC88;&#xD638; (4&#xC790; &#xC774;&#xC0C1;)" autocomplete="new-password">
      </div>
      <div class="form-group" id="b-backup-pw-confirm-group">
        <label for="b-backup-pw-confirm">&#xBC31;&#xC5C5; &#xBE44;&#xBC00;&#xBC88;&#xD638; &#xD655;&#xC778;</label>
        <input type="password" id="b-backup-pw-confirm" placeholder="&#xBC31;&#xC5C5; &#xBE44;&#xBC00;&#xBC88;&#xD638; &#xB2E4;&#xC2DC; &#xC785;&#xB825;" autocomplete="new-password">
      </div>
      <button class="submit-btn" id="b-submit" onclick="handleBackup()">&#xBC31;&#xC5C5; &#xC2DC;&#xC791;</button>
      <div class="status-msg" id="b-status"></div>
    </div>

    <!-- Backup Step 2: Recovery key display (first backup only) -->
    <div id="backup-step-recovery" class="step-view recovery-section">
      <h2>&#xBCF5;&#xAD6C;&#xD0A4; &#xBC1C;&#xAE09;</h2>
      <p class="desc">
        &#xC544;&#xB798; <b>12&#xAC1C; &#xB2E8;&#xC5B4;</b>&#xB97C; &#xC885;&#xC774;&#xC5D0; &#xC801;&#xC5B4;&#xB450;&#xC138;&#xC694;.<br>
        &#xBC31;&#xC5C5; &#xBE44;&#xBC00;&#xBC88;&#xD638;&#xB97C; &#xC78A;&#xC5C8;&#xC744; &#xB54C; &#xC774; &#xB2E8;&#xC5B4;&#xB85C; &#xBE44;&#xBC00;&#xBC88;&#xD638;&#xB97C; &#xC7AC;&#xC124;&#xC815;&#xD560; &#xC218; &#xC788;&#xC2B5;&#xB2C8;&#xB2E4;.
      </p>
      <div class="word-grid" id="word-grid"></div>
      <div class="warning-box">
        <b>&#xC911;&#xC694;:</b><br>
        &#x2022; &#xC774; 12&#xB2E8;&#xC5B4;&#xB294; <b>&#xB2E4;&#xC2DC; &#xD45C;&#xC2DC;&#xB418;&#xC9C0; &#xC54A;&#xC2B5;&#xB2C8;&#xB2E4;.</b><br>
        &#x2022; &#xC885;&#xC774;&#xC5D0; &#xC801;&#xC5B4; &#xC548;&#xC804;&#xD55C; &#xACF3;&#xC5D0; &#xBCF4;&#xAD00;&#xD558;&#xC138;&#xC694;.<br>
        &#x2022; &#xBC31;&#xC5C5; &#xBE44;&#xBC00;&#xBC88;&#xD638; &#xBD84;&#xC2E4; &#xC2DC; &#xC720;&#xC77C;&#xD55C; &#xBCF5;&#xAD6C; &#xC218;&#xB2E8;&#xC785;&#xB2C8;&#xB2E4;.
      </div>
      <button class="submit-btn" onclick="window.print()" style="background:#475569; margin-bottom:10px;">
        &#xC778;&#xC1C4;&#xD558;&#xAE30;
      </button>
      <label class="confirm-check">
        <input type="checkbox" id="confirm-saved" onchange="document.getElementById('confirm-btn').disabled = !this.checked">
        12&#xB2E8;&#xC5B4;&#xB97C; &#xC548;&#xC804;&#xD558;&#xAC8C; &#xC801;&#xC5B4;&#xB450;&#xC5C8;&#xC2B5;&#xB2C8;&#xB2E4;.
      </label>
      <button class="submit-btn" id="confirm-btn" disabled onclick="showBackupComplete()">&#xD655;&#xC778; &#xC644;&#xB8CC;</button>
    </div>

    <!-- Backup Step 3: Complete -->
    <div id="backup-step-complete" class="step-view" style="text-align:center;">
      <div style="font-size:56px; margin-bottom:12px;">&#x2705;</div>
      <h2 style="font-size:20px; color:#16a34a; margin-bottom:8px;">&#xBC31;&#xC5C5; &#xC644;&#xB8CC;!</h2>
      <p style="font-size:14px; color:#555; margin-bottom:16px; line-height:1.6;">
        AI &#xAE30;&#xC5B5;&#xACFC; &#xC124;&#xC815;&#xC774; &#xC554;&#xD638;&#xD654;&#xB418;&#xC5B4; &#xC11C;&#xBC84;&#xC5D0; &#xBCF4;&#xAD00;&#xB418;&#xC5C8;&#xC2B5;&#xB2C8;&#xB2E4;.
      </p>
      <div class="result-box">
        <div class="row"><span class="label">&#xC554;&#xD638;&#xD654;</span><span class="value">AES-256-GCM</span></div>
        <div class="row"><span class="label">&#xBC31;&#xC5C5; &#xC2DC;&#xAC01;</span><span class="value" id="info-time"></span></div>
        <div class="row"><span class="label">&#xD30C;&#xC77C;</span><span class="value" id="info-file"></span></div>
        <div class="row"><span class="label">&#xBCF5;&#xC6D0; &#xBC29;&#xBC95;</span><span class="value">&#xBC31;&#xC5C5; &#xBE44;&#xBC00;&#xBC88;&#xD638;</span></div>
      </div>
      <div class="info-box" style="text-align:left;">
        <b>&#xBCF5;&#xC6D0;&#xC774; &#xD544;&#xC694;&#xD560; &#xB54C;:</b><br>
        &#xC774; &#xD398;&#xC774;&#xC9C0;&#xC758; "&#xBCF5;&#xC6D0;" &#xD0ED;&#xC5D0;&#xC11C; &#xBC31;&#xC5C5; &#xBE44;&#xBC00;&#xBC88;&#xD638;&#xB85C; &#xBCF5;&#xC6D0;&#xD560; &#xC218; &#xC788;&#xC2B5;&#xB2C8;&#xB2E4;.<br>
        &#xBC31;&#xC5C5; &#xBE44;&#xBC00;&#xBC88;&#xD638;&#xB97C; &#xC78A;&#xC73C;&#xC168;&#xB2E4;&#xBA74; &#xBCF5;&#xAD6C;&#xD0A4;(12&#xB2E8;&#xC5B4;)&#xB85C; &#xBE44;&#xBC00;&#xBC88;&#xD638;&#xB97C; &#xC7AC;&#xC124;&#xC815;&#xD558;&#xC138;&#xC694;.
      </div>
      <a href="/backup" class="submit-btn" style="display:block; text-align:center; text-decoration:none; margin-top:12px;">
        &#xB3CC;&#xC544;&#xAC00;&#xAE30;
      </a>
    </div>

    <!-- ======== RESTORE TAB ======== -->

    <!-- Restore Step 1: Login + Backup Password -->
    <div id="restore-step-auth" class="step-view">
      <div class="info-box">
        <b>&#xBCF5;&#xC6D0;&#xC774;&#xB780;?</b><br>
        &#xC11C;&#xBC84;&#xC5D0; &#xBCF4;&#xAD00;&#xB41C; &#xBC31;&#xC5C5;&#xC744; &#xBC31;&#xC5C5; &#xBE44;&#xBC00;&#xBC88;&#xD638;&#xB85C; &#xBCF5;&#xD638;&#xD654;&#xD558;&#xC5EC; &#xBCF5;&#xC6D0;&#xD569;&#xB2C8;&#xB2E4;.<br>
        &#xAE30;&#xAE30; &#xBCC0;&#xACBD;&#xC774;&#xB098; &#xBD84;&#xC2E4; &#xC2DC; AI &#xAE30;&#xC5B5;&#xACFC; &#xC124;&#xC815;&#xC744; &#xBCF5;&#xC6D0;&#xD560; &#xC218; &#xC788;&#xC2B5;&#xB2C8;&#xB2E4;.
      </div>
      <div class="form-group">
        <label for="r-username">&#xC544;&#xC774;&#xB514;</label>
        <input type="text" id="r-username" placeholder="MoA &#xC544;&#xC774;&#xB514;" autocomplete="username">
      </div>
      <div class="form-group">
        <label for="r-password">&#xBE44;&#xBC00;&#xBC88;&#xD638;</label>
        <input type="password" id="r-password" placeholder="MoA &#xBE44;&#xBC00;&#xBC88;&#xD638;" autocomplete="current-password">
      </div>
      <div class="form-group">
        <label for="r-backup-pw">&#xBC31;&#xC5C5; &#xBE44;&#xBC00;&#xBC88;&#xD638;</label>
        <input type="password" id="r-backup-pw" placeholder="&#xBC31;&#xC5C5; &#xC2DC; &#xC124;&#xC815;&#xD55C; &#xBE44;&#xBC00;&#xBC88;&#xD638;">
      </div>
      <button class="submit-btn" id="r-submit" onclick="handleRestore()">&#xBCF5;&#xC6D0; &#xC2DC;&#xC791;</button>
      <div class="status-msg" id="r-status"></div>
      <div style="text-align:center; margin-top:12px;">
        <button class="link-btn" onclick="showResetPassword()">&#xBC31;&#xC5C5; &#xBE44;&#xBC00;&#xBC88;&#xD638;&#xB97C; &#xC78A;&#xC73C;&#xC168;&#xB098;&#xC694;?</button>
      </div>
    </div>

    <!-- Restore Step 2: Complete -->
    <div id="restore-step-complete" class="step-view" style="text-align:center;">
      <div style="font-size:56px; margin-bottom:12px;">&#x2705;</div>
      <h2 style="font-size:20px; color:#16a34a; margin-bottom:8px;">&#xBCF5;&#xC6D0; &#xC644;&#xB8CC;!</h2>
      <p style="font-size:14px; color:#555; margin-bottom:16px; line-height:1.6;">
        &#xBC31;&#xC5C5;&#xC5D0;&#xC11C; AI &#xAE30;&#xC5B5;&#xACFC; &#xC124;&#xC815;&#xC774; &#xBCF5;&#xC6D0;&#xB418;&#xC5C8;&#xC2B5;&#xB2C8;&#xB2E4;.
      </p>
      <div class="result-box">
        <div class="row"><span class="label">&#xBCF5;&#xC6D0; &#xD30C;&#xC77C;</span><span class="value" id="r-info-file"></span></div>
        <div class="row"><span class="label">&#xBC31;&#xC5C5; &#xC2DC;&#xAC01;</span><span class="value" id="r-info-time"></span></div>
        <div class="row"><span class="label">&#xBB34;&#xACB0;&#xC131; &#xAC80;&#xC99D;</span><span class="value" id="r-info-verified"></span></div>
      </div>
      <a href="/backup" class="submit-btn" style="display:block; text-align:center; text-decoration:none; margin-top:12px;">
        &#xB3CC;&#xC544;&#xAC00;&#xAE30;
      </a>
    </div>

    <!-- ======== PASSWORD RESET (via recovery key) ======== -->

    <div id="reset-step" class="step-view">
      <h2 style="font-size:18px; color:#1e3a5f; margin-bottom:12px; text-align:center;">&#xBC31;&#xC5C5; &#xBE44;&#xBC00;&#xBC88;&#xD638; &#xC7AC;&#xC124;&#xC815;</h2>
      <div class="info-box">
        &#xBC31;&#xC5C5; &#xC2DC; &#xBC1C;&#xAE09;&#xBC1B;&#xC740; <b>12&#xB2E8;&#xC5B4; &#xBCF5;&#xAD6C;&#xD0A4;</b>&#xB97C; &#xC785;&#xB825;&#xD558;&#xBA74;<br>
        &#xBC31;&#xC5C5; &#xBE44;&#xBC00;&#xBC88;&#xD638;&#xB97C; &#xC0C8;&#xB85C; &#xC124;&#xC815;&#xD560; &#xC218; &#xC788;&#xC2B5;&#xB2C8;&#xB2E4;.
      </div>
      <div class="form-group">
        <label for="rk-username">&#xC544;&#xC774;&#xB514;</label>
        <input type="text" id="rk-username" placeholder="MoA &#xC544;&#xC774;&#xB514;" autocomplete="username">
      </div>
      <div class="form-group">
        <label for="rk-password">&#xBE44;&#xBC00;&#xBC88;&#xD638;</label>
        <input type="password" id="rk-password" placeholder="MoA &#xBE44;&#xBC00;&#xBC88;&#xD638;" autocomplete="current-password">
      </div>
      <div class="form-group">
        <label for="rk-words">&#xBCF5;&#xAD6C;&#xD0A4; (12&#xB2E8;&#xC5B4;, &#xACF5;&#xBC31;&#xC73C;&#xB85C; &#xAD6C;&#xBD84;)</label>
        <textarea id="rk-words" rows="3" placeholder="&#xC0AC;&#xACFC; &#xBC14;&#xB2E4; &#xD558;&#xB298; &#xBCC4; &#xB2EC; &#xD574; &#xC0B0; &#xAC15; &#xAF43; &#xB098;&#xBB34; &#xBC14;&#xB78C; &#xAD6C;&#xB984;"></textarea>
      </div>
      <div class="form-group">
        <label for="rk-new-pw">&#xC0C8; &#xBC31;&#xC5C5; &#xBE44;&#xBC00;&#xBC88;&#xD638;</label>
        <input type="password" id="rk-new-pw" placeholder="&#xC0C8; &#xBC31;&#xC5C5; &#xBE44;&#xBC00;&#xBC88;&#xD638; (4&#xC790; &#xC774;&#xC0C1;)">
      </div>
      <button class="submit-btn" id="rk-submit" onclick="handleResetPassword()">&#xBE44;&#xBC00;&#xBC88;&#xD638; &#xC7AC;&#xC124;&#xC815;</button>
      <div class="status-msg" id="rk-status"></div>
      <div style="text-align:center; margin-top:12px;">
        <button class="link-btn" onclick="switchTab('restore')">&#xB3CC;&#xC544;&#xAC00;&#xAE30;</button>
      </div>
    </div>

    <div class="footer">
      <a href="https://mymoa.app">mymoa.app</a> &middot; Master of AI
    </div>
  </div>

  <script>
    var backupResult = null;
    var currentTab = 'backup';

    // ── Tab switching ──
    function switchTab(tab) {
      currentTab = tab;
      // Reset all views
      var views = document.querySelectorAll('.step-view');
      for (var i = 0; i < views.length; i++) views[i].classList.remove('active');
      // Reset tab buttons
      var tabs = document.querySelectorAll('.tab-btn');
      for (var i = 0; i < tabs.length; i++) tabs[i].classList.remove('active');

      if (tab === 'backup') {
        document.getElementById('backup-step-auth').classList.add('active');
        tabs[0].classList.add('active');
        var el = document.getElementById('b-username');
        if (el) el.focus();
      } else {
        document.getElementById('restore-step-auth').classList.add('active');
        tabs[1].classList.add('active');
        var el = document.getElementById('r-username');
        if (el) el.focus();
      }
    }

    function showStep(id) {
      var views = document.querySelectorAll('.step-view');
      for (var i = 0; i < views.length; i++) views[i].classList.remove('active');
      document.getElementById(id).classList.add('active');
    }

    function showResetPassword() {
      showStep('reset-step');
      var el = document.getElementById('rk-username');
      if (el) el.focus();
    }

    function esc(str) {
      var d = document.createElement('div');
      d.appendChild(document.createTextNode(str));
      return d.innerHTML;
    }

    // ── Backup ──
    function handleBackup() {
      var username = document.getElementById('b-username').value.trim();
      var password = document.getElementById('b-password').value;
      var backupPw = document.getElementById('b-backup-pw').value;
      var backupPwConfirm = document.getElementById('b-backup-pw-confirm').value;
      var status = document.getElementById('b-status');
      var btn = document.getElementById('b-submit');

      if (!username || !password || !backupPw) {
        status.className = 'status-msg error';
        status.textContent = '\\uBAA8\\uB4E0 \\uD544\\uB4DC\\uB97C \\uC785\\uB825\\uD574\\uC8FC\\uC138\\uC694.';
        return;
      }
      if (backupPwConfirm && backupPw !== backupPwConfirm) {
        status.className = 'status-msg error';
        status.textContent = '\\uBC31\\uC5C5 \\uBE44\\uBC00\\uBC88\\uD638\\uAC00 \\uC77C\\uCE58\\uD558\\uC9C0 \\uC54A\\uC2B5\\uB2C8\\uB2E4.';
        return;
      }

      status.className = 'status-msg loading';
      status.textContent = '\\uBC31\\uC5C5 \\uC0DD\\uC131 \\uC911...';
      btn.disabled = true;

      fetch('/api/relay/auth/backup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username: username,
          password: password,
          backupPassword: backupPw,
          backupPasswordConfirm: backupPwConfirm || undefined
        })
      })
      .then(function(r) { return r.json(); })
      .then(function(data) {
        if (data.success) {
          backupResult = data;
          if (data.isFirstBackup && data.recoveryWords) {
            // First backup — show recovery key
            var grid = document.getElementById('word-grid');
            grid.innerHTML = '';
            for (var i = 0; i < data.recoveryWords.length; i++) {
              var card = document.createElement('div');
              card.className = 'word-card';
              card.innerHTML = '<span class="num">' + (i + 1) + '</span><span class="word">' + esc(data.recoveryWords[i]) + '</span>';
              grid.appendChild(card);
            }
            showStep('backup-step-recovery');
          } else {
            // Subsequent backup — go straight to complete
            showBackupComplete();
          }
        } else {
          status.className = 'status-msg error';
          status.textContent = data.error || '\\uBC31\\uC5C5\\uC5D0 \\uC2E4\\uD328\\uD588\\uC2B5\\uB2C8\\uB2E4.';
          btn.disabled = false;
        }
      })
      .catch(function() {
        status.className = 'status-msg error';
        status.textContent = '\\uC11C\\uBC84\\uC5D0 \\uC5F0\\uACB0\\uD560 \\uC218 \\uC5C6\\uC2B5\\uB2C8\\uB2E4.';
        btn.disabled = false;
      });
    }

    function showBackupComplete() {
      if (!backupResult) return;
      document.getElementById('info-time').textContent = new Date(backupResult.createdAt).toLocaleString('ko-KR');
      document.getElementById('info-file').textContent = backupResult.backupFile || '';
      showStep('backup-step-complete');
    }

    // ── Restore ──
    function handleRestore() {
      var username = document.getElementById('r-username').value.trim();
      var password = document.getElementById('r-password').value;
      var backupPw = document.getElementById('r-backup-pw').value;
      var status = document.getElementById('r-status');
      var btn = document.getElementById('r-submit');

      if (!username || !password || !backupPw) {
        status.className = 'status-msg error';
        status.textContent = '\\uBAA8\\uB4E0 \\uD544\\uB4DC\\uB97C \\uC785\\uB825\\uD574\\uC8FC\\uC138\\uC694.';
        return;
      }

      status.className = 'status-msg loading';
      status.textContent = '\\uBCF5\\uC6D0 \\uC911...';
      btn.disabled = true;

      fetch('/api/relay/auth/restore', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username: username,
          password: password,
          backupPassword: backupPw
        })
      })
      .then(function(r) { return r.json(); })
      .then(function(data) {
        if (data.success) {
          document.getElementById('r-info-file').textContent = data.backupFile || '';
          document.getElementById('r-info-time').textContent = new Date(data.timestamp).toLocaleString('ko-KR');
          document.getElementById('r-info-verified').textContent = data.verified ? '\\uAC80\\uC99D \\uC644\\uB8CC' : '\\uAC80\\uC99D \\uC2E4\\uD328';
          showStep('restore-step-complete');
        } else {
          status.className = 'status-msg error';
          status.textContent = data.error || '\\uBCF5\\uC6D0\\uC5D0 \\uC2E4\\uD328\\uD588\\uC2B5\\uB2C8\\uB2E4.';
          btn.disabled = false;
        }
      })
      .catch(function() {
        status.className = 'status-msg error';
        status.textContent = '\\uC11C\\uBC84\\uC5D0 \\uC5F0\\uACB0\\uD560 \\uC218 \\uC5C6\\uC2B5\\uB2C8\\uB2E4.';
        btn.disabled = false;
      });
    }

    // ── Reset backup password ──
    function handleResetPassword() {
      var username = document.getElementById('rk-username').value.trim();
      var password = document.getElementById('rk-password').value;
      var wordsRaw = document.getElementById('rk-words').value.trim();
      var newPw = document.getElementById('rk-new-pw').value;
      var status = document.getElementById('rk-status');
      var btn = document.getElementById('rk-submit');

      if (!username || !password || !wordsRaw || !newPw) {
        status.className = 'status-msg error';
        status.textContent = '\\uBAA8\\uB4E0 \\uD544\\uB4DC\\uB97C \\uC785\\uB825\\uD574\\uC8FC\\uC138\\uC694.';
        return;
      }

      var words = wordsRaw.split(/[\\s,]+/).filter(function(w) { return w.length > 0; });
      if (words.length !== 12) {
        status.className = 'status-msg error';
        status.textContent = '\\uBCF5\\uAD6C\\uD0A4\\uB294 12\\uB2E8\\uC5B4\\uC5EC\\uC57C \\uD569\\uB2C8\\uB2E4. \\uD604\\uC7AC ' + words.length + '\\uB2E8\\uC5B4\\uC785\\uB2C8\\uB2E4.';
        return;
      }

      status.className = 'status-msg loading';
      status.textContent = '\\uBE44\\uBC00\\uBC88\\uD638 \\uC7AC\\uC124\\uC815 \\uC911...';
      btn.disabled = true;

      fetch('/api/relay/auth/backup/reset-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username: username,
          password: password,
          recoveryWords: words,
          newBackupPassword: newPw
        })
      })
      .then(function(r) { return r.json(); })
      .then(function(data) {
        if (data.success) {
          status.className = 'status-msg success';
          status.textContent = '\\uBC31\\uC5C5 \\uBE44\\uBC00\\uBC88\\uD638\\uAC00 \\uC7AC\\uC124\\uC815\\uB418\\uC5C8\\uC2B5\\uB2C8\\uB2E4!';
          setTimeout(function() { switchTab('restore'); }, 2000);
        } else {
          status.className = 'status-msg error';
          status.textContent = data.error || '\\uC7AC\\uC124\\uC815\\uC5D0 \\uC2E4\\uD328\\uD588\\uC2B5\\uB2C8\\uB2E4.';
          btn.disabled = false;
        }
      })
      .catch(function() {
        status.className = 'status-msg error';
        status.textContent = '\\uC11C\\uBC84\\uC5D0 \\uC5F0\\uACB0\\uD560 \\uC218 \\uC5C6\\uC2B5\\uB2C8\\uB2E4.';
        btn.disabled = false;
      });
    }

    // ── Enter key support ──
    document.getElementById('b-backup-pw-confirm').addEventListener('keydown', function(e) {
      if (e.key === 'Enter') handleBackup();
    });
    document.getElementById('b-backup-pw').addEventListener('keydown', function(e) {
      if (e.key === 'Enter') handleBackup();
    });
    document.getElementById('r-backup-pw').addEventListener('keydown', function(e) {
      if (e.key === 'Enter') handleRestore();
    });
    document.getElementById('rk-new-pw').addEventListener('keydown', function(e) {
      if (e.key === 'Enter') handleResetPassword();
    });

    // Focus first field
    document.getElementById('b-username').focus();
  </script>
</body>
</html>`;
}

/**
 * Serve install scripts, one-click installers, welcome page, and the install HTML page.
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

  // /welcome — post-install guide page (auto-opened by installer)
  if (url.pathname === "/welcome") {
    const html = generateWelcomePage();
    res.writeHead(200, {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-cache",
    });
    res.end(html);
    return true;
  }

  // /backup — 백업 설정 & 복구키 발급 페이지 (톡서랍 개념)
  if (url.pathname === "/backup") {
    const html = generateBackupPage();
    res.writeHead(200, {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-cache",
    });
    res.end(html);
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
