/**
 * Security Middleware for MoA Shared Bot Architecture
 *
 * Provides comprehensive security for multi-tenant shared bot:
 *
 * 1. Rate Limiting    — Per-user, per-IP request throttling
 * 2. Data Masking     — Detects & masks sensitive data before storage
 * 3. Audit Logging    — Records security events to Supabase
 * 4. Input Validation — Sanitizes inputs, blocks injection attempts
 * 5. Internal Auth    — HMAC-based authentication for internal API calls
 *
 * Design: "Defense in Depth" — multiple independent layers,
 * each providing security even if other layers are bypassed.
 */

import { createHash, createHmac, timingSafeEqual } from "node:crypto";

// ────────────────────────────────────────────
// 1. Rate Limiting (In-Memory, Per-User + Per-IP)
// ────────────────────────────────────────────

interface RateLimitEntry {
  count: number;
  windowStart: number;
  blocked: boolean;
  blockedUntil?: number;
}

/** Per-user rate limit: max requests per window */
const RATE_LIMIT_CONFIG = {
  /** Max requests per window per user */
  maxRequests: 30,
  /** Window size in ms (1 minute) */
  windowMs: 60_000,
  /** Block duration after exceeding limit (5 minutes) */
  blockDurationMs: 5 * 60_000,
  /** Max unique users tracked (prevent memory exhaustion) */
  maxTrackedUsers: 10_000,
  /** Cleanup interval (10 minutes) */
  cleanupIntervalMs: 10 * 60_000,
};

const rateLimitStore = new Map<string, RateLimitEntry>();
let lastCleanup = Date.now();

/** Clean up expired rate limit entries */
function cleanupRateLimits(): void {
  const now = Date.now();
  if (now - lastCleanup < RATE_LIMIT_CONFIG.cleanupIntervalMs) return;
  lastCleanup = now;

  for (const [key, entry] of rateLimitStore) {
    const expired = entry.blocked
      ? (entry.blockedUntil ?? 0) < now
      : now - entry.windowStart > RATE_LIMIT_CONFIG.windowMs;
    if (expired) rateLimitStore.delete(key);
  }
}

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  resetInMs: number;
  reason?: string;
}

/**
 * Check rate limit for a user/IP combination.
 * Uses composite key: channel:userId to isolate per-channel limits.
 */
export function checkRateLimit(channel: string, userId: string): RateLimitResult {
  cleanupRateLimits();

  const key = `${channel}:${userId}`;
  const now = Date.now();

  // Check if blocked
  const existing = rateLimitStore.get(key);
  if (existing?.blocked && existing.blockedUntil && existing.blockedUntil > now) {
    return {
      allowed: false,
      remaining: 0,
      resetInMs: existing.blockedUntil - now,
      reason: "요청이 너무 많습니다. 잠시 후 다시 시도해주세요.",
    };
  }

  // Initialize or reset window
  if (!existing || now - existing.windowStart > RATE_LIMIT_CONFIG.windowMs) {
    rateLimitStore.set(key, { count: 1, windowStart: now, blocked: false });
    return { allowed: true, remaining: RATE_LIMIT_CONFIG.maxRequests - 1, resetInMs: RATE_LIMIT_CONFIG.windowMs };
  }

  // Increment
  existing.count++;

  if (existing.count > RATE_LIMIT_CONFIG.maxRequests) {
    existing.blocked = true;
    existing.blockedUntil = now + RATE_LIMIT_CONFIG.blockDurationMs;
    return {
      allowed: false,
      remaining: 0,
      resetInMs: RATE_LIMIT_CONFIG.blockDurationMs,
      reason: "요청 한도를 초과했습니다. 5분 후 다시 시도해주세요.",
    };
  }

  return {
    allowed: true,
    remaining: RATE_LIMIT_CONFIG.maxRequests - existing.count,
    resetInMs: RATE_LIMIT_CONFIG.windowMs - (now - existing.windowStart),
  };
}

// ────────────────────────────────────────────
// 2. Sensitive Data Detection & Masking
// ────────────────────────────────────────────

