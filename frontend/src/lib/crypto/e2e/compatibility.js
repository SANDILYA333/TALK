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
  const classification = classifyMessage(message);
  const isMe = authUserId && message.senderId && String(message.senderId) === String(authUserId);

  let displayText;

  if (message.decryptedText) {
    displayText = message.decryptedText;
  } else if (classification.state === MESSAGE_STATES.STATE_A_LEGACY) {
    displayText = message.text || "";
  } else if (classification.state === MESSAGE_STATES.STATE_D_UNDECRYPTABLE) {
    displayText = "Unable to decrypt message";
  } else if (classification.state === MESSAGE_STATES.STATE_B_ENCRYPTED) {
    displayText = isMe ? (message.text || "[Encrypted Message]") : "[Encrypted Message]";
  } else {
    displayText = "[Invalid Message]";
  }

  return {
    id: message._id || message.id,
    senderId: message.senderId,
    receiverId: message.receiverId,
    role: isMe ? "me" : "them",
    displayText,
    text: displayText,
    imageUrl: message.image || message.imageUrl,
    videoUrl: message.video || message.videoUrl,
    createdAt: message.createdAt,
    state: classification.state,
    isLegacy: classification.isLegacy,
    isEncrypted: classification.isEncrypted,
    isDecrypted: Boolean(message.decryptedText),
    decryptionFailed: classification.state === MESSAGE_STATES.STATE_D_UNDECRYPTABLE,
    isValid: classification.isValid,
  };
}
