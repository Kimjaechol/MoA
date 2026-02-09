/**
 * Backup Credentials — 백업 비밀번호 + 복구키 관리
 *
 * ## 개념
 * - 백업 비밀번호: 서버 백업 시 암호화에 사용하는 별도의 비밀번호 (로그인 비밀번호와 분리)
 * - 복구키 (12단어): 백업 비밀번호 분실 시 비밀번호를 재설정하기 위한 니모닉
 *
 * ## 흐름
 * 1. 첫 백업 요청 → 백업 비밀번호 설정 + 복구키(12단어) 발급
 * 2. 이후 백업 → 백업 비밀번호로 암호화
 * 3. 복원 → 백업 비밀번호로 복호화
 * 4. 비밀번호 분실 → 복구키(12단어)로 비밀번호 재설정
 *
 * ## 저장
 * .moa-data/backup-credentials.json
 * {
 *   "username": {
 *     "backupPasswordHash": "hex...",
 *     "recoveryKeyHash": "hex...",
 *     "createdAt": 12345,
 *     "lastBackupAt": 12345
 *   }
 * }
 */

import { createHmac, createHash } from "node:crypto";
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";

// ============================================
// Types
// ============================================

export interface BackupCredential {
  backupPasswordHash: string;
  recoveryKeyHash: string;
  createdAt: number;
  lastBackupAt?: number;
}

// ============================================
// Constants
// ============================================

const HMAC_KEY = "moa-backup-credential";
const MIN_BACKUP_PASSWORD_LENGTH = 4;

// ============================================
// Storage
// ============================================

let credentialStore: Map<string, BackupCredential> | null = null;

function getStorePath(): string {
  const dataDir = process.env.MOA_DATA_DIR ?? join(process.cwd(), ".moa-data");
  return join(dataDir, "backup-credentials.json");
}

function loadStore(): Map<string, BackupCredential> {
  if (credentialStore) return credentialStore;

  credentialStore = new Map();
  const filePath = getStorePath();
  if (!existsSync(filePath)) return credentialStore;

  try {
    const data = JSON.parse(readFileSync(filePath, "utf-8")) as Record<string, BackupCredential>;
    for (const [key, entry] of Object.entries(data)) {
      credentialStore.set(key, entry);
    }
  } catch {
    // File corrupt — start fresh
  }
  return credentialStore;
}

function saveStore(): void {
  try {
    const filePath = getStorePath();
    mkdirSync(dirname(filePath), { recursive: true });
    const data: Record<string, BackupCredential> = {};
    const store = loadStore();
    for (const [key, entry] of store) {
      data[key] = entry;
    }
    writeFileSync(filePath, JSON.stringify(data, null, 2), "utf-8");
  } catch (err) {
    console.error("[BackupCredentials] Failed to save:", err);
  }
}

function hashBackupPassword(password: string): string {
  return createHmac("sha256", HMAC_KEY).update(password).digest("hex");
}

function hashRecoveryKey(words: string[]): string {
  return createHash("sha256").update(words.join(" ")).digest("hex");
}

// ============================================
// Public API
// ============================================

/**
 * 백업 비밀번호 설정 여부 확인
 */
export function hasBackupPassword(username: string): boolean {
  const store = loadStore();
  return store.has(username.trim().toLowerCase());
}

/**
 * 백업 비밀번호 설정 + 복구키 해시 저장
 *
 * @returns error message if failed, null if success
 */
export function setBackupPassword(
  username: string,
  backupPassword: string,
  recoveryKeyHash: string,
): string | null {
  const trimmed = username.trim().toLowerCase();

  if (backupPassword.length < MIN_BACKUP_PASSWORD_LENGTH) {
    return `백업 비밀번호는 최소 ${MIN_BACKUP_PASSWORD_LENGTH}자 이상이어야 합니다.`;
  }

  const store = loadStore();

  if (store.has(trimmed)) {
    return "이미 백업 비밀번호가 설정되어 있습니다. 변경하려면 복구키를 사용하세요.";
  }

  store.set(trimmed, {
    backupPasswordHash: hashBackupPassword(backupPassword),
    recoveryKeyHash,
    createdAt: Date.now(),
  });
  saveStore();

  console.log(`[BackupCredentials] Backup password set for: ${trimmed}`);
  return null;
}

/**
 * 백업 비밀번호 검증
 */
export function verifyBackupPassword(username: string, backupPassword: string): boolean {
  const store = loadStore();
  const cred = store.get(username.trim().toLowerCase());
  if (!cred) return false;
  return hashBackupPassword(backupPassword) === cred.backupPasswordHash;
}

/**
 * 복구키(12단어)로 백업 비밀번호 재설정
 *
 * @returns error message if failed, null if success
 */
export function resetBackupPasswordWithRecoveryKey(
  username: string,
  recoveryWords: string[],
  newBackupPassword: string,
): string | null {
  const trimmed = username.trim().toLowerCase();
  const store = loadStore();
  const cred = store.get(trimmed);

  if (!cred) {
    return "백업 비밀번호가 설정되지 않은 계정입니다.";
  }

  if (newBackupPassword.length < MIN_BACKUP_PASSWORD_LENGTH) {
    return `백업 비밀번호는 최소 ${MIN_BACKUP_PASSWORD_LENGTH}자 이상이어야 합니다.`;
  }

  // 복구키 검증
  const inputHash = hashRecoveryKey(recoveryWords);
  if (inputHash !== cred.recoveryKeyHash) {
    return "복구키가 일치하지 않습니다. 12단어를 정확히 입력해주세요.";
  }

  // 비밀번호 재설정
  cred.backupPasswordHash = hashBackupPassword(newBackupPassword);
  saveStore();

  console.log(`[BackupCredentials] Backup password reset via recovery key for: ${trimmed}`);
  return null;
}

/**
 * 마지막 백업 시각 업데이트
 */
export function updateLastBackupTime(username: string): void {
  const store = loadStore();
  const cred = store.get(username.trim().toLowerCase());
  if (cred) {
    cred.lastBackupAt = Date.now();
    saveStore();
  }
}

/**
 * 백업 자격증명 조회
 */
export function getBackupCredential(username: string): BackupCredential | null {
  const store = loadStore();
  return store.get(username.trim().toLowerCase()) ?? null;
}
