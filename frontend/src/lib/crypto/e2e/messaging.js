/**
 * TALK E2E Encrypted Messaging Layer (Feature 2 — Phase 5)
 *
 * Implements client-side AES-256-GCM AEAD message encryption and decryption
 * driven by the Double Ratchet state machine and sealed in canonical Associated Data envelopes.
 *
 * Security Invariants:
 *  - Single-use message key derived per message via Double Ratchet (KDF_CK / KDF_RK).
 *  - Fresh 12-byte cryptographically secure random nonce generated for every encryption.
 *  - Canonical Associated Data (AD) binds routing headers, session ID, and ratchet metadata to ciphertext.
 *  - Absolute zero secret material emitted onto wire envelopes (assertNoSecretMaterial guard).
 *  - Plaintext fallback is strictly prohibited on encryption or decryption failure.
 */

import {
  PROTOCOL_VERSION,
  ENVELOPE_TYPES,
  AES_GCM_NONCE_SIZE,
  AEAD_ALGORITHM,
} from "./constants.js";
import {
  buildAssociatedData,
  createMessageEnvelope,
  validateEnvelopeStructure,
  assertNoSecretMaterial,
} from "./envelope.js";
import { ratchetEncrypt, ratchetDecrypt } from "./ratchet.js";
import { CryptographicError } from "../errors.js";
import { getSubtleCrypto, hexToBytes, bytesToHex } from "../utils.js";

/**
 * Encrypts a plaintext string using the current sending Double Ratchet state,
 * producing a sealed ciphertext envelope ready for transport.
 *
 * @param {object} params
 * @param {string} params.plaintext - Message content to encrypt
 * @param {object} params.state - Mutable DoubleRatchetState
 * @param {string} params.sessionId - Unique cryptographic session identifier
 * @param {string} params.senderDeviceId - Local Connect ID / device ID
 * @param {string} params.recipientDeviceId - Recipient Connect ID / device ID
 * @param {string} [params.messageType=ENVELOPE_TYPES.WHISPER_MESSAGE] - Envelope message type
 * @param {object} [params.x3dhInit=null] - Optional X3DH initialization header for first message
 * @param {string} [params.createdAt] - Optional ISO timestamp
 * @returns {Promise<{ envelope: object, state: object }>}
 */
export async function encryptMessage({
  plaintext,
  state,
  sessionId,
  senderDeviceId,
  recipientDeviceId,
  messageType = ENVELOPE_TYPES.WHISPER_MESSAGE,
  x3dhInit = null,
  createdAt,
}) {
  if (typeof plaintext !== "string") {
    throw new CryptographicError("encryptMessage: plaintext must be a string");
  }
  if (!state || typeof state !== "object") {
    throw new CryptographicError("encryptMessage: valid DoubleRatchetState is required");
  }
  if (!sessionId || typeof sessionId !== "string") {
    throw new CryptographicError("encryptMessage: sessionId is required");
  }
  if (!senderDeviceId || typeof senderDeviceId !== "string") {
    throw new CryptographicError("encryptMessage: senderDeviceId is required");
  }
  if (!recipientDeviceId || typeof recipientDeviceId !== "string") {
    throw new CryptographicError("encryptMessage: recipientDeviceId is required");
  }

  // 1. Advance the Double Ratchet sending chain to derive the single-use message key & header
  const { messageKeyHex, header } = await ratchetEncrypt(state);

  // 2. Generate a fresh, cryptographically secure 12-byte nonce (IV)
  const nonceBytes = globalThis.crypto.getRandomValues(new Uint8Array(AES_GCM_NONCE_SIZE));

  // 3. Construct canonical Associated Data (AD) byte stream
  const adBytes = buildAssociatedData({
    version: PROTOCOL_VERSION,
    sessionId,
    senderDeviceId,
    recipientDeviceId,
    messageType,
    dhRatchetPublicKey: header.dhRatchetPublicKey,
    messageNumber: header.messageNumber,
    previousChainLength: header.previousChainLength,
  });

  // 4. Import the derived message key for AES-GCM encryption
  const subtle = getSubtleCrypto();
  const rawKeyBytes = hexToBytes(messageKeyHex);
  const cryptoKey = await subtle.importKey(
    "raw",
    rawKeyBytes,
    { name: AEAD_ALGORITHM },
    false,
    ["encrypt"]
  );

  // 5. Encrypt plaintext with AES-256-GCM + Associated Data
  const plaintextBytes = new TextEncoder().encode(plaintext);
  const ciphertextBuffer = await subtle.encrypt(
    {
      name: AEAD_ALGORITHM,
      iv: nonceBytes,
      additionalData: adBytes,
    },
    cryptoKey,
    plaintextBytes
  );

  // 6. Build and seal canonical wire envelope
  const envelope = createMessageEnvelope({
    version: PROTOCOL_VERSION,
    sessionId,
    senderDeviceId,
    recipientDeviceId,
    messageType,
    ratchetHeader: header,
    ciphertext: bytesToHex(new Uint8Array(ciphertextBuffer)),
    iv: bytesToHex(nonceBytes),
    x3dhInit: x3dhInit || undefined,
    createdAt: createdAt || new Date().toISOString(),
  });

  // 7. Enforce zero-secret invariant guard on outbound payload
  assertNoSecretMaterial(envelope);

  return {
    envelope,
    state,
  };
}

