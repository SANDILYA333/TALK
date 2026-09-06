import { test, describe, beforeEach } from "node:test";
import assert from "node:assert/strict";

import {
  generateIdentityKeyPair,
  exportPublicKey,
  deriveConnectId,
  normalizeConnectId,
  isValidConnectId,
  getOrCreateDeviceIdentity,
  resetDeviceIdentity,
  generateBindingProof,
  isCurrentDevice,
} from "../index.js";

describe("Phase 7 — Frontend Cryptographic Hardening & Property Invariant Suite", () => {
  beforeEach(async () => {
    await resetDeviceIdentity();
  });

  describe("1. Property-Based Crockford Base32 Invariants (50 Randomized Keys)", () => {
    test("derives valid, collision-resistant, unambiguous Crockford Base32 Connect IDs across 50 keypairs", async () => {
      const connectIds = new Set();
      const forbiddenChars = ["I", "L", "O", "U", "i", "l", "o", "u"];

      for (let i = 0; i < 50; i++) {
        const keypair = await generateIdentityKeyPair();
        const pubExport = await exportPublicKey(keypair.publicKey);
        const connectId = await deriveConnectId(pubExport.raw);

        // Invariant 1: Format matches TALK-XXXX-XXXX
        assert.match(
          connectId,
          /^TALK-[0-9A-Z]{4}-[0-9A-Z]{4}$/,
          `Connect ID ${connectId} must match TALK-XXXX-XXXX format`
        );

        // Invariant 2: Excludes ambiguous Crockford characters in the derived 8-char payload
        const encodedPayload = connectId.slice(5); // skips 'TALK-'
        for (const char of forbiddenChars) {
          assert.equal(
            encodedPayload.includes(char),
            false,
            `Connect ID payload ${encodedPayload} must not contain ambiguous char ${char}`
          );
        }

        // Invariant 3: Normalization idempotency
        const normalized = normalizeConnectId(connectId);
        assert.equal(normalized, connectId);
        assert.equal(isValidConnectId(normalized), true);

        // Invariant 4: Collision resistance across unique keypairs
        assert.equal(
          connectIds.has(connectId),
          false,
          `Connect ID ${connectId} must be unique across distinct keypairs`
        );
        connectIds.add(connectId);
      }

      assert.equal(connectIds.size, 50, "All 50 generated Connect IDs must be distinct");
    });
  });

  describe("2. End-to-End Client Lifecycle & PoP Generation", () => {
    test("generates identity, persists to storage, retrieves idempotently, and generates valid PoP proof", async () => {
      // Step 1: Initial creation
      const identity1 = await getOrCreateDeviceIdentity();
      assert.ok(identity1.publicKey);
      assert.ok(identity1.privateKey);
      assert.ok(identity1.publicKeyHex);
      assert.ok(identity1.connectId);

      // Step 2: Idempotent retrieval
      const identity2 = await getOrCreateDeviceIdentity();
      assert.equal(identity2.publicKeyHex, identity1.publicKeyHex);
      assert.equal(identity2.connectId, identity1.connectId);

      // Step 3: Proof-of-Possession Generation
      // Ephemeral server key (32 bytes for test)
      const fakeServerPubKeyHex = "0102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f20";
      const fakeNonce = "abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789";

      const proof = await generateBindingProof({
        clientPrivateKey: identity1.privateKey,
        serverEphemeralPublicKeyHex: fakeServerPubKeyHex,
        challengeNonce: fakeNonce,
        clientPublicKeyHex: identity1.publicKeyHex,
      });

      // Proof must be a 64-char hex HMAC-SHA256 string
      assert.equal(typeof proof, "string");
      assert.equal(proof.length, 64);
      assert.match(proof, /^[0-9a-f]{64}$/);
    });
  });

  describe("3. Zero-Knowledge and Fingerprint-Free Verification", () => {
    test("public key export and device matching contain zero private key material and require zero browser fingerprinting", async () => {
      const identity = await getOrCreateDeviceIdentity();
      const pubExport = await exportPublicKey(identity.publicKey);

      // Verify pubExport structure
      assert.ok(!("privateKey" in pubExport));
      assert.ok(!("pkcs8" in pubExport));
      assert.ok(!("secret" in pubExport));

      // Verify fingerprint-free device matching
      const matchingRecord = {
        connectId: identity.connectId,
        publicKey: identity.publicKeyHex,
      };
      const nonMatchingRecord = {
        connectId: "TALK-9999-8888",
        publicKey: "ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff",
      };

      assert.equal(isCurrentDevice(matchingRecord, identity), true);
      assert.equal(isCurrentDevice(nonMatchingRecord, identity), false);
    });
  });
});
