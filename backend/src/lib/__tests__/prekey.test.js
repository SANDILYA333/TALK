import { test, describe, before, beforeEach } from "node:test";
import assert from "node:assert/strict";

import {
  verifySignedPrekeySignature,
  buildSignedPrekeySignableBuffer,
} from "../crypto/prekey-verification.js";
import {
  registerPrekeyBundle,
  getPrekeyBundle,
  replenishOneTimePrekeys,
  getPrekeyStatus,
} from "../../controllers/prekey.controller.js";
import { deriveConnectId } from "../crypto/connect-id.js";
import DeviceIdentity from "../../models/device-identity.model.js";
import PreKeyBundle from "../../models/prekey.model.js";

// Helper: Generate a real Ed25519 signing keypair and X25519 signed prekey with signature
async function createTestKeyMaterials(keyId = 1) {
  const { subtle } = globalThis.crypto;

  // 1. Generate Ed25519 Signing Keypair
  const signingPair = await subtle.generateKey({ name: "Ed25519" }, true, ["sign", "verify"]);
  const rawSignPub = Buffer.from(await subtle.exportKey("raw", signingPair.publicKey)).toString("hex");

  // 2. Generate X25519 DH Identity Keypair
  const dhIdentityPair = await subtle.generateKey({ name: "X25519" }, true, ["deriveBits"]);
  const rawDhPub = Buffer.from(await subtle.exportKey("raw", dhIdentityPair.publicKey)).toString("hex");

  // 3. Generate X25519 Signed Prekey Keypair
  const spkPair = await subtle.generateKey({ name: "X25519" }, true, ["deriveBits"]);
  const rawSpkPub = Buffer.from(await subtle.exportKey("raw", spkPair.publicKey)).toString("hex");

  // 4. Sign the Signed Prekey with Ed25519 signing private key
  const signableBuffer = buildSignedPrekeySignableBuffer(keyId, rawSpkPub);
  const sigBuffer = Buffer.from(
    await subtle.sign({ name: "Ed25519" }, signingPair.privateKey, signableBuffer)
  );
  const signatureHex = sigBuffer.toString("hex");

  // 5. Generate sample OPKs
  const opks = [];
  for (let i = 1; i <= 5; i++) {
    const opkPair = await subtle.generateKey({ name: "X25519" }, true, ["deriveBits"]);
    const rawOpkPub = Buffer.from(await subtle.exportKey("raw", opkPair.publicKey)).toString("hex");
    opks.push({ keyId: 100 + i, publicKey: rawOpkPub });
  }

  const connectId = deriveConnectId(rawDhPub);

  return {
    rawSignPub,
    rawDhPub,
    rawSpkPub,
    signatureHex,
    opks,
    connectId,
  };
}

