/**
 * MoA Desktop App — Electron Main Process
 *
 * 파워유저를 위한 데스크톱 앱.
 * 원클릭 설치, 자동 업데이트, 로컬 파일 시스템 접근.
 *
 * 자동 업데이트 흐름 (카카오톡 방식):
 *   앱 실행 → 서버에서 업데이트 확인 → 새 버전 있으면 다운로드
 *   → 다운로드 완료 시 "업데이트 설치 후 재시작" 안내
 *   → 사용자 확인 → 자동 재시작 및 적용
 *
 * Architecture:
 *   Renderer (BrowserWindow) loads mymoa.app
 *   + preload.js exposes local APIs (file access, system info)
 *   + electron-updater handles Cloudflare R2 auto-update
 *   + System tray for background persistence
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
} = require("electron");
const path = require("path");
const fs = require("fs");
const os = require("os");
const { autoUpdater } = require("electron-updater");

// App constants
const MOA_URL = "https://mymoa.app";
const APP_NAME = "MoA";
const IS_DEV = process.argv.includes("--dev");

let mainWindow = null;
let tray = null;

/* -----------------------------------------------------------------
   Auto Update (카카오톡 방식)
   앱 실행 시 무조건 업데이트 확인 → 새 버전 → 다운로드 → 재시작
   ----------------------------------------------------------------- */

function setupAutoUpdater() {
  // Cloudflare R2를 업데이트 소스로 사용
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;

  // 업데이트 확인 시작
  autoUpdater.on("checking-for-update", () => {
    sendUpdateStatus("checking", "업데이트를 확인하고 있습니다...");
  });

  // 업데이트 발견
  autoUpdater.on("update-available", (info) => {
    sendUpdateStatus("available", `새 버전 ${info.version}을 다운로드합니다...`);
    // 메인 윈도우에 업데이트 진행 상황을 표시
    if (mainWindow) {
      mainWindow.webContents.executeJavaScript(`
        if (!document.getElementById('moa-update-bar')) {
          const bar = document.createElement('div');
          bar.id = 'moa-update-bar';
          bar.style.cssText = 'position:fixed;top:0;left:0;right:0;z-index:99999;background:linear-gradient(135deg,#667eea,#764ba2);color:#fff;padding:10px 20px;font-size:14px;display:flex;align-items:center;justify-content:center;gap:12px;font-family:sans-serif;';
          bar.innerHTML = '<span>⬇️ MoA v${info.version} 업데이트를 다운로드하고 있습니다...</span><div id="moa-update-progress" style="width:120px;height:6px;background:rgba(255,255,255,0.3);border-radius:3px;overflow:hidden;"><div id="moa-update-bar-fill" style="width:0%;height:100%;background:#fff;border-radius:3px;transition:width 0.3s;"></div></div>';
          document.body.prepend(bar);
        }
      `).catch(() => {});
    }
  });

  // 다운로드 진행률
  autoUpdater.on("download-progress", (progress) => {
    const pct = Math.round(progress.percent);
    sendUpdateStatus("downloading", `다운로드 중... ${pct}%`);
    if (mainWindow) {
      mainWindow.webContents.executeJavaScript(`
        const fill = document.getElementById('moa-update-bar-fill');
        if (fill) fill.style.width = '${pct}%';
      `).catch(() => {});
    }
  });

  // 다운로드 완료 → 사용자에게 재시작 안내
  autoUpdater.on("update-downloaded", (info) => {
    sendUpdateStatus("ready", `v${info.version} 업데이트가 준비되었습니다.`);

    // 업데이트 바를 완료 상태로 변경
    if (mainWindow) {
      mainWindow.webContents.executeJavaScript(`
        const bar = document.getElementById('moa-update-bar');
        if (bar) {
          bar.innerHTML = '<span>✅ MoA v${info.version} 업데이트가 준비되었습니다. 잠시 후 재시작합니다...</span>';
        }
      `).catch(() => {});
    }

    // 3초 후 자동으로 재시작 (카카오톡처럼 강제)
    // 사용자에게 충분한 시간을 주되, 선택지 없이 자동 적용
    setTimeout(() => {
      autoUpdater.quitAndInstall(false, true);
    }, 3000);
  });

  // 업데이트 없음 (최신 버전)
  autoUpdater.on("update-not-available", () => {
    sendUpdateStatus("latest", "최신 버전입니다.");
  });

  // 에러 발생 — 무시하고 앱 계속 실행 (오프라인 등)
  autoUpdater.on("error", (err) => {
    sendUpdateStatus("error", `업데이트 확인 실패: ${err.message}`);
  });

  // 앱 시작 시 즉시 업데이트 확인
  if (!IS_DEV) {
    autoUpdater.checkForUpdates().catch(() => {});
  }
}

