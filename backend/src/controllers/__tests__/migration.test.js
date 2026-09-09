import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";

import { sendMessage } from "../message.controller.js";
import { runMessageMigration } from "../../scripts/migrate-messages.js";
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

describe("Backend Migration & Downgrade Prevention Suite (Feature 2 — Phase 2.6)", () => {
  const aliceUserId = "660000000000000000000001";
  const bobUserId = "660000000000000000000002";
  const legacyUserId = "660000000000000000000003";

  const validEnvelope = {
    version: 1,
    protocol: "TALK-AEAD-AD-V1",
    sessionId: "session_migration_test_001",
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
          fullName: "Bob E2EE",
          connectId: "TALK-BOBB-Y002", // E2EE-capable user
        };
      }
      if (id === legacyUserId) {
        return {
          _id: legacyUserId,
          fullName: "Legacy User",
          connectId: null, // Legacy user without Connect ID
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
  // 1. Conflict Rejection & Downgrade Defense
  // =========================================================================
  describe("1. Conflict Rejection & Downgrade Defense", () => {
    it("strictly rejects conflicting payloads with both text and encryptedEnvelope (400)", async () => {
      const req = {
        user: { _id: aliceUserId },
        params: { id: bobUserId },
        body: {
          text: "Conflicting plaintext message",
          encryptedEnvelope: validEnvelope,
        },
      };
      const res = createMockRes();

      await sendMessage(req, res);

      assert.equal(res.statusCode, 400);
      assert.match(res.body.message, /Conflicting message payload/);
      assert.equal(savedMessageDocs.length, 0);
    });

    it("DOWNGRADE DEFENSE: rejects plaintext sends when recipient has a registered Connect ID (400)", async () => {
      const req = {
        user: { _id: aliceUserId },
        params: { id: bobUserId }, // Bob has registered Connect ID
        body: {
          text: "Plaintext downgrade attack attempt",
        },
      };
      const res = createMockRes();

      await sendMessage(req, res);

      assert.equal(res.statusCode, 400);
      assert.match(res.body.message, /Recipient requires end-to-end encryption/);
      assert.equal(savedMessageDocs.length, 0);
    });

    it("allows valid encrypted envelope to E2EE-capable recipient (201)", async () => {
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
      assert.equal(savedMessageDocs[0].text, null);
      assert.equal(savedMessageDocs[0].encryptedEnvelope.sessionId, validEnvelope.sessionId);
    });

    it("allows legacy plaintext message only when recipient has no registered Connect ID (201)", async () => {
      const req = {
        user: { _id: aliceUserId },
        params: { id: legacyUserId }, // Legacy user
        body: {
          text: "Legacy plaintext for pre-Feature 1 user",
        },
      };
      const res = createMockRes();

      await sendMessage(req, res);

      assert.equal(res.statusCode, 201);
      assert.equal(savedMessageDocs.length, 1);
      assert.equal(savedMessageDocs[0].text, "Legacy plaintext for pre-Feature 1 user");
      assert.equal(savedMessageDocs[0].encryptedEnvelope, null);
    });
  });

  // =========================================================================
  // 2. Database Migration Tooling & Idempotency
  // =========================================================================
  describe("2. Database Migration Tooling & Idempotency", () => {
    function createMockMessageList() {
      return [
        // 1 & 2: Legitimate legacy messages
        { _id: "m1", text: "Legacy Hello", encryptedEnvelope: null, async save() {} },
        { _id: "m2", text: "Legacy World", encryptedEnvelope: null, async save() {} },
        // 3 & 4: Valid E2EE messages
        { _id: "m3", text: null, encryptedEnvelope: validEnvelope, async save() {} },
        { _id: "m4", text: null, encryptedEnvelope: validEnvelope, async save() {} },
        // 5: Conflicted message (has both text and envelope)
        {
          _id: "m5",
          text: "Inconsistent plaintext",
          encryptedEnvelope: validEnvelope,
          async save() {
            this.saved = true;
          },
        },
        // 6: Invalid empty message
        { _id: "m6", text: null, encryptedEnvelope: null, async save() {} },
      ];
    }

    it("Dry-Run mode audits records without performing any database modifications", async () => {
      const mockDocs = createMockMessageList();

      Message.find = function () {
        return {
          cursor() {
            let index = 0;
            return {
              async *[Symbol.asyncIterator]() {
                while (index < mockDocs.length) {
                  yield mockDocs[index++];
                }
              },
            };
          },
        };
      };

      const summary = await runMessageMigration({ dryRun: true });

      assert.equal(summary.total, 6);
      assert.equal(summary.legacyCount, 2);
      assert.equal(summary.encryptedCount, 2);
      assert.equal(summary.conflictedCount, 1);
      assert.equal(summary.remediatedCount, 0, "Dry run must perform 0 remediations");
      assert.equal(summary.invalidCount, 1);
      assert.equal(mockDocs[4].text, "Inconsistent plaintext", "Dry run must not modify document");
    });

    it("Execute mode remediates conflicted records (text: null) while preserving legacy plaintext", async () => {
      const mockDocs = createMockMessageList();

      Message.find = function () {
        return {
          cursor() {
            let index = 0;
            return {
              async *[Symbol.asyncIterator]() {
                while (index < mockDocs.length) {
                  yield mockDocs[index++];
                }
              },
            };
          },
        };
      };

      const summary = await runMessageMigration({ dryRun: false });

      assert.equal(summary.total, 6);
      assert.equal(summary.conflictedCount, 1);
      assert.equal(summary.remediatedCount, 1, "Must remediate exactly 1 conflicted record");
      assert.equal(mockDocs[4].text, null, "Conflicted record text must be nullified");
      assert.equal(mockDocs[0].text, "Legacy Hello", "Historical legacy message must NOT be deleted");
      assert.equal(mockDocs[1].text, "Legacy World", "Historical legacy message must NOT be deleted");
    });

    it("IDEMPOTENCY: Repeated migration execution produces consistent clean state", async () => {
      // Start with already clean dataset
      const cleanDocs = [
        { _id: "m1", text: "Legacy Hello", encryptedEnvelope: null, async save() {} },
        { _id: "m2", text: null, encryptedEnvelope: validEnvelope, async save() {} },
        { _id: "m3", text: null, encryptedEnvelope: validEnvelope, async save() {} },
      ];

      Message.find = function () {
        return {
          cursor() {
            let index = 0;
            return {
              async *[Symbol.asyncIterator]() {
                while (index < cleanDocs.length) {
                  yield cleanDocs[index++];
                }
              },
            };
          },
        };
      };

      const summary = await runMessageMigration({ dryRun: false });

      assert.equal(summary.total, 3);
      assert.equal(summary.legacyCount, 1);
      assert.equal(summary.encryptedCount, 2);
      assert.equal(summary.conflictedCount, 0);
      assert.equal(summary.remediatedCount, 0);
      assert.equal(summary.invalidCount, 0);
    });
  });
});
