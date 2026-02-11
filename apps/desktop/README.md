# MoA Desktop App

Electron-based desktop app for MoA (Master of AI).

## Features

- One-click install (NSIS installer for Windows, DMG for macOS, AppImage for Linux)
- System tray integration (runs in background)
- Local file system access (with user permission dialogs)
- Shell command execution (with confirmation)
- Auto-update via electron-updater

## Development

```bash
cd apps/desktop
npm install
npm start        # Run in dev mode
npm run dev      # Run with DevTools
```

## Build

```bash
npm run build:win    # Windows (.exe installer)
npm run build:mac    # macOS (.dmg)
npm run build:linux  # Linux (.AppImage, .deb)
npm run build:all    # All platforms
```

Output goes to `apps/desktop/release/`.

## Architecture

```
main.js      — Electron main process (window, tray, IPC handlers)
preload.js   — Bridge between web app and native APIs
```

The app loads `https://moa.lawith.kr` and extends it with native capabilities
via `window.moaDesktop` API (exposed by preload.js).

## Web App Detection

The web app can detect desktop mode:

```js
if (window.moaDesktop) {
  const info = await window.moaDesktop.systemInfo();
  const files = await window.moaDesktop.listDirectory("E:\\");
}
```
