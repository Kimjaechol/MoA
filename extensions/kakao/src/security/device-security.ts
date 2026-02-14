/**
 * Device Security Module — Protects data on lost/stolen devices
 *
 * Threat model:
 * 1. Phone lost/stolen → thief has physical access
 * 2. Thief connects phone to computer → tries to extract DB files
 * 3. Thief opens chat apps → tries to read conversation history
 * 4. Thief impersonates user → tries to chat with MoA
 *
 * Defense layers:
 *
 * Layer 1: User Authentication (already implemented)
 *   - Only verified user can chat with MoA
 *   - KakaoTalk/Telegram/etc. require account login
 *
 * Layer 2: Database Encryption at Rest
 *   - sqlite-vec DB file encrypted with AES-256-GCM
 *   - Key derived from device fingerprint + user passphrase (PBKDF2)
 *   - DB file is meaningless without the correct key
 *   - Even if someone copies the file, they can't read it
 *
 * Layer 3: Device Binding
 *   - DB encryption key is partly derived from hardware fingerprint
 *   - Moving the encrypted DB to another device makes it unreadable
 *   - Fingerprint includes: device ID, OS, model hash
 *
 * Layer 4: Chat History Protection
 *   - Auto-purge chat history after configurable interval
 *   - Conversations stored only as embeddings (not readable text)
 *   - Readable text stored temporarily, purged after embedding
 *
 * Layer 5: Remote Wipe (see remote-wipe.ts)
 *   - User can trigger wipe from any channel
 *   - Wipe command queued, executed when device comes online
 */

import { createCipheriv, createDecipheriv, createHash, pbkdf2Sync, randomBytes } from "node:crypto";
import { existsSync, readFileSync, writeFileSync, unlinkSync, statSync } from "node:fs";
import { join, dirname } from "node:path";
import type { DeviceSecurityConfig } from "../relay/types.js";

// Security constants
const PBKDF2_ITERATIONS = 200_000; // Higher than sync encryption for extra security
const KEY_LENGTH = 32; // AES-256
const IV_LENGTH = 12; // GCM
const AUTH_TAG_LENGTH = 16;
const SALT_LENGTH = 32;
const FINGERPRINT_SEPARATOR = "|moa-device|";

// File names
const SECURITY_CONFIG_FILE = ".moa-security.json";
const ENCRYPTED_DB_EXTENSION = ".moa-encrypted";
const DB_SALT_FILE = ".moa-db-salt";

/**
 * Generate a device fingerprint for key binding.
 *
 * The fingerprint combines multiple device properties so that
 * the encryption key is specific to this exact device.
 * If the DB file is copied to another device, decryption fails.
 */
export function generateDeviceFingerprint(params: {
  /** Unique device identifier (e.g. Android ID, iOS identifierForVendor) */
  deviceId: string;
  /** OS name + version (e.g. "iOS 17.2", "Android 14") */
  osInfo: string;
  /** Device model hash (e.g. "iPhone15,2", "SM-S918B") */
  modelHash: string;
  /** Optional: app installation ID (changes on reinstall = extra protection) */
  installId?: string;
}): string {
  const parts = [
    params.deviceId,
    params.osInfo,
    params.modelHash,
    params.installId ?? "default",
    FINGERPRINT_SEPARATOR,
  ];

  return createHash("sha256").update(parts.join(FINGERPRINT_SEPARATOR)).digest("hex");
}

/**
 * Derive the database encryption key from device fingerprint + user passphrase.
 *
 * This two-factor key derivation ensures:
 * - Without the device: key is different (fingerprint changes)
 * - Without the passphrase: key is different
 * - Both required for decryption
 */
