/**
 * MoA Desktop App — Electron Main Process (Production)
 *
 * Windows/macOS/Linux 데스크톱 앱.
 * 커스텀 타이틀바, 스플래시 스크린, 사이드바 내비게이션,
 * 자동 업데이트, 로컬 파일 시스템 접근.
 *
 * Architecture:
 *   1. 스플래시 스크린 표시 (로컬 HTML)
 *   2. 웹앱 로드 + 인증 상태 확인
 *   3. 로그인/회원가입 or 채팅 페이지로 라우팅
 *   4. 프로덕션 UI 인젝션 (사이드바, 헤더, 크레딧 표시)
 */

const {
  app,
  BrowserWindow,
  ipcMain,
  Tray,
  Menu,
  shell,
  dialog,
  nativeImage,
  Notification,
  screen,
} = require("electron");
const path = require("path");
const fs = require("fs");
const os = require("os");
const { autoUpdater } = require("electron-updater");

// ─── Constants ───────────────────────────────────────────────
const MOA_URL = "https://mymoa.app";
const APP_NAME = "MoA";
const IS_DEV = process.argv.includes("--dev");
const IS_WIN = process.platform === "win32";
const IS_MAC = process.platform === "darwin";
const STATE_FILE = path.join(app.getPath("userData"), "window-state.json");

let mainWindow = null;
let splashWindow = null;
let tray = null;

// ─── Window State Persistence ────────────────────────────────

function loadWindowState() {
  try {
    if (fs.existsSync(STATE_FILE)) {
      const state = JSON.parse(fs.readFileSync(STATE_FILE, "utf-8"));
      const displays = screen.getAllDisplays();
      const visible = displays.some((d) => {
        const b = d.bounds;
        return state.x >= b.x && state.x < b.x + b.width &&
               state.y >= b.y && state.y < b.y + b.height;
      });
      if (visible) return state;
    }
  } catch { /* ignore */ }
  return { width: 1360, height: 900, x: undefined, y: undefined, maximized: false };
}

function saveWindowState() {
  if (!mainWindow) return;
  try {
    const bounds = mainWindow.getBounds();
    const state = {
      width: bounds.width, height: bounds.height,
      x: bounds.x, y: bounds.y,
      maximized: mainWindow.isMaximized(),
    };
    fs.writeFileSync(STATE_FILE, JSON.stringify(state));
  } catch { /* ignore */ }
}

// ─── Splash Screen ───────────────────────────────────────────

function createSplashWindow() {
  splashWindow = new BrowserWindow({
    width: 480,
    height: 420,
    frame: false,
    transparent: true,
    resizable: false,
    skipTaskbar: true,
    center: true,
    alwaysOnTop: true,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
    icon: getIconPath(),
    backgroundColor: "#00000000",
  });

  splashWindow.loadFile(path.join(__dirname, "splash.html"));
  splashWindow.setMenu(null);
}

function closeSplash() {
  if (splashWindow && !splashWindow.isDestroyed()) {
    splashWindow.close();
    splashWindow = null;
  }
}

// ─── Main Window ─────────────────────────────────────────────

function createWindow() {
  const state = loadWindowState();

  mainWindow = new BrowserWindow({
    width: state.width,
    height: state.height,
    x: state.x,
    y: state.y,
    minWidth: 960,
    minHeight: 640,
    title: APP_NAME,
    icon: getIconPath(),
    frame: false,
    titleBarStyle: IS_MAC ? "hiddenInset" : "default",
    trafficLightPosition: IS_MAC ? { x: 16, y: 14 } : undefined,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
    backgroundColor: "#0a0a1a",
    show: false,
  });

  if (state.maximized) mainWindow.maximize();

  // Start at login page
  mainWindow.loadURL(`${MOA_URL}/login`);

  mainWindow.once("ready-to-show", () => {
    setTimeout(() => {
      mainWindow.show();
      mainWindow.focus();
      closeSplash();
    }, 600);
  });

  // Inject production UI on every page load
  mainWindow.webContents.on("did-finish-load", () => {
    injectProductionUI();
  });

  mainWindow.webContents.on("did-navigate-in-page", () => {
    injectProductionUI();
  });

  // External links in system browser
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith("http") && !url.includes("mymoa.app")) {
      shell.openExternal(url);
      return { action: "deny" };
    }
    return { action: "allow" };
  });

  // Minimize to tray on close
  mainWindow.on("close", (e) => {
    if (!app.isQuitting) {
      e.preventDefault();
      saveWindowState();
      mainWindow.hide();
      if (IS_WIN) showTrayNotification("MoA가 시스템 트레이에서 실행 중입니다.");
    }
  });

  mainWindow.on("resize", debounce(saveWindowState, 500));
  mainWindow.on("move", debounce(saveWindowState, 500));

  if (IS_DEV) mainWindow.webContents.openDevTools({ mode: "detach" });
}

