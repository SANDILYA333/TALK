/**
 * TALK Feature 2 — Phase 2.6: Message Compatibility & Migration Test Suite
 *
 * Test Groups:
 *  Group A — Message State Classification (States A, B, C, D)
 *  Group B — Message Normalization & Precedence Invariants
 *  Group C — Security Guards (Zero-Secret & Unknown Version Fail-Closed)
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  classifyMessage,
  normalizeMessage,
  MESSAGE_STATES,
} from "../compatibility.js";
import { PROTOCOL_VERSION } from "../constants.js";

describe("TALK Feature 2 Phase 2.6 — Message Compatibility & Normalization Layer", () => {
  const validEnvelope = {
    version: PROTOCOL_VERSION,
    protocol: "TALK-AEAD-AD-V1",
    sessionId: "session_test_compatibility_001",
    senderDeviceId: "TALK-ALIC-E001",
    recipientDeviceId: "TALK-BOBB-Y002",
    messageType: "whisper",
    ratchetHeader: {
      dhRatchetPublicKey: "01".repeat(32),
      messageNumber: 0,
      previousChainLength: 0,
    },
    ciphertext: "a1b2c3d4e5f6".repeat(8),
    iv: "1234567890abcdef12345678",
  };

  // =========================================================================
  // Group A: Message State Classification
  // =========================================================================
  describe("Group A: Message State Classification", () => {
    it("A1: classifies historical plaintext message as STATE_A_LEGACY", () => {
      const legacyMsg = {
        _id: "msg_legacy_001",
        senderId: "user_alice",
        receiverId: "user_bob",
        text: "Hello from the legacy era!",
        encryptedEnvelope: null,
      };

      const result = classifyMessage(legacyMsg);
      assert.equal(result.state, MESSAGE_STATES.STATE_A_LEGACY);
      assert.equal(result.isLegacy, true);
      assert.equal(result.isEncrypted, false);
      assert.equal(result.isValid, true);
    });

    it("A2: classifies valid ciphertext envelope as STATE_B_ENCRYPTED", () => {
      const encryptedMsg = {
        _id: "msg_e2ee_001",
        senderId: "user_alice",
        receiverId: "user_bob",
        text: null,
        encryptedEnvelope: validEnvelope,
      };

      const result = classifyMessage(encryptedMsg);
      assert.equal(result.state, MESSAGE_STATES.STATE_B_ENCRYPTED);
      assert.equal(result.isLegacy, false);
      assert.equal(result.isEncrypted, true);
      assert.equal(result.isValid, true);
    });

    it("A3: classifies empty message without text, media, or envelope as STATE_C_INVALID", () => {
      const emptyMsg = {
        _id: "msg_empty_001",
        senderId: "user_alice",
        receiverId: "user_bob",
        text: null,
        encryptedEnvelope: null,
      };

      const result = classifyMessage(emptyMsg);
      assert.equal(result.state, MESSAGE_STATES.STATE_C_INVALID);
      assert.equal(result.isValid, false);
    });

    it("A4: classifies decryption-failed message as STATE_D_UNDECRYPTABLE", () => {
      const failedMsg = {
        _id: "msg_failed_001",
        senderId: "user_alice",
        receiverId: "user_bob",
        encryptedEnvelope: validEnvelope,
        decryptionFailed: true,
      };

      const result = classifyMessage(failedMsg);
      assert.equal(result.state, MESSAGE_STATES.STATE_D_UNDECRYPTABLE);
      assert.equal(result.isEncrypted, true);
      assert.equal(result.isValid, true);
    });
  });

  // =========================================================================
  // Group B: Message Normalization & Precedence Invariants
  // =========================================================================
  describe("Group B: Message Normalization & Precedence Invariants", () => {
    it("B1: normalizes legacy plaintext message with legitimate displayText", () => {
      const legacyMsg = {
        _id: "msg_legacy_002",
        senderId: "user_alice",
        receiverId: "user_bob",
        text: "Historical plaintext message",
        createdAt: "2026-01-01T00:00:00.000Z",
      };

      const normalized = normalizeMessage(legacyMsg, "user_bob");
      assert.equal(normalized.displayText, "Historical plaintext message");
      assert.equal(normalized.isLegacy, true);
      assert.equal(normalized.isEncrypted, false);
      assert.equal(normalized.role, "them");
    });

    it("B2: PRECEDENCE INVARIANT: encrypted envelope takes precedence and never leaks raw text", () => {
      // Inconsistent document with both text and envelope
      const conflictedMsg = {
        _id: "msg_conflict_001",
        senderId: "user_alice",
        receiverId: "user_bob",
        text: "Insecure plaintext leak attempt",
        encryptedEnvelope: validEnvelope,
      };

      const normalized = normalizeMessage(conflictedMsg, "user_bob");
      // Recipient should see encrypted placeholder until local Double Ratchet decrypts it
      assert.equal(normalized.displayText, "[Encrypted Message]");
      assert.equal(normalized.isEncrypted, true);
      assert.equal(normalized.isLegacy, false);
      assert.equal(normalized.displayText.includes("Insecure plaintext"), false);
    });

    it("B3: normalizes successfully decrypted message with decryptedText", () => {
      const decryptedMsg = {
        _id: "msg_e2ee_002",
        senderId: "user_alice",
        receiverId: "user_bob",
        encryptedEnvelope: validEnvelope,
        decryptedText: "Decrypted secret message",
      };

      const normalized = normalizeMessage(decryptedMsg, "user_bob");
      assert.equal(normalized.displayText, "Decrypted secret message");
      assert.equal(normalized.isDecrypted, true);
      assert.equal(normalized.isEncrypted, true);
    });

    it("B4: normalizes undecryptable message with safe user placeholder", () => {
      const failedMsg = {
        _id: "msg_failed_002",
        senderId: "user_alice",
        receiverId: "user_bob",
        encryptedEnvelope: validEnvelope,
        decryptionFailed: true,
      };

      const normalized = normalizeMessage(failedMsg, "user_bob");
      assert.equal(normalized.displayText, "Unable to decrypt message");
      assert.equal(normalized.decryptionFailed, true);
    });
  });

  // =========================================================================
  // Group C: Security Guards & Fail-Closed Protocols
  // =========================================================================
  describe("Group C: Security Guards & Fail-Closed Protocols", () => {
    it("C1: strictly rejects envelopes containing forbidden secret fields", () => {
      const taintedMsg = {
        _id: "msg_tainted_001",
        senderId: "user_alice",
        receiverId: "user_bob",
        encryptedEnvelope: {
          ...validEnvelope,
          privateKey: "01".repeat(32),
        },
      };

      const result = classifyMessage(taintedMsg);
      assert.equal(result.state, MESSAGE_STATES.STATE_C_INVALID);
      assert.equal(result.isValid, false);
      assert(result.reason.includes("forbidden secret fields"));
    });

    it("C2: fails closed on unsupported envelope protocol versions (version = 999)", () => {
      const futureVersionMsg = {
        _id: "msg_future_001",
        senderId: "user_alice",
        receiverId: "user_bob",
        encryptedEnvelope: {
          ...validEnvelope,
          version: 999,
        },
      };

      const result = classifyMessage(futureVersionMsg);
      assert.equal(result.state, MESSAGE_STATES.STATE_C_INVALID);
      assert.equal(result.isValid, false);
      assert(result.reason.includes("Unsupported envelope protocol version"));
    });
  });
});
