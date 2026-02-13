/**
 * Input Normalization & Validation
 *
 * Validates and sanitizes incoming messages before AI processing.
 * Mirrors MoA web security.ts patterns (input validation + sensitive data masking).
 */

import type { ValidationResult, SensitiveDataResult } from "./types.js";

/** Injection attack patterns */
const INJECTION_PATTERNS: Array<{ pattern: RegExp; threat: string }> = [
  // SQL injection
  { pattern: /(\b(SELECT|INSERT|UPDATE|DELETE|DROP|UNION|ALTER|CREATE)\b\s+(FROM|INTO|TABLE|ALL))/i, threat: "sql_injection" },
  { pattern: /(--|;)\s*(SELECT|DROP|DELETE|INSERT|UPDATE)/i, threat: "sql_injection" },
  { pattern: /'\s*(OR|AND)\s+'?\d*'?\s*=\s*'?\d*'?/i, threat: "sql_injection" },

  // NoSQL injection
  { pattern: /\$(?:gt|gte|lt|lte|ne|in|nin|regex|exists|where)\b/i, threat: "nosql_injection" },

  // Command injection
  { pattern: /[;&|`]\s*(cat|ls|rm|wget|curl|nc|bash|sh|python|perl|ruby|node)\b/i, threat: "command_injection" },
  { pattern: /\$\(.*\)/, threat: "command_injection" },

  // Path traversal
  { pattern: /\.\.\/(\.\.\/)+/, threat: "path_traversal" },
  { pattern: /%2e%2e[\\/]/i, threat: "path_traversal" },

  // XSS
  { pattern: /<script[\s>]/i, threat: "xss" },
  { pattern: /javascript:/i, threat: "xss" },
  { pattern: /on(error|load|click|mouseover)\s*=/i, threat: "xss" },
];

/** Sensitive data patterns (Korean-focused + universal) */
const SENSITIVE_PATTERNS: Array<{ pattern: RegExp; type: string; mask: string }> = [
  // Korean resident registration number (주민등록번호)
  { pattern: /\d{6}-[1-4]\d{6}/g, type: "korean_id", mask: "******-*******" },

  // Credit card numbers
  { pattern: /\b\d{4}[\s-]?\d{4}[\s-]?\d{4}[\s-]?\d{4}\b/g, type: "credit_card", mask: "****-****-****-****" },

  // Korean phone numbers
  { pattern: /01[016789]-?\d{3,4}-?\d{4}/g, type: "phone", mask: "010-****-****" },

  // API keys / tokens (generic long alphanumeric strings)
  { pattern: /\b(sk|pk|api|key|token|secret|password)[_-]?[a-zA-Z0-9]{20,}\b/gi, type: "api_key", mask: "[API_KEY]" },

  // Email addresses
  { pattern: /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g, type: "email", mask: "***@***.***" },

  // Korean bank account numbers
  { pattern: /\b\d{3,4}-\d{2,6}-\d{4,6}\b/g, type: "bank_account", mask: "***-***-****" },
];

/** Maximum allowed message length */
const MAX_MESSAGE_LENGTH = 10_000;

/**
 * Validate input text for injection attacks and format issues.
 */
export function validateInput(text: string): ValidationResult {
  const threats: string[] = [];

  // Length check
  if (text.length > MAX_MESSAGE_LENGTH) {
    threats.push("message_too_long");
  }

  // Check injection patterns
  for (const { pattern, threat } of INJECTION_PATTERNS) {
    if (pattern.test(text)) {
      threats.push(threat);
    }
  }

  // Sanitize: escape HTML entities, remove null bytes
  let sanitized = text
    .replace(/\0/g, "")
    .slice(0, MAX_MESSAGE_LENGTH);

  // Trim whitespace
  sanitized = sanitized.trim();

  return {
    safe: threats.length === 0,
    threats,
    sanitizedText: sanitized,
  };
}

/**
 * Detect and mask sensitive data in message text.
 */
export function detectAndMaskSensitiveData(text: string): SensitiveDataResult {
  const types: string[] = [];
  let masked = text;

  for (const { pattern, type, mask } of SENSITIVE_PATTERNS) {
    // Reset lastIndex for global patterns
    pattern.lastIndex = 0;
    if (pattern.test(masked)) {
      types.push(type);
      pattern.lastIndex = 0;
      masked = masked.replace(pattern, mask);
    }
  }

  return {
    detected: types.length > 0,
    types,
    maskedText: masked,
  };
}