// ─── Production UI Injection ─────────────────────────────────

function injectProductionUI() {
  if (!mainWindow) return;

  const isMac = IS_MAC;

  mainWindow.webContents.executeJavaScript(`
(function() {
  'use strict';
  if (document.getElementById('moa-desktop-shell')) return;

  var currentPath = window.location.pathname;
  var isAuthPage = currentPath === '/login' || currentPath === '/register' || currentPath.startsWith('/verify-email');

  // ── Styles ──
  var style = document.createElement('style');
  style.id = 'moa-desktop-styles';
  style.textContent = [
    '#moa-desktop-titlebar {',
    '  position:fixed;top:0;left:0;right:0;z-index:99999;height:36px;',
    '  background:#08081a;border-bottom:1px solid rgba(255,255,255,0.06);',
    '  display:flex;align-items:center;justify-content:space-between;',
    '  -webkit-app-region:drag;user-select:none;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;',
    '}',
    '.moa-tb-drag{display:flex;align-items:center;gap:16px;padding-left:${isMac ? "80" : "16"}px;flex:1;}',
    '.moa-tb-logo{display:flex;align-items:center;gap:8px;}',
    '.moa-tb-icon{font-size:16px;}',
    '.moa-tb-brand{font-size:13px;font-weight:800;background:linear-gradient(135deg,#667eea,#a78bfa);-webkit-background-clip:text;-webkit-text-fill-color:transparent;}',
    '.moa-tb-credits{display:flex;align-items:center;gap:6px;padding:3px 12px;border-radius:12px;background:rgba(102,126,234,0.1);border:1px solid rgba(102,126,234,0.15);cursor:pointer;-webkit-app-region:no-drag;transition:background 0.2s;}',
    '.moa-tb-credits:hover{background:rgba(102,126,234,0.2);}',
    '.moa-tb-credits-icon{font-size:11px;}',
    '.moa-tb-credits-value{font-size:12px;font-weight:700;color:#a78bfa;}',
    '.moa-tb-credits-label{font-size:10px;color:#9a9ab0;font-weight:500;}',
    '.moa-tb-controls{display:${isMac ? "none" : "flex"};-webkit-app-region:no-drag;}',
    '.moa-tb-btn{width:46px;height:36px;border:none;background:none;color:#9a9ab0;display:flex;align-items:center;justify-content:center;cursor:pointer;transition:background 0.15s,color 0.15s;}',
    '.moa-tb-btn:hover{background:rgba(255,255,255,0.08);color:#fff;}',
    '.moa-tb-close:hover{background:#e81123;color:#fff;}',

    '#moa-desktop-sidebar{position:fixed;top:36px;left:0;bottom:0;width:200px;z-index:99998;background:#0c0c22;border-right:1px solid rgba(255,255,255,0.06);display:flex;flex-direction:column;justify-content:space-between;overflow-y:auto;overflow-x:hidden;scrollbar-width:none;}',
    '#moa-desktop-sidebar::-webkit-scrollbar{display:none;}',
    '.moa-sb-top{padding:12px 8px 8px;}',
    '.moa-sb-bottom{padding:4px 8px 12px;}',
    '.moa-sb-section-label{font-size:10px;font-weight:600;color:#6a6a8a;text-transform:uppercase;letter-spacing:1.5px;padding:8px 12px 6px;margin-bottom:2px;}',
    '.moa-sb-item{display:flex;align-items:center;gap:10px;padding:9px 12px;border-radius:8px;color:#9a9ab0;text-decoration:none;font-size:13px;font-weight:500;transition:all 0.15s;cursor:pointer;position:relative;margin-bottom:1px;}',
    '.moa-sb-item:hover{background:rgba(255,255,255,0.05);color:#e8e8f0;text-decoration:none;}',
    '.moa-sb-item.active{background:rgba(102,126,234,0.12);color:#667eea;font-weight:600;}',
    '.moa-sb-item.active::before{content:"";position:absolute;left:0;top:50%;transform:translateY(-50%);width:3px;height:20px;border-radius:0 3px 3px 0;background:#667eea;}',
    '.moa-sb-icon{font-size:16px;width:22px;text-align:center;flex-shrink:0;}',
    '.moa-sb-label{flex:1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}',
    '.moa-sb-hotkey{font-size:9px;color:#5a5a7a;background:rgba(255,255,255,0.04);padding:2px 6px;border-radius:4px;font-family:monospace;flex-shrink:0;}',
    '.moa-sb-divider{height:1px;background:rgba(255,255,255,0.06);margin:8px 12px;}',
    '.moa-sb-version{font-size:10px;color:#4a4a6a;text-align:center;padding:8px 0 0;}',

    'body{padding-top:36px !important;' + (isAuthPage ? '' : 'padding-left:200px !important;') + '}',
    '.chat-sidebar{display:none !important;}',
    '.chat-menu-btn{display:none !important;}',
    '.chat-layout{grid-template-columns:1fr !important;}',

    '@media(max-width:1100px){',
    '  #moa-desktop-sidebar{width:56px;}',
    '  .moa-sb-label,.moa-sb-hotkey,.moa-sb-section-label{display:none;}',
    '  .moa-sb-item{justify-content:center;padding:10px 0;}',
    '  .moa-sb-icon{width:auto;font-size:18px;}',
    '  .moa-sb-version{display:none;}',
    '  body{padding-left:56px !important;}',
    '}',

    '#moa-update-bar{position:fixed;top:36px;left:0;right:0;z-index:99997;background:linear-gradient(135deg,#667eea,#764ba2);color:#fff;padding:8px 20px;font-size:13px;font-weight:500;display:flex;align-items:center;justify-content:center;gap:12px;box-shadow:0 2px 8px rgba(0,0,0,0.3);}',
    '#moa-update-progress{width:120px;height:4px;background:rgba(255,255,255,0.25);border-radius:2px;overflow:hidden;}',
    '#moa-update-bar-fill{width:0%;height:100%;background:#fff;border-radius:2px;transition:width 0.3s;}',
    '#moa-offline-bar{position:fixed;top:36px;left:0;right:0;z-index:99996;background:rgba(252,129,129,0.15);border-bottom:1px solid rgba(252,129,129,0.3);color:#fc8181;padding:6px 20px;font-size:12px;text-align:center;display:none;}',
  ].join('\\n');

  // ── Remove old injections ──
  ['moa-desktop-shell','moa-desktop-styles','moa-desktop-nav','moa-desktop-titlebar','moa-desktop-sidebar'].forEach(function(id) {
    var el = document.getElementById(id);
    if (el) el.remove();
  });

  document.head.appendChild(style);

  // ── Title Bar ──
  var titleBar = document.createElement('div');
  titleBar.id = 'moa-desktop-titlebar';
  titleBar.innerHTML = '<div class="moa-tb-drag">'
    + '<div class="moa-tb-logo"><span class="moa-tb-icon">\\u{1F916}</span><span class="moa-tb-brand">MoA</span></div>'
    + '<div class="moa-tb-credits" id="moa-tb-credits" style="display:none"><span class="moa-tb-credits-icon">\\u{1F4B3}</span><span class="moa-tb-credits-value" id="moa-credits-value">-</span><span class="moa-tb-credits-label">\\uD06C\\uB808\\uB527</span></div>'
    + '</div>'
    + '<div class="moa-tb-controls">'
    + '<button class="moa-tb-btn moa-tb-min" id="moa-tb-min" title="\\uCD5C\\uC18C\\uD654"><svg width="10" height="1" viewBox="0 0 10 1"><rect width="10" height="1" fill="currentColor"/></svg></button>'
    + '<button class="moa-tb-btn moa-tb-max" id="moa-tb-max" title="\\uCD5C\\uB300\\uD654"><svg width="10" height="10" viewBox="0 0 10 10"><rect x="0.5" y="0.5" width="9" height="9" fill="none" stroke="currentColor" stroke-width="1"/></svg></button>'
    + '<button class="moa-tb-btn moa-tb-close" id="moa-tb-close" title="\\uB2EB\\uAE30"><svg width="10" height="10" viewBox="0 0 10 10"><line x1="0" y1="0" x2="10" y2="10" stroke="currentColor" stroke-width="1.2"/><line x1="10" y1="0" x2="0" y2="10" stroke="currentColor" stroke-width="1.2"/></svg></button>'
    + '</div>';
  document.body.prepend(titleBar);

  // ── Sidebar (not on auth pages) ──
  if (!isAuthPage) {
    var sidebar = document.createElement('div');
    sidebar.id = 'moa-desktop-sidebar';

    var navItems = [
      {id:'chat',label:'AI \\uCC44\\uD305',icon:'\\uD83D\\uDCAC',path:'/chat',hotkey:'Ctrl+1'},
      {id:'synthesis',label:'\\uC885\\uD569\\uBB38\\uC11C',icon:'\\uD83D\\uDCD1',path:'/synthesis',hotkey:'Ctrl+2'},
      {id:'autocode',label:'AI \\uCF54\\uB529',icon:'\\uD83E\\uDD16',path:'/autocode',hotkey:'Ctrl+3'},
      {id:'editor',label:'\\uC5D0\\uB514\\uD130',icon:'\\uD83D\\uDCDD',path:'/editor',hotkey:'Ctrl+4'},
      {id:'interpreter',label:'\\uC2E4\\uC2DC\\uAC04 \\uD1B5\\uC5ED',icon:'\\uD83D\\uDDE3\\uFE0F',path:'/interpreter',hotkey:'Ctrl+5'},
      {id:'image',label:'\\uC774\\uBBF8\\uC9C0',icon:'\\uD83C\\uDFA8',path:'/chat?cat=image',hotkey:''},
      {id:'music',label:'\\uC74C\\uC545',icon:'\\uD83C\\uDFB5',path:'/chat?cat=music',hotkey:''},
    ];
    var bottomItems = [
      {id:'channels',label:'\\uCC44\\uB110 \\uD5C8\\uBE0C',icon:'\\uD83D\\uDCE1',path:'/channels'},
      {id:'billing',label:'\\uACB0\\uC81C',icon:'\\uD83D\\uDCB3',path:'/billing'},
      {id:'mypage',label:'\\uB9C8\\uC774\\uD398\\uC774\\uC9C0',icon:'\\u2699\\uFE0F',path:'/mypage'},
      {id:'download',label:'\\uB2E4\\uC6B4\\uB85C\\uB4DC',icon:'\\uD83D\\uDCE5',path:'/download'},
    ];

    function isActive(p) {
      if (p.indexOf('?') !== -1) return currentPath === p.split('?')[0] && window.location.search.indexOf(p.split('?')[1]) !== -1;
      return currentPath === p || currentPath.indexOf(p + '/') === 0;
    }

    function renderItems(items) {
      return items.map(function(item) {
        var active = isActive(item.path);
        return '<a href="' + item.path + '" class="moa-sb-item' + (active ? ' active' : '') + '" data-path="' + item.path + '" title="' + item.label + (item.hotkey ? ' (' + item.hotkey + ')' : '') + '">'
          + '<span class="moa-sb-icon">' + item.icon + '</span>'
          + '<span class="moa-sb-label">' + item.label + '</span>'
          + (item.hotkey ? '<span class="moa-sb-hotkey">' + item.hotkey + '</span>' : '')
          + '</a>';
      }).join('');
    }

    sidebar.innerHTML = '<div class="moa-sb-top">'
      + '<div class="moa-sb-section-label">\\uC8FC\\uC694 \\uAE30\\uB2A5</div>'
      + renderItems(navItems)
      + '</div>'
      + '<div class="moa-sb-bottom">'
      + '<div class="moa-sb-divider"></div>'
      + renderItems(bottomItems)
      + '<div class="moa-sb-version" id="moa-sb-version"></div>'
      + '</div>';

    document.body.prepend(sidebar);

    sidebar.querySelectorAll('.moa-sb-item').forEach(function(a) {
      a.addEventListener('click', function(e) {
        e.preventDefault();
        window.location.href = a.getAttribute('data-path');
      });
    });
  }

  // ── Shell marker ──
  var shell = document.createElement('div');
  shell.id = 'moa-desktop-shell';
  shell.style.display = 'none';
  document.body.appendChild(shell);

  // ── Wire window controls ──
  var minBtn = document.getElementById('moa-tb-min');
  var maxBtn = document.getElementById('moa-tb-max');
  var closeBtn = document.getElementById('moa-tb-close');
  if (minBtn) minBtn.onclick = function() { window.moaDesktop && window.moaDesktop.windowControl('minimize'); };
  if (maxBtn) maxBtn.onclick = function() { window.moaDesktop && window.moaDesktop.windowControl('maximize'); };
  if (closeBtn) closeBtn.onclick = function() { window.moaDesktop && window.moaDesktop.windowControl('close'); };

  // ── Credits click → billing page ──
  var creditsEl = document.getElementById('moa-tb-credits');
  if (creditsEl) creditsEl.onclick = function() { window.location.href = '/billing'; };

  // ── Load credits ──
  try {
    var authData = sessionStorage.getItem('moa_web_auth');
    if (authData) {
      var auth = JSON.parse(authData);
      if (auth.user_id) {
        var cc = document.getElementById('moa-tb-credits');
        if (cc) cc.style.display = 'flex';
        fetch('/api/credits?user_id=' + encodeURIComponent(auth.user_id))
          .then(function(r) { return r.json(); })
          .then(function(data) {
            var val = document.getElementById('moa-credits-value');
            if (val && data.balance !== undefined) {
              val.textContent = Number(data.balance).toLocaleString();
              if (data.balance < 10) val.style.color = '#fc8181';
            }
          }).catch(function(){});
      }
    }
  } catch(e) {}

  // ── Version in sidebar ──
  if (window.moaDesktop) {
    window.moaDesktop.getVersion().then(function(v) {
      var el = document.getElementById('moa-sb-version');
      if (el) el.textContent = 'MoA Desktop v' + v;
    }).catch(function(){});
  }

  // ── Offline detection ──
  var offlineBar = document.createElement('div');
  offlineBar.id = 'moa-offline-bar';
  offlineBar.textContent = '\\uC624\\uD504\\uB77C\\uC778 \\uC0C1\\uD0DC\\uC785\\uB2C8\\uB2E4. \\uC778\\uD130\\uB137 \\uC5F0\\uACB0\\uC744 \\uD655\\uC778\\uD574\\uC8FC\\uC138\\uC694.';
  document.body.appendChild(offlineBar);
  window.addEventListener('offline', function() { offlineBar.style.display = 'block'; });
  window.addEventListener('online', function() { offlineBar.style.display = 'none'; });
  if (!navigator.onLine) offlineBar.style.display = 'block';

})();
  `).catch(() => {});
}