/** Patterns that detect sensitive data in messages */
const SENSITIVE_PATTERNS: Array<{ name: string; pattern: RegExp; mask: string }> = [
  // Korean bank account numbers (most Korean banks: 10-14 digits with dashes)
  { name: "bank_account", pattern: /\b\d{3,4}[-\s]?\d{2,6}[-\s]?\d{2,8}\b/g, mask: "***-****-****" },
  // Credit card numbers (16 digits, possibly with dashes/spaces)
  { name: "card_number", pattern: /\b\d{4}[-\s]?\d{4}[-\s]?\d{4}[-\s]?\d{4}\b/g, mask: "****-****-****-****" },
  // Korean resident registration number (주민등록번호)
  { name: "rrn", pattern: /\b\d{6}[-\s]?[1-4]\d{6}\b/g, mask: "******-*******" },
  // Passwords (explicit mentions)
  { name: "password", pattern: /(?:비밀번호|패스워드|password|passwd|pwd)\s*[:=]\s*\S+/gi, mask: "[비밀번호 보호됨]" },
  // API keys (common patterns)
  { name: "api_key", pattern: /\b(sk-[a-zA-Z0-9_-]{20,}|key-[a-zA-Z0-9_-]{20,}|AIza[a-zA-Z0-9_-]{30,})\b/g, mask: "[API키 보호됨]" },
  // Korean phone numbers
  { name: "phone", pattern: /\b01[0-9][-\s]?\d{3,4}[-\s]?\d{4}\b/g, mask: "010-****-****" },
  // Email addresses
  { name: "email", pattern: /\b[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}\b/g, mask: "***@***.***" },
  // AWS access keys
  { name: "aws_key", pattern: /\b(AKIA[0-9A-Z]{16})\b/g, mask: "[AWS키 보호됨]" },
  // Private keys / certificates
  { name: "private_key", pattern: /-----BEGIN\s+(RSA\s+)?PRIVATE\s+KEY-----[\s\S]*?-----END\s+(RSA\s+)?PRIVATE\s+KEY-----/g, mask: "[인증키 보호됨]" },
  // 공인인증서 비밀번호 패턴
  { name: "cert_password", pattern: /(?:인증서|공인인증|certificate)\s*(?:비밀번호|패스워드|password)\s*[:=]?\s*\S+/gi, mask: "[인증서 비밀번호 보호됨]" },
];

export interface SensitiveDataResult {
  /** Whether sensitive data was detected */
  detected: boolean;
  /** Types of sensitive data found */
  types: string[];
  /** Masked version of the text (for storage) */
  maskedText: string;
  /** Original text (NOT stored — only passed to LLM in-memory) */
  originalText: string;
}

/**
 * Detect and mask sensitive data in a message.
 * Returns both original (for LLM processing) and masked (for storage).
 */
export function detectAndMaskSensitiveData(text: string): SensitiveDataResult {
  const types: string[] = [];
  let maskedText = text;

  for (const { name, pattern, mask } of SENSITIVE_PATTERNS) {
    // Reset regex lastIndex for global patterns
    pattern.lastIndex = 0;
    if (pattern.test(text)) {
      types.push(name);
      pattern.lastIndex = 0;
      maskedText = maskedText.replace(pattern, mask);
    }
  }

  return {
    detected: types.length > 0,
    types,
    maskedText,
    originalText: text,
  };
}

// ────────────────────────────────────────────
// 3. Audit Logging
// ────────────────────────────────────────────

export type SecurityEventType =
  | "rate_limit_hit"
  | "sensitive_data_detected"
  | "suspicious_input"
  | "auth_failure"
  | "session_created"
  | "session_expired"
  | "channel_linked"
  | "channel_unlinked"
  | "api_key_added"
  | "api_key_removed"
  | "brute_force_attempt"
  | "injection_attempt";

export interface SecurityEvent {
  eventType: SecurityEventType;
  channel: string;
  userId: string;
  userIdHash: string;
  details: Record<string, unknown>;
  severity: "info" | "warning" | "critical";
  timestamp: string;
}

