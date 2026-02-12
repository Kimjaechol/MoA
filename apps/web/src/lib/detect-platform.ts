export type Platform = "windows" | "macos" | "linux" | "android" | "ios" | null;

export function detectPlatform(ua: string): Platform {
  const lower = ua.toLowerCase();
  if (lower.includes("iphone") || lower.includes("ipad")) return "ios";
  if (lower.includes("android")) return "android";
  if (lower.includes("win")) return "windows";
  if (lower.includes("mac")) return "macos";
  if (lower.includes("linux") && !lower.includes("android")) return "linux";
  return null;
}

/** Cloudflare R2 download base URL */
const DOWNLOAD_BASE = "https://download.mymoa.app/desktop";

export const PLATFORM_INFO: Record<
  Exclude<Platform, null>,
  {
    name: string;
    icon: string;
    installCmd?: string;
    downloadUrl?: string;
    storeUrl?: string;
    desc: string;
    comingSoon?: boolean;
  }
> = {
  windows: {
    name: "Windows",
    icon: "/icons/windows.svg",
    installCmd: `powershell -c "irm https://mymoa.app/install.ps1 | iex"`,
    downloadUrl: `${DOWNLOAD_BASE}/MoA-Setup-latest.exe`,
    desc: "Windows 10/11 64-bit",
  },
  macos: {
    name: "macOS",
    icon: "/icons/apple.svg",
    installCmd: `curl -fsSL https://mymoa.app/install.sh | bash`,
    downloadUrl: `${DOWNLOAD_BASE}/MoA-latest-mac.dmg`,
    desc: "macOS 12+ (Apple Silicon / Intel)",
  },
  linux: {
    name: "Linux",
    icon: "/icons/linux.svg",
    installCmd: `curl -fsSL https://mymoa.app/install.sh | bash`,
    downloadUrl: `${DOWNLOAD_BASE}/MoA-latest-linux.AppImage`,
    desc: "Ubuntu 20.04+, Debian 11+, Fedora 35+",
  },
  android: {
    name: "Android",
    icon: "/icons/android.svg",
    storeUrl: "https://play.google.com/store/apps/details?id=app.mymoa.android",
    desc: "Android 10+",
    comingSoon: true,
  },
  ios: {
    name: "iOS",
    icon: "/icons/apple.svg",
    storeUrl: "https://apps.apple.com/app/moa-ai-assistant/id0000000000",
    desc: "iOS 15+",
    comingSoon: true,
  },
};
