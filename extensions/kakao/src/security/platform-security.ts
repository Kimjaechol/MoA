/**
 * Platform Security — OS-specific fingerprint collection & data path resolution
 *
 * 모든 기기(휴대폰, 노트북, PC, 태블릿, 서버)에 동일한 보안을 적용하려면
 * 각 플랫폼에서 하드웨어 핑거프린트를 수집하고 데이터 경로를 알아야 합니다.
 *
 * 지원 플랫폼:
 * - macOS (MacBook, iMac, Mac Mini, Mac Studio, Mac Pro)
 * - Windows (노트북, 데스크톱)
 * - Linux (노트북, 데스크톱, 서버)
 * - iOS (iPhone, iPad)
 * - Android (폰, 태블릿)
 *
 * 위협 모델 (모든 기기 공통):
 * - 카페에서 노트북 절도
 * - 사무실에서 PC 하드디스크 탈취
 * - 호텔에서 태블릿 분실
 * - 거리에서 휴대폰 소매치기
 * - 차량 내 기기 절취
 * - 수리점에서 데이터 무단 복사
 */

import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join, sep } from "node:path";
import { platform, hostname, arch, type } from "node:os";
import type { DeviceType } from "../relay/types.js";

/** Detected platform information */
export interface PlatformInfo {
  /** OS platform: darwin, win32, linux, android, ios */
  os: string;
  /** OS version string */
  osVersion: string;
  /** CPU architecture: x64, arm64, etc. */
  arch: string;
  /** Hostname (hashed for privacy) */
  hostnameHash: string;
  /** Inferred device type */
  deviceType: DeviceType;
  /** Platform-specific machine ID (for fingerprinting) */
  machineId: string | null;
}

/** Data paths for a specific platform */
export interface PlatformDataPaths {
  /** Directory containing MoA data */
  dataDir: string;
  /** sqlite-vec database file paths */
  dbPaths: string[];
  /** Chat history / session log directories */
  chatDirs: string[];
  /** Credential and key file paths */
  credentialPaths: string[];
  /** Temporary files that may contain sensitive data */
  tempPaths: string[];
}

/**
 * Detect the current platform and gather system information.
 */
export function detectPlatform(): PlatformInfo {
  const os = platform();
  const cpuArch = arch();
  const hostHash = createHash("sha256").update(hostname()).digest("hex").slice(0, 16);

  let osVersion = "";
  let deviceType: DeviceType = "desktop";
  let machineId: string | null = null;

  try {
    if (os === "darwin") {
      // macOS — read system version and hardware model
      osVersion = safeExecSync("sw_vers -productVersion") ?? "unknown";
      machineId = safeReadFile("/var/root/.moa-machine-id")
        ?? safeExecSync("ioreg -rd1 -c IOPlatformExpertDevice | awk '/IOPlatformSerialNumber/ { print $3 }'")
        ?? safeExecSync("system_profiler SPHardwareDataType | awk '/Hardware UUID/ { print $3 }'");

      // Detect if laptop (MacBook) or desktop (iMac, Mac Mini, etc.)
      const model = safeExecSync("sysctl -n hw.model") ?? "";
      deviceType = model.toLowerCase().includes("book") ? "laptop" : "desktop";

    } else if (os === "win32") {
      // Windows — read product version and machine GUID
      osVersion = safeExecSync("ver") ?? "unknown";
      machineId = safeReadFile("C:\\ProgramData\\MoA\\.machine-id")
        ?? safeExecSync("wmic csproduct get UUID /format:list")?.replace("UUID=", "").trim();
      // Detect laptop vs desktop via battery presence
      const battery = safeExecSync("wmic path win32_battery get status /format:list");
      deviceType = battery && battery.includes("OK") ? "laptop" : "desktop";

    } else if (os === "linux") {
      // Linux — read machine-id and detect device type
      osVersion = safeReadFile("/etc/os-release")?.match(/VERSION="?([^"\n]+)/)?.[1] ?? "unknown";
      machineId = safeReadFile("/etc/machine-id")?.trim()
        ?? safeReadFile("/var/lib/dbus/machine-id")?.trim();

      // Detect device type: check for battery (laptop) or container (server)
      if (existsSync("/.dockerenv") || existsSync("/run/.containerenv")) {
        deviceType = "server";
      } else if (existsSync("/sys/class/power_supply/BAT0")) {
        deviceType = "laptop";
      } else if (existsSync("/sys/class/power_supply/battery")) {
        deviceType = "mobile"; // Android device with Termux or similar
      } else {
        deviceType = "desktop";
      }
    }
  } catch {
    // Best effort — continue with defaults
  }

  return {
    os,
    osVersion: osVersion.trim(),
    arch: cpuArch,
    hostnameHash: hostHash,
    deviceType,
    machineId,
  };
}