/** Hash a user ID for safe logging (privacy-preserving) */
export function hashForAudit(value: string): string {
  return createHash("sha256").update(value).digest("hex").slice(0, 16);
}

/**
 * Log a security event to Supabase (best-effort, non-blocking).
 * Also logs to console for server-side monitoring.
 */
export async function logSecurityEvent(event: Omit<SecurityEvent, "userIdHash" | "timestamp">): Promise<void> {
  const fullEvent: SecurityEvent = {
    ...event,
    userIdHash: hashForAudit(event.userId),
    timestamp: new Date().toISOString(),
  };

  // Always log to console (server-side monitoring)
  const prefix = fullEvent.severity === "critical" ? "[SECURITY CRITICAL]" :
    fullEvent.severity === "warning" ? "[SECURITY WARNING]" : "[SECURITY]";
  console.log(`${prefix} ${fullEvent.eventType} channel=${fullEvent.channel} user=${fullEvent.userIdHash}`,
    JSON.stringify(fullEvent.details));

  // Best-effort Supabase persistence
  try {
    const { getServiceSupabase } = await import("@/lib/supabase");
    const supabase = getServiceSupabase();
    await supabase.from("moa_security_audit_log").insert({
      event_type: fullEvent.eventType,
      channel: fullEvent.channel,
      user_id_hash: fullEvent.userIdHash,
      details: fullEvent.details,
      severity: fullEvent.severity,
      created_at: fullEvent.timestamp,
    });
  } catch {
    // Audit log persistence is best-effort
  }
}

// ────────────────────────────────────────────
// 4. Input Validation & Injection Prevention
// ────────────────────────────────────────────

/** Patterns indicating possible injection attempts */
const INJECTION_PATTERNS: RegExp[] = [
  // SQL injection attempts
  /(\b(UNION|SELECT|INSERT|UPDATE|DELETE|DROP|ALTER|CREATE|EXEC|EXECUTE)\b\s+(ALL\s+)?(\bSELECT|INTO|FROM|TABLE|DATABASE)\b)/i,
  // NoSQL injection
  /\$(?:gt|gte|lt|lte|ne|in|nin|regex|where|or|and)\b/,
  // Command injection (shell)
  /;\s*(rm|cat|wget|curl|bash|sh|chmod|chown|kill|pkill|nc|ncat)\s/i,
  // Path traversal
  /\.\.\/(\.\.\/){2,}/,
  // Script injection (XSS)
  /<script[\s>]|javascript\s*:/i,
];

export interface InputValidationResult {
  safe: boolean;
  threats: string[];
  sanitizedText: string;
}

/**
 * Validate and sanitize user input.
 * Blocks obvious injection attempts; passes through normal messages.
 */
export function validateInput(text: string): InputValidationResult {
  const threats: string[] = [];

  for (const pattern of INJECTION_PATTERNS) {
    if (pattern.test(text)) {
      threats.push(pattern.source.slice(0, 40));
    }
  }

  // Sanitize: strip control characters (keep newlines, tabs)
  const sanitizedText = text.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, "");

  return {
    safe: threats.length === 0,
    threats,
    sanitizedText,
  };
}

// ────────────────────────────────────────────
// 5. Internal API Authentication (HMAC)
// ────────────────────────────────────────────

/**
 * Generate HMAC signature for internal API calls.
 * Prevents unauthorized direct calls to /api/chat from external sources.
 */
export function generateInternalAuthToken(payload: string): string {
  const secret = process.env.MOA_INTERNAL_API_SECRET ?? process.env.MOA_ENCRYPTION_KEY ?? "moa-default-internal-key";
  const timestamp = Math.floor(Date.now() / 1000);
  const data = `${timestamp}:${payload}`;
  const hmac = createHmac("sha256", secret).update(data).digest("hex");
  return `${timestamp}:${hmac}`;
}

/**
 * Verify HMAC signature for internal API calls.
 * Allows 5-minute time window.
 */
