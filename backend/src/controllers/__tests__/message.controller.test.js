import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";

import {
  sendMessage,
  validateEncryptedEnvelopePayload,
} from "../message.controller.js";
import Message from "../../models/message.model.js";
import User from "../../models/user.model.js";

function createMockRes() {
  return {
    statusCode: 200,
    body: null,
    headers: {},
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(data) {
      this.body = data;
      return this;
    },
  };
}

describe("Backend Encrypted Message Envelope & Persistence Suite (Feature 2 — Phase 5)", () => {
  const aliceUserId = "660000000000000000000001";
  const bobUserId = "660000000000000000000002";

  const validEnvelope = {
    version: 1,
    protocol: "TALK-AEAD-AD-V1",
    sessionId: "session_alice_bob_test_123456",
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

  let savedMessageDocs = [];

  beforeEach(() => {
    savedMessageDocs = [];

    // Mock User.findById
    User.findById = async function (id) {
      if (id === bobUserId) {
        return {
          _id: bobUserId,
          fullName: "Bob Builder",
          connectId: "TALK-BOBB-Y002",
        };
      }
      return null;
    };

    // Mock Message constructor and save
    Message.prototype.save = async function () {
      savedMessageDocs.push(this);
      return this;
    };
  });

  // =========================================================================
  // 1. Envelope Payload Structural Validation
  // =========================================================================
  describe("1. Envelope Payload Structural Validation", () => {
    it("accepts a well-formed canonical ciphertext envelope", () => {
      const isValid = validateEncryptedEnvelopePayload(validEnvelope);
      assert.equal(isValid, true, "Valid envelope must pass validation");
    });

    it("rejects envelopes with unsupported protocol version", () => {
      const invalid = { ...validEnvelope, version: 2 };
      assert.equal(validateEncryptedEnvelopePayload(invalid), false);
    });

    it("rejects envelopes with missing or invalid ratchetHeader", () => {
      const missingHeader = { ...validEnvelope, ratchetHeader: null };
      assert.equal(validateEncryptedEnvelopePayload(missingHeader), false);

      const invalidKey = {
        ...validEnvelope,
        ratchetHeader: {
          dhRatchetPublicKey: "too_short_key",
          messageNumber: 0,
          previousChainLength: 0,
        },
      };
      assert.equal(validateEncryptedEnvelopePayload(invalidKey), false);
    });

    it("rejects envelopes with invalid IV length (must be 12-byte hex = 24 chars)", () => {
      const invalidIv = { ...validEnvelope, iv: "123456" };
      assert.equal(validateEncryptedEnvelopePayload(invalidIv), false);
    });

    it("strictly rejects envelopes containing forbidden secret keywords (Zero Secret Invariant)", () => {
      const taintedEnvelope = {
        ...validEnvelope,
        privateKey: "01".repeat(32),
      };
      assert.equal(validateEncryptedEnvelopePayload(taintedEnvelope), false);

      const nestedTainted = {
        ...validEnvelope,
        x3dhInit: {
          rootKey: "secret_material",
        },
      };
      assert.equal(validateEncryptedEnvelopePayload(nestedTainted), false);
    });
  });

  // =========================================================================
  // 2. Server Message Controller & Zero-Plaintext Storage
  // =========================================================================
  describe("2. Server Message Controller & Zero-Plaintext Storage", () => {
    it("successfully receives, validates, and persists an encrypted message envelope", async () => {
      const req = {
        user: { _id: aliceUserId },
        params: { id: bobUserId },
        body: {
          encryptedEnvelope: validEnvelope,
        },
      };
      const res = createMockRes();

      await sendMessage(req, res);

      assert.equal(res.statusCode, 201);
      assert.equal(savedMessageDocs.length, 1);
      const saved = savedMessageDocs[0];
      assert.equal(String(saved.senderId), aliceUserId);
      assert.equal(String(saved.receiverId), bobUserId);
      assert(saved.encryptedEnvelope, "encryptedEnvelope must be persisted");
      assert.equal(saved.encryptedEnvelope.sessionId, validEnvelope.sessionId);
      assert.equal(saved.text, null, "text field must be stored as null for E2EE messages");
    });

    it("DATABASE INSPECTION TEST: persists ciphertext only and never stores plaintext in MongoDB", async () => {
      const secretPlaintext = "THIS IS A SECRET TEST MESSAGE";

      const req = {
        user: { _id: aliceUserId },
        params: { id: bobUserId },
        body: {
          encryptedEnvelope: validEnvelope,
          text: secretPlaintext, // Sender might mistakenly pass text alongside envelope
        },
      };
      const res = createMockRes();

      await sendMessage(req, res);

      assert.equal(res.statusCode, 201);
      const saved = savedMessageDocs[0];

      // Deep inspection of saved document
      const docString = JSON.stringify(saved);
      assert.equal(
        docString.includes(secretPlaintext),
        false,
        "CRITICAL SECURITY FAILURE: Plaintext found in persisted database document!"
      );
      assert.equal(saved.text, null, "Text field must be explicitly nullified");
      assert.equal(saved.encryptedEnvelope.ciphertext, validEnvelope.ciphertext);
    });

    it("rejects malformed encrypted envelope with 400 Bad Request", async () => {
      const req = {
        user: { _id: aliceUserId },
        params: { id: bobUserId },
        body: {
          encryptedEnvelope: {
            ...validEnvelope,
            version: 999, // unsupported version
          },
        },
      };
      const res = createMockRes();

      await sendMessage(req, res);

      assert.equal(res.statusCode, 400);
      assert.equal(res.body.message, "Invalid encrypted message envelope");
      assert.equal(savedMessageDocs.length, 0, "No message should be saved on rejection");
    });

    it("returns 404 Not Found if recipient user does not exist", async () => {
      const req = {
        user: { _id: aliceUserId },
        params: { id: "660000000000000000000999" }, // non-existent recipient
        body: {
          encryptedEnvelope: validEnvelope,
        },
      };
      const res = createMockRes();

      await sendMessage(req, res);

      assert.equal(res.statusCode, 404);
      assert.equal(res.body.message, "Recipient user not found");
      assert.equal(savedMessageDocs.length, 0);
    });
  });
});
