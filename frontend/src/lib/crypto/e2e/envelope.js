/**
 * TALK E2E Encryption Message Envelope & Associated Data Layer (Feature 2)
 * 
 * Provides message envelope construction, canonical Associated Data (AD) serialization,
 * strict schema validation, and zero-secret assertion guards.
 */

import {
  PROTOCOL_VERSION,
  ENVELOPE_TYPES,
  DOMAIN_TAGS,
  FORBIDDEN_ENVELOPE_KEYS,
  X25519_PUBLIC_KEY_SIZE,
} from "./constants.js";
import { CryptographicError } from "../errors.js";
import { hexToBytes } from "../utils.js";

/**
 * Asserts that a target object contains no private or unratcheted secret keys.
 * Throws a CryptographicError immediately if any forbidden secret property is discovered.
 * 
 * @param {object} obj - The object to audit
 * @throws {CryptographicError}
 */
export function assertNoSecretMaterial(obj) {
  if (!obj || typeof obj !== "object") return;

  const stack = [obj];
  const seen = new Set();

  while (stack.length > 0) {
    const current = stack.pop();
    if (!current || typeof current !== "object") continue;
    if (seen.has(current)) continue;
    seen.add(current);

    // CryptoKey instance inspection
    if (typeof CryptoKey !== "undefined" && current instanceof CryptoKey) {
      if (current.type === "private" || current.type === "secret") {
        throw new CryptographicError(
          `Security Violation: Attempted to serialize raw CryptoKey of type '${current.type}' into public envelope`
        );
      }
    }

    // Map inspection
    if (current instanceof Map) {
      for (const [k, v] of current.entries()) {
        if (typeof k === "string") {
          const lowerK = k.toLowerCase();
          for (const forbidden of FORBIDDEN_ENVELOPE_KEYS) {
            if (lowerK === forbidden.toLowerCase() || lowerK.includes("privatekey") || lowerK.includes("secret")) {
              throw new CryptographicError(
                `Security Violation: Attempted to serialize secret field '${k}' from Map into public envelope`
              );
            }
          }
        }
        if (v && typeof v === "object") stack.push(v);
      }
      continue;
    }

    // Set inspection
    if (current instanceof Set) {
      for (const item of current) {
        if (item && typeof item === "object") stack.push(item);
      }
      continue;
    }

    // Comprehensive property inspection (enumerable + non-enumerable)
    const propertyNames = Object.getOwnPropertyNames(current);
    for (const key of propertyNames) {
      const lowerKey = key.toLowerCase();
      for (const forbidden of FORBIDDEN_ENVELOPE_KEYS) {
        if (lowerKey === forbidden.toLowerCase() || lowerKey.includes("privatekey") || lowerKey.includes("secret")) {
          throw new CryptographicError(
            `Security Violation: Attempted to serialize secret field '${key}' into public envelope`
          );
        }
      }

      try {
        const val = current[key];
        if (typeof val === "object" && val !== null) {
          stack.push(val);
        }
      } catch {
        // Ignore getter exceptions during inspection
      }
    }
  }
}

/**
 * Constructs canonical Associated Data (AD) byte stream for AES-GCM AEAD encryption/decryption.
 * 
 * Invariant: Any alteration of routing headers, session ID, message number, or ratchet key
 * automatically invalidates the AEAD authentication tag during decryption.
 * 
 * Canonical format:
 * DOMAIN_TAGS.ASSOCIATED_DATA_PREFIX ||
 * version (1 byte) ||
 * sessionIdLength (2 bytes BE) || sessionId (UTF-8) ||
 * senderDeviceIdLength (2 bytes BE) || senderDeviceId (UTF-8) ||
 * recipientDeviceIdLength (2 bytes BE) || recipientDeviceId (UTF-8) ||
 * messageType (1 byte: 1 for whisper, 2 for prekey_init) ||
 * dhRatchetKey (32 bytes raw) ||
 * messageNumber (4 bytes BE uint32) ||
 * previousChainLength (4 bytes BE uint32)
 * 
 * @param {object} params
 * @param {number} params.version - Protocol version
 * @param {string} params.sessionId - Unique cryptographic session identifier
 * @param {string} params.senderDeviceId - Sender's device ID / Connect ID
 * @param {string} params.recipientDeviceId - Recipient's device ID / Connect ID
 * @param {string} params.messageType - ENVELOPE_TYPES value
 * @param {Uint8Array|string} params.dhRatchetPublicKey - Sender's current DH ratchet public key (raw 32 bytes or hex)
 * @param {number} params.messageNumber - Counter within current sending chain (N)
 * @param {number} params.previousChainLength - Number of messages in previous sending chain (PN)
 * @returns {Uint8Array} Canonical Associated Data bytes
 */
