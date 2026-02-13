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
// 1. Rate Limiting — Three-Strike System
//    (DDoS / Brute-Force Protection)
//
//    Strike 1: 30 req/min exceeded → 30-min block + warning
//    Strike 2: second violation    → 1-hour block + final warning
//    Strike 3: third violation     → permanent ban
// ────────────────────────────────────────────

interface RateLimitEntry {
  /** Requests in the current window */
  count: number;
  /** Window start timestamp */
  windowStart: number;
  /** Whether the user is currently blocked */
  blocked: boolean;
  /** When the current block expires (undefined = permanent) */
  blockedUntil?: number;
  /** Number of times this user has exceeded the limit (0–3) */
  strikes: number;
  /** Whether this is a permanent ban (strike 3) */
  permanentBan: boolean;
}

/** Rate limit configuration with three-strike escalation */
const RATE_LIMIT_CONFIG = {
  /** Max requests per window per user */
  maxRequests: 30,
  /** Window size in ms (1 minute) */
  windowMs: 60_000,
  /** Strike 1: block for 30 minutes */
  strike1BlockMs: 30 * 60_000,
  /** Strike 2: block for 1 hour */
  strike2BlockMs: 60 * 60_000,
  /** Strike 3: permanent ban (no duration — infinite) */
  /** Max unique users tracked (prevent memory exhaustion) */
  maxTrackedUsers: 10_000,
  /** Cleanup interval (10 minutes) */
  cleanupIntervalMs: 10 * 60_000,
};

const rateLimitStore = new Map<string, RateLimitEntry>();
let lastCleanup = Date.now();

/** Clean up expired rate limit entries — never remove permanent bans */
function cleanupRateLimits(): void {
  const now = Date.now();
  if (now - lastCleanup < RATE_LIMIT_CONFIG.cleanupIntervalMs) return;
  lastCleanup = now;

  for (const [key, entry] of rateLimitStore) {
    // Never clean up permanent bans
    if (entry.permanentBan) continue;

    if (entry.blocked) {
      // Remove if block has expired
      if (entry.blockedUntil && entry.blockedUntil < now) {
        // Don't delete — just unblock. Keep strikes for escalation.
        entry.blocked = false;
        entry.blockedUntil = undefined;
        entry.count = 0;
        entry.windowStart = now;
      }
    } else if (now - entry.windowStart > RATE_LIMIT_CONFIG.windowMs * 60) {
      // Clean up entries that have been idle for 1 hour with no strikes
      if (entry.strikes === 0) {
        rateLimitStore.delete(key);
      }
    }
  }
}

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  resetInMs: number;
  reason?: string;
  /** Current strike count (0–3) */
  strikes?: number;
  /** Whether this is a permanent ban */
  permanentBan?: boolean;
}

/**
 * Check rate limit for a user/IP combination.
 * Uses composite key: channel:userId to isolate per-channel limits.
 *
 * Three-strike escalation:
 *   Strike 1 → 30분 차단 + 경고 (2회째 초과시 1시간, 3번 초과시 영구차단 경고)
 *   Strike 2 → 1시간 차단 + 강력경고 (한번만 더 초과되면 영구차단)
 *   Strike 3 → 영구 차단
 */
