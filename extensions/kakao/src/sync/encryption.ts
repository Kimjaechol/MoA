/**
 * E2E Encryption Module
 *
 * Implements AES-256-GCM encryption for end-to-end encrypted memory sync.
 * All encryption/decryption happens client-side - server never sees plaintext.
 *
 * Security features:
 * - AES-256-GCM for authenticated encryption
 * - PBKDF2 for key derivation from user passphrase
 * - Random IV for each encryption
 * - SHA-256 checksum for data integrity verification
 */

import { createCipheriv, createDecipheriv, createHash, pbkdf2Sync, randomBytes } from "crypto";

// Encryption constants
const ALGORITHM = "aes-256-gcm";
const KEY_LENGTH = 32; // 256 bits
const IV_LENGTH = 12; // 96 bits (recommended for GCM)
const AUTH_TAG_LENGTH = 16; // 128 bits
const PBKDF2_ITERATIONS = 100000; // OWASP recommendation
const SALT_LENGTH = 32; // 256 bits

export interface EncryptedData {
  ciphertext: string; // Base64 encoded
  iv: string; // Base64 encoded
  authTag: string; // Base64 encoded
  checksum: string; // SHA-256 of plaintext
}

export interface EncryptionKey {
  key: Buffer;
  salt: string; // Base64 encoded
}

/**
 * Generate a new random salt for key derivation
 */
export function generateSalt(): string {
  return randomBytes(SALT_LENGTH).toString("base64");
}

/**
 * Derive encryption key from user passphrase using PBKDF2
 *
 * @param passphrase - User's passphrase (should be strong)
 * @param salt - Base64 encoded salt (stored server-side, but useless without passphrase)
 * @returns Derived key and salt
 */
export function deriveKey(passphrase: string, salt?: string): EncryptionKey {
  const actualSalt = salt ?? generateSalt();
  const saltBuffer = Buffer.from(actualSalt, "base64");

  const key = pbkdf2Sync(passphrase, saltBuffer, PBKDF2_ITERATIONS, KEY_LENGTH, "sha256");

  return {
    key,
    salt: actualSalt,
  };
}

/**
 * Generate a random encryption key (for device-specific keys)
 */
export function generateRandomKey(): Buffer {
  return randomBytes(KEY_LENGTH);
}

/**
 * Calculate SHA-256 checksum of data
 */
export function calculateChecksum(data: string | Buffer): string {
  const hash = createHash("sha256");
  hash.update(data);
  return hash.digest("hex");
}

/**
 * Encrypt data using AES-256-GCM
 *
 * @param plaintext - Data to encrypt (string or Buffer)
 * @param key - 256-bit encryption key
 * @returns Encrypted data with IV and auth tag
 */
export function encrypt(plaintext: string | Buffer, key: Buffer): EncryptedData {
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, key, iv, { authTagLength: AUTH_TAG_LENGTH });

  const plaintextBuffer =
    typeof plaintext === "string" ? Buffer.from(plaintext, "utf-8") : plaintext;

  const encrypted = Buffer.concat([cipher.update(plaintextBuffer), cipher.final()]);

  const authTag = cipher.getAuthTag();
  const checksum = calculateChecksum(plaintextBuffer);

  return {
    ciphertext: encrypted.toString("base64"),
    iv: iv.toString("base64"),
    authTag: authTag.toString("base64"),
    checksum,
  };
}

/**
 * Decrypt data using AES-256-GCM
 *
 * @param encryptedData - Encrypted data with IV and auth tag
 * @param key - 256-bit encryption key
 * @returns Decrypted plaintext
 * @throws Error if decryption fails (wrong key or tampered data)
 */
export function decrypt(encryptedData: EncryptedData, key: Buffer): Buffer {
  const iv = Buffer.from(encryptedData.iv, "base64");
  const ciphertext = Buffer.from(encryptedData.ciphertext, "base64");
  const authTag = Buffer.from(encryptedData.authTag, "base64");

  const decipher = createDecipheriv(ALGORITHM, key, iv, { authTagLength: AUTH_TAG_LENGTH });
  decipher.setAuthTag(authTag);

  const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()]);

  // Verify checksum
  const actualChecksum = calculateChecksum(decrypted);
  if (actualChecksum !== encryptedData.checksum) {
    throw new Error("Data integrity check failed - checksum mismatch");
  }

  return decrypted;
}

/**
 * Decrypt data and return as string
 */
export function decryptToString(encryptedData: EncryptedData, key: Buffer): string {
  return decrypt(encryptedData, key).toString("utf-8");
}

/**
 * Encrypt JSON data
 */
export function encryptJSON<T>(data: T, key: Buffer): EncryptedData {
  const jsonString = JSON.stringify(data);
  return encrypt(jsonString, key);
}

/**
 * Decrypt to JSON
 */
export function decryptJSON<T>(encryptedData: EncryptedData, key: Buffer): T {
  const jsonString = decryptToString(encryptedData, key);
  return JSON.parse(jsonString) as T;
}

/**
 * Compress and encrypt large data (for memory/conversation sync)
 * Uses gzip compression before encryption for efficiency
 */
export async function compressAndEncrypt(
  data: string | Buffer,
  key: Buffer,
): Promise<EncryptedData> {
  const { gzip } = await import("zlib");
  const { promisify } = await import("util");
  const gzipAsync = promisify(gzip);

  const dataBuffer = typeof data === "string" ? Buffer.from(data, "utf-8") : data;
  const compressed = await gzipAsync(dataBuffer);

  return encrypt(compressed, key);
}

/**
 * Decrypt and decompress large data
 */
export async function decryptAndDecompress(
  encryptedData: EncryptedData,
  key: Buffer,
): Promise<Buffer> {
  const { gunzip } = await import("zlib");
  const { promisify } = await import("util");
  const gunzipAsync = promisify(gunzip);

  const decrypted = decrypt(encryptedData, key);
  return gunzipAsync(decrypted);
}

/**
 * Generate a human-readable recovery code from the encryption key
 * Format: XXXX-XXXX-XXXX-XXXX (16 characters)
 */
export function keyToRecoveryCode(key: Buffer): string {
  // Use first 16 bytes to generate a memorable code
  const hash = createHash("sha256").update(key).digest();
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // No confusing chars (0/O, 1/I/L)

  let code = "";
  for (let i = 0; i < 16; i++) {
    code += chars[hash[i] % chars.length];
    if (i > 0 && (i + 1) % 4 === 0 && i < 15) {
      code += "-";
    }
  }

  return code;
}

/**
 * Verify if a recovery code matches a key
 */
export function verifyRecoveryCode(key: Buffer, code: string): boolean {
  const expectedCode = keyToRecoveryCode(key);
  const normalizedCode = code.toUpperCase().replace(/-/g, "");
  const normalizedExpected = expectedCode.replace(/-/g, "");
  return normalizedCode === normalizedExpected;
}

// Type exports for external use
export type { EncryptedData as E2EEncryptedData, EncryptionKey as E2EEncryptionKey };