// ─── Auto Updater ────────────────────────────────────────────

function setupAutoUpdater() {
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;

  autoUpdater.on("checking-for-update", () => {
    sendUpdateStatus("checking", "업데이트를 확인하고 있습니다...");
  });

  autoUpdater.on("update-available", (info) => {
    sendUpdateStatus("available", `새 버전 v${info.version}을 다운로드합니다...`);
    if (mainWindow) {
      mainWindow.webContents.executeJavaScript(`
        (function() {
          var old = document.getElementById('moa-update-bar');
          if (old) old.remove();
          var bar = document.createElement('div');
          bar.id = 'moa-update-bar';
          bar.innerHTML = '<span>\\u2B07\\uFE0F MoA v${info.version} \\uC5C5\\uB370\\uC774\\uD2B8\\uB97C \\uB2E4\\uC6B4\\uB85C\\uB4DC\\uD558\\uACE0 \\uC788\\uC2B5\\uB2C8\\uB2E4...</span><div id="moa-update-progress"><div id="moa-update-bar-fill"></div></div>';
          var tb = document.getElementById('moa-desktop-titlebar');
          if (tb) tb.after(bar); else document.body.prepend(bar);
        })();
      `).catch(() => {});
    }
  });

  autoUpdater.on("download-progress", (progress) => {
    const pct = Math.round(progress.percent);
    sendUpdateStatus("downloading", `다운로드 중... ${pct}%`);
    if (mainWindow) {
      mainWindow.webContents.executeJavaScript(`
        var fill = document.getElementById('moa-update-bar-fill');
        if (fill) fill.style.width = '${pct}%';
      `).catch(() => {});
    }
  });

  autoUpdater.on("update-downloaded", (info) => {
    sendUpdateStatus("ready", `v${info.version} 업데이트가 준비되었습니다.`);
    if (mainWindow) {
      mainWindow.webContents.executeJavaScript(`
        var bar = document.getElementById('moa-update-bar');
        if (bar) bar.innerHTML = '<span>\\u2705 MoA v${info.version} \\uC5C5\\uB370\\uC774\\uD2B8\\uAC00 \\uC900\\uBE44\\uB418\\uC5C8\\uC2B5\\uB2C8\\uB2E4. 3\\uCD08 \\uD6C4 \\uC7AC\\uC2DC\\uC791\\uD569\\uB2C8\\uB2E4...</span>';
      `).catch(() => {});
    }
    setTimeout(() => autoUpdater.quitAndInstall(false, true), 3000);
  });

  autoUpdater.on("update-not-available", () => {
    sendUpdateStatus("latest", "최신 버전입니다.");
  });

  autoUpdater.on("error", (err) => {
    sendUpdateStatus("error", `업데이트 확인 실패: ${err.message}`);
  });

  if (!IS_DEV) autoUpdater.checkForUpdates().catch(() => {});
}