export function buildAssociatedData({
  version = PROTOCOL_VERSION,
  sessionId,
  senderDeviceId,
  recipientDeviceId,
  messageType = ENVELOPE_TYPES.WHISPER_MESSAGE,
  dhRatchetPublicKey,
  messageNumber,
  previousChainLength = 0,
}) {
  if (!sessionId || typeof sessionId !== "string") {
    throw new CryptographicError("Missing or invalid sessionId for Associated Data construction");
  }
  if (!senderDeviceId || typeof senderDeviceId !== "string") {
    throw new CryptographicError("Missing or invalid senderDeviceId for Associated Data construction");
  }
  if (!recipientDeviceId || typeof recipientDeviceId !== "string") {
    throw new CryptographicError("Missing or invalid recipientDeviceId for Associated Data construction");
  }
  if (typeof messageNumber !== "number" || messageNumber < 0 || !Number.isInteger(messageNumber)) {
    throw new CryptographicError("Invalid messageNumber for Associated Data construction");
  }
  if (typeof previousChainLength !== "number" || previousChainLength < 0 || !Number.isInteger(previousChainLength)) {
    throw new CryptographicError("Invalid previousChainLength for Associated Data construction");
  }

  const ratchetKeyBytes = typeof dhRatchetPublicKey === "string"
    ? hexToBytes(dhRatchetPublicKey)
    : dhRatchetPublicKey;

  if (!ratchetKeyBytes || ratchetKeyBytes.byteLength !== X25519_PUBLIC_KEY_SIZE) {
    throw new CryptographicError(
      `Invalid DH ratchet public key size: ${ratchetKeyBytes?.byteLength} (expected ${X25519_PUBLIC_KEY_SIZE})`
    );
  }

  const encoder = new TextEncoder();
  const prefixBytes = encoder.encode(DOMAIN_TAGS.ASSOCIATED_DATA_PREFIX);
  const sessionBytes = encoder.encode(sessionId);
  const senderBytes = encoder.encode(senderDeviceId);
  const recipientBytes = encoder.encode(recipientDeviceId);

  const typeCode = messageType === ENVELOPE_TYPES.PREKEY_BUNDLE_INIT ? 2 : 1;

  // Calculate buffer size:
  // prefix + 1 (ver) + 2 + session + 2 + sender + 2 + recipient + 1 (type) + 32 (ratchetKey) + 4 (N) + 4 (PN)
  const totalLength =
    prefixBytes.length +
    1 +
    2 + sessionBytes.length +
    2 + senderBytes.length +
    2 + recipientBytes.length +
    1 +
    X25519_PUBLIC_KEY_SIZE +
    4 +
    4;

  const buffer = new Uint8Array(totalLength);
  const view = new DataView(buffer.buffer);
  let offset = 0;

  // 1. Prefix
  buffer.set(prefixBytes, offset);
  offset += prefixBytes.length;

  // 2. Version
  view.setUint8(offset, version);
  offset += 1;

  // 3. Session ID
  view.setUint16(offset, sessionBytes.length, false);
  offset += 2;
  buffer.set(sessionBytes, offset);
  offset += sessionBytes.length;

  // 4. Sender Device ID
  view.setUint16(offset, senderBytes.length, false);
  offset += 2;
  buffer.set(senderBytes, offset);
  offset += senderBytes.length;

  // 5. Recipient Device ID
  view.setUint16(offset, recipientBytes.length, false);
  offset += 2;
  buffer.set(recipientBytes, offset);
  offset += recipientBytes.length;

  // 6. Message Type
  view.setUint8(offset, typeCode);
  offset += 1;

  // 7. DH Ratchet Public Key
  buffer.set(ratchetKeyBytes, offset);
  offset += X25519_PUBLIC_KEY_SIZE;

  // 8. Message Number (N)
  view.setUint32(offset, messageNumber, false);
  offset += 4;

  // 9. Previous Chain Length (PN)
  view.setUint32(offset, previousChainLength, false);

  return buffer;
}

/**
 * Constructs a structured, verified E2E ciphertext envelope ready for wire transmission.
 * 
 * @param {object} params
 * @param {number} [params.version=PROTOCOL_VERSION]
 * @param {string} params.sessionId
 * @param {string} params.senderDeviceId
 * @param {string} params.recipientDeviceId
 * @param {string} [params.messageType=ENVELOPE_TYPES.WHISPER_MESSAGE]
 * @param {object} params.ratchetHeader - { dhRatchetPublicKey: string, messageNumber: number, previousChainLength: number }
 * @param {string} params.ciphertext - Base64 or Hex encoded ciphertext
 * @param {string} params.iv - Hex or Base64 encoded 12-byte IV/nonce
 * @param {object} [params.x3dhInit] - Optional X3DH initialization payload (for initial prekey message)
 * @param {string} [params.createdAt] - ISO timestamp
 * @returns {object} Canonical Envelope Object
 */
