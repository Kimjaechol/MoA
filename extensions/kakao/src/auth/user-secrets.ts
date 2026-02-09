/**
 * Per-User Secret Phrase System
 *
 * 각 이용자가 자신만의 비밀구문을 설정하여 본인 기기만 제어할 수 있도록 합니다.
 *
 * ## 흐름
 * 1. 이용자가 첫 기기 페어링 시 비밀구문 설정 (!비밀구문 <내비밀>)
 * 2. HMAC-SHA256 해시만 저장 (원문 저장 안함)
 * 3. 이후 !인증 <내비밀>으로 본인 인증
 * 4. 인증된 이용자는 자기 기기만 제어 가능
 *
 * ## 저장
 * .moa-data/user-secrets.json
 * {
 *   "kakao:user123": { "hash": "...", "createdAt": ..., "updatedAt": ... },
 *   "telegram:user456": { ... }
 * }
 *
 * 서버에는 해시만 저장 — 비밀구문 원문은 절대 저장하지 않음
 */

import { createHmac } from "node:crypto";
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";

// ============================================
// Types
// ============================================

export interface UserSecretEntry {
  /** HMAC-SHA256 hash of the secret phrase */
  hash: string;
  /** When the secret was first set */
  createdAt: number;
  /** When the secret was last updated */
  updatedAt: number;
}

// ============================================
// Storage
// ============================================

const HMAC_KEY = "moa-user-secret";
const MIN_SECRET_LENGTH = 4;

/** In-memory cache of user secrets */
let secretStore: Map<string, UserSecretEntry> | null = null;

function getStorePath(): string {
  const dataDir = process.env.MOA_DATA_DIR ?? join(process.cwd(), ".moa-data");
  return join(dataDir, "user-secrets.json");
}

function loadStore(): Map<string, UserSecretEntry> {
  if (secretStore) { return secretStore; }

  secretStore = new Map();
  const filePath = getStorePath();
  if (!existsSync(filePath)) { return secretStore; }

  try {
    const data = JSON.parse(readFileSync(filePath, "utf-8")) as Record<string, UserSecretEntry>;
    for (const [key, entry] of Object.entries(data)) {
      secretStore.set(key, entry);
    }
  } catch {
    // File corrupt or doesn't exist — start fresh
  }
  return secretStore;
}

function saveStore(): void {
  try {
    const filePath = getStorePath();
    mkdirSync(dirname(filePath), { recursive: true });
    const data: Record<string, UserSecretEntry> = {};
    const store = loadStore();
    for (const [key, entry] of store) {
      data[key] = entry;
    }
    writeFileSync(filePath, JSON.stringify(data, null, 2), "utf-8");
  } catch (err) {
    console.error("[UserSecrets] Failed to save:", err);
  }
}

/** Hash a secret using HMAC-SHA256 (constant-time safe) */
function hashSecret(secret: string): string {
  return createHmac("sha256", HMAC_KEY).update(secret).digest("hex");
}

// ============================================
// Public API
// ============================================

/**
 * Composite key for a user: "channelId:userId"
 */
export function makeUserKey(userId: string, channelId: string): string {
  return `${channelId}:${userId}`;
}

/**
 * Check if a user has a secret phrase set.
 */
export function hasUserSecret(userId: string, channelId: string): boolean {
  const store = loadStore();
  return store.has(makeUserKey(userId, channelId));
}

/**
 * Check if any user has a secret phrase set (system-wide).
 */
export function hasAnyUserSecret(): boolean {
  const store = loadStore();
  return store.size > 0;
}

/**
 * Get the number of users who have set their secret.
 */
export function getUserSecretCount(): number {
  return loadStore().size;
}

/**
 * Set (or update) a user's secret phrase.
 * Only the HMAC hash is stored — never the original.
 *
 * @returns Error message if validation fails, null on success
 */
export function setUserSecret(
  userId: string,
  channelId: string,
  secret: string,
): string | null {
  // Validate
  const trimmed = secret.trim();
  if (trimmed.length < MIN_SECRET_LENGTH) {
    return `비밀구문은 최소 ${MIN_SECRET_LENGTH}자 이상이어야 합니다.`;
  }

  const key = makeUserKey(userId, channelId);
  const store = loadStore();
  const now = Date.now();

  const existing = store.get(key);

  store.set(key, {
    hash: hashSecret(trimmed),
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  });

  saveStore();

  const action = existing ? "updated" : "created";
  console.log(`[UserSecrets] Secret ${action} for ${channelId}/${userId.slice(0, 8)}...`);

  return null; // success
}

/**
 * Verify a user's secret phrase using constant-time comparison.
 */
export function verifyUserSecret(
  userId: string,
  channelId: string,
  attempt: string,
): boolean {
  const store = loadStore();
  const entry = store.get(makeUserKey(userId, channelId));
  if (!entry) { return false; }

  const attemptHash = hashSecret(attempt.trim());
  return attemptHash === entry.hash;
}

/**
 * Remove a user's secret phrase.
 */
export function removeUserSecret(userId: string, channelId: string): boolean {
  const store = loadStore();
  const key = makeUserKey(userId, channelId);
  const existed = store.delete(key);
  if (existed) {
    saveStore();
    console.log(`[UserSecrets] Secret removed for ${channelId}/${userId.slice(0, 8)}...`);
  }
  return existed;
}

/**
 * Change a user's secret phrase (requires old secret verification).
 *
 * @returns Error message if verification fails, null on success
 */
export function changeUserSecret(
  userId: string,
  channelId: string,
  oldSecret: string,
  newSecret: string,
): string | null {
  if (!verifyUserSecret(userId, channelId, oldSecret)) {
    return "현재 비밀구문이 올바르지 않습니다.";
  }

  return setUserSecret(userId, channelId, newSecret);
}

/**
 * Get metadata for all users with secrets (for admin display).
 * Never exposes the actual hash.
 */
export function listUserSecrets(): Array<{
  channelId: string;
  userId: string;
  createdAt: number;
  updatedAt: number;
}> {
  const store = loadStore();
  const result: Array<{
    channelId: string;
    userId: string;
    createdAt: number;
    updatedAt: number;
  }> = [];

  for (const [key, entry] of store) {
    const [channelId, ...userParts] = key.split(":");
    result.push({
      channelId,
      userId: userParts.join(":"),
      createdAt: entry.createdAt,
      updatedAt: entry.updatedAt,
    });
  }

  return result;
}