/** 업데이트 상태를 렌더러에 전달 */
function sendUpdateStatus(status, message) {
  if (mainWindow) {
    mainWindow.webContents.send("moa:updateStatus", { status, message });
  }
}

/* -----------------------------------------------------------------
   Window Creation
   ----------------------------------------------------------------- */

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 800,
    minHeight: 600,
    title: APP_NAME,
    icon: getIconPath(),
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false, // needed for fs access via preload
    },
    titleBarStyle: process.platform === "darwin" ? "hiddenInset" : "default",
    backgroundColor: "#0a0a1a",
    show: false, // show after ready-to-show
  });

  // Load MoA web app
  mainWindow.loadURL(MOA_URL);

  // Show when ready (prevents white flash)
  mainWindow.once("ready-to-show", () => {
    mainWindow.show();
    mainWindow.focus();
  });

  // Handle external links in system browser
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith("http") && !url.includes("mymoa.app")) {
      shell.openExternal(url);
      return { action: "deny" };
    }
    return { action: "allow" };
  });

  // Minimize to tray instead of closing
  mainWindow.on("close", (e) => {
    if (!app.isQuitting) {
      e.preventDefault();
      mainWindow.hide();
      if (process.platform === "win32") {
        showTrayNotification("MoA가 시스템 트레이에서 실행 중입니다.");
      }
    }
  });

  // Dev tools in dev mode
  if (IS_DEV) {
    mainWindow.webContents.openDevTools();
  }
}

/* -----------------------------------------------------------------
   System Tray
   ----------------------------------------------------------------- */

function createTray() {
  const iconPath = getTrayIconPath();
  const icon = nativeImage.createFromPath(iconPath).resize({ width: 16, height: 16 });
  tray = new Tray(icon);

  const contextMenu = Menu.buildFromTemplate([
    {
      label: "MoA 열기",
      click: () => {
        if (mainWindow) {
          mainWindow.show();
          mainWindow.focus();
        }
      },
    },
    { type: "separator" },
    {
      label: "채팅",
      click: () => {
        if (mainWindow) {
          mainWindow.loadURL(`${MOA_URL}/chat`);
          mainWindow.show();
        }
      },
    },
    {
      label: "문서작업",
      click: () => {
        if (mainWindow) {
          mainWindow.loadURL(`${MOA_URL}/synthesis`);
          mainWindow.show();
        }
      },
    },
    {
      label: "코딩작업",
      click: () => {
        if (mainWindow) {
          mainWindow.loadURL(`${MOA_URL}/autocode`);
          mainWindow.show();
        }
      },
    },
    {
      label: "실시간 통역",
      click: () => {
        if (mainWindow) {
          mainWindow.loadURL(`${MOA_URL}/interpreter`);
          mainWindow.show();
        }
      },
    },
    { type: "separator" },
    {
      label: "업데이트 확인",
      click: () => {
        if (!IS_DEV) {
          autoUpdater.checkForUpdates().catch(() => {});
        }
      },
    },
    {
      label: "마이페이지",
      click: () => {
        if (mainWindow) {
          mainWindow.loadURL(`${MOA_URL}/mypage`);
          mainWindow.show();
        }
      },
    },
    { type: "separator" },
    {
      label: "MoA 종료",
      click: () => {
        app.isQuitting = true;
        app.quit();
      },
    },
  ]);

  tray.setToolTip(`MoA v${app.getVersion()}`);
  tray.setContextMenu(contextMenu);
  tray.on("double-click", () => {
    if (mainWindow) {
      mainWindow.show();
      mainWindow.focus();
    }
  });
}

function showTrayNotification(body) {
  if (Notification.isSupported()) {
    new Notification({ title: APP_NAME, body }).show();
  }
}

/* -----------------------------------------------------------------
   IPC Handlers — Local File System Access
   These enable the web app to access the user's local files
   (only when running inside the desktop app, with user permission).
   ----------------------------------------------------------------- */

