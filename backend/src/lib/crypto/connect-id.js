import crypto from "node:crypto";
import {
  CONNECT_ID_PREFIX,
  CONNECT_ID_VERSION,
  CONNECT_ID_DOMAIN_TAG,
  CROCKFORD_BASE32_ALPHABET,
  CONNECT_ID_DIGEST_BYTE_LENGTH,
  CONNECT_ID_CODE_LENGTH,
  CONNECT_ID_REGEX,
  PUBLIC_KEY_BYTE_LENGTH,
  PUBLIC_KEY_HEX_LENGTH,
} from "./constants.js";

// Lookup map for decoding Crockford Base32 with human-error tolerance (I, L -> 1; O -> 0)
const CROCKFORD_MAP = {};
for (let i = 0; i < CROCKFORD_BASE32_ALPHABET.length; i++) {
  CROCKFORD_MAP[CROCKFORD_BASE32_ALPHABET[i]] = i;
}
CROCKFORD_MAP["I"] = 1;
CROCKFORD_MAP["L"] = 1;
CROCKFORD_MAP["O"] = 0;

/**
 * Encodes exactly 5 bytes (40 bits) into 8 Crockford Base32 characters formatted as "XXXX-XXXX".
 *
 * @param {Uint8Array|Buffer} bytes5
 * @returns {string} Formatted 8-character string with middle hyphen (e.g. "8F2K-91XZ")
 */
export function encodeCrockfordBase32(bytes5) {
  if (!bytes5 || bytes5.length !== CONNECT_ID_DIGEST_BYTE_LENGTH) {
    throw new Error(
      `Crockford Base32 encoder requires exactly ${CONNECT_ID_DIGEST_BYTE_LENGTH} bytes`
    );
  }

  const b0 = bytes5[0];
  const b1 = bytes5[1];
  const b2 = bytes5[2];
  const b3 = bytes5[3];
  const b4 = bytes5[4];

  const c0 = (b0 >> 3) & 0x1f;
  const c1 = ((b0 & 0x07) << 2) | ((b1 >> 6) & 0x03);
  const c2 = (b1 >> 1) & 0x1f;
  const c3 = ((b1 & 0x01) << 4) | ((b2 >> 4) & 0x0f);
  const c4 = ((b2 & 0x0f) << 1) | ((b3 >> 7) & 0x01);
  const c5 = (b3 >> 2) & 0x1f;
  const c6 = ((b3 & 0x03) << 3) | ((b4 >> 5) & 0x07);
  const c7 = b4 & 0x1f;

  const char0 = CROCKFORD_BASE32_ALPHABET[c0];
  const char1 = CROCKFORD_BASE32_ALPHABET[c1];
  const char2 = CROCKFORD_BASE32_ALPHABET[c2];
  const char3 = CROCKFORD_BASE32_ALPHABET[c3];
  const char4 = CROCKFORD_BASE32_ALPHABET[c4];
  const char5 = CROCKFORD_BASE32_ALPHABET[c5];
  const char6 = CROCKFORD_BASE32_ALPHABET[c6];
  const char7 = CROCKFORD_BASE32_ALPHABET[c7];

  return `${char0}${char1}${char2}${char3}-${char4}${char5}${char6}${char7}`;
}

/**
 * Normalizes input public key material into a canonical 32-byte Uint8Array and returns canonical lowercase hex.
 * Accepts: Uint8Array(32), Buffer(32), 64-char Hex string, or Base64 string.
 *
 * @param {Uint8Array|Buffer|string} publicKeyInput
 * @returns {{ bytes: Uint8Array, hex: string }}
 */
export function canonicalizePublicKey(publicKeyInput) {
  if (!publicKeyInput) {
    throw new Error("Public key input is required for verification");
  }

  // 1. Binary bytes (Uint8Array or Buffer)
  if (publicKeyInput instanceof Uint8Array || Buffer.isBuffer(publicKeyInput)) {
    if (publicKeyInput.byteLength !== PUBLIC_KEY_BYTE_LENGTH) {
      throw new Error(
        `Invalid public key length: ${publicKeyInput.byteLength} bytes (expected ${PUBLIC_KEY_BYTE_LENGTH})`
      );
    }
    const bytes = new Uint8Array(publicKeyInput.buffer, publicKeyInput.byteOffset, publicKeyInput.byteLength);
    const hex = Buffer.from(bytes).toString("hex").toLowerCase();
    return { bytes, hex };
  }

  // 2. String representation (Hex or Base64)
  if (typeof publicKeyInput === "string") {
    const trimmed = publicKeyInput.trim();
    if (trimmed.length === 0) {
      throw new Error("Empty public key string provided");
    }

    // 64-char Hex
    if (trimmed.length === PUBLIC_KEY_HEX_LENGTH && /^[0-9a-fA-F]+$/.test(trimmed)) {
      const buf = Buffer.from(trimmed, "hex");
      return {
        bytes: new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength),
        hex: trimmed.toLowerCase(),
      };
    }

    // Base64
    try {
      const buf = Buffer.from(trimmed, "base64");
      if (buf.length !== PUBLIC_KEY_BYTE_LENGTH) {
        throw new Error(
          `Base64 decoded public key has invalid length: ${buf.length} bytes (expected ${PUBLIC_KEY_BYTE_LENGTH})`
        );
      }
      return {
        bytes: new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength),
        hex: buf.toString("hex").toLowerCase(),
      };
    } catch (err) {
      throw new Error(`Failed to parse public key string encoding: ${err.message}`);
    }
  }

  throw new Error("Unsupported public key input type");
}