/**
 * Collect a hardware fingerprint for the current platform.
 *
 * Combines multiple system-specific identifiers into a single hash.
 * This fingerprint is used for device-bound DB encryption keys.
 *
 * Sources per platform:
 * - macOS: IOPlatformSerialNumber + Hardware UUID + model
 * - Windows: CSPRODUCT UUID + BIOS serial + model
 * - Linux: /etc/machine-id + DMI product UUID
 * - iOS: identifierForVendor (passed from native layer)
 * - Android: ANDROID_ID (passed from native layer)
 */
export function collectPlatformFingerprint(params?: {
  /** For mobile: native device ID passed from iOS/Android layer */
  nativeDeviceId?: string;
  /** For mobile: app installation UUID */
  installId?: string;
}): string {
  const info = detectPlatform();
  const parts: string[] = [];

  // Machine ID (strongest identifier)
  if (info.machineId) {
    parts.push(info.machineId);
  }

  // Native device ID for mobile platforms
  if (params?.nativeDeviceId) {
    parts.push(params.nativeDeviceId);
  }

  // App install ID (changes on reinstall — extra layer)
  if (params?.installId) {
    parts.push(params.installId);
  }

  // System-level attributes (weaker but always available)
  parts.push(info.os);
  parts.push(info.arch);
  parts.push(info.hostnameHash);

  // Platform-specific additional identifiers
  try {
    if (info.os === "darwin") {
      const model = safeExecSync("sysctl -n hw.model");
      const cpuBrand = safeExecSync("sysctl -n machdep.cpu.brand_string");
      if (model) parts.push(model);
      if (cpuBrand) parts.push(cpuBrand);

    } else if (info.os === "win32") {
      const biosSerial = safeExecSync("wmic bios get serialnumber /format:list")?.replace("SerialNumber=", "").trim();
      const model = safeExecSync("wmic computersystem get model /format:list")?.replace("Model=", "").trim();
      if (biosSerial) parts.push(biosSerial);
      if (model) parts.push(model);

    } else if (info.os === "linux") {
      const productUuid = safeReadFile("/sys/class/dmi/id/product_uuid")?.trim();
      const boardSerial = safeReadFile("/sys/class/dmi/id/board_serial")?.trim();
      if (productUuid) parts.push(productUuid);
      if (boardSerial) parts.push(boardSerial);
    }
  } catch {
    // Best effort
  }

  // Hash everything together
  return createHash("sha256").update(parts.join("|moa-fp|")).digest("hex");
}

/**
 * Resolve platform-specific data paths for security operations.
 *
 * These paths are used by:
 * - DeviceSecurityManager.secureWipeAll() — knows what to delete
 * - encryptDatabaseFile() — knows which DB files to encrypt
 * - purgeChatHistory() — knows where chat logs are
 * - handleHeartbeatWipeCheck() — passes paths to wipe executor
 */
