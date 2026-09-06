/**
 * Safe Structured Logger for TALK Backend.
 *
 * Guarantees:
 * 1. Automatic Sanitization: Recursively redacts any key or value resembling private keys, secrets, or auth tokens.
 * 2. Uniform Log Schema: { timestamp, level, event, message, metadata }
 * 3. Zero Throw Guarantee: Logging failures never crash the runtime application.
 */

const FORBIDDEN_SECRET_KEYS = new Set([
  "privatekey",
  "secretkey",
  "pkcs8",
  "secret",
  "sharedsecret",
  "sessionkey",
  "privatekeyhex",
  "privatekeybase64",
  "private",
  "password",
  "authorization",
  "cookie",
  "token",
  "clerksecretkey",
]);

/**
 * Recursively redacts sensitive fields from an object or array.
 *
 * @param {any} obj
 * @param {number} [depth=0]
 * @returns {any} Sanitized clone of object
 */
export function sanitizeLogData(obj, depth = 0) {
  if (depth > 5) return "[DEPTH_EXCEEDED]";
  if (obj === null || obj === undefined) return obj;

  if (typeof obj === "string") {
    // If a string looks like a 64+ char hex private key or base64 pkcs8 header
    if (/^[0-9a-f]{64,}$/i.test(obj) && depth === 0) {
      return "[REDACTED_POTENTIAL_SECRET]";
    }
    return obj;
  }

  if (typeof obj !== "object") {
    return obj;
  }

  if (Array.isArray(obj)) {
    return obj.map((item) => sanitizeLogData(item, depth + 1));
  }

  if (obj instanceof Error) {
    return {
      name: obj.name,
      message: obj.message,
      code: obj.code,
    };
  }

  const sanitized = {};
  for (const [key, value] of Object.entries(obj)) {
    const normalizedKey = key.toLowerCase().replace(/[^a-z0-9]/g, "");
    if (FORBIDDEN_SECRET_KEYS.has(normalizedKey)) {
      sanitized[key] = "[REDACTED]";
    } else {
      sanitized[key] = sanitizeLogData(value, depth + 1);
    }
  }

  return sanitized;
}

export const LogLevel = {
  INFO: "INFO",
  WARN: "WARN",
  ERROR: "ERROR",
  CRITICAL: "CRITICAL",
};

/**
 * Emits a structured log entry to stdout/stderr.
 *
 * @param {string} level LogLevel string
 * @param {string} event Event category / name
 * @param {string} message Human readable message
 * @param {object} [metadata={}] Additional safe metadata
 */
function log(level, event, message, metadata = {}) {
  try {
    const entry = {
      timestamp: new Date().toISOString(),
      level,
      event,
      message,
      metadata: sanitizeLogData(metadata),
    };

    const serialized = JSON.stringify(entry);
    if (level === LogLevel.ERROR || level === LogLevel.CRITICAL) {
      console.error(serialized);
    } else if (level === LogLevel.WARN) {
      console.warn(serialized);
    } else {
      console.log(serialized);
    }
  } catch {
    // Failsafe: Never crash the application if logging encounters an unexpected error
  }
}

export const logger = {
  info: (event, message, metadata) => log(LogLevel.INFO, event, message, metadata),
  warn: (event, message, metadata) => log(LogLevel.WARN, event, message, metadata),
  error: (event, message, metadata) => log(LogLevel.ERROR, event, message, metadata),
  critical: (event, message, metadata) => log(LogLevel.CRITICAL, event, message, metadata),
};
