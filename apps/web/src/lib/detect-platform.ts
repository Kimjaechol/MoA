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

/** MoA API server base URL (Railway deployment) */
const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? "https://moa.lawith.kr";

export const PLATFORM_INFO: Record<
  Exclude<Platform, null>,
  {
    name: string;
    icon: string;
    installCmd?: string;
    downloadUrl?: string;
    storeUrl?: string;
    desc: string;
  }
> = {
  windows: {
    name: "Windows",
    icon: "/icons/windows.svg",
    installCmd: `powershell -c "irm ${API_BASE}/install.ps1 | iex"`,
    downloadUrl: "/install.bat",
    desc: "Windows 10/11 64-bit",
  },
  macos: {
    name: "macOS",
    icon: "/icons/apple.svg",
    installCmd: `curl -fsSL ${API_BASE}/install.sh | bash`,
    downloadUrl: "/install.command",
    desc: "macOS 12+ (Apple Silicon / Intel)",
  },
  linux: {
    name: "Linux",
    icon: "/icons/linux.svg",
    installCmd: `curl -fsSL ${API_BASE}/install.sh | bash`,
    downloadUrl: "/install.sh",
    desc: "Ubuntu 20.04+, Debian 11+, Fedora 35+",
  },
  android: {
    name: "Android",
    icon: "/icons/android.svg",
    storeUrl: "https://play.google.com/store/apps/details?id=com.lawith.moa",
    desc: "Android 10+ (출시 예정)",
  },
  ios: {
    name: "iOS",
    icon: "/icons/apple.svg",
    storeUrl: "https://apps.apple.com/app/moa-ai-assistant/id0000000000",
    desc: "iOS 15+ (출시 예정)",
  },
};