describe("Backend Pre-Key Infrastructure Suite (Feature 2 — Phase 2)", () => {
  // Mock DB stores for unit test simulation
  let mockDevices = new Map();
  let mockBundles = new Map();

  before(() => {
    // Stub DeviceIdentity methods
    DeviceIdentity.findOne = (query) => {
      if (query.connectId) {
        for (const dev of mockDevices.values()) {
          if (dev.connectId.toUpperCase() === query.connectId.toUpperCase()) {
            if (query.status && dev.status !== query.status) continue;
            return Promise.resolve(dev);
          }
        }
      }
      if (query._id) {
        return Promise.resolve(mockDevices.get(query._id.toString()) || null);
      }
      return Promise.resolve(null);
    };

    // Stub PreKeyBundle methods
    PreKeyBundle.findOne = (query) => {
      if (query.deviceId) {
        const bundle = mockBundles.get(query.deviceId.toString());
        return Promise.resolve(bundle || null);
      }
      if (query.connectId) {
        for (const b of mockBundles.values()) {
          if (b.connectId.toUpperCase() === query.connectId.toUpperCase()) {
            return Promise.resolve(b);
          }
        }
      }
      return Promise.resolve(null);
    };

    PreKeyBundle.findOneAndUpdate = (query, update, options) => {
      let bundle = null;
      if (query.deviceId) {
        bundle = mockBundles.get(query.deviceId.toString());
      }

      if (options?.upsert && !bundle) {
        bundle = {
          ...update.$set,
          _id: "bundle_" + Date.now(),
          save: function () {
            return Promise.resolve(this);
          },
        };
        mockBundles.set(query.deviceId.toString(), bundle);
        return Promise.resolve(bundle);
      }

      if (bundle) {
        // Atomic OPK consumption logic
        if (query["oneTimePrekeys.isConsumed"] === false) {
          const unconsumed = bundle.oneTimePrekeys.find((k) => !k.isConsumed);
          if (unconsumed) {
            unconsumed.isConsumed = true;
            unconsumed.consumedAt = update.$set["oneTimePrekeys.$.consumedAt"] || new Date();
            unconsumed.consumptionId = update.$set["oneTimePrekeys.$.consumptionId"] || null;
            bundle.activeOpkCount = bundle.oneTimePrekeys.filter((k) => !k.isConsumed).length;
            return Promise.resolve(bundle);
          } else {
            return Promise.resolve(null); // No unconsumed OPK matched
          }
        }

        if (update.$set) {
          Object.assign(bundle, update.$set);
        }
        return Promise.resolve(bundle);
      }

      return Promise.resolve(null);
    };
  });

  beforeEach(() => {
    mockDevices.clear();
    mockBundles.clear();
  });

  describe("1. Cryptographic Prekey Signature Verification", () => {
    test("verifies valid Ed25519 signature on Signed Prekey", async () => {
      const keys = await createTestKeyMaterials(1);
      const isValid = await verifySignedPrekeySignature({
        signingPublicKeyHex: keys.rawSignPub,
        keyId: 1,
        signedPrekeyPublicKeyHex: keys.rawSpkPub,
        signatureHex: keys.signatureHex,
      });

      assert.equal(isValid, true);
    });

    test("rejects signature if Signed Prekey public key is modified (tampering check)", async () => {
      const keys = await createTestKeyMaterials(1);
      const tamperedSpk = "0".repeat(64);

      const isValid = await verifySignedPrekeySignature({
        signingPublicKeyHex: keys.rawSignPub,
        keyId: 1,
        signedPrekeyPublicKeyHex: tamperedSpk,
        signatureHex: keys.signatureHex,
      });

      assert.equal(isValid, false);
    });

    test("rejects signature if keyId is altered", async () => {
      const keys = await createTestKeyMaterials(1);

      const isValid = await verifySignedPrekeySignature({
        signingPublicKeyHex: keys.rawSignPub,
        keyId: 2, // altered keyId
        signedPrekeyPublicKeyHex: keys.rawSpkPub,
        signatureHex: keys.signatureHex,
      });

      assert.equal(isValid, false);
    });
  });

  describe("2. Server Prekey Bundle Registration", () => {
    test("successfully registers valid prekey bundle for active owned device", async () => {
      const keys = await createTestKeyMaterials(1);
      const userId = "660000000000000000000001";
      const deviceId = "dev_alice_01";
      const connectId = keys.connectId;

      mockDevices.set(deviceId, {
        _id: deviceId,
        userId: { toString: () => userId },
        connectId,
        publicKey: keys.rawDhPub,
        status: "ACTIVE",
      });

      let resStatus = 0;
      let resData = null;
      const res = {
        status: (s) => {
          resStatus = s;
          return {
            json: (d) => {
              resData = d;
            },
          };
        },
      };

      const req = {
        user: { _id: { toString: () => userId } },
        body: {
          connectId,
          identityKeyDh: keys.rawDhPub,
          identityKeySign: keys.rawSignPub,
          signedPrekey: {
            keyId: 1,
            publicKey: keys.rawSpkPub,
            signature: keys.signatureHex,
          },
          oneTimePrekeys: keys.opks,
          protocolVersion: 1,
        },
      };

      await registerPrekeyBundle(req, res);

      assert.equal(resStatus, 200);
      assert.equal(resData.connectId, connectId);
      assert.equal(resData.activeOpkCount, 5);
      assert.equal(mockBundles.size, 1);
    });

    test("strictly rejects registration payloads containing private keys", async () => {
      const keys = await createTestKeyMaterials(1);
      const userId = "660000000000000000000001";

      let resStatus = 0;
      let resData = null;
      const res = {
        status: (s) => {
          resStatus = s;
          return {
            json: (d) => {
              resData = d;
            },
          };
        },
      };

      const req = {
        user: { _id: { toString: () => userId } },
        body: {
          connectId: keys.connectId,
          identityKeyDh: keys.rawDhPub,
          privateKey: "leaked_private_scalar",
        },
      };

      await registerPrekeyBundle(req, res);

      assert.equal(resStatus, 400);
      assert.match(resData.message, /forbidden/i);
    });

    test("rejects registration for device owned by another account (IDOR defense)", async () => {
      const keys = await createTestKeyMaterials(1);
      const ownerUserId = "660000000000000000000001";
      const attackerUserId = "660000000000000000000002";
      const deviceId = "dev_bob_01";
      const connectId = keys.connectId;

      mockDevices.set(deviceId, {
        _id: deviceId,
        userId: { toString: () => ownerUserId },
        connectId,
        publicKey: keys.rawDhPub,
        status: "ACTIVE",
      });

      let resStatus = 0;
      const res = {
        status: (s) => {
          resStatus = s;
          return { json: () => {} };
        },
      };

      const req = {
        user: { _id: { toString: () => attackerUserId } },
        body: {
          connectId,
          identityKeyDh: keys.rawDhPub,
          identityKeySign: keys.rawSignPub,
          signedPrekey: {
            keyId: 1,
            publicKey: keys.rawSpkPub,
            signature: keys.signatureHex,
          },
        },
      };

      await registerPrekeyBundle(req, res);
      assert.equal(resStatus, 403);
    });
  });

  describe("3. Atomic One-Time Prekey Consumption & Bundle Retrieval", () => {
    test("retrieves prekey bundle and atomically consumes exactly 1 OPK per request", async () => {
      const keys = await createTestKeyMaterials(1);
      const userId = "660000000000000000000001";
      const deviceId = "dev_alice_01";
      const connectId = keys.connectId;

      mockDevices.set(deviceId, {
        _id: deviceId,
        userId: { toString: () => userId },
        connectId,
        publicKey: keys.rawDhPub,
        status: "ACTIVE",
      });

      const bundleRecord = {
        deviceId,
        userId,
        connectId,
        identityKeyDh: keys.rawDhPub,
        identityKeySign: keys.rawSignPub,
        signedPrekey: {
          keyId: 1,
          publicKey: keys.rawSpkPub,
          signature: keys.signatureHex,
          createdAt: new Date(),
          version: 1,
        },
        oneTimePrekeys: keys.opks.map((k) => ({ ...k, isConsumed: false, consumedAt: null })),
        activeOpkCount: keys.opks.length,
        protocolVersion: 1,
      };
      mockBundles.set(deviceId, bundleRecord);

      let resStatus = 0;
      let resData = null;
      const res = {
        status: (s) => {
          resStatus = s;
          return {
            json: (d) => {
              resData = d;
            },
          };
        },
      };

      const req = {
        user: { _id: { toString: () => "660000000000000000000002" } },
        params: { connectId },
      };

      // Request 1: Consumes OPK 101
      await getPrekeyBundle(req, res);
      assert.equal(resStatus, 200);
      assert.equal(resData.oneTimePrekey.keyId, 101);
      assert.equal(resData.identityKeyDh, keys.rawDhPub);

      // Request 2: Consumes OPK 102
      await getPrekeyBundle(req, res);
      assert.equal(resStatus, 200);
      assert.equal(resData.oneTimePrekey.keyId, 102);

      // Verify active count decreased
      assert.equal(bundleRecord.activeOpkCount, 3);
    });

    test("handles exhausted OPK pool gracefully (returns bundle with oneTimePrekey: null)", async () => {
      const keys = await createTestKeyMaterials(1);
      const userId = "660000000000000000000001";
      const deviceId = "dev_alice_01";
      const connectId = keys.connectId;

      mockDevices.set(deviceId, {
        _id: deviceId,
        userId: { toString: () => userId },
        connectId,
        publicKey: keys.rawDhPub,
        status: "ACTIVE",
      });

      // All OPKs already consumed
      const bundleRecord = {
        deviceId,
        userId,
        connectId,
        identityKeyDh: keys.rawDhPub,
        identityKeySign: keys.rawSignPub,
        signedPrekey: {
          keyId: 1,
          publicKey: keys.rawSpkPub,
          signature: keys.signatureHex,
          createdAt: new Date(),
          version: 1,
        },
        oneTimePrekeys: keys.opks.map((k) => ({ ...k, isConsumed: true, consumedAt: new Date() })),
        activeOpkCount: 0,
        protocolVersion: 1,
      };
      mockBundles.set(deviceId, bundleRecord);

      let resStatus = 0;
      let resData = null;
      const res = {
        status: (s) => {
          resStatus = s;
          return {
            json: (d) => {
              resData = d;
            },
          };
        },
      };

      const req = {
        user: { _id: { toString: () => "660000000000000000000002" } },
        params: { connectId },
      };

      await getPrekeyBundle(req, res);
      assert.equal(resStatus, 200);
      assert.equal(resData.oneTimePrekey, null);
      assert.equal(resData.signedPrekey.publicKey, keys.rawSpkPub);
    });
  });

  describe("4. One-Time Prekey Replenishment & Status", () => {
    test("replenishes OPKs and updates active count", async () => {
      const keys = await createTestKeyMaterials(1);
      const userId = "660000000000000000000001";
      const deviceId = "dev_alice_01";
      const connectId = keys.connectId;

      mockDevices.set(deviceId, {
        _id: deviceId,
        userId: { toString: () => userId },
        connectId,
        publicKey: keys.rawDhPub,
        status: "ACTIVE",
      });

      const bundleRecord = {
        deviceId,
        userId,
        connectId,
        oneTimePrekeys: [],
        activeOpkCount: 0,
        save: function () {
          return Promise.resolve(this);
        },
      };
      mockBundles.set(deviceId, bundleRecord);

      let resStatus = 0;
      let resData = null;
      const res = {
        status: (s) => {
          resStatus = s;
          return {
            json: (d) => {
              resData = d;
            },
          };
        },
      };

      const req = {
        user: { _id: { toString: () => userId } },
        body: {
          connectId,
          oneTimePrekeys: keys.opks,
        },
      };

      await replenishOneTimePrekeys(req, res);
      assert.equal(resStatus, 200);
      assert.equal(resData.activeOpkCount, 5);
      assert.equal(bundleRecord.oneTimePrekeys.length, 5);
    });

    test("getPrekeyStatus flags low inventory when activeOpkCount < 10", async () => {
      const keys = await createTestKeyMaterials(1);
      const userId = "660000000000000000000001";
      const deviceId = "dev_alice_01";
      const connectId = keys.connectId;

      mockDevices.set(deviceId, {
        _id: deviceId,
        userId: { toString: () => userId },
        connectId,
        status: "ACTIVE",
      });

      mockBundles.set(deviceId, {
        deviceId,
        connectId,
        oneTimePrekeys: [{ keyId: 1, isConsumed: false }],
        signedPrekey: { createdAt: new Date() },
      });

      let resData = null;
      const res = {
        status: () => ({
          json: (d) => {
            resData = d;
          },
        }),
      };

      const req = {
        user: { _id: { toString: () => userId }, connectId },
        params: { connectId },
      };

      await getPrekeyStatus(req, res);
      assert.equal(resData.activeOpkCount, 1);
      assert.equal(resData.needsReplenishment, true);
    });
  });
});
