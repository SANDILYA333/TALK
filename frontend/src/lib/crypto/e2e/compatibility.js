/**
 * TALK Message Compatibility & Migration Layer (Feature 2 — Phase 2.6)
 *
 * Provides a centralized parser and state machine to classify, validate, and normalize
 * messages between legacy plaintext records and modern Double Ratchet encrypted envelopes.
 *
 * Core Security Invariants:
 *  1. State Isolation: Strict distinction between Legacy Plaintext (State A) and E2EE Encrypted (State B).
 *  2. Precedence Rule: If an encryptedEnvelope exists, the message is treated as E2EE; legacy text is ignored.
 *  3. No Plaintext Resurrection: Encrypted envelopes are never downgraded or converted to plaintext storage.
 *  4. Fail-Closed Handling: Unknown versions or malformed records enter State C (Invalid) or State D (Undecryptable).
 */

import { validateEnvelopeStructure, assertNoSecretMaterial } from "./envelope.js";
import { PROTOCOL_VERSION } from "./constants.js";

export const MESSAGE_STATES = Object.freeze({
  STATE_A_LEGACY: "STATE_A_LEGACY",             // Historical plaintext message (text != null, envelope == null)
  STATE_B_ENCRYPTED: "STATE_B_ENCRYPTED",         // Valid E2EE ciphertext envelope (text == null, envelope != null)
  STATE_C_INVALID: "STATE_C_INVALID",             // Inconsistent, empty, or malformed message
  STATE_D_UNDECRYPTABLE: "STATE_D_UNDECRYPTABLE", // Encrypted envelope whose local decryption failed
});

/**
 * Classifies a raw message document into one of the 4 formal message states.
 *
 * @param {object} message - Raw message object from API or Socket
 * @returns {{
 *   state: string,
 *   isLegacy: boolean,
 *   isEncrypted: boolean,
 *   isValid: boolean,
 *   reason?: string
 * }}
 */
export function classifyMessage(message) {
  if (!message || typeof message !== "object") {
    return {
      state: MESSAGE_STATES.STATE_C_INVALID,
      isLegacy: false,
      isEncrypted: false,
      isValid: false,
      reason: "Message document is null or not an object",
    };
  }

  // State D check: Explicit decryption failure flag
  if (message.decryptionFailed) {
    return {
      state: MESSAGE_STATES.STATE_D_UNDECRYPTABLE,
      isLegacy: false,
      isEncrypted: true,
      isValid: true,
      reason: "Decryption failed (MAC mismatch, missing session, or corrupted key)",
    };
  }

  const hasEnvelope = Boolean(message.encryptedEnvelope);
  const hasText = message.text !== null && message.text !== undefined && message.text !== "";
  const hasMedia = Boolean(message.image || message.video);

  // Case 1: Message contains an encrypted envelope
  if (hasEnvelope) {
    const envelope = message.encryptedEnvelope;

    // Check zero-secret invariant on envelope
    try {
      assertNoSecretMaterial(envelope);
    } catch {
      return {
        state: MESSAGE_STATES.STATE_C_INVALID,
        isLegacy: false,
        isEncrypted: true,
        isValid: false,
        reason: "Security violation: Envelope contains forbidden secret fields",
      };
    }

    // Check supported protocol version first
    if (typeof envelope.version === "number" && envelope.version !== PROTOCOL_VERSION) {
      return {
        state: MESSAGE_STATES.STATE_C_INVALID,
        isLegacy: false,
        isEncrypted: true,
        isValid: false,
        reason: `Unsupported envelope protocol version: ${envelope.version}`,
      };
    }

    // Validate structural schema
    if (!validateEnvelopeStructure(envelope)) {
      return {
        state: MESSAGE_STATES.STATE_C_INVALID,
        isLegacy: false,
        isEncrypted: true,
        isValid: false,
        reason: "Envelope failed structural validation",
      };
    }

    // State B: Valid Encrypted Message
    return {
      state: MESSAGE_STATES.STATE_B_ENCRYPTED,
      isLegacy: false,
      isEncrypted: true,
      isValid: true,
    };
  }

  // Case 2: Message contains legacy plaintext or media without envelope
  if (hasText || hasMedia) {
    return {
      state: MESSAGE_STATES.STATE_A_LEGACY,
      isLegacy: true,
      isEncrypted: false,
      isValid: true,
    };
  }

  // Case 3: Empty message (no envelope, no text, no media)
  return {
    state: MESSAGE_STATES.STATE_C_INVALID,
    isLegacy: false,
    isEncrypted: false,
    isValid: false,
    reason: "Empty message: Missing envelope, text, and media",
  };
}

/**
 * Normalizes any raw message into a clean, safe presentation view-model for the UI.
 *
 * @param {object} message - Raw message document
 * @param {string} [authUserId] - Current authenticated user ID
 * @returns {object} Normalized message object ready for UI rendering
 */
export function normalizeMessage(message, authUserId) {
  const safeMsg = (message && typeof message === "object") ? message : {};
  const classification = classifyMessage(message);
  const isMe = authUserId && safeMsg.senderId && String(safeMsg.senderId) === String(authUserId);

  let displayText;

  if (safeMsg.decryptedText) {
    displayText = safeMsg.decryptedText;
  } else if (classification.state === MESSAGE_STATES.STATE_A_LEGACY) {
    displayText = safeMsg.text || "";
  } else if (classification.state === MESSAGE_STATES.STATE_D_UNDECRYPTABLE) {
    displayText = "Unable to decrypt message";
  } else if (classification.state === MESSAGE_STATES.STATE_B_ENCRYPTED) {
    displayText = isMe ? (safeMsg.text || "[Encrypted Message]") : "[Encrypted Message]";
  } else {
    displayText = "[Invalid Message]";
  }

  return {
    id: safeMsg._id || safeMsg.id || "invalid",
    senderId: safeMsg.senderId || null,
    receiverId: safeMsg.receiverId || null,
    role: isMe ? "me" : "them",
    displayText,
    text: displayText,
    imageUrl: safeMsg.image || safeMsg.imageUrl || null,
    videoUrl: safeMsg.video || safeMsg.videoUrl || null,
    createdAt: safeMsg.createdAt || new Date().toISOString(),
    state: classification.state,
    error: classification.reason,
    isLegacy: classification.isLegacy,
    isEncrypted: classification.isEncrypted,
    isDecrypted: Boolean(safeMsg.decryptedText),
    decryptionFailed: classification.state === MESSAGE_STATES.STATE_D_UNDECRYPTABLE,
    isValid: classification.isValid,
  };
}