/**
 * Decrypts an incoming ciphertext envelope using the receiving Double Ratchet state,
 * verifying AEAD authenticity and recovering the original plaintext.
 *
 * @param {object} params
 * @param {object} params.envelope - Incoming ciphertext envelope
 * @param {object} params.state - Mutable DoubleRatchetState
 * @returns {Promise<string>} Recovered UTF-8 plaintext
 */
export async function decryptMessage({ envelope, state }) {
  if (!envelope || typeof envelope !== "object") {
    throw new CryptographicError("decryptMessage: invalid envelope");
  }
  if (!state || typeof state !== "object") {
    throw new CryptographicError("decryptMessage: valid DoubleRatchetState is required");
  }

  // 1. Strict envelope structure and schema validation
  if (!validateEnvelopeStructure(envelope)) {
    throw new CryptographicError("decryptMessage: envelope failed structural schema validation");
  }

  // 2. Enforce zero-secret invariant on incoming payload
  assertNoSecretMaterial(envelope);

  // 3. Reconstruct canonical Associated Data bytes
  const adBytes = buildAssociatedData({
    version: envelope.version,
    sessionId: envelope.sessionId,
    senderDeviceId: envelope.senderDeviceId,
    recipientDeviceId: envelope.recipientDeviceId,
    messageType: envelope.messageType,
    dhRatchetPublicKey: envelope.ratchetHeader.dhRatchetPublicKey,
    messageNumber: envelope.ratchetHeader.messageNumber,
    previousChainLength: envelope.ratchetHeader.previousChainLength,
  });

  // 4. Advance Double Ratchet receiving chain (handles DH ratchet step & skipped keys)
  const messageKeyHex = await ratchetDecrypt(state, envelope.ratchetHeader);

  // 5. Import message key for AES-GCM decryption
  const subtle = getSubtleCrypto();
  const rawKeyBytes = hexToBytes(messageKeyHex);
  const cryptoKey = await subtle.importKey(
    "raw",
    rawKeyBytes,
    { name: AEAD_ALGORITHM },
    false,
    ["decrypt"]
  );

  // 6. Decrypt ciphertext and authenticate AEAD tag
  try {
    const ciphertextBytes = hexToBytes(envelope.ciphertext);
    const nonceBytes = hexToBytes(envelope.iv);

    const decryptedBuffer = await subtle.decrypt(
      {
        name: AEAD_ALGORITHM,
        iv: nonceBytes,
        additionalData: adBytes,
      },
      cryptoKey,
      ciphertextBytes
    );

    return new TextDecoder().decode(decryptedBuffer);
  } catch (error) {
    throw new CryptographicError(
      "decryptMessage: Decryption failed (authentication tag mismatch or corrupted ciphertext)",
      error
    );
  }
}
