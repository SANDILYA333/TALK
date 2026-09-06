/**
 * Custom error classes for cryptographic operations.
 * Designed to avoid leaking private key material or internal raw buffers in error messages.
 */

export class CryptographicError extends Error {
  constructor(message, code = "CRYPTO_ERROR", cause = null) {
    super(message);
    this.name = "CryptographicError";
    this.code = code;
    if (cause) {
      this.cause = cause;
    }
  }
}

export class KeyGenerationError extends CryptographicError {
  constructor(message, cause = null) {
    super(message, "KEY_GENERATION_ERROR", cause);
    this.name = "KeyGenerationError";
  }
}

export class KeySerializationError extends CryptographicError {
  constructor(message, cause = null) {
    super(message, "KEY_SERIALIZATION_ERROR", cause);
    this.name = "KeySerializationError";
  }
}

export class KeyStorageError extends CryptographicError {
  constructor(message, cause = null) {
    super(message, "KEY_STORAGE_ERROR", cause);
    this.name = "KeyStorageError";
  }
}
