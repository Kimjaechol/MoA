/**
 * Gateway Authentication
 *
 * HMAC-SHA256 based authentication for:
 * 1. Gateway → MoA API calls (internal auth)
 * 2. External webhook verification (per-channel)
 * 3. Admin API access (Bearer token)
 *
 * Benchmarked from OpenClaw's RBAC + HMAC auth pattern.
 */

import { createHmac, timingSafeEqual } from "node:crypto";
import { logger } from "../logger.js";

/**
 * Generate HMAC-SHA256 signature for internal API calls.
 * The MoA API verifies this to authenticate gateway requests.
 */
export function signRequest(payload: string, secret: string): string {
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const data = `${timestamp}:${payload}`;
  const signature = createHmac("sha256", secret).update(data).digest("hex");
  return `${timestamp}:${signature}`;
}

/**
 * Verify an HMAC-SHA256 signed request (5-minute window).
 */
export function verifySignedRequest(
  token: string,
  payload: string,
  secret: string,
  maxAgeMs = 300_000,
): boolean {
  try {
    const parts = token.split(":");
    if (parts.length !== 2) return false;

    const [timestamp, signature] = parts;
    const ts = parseInt(timestamp, 10);
    if (isNaN(ts)) return false;

    // Check freshness
    const age = Date.now() - ts * 1000;
    if (age < 0 || age > maxAgeMs) return false;

    // Verify HMAC
    const data = `${timestamp}:${payload}`;
    const expected = createHmac("sha256", secret).update(data).digest("hex");

    return safeCompare(signature, expected);
  } catch {
    return false;
  }
}

/**
 * Verify channel-specific webhook signatures.
 * Each channel has its own signature format.
 */
export function verifyHmacSha256(
  body: string,
  signature: string,
  secret: string,
  prefix = "",
): boolean {
  try {
    const expected = prefix + createHmac("sha256", secret).update(body).digest("hex");
    return safeCompare(expected, signature);
  } catch {
    return false;
  }
}

/**
 * Verify Base64-encoded HMAC-SHA256 (used by some platforms like LINE).
 */
export function verifyHmacSha256Base64(
  body: string,
  signature: string,
  secret: string,
): boolean {
  try {
    const expected = createHmac("sha256", secret).update(body).digest("base64");
    return safeCompare(expected, signature);
  } catch {
    return false;
  }
}

/**
 * Verify admin API Bearer token.
 */
export function verifyAdminToken(authHeader: string | undefined, adminSecret: string): boolean {
  if (!authHeader) return false;
  const token = authHeader.replace(/^Bearer\s+/i, "");
  return safeCompare(token, adminSecret);
}

/**
 * Timing-safe string comparison to prevent timing attacks.
 */
function safeCompare(a: string, b: string): boolean {
  try {
    const bufA = Buffer.from(a, "utf8");
    const bufB = Buffer.from(b, "utf8");
    if (bufA.length !== bufB.length) return false;
    return timingSafeEqual(bufA, bufB);
  } catch {
    return false;
  }
}

/** Log a security event */
export function logSecurityEvent(
  eventType: string,
  channel: string,
  userId: string,
  details: Record<string, unknown> = {},
): void {
  logger.warn("Security event", {
    eventType,
    channel,
    userId: hashForLog(userId),
    ...details,
  });
}

/** Hash a value for safe logging (no PII in logs) */
function hashForLog(value: string): string {
  return createHmac("sha256", "moa-gateway-audit")
    .update(value)
    .digest("hex")
    .slice(0, 12);
}
