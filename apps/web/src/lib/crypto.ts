/**
 * AES-256-GCM encryption/decryption for sensitive data (API keys, tokens).
 *
 * Uses Node.js native crypto — no external dependencies required.
 * Key is derived from MOA_ENCRYPTION_KEY env var via SHA-256.
 *
 * Storage format: base64(iv + authTag + ciphertext)
 *   iv       = 12 bytes (96 bits, GCM standard)
 *   authTag  = 16 bytes (128 bits)
 *   ciphertext = variable length
 */

import { createCipheriv, createDecipheriv, randomBytes, createHash, scryptSync, randomUUID, timingSafeEqual } from "node:crypto";

// ────────────────────────────────────────────
// AES-256-GCM for API key encryption
// ────────────────────────────────────────────

const AES_ALGO = "aes-256-gcm";
const IV_BYTES = 12;
const AUTH_TAG_BYTES = 16;

function getEncryptionKey(): Buffer {
  const raw = process.env.MOA_ENCRYPTION_KEY;
  if (!raw) {
    throw new Error(
      "MOA_ENCRYPTION_KEY is not set. Required for API key encryption. " +
      "Generate one with: node -e \"console.log(require('crypto').randomBytes(32).toString('hex'))\""
    );
  }
  // Derive a 256-bit key via SHA-256 so any-length secret works
  return createHash("sha256").update(raw).digest();
}

/** Encrypt a plaintext string → base64 ciphertext */
export function encryptAES256(plaintext: string): string {
  const key = getEncryptionKey();
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(AES_ALGO, key, iv);

  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();

  // Pack: iv(12) + authTag(16) + ciphertext(N)
  const packed = Buffer.concat([iv, authTag, encrypted]);
  return packed.toString("base64");
}

/** Decrypt a base64 ciphertext → plaintext string */
export function decryptAES256(ciphertext: string): string {
  const key = getEncryptionKey();
  const packed = Buffer.from(ciphertext, "base64");

  if (packed.length < IV_BYTES + AUTH_TAG_BYTES + 1) {
    throw new Error("Invalid encrypted data: too short");
  }

  const iv = packed.subarray(0, IV_BYTES);
  const authTag = packed.subarray(IV_BYTES, IV_BYTES + AUTH_TAG_BYTES);
  const encrypted = packed.subarray(IV_BYTES + AUTH_TAG_BYTES);

  const decipher = createDecipheriv(AES_ALGO, key, iv);
  decipher.setAuthTag(authTag);

  return decipher.update(encrypted) + decipher.final("utf8");
}

/**
 * Safely decrypt — returns null instead of throwing on failure.
 * Handles legacy plaintext keys gracefully: if the value is not valid
 * base64-encoded AES-256-GCM data, return it as-is (migration path).
 */
export function safeDecrypt(value: string): string {
  try {
    return decryptAES256(value);
  } catch {
    // Legacy plaintext key — return as-is for backward compatibility
    return value;
  }
}

// ────────────────────────────────────────────
// Password hashing with scrypt (Node.js native)
// ────────────────────────────────────────────

const SCRYPT_KEY_LEN = 64;
const SALT_BYTES = 32;
// scrypt params: N=2^15, r=8, p=1 (OWASP recommended)
const SCRYPT_COST = 32768;
const SCRYPT_BLOCK_SIZE = 8;
const SCRYPT_PARALLELIZATION = 1;
// Explicit maxmem: 128*N*r = 32MB exactly equals Node default; set 64MB to avoid boundary issues
const SCRYPT_MAX_MEM = 64 * 1024 * 1024;

/** Hash a password → "salt:hash" (both hex-encoded) */
export function hashPassword(password: string): string {
  const salt = randomBytes(SALT_BYTES);
  const derived = scryptSync(password, salt, SCRYPT_KEY_LEN, {
    cost: SCRYPT_COST,
    blockSize: SCRYPT_BLOCK_SIZE,
    parallelization: SCRYPT_PARALLELIZATION,
    maxmem: SCRYPT_MAX_MEM,
  });
  return `${salt.toString("hex")}:${derived.toString("hex")}`;
}

/** Verify a password against a stored "salt:hash" string (timing-safe) */
export function verifyPassword(password: string, stored: string): boolean {
  const [saltHex, hashHex] = stored.split(":");
  if (!saltHex || !hashHex) return false;

  const salt = Buffer.from(saltHex, "hex");
  const expected = Buffer.from(hashHex, "hex");
  const derived = scryptSync(password, salt, SCRYPT_KEY_LEN, {
    cost: SCRYPT_COST,
    blockSize: SCRYPT_BLOCK_SIZE,
    parallelization: SCRYPT_PARALLELIZATION,
    maxmem: SCRYPT_MAX_MEM,
  });

  if (derived.length !== expected.length) return false;
  return timingSafeEqual(derived, expected);
}

// ────────────────────────────────────────────
// Session token generation
// ────────────────────────────────────────────

/** Generate a cryptographically secure session token */
export function generateSessionToken(): string {
  return `moa_sess_${randomBytes(32).toString("hex")}_${randomUUID().replace(/-/g, "").slice(0, 8)}`;
}