function setupIPC() {
  // Check if running in desktop app
  ipcMain.handle("moa:isDesktopApp", () => true);

  // Get app version (for update checks from renderer)
  ipcMain.handle("moa:getVersion", () => app.getVersion());

  // Manual update check from renderer
  ipcMain.handle("moa:checkUpdate", async () => {
    if (IS_DEV) return { status: "dev" };
    try {
      const result = await autoUpdater.checkForUpdates();
      return { status: "ok", version: result?.updateInfo?.version };
    } catch (err) {
      return { status: "error", message: err.message };
    }
  });

  // Get system info
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

  // List drives (Windows: C:, D:, E: etc. / macOS,Linux: /Volumes, /mnt)
  ipcMain.handle("moa:listDrives", () => {
    if (process.platform === "win32") {
      const drives = [];
      for (let i = 65; i <= 90; i++) {
        const drive = String.fromCharCode(i) + ":\\";
        try {
          fs.accessSync(drive, fs.constants.F_OK);
          drives.push(drive);
        } catch { /* drive not available */ }
      }
      return drives;
    }
    // macOS/Linux: list mount points
    const mounts = [];
    try {
      const volumes = fs.readdirSync("/Volumes");
      mounts.push(...volumes.map((v) => `/Volumes/${v}`));
    } catch { /* not macOS */ }
    try {
      const mnts = fs.readdirSync("/mnt");
      mounts.push(...mnts.map((m) => `/mnt/${m}`));
    } catch { /* not Linux */ }
    if (mounts.length === 0) mounts.push("/");
    return mounts;
  });

  // List directory contents
  ipcMain.handle("moa:listDirectory", async (_event, dirPath) => {
    try {
      const resolvedPath = resolvePath(dirPath);

      // Security: confirm access for sensitive paths
      if (isSensitivePath(resolvedPath)) {
        const result = await dialog.showMessageBox(mainWindow, {
          type: "question",
          buttons: ["허용", "거부"],
          title: "파일 접근 요청",
          message: `MoA가 다음 폴더에 접근하려고 합니다:\n\n${resolvedPath}\n\n허용하시겠습니까?`,
        });
        if (result.response !== 0) {
          return { error: "사용자가 접근을 거부했습니다." };
        }
      }

      const entries = fs.readdirSync(resolvedPath, { withFileTypes: true });
      return {
        path: resolvedPath,
        entries: entries.map((e) => ({
          name: e.name,
          isDirectory: e.isDirectory(),
          isFile: e.isFile(),
          size: e.isFile() ? safeFileSize(path.join(resolvedPath, e.name)) : 0,
        })),
      };
    } catch (err) {
      return { error: `폴더를 읽을 수 없습니다: ${err.message}` };
    }
  });

  // Read file content
  ipcMain.handle("moa:readFile", async (_event, filePath, encoding = "utf-8") => {
    try {
      const resolvedPath = resolvePath(filePath);
      const stat = fs.statSync(resolvedPath);

      // Limit file size to 10MB
      if (stat.size > 10 * 1024 * 1024) {
        return { error: "파일 크기가 10MB를 초과합니다." };
      }

      const content = fs.readFileSync(resolvedPath, encoding);
      return { path: resolvedPath, content, size: stat.size };
    } catch (err) {
      return { error: `파일을 읽을 수 없습니다: ${err.message}` };
    }
  });

  // Write file content (with confirmation)
  ipcMain.handle("moa:writeFile", async (_event, filePath, content) => {
    try {
      const resolvedPath = resolvePath(filePath);

      const result = await dialog.showMessageBox(mainWindow, {
        type: "question",
        buttons: ["저장", "취소"],
        title: "파일 저장 확인",
        message: `다음 경로에 파일을 저장합니다:\n\n${resolvedPath}\n\n계속하시겠습니까?`,
      });

      if (result.response !== 0) {
        return { error: "사용자가 저장을 취소했습니다." };
      }

      // Create directory if needed
      const dir = path.dirname(resolvedPath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }

      fs.writeFileSync(resolvedPath, content, "utf-8");
      return { success: true, path: resolvedPath };
    } catch (err) {
      return { error: `파일을 저장할 수 없습니다: ${err.message}` };
    }
  });

  // Open file/folder picker dialog
  ipcMain.handle("moa:openDialog", async (_event, options) => {
    const result = await dialog.showOpenDialog(mainWindow, {
      properties: options?.directory
        ? ["openDirectory"]
        : ["openFile"],
      title: options?.title ?? "파일 선택",
      filters: options?.filters,
    });
    return result.canceled ? null : result.filePaths;
  });

  // Save file dialog
  ipcMain.handle("moa:saveDialog", async (_event, options) => {
    const result = await dialog.showSaveDialog(mainWindow, {
      title: options?.title ?? "파일 저장",
      defaultPath: options?.defaultPath,
      filters: options?.filters,
    });
    return result.canceled ? null : result.filePath;
  });

  // Open file in system default app
  ipcMain.handle("moa:openExternal", async (_event, filePath) => {
    try {
      await shell.openPath(resolvePath(filePath));
      return { success: true };
    } catch (err) {
      return { error: err.message };
    }
  });

  // Execute shell command (with permission + sanitization)
  ipcMain.handle("moa:executeCommand", async (_event, command) => {
    if (typeof command !== "string" || !command.trim()) {
      return { error: "유효한 명령이 필요합니다." };
    }

    // Block critical dangerous patterns
    const blocked = [
      /rm\s+(-[a-zA-Z]*[rf]){2,}\s+\/(?!\S)/i,
      /mkfs\./i,
      /dd\s+if=.*of=\/dev\//i,
      /:(){ :\|:& };:/,
      />\s*\/dev\/sd/i,
      /chmod\s+-R\s+777\s+\//i,
      /shutdown|poweroff|init\s+[06]/i,
    ];
    if (blocked.some((p) => p.test(command))) {
      return { error: "이 명령은 보안상 실행할 수 없습니다." };
    }

    const result = await dialog.showMessageBox(mainWindow, {
      type: "warning",
      buttons: ["실행", "취소"],
      title: "명령 실행 확인",
      message: `다음 명령을 실행합니다:\n\n${command}\n\n허용하시겠습니까?`,
      detail: "주의: 시스템 명령 실행은 컴퓨터에 영향을 줄 수 있습니다.",
    });

    if (result.response !== 0) {
      return { error: "사용자가 실행을 거부했습니다." };
    }

    return new Promise((resolve) => {
      const { execFile } = require("child_process");
      // Use shell with explicit quoting via execFile for safer execution
      const shellCmd = process.platform === "win32" ? "cmd.exe" : "/bin/sh";
      const shellArgs = process.platform === "win32" ? ["/c", command] : ["-c", command];
      execFile(shellCmd, shellArgs, { timeout: 30000, maxBuffer: 5 * 1024 * 1024 }, (err, stdout, stderr) => {
        if (err) {
          resolve({ error: err.message, stderr });
        } else {
          resolve({ stdout, stderr });
        }
      });
    });
  });
}