function sendUpdateStatus(status, message) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send("moa:updateStatus", { status, message });
  }
  if (splashWindow && !splashWindow.isDestroyed()) {
    splashWindow.webContents.send("moa:updateStatus", { status, message });
  }
}

// ─── System Tray ─────────────────────────────────────────────

function createTray() {
  const iconPath = getTrayIconPath();
  const icon = nativeImage.createFromPath(iconPath).resize({ width: 16, height: 16 });
  tray = new Tray(icon);

  const nav = (p) => () => {
    if (mainWindow) {
      mainWindow.loadURL(`${MOA_URL}${p}`);
      mainWindow.show();
      mainWindow.focus();
    }
  };

  const contextMenu = Menu.buildFromTemplate([
    { label: "MoA 열기", click: () => { if (mainWindow) { mainWindow.show(); mainWindow.focus(); } } },
    { type: "separator" },
    { label: "\uD83D\uDCAC AI 채팅", click: nav("/chat") },
    { label: "\uD83D\uDCD1 종합문서", click: nav("/synthesis") },
    { label: "\uD83E\uDD16 AI 자동코딩", click: nav("/autocode") },
    { label: "\uD83D\uDCDD 문서 에디터", click: nav("/editor") },
    { label: "\uD83D\uDDE3\uFE0F 실시간 통역", click: nav("/interpreter") },
    { type: "separator" },
    { label: "\uD83D\uDCE1 채널 허브", click: nav("/channels") },
    { label: "\uD83D\uDCB3 결제", click: nav("/billing") },
    { label: "\u2699\uFE0F 마이페이지", click: nav("/mypage") },
    { type: "separator" },
    { label: "업데이트 확인", click: () => { if (!IS_DEV) autoUpdater.checkForUpdates().catch(() => {}); } },
    { type: "separator" },
    { label: "MoA 종료", click: () => { app.isQuitting = true; app.quit(); } },
  ]);

  tray.setToolTip(`MoA v${app.getVersion()}`);
  tray.setContextMenu(contextMenu);
  tray.on("double-click", () => {
    if (mainWindow) { mainWindow.show(); mainWindow.focus(); }
  });
}

