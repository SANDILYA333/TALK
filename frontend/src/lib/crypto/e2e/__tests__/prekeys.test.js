import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";

import {
  generateSigningIdentityKeyPair,
  generateSignedPrekey,
  verifySignedPrekeySignature,
  generateOneTimePrekeyBatch,
  getOrCreateDevicePrekeys,
  replenishLocalPrekeysIfNeeded,
} from "../prekeys.js";
import {
  saveSigningIdentityKeyPair,
  loadSigningIdentityKeyPair,
  saveSignedPrekeyRecord,
  loadSignedPrekeyRecord,
  saveOneTimePrekeysPool,
  loadOneTimePrekeysPool,
  consumeLocalOneTimePrekey,
  clearAllPrekeyStorage,
} from "../storage.js";
import { validatePrekeyBundle } from "../types.js";

describe("Frontend Pre-Key Infrastructure Suite (Feature 2 — Phase 2)", () => {
  beforeEach(async () => {
    await clearAllPrekeyStorage();
  });

  describe("1. Ed25519 Signing Identity Keypair Generation & Persistence", () => {
    it("generates a valid Ed25519 signing keypair", async () => {
      const pair = await generateSigningIdentityKeyPair();
      assert.ok(pair.publicKey);
      assert.ok(pair.privateKey);
      assert.equal(pair.publicKey.algorithm.name, "Ed25519");
      assert.equal(pair.privateKey.algorithm.name, "Ed25519");
    });

    it("saves and reloads Ed25519 signing keypair from local storage", async () => {
      const originalPair = await generateSigningIdentityKeyPair();
      await saveSigningIdentityKeyPair(originalPair);

      const loaded = await loadSigningIdentityKeyPair();
      assert.ok(loaded);
      assert.equal(typeof loaded.publicKeyHex, "string");
      assert.equal(loaded.publicKeyHex.length, 64);
      assert.equal(loaded.publicKey.algorithm.name, "Ed25519");
      assert.equal(loaded.privateKey.algorithm.name, "Ed25519");
    });
  });

  describe("2. Signed Prekey (SPK) Generation & Cryptographic Verification", () => {
    it("generates an X25519 Signed Prekey signed by Ed25519 identity", async () => {
      const signingPair = await generateSigningIdentityKeyPair();
      const spk = await generateSignedPrekey(signingPair.privateKey, 1);

      assert.equal(spk.keyId, 1);
      assert.equal(typeof spk.publicKeyHex, "string");
      assert.equal(spk.publicKeyHex.length, 64);
      assert.equal(typeof spk.signatureHex, "string");
      assert.equal(spk.signatureHex.length, 128);

      const isValid = await verifySignedPrekeySignature(signingPair.publicKey, spk);
      assert.equal(isValid, true);
    });

    it("detects and rejects tampered Signed Prekey public keys", async () => {
      const signingPair = await generateSigningIdentityKeyPair();
      const spk = await generateSignedPrekey(signingPair.privateKey, 1);

      const tamperedSpk = {
        ...spk,
        publicKey: "0".repeat(64),
      };

      const isValid = await verifySignedPrekeySignature(signingPair.publicKey, tamperedSpk);
      assert.equal(isValid, false);
    });

    it("detects and rejects tampered key IDs", async () => {
      const signingPair = await generateSigningIdentityKeyPair();
      const spk = await generateSignedPrekey(signingPair.privateKey, 1);

      const tamperedSpk = {
        ...spk,
        keyId: 999, // altered keyId
      };

      const isValid = await verifySignedPrekeySignature(signingPair.publicKey, tamperedSpk);
      assert.equal(isValid, false);
    });

    it("saves and reloads Signed Prekey record from local storage", async () => {
      const signingPair = await generateSigningIdentityKeyPair();
      const spk = await generateSignedPrekey(signingPair.privateKey, 1);
      await saveSignedPrekeyRecord(spk);

      const loaded = await loadSignedPrekeyRecord();
      assert.ok(loaded);
      assert.equal(loaded.keyId, 1);
      assert.equal(loaded.publicKeyHex, spk.publicKeyHex);
      assert.equal(loaded.signatureHex, spk.signatureHex);
    });
  });

  describe("3. One-Time Prekey (OPK) Batch Generation & Local Consumption", () => {
    it("generates a batch of unique X25519 One-Time Prekeys", async () => {
      const batch = await generateOneTimePrekeyBatch(1, 10);
      assert.equal(batch.length, 10);
      assert.equal(batch[0].keyId, 1);
      assert.equal(batch[9].keyId, 10);

      const uniqueKeys = new Set(batch.map((k) => k.publicKeyHex));
      assert.equal(uniqueKeys.size, 10);
    });

    it("saves, reloads, and consumes local OPKs sequentially", async () => {
      const batch = await generateOneTimePrekeyBatch(1, 5);
      await saveOneTimePrekeysPool(batch);

      let pool = await loadOneTimePrekeysPool();
      assert.equal(pool.length, 5);

      // Consume OPK 2
      const consumed = await consumeLocalOneTimePrekey(2);
      assert.ok(consumed);
      assert.equal(consumed.keyId, 2);
      assert.equal(consumed.publicKeyHex, batch[1].publicKeyHex);

      // Verify pool now has 4 keys
      pool = await loadOneTimePrekeysPool();
      assert.equal(pool.length, 4);
      assert.equal(pool.some((k) => k.keyId === 2), false);
    });
  });

  describe("4. End-to-End Client Prekey Initialization & Lifecycle", () => {
    it("initializes complete valid prekey bundle for active device identity", async () => {
      const mockDeviceIdentity = {
        connectId: "TALK-E2EE-TEST",
        publicKeyHex: "a".repeat(64),
      };

      const result = await getOrCreateDevicePrekeys(mockDeviceIdentity);
      assert.ok(result.publicBundle);
      assert.equal(result.publicBundle.connectId, "TALK-E2EE-TEST");
      assert.equal(result.publicBundle.oneTimePrekeys.length, 50);

      // Validate public bundle schema
      const isBundleValid = validatePrekeyBundle({
        deviceId: result.publicBundle.connectId,
        identityKeyDh: result.publicBundle.identityKeyDh,
        identityKeySign: result.publicBundle.identityKeySign,
        signedPrekey: result.publicBundle.signedPrekey,
        oneTimePrekey: result.publicBundle.oneTimePrekeys[0],
      });
      assert.equal(isBundleValid, true);

      // Verify signature on published SPK
      const isSigValid = await verifySignedPrekeySignature(
        result.publicBundle.identityKeySign,
        result.publicBundle.signedPrekey
      );
      assert.equal(isSigValid, true);
    });

    it("idempotently returns existing prekey records on repeated calls", async () => {
      const mockDeviceIdentity = {
        connectId: "TALK-E2EE-TEST",
        publicKeyHex: "b".repeat(64),
      };

      const result1 = await getOrCreateDevicePrekeys(mockDeviceIdentity);
      const result2 = await getOrCreateDevicePrekeys(mockDeviceIdentity);

      assert.equal(
        result1.publicBundle.signedPrekey.publicKey,
        result2.publicBundle.signedPrekey.publicKey
      );
      assert.equal(
        result1.publicBundle.identityKeySign,
        result2.publicBundle.identityKeySign
      );
    });

    it("replenishes OPK pool when count drops below threshold", async () => {
      const mockDeviceIdentity = {
        connectId: "TALK-E2EE-TEST",
        publicKeyHex: "c".repeat(64),
      };

      await getOrCreateDevicePrekeys(mockDeviceIdentity);

      // Consume 45 keys to drop pool to 5 (< 10 threshold)
      for (let i = 1; i <= 45; i++) {
        await consumeLocalOneTimePrekey(i);
      }

      const poolBefore = await loadOneTimePrekeysPool();
      assert.equal(poolBefore.length, 5);

      const added = await replenishLocalPrekeysIfNeeded(10);
      assert.ok(added);
      assert.equal(added.length, 50);

      const poolAfter = await loadOneTimePrekeysPool();
      assert.equal(poolAfter.length, 55);
    });
  });
});