export function resolvePlatformDataPaths(params?: {
  /** Override the base data directory */
  customDataDir?: string;
  /** Agent ID for session paths */
  agentId?: string;
}): PlatformDataPaths {
  const os = platform();
  const home = process.env.HOME ?? process.env.USERPROFILE ?? "/tmp";
  const agentId = params?.agentId ?? "default";

  // Base MoA data directory
  let dataDir: string;
  if (params?.customDataDir) {
    dataDir = params.customDataDir;
  } else if (os === "darwin") {
    dataDir = join(home, ".openclaw");
  } else if (os === "win32") {
    dataDir = join(process.env.APPDATA ?? join(home, "AppData", "Roaming"), "openclaw");
  } else {
    // Linux, Android (Termux), etc.
    dataDir = join(home, ".openclaw");
  }

  // sqlite-vec DB paths
  const dbPaths = [
    join(dataDir, "memory", "memory.db"),
    join(dataDir, "memory", "embeddings.db"),
    join(dataDir, "agents", agentId, "memory.db"),
  ];

  // Chat history / session directories
  const chatDirs = [
    join(dataDir, "sessions"),
    join(dataDir, "agents", agentId, "sessions"),
    join(dataDir, "agents", agentId, "conversations"),
  ];

  // Credential and key files
  const credentialPaths = [
    join(dataDir, "credentials", "api-keys.json"),
    join(dataDir, "credentials", "oauth-tokens.json"),
    join(dataDir, ".moa-security.json"),
    join(dataDir, ".moa-db-salt"),
    join(dataDir, "backup-credentials.json"),
  ];

  // Platform-specific additional paths
  const tempPaths: string[] = [];

  if (os === "darwin") {
    // macOS-specific caches
    tempPaths.push(join(home, "Library", "Caches", "com.openclaw.moa"));
    tempPaths.push(join(home, "Library", "Application Support", "OpenClaw"));
  } else if (os === "win32") {
    // Windows-specific temp/cache
    const localAppData = process.env.LOCALAPPDATA ?? join(home, "AppData", "Local");
    tempPaths.push(join(localAppData, "openclaw", "cache"));
    tempPaths.push(join(localAppData, "Temp", "openclaw-*"));
  } else {
    // Linux/Android
    tempPaths.push(join(home, ".cache", "openclaw"));
    const xdgCache = process.env.XDG_CACHE_HOME ?? join(home, ".cache");
    tempPaths.push(join(xdgCache, "openclaw"));
  }

  return { dataDir, dbPaths, chatDirs, credentialPaths, tempPaths };
}

/**
 * Get a human-readable device description for display.
 */
export function getDeviceDescription(info: PlatformInfo): string {
  const icons: Record<DeviceType, string> = {
    desktop: "🖥",
    laptop: "💻",
    server: "🖧",
    mobile: "📱",
    tablet: "📱",
    other: "📟",
  };

  const osNames: Record<string, string> = {
    darwin: "macOS",
    win32: "Windows",
    linux: "Linux",
    android: "Android",
    ios: "iOS",
  };

  const icon = icons[info.deviceType] ?? "📟";
  const osName = osNames[info.os] ?? info.os;

  return `${icon} ${osName} ${info.osVersion} (${info.arch})`;
}

/**
 * Format all-device security overview for display.
 */
export function formatAllDeviceSecurityInfo(): string {
  return [
    "🔒 기기 보안 안내",
    "",
    "모든 기기에 동일한 5-Layer 보안이 적용됩니다:",
    "",
    "  🖥 데스크톱 (PC, iMac)",
    "  💻 노트북 (MacBook, ThinkPad, ...)",
    "  📱 휴대폰 (iPhone, Galaxy, ...)",
    "  📱 태블릿 (iPad, Galaxy Tab, ...)",
    "  🖧 서버 (클라우드, 홈서버)",
    "",
    "보안 계층:",
    "  1️⃣ 사용자 인증 — 본인만 MoA와 대화 가능",
    "  2️⃣ DB 암호화 — AES-256-GCM 암호화 at rest",
    "  3️⃣ 기기 바인딩 — 하드웨어 핑거프린트 기반 키",
    "  4️⃣ 채팅 보호 — 민감정보 마스킹 + 자동 삭제",
    "  5️⃣ 원격 삭제 — 분실 시 백업 후 3중 덮어쓰기",
    "",
    "어떤 기기든 분실 시: /분실신고 [기기이름]",
  ].join("\n");
}

// ── Internal helpers ──

function safeExecSync(cmd: string): string | null {
  try {
    const { execSync } = require("node:child_process");
    return (execSync(cmd, { encoding: "utf-8", timeout: 5000 }) as string).trim();
  } catch {
    return null;
  }
}

function safeReadFile(path: string): string | null {
  try {
    if (!existsSync(path)) return null;
    return readFileSync(path, "utf-8");
  } catch {
    return null;
  }
}