function showTrayNotification(body) {
  if (Notification.isSupported()) {
    new Notification({ title: APP_NAME, body, icon: getIconPath() }).show();
  }
}

// ─── IPC Handlers ────────────────────────────────────────────

function setupIPC() {
  ipcMain.handle("moa:isDesktopApp", () => true);
  ipcMain.handle("moa:getVersion", () => app.getVersion());

  // Window controls for frameless window
  ipcMain.handle("moa:windowControl", (_event, action) => {
    if (!mainWindow) return;
    switch (action) {
      case "minimize": mainWindow.minimize(); break;
      case "maximize":
        if (mainWindow.isMaximized()) mainWindow.unmaximize();
        else mainWindow.maximize();
        break;
      case "close": mainWindow.close(); break;
    }
  });

  ipcMain.handle("moa:checkUpdate", async () => {
    if (IS_DEV) return { status: "dev" };
    try {
      const result = await autoUpdater.checkForUpdates();
      return { status: "ok", version: result?.updateInfo?.version };
    } catch (err) {
      return { status: "error", message: err.message };
    }
  });

  ipcMain.handle("moa:systemInfo", () => ({
    platform: process.platform,
    arch: process.arch,
    hostname: os.hostname(),
    username: os.userInfo().username,
    homedir: os.homedir(),
    tmpdir: os.tmpdir(),
    cpus: os.cpus().length,
    memory: Math.round(os.totalmem() / (1024 * 1024 * 1024)),
    appVersion: app.getVersion(),
  }));

  ipcMain.handle("moa:listDrives", () => {
    if (IS_WIN) {
      const drives = [];
      for (let i = 65; i <= 90; i++) {
        const d = String.fromCharCode(i) + ":\\";
        try { fs.accessSync(d, fs.constants.F_OK); drives.push(d); } catch { /* skip */ }
      }
      return drives;
    }
    const mounts = [];
    try { mounts.push(...fs.readdirSync("/Volumes").map((v) => `/Volumes/${v}`)); } catch { /* skip */ }
    try { mounts.push(...fs.readdirSync("/mnt").map((m) => `/mnt/${m}`)); } catch { /* skip */ }
    if (mounts.length === 0) mounts.push("/");
    return mounts;
  });

  ipcMain.handle("moa:listDirectory", async (_event, dirPath) => {
    try {
      const resolved = resolvePath(dirPath);
      if (isSensitivePath(resolved)) {
        const result = await dialog.showMessageBox(mainWindow, {
          type: "question", buttons: ["허용", "거부"],
          title: "파일 접근 요청",
          message: `MoA가 다음 폴더에 접근하려고 합니다:\n\n${resolved}\n\n허용하시겠습니까?`,
        });
        if (result.response !== 0) return { error: "사용자가 접근을 거부했습니다." };
      }
      const entries = fs.readdirSync(resolved, { withFileTypes: true });
      return {
        path: resolved,
        entries: entries.map((e) => ({
          name: e.name, isDirectory: e.isDirectory(), isFile: e.isFile(),
          size: e.isFile() ? safeFileSize(path.join(resolved, e.name)) : 0,
        })),
      };
    } catch (err) {
      return { error: `폴더를 읽을 수 없습니다: ${err.message}` };
    }
  });

  ipcMain.handle("moa:readFile", async (_event, filePath, encoding = "utf-8") => {
    try {
      const resolved = resolvePath(filePath);
      const stat = fs.statSync(resolved);
      if (stat.size > 10 * 1024 * 1024) return { error: "파일 크기가 10MB를 초과합니다." };
      return { path: resolved, content: fs.readFileSync(resolved, encoding), size: stat.size };
    } catch (err) {
      return { error: `파일을 읽을 수 없습니다: ${err.message}` };
    }
  });

  ipcMain.handle("moa:writeFile", async (_event, filePath, content) => {
    try {
      const resolved = resolvePath(filePath);
      const result = await dialog.showMessageBox(mainWindow, {
        type: "question", buttons: ["저장", "취소"],
        title: "파일 저장 확인",
        message: `다음 경로에 파일을 저장합니다:\n\n${resolved}\n\n계속하시겠습니까?`,
      });
      if (result.response !== 0) return { error: "사용자가 저장을 취소했습니다." };
      const dir = path.dirname(resolved);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(resolved, content, "utf-8");
      return { success: true, path: resolved };
    } catch (err) {
      return { error: `파일을 저장할 수 없습니다: ${err.message}` };
    }
  });

  ipcMain.handle("moa:openDialog", async (_event, options) => {
    const result = await dialog.showOpenDialog(mainWindow, {
      properties: options?.directory ? ["openDirectory"] : ["openFile"],
      title: options?.title ?? "파일 선택",
      filters: options?.filters,
    });
    return result.canceled ? null : result.filePaths;
  });

  ipcMain.handle("moa:saveDialog", async (_event, options) => {
    const result = await dialog.showSaveDialog(mainWindow, {
      title: options?.title ?? "파일 저장",
      defaultPath: options?.defaultPath,
      filters: options?.filters,
    });
    return result.canceled ? null : result.filePath;
  });

  ipcMain.handle("moa:openExternal", async (_event, filePath) => {
    try { await shell.openPath(resolvePath(filePath)); return { success: true }; }
    catch (err) { return { error: err.message }; }
  });

  ipcMain.handle("moa:executeCommand", async (_event, command) => {
    if (typeof command !== "string" || !command.trim()) {
      return { error: "유효한 명령이 필요합니다." };
    }
    const blocked = [
      /rm\s+(-[a-zA-Z]*[rf]){2,}\s+\/(?!\S)/i,
      /mkfs\./i, /dd\s+if=.*of=\/dev\//i,
      /:(){ :\|:& };:/, />\s*\/dev\/sd/i,
      /chmod\s+-R\s+777\s+\//i, /shutdown|poweroff|init\s+[06]/i,
    ];
    if (blocked.some((p) => p.test(command))) {
      return { error: "이 명령은 보안상 실행할 수 없습니다." };
    }
    const result = await dialog.showMessageBox(mainWindow, {
      type: "warning", buttons: ["실행", "취소"],
      title: "명령 실행 확인",
      message: `다음 명령을 실행합니다:\n\n${command}\n\n허용하시겠습니까?`,
      detail: "주의: 시스템 명령 실행은 컴퓨터에 영향을 줄 수 있습니다.",
    });
    if (result.response !== 0) return { error: "사용자가 실행을 거부했습니다." };
    return new Promise((resolve) => {
      const { execFile } = require("child_process");
      const sh = IS_WIN ? "cmd.exe" : "/bin/sh";
      const args = IS_WIN ? ["/c", command] : ["-c", command];
      execFile(sh, args, { timeout: 30000, maxBuffer: 5 * 1024 * 1024 }, (err, stdout, stderr) => {
        resolve(err ? { error: err.message, stderr } : { stdout, stderr });
      });
    });
  });
}