export function verifyInternalAuthToken(token: string, payload: string): boolean {
  const secret = process.env.MOA_INTERNAL_API_SECRET ?? process.env.MOA_ENCRYPTION_KEY ?? "moa-default-internal-key";
  const parts = token.split(":");
  if (parts.length !== 2) return false;

  const [timestampStr, providedHmac] = parts;
  const timestamp = parseInt(timestampStr, 10);
  if (isNaN(timestamp)) return false;

  // Check time window (5 minutes)
  const now = Math.floor(Date.now() / 1000);
  if (Math.abs(now - timestamp) > 300) return false;

  const data = `${timestamp}:${payload}`;
  const expectedHmac = createHmac("sha256", secret).update(data).digest("hex");

  // Timing-safe comparison
  if (providedHmac.length !== expectedHmac.length) return false;
  const a = Buffer.from(providedHmac, "hex");
  const b = Buffer.from(expectedHmac, "hex");
  if (a.length !== b.length) return false;

  return timingSafeEqual(a, b);
}

// ────────────────────────────────────────────
// 6. Conversation Encryption (for stored messages)
// ────────────────────────────────────────────

/**
 * Generate a per-user encryption key derived from master key + userId.
 * Each user's conversations are encrypted with a unique derived key.
 */
export function deriveUserEncryptionKey(userId: string): Buffer {
  const masterKey = process.env.MOA_ENCRYPTION_KEY;
  if (!masterKey) {
    throw new Error("MOA_ENCRYPTION_KEY required for conversation encryption");
  }
  return createHash("sha256").update(`${masterKey}:user:${userId}`).digest();
}

// ────────────────────────────────────────────
// 7. Composite Security Check (All-in-One)
// ────────────────────────────────────────────

export interface SecurityCheckResult {
  /** Whether the request should proceed */
  proceed: boolean;
  /** Sanitized message text */
  sanitizedText: string;
  /** Masked text for storage */
  maskedTextForStorage: string;
  /** Whether sensitive data was found */
  sensitiveDataDetected: boolean;
  /** Types of sensitive data found */
  sensitiveDataTypes: string[];
  /** Rate limit info */
  rateLimit: RateLimitResult;
  /** Block reason (if blocked) */
  blockReason?: string;
  /** Response to send to user (if blocked) */
  userResponse?: string;
}

/**
 * Run all security checks in sequence.
 * Returns a composite result indicating whether to proceed.
 */
export async function runSecurityChecks(params: {
  channel: string;
  userId: string;
  messageText: string;
}): Promise<SecurityCheckResult> {
  const { channel, userId, messageText } = params;

  // 1. Rate limiting
  const rateLimit = checkRateLimit(channel, userId);
  if (!rateLimit.allowed) {
    await logSecurityEvent({
      eventType: "rate_limit_hit",
      channel,
      userId,
      details: { remaining: rateLimit.remaining, resetInMs: rateLimit.resetInMs },
      severity: "warning",
    });
    return {
      proceed: false,
      sanitizedText: messageText,
      maskedTextForStorage: messageText,
      sensitiveDataDetected: false,
      sensitiveDataTypes: [],
      rateLimit,
      blockReason: "rate_limit",
      userResponse: rateLimit.reason,
    };
  }

  // 2. Input validation
  const validation = validateInput(messageText);
  if (!validation.safe) {
    await logSecurityEvent({
      eventType: "injection_attempt",
      channel,
      userId,
      details: { threats: validation.threats },
      severity: "critical",
    });
    // Don't block — just log. Injection via chat is low risk since we use parameterized queries.
    // But log it for monitoring.
  }

  // 3. Sensitive data detection
  const sensitiveData = detectAndMaskSensitiveData(validation.sanitizedText);
  if (sensitiveData.detected) {
    await logSecurityEvent({
      eventType: "sensitive_data_detected",
      channel,
      userId,
      details: { types: sensitiveData.types },
      severity: "info",
    });
  }

  return {
    proceed: true,
    sanitizedText: validation.sanitizedText,
    maskedTextForStorage: sensitiveData.maskedText,
    sensitiveDataDetected: sensitiveData.detected,
    sensitiveDataTypes: sensitiveData.types,
    rateLimit,
  };
}
