# MoA Desktop App

Electron 기반 데스크톱 앱. 파워유저를 위한 로컬 파일 접근 + 자동 업데이트.

## 주요 기능

- **원클릭 설치**: Windows NSIS (.exe), macOS DMG, Linux AppImage
- **자동 업데이트**: 앱 실행 시 Cloudflare R2에서 자동으로 최신 버전 확인 → 다운로드 → 재시작 (카카오톡 방식)
- **시스템 트레이**: 백그라운드 실행, 트레이 아이콘에서 주요 메뉴 바로 접근
- **로컬 파일 접근**: E드라이브 등 사용자 파일 시스템 직접 읽기/쓰기 (보안 다이얼로그)
- **드라이브 탐색**: Windows 드라이브(C:, D:, E:...) 및 macOS/Linux 마운트 포인트 탐색
- **셸 명령 실행**: 사용자 확인 후 시스템 명령 실행

## 자동 업데이트 흐름

```
앱 실행
  → Cloudflare R2에서 최신 버전 확인
  → 새 버전이 있으면 백그라운드 다운로드 (진행률 표시)
  → 다운로드 완료 → 3초 후 자동 재시작 및 적용
  → 새 버전 없으면 그대로 사용
```

업데이트 서버: `package.json` > `build.publish` > Cloudflare R2 (`Kimjaechol/MoA`)

## 개발

```bash
cd apps/desktop
npm install
npm start        # 실행
npm run dev      # DevTools 포함 실행
```

## 빌드

```bash
npm run build:win    # Windows (.exe 설치 파일)
npm run build:mac    # macOS (.dmg)
npm run build:linux  # Linux (.AppImage, .deb)
npm run build:all    # 전체 플랫폼
```

빌드 결과: `apps/desktop/release/`

## 구조

```
main.js      — Electron 메인 프로세스 (윈도우, 트레이, IPC, 자동 업데이트)
preload.js   — 웹앱 ↔ 네이티브 API 브릿지 (window.moaDesktop)
package.json — electron-builder 설정, publish: Cloudflare R2
```

앱은 `https://mymoa.app`을 로드하고, `window.moaDesktop` API로 네이티브 기능을 확장합니다.

## window.moaDesktop API

```js
// 데스크톱 앱 감지
if (window.moaDesktop) {
  // 시스템 정보
  const info = await window.moaDesktop.systemInfo();
  const drives = await window.moaDesktop.listDrives();

  // 파일 탐색
  const files = await window.moaDesktop.listDirectory("E:\\");
  const content = await window.moaDesktop.readFile("E:\\doc.txt");

  // 업데이트
  const ver = await window.moaDesktop.getVersion();
  window.moaDesktop.onUpdateStatus((status) => console.log(status));
}
```