// ─── Helpers ─────────────────────────────────────────────────

function resolvePath(inputPath) {
  if (typeof inputPath !== "string") return os.homedir();
  if (inputPath.startsWith("~")) return path.resolve(path.join(os.homedir(), inputPath.slice(1)));
  const resolved = path.resolve(inputPath);
  if (resolved.includes("\0")) throw new Error("Invalid path: null byte detected");
  return resolved;
}

function isSensitivePath(p) {
  const lower = p.toLowerCase().replace(/\\/g, "/");
  const sensitive = [
    "system32", "windows/system", "/etc/shadow", "/etc/passwd",
    "appdata/roaming", ".ssh", ".gnupg", ".aws", ".env",
    "program files", "programdata", "/usr/sbin",
    "/root", "/var/log", "/proc", "/sys",
    "application support/keychain",
  ];
  return sensitive.some((s) => lower.includes(s));
}

function safeFileSize(fp) {
  try { return fs.statSync(fp).size; } catch { return 0; }
}

function getIconPath() {
  const n = IS_WIN ? "icon.ico" : "icon.png";
  const p = path.join(__dirname, "icons", n);
  return fs.existsSync(p) ? p : undefined;
}

function getTrayIconPath() {
  const p = path.join(__dirname, "tray-icon.png");
  return fs.existsSync(p) ? p : path.join(__dirname, "icons", "icon.png");
}