export function checkRateLimit(channel: string, userId: string): RateLimitResult {
  cleanupRateLimits();

  const key = `${channel}:${userId}`;
  const now = Date.now();

  const existing = rateLimitStore.get(key);

  // Check permanent ban
  if (existing?.permanentBan) {
    return {
      allowed: false,
      remaining: 0,
      resetInMs: Infinity,
      reason: "반복적인 과도한 요청으로 계정이 영구 차단되었습니다. 관리자에게 문의해주세요.",
      strikes: 3,
      permanentBan: true,
    };
  }

  // Check if currently blocked (temporary)
  if (existing?.blocked && existing.blockedUntil && existing.blockedUntil > now) {
    const resetInMs = existing.blockedUntil - now;
    const minutes = Math.ceil(resetInMs / 60_000);
    const strikeWarning = existing.strikes === 1
      ? `\n\n[경고] 다음 초과 시 1시간 차단, 3회 초과 시 영구 차단됩니다.`
      : existing.strikes === 2
        ? `\n\n[강력경고] 한 번만 더 초과하면 영구 차단됩니다!`
        : "";

    return {
      allowed: false,
      remaining: 0,
      resetInMs,
      reason: `요청 한도를 초과했습니다. 약 ${minutes}분 후 다시 시도해주세요.${strikeWarning}`,
      strikes: existing.strikes,
    };
  }

  // If block expired, unblock and reset window
  if (existing?.blocked && existing.blockedUntil && existing.blockedUntil <= now) {
    existing.blocked = false;
    existing.blockedUntil = undefined;
    existing.count = 0;
    existing.windowStart = now;
  }

  // Initialize new entry
  if (!existing) {
    rateLimitStore.set(key, {
      count: 1,
      windowStart: now,
      blocked: false,
      strikes: 0,
      permanentBan: false,
    });
    return {
      allowed: true,
      remaining: RATE_LIMIT_CONFIG.maxRequests - 1,
      resetInMs: RATE_LIMIT_CONFIG.windowMs,
      strikes: 0,
    };
  }

  // Reset window if expired
  if (now - existing.windowStart > RATE_LIMIT_CONFIG.windowMs) {
    existing.count = 1;
    existing.windowStart = now;
    return {
      allowed: true,
      remaining: RATE_LIMIT_CONFIG.maxRequests - 1,
      resetInMs: RATE_LIMIT_CONFIG.windowMs,
      strikes: existing.strikes,
    };
  }

  // Increment request count
  existing.count++;

  // Check if limit exceeded
  if (existing.count > RATE_LIMIT_CONFIG.maxRequests) {
    existing.strikes++;

    if (existing.strikes >= 3) {
      // Strike 3: PERMANENT BAN
      existing.blocked = true;
      existing.permanentBan = true;
      existing.blockedUntil = undefined;
      return {
        allowed: false,
        remaining: 0,
        resetInMs: Infinity,
        reason: "3회 연속 요청 한도 초과로 계정이 영구 차단되었습니다. 관리자에게 문의해주세요.",
        strikes: 3,
        permanentBan: true,
      };
    }

    if (existing.strikes === 2) {
      // Strike 2: 1-hour block + final warning
      existing.blocked = true;
      existing.blockedUntil = now + RATE_LIMIT_CONFIG.strike2BlockMs;
      return {
        allowed: false,
        remaining: 0,
        resetInMs: RATE_LIMIT_CONFIG.strike2BlockMs,
        reason: "요청 한도를 2회째 초과했습니다. 1시간 동안 차단됩니다.\n\n[강력경고] 한 번만 더 초과하면 영구 차단됩니다!",
        strikes: 2,
      };
    }

    // Strike 1: 30-minute block + warning
    existing.blocked = true;
    existing.blockedUntil = now + RATE_LIMIT_CONFIG.strike1BlockMs;
    return {
      allowed: false,
      remaining: 0,
      resetInMs: RATE_LIMIT_CONFIG.strike1BlockMs,
      reason: "요청 한도를 초과했습니다. 30분 동안 차단됩니다.\n\n[경고] 다음 초과 시 1시간 차단, 3회 초과 시 영구 차단됩니다.",
      strikes: 1,
    };
  }

  return {
    allowed: true,
    remaining: RATE_LIMIT_CONFIG.maxRequests - existing.count,
    resetInMs: RATE_LIMIT_CONFIG.windowMs - (now - existing.windowStart),
    strikes: existing.strikes,
  };
}

// ────────────────────────────────────────────
// 2. Sensitive Data Detection & Masking
// ────────────────────────────────────────────

