/**
 * Cryptographic and Connect ID constants for the backend identity verification layer.
 * Must strictly match the client-side specifications established in Phase 1 and Phase 2.
 */

export const IDENTITY_ALGORITHM = "X25519";
export const IDENTITY_VERSION = 1;
export const PUBLIC_KEY_BYTE_LENGTH = 32;
export const PUBLIC_KEY_HEX_LENGTH = 64;

export const CONNECT_ID_PREFIX = "TALK";
export const CONNECT_ID_VERSION = 1;
export const CONNECT_ID_DOMAIN_TAG = "TALK-CONNECT-ID-V1:";
export const CONNECT_ID_DIGEST_BYTE_LENGTH = 5; // 40 bits
export const CONNECT_ID_CODE_LENGTH = 8; // 8 Crockford Base32 characters

// Crockford Base32 Alphabet (excludes I, L, O, U for human readability and error tolerance)
export const CROCKFORD_BASE32_ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

// Canonical Connect ID format: TALK-XXXX-XXXX
export const CONNECT_ID_REGEX = /^TALK-[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}$/;