/**
 * Deterministically derives a human-readable TALK Connect ID from an X25519 public key.
 *
 * Pipeline:
 * 1. Canonicalize public key to raw 32 bytes.
 * 2. Prepend domain separation tag ("TALK-CONNECT-ID-V1:").
 * 3. Compute SHA-256 digest over the tagged payload.
 * 4. Truncate to first 5 bytes (40 bits).
 * 5. Encode using Crockford Base32 into 8 uppercase characters.
 * 6. Format as "TALK-XXXX-XXXX".
 *
 * @param {Uint8Array|Buffer|string} publicKeyInput
 * @returns {string} Standard Connect ID string (e.g. "TALK-8F2K-91XZ")
 */
export function deriveConnectId(publicKeyInput) {
  const { bytes } = canonicalizePublicKey(publicKeyInput);

  // Domain separation tag
  const domainBytes = Buffer.from(CONNECT_ID_DOMAIN_TAG, "utf8");
  const payload = Buffer.concat([domainBytes, Buffer.from(bytes)]);

  // Cryptographic hash via SHA-256
  const hash = crypto.createHash("sha256").update(payload).digest();

  // Truncate to first 5 bytes (40 bits -> 8 Crockford Base32 characters)
  const truncatedBytes = hash.subarray(0, CONNECT_ID_DIGEST_BYTE_LENGTH);
  const codePart = encodeCrockfordBase32(truncatedBytes);

  return `${CONNECT_ID_PREFIX}-${codePart}`;
}

/**
 * Validates whether a given string is a strictly valid canonical TALK Connect ID.
 *
 * @param {string} connectId
 * @returns {boolean}
 */
export function isValidConnectId(connectId) {
  if (typeof connectId !== "string") {
    return false;
  }
  return CONNECT_ID_REGEX.test(connectId.trim());
}

/**
 * Normalizes a user-entered Connect ID string:
 * - Trims whitespace and converts to uppercase
 * - Tolerates missing hyphens or internal spaces
 * - Replaces ambiguous characters (I -> 1, L -> 1, O -> 0)
 * - Returns canonical "TALK-XXXX-XXXX" format
 *
 * @param {string} rawInput
 * @returns {string} Canonical Connect ID (e.g. "TALK-8F2K-91XZ")
 */
export function normalizeConnectId(rawInput) {
  if (typeof rawInput !== "string" || rawInput.trim() === "") {
    throw new Error("Connect ID input must be a non-empty string");
  }

  let cleaned = rawInput.trim().toUpperCase().replace(/[\s_]/g, "");

  // Strip leading prefix if present
  if (cleaned.startsWith(`${CONNECT_ID_PREFIX}-`)) {
    cleaned = cleaned.slice(CONNECT_ID_PREFIX.length + 1);
  } else if (cleaned.startsWith(CONNECT_ID_PREFIX)) {
    cleaned = cleaned.slice(CONNECT_ID_PREFIX.length);
  }

  // Remove any remaining hyphens
  cleaned = cleaned.replace(/-/g, "");

  if (cleaned.length !== CONNECT_ID_CODE_LENGTH) {
    throw new Error(
      `Invalid Connect ID length: expected 8 code characters, got ${cleaned.length}`
    );
  }

  // Map ambiguous characters (Crockford tolerance) and validate alphabet
  let normalizedCode = "";
  for (let i = 0; i < cleaned.length; i++) {
    const ch = cleaned[i];
    const mappedVal = CROCKFORD_MAP[ch];
    if (mappedVal === undefined) {
      throw new Error(`Invalid character '${ch}' in Connect ID`);
    }
    normalizedCode += CROCKFORD_BASE32_ALPHABET[mappedVal];
  }

  const chunk1 = normalizedCode.slice(0, 4);
  const chunk2 = normalizedCode.slice(4, 8);

  return `${CONNECT_ID_PREFIX}-${chunk1}-${chunk2}`;
}

/**
 * Parses a canonical or user-entered Connect ID into its structural components.
 *
 * @param {string} connectId
 * @returns {{ prefix: string, code: string, rawCode: string, version: number }}
 */
export function parseConnectId(connectId) {
  const normalized = normalizeConnectId(connectId);
  const parts = normalized.split("-");

  return {
    prefix: parts[0],
    code: `${parts[1]}-${parts[2]}`,
    rawCode: `${parts[1]}${parts[2]}`,
    version: CONNECT_ID_VERSION,
  };
}

/**
 * Verifies that a client-supplied Connect ID cryptographically matches the provided public key.
 *
 * @param {string|Uint8Array|Buffer} publicKey
 * @param {string} connectId
 * @returns {boolean} True if the Connect ID matches the derived public key hash
 */
export function verifyConnectIdBinding(publicKey, connectId) {
  try {
    if (!isValidConnectId(connectId)) {
      return false;
    }
    const expected = deriveConnectId(publicKey);
    return expected === connectId;
  } catch {
    return false;
  }
}
