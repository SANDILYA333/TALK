import test from "node:test";
import assert from "node:assert/strict";

import {
  calculateSafetyNumber,
  generateSafetyQrPayload,
  verifySafetyQrPayload,
  getContactVerificationStatus,
  markContactVerified,
  unverifyContact,
} from "../safety-number.js";

// Mock localStorage for node test runner
if (typeof globalThis.localStorage === "undefined") {
  const store = new Map();
  globalThis.localStorage = {
    getItem: (k) => store.get(k) || null,
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
    clear: () => store.clear(),
  };
}

test.describe("TALK Feature 5 / Task 4.2 — Safety Number Verification Suite", () => {
  const keyAlice = "a0".repeat(32);
  const keyBob = "b1".repeat(32);
  const keyEve = "c2".repeat(32);

  test.beforeEach(() => {
    globalThis.localStorage.clear();
  });

  test("1. Alice and Bob compute identical safety numbers (Canonical Ordering)", async () => {
    const aliceView = await calculateSafetyNumber({
      localKeyHex: keyAlice,
      peerKeyHex: keyBob,
    });

    const bobView = await calculateSafetyNumber({
      localKeyHex: keyBob,
      peerKeyHex: keyAlice,
    });

    assert.equal(
      aliceView.fingerprint,
      bobView.fingerprint,
      "Both participants must compute identical safety numbers regardless of caller ordering"
    );
    assert.equal(aliceView.formattedBlocks.length, 12, "Must contain exactly 12 blocks");
    aliceView.formattedBlocks.forEach((block) => {
      assert.equal(block.length, 5, "Each block must contain 5 decimal digits");
      assert(/^[0-9]{5}$/.test(block), "Blocks must be strictly numeric");
    });
  });

  test("2. Distinct identity keys produce distinct safety numbers", async () => {
    const aliceBob = await calculateSafetyNumber({
      localKeyHex: keyAlice,
      peerKeyHex: keyBob,
    });

    const aliceEve = await calculateSafetyNumber({
      localKeyHex: keyAlice,
      peerKeyHex: keyEve,
    });

    assert.notEqual(
      aliceBob.fingerprint,
      aliceEve.fingerprint,
      "Different identity keys must produce completely different fingerprints"
    );
  });

  test("3. QR code payload generation and valid verification", async () => {
    const { fingerprint } = await calculateSafetyNumber({
      localKeyHex: keyAlice,
      peerKeyHex: keyBob,
    });

    const qrPayload = generateSafetyQrPayload({
      fingerprint,
      peerConnectId: "TALK-BOBB-Y002",
    });

    assert(qrPayload.includes("TALK-VERIFY-V1"));

    const verification = verifySafetyQrPayload(qrPayload, fingerprint);
    assert.equal(verification.valid, true);
  });

  test("4. QR code verification detects and rejects tampered fingerprints", async () => {
    const { fingerprint } = await calculateSafetyNumber({
      localKeyHex: keyAlice,
      peerKeyHex: keyBob,
    });

    const tamperedQr = JSON.stringify({
      protocol: "TALK-VERIFY-V1",
      connectId: "TALK-BOBB-Y002",
      fingerprint: "999999999999999999999999999999999999999999999999999999999999",
    });

    const verification = verifySafetyQrPayload(tamperedQr, fingerprint);
    assert.equal(verification.valid, false);
    assert.equal(verification.error, "Safety number mismatch");
  });

  test("5. Rejects malformed QR payload format gracefully", () => {
    const verification = verifySafetyQrPayload("NOT_JSON_STRING", "12345");
    assert.equal(verification.valid, false);
    assert.equal(verification.error, "Malformed QR code payload");
  });

  test("6. Local contact verification lifecycle and key rotation detection", async () => {
    const peerConnectId = "TALK-BOBB-Y002";
    const { fingerprint } = await calculateSafetyNumber({
      localKeyHex: keyAlice,
      peerKeyHex: keyBob,
    });

    // Initial state: not verified
    const initialStatus = getContactVerificationStatus({
      peerConnectId,
      currentPeerKeyHex: keyBob,
    });
    assert.equal(initialStatus.isVerified, false);
    assert.equal(initialStatus.hasKeyChanged, false);

    // Mark as verified
    markContactVerified({
      peerConnectId,
      peerKeyHex: keyBob,
      fingerprint,
    });

    const verifiedStatus = getContactVerificationStatus({
      peerConnectId,
      currentPeerKeyHex: keyBob,
    });
    assert.equal(verifiedStatus.isVerified, true);
    assert.equal(verifiedStatus.hasKeyChanged, false);
    assert(verifiedStatus.verifiedAt);

    // Key rotation attack/detection: Bob's identity key changed to Eve's key
    const rotatedStatus = getContactVerificationStatus({
      peerConnectId,
      currentPeerKeyHex: keyEve,
    });
    assert.equal(rotatedStatus.isVerified, false);
    assert.equal(
      rotatedStatus.hasKeyChanged,
      true,
      "Must flag key changed when identity public key rotates!"
    );

    // Unverify removes state
    unverifyContact(peerConnectId);
    const unverifiedStatus = getContactVerificationStatus({
      peerConnectId,
      currentPeerKeyHex: keyBob,
    });
    assert.equal(unverifiedStatus.isVerified, false);
    assert.equal(unverifiedStatus.hasKeyChanged, false);
  });
});
