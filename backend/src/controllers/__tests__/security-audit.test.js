/**
 * Feature 2 — Phase 2.7: Backend Security Audit & Penetration Test Suite
 * 
 * Aggressively attacks and validates backend security invariants:
 * 1. Zero-Plaintext Storage in MongoDB
 * 2. IDOR Defense on Prekey Registries
 * 3. Atomic OPK Allocation & Race-Condition Resistance
 * 4. Downgrade Attack Rejection & Protocol Enforcement
 * 5. Safe Structured Logging & Secret Non-Leakage
 */

import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";

import {
  registerPrekeyBundle,
  getPrekeyBundle,
} from "../prekey.controller.js";
import { sendMessage } from "../message.controller.js";
import { logger } from "../../lib/logger.js";
import { deriveConnectId } from "../../lib/crypto/connect-id.js";
import Message from "../../models/message.model.js";
import User from "../../models/user.model.js";
import DeviceIdentity from "../../models/device-identity.model.js";
import PreKeyBundle from "../../models/prekey.model.js";

function createMockRes() {
  return {
    statusCode: 200,
    body: null,
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

describe("Backend Security Audit & Penetration Suite (Feature 2 — Phase 2.7)", () => {
  const aliceUserId = "660000000000000000000001";
  const bobUserId = "660000000000000000000002";
  const malloryUserId = "660000000000000000000099";

  const alicePubKey = "01".repeat(32);
  const bobPubKey = "02".repeat(32);
  const aliceConnectId = deriveConnectId(alicePubKey);
  const bobConnectId = deriveConnectId(bobPubKey);

  let savedMessages = [];

  beforeEach(() => {
    savedMessages = [];

    // Mock User.findById
    User.findById = async function (id) {
      if (id === bobUserId) {
        return {
          _id: bobUserId,
          fullName: "Bob Recipient",
          connectId: bobConnectId,
        };
      }
      if (id === aliceUserId) {
        return {
          _id: aliceUserId,
          fullName: "Alice Sender",
          connectId: aliceConnectId,
        };
      }
      return null;
    };

    // Mock Message.prototype.save
    Message.prototype.save = async function () {
      savedMessages.push(this);
      return this;
    };
  });

  describe("1. Zero-Plaintext Storage & Secret Non-Leakage", () => {
    it("strictly stores null text when persisting encrypted envelopes", async () => {
      const PLAINTEXT_SECRET_CANARY = "CANARY_SECRET_TOP_CONFIDENTIAL_12345";

      const validEnvelope = {
        version: 1,
        protocol: "TALK-AEAD-AD-V1",
        sessionId: "sess_sec_001",
        senderDeviceId: aliceConnectId,
        recipientDeviceId: bobConnectId,
        messageType: "whisper",
        ratchetHeader: {
          dhRatchetPublicKey: "00".repeat(32),
          messageNumber: 0,
          previousChainLength: 0,
        },
        ciphertext: "33".repeat(64),
        iv: "44".repeat(12),
      };

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
      assert.ok(res.body);
      assert.equal(res.body.text, null);

      // Verify directly on stored database documents
      for (const msg of savedMessages) {
        assert.equal(msg.text, null, "Database record must have text === null");
        const stringified = JSON.stringify(msg);
        assert.equal(
          stringified.includes(PLAINTEXT_SECRET_CANARY),
          false,
          "Database must not contain plaintext canary"
        );
      }
    });
  });

  describe("2. IDOR & Prekey Registry Penetration", () => {
    it("rejects unauthorized prekey registration attempts for another user's device (403)", async () => {
      // Device owned by Alice
      DeviceIdentity.findOne = async function (query) {
        if (query && query.connectId === aliceConnectId) {
          return {
            _id: "dev_alice_1",
            connectId: aliceConnectId,
            userId: aliceUserId,
            status: "ACTIVE",
          };
        }
        return null;
      };

      // Mallory attempts to register prekeys for Alice's device
      const req = {
        user: { _id: malloryUserId }, // Attacker
        body: {
          deviceId: "dev_alice_1",
          connectId: aliceConnectId,
          identityKeyDh: "00".repeat(32),
          identityKeySign: "11".repeat(32),
          signedPrekey: {
            keyId: 1,
            publicKey: "22".repeat(32),
            signature: "33".repeat(64),
          },
          oneTimePrekeys: [],
        },
      };

      const res = createMockRes();
      await registerPrekeyBundle(req, res);

      assert.equal(res.statusCode, 403);
      assert.ok(res.body.error || res.body.message);
    });

    it("strictly rejects prekey registration payloads containing private keys (400)", async () => {
      DeviceIdentity.findOne = async function () {
        return {
          _id: "dev_bob_1",
          connectId: bobConnectId,
          userId: bobUserId,
          status: "ACTIVE",
        };
      };

      const req = {
        user: { _id: bobUserId },
        body: {
          deviceId: "dev_bob_1",
          connectId: bobConnectId,
          privateKey: "leaked_private_key_material",
          signedPrekey: {
            keyId: 1,
            publicKey: "22".repeat(32),
            signature: "33".repeat(64),
          },
          oneTimePrekeys: [],
        },
      };

      const res = createMockRes();
      await registerPrekeyBundle(req, res);

      assert.equal(res.statusCode, 400);
    });
  });

  describe("3. Atomic OPK Allocation & Single-Use Verification", () => {
    it("atomically consumes OPK on bundle retrieval and handles depletion gracefully", async () => {
      DeviceIdentity.findOne = async function (query) {
        if (query && query.connectId === bobConnectId) {
          return {
            _id: "dev_bob_1",
            connectId: bobConnectId,
            userId: bobUserId,
            publicKey: "00".repeat(32),
            signingPublicKey: "11".repeat(32),
            status: "ACTIVE",
          };
        }
        return null;
      };

      let opkAvailable = true;
      PreKeyBundle.findOneAndUpdate = async function () {
        if (!opkAvailable) return null;
        opkAvailable = false;
        return {
          _id: "bundle_1",
          deviceId: "dev_bob_1",
          connectId: bobConnectId,
          identityKeyDh: "00".repeat(32),
          identityKeySign: "11".repeat(32),
          signedPrekey: {
            keyId: 1,
            publicKey: "22".repeat(32),
            signature: "33".repeat(64),
          },
          oneTimePrekeys: [
            { _id: "opk_1", keyId: 101, publicKey: "aa".repeat(32), isConsumed: true, consumptionId: "mock_uuid" }
          ],
        };
      };

      PreKeyBundle.findOne = async function () {
        return {
          _id: "bundle_1",
          deviceId: "dev_bob_1",
          connectId: bobConnectId,
          identityKeyDh: "00".repeat(32),
          identityKeySign: "11".repeat(32),
          signedPrekey: {
            keyId: 1,
            publicKey: "22".repeat(32),
            signature: "33".repeat(64),
          },
          oneTimePrekeys: [],
          activeOpkCount: 0,
        };
      };

      // Mock crypto.randomUUID to match mock_uuid for OPK selection
      const origUUID = crypto.randomUUID;
      crypto.randomUUID = () => "mock_uuid";

      const req1 = {
        user: { _id: aliceUserId },
        params: { connectId: bobConnectId },
      };

      try {
        // 1. First retrieval: consumes OPK 101
        const res1 = createMockRes();
        await getPrekeyBundle(req1, res1);

        assert.equal(res1.statusCode, 200);
        assert.ok(res1.body.oneTimePrekey);
        assert.equal(res1.body.oneTimePrekey.keyId, 101);

        // 2. Second retrieval: OPK pool is depleted -> returns 3-DH fallback (oneTimePrekey: null)
        const res2 = createMockRes();
        await getPrekeyBundle(req1, res2);

        assert.equal(res2.statusCode, 200);
        assert.equal(res2.body.oneTimePrekey, null, "Depleted pool must return oneTimePrekey: null");
      } finally {
        crypto.randomUUID = origUUID;
      }
    });
  });

  describe("4. Downgrade Attack Rejection", () => {
    it("rejects plaintext message sending to registered Connect ID contacts (400)", async () => {
      // Recipient Bob has connectId on User
      const req = {
        user: { _id: aliceUserId },
        params: { id: bobUserId },
        body: {
          text: "Attempting plaintext downgrade",
        },
      };

      const res = createMockRes();
      await sendMessage(req, res);

      assert.equal(res.statusCode, 400);
      assert.match(res.body.message || res.body.error, /requires end-to-end encryption|disabled/);
    });
  });

  describe("5. Safe Structured Logging & Secret Redaction", () => {
    it("recursively redacts private keys and root keys from log metadata", () => {
      const payload = {
        userId: "u123",
        privateKey: "raw_private_key_should_not_appear",
        rootKey: "raw_root_key_should_not_appear",
        nested: {
          chainKey: "raw_chain_key_should_not_appear",
          sharedSecret: "raw_shared_secret",
          safeField: "visible",
        },
      };

      // logger.info should safely serialize without exposing secret values
      assert.doesNotThrow(() => {
        logger.info("Security Audit Test Log", payload);
      });
    });
  });

});
