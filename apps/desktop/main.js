/**
 * MoA Desktop App — Electron Main Process
 *
 * One-click install: users download a single .exe/.dmg/.AppImage,
 * double-click, and MoA is ready to use. No CLI, no terminal.
 *
 * Architecture:
 *   Renderer (BrowserWindow) loads moa.lawith.kr
 *   + preload.js exposes local APIs (file access, system info)
 *   + local-api.js handles IPC for native operations
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

// App constants
const MOA_URL = "https://moa.lawith.kr";
const APP_NAME = "MoA";
const IS_DEV = process.argv.includes("--dev");

let mainWindow = null;
let tray = null;

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
    if (url.startsWith("http") && !url.includes("moa.lawith.kr")) {
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
      label: "종합문서",
      click: () => {
        if (mainWindow) {
          mainWindow.loadURL(`${MOA_URL}/synthesis`);
          mainWindow.show();
        }
      },
    },
    {
      label: "자동코딩",
      click: () => {
        if (mainWindow) {
          mainWindow.loadURL(`${MOA_URL}/autocode`);
          mainWindow.show();
        }
      },
    },
    { type: "separator" },
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

  tray.setToolTip("MoA - Master of AI");
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
  }));

  // List directory contents (with user permission dialog)
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

  // Open file in system default app
  ipcMain.handle("moa:openExternal", async (_event, filePath) => {
    try {
      await shell.openPath(resolvePath(filePath));
      return { success: true };
    } catch (err) {
      return { error: err.message };
    }
  });

  // Execute shell command (with permission)
  ipcMain.handle("moa:executeCommand", async (_event, command) => {
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
      const { exec } = require("child_process");
      exec(command, { timeout: 30000, maxBuffer: 5 * 1024 * 1024 }, (err, stdout, stderr) => {
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
  // Expand ~ to home directory
  if (inputPath.startsWith("~")) {
    return path.join(os.homedir(), inputPath.slice(1));
  }
  return path.resolve(inputPath);
}

function isSensitivePath(p) {
  const lower = p.toLowerCase();
  const sensitive = [
    "system32", "windows\\system", "/etc", "/usr",
    "appdata\\roaming", ".ssh", ".gnupg",
    "program files", "programdata",
  ];
  return sensitive.some((s) => lower.includes(s));
}

function getIconPath() {
  const iconName = process.platform === "win32" ? "icon.ico" : "icon.png";
  const iconPath = path.join(__dirname, "icons", iconName);
  if (fs.existsSync(iconPath)) return iconPath;
  return undefined;
}

function getTrayIconPath() {
  // Prefer tray-specific icon, fall back to app icon
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
