import { getSubtleCrypto, hexToBytes, bytesToHex } from "../utils.js";

const DOMAIN_SEPARATOR = "TALK-SAFETY-NUMBER-V1:";
const VERIFIED_STORAGE_KEY = "talk_verified_contacts_v1";

/**
 * Derives a canonical 60-digit safety number fingerprint from two public identity keys.
 * Sorts keys lexicographically to guarantee Alice and Bob compute the exact same fingerprint.
 *
 * @param {object} params
 * @param {string} params.localKeyHex - 64-character hex public identity key
 * @param {string} params.peerKeyHex - 64-character hex public identity key
 * @returns {Promise<{ fingerprint: string, formattedBlocks: string[], rawDigestHex: string }>}
 */
export async function calculateSafetyNumber({ localKeyHex, peerKeyHex }) {
  if (!localKeyHex || !peerKeyHex) {
    throw new Error("Both local and peer identity keys are required");
  }

  const cleanLocal = localKeyHex.trim().toLowerCase();
  const cleanPeer = peerKeyHex.trim().toLowerCase();

  if (cleanLocal.length !== 64 || cleanPeer.length !== 64) {
    throw new Error("Identity keys must be 64-character hex strings (32 bytes)");
  }

  // Canonical ordering: sort alphabetically
  const [key1, key2] = [cleanLocal, cleanPeer].sort();

  const subtle = getSubtleCrypto();
  const encoder = new TextEncoder();
  const domainBytes = encoder.encode(DOMAIN_SEPARATOR);
  const key1Bytes = hexToBytes(key1);
  const key2Bytes = hexToBytes(key2);

  // Combine domain separator + key1 + key2
  const combined = new Uint8Array(domainBytes.length + key1Bytes.length + key2Bytes.length);
  combined.set(domainBytes, 0);
  combined.set(key1Bytes, domainBytes.length);
  combined.set(key2Bytes, domainBytes.length + key1Bytes.length);

  // Compute SHA-512 digest (64 bytes = 512 bits)
  const digestBuffer = await subtle.digest("SHA-512", combined);
  const digestBytes = new Uint8Array(digestBuffer);
  const rawDigestHex = bytesToHex(digestBytes);

  // Derive 12 blocks of 5 decimal digits (60 digits total)
  const formattedBlocks = [];
  for (let i = 0; i < 12; i++) {
    const offset = i * 4;
    // 32-bit big-endian unsigned integer
    const val =
      ((digestBytes[offset] << 24) |
        (digestBytes[offset + 1] << 16) |
        (digestBytes[offset + 2] << 8) |
        digestBytes[offset + 3]) >>>
      0;
    const block5 = (val % 100000).toString().padStart(5, "0");
    formattedBlocks.push(block5);
  }

  const fingerprint = formattedBlocks.join(" ");

  return {
    fingerprint,
    formattedBlocks,
    rawDigestHex,
  };
}

/**
 * Generates a structured string suitable for encoding into a QR code for contact verification.
 *
 * @param {object} params
 * @param {string} params.fingerprint
 * @param {string} params.peerConnectId
 * @returns {string}
 */
export function generateSafetyQrPayload({ fingerprint, peerConnectId }) {
  const digits = fingerprint.replace(/\s+/g, "");
  return JSON.stringify({
    protocol: "TALK-VERIFY-V1",
    connectId: peerConnectId,
    fingerprint: digits,
  });
}

/**
 * Parses and verifies a scanned QR payload against the expected fingerprint.
 *
 * @param {string} qrText
 * @param {string} expectedFingerprint
 * @returns {{ valid: boolean, error?: string }}
 */
export function verifySafetyQrPayload(qrText, expectedFingerprint) {
  try {
    const cleanExpected = expectedFingerprint.replace(/\s+/g, "");
    const parsed = JSON.parse(qrText);
    if (parsed.protocol !== "TALK-VERIFY-V1") {
      return { valid: false, error: "Invalid QR code protocol" };
    }
    const cleanScanned = String(parsed.fingerprint || "").replace(/\s+/g, "");
    if (cleanScanned !== cleanExpected) {
      return { valid: false, error: "Safety number mismatch" };
    }
    return { valid: true };
  } catch {
    return { valid: false, error: "Malformed QR code payload" };
  }
}

/**
 * Internal helper to load verified contacts map from durable local storage.
 * @returns {Record<string, { fingerprint: string, peerKeyHex: string, verifiedAt: string }>}
 */
function loadVerifiedStorage() {
  try {
    const raw = localStorage.getItem(VERIFIED_STORAGE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

/**
 * Internal helper to persist verified contacts map.
 */
function saveVerifiedStorage(data) {
  try {
    localStorage.setItem(VERIFIED_STORAGE_KEY, JSON.stringify(data));
  } catch (err) {
    console.error("Failed to persist verified contacts:", err);
  }
}

/**
 * Checks verification status for a contact.
 * Detects if the peer's public identity key has changed since previous verification.
 *
 * @param {object} params
 * @param {string} params.peerConnectId
 * @param {string} [params.currentPeerKeyHex]
 * @returns {{ isVerified: boolean, hasKeyChanged: boolean, verifiedAt: string | null }}
 */
export function getContactVerificationStatus({ peerConnectId, currentPeerKeyHex }) {
  if (!peerConnectId) {
    return { isVerified: false, hasKeyChanged: false, verifiedAt: null };
  }

  const storage = loadVerifiedStorage();
  const record = storage[peerConnectId];

  if (!record) {
    return { isVerified: false, hasKeyChanged: false, verifiedAt: null };
  }

  // Key change detection
  if (currentPeerKeyHex && record.peerKeyHex) {
    const cleanCurrent = currentPeerKeyHex.trim().toLowerCase();
    const cleanSaved = record.peerKeyHex.trim().toLowerCase();
    if (cleanCurrent !== cleanSaved) {
      return {
        isVerified: false,
        hasKeyChanged: true,
        verifiedAt: record.verifiedAt,
      };
    }
  }

  return {
    isVerified: true,
    hasKeyChanged: false,
    verifiedAt: record.verifiedAt,
  };
}

/**
 * Marks a contact as verified with their public key and computed safety number.
 *
 * @param {object} params
 * @param {string} params.peerConnectId
 * @param {string} params.peerKeyHex
 * @param {string} params.fingerprint
 */
export function markContactVerified({ peerConnectId, peerKeyHex, fingerprint }) {
  if (!peerConnectId) return;
  const storage = loadVerifiedStorage();
  storage[peerConnectId] = {
    fingerprint: fingerprint.replace(/\s+/g, ""),
    peerKeyHex: peerKeyHex.trim().toLowerCase(),
    verifiedAt: new Date().toISOString(),
  };
  saveVerifiedStorage(storage);
}

/**
 * Removes verification state for a contact (e.g. after key rotation or manual unverify).
 *
 * @param {string} peerConnectId
 */
export function unverifyContact(peerConnectId) {
  if (!peerConnectId) return;
  const storage = loadVerifiedStorage();
  delete storage[peerConnectId];
  saveVerifiedStorage(storage);
}