function debounce(fn, ms) {
  let timer;
  return function () { clearTimeout(timer); timer = setTimeout(fn, ms); };
}

// ─── Application Menu ────────────────────────────────────────

function setupAppMenu() {
  const nav = (p) => () => {
    if (mainWindow) { mainWindow.loadURL(`${MOA_URL}${p}`); mainWindow.show(); }
  };

  const template = [
    ...(IS_MAC ? [{ role: "appMenu" }] : []),
    {
      label: "MoA",
      submenu: [
        { label: "AI 채팅", accelerator: "CmdOrCtrl+1", click: nav("/chat") },
        { label: "종합문서", accelerator: "CmdOrCtrl+2", click: nav("/synthesis") },
        { label: "AI 자동코딩", accelerator: "CmdOrCtrl+3", click: nav("/autocode") },
        { label: "문서 에디터", accelerator: "CmdOrCtrl+4", click: nav("/editor") },
        { label: "실시간 통역", accelerator: "CmdOrCtrl+5", click: nav("/interpreter") },
        { type: "separator" },
        { label: "채널 허브", click: nav("/channels") },
        { label: "결제", click: nav("/billing") },
        { label: "마이페이지", click: nav("/mypage") },
      ],
    },
    { role: "editMenu" },
    { role: "viewMenu" },
    { role: "windowMenu" },
  ];

  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

// ─── App Lifecycle ───────────────────────────────────────────

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.show();
      mainWindow.focus();
    }
  });
}

app.whenReady().then(() => {
  setupIPC();
  setupAppMenu();
  createSplashWindow();
  createWindow();
  createTray();
  setupAutoUpdater();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
    else if (mainWindow) mainWindow.show();
  });
});

app.on("window-all-closed", () => { /* keep running in tray */ });

app.on("before-quit", () => {
  app.isQuitting = true;
  saveWindowState();
});
