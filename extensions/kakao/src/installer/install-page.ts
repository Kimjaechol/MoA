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
 * 설치 스크립트가 완료되면 브라우저에서 이 페이지를 자동으로 엽니다.
 * 로그인 폼(기본) + 회원가입 폼(전환) → 기기 자동 등록
 */
function generateWelcomePage(): string {
  return `<!DOCTYPE html>
<html lang="ko">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>MoA - 로그인</title>
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
    .header {
      text-align: center;
      margin-bottom: 32px;
    }
    .header .logo { font-size: 48px; }
    .header h1 { font-size: 24px; color: #1a1a2e; margin: 8px 0 4px; }
    .header .subtitle { color: #666; font-size: 14px; }
    .form-group {
      margin-bottom: 16px;
    }
    .form-group label {
      display: block;
      font-size: 13px;
      font-weight: 600;
      color: #555;
      margin-bottom: 6px;
    }
    .form-group input {
      width: 100%;
      padding: 12px 16px;
      border: 2px solid #e5e7eb;
      border-radius: 10px;
      font-size: 15px;
      outline: none;
      transition: border-color 0.2s;
    }
    .form-group input:focus {
      border-color: #667eea;
      box-shadow: 0 0 0 3px rgba(102,126,234,0.15);
    }
    .form-group input::placeholder { color: #aaa; }
    .submit-btn {
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      color: white;
      border: none;
      padding: 14px;
      border-radius: 12px;
      font-size: 16px;
      font-weight: 700;
      cursor: pointer;
      width: 100%;
      margin-top: 8px;
      transition: transform 0.2s, box-shadow 0.2s, opacity 0.2s;
    }
    .submit-btn:hover:not(:disabled) {
      transform: translateY(-2px);
      box-shadow: 0 8px 24px rgba(102,126,234,0.4);
    }
    .submit-btn:disabled {
      opacity: 0.5;
      cursor: not-allowed;
    }
    .status-msg {
      margin-top: 12px;
      font-size: 14px;
      text-align: center;
      min-height: 20px;
    }
    .status-msg.error { color: #dc2626; }
    .status-msg.loading { color: #667eea; }
    .status-msg.success { color: #16a34a; font-weight: 600; }
    .toggle-link {
      text-align: center;
      margin-top: 20px;
      font-size: 14px;
      color: #666;
    }
    .toggle-link a {
      color: #667eea;
      text-decoration: none;
      font-weight: 600;
      cursor: pointer;
    }
    .toggle-link a:hover { text-decoration: underline; }
    .divider {
      display: flex;
      align-items: center;
      margin: 24px 0;
      color: #ccc;
      font-size: 13px;
    }
    .divider::before, .divider::after {
      content: '';
      flex: 1;
      border-bottom: 1px solid #e5e7eb;
    }
    .divider span { padding: 0 12px; }

    /* Success section */
    .success-section {
      text-align: center;
      display: none;
    }
    .success-section.visible { display: block; }
    .success-section .icon { font-size: 56px; margin-bottom: 16px; }
    .success-section h2 { font-size: 20px; color: #16a34a; margin-bottom: 8px; }
    .success-section .detail { font-size: 14px; color: #555; margin-bottom: 20px; line-height: 1.7; }
    .success-section .device-info {
      background: #f0fdf4;
      border: 1px solid #bbf7d0;
      border-radius: 12px;
      padding: 16px;
      margin-bottom: 20px;
      text-align: left;
      font-size: 14px;
      color: #333;
    }
    .success-section .device-info .row {
      display: flex;
      justify-content: space-between;
      padding: 4px 0;
    }
    .success-section .device-info .row .label { color: #666; }
    .success-section .device-info .row .value { font-weight: 600; }
    .activate-btn {
      background: #22c55e;
      color: white;
      border: none;
      padding: 14px 32px;
      border-radius: 12px;
      font-size: 16px;
      font-weight: 700;
      cursor: pointer;
      width: 100%;
      transition: transform 0.2s;
    }
    .activate-btn:hover {
      transform: translateY(-2px);
      box-shadow: 0 8px 24px rgba(34,197,94,0.3);
    }
    .success-section .next-steps {
      background: #fffbeb;
      border: 1px solid #fde68a;
      border-radius: 12px;
      padding: 16px;
      margin-top: 20px;
      text-align: left;
      font-size: 13px;
      color: #78350f;
      line-height: 1.7;
    }
    .success-section .next-steps b { color: #92400e; }
    .footer {
      text-align: center;
      margin-top: 24px;
      color: #999;
      font-size: 12px;
    }
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
      <p class="subtitle">Master of AI - AI 어시스턴트</p>
    </div>

    <!-- Login Form (default) -->
    <div id="login-form">
      <div class="form-group">
        <label for="login-username">아이디</label>
        <input type="text" id="login-username" placeholder="아이디를 입력하세요" autocomplete="username">
      </div>
      <div class="form-group">
        <label for="login-password">비밀번호</label>
        <input type="password" id="login-password" placeholder="비밀번호를 입력하세요" autocomplete="current-password">
      </div>
      <div class="form-group">
        <label for="login-device">기기 이름</label>
        <input type="text" id="login-device" placeholder="이 기기의 이름 (예: 내 노트북)">
      </div>
      <button class="submit-btn" id="login-btn" onclick="handleLogin()">로그인</button>
      <div class="status-msg" id="login-status"></div>
      <div class="toggle-link">
        계정이 없으신가요? <a onclick="showSignup()">회원가입</a>
      </div>
    </div>

    <!-- Signup Form (hidden) -->
    <div id="signup-form" style="display:none;">
      <div class="form-group">
        <label for="signup-username">아이디</label>
        <input type="text" id="signup-username" placeholder="사용할 아이디 (2자 이상)" autocomplete="username">
      </div>
      <div class="form-group">
        <label for="signup-password">비밀번호</label>
        <input type="password" id="signup-password" placeholder="비밀번호 (4자 이상)" autocomplete="new-password">
      </div>
      <div class="form-group">
        <label for="signup-confirm">비밀번호 확인</label>
        <input type="password" id="signup-confirm" placeholder="비밀번호를 다시 입력하세요" autocomplete="new-password">
      </div>
      <div class="form-group">
        <label for="signup-device">기기 이름</label>
        <input type="text" id="signup-device" placeholder="이 기기의 이름 (예: 내 노트북)">
      </div>
      <button class="submit-btn" id="signup-btn" onclick="handleSignup()">회원가입</button>
      <div class="status-msg" id="signup-status"></div>
      <div class="toggle-link">
        이미 계정이 있으신가요? <a onclick="showLogin()">로그인</a>
      </div>
    </div>

    <!-- Success Section (hidden) -->
    <div id="success-section" class="success-section">
      <div class="icon">&#x1F389;</div>
      <h2 id="success-title">기기 등록 완료!</h2>
      <div class="detail" id="success-detail">이제 카카오톡에서 이 컴퓨터를 제어할 수 있습니다.</div>
      <div class="device-info" id="device-info">
        <div class="row"><span class="label">기기 이름</span><span class="value" id="info-device"></span></div>
        <div class="row"><span class="label">플랫폼</span><span class="value" id="info-platform"></span></div>
        <div class="row"><span class="label">등록 상태</span><span class="value" id="info-status"></span></div>
      </div>
      <button class="activate-btn" onclick="downloadActivation()">설정 파일 다운로드</button>
      <div class="status-msg success" id="activate-status" style="margin-top:12px;"></div>
      <div class="next-steps">
        <b>다음 단계:</b><br>
        1. 다운로드된 파일을 <b>더블클릭</b>하여 설정을 완료하세요.<br>
        2. <b>카카오톡</b>에서 MoA 채널을 열고 "사용자 인증" 버튼을 눌러주세요.<br>
        3. 가입시 설정한 아이디와 비밀번호로 인증하면 기기 제어가 활성화됩니다!
      </div>
    </div>

    <div class="footer">
      <a href="https://moa.lawith.kr">moa.lawith.kr</a> &middot; Master of AI
    </div>
  </div>

  <script>
    // Platform detection
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

    // Auto-suggest device names
    var defaultDeviceName = detectedPlatform === 'Windows' ? 'My Windows PC'
      : detectedPlatform === 'macOS' ? 'My Mac'
      : detectedPlatform === 'Android' ? 'My Android'
      : detectedPlatform === 'iOS' ? 'My iPhone'
      : 'My Linux PC';

    document.getElementById('login-device').value = defaultDeviceName;
    document.getElementById('signup-device').value = defaultDeviceName;

    // Focus first input
    document.getElementById('login-username').focus();

    // Store result for activation download
    var authResult = null;

    function showSignup() {
      document.getElementById('login-form').style.display = 'none';
      document.getElementById('signup-form').style.display = 'block';
      document.getElementById('signup-username').focus();
      document.title = 'MoA - \\ud68c\\uc6d0\\uac00\\uc785';
    }

    function showLogin() {
      document.getElementById('signup-form').style.display = 'none';
      document.getElementById('login-form').style.display = 'block';
      document.getElementById('login-username').focus();
      document.title = 'MoA - \\ub85c\\uadf8\\uc778';
    }

    function showSuccess(deviceName, platform, isNew) {
      document.getElementById('login-form').style.display = 'none';
      document.getElementById('signup-form').style.display = 'none';
      var sec = document.getElementById('success-section');
      sec.classList.add('visible');
      document.getElementById('success-title').textContent = isNew ? '\\uae30\\uae30 \\ub4f1\\ub85d \\uc644\\ub8cc!' : '\\ub85c\\uadf8\\uc778 \\uc131\\uacf5!';
      document.getElementById('success-detail').textContent = isNew
        ? '\\uc0c8 \\uae30\\uae30\\uac00 \\ub4f1\\ub85d\\ub418\\uc5c8\\uc2b5\\ub2c8\\ub2e4. \\uc544\\ub798 \\uc124\\uc815 \\ud30c\\uc77c\\uc744 \\ub2e4\\uc6b4\\ub85c\\ub4dc\\ud574\\uc8fc\\uc138\\uc694.'
        : '\\uae30\\uc874 \\uae30\\uae30\\ub85c \\ub85c\\uadf8\\uc778\\ub418\\uc5c8\\uc2b5\\ub2c8\\ub2e4.';
      document.getElementById('info-device').textContent = deviceName;
      document.getElementById('info-platform').textContent = platform;
      document.getElementById('info-status').textContent = isNew ? '\\uc2e0\\uaddc \\ub4f1\\ub85d' : '\\uae30\\uc874 \\uae30\\uae30';
      document.title = 'MoA - \\uc644\\ub8cc';
      // Auto-trigger download
      downloadActivation();
    }

    function getDevicePayload(formPrefix) {
      return {
        deviceName: document.getElementById(formPrefix + '-device').value.trim() || defaultDeviceName,
        deviceType: detectedType,
        platform: detectedPlatform
      };
    }

    function handleLogin() {
      var username = document.getElementById('login-username').value.trim();
      var password = document.getElementById('login-password').value;
      var status = document.getElementById('login-status');
      var btn = document.getElementById('login-btn');

      if (!username || !password) {
        status.className = 'status-msg error';
        status.textContent = '\\uc544\\uc774\\ub514\\uc640 \\ube44\\ubc00\\ubc88\\ud638\\ub97c \\uc785\\ub825\\ud574\\uc8fc\\uc138\\uc694.';
        return;
      }

      status.className = 'status-msg loading';
      status.textContent = '\\ub85c\\uadf8\\uc778 \\uc911...';
      btn.disabled = true;

      var device = getDevicePayload('login');

      fetch('/api/relay/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: username, password: password, device: device })
      })
      .then(function(res) { return res.json(); })
      .then(function(data) {
        if (data.success) {
          authResult = {
            deviceToken: data.deviceToken,
            deviceName: device.deviceName,
            platform: device.platform,
            username: username,
            registeredAt: new Date().toISOString()
          };
          showSuccess(device.deviceName, device.platform, data.isNewDevice !== false);
        } else {
          status.className = 'status-msg error';
          status.textContent = data.error || '\\ub85c\\uadf8\\uc778\\uc5d0 \\uc2e4\\ud328\\ud588\\uc2b5\\ub2c8\\ub2e4.';
          btn.disabled = false;
        }
      })
      .catch(function() {
        status.className = 'status-msg error';
        status.textContent = '\\uc11c\\ubc84\\uc5d0 \\uc5f0\\uacb0\\ud560 \\uc218 \\uc5c6\\uc2b5\\ub2c8\\ub2e4. \\uc7a0\\uc2dc \\ud6c4 \\ub2e4\\uc2dc \\uc2dc\\ub3c4\\ud574\\uc8fc\\uc138\\uc694.';
        btn.disabled = false;
      });
    }

    function handleSignup() {
      var username = document.getElementById('signup-username').value.trim();
      var password = document.getElementById('signup-password').value;
      var confirm = document.getElementById('signup-confirm').value;
      var status = document.getElementById('signup-status');
      var btn = document.getElementById('signup-btn');

      if (!username || !password) {
        status.className = 'status-msg error';
        status.textContent = '\\uc544\\uc774\\ub514\\uc640 \\ube44\\ubc00\\ubc88\\ud638\\ub97c \\uc785\\ub825\\ud574\\uc8fc\\uc138\\uc694.';
        return;
      }
      if (password !== confirm) {
        status.className = 'status-msg error';
        status.textContent = '\\ube44\\ubc00\\ubc88\\ud638\\uac00 \\uc77c\\uce58\\ud558\\uc9c0 \\uc54a\\uc2b5\\ub2c8\\ub2e4.';
        return;
      }

      status.className = 'status-msg loading';
      status.textContent = '\\ud68c\\uc6d0\\uac00\\uc785 \\uc911...';
      btn.disabled = true;

      var device = getDevicePayload('signup');

      fetch('/api/relay/auth/signup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: username, password: password, device: device })
      })
      .then(function(res) { return res.json(); })
      .then(function(data) {
        if (data.success) {
          authResult = {
            deviceToken: data.deviceToken,
            deviceName: device.deviceName,
            platform: device.platform,
            username: username,
            registeredAt: new Date().toISOString()
          };
          showSuccess(device.deviceName, device.platform, true);
        } else {
          status.className = 'status-msg error';
          status.textContent = data.error || '\\ud68c\\uc6d0\\uac00\\uc785\\uc5d0 \\uc2e4\\ud328\\ud588\\uc2b5\\ub2c8\\ub2e4.';
          btn.disabled = false;
        }
      })
      .catch(function() {
        status.className = 'status-msg error';
        status.textContent = '\\uc11c\\ubc84\\uc5d0 \\uc5f0\\uacb0\\ud560 \\uc218 \\uc5c6\\uc2b5\\ub2c8\\ub2e4. \\uc7a0\\uc2dc \\ud6c4 \\ub2e4\\uc2dc \\uc2dc\\ub3c4\\ud574\\uc8fc\\uc138\\uc694.';
        btn.disabled = false;
      });
    }

    // Enter key support
    document.getElementById('login-password').addEventListener('keydown', function(e) {
      if (e.key === 'Enter') handleLogin();
    });
    document.getElementById('signup-confirm').addEventListener('keydown', function(e) {
      if (e.key === 'Enter') handleSignup();
    });

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
          + 'echo   MoA \\uae30\\uae30 \\uc5f0\\uacb0\\uc774 \\uc644\\ub8cc\\ub418\\uc5c8\\uc2b5\\ub2c8\\ub2e4!\\r\\n'
          + 'echo   \\uc774\\uc81c \\uce74\\uce74\\uc624\\ud1a1 MoA \\ucc44\\ub110\\uc5d0\\uc11c \\uba85\\ub839\\uc744 \\ubcf4\\ub0b4\\ubcf4\\uc138\\uc694.\\r\\n'
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
          + 'echo "  MoA \\uae30\\uae30 \\uc5f0\\uacb0\\uc774 \\uc644\\ub8cc\\ub418\\uc5c8\\uc2b5\\ub2c8\\ub2e4!"\\n'
          + 'echo "  \\uc774\\uc81c \\uce74\\uce74\\uc624\\ud1a1 MoA \\ucc44\\ub110\\uc5d0\\uc11c \\uba85\\ub839\\uc744 \\ubcf4\\ub0b4\\ubcf4\\uc138\\uc694."\\n'
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
        actStatus.textContent = '\\ub2e4\\uc6b4\\ub85c\\ub4dc\\ub41c ' + filename + ' \\ud30c\\uc77c\\uc744 \\ub354\\ube14\\ud074\\ub9ad\\ud558\\uba74 \\uc124\\uc815\\uc774 \\uc644\\ub8cc\\ub429\\ub2c8\\ub2e4!';
      }
    }
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