export function deriveDbEncryptionKey(params: {
  deviceFingerprint: string;
  userPassphrase: string;
  salt?: string;
}): { key: Buffer; salt: string } {
  const salt = params.salt ?? randomBytes(SALT_LENGTH).toString("base64");
  const saltBuffer = Buffer.from(salt, "base64");

  // Combine fingerprint and passphrase as the key material
  const keyMaterial = `${params.deviceFingerprint}${FINGERPRINT_SEPARATOR}${params.userPassphrase}`;

  const key = pbkdf2Sync(keyMaterial, saltBuffer, PBKDF2_ITERATIONS, KEY_LENGTH, "sha512");

  return { key, salt };
}

/**
 * Encrypt a database file at rest.
 *
 * Reads the plaintext DB, encrypts it with AES-256-GCM, and writes
 * the encrypted version. The original file is securely overwritten.
 *
 * File format:
 * [4 bytes: IV length] [IV] [encrypted data] [16 bytes: auth tag]
 */
export function encryptDatabaseFile(params: {
  dbPath: string;
  encryptionKey: Buffer;
}): { encryptedPath: string; originalSize: number; encryptedSize: number } {
  const { dbPath, encryptionKey } = params;

  if (!existsSync(dbPath)) {
    throw new Error(`Database file not found: ${dbPath}`);
  }

  const plaintext = readFileSync(dbPath);
  const iv = randomBytes(IV_LENGTH);

  const cipher = createCipheriv("aes-256-gcm", encryptionKey, iv, {
    authTagLength: AUTH_TAG_LENGTH,
  });
  const encrypted = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const authTag = cipher.getAuthTag();

  // File format: [4B iv_len][iv][ciphertext][auth_tag]
  const ivLenBuf = Buffer.alloc(4);
  ivLenBuf.writeUInt32BE(iv.length);

  const output = Buffer.concat([ivLenBuf, iv, encrypted, authTag]);
  const encryptedPath = dbPath + ENCRYPTED_DB_EXTENSION;

  writeFileSync(encryptedPath, output);

  // Securely overwrite original with random data before deleting
  const originalSize = plaintext.length;
  writeFileSync(dbPath, randomBytes(originalSize));
  unlinkSync(dbPath);

  return {
    encryptedPath,
    originalSize,
    encryptedSize: output.length,
  };
}

/**
 * Decrypt a database file for use.
 *
 * Reads the encrypted file, decrypts it, and writes the plaintext DB.
 * The encrypted file is kept as backup.
 */
export function decryptDatabaseFile(params: {
  encryptedPath: string;
  encryptionKey: Buffer;
  outputPath: string;
}): { dbPath: string; size: number } {
  const { encryptedPath, encryptionKey, outputPath } = params;

  if (!existsSync(encryptedPath)) {
    throw new Error(`Encrypted database not found: ${encryptedPath}`);
  }

  const data = readFileSync(encryptedPath);

  // Parse file format
  const ivLen = data.readUInt32BE(0);
  const iv = data.subarray(4, 4 + ivLen);
  const authTag = data.subarray(data.length - AUTH_TAG_LENGTH);
  const ciphertext = data.subarray(4 + ivLen, data.length - AUTH_TAG_LENGTH);

  const decipher = createDecipheriv("aes-256-gcm", encryptionKey, iv, {
    authTagLength: AUTH_TAG_LENGTH,
  });
  decipher.setAuthTag(authTag);

  const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);

  writeFileSync(outputPath, plaintext);

  return { dbPath: outputPath, size: plaintext.length };
}

/**
 * Device Security Manager
 *
 * Manages the full lifecycle of device security:
 * - Initial setup (fingerprint, key derivation, DB encryption)
 * - Runtime (decrypt for use, re-encrypt after)
 * - Chat history auto-purge
 * - Security config management
 */
export class DeviceSecurityManager {
  private config: DeviceSecurityConfig;
  private encryptionKey: Buffer | null = null;
  private dataDir: string;

