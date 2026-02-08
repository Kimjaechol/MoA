/**
 * MoA 설치 설정
 *
 * 원클릭 설치를 위한 설정 및 상수
 */

export interface InstallerConfig {
  /** MoA 서버 URL (Railway 배포 주소) */
  serverUrl: string;
  /** 설치 페이지 URL */
  installPageUrl: string;
  /** 버전 정보 */
  version: string;
  /** 베타 기간 여부 */
  isBetaPeriod: boolean;
  /** 무료 체험 기간 (일) */
  freeTrialDays: number;
  /** 월 구독료 (원) */
  monthlyPrice: number;
}

/** Base URL for downloads/install scripts — auto-detected from Railway or set via MOA_BASE_URL */
function getBaseUrl(): string {
  if (process.env.MOA_BASE_URL) {
    return process.env.MOA_BASE_URL;
  }
  const railwayDomain = process.env.RAILWAY_PUBLIC_DOMAIN;
  if (railwayDomain) {
    return `https://${railwayDomain}`;
  }
  return "https://moa.lawith.kr";
}

export const DEFAULT_INSTALLER_CONFIG: InstallerConfig = {
  serverUrl: process.env.MOA_SERVER_URL ?? getBaseUrl(),
  installPageUrl: process.env.MOA_INSTALL_URL ?? `${getBaseUrl()}/install`,
  version: "1.0.0-beta",
  isBetaPeriod: true,
  freeTrialDays: 30,
  monthlyPrice: 9900, // 9,900원/월
};

/**
 * 플랫폼별 설치 방법
 */
export interface PlatformInstaller {
  platform: "windows" | "macos" | "linux" | "android" | "ios";
  displayName: string;
  icon: string;
  installCommand?: string;
  downloadUrl?: string;
  appStoreUrl?: string;
  description: string;
}

/** Build platform installers with dynamic base URL */
function buildPlatformInstallers(): PlatformInstaller[] {
  const base = getBaseUrl();
  return [
    {
      platform: "windows",
      displayName: "Windows",
      icon: "🪟",
      installCommand: `powershell -c "irm ${base}/install.ps1 | iex"`,
      description: "Windows 10/11 64-bit",
    },
    {
      platform: "macos",
      displayName: "macOS",
      icon: "🍎",
      installCommand: `curl -fsSL ${base}/install.sh | bash`,
      description: "macOS 12+ (Apple Silicon / Intel)",
    },
    {
      platform: "linux",
      displayName: "Linux",
      icon: "🐧",
      installCommand: `curl -fsSL ${base}/install.sh | bash`,
      description: "Ubuntu 20.04+, Debian 11+, Fedora 35+",
    },
    {
      platform: "android",
      displayName: "Android",
      icon: "🤖",
      appStoreUrl: "https://play.google.com/store/apps/details?id=com.lawith.moa",
      description: "Android 10+ (출시 예정)",
    },
    {
      platform: "ios",
      displayName: "iOS",
      icon: "📱",
      appStoreUrl: "https://apps.apple.com/app/moa-ai-assistant/id0000000000",
      description: "iOS 15+ (출시 예정)",
    },
  ];
}

export const PLATFORM_INSTALLERS: PlatformInstaller[] = buildPlatformInstallers();

/**
 * 사용자 에이전트에서 플랫폼 감지
 */
export function detectPlatform(userAgent: string): PlatformInstaller["platform"] | null {
  const ua = userAgent.toLowerCase();

  if (ua.includes("iphone") || ua.includes("ipad")) {
    return "ios";
  }
  if (ua.includes("android")) {
    return "android";
  }
  if (ua.includes("win")) {
    return "windows";
  }
  if (ua.includes("mac")) {
    return "macos";
  }
  if (ua.includes("linux")) {
    return "linux";
  }

  return null;
}

/**
 * 플랫폼별 설치 정보 조회
 */
export function getInstallerForPlatform(
  platform: PlatformInstaller["platform"],
): PlatformInstaller | undefined {
  return PLATFORM_INSTALLERS.find((p) => p.platform === platform);
}