export function createMessageEnvelope(params) {
  if (!params || typeof params !== "object") {
    throw new CryptographicError("Invalid envelope parameters");
  }

  // Enforce zero-secret invariant on incoming parameter object
  assertNoSecretMaterial(params);

  const {
    version = PROTOCOL_VERSION,
    sessionId,
    senderDeviceId,
    recipientDeviceId,
    messageType = ENVELOPE_TYPES.WHISPER_MESSAGE,
    ratchetHeader,
    ciphertext,
    iv,
    x3dhInit = null,
    createdAt = new Date().toISOString(),
  } = params;
  if (!sessionId || typeof sessionId !== "string") {
    throw new CryptographicError("Missing required sessionId in envelope");
  }
  if (!senderDeviceId || typeof senderDeviceId !== "string") {
    throw new CryptographicError("Missing required senderDeviceId in envelope");
  }
  if (!recipientDeviceId || typeof recipientDeviceId !== "string") {
    throw new CryptographicError("Missing required recipientDeviceId in envelope");
  }
  if (!ratchetHeader || typeof ratchetHeader !== "object") {
    throw new CryptographicError("Missing required ratchetHeader object in envelope");
  }
  if (!ratchetHeader.dhRatchetPublicKey || typeof ratchetHeader.dhRatchetPublicKey !== "string") {
    throw new CryptographicError("Missing or invalid dhRatchetPublicKey in ratchetHeader");
  }
  if (typeof ratchetHeader.messageNumber !== "number" || ratchetHeader.messageNumber < 0) {
    throw new CryptographicError("Missing or invalid messageNumber in ratchetHeader");
  }
  if (typeof ratchetHeader.previousChainLength !== "number" || ratchetHeader.previousChainLength < 0) {
    throw new CryptographicError("Missing or invalid previousChainLength in ratchetHeader");
  }
  if (!ciphertext || typeof ciphertext !== "string") {
    throw new CryptographicError("Missing or invalid ciphertext in envelope");
  }
  if (!iv || typeof iv !== "string") {
    throw new CryptographicError("Missing or invalid iv in envelope");
  }

  const envelope = {
    version,
    protocol: DOMAIN_TAGS.ASSOCIATED_DATA_PREFIX.split(":")[0],
    sessionId,
    senderDeviceId,
    recipientDeviceId,
    messageType,
    ratchetHeader: {
      dhRatchetPublicKey: ratchetHeader.dhRatchetPublicKey,
      messageNumber: ratchetHeader.messageNumber,
      previousChainLength: ratchetHeader.previousChainLength,
    },
    ciphertext,
    iv,
    x3dhInit: x3dhInit ? { ...x3dhInit } : undefined,
    createdAt,
  };

  // Enforce zero-secret invariant
  assertNoSecretMaterial(envelope);

  return envelope;
}

/**
 * Validates the structure and sanity of an incoming ciphertext envelope.
 * 
 * @param {object} envelope - Parsed envelope object
 * @returns {boolean} True if envelope strictly complies with schema
 */
export function validateEnvelopeStructure(envelope) {
  if (!envelope || typeof envelope !== "object") return false;
  if (typeof envelope.version !== "number" || envelope.version !== PROTOCOL_VERSION) return false;
  if (!envelope.sessionId || typeof envelope.sessionId !== "string") return false;
  if (!envelope.senderDeviceId || typeof envelope.senderDeviceId !== "string") return false;
  if (!envelope.recipientDeviceId || typeof envelope.recipientDeviceId !== "string") return false;
  if (!envelope.messageType || !Object.values(ENVELOPE_TYPES).includes(envelope.messageType)) return false;
  if (!envelope.ciphertext || typeof envelope.ciphertext !== "string") return false;
  if (!envelope.iv || typeof envelope.iv !== "string") return false;

  const header = envelope.ratchetHeader;
  if (!header || typeof header !== "object") return false;
  if (!header.dhRatchetPublicKey || typeof header.dhRatchetPublicKey !== "string") return false;
  if (typeof header.messageNumber !== "number" || header.messageNumber < 0 || !Number.isInteger(header.messageNumber)) return false;
  if (typeof header.previousChainLength !== "number" || header.previousChainLength < 0 || !Number.isInteger(header.previousChainLength)) return false;

  try {
    assertNoSecretMaterial(envelope);
    return true;
  } catch {
    return false;
  }
}
