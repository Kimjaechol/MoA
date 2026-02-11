/**
 * MoA Desktop Preload Script
 *
 * Exposes native capabilities to the web app via window.moaDesktop.
 * The web app at moa.lawith.kr can detect this object to enable
 * desktop-only features (file access, system info, etc.).
 */

const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("moaDesktop", {
  /** Returns true — web app uses this to detect desktop mode */
  isDesktopApp: () => ipcRenderer.invoke("moa:isDesktopApp"),

  /** Get system information (platform, hostname, drives, etc.) */
  systemInfo: () => ipcRenderer.invoke("moa:systemInfo"),

  /** List directory contents (triggers permission dialog for sensitive paths) */
  listDirectory: (dirPath) => ipcRenderer.invoke("moa:listDirectory", dirPath),

  /** Read file content (max 10MB) */
  readFile: (filePath, encoding) => ipcRenderer.invoke("moa:readFile", filePath, encoding),

  /** Write file (triggers save confirmation dialog) */
  writeFile: (filePath, content) => ipcRenderer.invoke("moa:writeFile", filePath, content),

  /** Open native file/folder picker dialog */
  openDialog: (options) => ipcRenderer.invoke("moa:openDialog", options),

  /** Open file in system default application */
  openExternal: (filePath) => ipcRenderer.invoke("moa:openExternal", filePath),

  /** Execute a shell command (triggers permission dialog) */
  executeCommand: (command) => ipcRenderer.invoke("moa:executeCommand", command),
});