  constructor(dataDir: string, config?: Partial<DeviceSecurityConfig>) {
    this.dataDir = dataDir;
    this.config = {
      deviceFingerprint: config?.deviceFingerprint ?? "",
      dbEncryptedAtRest: config?.dbEncryptedAtRest ?? false,
      chatAutoPurge: config?.chatAutoPurge ?? true,
      chatPurgeIntervalHours: config?.chatPurgeIntervalHours ?? 24,
      ...config,
    };
  }

  /**
   * Initialize device security with fingerprint and passphrase.
   * This sets up DB encryption and stores the security config.
   */
  async initialize(params: {
    deviceFingerprint: string;
    userPassphrase: string;
  }): Promise<{ success: boolean; error?: string }> {
    try {
      this.config.deviceFingerprint = params.deviceFingerprint;

      // Derive and store salt
      const saltPath = join(this.dataDir, DB_SALT_FILE);
      let salt: string | undefined;

      if (existsSync(saltPath)) {
        salt = readFileSync(saltPath, "utf-8");
      }

      const { key, salt: newSalt } = deriveDbEncryptionKey({
        deviceFingerprint: params.deviceFingerprint,
        userPassphrase: params.userPassphrase,
        salt,
      });

      this.encryptionKey = key;

      if (!salt) {
        writeFileSync(saltPath, newSalt);
      }

      this.config.dbEncryptedAtRest = true;
      this.saveConfig();

      return { success: true };
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : "Unknown error" };
    }
  }

  /**
   * Encrypt the memory database at rest.
   * Call this when the app goes to background or device locks.
   */
  encryptDatabase(dbPath: string): { success: boolean; error?: string } {
    if (!this.encryptionKey) {
      return { success: false, error: "Security not initialized" };
    }

    try {
      encryptDatabaseFile({ dbPath, encryptionKey: this.encryptionKey });
      return { success: true };
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : "Unknown error" };
    }
  }

  /**
   * Decrypt the memory database for use.
   * Call this when the app comes to foreground and user is authenticated.
   */
  decryptDatabase(outputPath: string): { success: boolean; error?: string } {
    if (!this.encryptionKey) {
      return { success: false, error: "Security not initialized" };
    }

    const encryptedPath = outputPath + ENCRYPTED_DB_EXTENSION;
    if (!existsSync(encryptedPath)) {
      // No encrypted DB — first run or already decrypted
      return { success: true };
    }

    try {
      decryptDatabaseFile({
        encryptedPath,
        encryptionKey: this.encryptionKey,
        outputPath,
      });
      return { success: true };
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : "Decryption failed — wrong device or passphrase?" };
    }
  }

  /**
   * Purge chat history files older than the configured interval.
   * This removes readable text from the device while keeping
   * the vector embeddings (which are not human-readable).
   */
  purgeChatHistory(chatDirs: string[]): {
    purgedFiles: number;
    purgedBytes: number;
  } {
    if (!this.config.chatAutoPurge) {
      return { purgedFiles: 0, purgedBytes: 0 };
    }

    const cutoff = Date.now() - this.config.chatPurgeIntervalHours * 60 * 60 * 1000;
    let purgedFiles = 0;
    let purgedBytes = 0;

    for (const dir of chatDirs) {
      if (!existsSync(dir)) continue;

      try {
        const { readdirSync } = require("node:fs");
        const files: string[] = readdirSync(dir);

        for (const file of files) {
          // Only purge chat log files, not DB files
          if (!file.endsWith(".jsonl") && !file.endsWith(".log") && !file.endsWith(".txt")) {
            continue;
          }

          const filePath = join(dir, file);
          try {
            const stat = statSync(filePath);
            if (stat.mtimeMs < cutoff) {
              const size = stat.size;
              // Secure delete: overwrite with random data, then unlink
              writeFileSync(filePath, randomBytes(Math.min(size, 4096)));
              unlinkSync(filePath);
              purgedFiles++;
              purgedBytes += size;
            }
          } catch {
            // Skip files we can't access
          }
        }
      } catch {
        // Skip dirs we can't read
      }
    }

    return { purgedFiles, purgedBytes };
  }

  /**
   * Securely wipe all sensitive data from the device.
   * Used by remote wipe and local reset.
   */
  secureWipeAll(params: {
    dbPaths: string[];
    chatDirs: string[];
    credentialPaths: string[];
  }): {
    wipedFiles: number;
    wipedBytes: number;
  } {
    let wipedFiles = 0;
    let wipedBytes = 0;

    const secureDelete = (filePath: string) => {
      try {
        if (!existsSync(filePath)) return;
        const stat = statSync(filePath);
        // Triple overwrite: zeros, ones, random
        const size = stat.size;
        writeFileSync(filePath, Buffer.alloc(size, 0x00));
        writeFileSync(filePath, Buffer.alloc(size, 0xff));
        writeFileSync(filePath, randomBytes(size));
        unlinkSync(filePath);
        wipedFiles++;
        wipedBytes += size;
      } catch {
        // Best effort
      }
    };

    // Wipe DB files (both encrypted and plaintext)
    for (const dbPath of params.dbPaths) {
      secureDelete(dbPath);
      secureDelete(dbPath + ENCRYPTED_DB_EXTENSION);
      secureDelete(dbPath + "-wal");
      secureDelete(dbPath + "-shm");
      secureDelete(dbPath + "-journal");
    }

    // Wipe chat directories
    for (const dir of params.chatDirs) {
      if (!existsSync(dir)) continue;
      try {
        const { readdirSync } = require("node:fs");
        const files: string[] = readdirSync(dir);
        for (const file of files) {
          secureDelete(join(dir, file));
        }
      } catch {
        // Best effort
      }
    }

    // Wipe credentials
    for (const credPath of params.credentialPaths) {
      secureDelete(credPath);
    }

    // Wipe security config and salt
    secureDelete(join(this.dataDir, SECURITY_CONFIG_FILE));
    secureDelete(join(this.dataDir, DB_SALT_FILE));

    // Clear in-memory key
    if (this.encryptionKey) {
      this.encryptionKey.fill(0);
      this.encryptionKey = null;
    }

    return { wipedFiles, wipedBytes };
  }

  /** Verify that the current device matches the stored fingerprint */
  verifyDeviceBinding(currentFingerprint: string): boolean {
    return this.config.deviceFingerprint === currentFingerprint;
  }

  /** Get current security configuration */
  getConfig(): DeviceSecurityConfig {
    return { ...this.config };
  }

  /** Save security config to disk */
  private saveConfig(): void {
    const configPath = join(this.dataDir, SECURITY_CONFIG_FILE);
    writeFileSync(configPath, JSON.stringify(this.config, null, 2));
  }

  /** Load security config from disk */
  static loadConfig(dataDir: string): DeviceSecurityConfig | null {
    const configPath = join(dataDir, SECURITY_CONFIG_FILE);
    if (!existsSync(configPath)) return null;

    try {
      return JSON.parse(readFileSync(configPath, "utf-8")) as DeviceSecurityConfig;
    } catch {
      return null;
    }
  }
}

/**
 * Format security status for display in chat.
 */
export function formatSecurityStatus(config: DeviceSecurityConfig): string {
  const lines = [
    "🔒 기기 보안 상태",
    "",
    `• DB 암호화: ${config.dbEncryptedAtRest ? "✅ 활성" : "❌ 비활성"}`,
    `• 기기 바인딩: ${config.deviceFingerprint ? "✅ 설정됨" : "❌ 미설정"}`,
    `• 채팅 자동 삭제: ${config.chatAutoPurge ? `✅ ${config.chatPurgeIntervalHours}시간` : "❌ 비활성"}`,
  ];

  if (config.lastKeyRotation) {
    const age = Date.now() - new Date(config.lastKeyRotation).getTime();
    const days = Math.floor(age / (24 * 60 * 60 * 1000));
    lines.push(`• 마지막 키 교체: ${days}일 전`);
  }

  return lines.join("\n");
}
