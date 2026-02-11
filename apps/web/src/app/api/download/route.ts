import { NextRequest, NextResponse } from "next/server";

/**
 * GET /api/download
 *
 * 스마트 다운로드 리다이렉트 API.
 * User-Agent를 분석하여 기기에 맞는 다운로드 링크로 자동 리다이렉트.
 *
 * 사용법:
 *   - 카카오톡에서: "MoA 앱 다운로드: https://moa.lawith.kr/api/download"
 *   - 텔레그램에서: 동일 링크
 *   - 웹사이트에서: 동일 링크
 *   → 사용자의 기기(Windows/macOS/Linux/Android/iOS)를 감지해서 맞는 페이지로 이동
 */

const RELEASES_BASE = "https://github.com/Kimjaechol/MoA/releases/latest/download";
const DOWNLOAD_PAGE = "https://moa.lawith.kr/download";

export async function GET(request: NextRequest) {
  const ua = (request.headers.get("user-agent") ?? "").toLowerCase();

  // iOS → App Store (or download page for now)
  if (ua.includes("iphone") || ua.includes("ipad")) {
    return NextResponse.redirect(`${DOWNLOAD_PAGE}?platform=ios`);
  }

  // Android → Google Play (or APK direct)
  if (ua.includes("android")) {
    return NextResponse.redirect(`${DOWNLOAD_PAGE}?platform=android`);
  }

  // Windows → .exe 직접 다운로드
  if (ua.includes("windows") || ua.includes("win64") || ua.includes("win32")) {
    return NextResponse.redirect(`${RELEASES_BASE}/MoA-Setup-latest.exe`);
  }

  // macOS → .dmg 직접 다운로드
  if (ua.includes("macintosh") || ua.includes("mac os")) {
    return NextResponse.redirect(`${RELEASES_BASE}/MoA-latest-mac.dmg`);
  }

  // Linux → AppImage 직접 다운로드
  if (ua.includes("linux") && !ua.includes("android")) {
    return NextResponse.redirect(`${RELEASES_BASE}/MoA-latest-linux.AppImage`);
  }

  // 알 수 없는 기기 → 다운로드 페이지로 이동
  return NextResponse.redirect(DOWNLOAD_PAGE);
}