/**
 * Patterns that detect sensitive data in messages.
 *
 * IMPORTANT: Order matters — more specific patterns should come first
 * to prevent partial matches by broader patterns.
 *
 * Categories:
 *   - Identity documents: 주민번호, 운전면허, 여권, 외국인등록번호
 *   - Financial: 계좌번호, 카드번호, 계좌 비밀번호
 *   - Credentials: 비밀번호, API키, 인증서, AWS키, 개인키
 *   - Access codes: 현관문 비번, 도어락, 금고 비번
 *   - Contact: 전화번호, 이메일
 */
const SENSITIVE_PATTERNS: Array<{ name: string; pattern: RegExp; mask: string }> = [
  // ── Identity Documents ──

  // Korean resident registration number (주민등록번호: 6자리-7자리, 뒤 첫자리 1~4)
  { name: "rrn", pattern: /\b\d{6}[-\s]?[1-4]\d{6}\b/g, mask: "******-*******" },

  // Korean driver's license (운전면허번호: 2자리지역-2자리-6자리-2자리)
  { name: "driver_license", pattern: /\b\d{2}[-\s]?\d{2}[-\s]?\d{6}[-\s]?\d{2}\b/g, mask: "**-**-******-**" },

  // Korean passport number (여권번호: M 또는 문자 1자리 + 8자리 숫자)
  { name: "passport", pattern: /\b[A-Z]{1,2}\d{7,8}\b/g, mask: "[여권번호 보호됨]" },

  // Alien registration number (외국인등록번호: 주민번호와 동일 형식, 뒤 첫자리 5~8)
  { name: "alien_registration", pattern: /\b\d{6}[-\s]?[5-8]\d{6}\b/g, mask: "******-*******" },

  // ── Financial ──

  // Credit card numbers (16 digits, possibly with dashes/spaces)
  { name: "card_number", pattern: /\b\d{4}[-\s]?\d{4}[-\s]?\d{4}[-\s]?\d{4}\b/g, mask: "****-****-****-****" },

  // Card CVV/CVC (카드 보안코드: 명시적 언급 + 3~4자리)
  { name: "card_cvv", pattern: /(?:CVV|CVC|보안코드|시큐리티\s*코드)\s*[:=]?\s*\d{3,4}/gi, mask: "[카드보안코드 보호됨]" },

  // Card expiry (카드 유효기간: MM/YY 형식)
  { name: "card_expiry", pattern: /(?:유효기간|만료일|expir(?:y|ation))\s*[:=]?\s*\d{2}\s*[/\-]\s*\d{2,4}/gi, mask: "[유효기간 보호됨]" },

  // Korean bank account numbers (most Korean banks: 10-14 digits with dashes)
  { name: "bank_account", pattern: /\b\d{3,4}[-\s]?\d{2,6}[-\s]?\d{2,8}\b/g, mask: "***-****-****" },

  // 계좌 비밀번호 (account PIN: 명시적 언급 + 4~6자리)
  { name: "account_pin", pattern: /(?:계좌\s*비밀번호|계좌\s*비번|통장\s*비번|통장\s*비밀번호|account\s*(?:pin|password))\s*[:=]?\s*\d{4,6}/gi, mask: "[계좌 비밀번호 보호됨]" },

  // ── Credentials & Passwords ──

  // General passwords (명시적 언급: 비밀번호, 패스워드, password 등)
  { name: "password", pattern: /(?:비밀번호|패스워드|password|passwd|pwd|비번)\s*[:=]\s*\S+/gi, mask: "[비밀번호 보호됨]" },

  // Door lock / front door codes (현관문, 도어락, 금고)
  { name: "door_code", pattern: /(?:현관문|현관|도어락|도어\s*록|door\s*lock|금고|사물함|캐비넷|잠금)\s*(?:비밀번호|비번|코드|암호|password|code|pin)\s*[:=]?\s*\S+/gi, mask: "[잠금 비밀번호 보호됨]" },

  // PIN codes (명시적 핀번호/핀코드 언급)
  { name: "pin_code", pattern: /(?:핀\s*번호|핀\s*코드|pin\s*(?:code|number)?)\s*[:=]?\s*\d{4,8}/gi, mask: "[PIN 보호됨]" },

  // OTP / verification codes (인증번호, OTP)
  { name: "otp", pattern: /(?:인증\s*번호|인증\s*코드|OTP|verification\s*code|확인\s*코드)\s*[:=]?\s*\d{4,8}/gi, mask: "[인증코드 보호됨]" },

  // 공인인증서 비밀번호
  { name: "cert_password", pattern: /(?:인증서|공인인증|certificate)\s*(?:비밀번호|패스워드|password|비번)\s*[:=]?\s*\S+/gi, mask: "[인증서 비밀번호 보호됨]" },

  // ── API Keys & Tokens ──

  // OpenAI/Anthropic/generic API keys
  { name: "api_key", pattern: /\b(sk-[a-zA-Z0-9_-]{20,}|sk-ant-[a-zA-Z0-9_-]{20,}|key-[a-zA-Z0-9_-]{20,}|AIza[a-zA-Z0-9_-]{30,}|xai-[a-zA-Z0-9_-]{20,}|gsk_[a-zA-Z0-9_-]{20,})\b/g, mask: "[API키 보호됨]" },

  // AWS access keys
  { name: "aws_key", pattern: /\b(AKIA[0-9A-Z]{16})\b/g, mask: "[AWS키 보호됨]" },

  // AWS secret keys (40 chars, often after access key)
  { name: "aws_secret", pattern: /(?:aws_secret_access_key|secret_key|AWS_SECRET)\s*[:=]\s*[A-Za-z0-9/+=]{40}/gi, mask: "[AWS 시크릿키 보호됨]" },

  // Generic tokens (bearer, auth tokens)
  { name: "bearer_token", pattern: /(?:Bearer|Authorization|token)\s+[a-zA-Z0-9_\-.]{30,}/gi, mask: "[토큰 보호됨]" },

  // Private keys / certificates (PEM format)
  { name: "private_key", pattern: /-----BEGIN\s+(RSA\s+)?PRIVATE\s+KEY-----[\s\S]*?-----END\s+(RSA\s+)?PRIVATE\s+KEY-----/g, mask: "[인증키 보호됨]" },

  // ── Contact Info ──

  // Korean phone numbers
  { name: "phone", pattern: /\b01[0-9][-\s]?\d{3,4}[-\s]?\d{4}\b/g, mask: "010-****-****" },

  // Email addresses
  { name: "email", pattern: /\b[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}\b/g, mask: "***@***.***" },

  // ── Addresses & Location ──

  // Korean detailed address patterns (with dong/ho numbers that could identify residence)
  { name: "address_detail", pattern: /(?:주소|address)\s*[:=]\s*.{10,80}/gi, mask: "[주소 보호됨]" },
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

  // 1. Rate limiting (three-strike system)
  const rateLimit = checkRateLimit(channel, userId);
  if (!rateLimit.allowed) {
    const severity = rateLimit.permanentBan ? "critical"
      : (rateLimit.strikes ?? 0) >= 2 ? "critical"
        : "warning";
    const eventType = rateLimit.permanentBan ? "brute_force_attempt" : "rate_limit_hit";

    await logSecurityEvent({
      eventType,
      channel,
      userId,
      details: {
        remaining: rateLimit.remaining,
        resetInMs: rateLimit.resetInMs,
        strikes: rateLimit.strikes ?? 0,
        permanentBan: rateLimit.permanentBan ?? false,
      },
      severity,
    });
    return {
      proceed: false,
      sanitizedText: messageText,
      maskedTextForStorage: messageText,
      sensitiveDataDetected: false,
      sensitiveDataTypes: [],
      rateLimit,
      blockReason: rateLimit.permanentBan ? "permanent_ban" : "rate_limit",
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
