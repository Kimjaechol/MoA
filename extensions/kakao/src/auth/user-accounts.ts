/**
 * User Account Management
 *
 * 웹 페이지에서 회원가입/로그인을 통해 계정을 관리합니다.
 * Supabase 없이 파일 기반으로 동작합니다.
 *
 * ## 흐름
 * 1. 이용자가 /welcome 페이지에서 회원가입 (아이디 + 비밀번호 + 기기이름)
 * 2. 비밀번호는 HMAC-SHA256 해시로 저장 (원문 저장 안함)
 * 3. 기기가 자동으로 등록되고 토큰 발급
 * 4. 이후 다른 기기에서 로그인하면 새 기기 자동 등록
 * 5. 카카오톡에서 아이디+비밀번호로 인증하면 채널 연동
 *
 * ## 저장
 * .moa-data/user-accounts.json
 * {
 *   "username1": { "passwordHash": "...", "devices": [...], ... },
 *   "username2": { ... }
 * }
 *
 * 서버에는 해시만 저장 — 비밀번호 원문은 절대 저장하지 않음
 */

import { createHmac, randomBytes } from "node:crypto";
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";

// ============================================
// Types
// ============================================

export interface DeviceInfo {
  deviceName: string;
  deviceType: string;
  platform: string;
  deviceToken: string;
  registeredAt: number;
}

export interface UserAccount {
  username: string;
  passwordHash: string;
  devices: DeviceInfo[];
  /** channelId → userId mapping (KakaoTalk, Telegram 등 메신저 연동) */
  linkedChannels: Record<string, string>;
  createdAt: number;
  updatedAt: number;
}

export interface SignupResult {
  success: boolean;
  deviceToken?: string;
  error?: string;
}

export interface LoginResult {
  success: boolean;
  deviceToken?: string;
  isNewDevice?: boolean;
  /** 기존 등록 기기 이름 목록 (device 없이 로그인 시 반환, 기기이름 중복 방지용) */
  existingDevices?: string[];
  error?: string;
}

// ============================================
// Configuration
// ============================================

const HMAC_KEY = "moa-user-account";
const MIN_USERNAME_LENGTH = 2;
const MAX_USERNAME_LENGTH = 30;
const MIN_PASSWORD_LENGTH = 4;
const DEVICE_TOKEN_BYTES = 32;

// ============================================
// Storage
// ============================================

/** In-memory cache of user accounts */
let accountStore: Map<string, UserAccount> | null = null;

function getStorePath(): string {
  const dataDir = process.env.MOA_DATA_DIR ?? join(process.cwd(), ".moa-data");
  return join(dataDir, "user-accounts.json");
}

function loadStore(): Map<string, UserAccount> {
  if (accountStore) return accountStore;

  accountStore = new Map();
  const filePath = getStorePath();
  if (!existsSync(filePath)) return accountStore;

  try {
    const data = JSON.parse(readFileSync(filePath, "utf-8")) as Record<string, UserAccount>;
    for (const [key, entry] of Object.entries(data)) {
      accountStore.set(key, entry);
    }
  } catch {
    // File corrupt or doesn't exist — start fresh
  }
  return accountStore;
}

function saveStore(): void {
  try {
    const filePath = getStorePath();
    mkdirSync(dirname(filePath), { recursive: true });
    const data: Record<string, UserAccount> = {};
    const store = loadStore();
    for (const [key, entry] of store) {
      data[key] = entry;
    }
    writeFileSync(filePath, JSON.stringify(data, null, 2), "utf-8");
  } catch (err) {
    console.error("[UserAccounts] Failed to save:", err);
  }
}

/** Hash a password using HMAC-SHA256 */
function hashPassword(password: string): string {
  return createHmac("sha256", HMAC_KEY).update(password).digest("hex");
}