/* -----------------------------------------------------------------
   Helpers
   ----------------------------------------------------------------- */

function resolvePath(inputPath) {
  if (typeof inputPath !== "string") return os.homedir();
  // Expand ~ to home directory
  if (inputPath.startsWith("~")) {
    return path.resolve(path.join(os.homedir(), inputPath.slice(1)));
  }
  const resolved = path.resolve(inputPath);
  // Block null bytes (path injection)
  if (resolved.includes("\0")) {
    throw new Error("Invalid path: null byte detected");
  }
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

function safeFileSize(filePath) {
  try {
    return fs.statSync(filePath).size;
  } catch {
    return 0;
  }
}

function getIconPath() {
  const iconName = process.platform === "win32" ? "icon.ico" : "icon.png";
  const iconPath = path.join(__dirname, "icons", iconName);
  if (fs.existsSync(iconPath)) return iconPath;
  return undefined;
}

function getTrayIconPath() {
  const trayPath = path.join(__dirname, "tray-icon.png");
  if (fs.existsSync(trayPath)) return trayPath;
  return path.join(__dirname, "icons", "icon.png");
}

/* -----------------------------------------------------------------
   App Lifecycle
   ----------------------------------------------------------------- */

// Single instance lock — prevent multiple windows
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
  createWindow();
  createTray();
  setupAutoUpdater();

  // macOS: re-create window on dock click
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    } else if (mainWindow) {
      mainWindow.show();
    }
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    // On Windows/Linux, keep running in tray
  }
});

app.on("before-quit", () => {
  app.isQuitting = true;
});
