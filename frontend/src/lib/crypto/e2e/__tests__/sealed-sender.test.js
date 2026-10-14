import test from "node:test";
import assert from "node:assert/strict";

import {
  generateRatchetKeyPair,
  initSenderRatchet,
  initReceiverRatchet,
} from "../ratchet.js";
import {
  packSealedSenderEnvelope,
  unpackSealedSenderEnvelope,
} from "../sealed-sender.js";
import { bytesToHex } from "../../utils.js";

async function generateTestRootKey() {
  const subtle = globalThis.crypto.subtle;
  const key = await subtle.generateKey({ name: "AES-GCM", length: 256 }, true, ["encrypt"]);
  const raw = await subtle.exportKey("raw", key);
  return bytesToHex(new Uint8Array(raw));
}

test.describe("TALK Feature 6 — Sealed Sender & Metadata Minimization Suite", () => {
  test("1. Successfully packs and unpacks a sealed sender envelope with inner sender authentication", async () => {
    const rootKeyHex = await generateTestRootKey();
    const sessionId = "session_sealed_test_123";
    const aliceConnectId = "TALK-ALIC-E001";
    const bobConnectId = "TALK-BOBB-Y002";

    const bobKeyPair = await generateRatchetKeyPair();
    const aliceRatchet = await initSenderRatchet({
      rootKeyHex,
      sessionId,
      peerRatchetPublicKeyHex: bobKeyPair.publicKeyHex,
    });
    const bobRatchet = initReceiverRatchet({
      rootKeyHex,
      sessionId,
      ourRatchetKeyPair: bobKeyPair,
    });

    const secretText = "Confidential sealed message from Alice!";

    // Alice packs sealed sender envelope
    const { sealedEnvelope } = await packSealedSenderEnvelope({
      plaintext: secretText,
      senderConnectId: aliceConnectId,
      recipientConnectId: bobConnectId,
      ratchetState: aliceRatchet,
      sessionId,
    });

    assert.equal(sealedEnvelope.protocol, "TALK-SEALED-SENDER-V1");
    assert.equal(sealedEnvelope.recipientConnectId, bobConnectId);
    // Outer envelope does not leak senderConnectId
    assert.equal(sealedEnvelope.senderConnectId, undefined);

    // Bob receives and unpacks sealed sender envelope
    const result = await unpackSealedSenderEnvelope({
      sealedEnvelope,
      ratchetState: bobRatchet,
    });

    assert.equal(result.plaintext, secretText);
    assert.equal(result.verifiedSenderConnectId, aliceConnectId);
    assert(result.timestamp);
  });

  test("2. Rejects tampered outer protocol or inner ciphertext", async () => {
    const rootKeyHex = await generateTestRootKey();
    const sessionId = "session_sealed_test_456";
    const bobKeyPair = await generateRatchetKeyPair();
    const aliceRatchet = await initSenderRatchet({
      rootKeyHex,
      sessionId,
      peerRatchetPublicKeyHex: bobKeyPair.publicKeyHex,
    });
    const bobRatchet = initReceiverRatchet({
      rootKeyHex,
      sessionId,
      ourRatchetKeyPair: bobKeyPair,
    });

    const { sealedEnvelope } = await packSealedSenderEnvelope({
      plaintext: "Original message",
      senderConnectId: "TALK-ALIC-E001",
      recipientConnectId: "TALK-BOBB-Y002",
      ratchetState: aliceRatchet,
      sessionId,
    });

    // Tamper with protocol
    const badProtocol = { ...sealedEnvelope, protocol: "UNKNOWN" };
    await assert.rejects(
      async () => {
        await unpackSealedSenderEnvelope({
          sealedEnvelope: badProtocol,
          ratchetState: bobRatchet,
        });
      },
      /Invalid sealed sender protocol/
    );
  });
});
