/**
 * TALK E2E Protocol Type Definitions and Validators (Feature 2 Foundation)
 * 
 * Provides type contracts and validation routines for Prekey Bundles, Signed Prekeys,
 * One-Time Prekeys, and Session State definitions.
 */

import {
  X25519_PUBLIC_KEY_SIZE,
  ED25519_PUBLIC_KEY_SIZE,
  ED25519_SIGNATURE_SIZE,
  DOMAIN_TAGS,
} from "./constants.js";
import { CryptographicError } from "../errors.js";
import { hexToBytes } from "../utils.js";

/**
 * Validates a Prekey Bundle uploaded by Bob or fetched by Alice.
 * 
 * Expected Bundle Schema:
 * {
 *   deviceId: string,
 *   identityKeyDh: string (64 hex chars - X25519),
 *   identityKeySign: string (64 hex chars - Ed25519),
 *   signedPrekey: {
 *     keyId: number,
 *     publicKey: string (64 hex chars - X25519),
 *     signature: string (128 hex chars - Ed25519 signature of DOMAIN_TAGS.SIGNED_PREKEY_SIGNATURE_PREFIX || publicKey),
 *     createdAt: string,
 *   },
 *   oneTimePrekey?: {
 *     keyId: number,
 *     publicKey: string (64 hex chars - X25519),
 *   }
 * }
 * 
 * @param {object} bundle
 * @returns {boolean} True if bundle is structurally valid
 */
export function validatePrekeyBundle(bundle) {
  if (!bundle || typeof bundle !== "object") return false;
  if (!bundle.deviceId || typeof bundle.deviceId !== "string") return false;

  // Validate DH identity key (X25519)
  if (!isHexOfByteLength(bundle.identityKeyDh, X25519_PUBLIC_KEY_SIZE)) return false;

  // Validate Signing identity key (Ed25519)
  if (!isHexOfByteLength(bundle.identityKeySign, ED25519_PUBLIC_KEY_SIZE)) return false;

  // Validate Signed Prekey
  const spk = bundle.signedPrekey;
  if (!spk || typeof spk !== "object") return false;
  if (typeof spk.keyId !== "number" || spk.keyId < 0) return false;
  if (!isHexOfByteLength(spk.publicKey, X25519_PUBLIC_KEY_SIZE)) return false;
  if (!isHexOfByteLength(spk.signature, ED25519_SIGNATURE_SIZE)) return false;

  // Validate optional One-Time Prekey
  if (bundle.oneTimePrekey) {
    const opk = bundle.oneTimePrekey;
    if (typeof opk.keyId !== "number" || opk.keyId < 0) return false;
    if (!isHexOfByteLength(opk.publicKey, X25519_PUBLIC_KEY_SIZE)) return false;
  }

  return true;
}

/**
 * Validates whether a string is a valid lowercase/uppercase hexadecimal representation
 * of exactly expectedByteLength bytes.
 * 
 * @param {string} str
 * @param {number} expectedByteLength
 * @returns {boolean}
 */
export function isHexOfByteLength(str, expectedByteLength) {
  if (typeof str !== "string") return false;
  const clean = str.trim();
  if (clean.length !== expectedByteLength * 2) return false;
  return /^[0-9a-fA-F]+$/.test(clean);
}

/**
 * Builds the canonical byte representation of a Signed Prekey to be signed by Ed25519 identity key.
 * 
 * Canonical representation:
 * DOMAIN_TAGS.SIGNED_PREKEY_SIGNATURE_PREFIX || keyId (4 bytes BE) || spkPublicKey (32 bytes)
 * 
 * @param {number} keyId - Numeric ID of signed prekey
 * @param {Uint8Array|string} publicKey - Raw 32 bytes or 64 hex characters
 * @returns {Uint8Array}
 */
export function buildSignedPrekeySignableBytes(keyId, publicKey) {
  if (typeof keyId !== "number" || keyId < 0 || !Number.isInteger(keyId)) {
    throw new CryptographicError("Invalid keyId for signed prekey");
  }

  const rawKeyBytes = typeof publicKey === "string" ? hexToBytes(publicKey) : publicKey;
  if (!rawKeyBytes || rawKeyBytes.byteLength !== X25519_PUBLIC_KEY_SIZE) {
    throw new CryptographicError(`Invalid signed prekey length: expected ${X25519_PUBLIC_KEY_SIZE} bytes`);
  }

  const prefixBytes = new TextEncoder().encode(DOMAIN_TAGS.SIGNED_PREKEY_SIGNATURE_PREFIX);
  const result = new Uint8Array(prefixBytes.length + 4 + X25519_PUBLIC_KEY_SIZE);
  const view = new DataView(result.buffer);

  result.set(prefixBytes, 0);
  view.setUint32(prefixBytes.length, keyId, false);
  result.set(rawKeyBytes, prefixBytes.length + 4);

  return result;
}
