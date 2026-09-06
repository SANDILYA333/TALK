/**
 * Cryptographic constants for TALK identity foundation.
 * 
 * Algorithm: X25519 (Curve25519 for Diffie-Hellman Key Agreement)
 * Standard: RFC 7748 / Web Cryptography API
 */

export const IDENTITY_ALGORITHM = "X25519";
export const IDENTITY_VERSION = 1;
export const PUBLIC_KEY_BYTE_LENGTH = 32;
export const PRIVATE_KEY_USAGES = ["deriveKey", "deriveBits"];
export const PUBLIC_KEY_USAGES = [];

export const STORAGE_DB_NAME = "talk_crypto_db";
export const STORAGE_STORE_NAME = "identity_keys";
export const STORAGE_DB_VERSION = 1;
export const DEVICE_IDENTITY_KEY = "device_identity_keypair";
