/**
 * MoA Settings & Channel Management Page
 *
 * Web-based UI for managing channels, skills, and device settings.
 * Served at /settings/* routes.
 */

import type { IncomingMessage, ServerResponse } from "node:http";

// ============================================
// Settings Page HTML Generator
// ============================================

function generateSettingsPage(): string {
  return `<!DOCTYPE html>
<html lang="ko">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>MoA 설정 - 채널 & 스킬 관리</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: #f5f5f7;
      min-height: 100vh;
      color: #1d1d1f;
    }
    .header {
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      color: white;
      padding: 20px 0;
      text-align: center;
    }
    .header h1 {
      font-size: 24px;
      font-weight: 700;
    }
    .header p {
      font-size: 14px;
      opacity: 0.9;
      margin-top: 4px;
    }
    .container {
      max-width: 800px;
      margin: 0 auto;
      padding: 20px;
    }
    .nav-tabs {
      display: flex;
      background: white;
      border-radius: 12px;
      overflow: hidden;
      margin-bottom: 20px;
      box-shadow: 0 2px 8px rgba(0,0,0,0.08);
    }
    .nav-tab {
      flex: 1;
      padding: 14px;
      text-align: center;
      cursor: pointer;
      font-size: 14px;
      font-weight: 600;
      border: none;
      background: white;
      color: #666;
      transition: all 0.2s;
    }
    .nav-tab.active {
      background: #667eea;
      color: white;
    }
    .nav-tab:hover:not(.active) {
      background: #f0f0f5;
    }
    .section {
      display: none;
    }
    .section.active {
      display: block;
    }
    .card {
      background: white;
      border-radius: 12px;
      padding: 20px;
      margin-bottom: 16px;
      box-shadow: 0 2px 8px rgba(0,0,0,0.08);
    }
    .card h3 {
      font-size: 16px;
      margin-bottom: 12px;
      display: flex;
      align-items: center;
      gap: 8px;
    }
    .channel-item {
      display: flex;
      align-items: center;
      padding: 12px 0;
      border-bottom: 1px solid #f0f0f5;
    }
    .channel-item:last-child {
      border-bottom: none;
    }
    .channel-icon {
      width: 40px;
      height: 40px;
      border-radius: 10px;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 20px;
      margin-right: 12px;
    }
    .channel-info {
      flex: 1;
    }
    .channel-name {
      font-weight: 600;
      font-size: 14px;
    }
    .channel-desc {
      font-size: 12px;
      color: #888;
      margin-top: 2px;
    }
    .status-badge {
      font-size: 11px;
      padding: 4px 10px;
      border-radius: 20px;
      font-weight: 600;
    }
    .status-active {
      background: #e8f5e9;
      color: #2e7d32;
    }
    .status-inactive {
      background: #fff3e0;
      color: #ef6c00;
    }
    .status-setup {
      background: #e3f2fd;
      color: #1565c0;
    }
    .skill-grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
      gap: 12px;
    }
    .skill-card {
      background: #f8f9fa;
      border-radius: 10px;
      padding: 14px;
      border: 1px solid #e9ecef;
      transition: all 0.2s;
    }
    .skill-card:hover {
      border-color: #667eea;
      box-shadow: 0 2px 8px rgba(102, 126, 234, 0.15);
    }
    .skill-emoji {
      font-size: 24px;
      margin-bottom: 6px;
    }
    .skill-name {
      font-weight: 600;
      font-size: 13px;
    }
    .skill-desc {
      font-size: 11px;
      color: #888;
      margin-top: 4px;
    }
    .skill-tags {
      display: flex;
      gap: 4px;
      margin-top: 8px;
      flex-wrap: wrap;
    }
    .skill-tag {
      font-size: 10px;
      background: #e9ecef;
      color: #666;
      padding: 2px 8px;
      border-radius: 10px;
    }
    .env-form {
      display: flex;
      flex-direction: column;
      gap: 12px;
    }
    .env-group {
      display: flex;
      flex-direction: column;
      gap: 4px;
    }
    .env-group label {
      font-size: 12px;
      font-weight: 600;
      color: #555;
    }
    .env-group input {
      padding: 10px 12px;
      border: 1px solid #ddd;
      border-radius: 8px;
      font-size: 14px;
      width: 100%;
    }
    .env-group input:focus {
      outline: none;
      border-color: #667eea;
      box-shadow: 0 0 0 3px rgba(102, 126, 234, 0.15);
    }
    .env-group .hint {
      font-size: 11px;
      color: #999;
    }
    .btn {
      padding: 10px 20px;
      border: none;
      border-radius: 8px;
      font-size: 14px;
      font-weight: 600;
      cursor: pointer;
      transition: all 0.2s;
    }
    .btn-primary {
      background: #667eea;
      color: white;
    }
    .btn-primary:hover {
      background: #5a6fd6;
    }
    .btn-secondary {
      background: #e9ecef;
      color: #555;
    }
    .guide-step {
      display: flex;
      gap: 12px;
      padding: 12px 0;
      border-bottom: 1px solid #f0f0f5;
    }
    .guide-step:last-child { border-bottom: none; }
    .step-num {
      width: 28px;
      height: 28px;
      background: #667eea;
      color: white;
      border-radius: 50%;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 13px;
      font-weight: 700;
      flex-shrink: 0;
    }
    .step-content h4 { font-size: 14px; margin-bottom: 4px; }
    .step-content p { font-size: 13px; color: #666; }
    .step-content a { color: #667eea; }
    .device-list {
      display: flex;
      flex-direction: column;
      gap: 8px;
    }
    .device-item {
      display: flex;
      align-items: center;
      padding: 12px;
      background: #f8f9fa;
      border-radius: 8px;
      gap: 12px;
    }
    .device-icon { font-size: 24px; }
    .device-info { flex: 1; }
    .device-name { font-weight: 600; font-size: 14px; }
    .device-meta { font-size: 12px; color: #888; }
    .empty-state {
      text-align: center;
      padding: 40px 20px;
      color: #999;
    }
    .empty-state p { margin-bottom: 12px; }
    .footer {
      text-align: center;
      padding: 20px;
      color: #999;
      font-size: 12px;
    }
    .footer a { color: #667eea; text-decoration: none; }
    @media (max-width: 600px) {
      .container { padding: 12px; }
      .nav-tab { padding: 10px; font-size: 12px; }
      .skill-grid { grid-template-columns: 1fr; }
    }
  </style>
</head>
<body>
  <div class="header">
    <h1>MoA 설정</h1>
    <p>채널, 스킬, 기기를 한 곳에서 관리하세요</p>
  </div>

  <div class="container">
    <div class="nav-tabs">
      <button class="nav-tab active" onclick="showSection('channels')">채널</button>
      <button class="nav-tab" onclick="showSection('skills')">스킬</button>
      <button class="nav-tab" onclick="showSection('devices')">기기</button>
      <button class="nav-tab" onclick="showSection('setup')">설정 가이드</button>
    </div>

    <!-- Channels Section -->
    <div id="section-channels" class="section active">
      <div class="card">
        <h3>연결된 채널</h3>
        <div id="channel-list">
          <div class="channel-item">
            <div class="channel-icon" style="background:#fee500;">
              <span>💬</span>
            </div>
            <div class="channel-info">
              <div class="channel-name">KakaoTalk</div>
              <div class="channel-desc">카카오 i 오픈빌더 웹훅</div>
            </div>
            <span class="status-badge status-active" id="status-kakao">활성</span>
          </div>
          <div class="channel-item">
            <div class="channel-icon" style="background:#0088cc;">
              <span>✈️</span>
            </div>
            <div class="channel-info">
              <div class="channel-name">Telegram</div>
              <div class="channel-desc">Telegram Bot API 웹훅</div>
            </div>
            <span class="status-badge" id="status-telegram">확인 중...</span>
          </div>
          <div class="channel-item">
            <div class="channel-icon" style="background:#25d366;">
              <span>📱</span>
            </div>
            <div class="channel-info">
              <div class="channel-name">WhatsApp</div>
              <div class="channel-desc">WhatsApp Cloud API (Meta)</div>
            </div>
            <span class="status-badge" id="status-whatsapp">확인 중...</span>
          </div>
          <div class="channel-item">
            <div class="channel-icon" style="background:#5865f2;">
              <span>🎮</span>
            </div>
            <div class="channel-info">
              <div class="channel-name">Discord</div>
              <div class="channel-desc">Discord Gateway 봇</div>
            </div>
            <span class="status-badge" id="status-discord">확인 중...</span>
          </div>
        </div>
      </div>

      <div class="card">
        <h3>채널 추가하기</h3>
        <p style="font-size:13px;color:#666;margin-bottom:12px;">
          새 채널을 연결하려면 해당 서비스의 API 키를 Railway 환경변수에 추가하세요.
        </p>
        <div class="env-form">
          <div class="env-group">
            <label>Telegram Bot Token</label>
            <input type="password" placeholder="1234567890:ABCdefGHIjklMNOpqrsTUVwxyz" id="env-telegram" />
            <span class="hint">@BotFather에서 발급 (TELEGRAM_BOT_TOKEN)</span>
          </div>
          <div class="env-group">
            <label>WhatsApp Token</label>
            <input type="password" placeholder="EAABwzL..." id="env-whatsapp-token" />
            <span class="hint">Meta Business에서 발급 (WHATSAPP_TOKEN)</span>
          </div>
          <div class="env-group">
            <label>WhatsApp Phone Number ID</label>
            <input type="text" placeholder="123456789012345" id="env-whatsapp-phone" />
            <span class="hint">WhatsApp Business 전화번호 ID (WHATSAPP_PHONE_NUMBER_ID)</span>
          </div>
          <div class="env-group">
            <label>Discord Bot Token</label>
            <input type="password" placeholder="MTIzNDU2Nzg5..." id="env-discord" />
            <span class="hint">Discord Developer Portal에서 발급 (DISCORD_BOT_TOKEN)</span>
          </div>
          <p style="font-size:12px;color:#999;margin-top:8px;">
            * 환경변수는 Railway 대시보드에서 직접 설정해야 합니다.
            여기에 입력된 값은 저장되지 않으며, 참고용으로만 제공됩니다.
          </p>
        </div>
      </div>
    </div>

    <!-- Skills Section -->
    <div id="section-skills" class="section">
      <div class="card">
        <h3>사용 가능한 스킬</h3>
        <p style="font-size:13px;color:#666;margin-bottom:16px;">
          MoA가 설치된 기기에서 사용할 수 있는 스킬 목록입니다.
        </p>
        <div class="skill-grid" id="skill-grid">
          <!-- Populated by JS -->
        </div>
      </div>

      <div class="card">
        <h3>스킬 마켓플레이스</h3>
        <p style="font-size:13px;color:#666;margin-bottom:12px;">
          ClawHub에서 더 많은 스킬을 검색하고 설치할 수 있습니다.
        </p>
        <div style="display:flex;gap:8px;margin-bottom:16px;">
          <input type="text" placeholder="스킬 검색..." id="skill-search"
            style="flex:1;padding:10px 12px;border:1px solid #ddd;border-radius:8px;font-size:14px;" />
          <button class="btn btn-primary" onclick="searchSkills()">검색</button>
        </div>
        <div class="skill-grid" id="market-grid">
          <!-- Populated by JS -->
        </div>
      </div>
    </div>

    <!-- Devices Section -->
    <div id="section-devices" class="section">
      <div class="card">
        <h3>연결된 기기</h3>
        <div class="device-list" id="device-list">
          <div class="empty-state">
            <p>연결된 기기가 없습니다.</p>
            <a href="/welcome" class="btn btn-primary" style="display:inline-block;text-decoration:none;">기기 등록하기</a>
          </div>
        </div>
      </div>

      <div class="card">
        <h3>새 기기 연결</h3>
        <div class="guide-step">
          <div class="step-num">1</div>
          <div class="step-content">
            <h4>MoA 설치</h4>
            <p><a href="/install">설치 페이지</a>에서 MoA를 다운로드하세요.</p>
          </div>
        </div>
        <div class="guide-step">
          <div class="step-num">2</div>
          <div class="step-content">
            <h4>기기 등록</h4>
            <p>설치 후 <a href="/welcome">Welcome 페이지</a>에서 페어링 코드를 입력하세요.</p>
          </div>
        </div>
        <div class="guide-step">
          <div class="step-num">3</div>
          <div class="step-content">
            <h4>사용 시작</h4>
            <p>카카오톡/텔레그램/WhatsApp/Discord에서 "@기기명 명령"으로 원격 제어!</p>
          </div>
        </div>
      </div>
    </div>

    <!-- Setup Guide Section -->
    <div id="section-setup" class="section">
      <div class="card">
        <h3>Telegram 봇 설정</h3>
        <div class="guide-step">
          <div class="step-num">1</div>
          <div class="step-content">
            <h4>BotFather에서 봇 생성</h4>
            <p>Telegram에서 <a href="https://t.me/BotFather" target="_blank">@BotFather</a>를 찾아 /newbot 명령으로 봇을 만드세요.</p>
          </div>
        </div>
        <div class="guide-step">
          <div class="step-num">2</div>
          <div class="step-content">
            <h4>토큰 복사</h4>
            <p>BotFather가 제공하는 Bot Token을 복사하세요.</p>
          </div>
        </div>
        <div class="guide-step">
          <div class="step-num">3</div>
          <div class="step-content">
            <h4>Railway 환경변수 설정</h4>
            <p>Railway 대시보드에서 TELEGRAM_BOT_TOKEN 환경변수를 추가하세요.</p>
          </div>
        </div>
      </div>

      <div class="card">
        <h3>WhatsApp Cloud API 설정</h3>
        <div class="guide-step">
          <div class="step-num">1</div>
          <div class="step-content">
            <h4>Meta 개발자 앱 생성</h4>
            <p><a href="https://developers.facebook.com" target="_blank">developers.facebook.com</a>에서 앱을 만드세요.</p>
          </div>
        </div>
        <div class="guide-step">
          <div class="step-num">2</div>
          <div class="step-content">
            <h4>WhatsApp 제품 추가</h4>
            <p>앱에 WhatsApp 제품을 추가하고 웹훅을 설정하세요.</p>
          </div>
        </div>
        <div class="guide-step">
          <div class="step-num">3</div>
          <div class="step-content">
            <h4>환경변수 설정</h4>
            <p>WHATSAPP_TOKEN, WHATSAPP_PHONE_NUMBER_ID를 Railway에 추가하세요.</p>
          </div>
        </div>
        <div class="guide-step">
          <div class="step-num">4</div>
          <div class="step-content">
            <h4>웹훅 URL 설정</h4>
            <p>Webhook URL: <code>https://moa.lawith.kr/whatsapp/webhook</code></p>
          </div>
        </div>
      </div>

      <div class="card">
        <h3>Discord 봇 설정</h3>
        <div class="guide-step">
          <div class="step-num">1</div>
          <div class="step-content">
            <h4>Discord 앱 생성</h4>
            <p><a href="https://discord.com/developers/applications" target="_blank">Discord Developer Portal</a>에서 앱을 만드세요.</p>
          </div>
        </div>
        <div class="guide-step">
          <div class="step-num">2</div>
          <div class="step-content">
            <h4>봇 설정</h4>
            <p>Bot 탭에서 토큰을 복사하고 MESSAGE CONTENT INTENT를 활성화하세요.</p>
          </div>
        </div>
        <div class="guide-step">
          <div class="step-num">3</div>
          <div class="step-content">
            <h4>봇 초대</h4>
            <p>OAuth2 &gt; URL Generator에서 bot scope + Send Messages 권한으로 초대 링크를 만드세요.</p>
          </div>
        </div>
        <div class="guide-step">
          <div class="step-num">4</div>
          <div class="step-content">
            <h4>환경변수 설정</h4>
            <p>DISCORD_BOT_TOKEN을 Railway에 추가하세요.</p>
          </div>
        </div>
      </div>
    </div>
  </div>

  <div class="footer">
    <p>MoA (Master of AI) &mdash; <a href="/">홈</a> &middot; <a href="/install">설치</a> &middot; <a href="/welcome">기기 등록</a></p>
  </div>

  <script>
    // Tab navigation
    function showSection(name) {
      document.querySelectorAll('.section').forEach(s => s.classList.remove('active'));
      document.querySelectorAll('.nav-tab').forEach(t => t.classList.remove('active'));
      document.getElementById('section-' + name).classList.add('active');
      event.target.classList.add('active');
    }

    // Check channel status
    async function checkChannelStatus() {
      try {
        const res = await fetch('/health');
        if (res.ok) {
          const data = await res.json().catch(() => null);
          updateChannelStatus('kakao', true);

          // These are approximations based on health check
          // Actual status requires server-side checking
          if (data) {
            updateChannelStatus('telegram', data.telegram || false);
            updateChannelStatus('whatsapp', data.whatsapp || false);
            updateChannelStatus('discord', data.discord || false);
          }
        }
      } catch {
        // Health check failed - show all as unknown
        ['kakao', 'telegram', 'whatsapp', 'discord'].forEach(ch => {
          updateChannelStatus(ch, null);
        });
      }
    }

    function updateChannelStatus(channel, active) {
      const el = document.getElementById('status-' + channel);
      if (!el) return;
      if (active === true) {
        el.textContent = '활성';
        el.className = 'status-badge status-active';
      } else if (active === false) {
        el.textContent = '미설정';
        el.className = 'status-badge status-inactive';
      } else {
        el.textContent = '확인 불가';
        el.className = 'status-badge status-setup';
      }
    }

    // Skill display
    const builtinSkills = [
      { emoji: '\\u{1F324}\\uFE0F', name: 'Weather', desc: '날씨 확인' },
      { emoji: '\\u{1F4DD}', name: 'Notion', desc: '노트 관리' },
      { emoji: '\\u{1F4CB}', name: 'Trello', desc: '프로젝트 관리' },
      { emoji: '\\u{1F5BC}\\uFE0F', name: 'AI Image Gen', desc: '이미지 생성' },
      { emoji: '\\u{1F3B5}', name: 'Spotify', desc: '음악 재생' },
      { emoji: '\\u{1F4E7}', name: 'Email', desc: '이메일 관리' },
      { emoji: '\\u{1F4CD}', name: 'Local Places', desc: '주변 장소 찾기' },
      { emoji: '\\u{1F4F0}', name: 'Blog Watcher', desc: '블로그 모니터링' },
      { emoji: '\\u{1F4D1}', name: 'PDF Reader', desc: 'PDF 읽기' },
      { emoji: '\\u{1F4C4}', name: 'Summarize', desc: '텍스트 요약' },
      { emoji: '\\u{1F419}', name: 'GitHub', desc: 'GitHub 관리' },
      { emoji: '\\u{1F4BB}', name: 'Coding Agent', desc: '코딩 어시스턴트' },
      { emoji: '\\u{1F48E}', name: 'Obsidian', desc: '지식 관리' },
      { emoji: '\\u{1F4F8}', name: 'Camera Snap', desc: '사진 촬영' },
      { emoji: '\\u{23F0}', name: 'Reminders', desc: '미리알림 관리' },
      { emoji: '\\u{1F5D2}\\uFE0F', name: 'Apple Notes', desc: '메모 관리' },
    ];

    function renderSkills() {
      const grid = document.getElementById('skill-grid');
      grid.innerHTML = builtinSkills.map(s => \`
        <div class="skill-card">
          <div class="skill-emoji">\${s.emoji}</div>
          <div class="skill-name">\${s.name}</div>
          <div class="skill-desc">\${s.desc}</div>
        </div>
      \`).join('');
    }

    function searchSkills() {
      const q = document.getElementById('skill-search').value.toLowerCase();
      const grid = document.getElementById('market-grid');
      const filtered = builtinSkills.filter(s =>
        s.name.toLowerCase().includes(q) || s.desc.includes(q)
      );
      grid.innerHTML = filtered.length > 0
        ? filtered.map(s => \`
            <div class="skill-card">
              <div class="skill-emoji">\${s.emoji}</div>
              <div class="skill-name">\${s.name}</div>
              <div class="skill-desc">\${s.desc}</div>
            </div>
          \`).join('')
        : '<div class="empty-state"><p>검색 결과가 없습니다.</p></div>';
    }

    // Load device list
    async function loadDevices() {
      try {
        const res = await fetch('/api/relay/devices');
        if (res.ok) {
          const data = await res.json();
          const list = document.getElementById('device-list');
          if (data.devices && data.devices.length > 0) {
            list.innerHTML = data.devices.map(d => \`
              <div class="device-item">
                <div class="device-icon">\${d.platform === 'windows' ? '\\u{1F5A5}' : d.platform === 'darwin' ? '\\u{1F4BB}' : '\\u{1F5A5}'}</div>
                <div class="device-info">
                  <div class="device-name">\${d.name || d.device_id}</div>
                  <div class="device-meta">\${d.platform || '알 수 없음'} &middot; \${d.last_seen ? new Date(d.last_seen).toLocaleString('ko-KR') : '정보 없음'}</div>
                </div>
              </div>
            \`).join('');
          }
        }
      } catch {
        // Silently fail
      }
    }

    // Init
    checkChannelStatus();
    renderSkills();
    loadDevices();

    // Enter key for skill search
    document.getElementById('skill-search').addEventListener('keydown', function(e) {
      if (e.key === 'Enter') searchSkills();
    });
  </script>
</body>
</html>`;
}

// ============================================
// Settings Request Handler
// ============================================

/**
 * Handle settings page requests.
 * Routes: GET /settings, GET /settings/*
 */
export function handleSettingsRequest(
  req: IncomingMessage,
  res: ServerResponse,
): boolean {
  const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);

  if (!url.pathname.startsWith("/settings")) {
    return false;
  }

  if (req.method !== "GET") {
    res.writeHead(405);
    res.end("Method Not Allowed");
    return true;
  }

  const html = generateSettingsPage();
  res.writeHead(200, {
    "Content-Type": "text/html; charset=utf-8",
    "Cache-Control": "public, max-age=60",
  });
  res.end(html);
  return true;
}
