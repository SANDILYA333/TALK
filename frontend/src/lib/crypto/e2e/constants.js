/**
 * TALK E2E Encryption Protocol Constants (Feature 2 - Signal Protocol Foundation)
 * 
 * Defines standardized cryptographic algorithms, key lengths, domain separation tags,
 * and protocol invariant limits.
 */

// Protocol Identification & Versioning
export const PROTOCOL_VERSION = 1;
export const PROTOCOL_IDENTIFIER = "TALK-E2EE-V1";

// Cryptographic Algorithms
export const DH_ALGORITHM = "X25519";
export const SIGNATURE_ALGORITHM = "Ed25519";
export const AEAD_ALGORITHM = "AES-GCM";
export const KDF_HASH_ALGORITHM = "SHA-256";
export const HMAC_ALGORITHM = "HMAC";

// Key & Nonce Sizes (in bytes)
export const X25519_PUBLIC_KEY_SIZE = 32;
export const ED25519_PUBLIC_KEY_SIZE = 32;
export const ED25519_SIGNATURE_SIZE = 64;
export const AES_KEY_SIZE = 32; // 256 bits
export const AES_GCM_NONCE_SIZE = 12; // 96 bits
export const AES_GCM_TAG_SIZE = 16; // 128 bits (default auth tag)
export const KDF_SALT_SIZE = 32;

// Double Ratchet Bounds & Limits
export const MAX_SKIPPED_MESSAGE_KEYS = 1000;
export const SKIPPED_MESSAGE_KEY_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
export const PREKEY_BUNDLE_BATCH_SIZE = 50;
export const MIN_ONE_TIME_PREKEYS_THRESHOLD = 10;
export const SIGNED_PREKEY_ROTATION_INTERVAL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

// Domain Separation Tags (RFC 5869 HKDF Info Tags)
export const DOMAIN_TAGS = Object.freeze({
  X3DH_INFO: "TALK-X3DH-V1:ROOT-AGREEMENT",
  RATCHET_ROOT_INFO: "TALK-DOUBLE-RATCHET-V1:ROOT-KDF",
  RATCHET_CHAIN_INFO: "TALK-DOUBLE-RATCHET-V1:CHAIN-KDF",
  MESSAGE_KEY_INFO: "TALK-DOUBLE-RATCHET-V1:MESSAGE-KEY",
  ASSOCIATED_DATA_PREFIX: "TALK-AEAD-AD-V1:",
  SIGNED_PREKEY_SIGNATURE_PREFIX: "TALK-SPK-AUTH-V1:",
});

// Message Envelope Types
export const ENVELOPE_TYPES = Object.freeze({
  PREKEY_BUNDLE_INIT: "prekey_init", // Initial message carrying X3DH prekey material
  WHISPER_MESSAGE: "whisper",         // Regular ratcheted message
});

// Forbidden Keys for Public Envelope/Wire Payloads
export const FORBIDDEN_ENVELOPE_KEYS = Object.freeze([
  "privateKey",
  "identityPrivateKey",
  "ephemeralPrivateKey",
  "prekeyPrivateKey",
  "rootKey",
  "chainKey",
  "sendingChainKey",
  "receivingChainKey",
  "messageKey",
  "sharedSecret",
  "plaintext",
]);
