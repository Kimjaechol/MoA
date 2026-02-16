/**
 * MoA Desktop Preload Script (Production)
 *
 * contextBridge로 안전하게 window.moaDesktop API를 노출.
 * 웹앱(mymoa.app)이 이 API로 로컬 파일 접근, 시스템 정보,
 * 윈도우 컨트롤, 업데이트 확인 등을 수행할 수 있다.
 */

const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("moaDesktop", {
  // ── 앱 상태 ──
  isDesktopApp: () => ipcRenderer.invoke("moa:isDesktopApp"),
  getVersion: () => ipcRenderer.invoke("moa:getVersion"),
  checkUpdate: () => ipcRenderer.invoke("moa:checkUpdate"),

  // ── 윈도우 컨트롤 (frameless 타이틀바용) ──
  windowControl: (action) => ipcRenderer.invoke("moa:windowControl", action),

  // ── 시스템 정보 ──
  systemInfo: () => ipcRenderer.invoke("moa:systemInfo"),
  listDrives: () => ipcRenderer.invoke("moa:listDrives"),

  // ── 파일 시스템 ──
  listDirectory: (dirPath) => ipcRenderer.invoke("moa:listDirectory", dirPath),
  readFile: (filePath, encoding) => ipcRenderer.invoke("moa:readFile", filePath, encoding),
  writeFile: (filePath, content) => ipcRenderer.invoke("moa:writeFile", filePath, content),

  // ── 다이얼로그 ──
  openDialog: (options) => ipcRenderer.invoke("moa:openDialog", options),
  saveDialog: (options) => ipcRenderer.invoke("moa:saveDialog", options),
  openExternal: (filePath) => ipcRenderer.invoke("moa:openExternal", filePath),

  // ── 명령 실행 ──
  executeCommand: (command) => ipcRenderer.invoke("moa:executeCommand", command),

  // ── 업데이트 이벤트 수신 ──
  onUpdateStatus: (callback) => {
    ipcRenderer.on("moa:updateStatus", (_event, data) => callback(data));
  },
});
