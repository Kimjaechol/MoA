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
 * 설치 완료 후 안내 페이지 (GUI)
 * 설치 스크립트가 완료되면 브라우저에서 이 페이지를 자동으로 엽니다.
 * 페어링 코드 입력 폼이 포함되어 터미널 없이 기기 등록이 가능합니다.
 */
function generateWelcomePage(): string {
  return `<!DOCTYPE html>
<html lang="ko">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>MoA 설치 완료 - 시작하기</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Malgun Gothic', sans-serif;
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      min-height: 100vh;
      padding: 30px 20px;
    }
    .container {
      background: white;
      border-radius: 20px;
      padding: 40px;
      max-width: 680px;
      margin: 0 auto;
      box-shadow: 0 20px 60px rgba(0,0,0,0.3);
    }
    .header {
      text-align: center;
      margin-bottom: 32px;
    }
    .header .icon { font-size: 48px; }
    .header h1 { font-size: 24px; color: #1a1a2e; margin: 12px 0 4px; }
    .header .subtitle { color: #16a34a; font-weight: 600; font-size: 16px; }
    .section {
      background: #f8f9fa;
      border-radius: 16px;
      padding: 24px;
      margin-bottom: 20px;
    }
    .section h2 {
      font-size: 18px;
      color: #1a1a2e;
      margin-bottom: 16px;
      display: flex;
      align-items: center;
      gap: 8px;
    }
    .section h2 .num {
      background: linear-gradient(135deg, #667eea, #764ba2);
      color: white;
      width: 28px; height: 28px;
      border-radius: 50%;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      font-size: 14px;
      font-weight: 700;
      flex-shrink: 0;
    }
    .channel {
      background: white;
      border-radius: 12px;
      padding: 16px 20px;
      margin-bottom: 12px;
      border: 1px solid #e5e7eb;
    }
    .channel:last-child { margin-bottom: 0; }
    .channel h3 {
      font-size: 16px;
      color: #333;
      margin-bottom: 8px;
      display: flex;
      align-items: center;
      gap: 8px;
    }
    .channel .steps {
      color: #555;
      font-size: 14px;
      line-height: 1.8;
    }
    .channel .steps b { color: #1a1a2e; }

    /* Pairing code input form */
    .pairing-form {
      background: white;
      border-radius: 16px;
      padding: 24px;
      border: 2px solid #667eea;
      text-align: center;
    }
    .pairing-form h3 {
      font-size: 16px;
      color: #1a1a2e;
      margin-bottom: 16px;
    }
    .code-inputs {
      display: flex;
      gap: 8px;
      justify-content: center;
      margin-bottom: 20px;
    }
    .code-inputs input {
      width: 52px;
      height: 60px;
      text-align: center;
      font-size: 28px;
      font-weight: 700;
      border: 2px solid #d1d5db;
      border-radius: 12px;
      outline: none;
      transition: border-color 0.2s;
      font-family: 'Menlo', 'Consolas', monospace;
    }
    .code-inputs input:focus {
      border-color: #667eea;
      box-shadow: 0 0 0 3px rgba(102,126,234,0.2);
    }
    .pair-btn {
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      color: white;
      border: none;
      padding: 16px 40px;
      border-radius: 12px;
      font-size: 16px;
      font-weight: 700;
      cursor: pointer;
      width: 100%;
      transition: transform 0.2s, box-shadow 0.2s, opacity 0.2s;
    }
    .pair-btn:hover:not(:disabled) {
      transform: translateY(-2px);
      box-shadow: 0 8px 24px rgba(102,126,234,0.4);
    }
    .pair-btn:disabled {
      opacity: 0.5;
      cursor: not-allowed;
    }
    .pair-status {
      margin-top: 16px;
      font-size: 14px;
      min-height: 24px;
    }
    .pair-status.success {
      color: #16a34a;
      font-weight: 600;
    }
    .pair-status.error {
      color: #dc2626;
    }
    .pair-status.loading {
      color: #667eea;
    }

    /* Success activation section */
    .activation-section {
      background: #f0fdf4;
      border: 2px solid #22c55e;
      border-radius: 16px;
      padding: 24px;
      text-align: center;
      display: none;
    }
    .activation-section.visible { display: block; }
    .activation-section .success-icon { font-size: 48px; margin-bottom: 12px; }
    .activation-section h3 { font-size: 18px; color: #16a34a; margin-bottom: 12px; }
    .activation-section p { font-size: 14px; color: #555; margin-bottom: 8px; line-height: 1.6; }
    .activate-btn {
      background: #22c55e;
      color: white;
      border: none;
      padding: 14px 32px;
      border-radius: 12px;
      font-size: 16px;
      font-weight: 700;
      cursor: pointer;
      margin-top: 12px;
      transition: transform 0.2s;
    }
    .activate-btn:hover {
      transform: translateY(-2px);
      box-shadow: 0 8px 24px rgba(34,197,94,0.3);
    }

    .device-name-input {
      width: 100%;
      max-width: 280px;
      padding: 10px 16px;
      border: 2px solid #d1d5db;
      border-radius: 10px;
      font-size: 14px;
      outline: none;
      margin-bottom: 16px;
      text-align: center;
    }
    .device-name-input:focus {
      border-color: #667eea;
      box-shadow: 0 0 0 3px rgba(102,126,234,0.2);
    }

    .tip {
      background: #fffbeb;
      border: 1px solid #fde68a;
      border-radius: 12px;
      padding: 16px 20px;
      margin-top: 20px;
    }
    .tip h3 { font-size: 14px; color: #92400e; margin-bottom: 6px; }
    .tip p { font-size: 13px; color: #78350f; line-height: 1.6; }
    .footer {
      text-align: center;
      margin-top: 24px;
      color: #999;
      font-size: 13px;
    }
    .footer a { color: #667eea; text-decoration: none; }
    .footer a:hover { text-decoration: underline; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <div class="icon">🎉</div>
      <h1>MoA 설치가 완료되었습니다!</h1>
      <p class="subtitle">이제 기기를 등록하면 메신저로 이 컴퓨터를 제어할 수 있습니다</p>
    </div>

    <!-- Step 1: Get pairing code from KakaoTalk -->
    <div class="section">
      <h2><span class="num">1</span> 페어링 코드 받기</h2>
      <div class="channel">
        <div class="steps">
          <b>카카오톡</b>에서 <b>MoA 채널</b>을 열고<br>
          <b>"이 기기등록"</b> 버튼을 클릭하세요.<br>
          6자리 페어링 코드가 발급됩니다.
        </div>
      </div>
    </div>

    <!-- Step 2: Enter pairing code here -->
    <div class="section" id="pairing-section">
      <h2><span class="num">2</span> 페어링 코드 입력</h2>
      <div class="pairing-form" id="pairing-form">
        <h3>카카오톡에서 받은 6자리 코드를 입력하세요</h3>
        <div class="code-inputs" id="code-inputs">
          <input type="text" maxlength="1" inputmode="numeric" pattern="[0-9]" autocomplete="off">
          <input type="text" maxlength="1" inputmode="numeric" pattern="[0-9]" autocomplete="off">
          <input type="text" maxlength="1" inputmode="numeric" pattern="[0-9]" autocomplete="off">
          <input type="text" maxlength="1" inputmode="numeric" pattern="[0-9]" autocomplete="off">
          <input type="text" maxlength="1" inputmode="numeric" pattern="[0-9]" autocomplete="off">
          <input type="text" maxlength="1" inputmode="numeric" pattern="[0-9]" autocomplete="off">
        </div>
        <input type="text" class="device-name-input" id="device-name"
          placeholder="기기 이름 (예: 내 노트북)"
          value="">
        <br>
        <button class="pair-btn" id="pair-btn" disabled onclick="submitPairing()">
          연결하기
        </button>
        <div class="pair-status" id="pair-status"></div>
      </div>

      <!-- Success: activation download -->
      <div class="activation-section" id="activation-section">
        <div class="success-icon">🎊</div>
        <h3>기기 연결 성공!</h3>
        <p>마지막 단계: 아래 버튼을 클릭하여 설정 파일을 다운로드한 후,<br>
        다운로드된 파일을 <b>더블클릭</b>하면 설정이 완료됩니다.</p>
        <button class="activate-btn" id="activate-btn" onclick="downloadActivation()">
          설정 파일 다운로드
        </button>
        <div class="pair-status success" style="margin-top:12px;" id="activate-status"></div>
      </div>
    </div>

    <!-- Step 3: Chat methods -->
    <div class="section">
      <h2><span class="num">3</span> MoA와 대화하는 방법</h2>
      <p style="color:#555; font-size:14px; margin-bottom:12px;">
        한 번 기기를 등록하면, 아래 모든 메신저에서 이 컴퓨터에 명령을 보낼 수 있습니다.
      </p>

      <div class="channel">
        <h3>💬 카카오톡</h3>
        <div class="steps">
          카카오톡에서 <b>MoA 채널</b>로 메시지를 보내면 됩니다.<br>
          예시: <b>"바탕화면 파일 목록 보여줘"</b>
        </div>
      </div>

      <div class="channel">
        <h3>✈️ 텔레그램</h3>
        <div class="steps">
          텔레그램에서 <b>MoA 봇</b>을 검색하여 대화를 시작합니다.<br>
          <span style="color:#999;">(준비 중 — 곧 지원 예정)</span>
        </div>
      </div>

      <div class="channel">
        <h3>📱 WhatsApp</h3>
        <div class="steps">
          WhatsApp에서 <b>MoA 번호</b>로 메시지를 보냅니다.<br>
          <span style="color:#999;">(준비 중 — 곧 지원 예정)</span>
        </div>
      </div>
    </div>

    <div class="tip">
      <h3>💡 팁</h3>
      <p>
        기기 등록은 메신저와 무관하게 작동합니다. 카카오톡으로 등록한 기기에
        텔레그램이나 WhatsApp으로도 명령을 보낼 수 있습니다.
        추가 기기도 같은 방법으로 등록하면 모든 기기를 하나의 AI로 제어할 수 있습니다.
      </p>
    </div>

    <div class="footer">
      <p><a href="https://moa.lawith.kr">moa.lawith.kr</a> · Master of AI</p>
    </div>
  </div>

  <script>
    // Platform detection
    var isWindows = navigator.userAgent.indexOf('Win') !== -1;
    var isMac = navigator.userAgent.indexOf('Mac') !== -1;

    // Auto-set device name from platform
    var deviceNameInput = document.getElementById('device-name');
    if (isWindows) deviceNameInput.value = 'My Windows PC';
    else if (isMac) deviceNameInput.value = 'My Mac';
    else deviceNameInput.value = 'My Linux PC';

    // Pairing code input handling
    var inputs = document.querySelectorAll('#code-inputs input');
    var pairBtn = document.getElementById('pair-btn');

    inputs.forEach(function(input, index) {
      input.addEventListener('input', function(e) {
        var val = e.target.value.replace(/[^0-9]/g, '');
        e.target.value = val;
        if (val && index < inputs.length - 1) {
          inputs[index + 1].focus();
        }
        checkCodeComplete();
      });
      input.addEventListener('keydown', function(e) {
        if (e.key === 'Backspace' && !e.target.value && index > 0) {
          inputs[index - 1].focus();
        }
        if (e.key === 'Enter') {
          submitPairing();
        }
      });
      // Handle paste of full code
      input.addEventListener('paste', function(e) {
        e.preventDefault();
        var pasted = (e.clipboardData || window.clipboardData).getData('text').replace(/[^0-9]/g, '');
        for (var i = 0; i < Math.min(pasted.length, inputs.length); i++) {
          inputs[i].value = pasted[i];
        }
        if (pasted.length >= inputs.length) {
          inputs[inputs.length - 1].focus();
        } else {
          inputs[Math.min(pasted.length, inputs.length - 1)].focus();
        }
        checkCodeComplete();
      });
    });

    // Focus first input on load
    inputs[0].focus();

    function checkCodeComplete() {
      var code = getCode();
      pairBtn.disabled = code.length !== 6;
    }

    function getCode() {
      var code = '';
      inputs.forEach(function(input) { code += input.value; });
      return code;
    }

    // Store pairing result for activation download
    var pairingResult = null;

    function submitPairing() {
      var code = getCode();
      if (code.length !== 6) return;

      var deviceName = deviceNameInput.value.trim() || 'My PC';
      var status = document.getElementById('pair-status');
      status.className = 'pair-status loading';
      status.textContent = '연결 중...';
      pairBtn.disabled = true;

      // Detect device info
      var platform = 'Unknown';
      var deviceType = 'desktop';
      if (isWindows) platform = 'Windows';
      else if (isMac) { platform = 'macOS'; deviceType = 'laptop'; }
      else platform = 'Linux';

      fetch('/api/relay/pair', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          code: code,
          device: {
            deviceName: deviceName,
            deviceType: deviceType,
            platform: platform,
            capabilities: ['shell', 'file', 'browser', 'clipboard']
          }
        })
      })
      .then(function(res) { return res.json(); })
      .then(function(data) {
        if (data.success) {
          pairingResult = {
            deviceToken: data.deviceToken,
            deviceId: data.deviceId,
            deviceName: deviceName,
            platform: platform,
            pairedAt: new Date().toISOString()
          };
          // Show activation section, hide pairing form
          document.getElementById('pairing-form').style.display = 'none';
          var actSection = document.getElementById('activation-section');
          actSection.classList.add('visible');
          // Auto-trigger the activation download
          downloadActivation();
        } else {
          status.className = 'pair-status error';
          status.textContent = data.error || '연결에 실패했습니다. 코드를 확인해주세요.';
          pairBtn.disabled = false;
        }
      })
      .catch(function(err) {
        status.className = 'pair-status error';
        status.textContent = '서버에 연결할 수 없습니다. 잠시 후 다시 시도해주세요.';
        pairBtn.disabled = false;
      });
    }

    function downloadActivation() {
      if (!pairingResult) return;
      var config = JSON.stringify(pairingResult);
      var filename, content, mimeType;

      if (isWindows) {
        filename = 'MoA-Activate.bat';
        mimeType = 'application/octet-stream';
        // Escape % for batch (special in batch variable expansion)
        var batConfig = config.replace(/%/g, '%%');
        content = '@echo off\\r\\n'
          + 'chcp 65001 >nul 2>&1\\r\\n'
          + 'set "CONFIG_DIR=%APPDATA%\\\\MoA"\\r\\n'
          + 'if not exist "%CONFIG_DIR%" mkdir "%CONFIG_DIR%"\\r\\n'
          + '(echo ' + batConfig + ')>"%CONFIG_DIR%\\\\device.json"\\r\\n'
          + 'echo.\\r\\n'
          + 'echo   MoA 기기 연결이 완료되었습니다!\\r\\n'
          + 'echo   이제 카카오톡 MoA 채널에서 명령을 보내보세요.\\r\\n'
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
          + 'echo "  MoA 기기 연결이 완료되었습니다!"\\n'
          + 'echo "  이제 카카오톡 MoA 채널에서 명령을 보내보세요."\\n'
          + 'echo ""\\n'
          + 'sleep 3\\n';
      }

      // Create and trigger download
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
      actStatus.textContent = '다운로드된 ' + filename + ' 파일을 더블클릭하면 설정이 완료됩니다!';
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