/** Generate a device token (same format as device-auth.ts) */
function generateDeviceToken(): string {
  const token = randomBytes(DEVICE_TOKEN_BYTES).toString("hex");
  const hmacKey = process.env.LAWCALL_ENCRYPTION_KEY ?? process.env.SUPABASE_SERVICE_KEY;
  const hmac = createHmac("sha256", hmacKey ?? "moa-relay-default-dev-only");
  hmac.update(token);
  return `moa_${token}_${hmac.digest("hex").slice(0, 8)}`;
}

// ============================================
// Validation
// ============================================

function validateUsername(username: string): string | null {
  const trimmed = username.trim();
  if (trimmed.length < MIN_USERNAME_LENGTH) {
    return `아이디는 최소 ${MIN_USERNAME_LENGTH}자 이상이어야 합니다.`;
  }
  if (trimmed.length > MAX_USERNAME_LENGTH) {
    return `아이디는 최대 ${MAX_USERNAME_LENGTH}자까지 가능합니다.`;
  }
  if (!/^[a-zA-Z0-9가-힣_.\-]+$/.test(trimmed)) {
    return "아이디는 영문, 숫자, 한글, _, ., -만 사용 가능합니다.";
  }
  return null;
}

function validatePassword(password: string): string | null {
  if (password.length < MIN_PASSWORD_LENGTH) {
    return `비밀번호는 최소 ${MIN_PASSWORD_LENGTH}자 이상이어야 합니다.`;
  }
  return null;
}

// ============================================
// Public API
// ============================================

/**
 * 회원가입 — 새 계정 생성 + 첫 기기 등록 + 토큰 발급
 */
export function signup(
  username: string,
  password: string,
  device: { deviceName: string; deviceType: string; platform: string },
): SignupResult {
  const trimmedUsername = username.trim().toLowerCase();

  const usernameError = validateUsername(trimmedUsername);
  if (usernameError) return { success: false, error: usernameError };

  const passwordError = validatePassword(password);
  if (passwordError) return { success: false, error: passwordError };

  const store = loadStore();

  if (store.has(trimmedUsername)) {
    return { success: false, error: "이미 사용 중인 아이디입니다." };
  }

  const deviceToken = generateDeviceToken();
  const now = Date.now();

  const account: UserAccount = {
    username: trimmedUsername,
    passwordHash: hashPassword(password),
    devices: [
      {
        deviceName: device.deviceName || "My PC",
        deviceType: device.deviceType || "desktop",
        platform: device.platform || "Unknown",
        deviceToken,
        registeredAt: now,
      },
    ],
    linkedChannels: {},
    createdAt: now,
    updatedAt: now,
  };

  store.set(trimmedUsername, account);
  saveStore();

  console.log(`[UserAccounts] Signup: ${trimmedUsername} (device: ${device.deviceName})`);

  return { success: true, deviceToken };
}

/**
 * 로그인 — 자격 증명 확인 + 새 기기 자동 등록
 *
 * device가 제공되면 해당 기기를 자동으로 등록합니다.
 * 같은 이름의 기기가 이미 있으면 기존 토큰을 반환합니다.
 */
