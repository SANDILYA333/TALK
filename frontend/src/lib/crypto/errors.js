/**
 * Structured error taxonomy for TALK cryptographic operations.
 *
 * Guarantees:
 * 1. Zero-Leakage: Never leaks private keys or internal buffer contents in error messages.
 * 2. Failure Classification: Clear `isTransient` vs `isPermanent` retryability attributes.
 * 3. Severity Levels: `INFO`, `WARN`, `ERROR`, `CRITICAL`.
 * 4. User vs Developer Separation: `userMessage` (safe UI presentation) vs `message` (developer diagnostic).
 */

export class CryptographicError extends Error {
  constructor({
    message,
    code = "CRYPTO_ERROR",
    cause = null,
    isTransient = false,
    severity = "ERROR",
    userMessage = "A cryptographic security operation could not be completed.",
  }) {
    super(typeof message === "string" ? message : "Cryptographic operation failed");
    this.name = "CryptographicError";
    this.code = code;
    this.isTransient = isTransient;
    this.isPermanent = !isTransient;
    this.severity = severity;
    this.userMessage = userMessage;
    if (cause) {
      this.cause = cause;
    }
  }
}

export class KeyGenerationError extends CryptographicError {
  constructor(message, cause = null) {
    super({
      message: typeof message === "string" ? message : "Failed to generate X25519 identity keypair",
      code: "KEY_GENERATION_ERROR",
      cause,
      isTransient: false,
      severity: "CRITICAL",
      userMessage: "Unable to generate a secure device cryptographic identity. Please reload the app.",
    });
    this.name = "KeyGenerationError";
  }
}

export class KeySerializationError extends CryptographicError {
  constructor(message, cause = null) {
    super({
      message: typeof message === "string" ? message : "Failed to serialize cryptographic key",
      code: "KEY_SERIALIZATION_ERROR",
      cause,
      isTransient: false,
      severity: "ERROR",
      userMessage: "Key formatting error occurred. Please refresh your session.",
    });
    this.name = "KeySerializationError";
  }
}

export class KeyStorageError extends CryptographicError {
  constructor(message, cause = null) {
    super({
      message: typeof message === "string" ? message : "Failed to access local identity storage",
      code: "KEY_STORAGE_ERROR",
      cause,
      isTransient: false,
      severity: "CRITICAL",
      userMessage: "Local identity storage is inaccessible or corrupted. Please check browser permissions.",
    });
    this.name = "KeyStorageError";
  }
}

export class ConnectIdError extends CryptographicError {
  constructor(message, cause = null) {
    super({
      message: typeof message === "string" ? message : "Failed to derive Connect ID",
      code: "CONNECT_ID_ERROR",
      cause,
      isTransient: false,
      severity: "ERROR",
      userMessage: "Unable to derive your TALK Connect ID from public key.",
    });
    this.name = "ConnectIdError";
  }
}

export class InvalidConnectIdError extends ConnectIdError {
  constructor(message, cause = null) {
    super(message, cause);
    this.code = "INVALID_CONNECT_ID_ERROR";
    this.name = "InvalidConnectIdError";
    this.userMessage = "The provided Connect ID format is invalid (expected TALK-XXXX-XXXX).";
  }
}
