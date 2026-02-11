import { NextRequest, NextResponse } from "next/server";

/**
 * GET /api/download
 *
 * 스마트 다운로드 리다이렉트 API.
 * User-Agent를 분석하여 기기에 맞는 다운로드 페이지로 자동 리다이렉트.
 *
 * 사용법:
 *   - 카카오톡에서: "MoA 앱 다운로드: https://moa.lawith.kr/api/download"
 *   - 텔레그램에서: 동일 링크
 *   - 웹사이트에서: 동일 링크
 *   → 사용자의 기기(Windows/macOS/Linux/Android/iOS)를 감지해서 맞는 페이지로 이동
 *
 * NOTE: 현재 GitHub 릴리스가 아직 없으므로, 모든 플랫폼을 다운로드 페이지로 리다이렉트합니다.
 * 릴리스가 게시되면 데스크톱 플랫폼은 직접 다운로드로 변경할 수 있습니다.
 */

const DOWNLOAD_PAGE = "https://moa.lawith.kr/download";

export async function GET(request: NextRequest) {
  const ua = (request.headers.get("user-agent") ?? "").toLowerCase();

  // iOS
  if (ua.includes("iphone") || ua.includes("ipad")) {
    return NextResponse.redirect(`${DOWNLOAD_PAGE}?platform=ios`);
  }

  // Android
  if (ua.includes("android")) {
    return NextResponse.redirect(`${DOWNLOAD_PAGE}?platform=android`);
  }

  // Windows
  if (ua.includes("windows") || ua.includes("win64") || ua.includes("win32")) {
    return NextResponse.redirect(`${DOWNLOAD_PAGE}?platform=windows`);
  }

  // macOS
  if (ua.includes("macintosh") || ua.includes("mac os")) {
    return NextResponse.redirect(`${DOWNLOAD_PAGE}?platform=macos`);
  }

  // Linux
  if (ua.includes("linux") && !ua.includes("android")) {
    return NextResponse.redirect(`${DOWNLOAD_PAGE}?platform=linux`);
  }

  // Unknown device
  return NextResponse.redirect(DOWNLOAD_PAGE);
}