export function login(
  username: string,
  password: string,
  device?: { deviceName: string; deviceType: string; platform: string },
): LoginResult {
  const trimmedUsername = username.trim().toLowerCase();
  const store = loadStore();

  const account = store.get(trimmedUsername);
  if (!account) {
    return { success: false, error: "아이디 또는 비밀번호가 올바르지 않습니다." };
  }

  // Verify password
  if (hashPassword(password) !== account.passwordHash) {
    return { success: false, error: "아이디 또는 비밀번호가 올바르지 않습니다." };
  }

  // If device info provided, register new device
  if (device) {
    // Check if device name already exists
    const existing = account.devices.find(
      (d) => d.deviceName.toLowerCase() === device.deviceName.toLowerCase(),
    );

    if (existing) {
      // Return existing token (same device re-logging in)
      return { success: true, deviceToken: existing.deviceToken, isNewDevice: false };
    }

    // Check device limit
    const maxDevices = Number(process.env.RELAY_MAX_DEVICES ?? 5);
    if (account.devices.length >= maxDevices) {
      return { success: false, error: `최대 ${maxDevices}개의 기기만 등록할 수 있습니다.` };
    }

    const deviceToken = generateDeviceToken();
    account.devices.push({
      deviceName: device.deviceName || "My PC",
      deviceType: device.deviceType || "desktop",
      platform: device.platform || "Unknown",
      deviceToken,
      registeredAt: Date.now(),
    });

    account.updatedAt = Date.now();
    saveStore();

    console.log(`[UserAccounts] Login + new device: ${trimmedUsername} (${device.deviceName})`);

    return { success: true, deviceToken, isNewDevice: true };
  }

  // Login without device registration — return existing devices for de-duplication
  return {
    success: true,
    existingDevices: account.devices.map((d) => d.deviceName),
  };
}

/**
 * 비밀번호 확인 (카카오톡 등 메신저에서 인증 시 사용)
 */
export function verifyPassword(username: string, password: string): boolean {
  const store = loadStore();
  const account = store.get(username.trim().toLowerCase());
  if (!account) return false;
  return hashPassword(password) === account.passwordHash;
}

/**
 * 사용자명으로 계정 조회
 */
export function findAccountByUsername(username: string): UserAccount | null {
  const store = loadStore();
  return store.get(username.trim().toLowerCase()) ?? null;
}

/**
 * 메신저 채널 ID로 연동된 계정 조회
 * (카카오톡 userId → 연동된 MoA 계정)
 */
export function findAccountByChannel(channelId: string, userId: string): UserAccount | null {
  const store = loadStore();
  for (const account of store.values()) {
    if (account.linkedChannels[channelId] === userId) {
      return account;
    }
  }
  return null;
}

/**
 * 메신저 채널 연동 (카카오톡에서 인증 성공 후 호출)
 */
export function linkChannel(username: string, channelId: string, userId: string): boolean {
  const store = loadStore();
  const account = store.get(username.trim().toLowerCase());
  if (!account) return false;

  account.linkedChannels[channelId] = userId;
  account.updatedAt = Date.now();
  saveStore();

  console.log(`[UserAccounts] Channel linked: ${username} <- ${channelId}:${userId.slice(0, 8)}...`);
  return true;
}

/**
 * 등록된 계정이 하나라도 있는지 확인
 */
export function hasAnyAccount(): boolean {
  return loadStore().size > 0;
}

/**
 * 총 계정 수
 */
export function getAccountCount(): number {
  return loadStore().size;
}

/**
 * 계정의 기기 목록
 */
export function getAccountDevices(username: string): DeviceInfo[] {
  const account = findAccountByUsername(username);
  return account?.devices ?? [];
}

/**
 * 기기 삭제
 */
export function removeAccountDevice(username: string, deviceName: string): boolean {
  const store = loadStore();
  const account = store.get(username.trim().toLowerCase());
  if (!account) return false;

  const idx = account.devices.findIndex(
    (d) => d.deviceName.toLowerCase() === deviceName.toLowerCase(),
  );
  if (idx === -1) return false;

  account.devices.splice(idx, 1);
  account.updatedAt = Date.now();
  saveStore();
  return true;
}

/**
 * 모든 계정 목록 (관리용, 비밀번호 해시 제외)
 */
export function listAccounts(): Array<{
  username: string;
  deviceCount: number;
  channelCount: number;
  createdAt: number;
}> {
  const store = loadStore();
  const result: Array<{
    username: string;
    deviceCount: number;
    channelCount: number;
    createdAt: number;
  }> = [];

  for (const account of store.values()) {
    result.push({
      username: account.username,
      deviceCount: account.devices.length,
      channelCount: Object.keys(account.linkedChannels).length,
      createdAt: account.createdAt,
    });
  }

  return result;
}
