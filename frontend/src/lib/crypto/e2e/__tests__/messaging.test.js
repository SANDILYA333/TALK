/**
 * TALK Feature 2 — Phase 5: Encrypted Message Envelope & AEAD Messaging Test Suite
 *
 * Test Groups:
 *  Group A — Envelope Construction & AES-GCM AEAD Encryption
 *  Group B — Full Bidirectional Round-Trip (Alice <-> Bob)
 *  Group C — Cryptographic Integrity, Tampering & AEAD Tag Verification
 *  Group D — Out-of-Order Message Processing with Double Ratchet
 *  Group E — Replay Defense, Zero-Secret Wire Guards & Error Behavior
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  generateRatchetKeyPair,
  initSenderRatchet,
  initReceiverRatchet,
} from "../ratchet.js";
import { encryptMessage, decryptMessage } from "../messaging.js";
import { validateEnvelopeStructure, assertNoSecretMaterial } from "../envelope.js";
import { PROTOCOL_VERSION, ENVELOPE_TYPES, AES_GCM_NONCE_SIZE } from "../constants.js";
import { CryptographicError } from "../../errors.js";
import { hexToBytes, bytesToHex } from "../../utils.js";

// ---------------------------------------------------------------------------
// Test Setup Helpers
// ---------------------------------------------------------------------------

async function generateTestRootKey() {
  const subtle = globalThis.crypto.subtle;
  const key = await subtle.generateKey({ name: "AES-GCM", length: 256 }, true, ["encrypt"]);
  const raw = await subtle.exportKey("raw", key);
  return bytesToHex(new Uint8Array(raw));
}

async function createTestRatchetPair() {
  const rootKeyHex = await generateTestRootKey();
  const sessionId = "session_talk_test_e2e_envelope_001";
  const aliceConnectId = "TALK-ALIC-E001";
  const bobConnectId = "TALK-BOBB-Y002";

  // Bob generates receiving ratchet keypair (SPK)
  const bobRatchetKeyPair = await generateRatchetKeyPair();

  // Alice initializes sender ratchet with Bob's public ratchet key
  const aliceRatchet = await initSenderRatchet({
    rootKeyHex,
    sessionId,
    peerRatchetPublicKeyHex: bobRatchetKeyPair.publicKeyHex,
  });

  // Bob initializes receiver ratchet with his own keypair
  const bobRatchet = initReceiverRatchet({
    rootKeyHex,
    sessionId,
    ourRatchetKeyPair: bobRatchetKeyPair,
  });

  return {
    alice: aliceRatchet,
    bob: bobRatchet,
    sessionId,
    aliceConnectId,
    bobConnectId,
  };
}

// ---------------------------------------------------------------------------
// Test Suite
// ---------------------------------------------------------------------------

describe("TALK Feature 2 Phase 5 — Encrypted Message Envelope & AEAD Messaging", () => {

  // =========================================================================
  // Group A: Envelope Construction & AEAD Encryption
  // =========================================================================
  describe("Group A: Envelope Construction & AEAD Encryption", () => {
    it("A1: encrypts plaintext into a valid canonical envelope", async () => {
      const { alice, sessionId, aliceConnectId, bobConnectId } = await createTestRatchetPair();
      const plaintext = "Hello Bob, this message is end-to-end encrypted!";

      const { envelope, state } = await encryptMessage({
        plaintext,
        state: alice,
        sessionId,
        senderDeviceId: aliceConnectId,
        recipientDeviceId: bobConnectId,
      });

      assert(envelope, "Envelope must be returned");
      assert.equal(envelope.version, PROTOCOL_VERSION);
      assert.equal(envelope.sessionId, sessionId);
      assert.equal(envelope.senderDeviceId, aliceConnectId);
      assert.equal(envelope.recipientDeviceId, bobConnectId);
      assert.equal(envelope.messageType, ENVELOPE_TYPES.WHISPER_MESSAGE);
      assert(envelope.ciphertext, "Ciphertext must exist");
      assert.equal(typeof envelope.ciphertext, "string");
      assert.equal(typeof envelope.iv, "string");
      assert.equal(hexToBytes(envelope.iv).byteLength, AES_GCM_NONCE_SIZE, "IV must be 12 bytes");
      assert.equal(envelope.ratchetHeader.messageNumber, 0);
      assert.equal(state.Ns, 1, "Alice send counter must advance to 1");
      assert(validateEnvelopeStructure(envelope), "Envelope must pass structural validation");
    });

    it("A2: generates unique nonces for sequential messages (no nonce reuse)", async () => {
      const { alice, sessionId, aliceConnectId, bobConnectId } = await createTestRatchetPair();

      const { envelope: env1 } = await encryptMessage({
        plaintext: "Message 1",
        state: alice,
        sessionId,
        senderDeviceId: aliceConnectId,
        recipientDeviceId: bobConnectId,
      });

      const { envelope: env2 } = await encryptMessage({
        plaintext: "Message 2",
        state: alice,
        sessionId,
        senderDeviceId: aliceConnectId,
        recipientDeviceId: bobConnectId,
      });

      assert.notEqual(env1.iv, env2.iv, "Nonces must be unique across messages");
      assert.notEqual(env1.ciphertext, env2.ciphertext, "Ciphertexts must be distinct");
      assert.equal(env1.ratchetHeader.messageNumber, 0);
      assert.equal(env2.ratchetHeader.messageNumber, 1);
    });

    it("A3: enforces strict zero-secret invariant on wire envelope", async () => {
      const { alice, sessionId, aliceConnectId, bobConnectId } = await createTestRatchetPair();

      const { envelope } = await encryptMessage({
        plaintext: "Secret test content",
        state: alice,
        sessionId,
        senderDeviceId: aliceConnectId,
        recipientDeviceId: bobConnectId,
      });

      assert.doesNotThrow(() => assertNoSecretMaterial(envelope));
      const serialized = JSON.stringify(envelope);
      assert(!serialized.includes("privateKey"), "No private keys in wire payload");
      assert(!serialized.includes("rootKey"), "No root keys in wire payload");
      assert(!serialized.includes("chainKey"), "No chain keys in wire payload");
      assert(!serialized.includes("messageKey"), "No message keys in wire payload");
      assert(!serialized.includes("Secret test content"), "No plaintext in envelope JSON");
    });
  });

  // =========================================================================
  // Group B: Message Decryption & Full Round-Trip Exchange
  // =========================================================================
  describe("Group B: Message Decryption & Full Round-Trip Exchange", () => {
    it("B1: Alice encrypts -> Bob decrypts -> exact plaintext recovered", async () => {
      const { alice, bob, sessionId, aliceConnectId, bobConnectId } = await createTestRatchetPair();
      const originalSecret = "TALK-E2EE-SECRET-123456";

      const { envelope } = await encryptMessage({
        plaintext: originalSecret,
        state: alice,
        sessionId,
        senderDeviceId: aliceConnectId,
        recipientDeviceId: bobConnectId,
      });

      const decrypted = await decryptMessage({
        envelope,
        state: bob,
      });

      assert.equal(decrypted, originalSecret, "Decrypted message must match original plaintext");
      assert.equal(bob.Nr, 1, "Bob receive counter must advance to 1");
    });

    it("B2: Bidirectional multi-message exchange (Alice -> Bob -> Alice -> Bob)", async () => {
      const { alice, bob, sessionId, aliceConnectId, bobConnectId } = await createTestRatchetPair();

      // Alice -> Bob (Message 1)
      const { envelope: env1 } = await encryptMessage({
        plaintext: "Hello Bob!",
        state: alice,
        sessionId,
        senderDeviceId: aliceConnectId,
        recipientDeviceId: bobConnectId,
      });
      const dec1 = await decryptMessage({ envelope: env1, state: bob });
      assert.equal(dec1, "Hello Bob!");

      // Alice -> Bob (Message 2)
      const { envelope: env2 } = await encryptMessage({
        plaintext: "How are you today?",
        state: alice,
        sessionId,
        senderDeviceId: aliceConnectId,
        recipientDeviceId: bobConnectId,
      });
      const dec2 = await decryptMessage({ envelope: env2, state: bob });
      assert.equal(dec2, "How are you today?");

      // Bob -> Alice (Message 3 - Bob triggers DH Ratchet step)
      const { envelope: env3 } = await encryptMessage({
        plaintext: "Hey Alice! Everything is working smoothly.",
        state: bob,
        sessionId,
        senderDeviceId: bobConnectId,
        recipientDeviceId: aliceConnectId,
      });
      const dec3 = await decryptMessage({ envelope: env3, state: alice });
      assert.equal(dec3, "Hey Alice! Everything is working smoothly.");

      // Alice -> Bob (Message 4)
      const { envelope: env4 } = await encryptMessage({
        plaintext: "Glad to hear that!",
        state: alice,
        sessionId,
        senderDeviceId: aliceConnectId,
        recipientDeviceId: bobConnectId,
      });
      const dec4 = await decryptMessage({ envelope: env4, state: bob });
      assert.equal(dec4, "Glad to hear that!");
    });
  });

  // =========================================================================
  // Group C: Cryptographic Integrity & Tampering Tests
  // =========================================================================
  describe("Group C: Cryptographic Integrity & Tampering Tests", () => {
    it("C1: Tampered ciphertext byte causes AEAD decryption failure", async () => {
      const { alice, bob, sessionId, aliceConnectId, bobConnectId } = await createTestRatchetPair();

      const { envelope } = await encryptMessage({
        plaintext: "Highly sensitive message",
        state: alice,
        sessionId,
        senderDeviceId: aliceConnectId,
        recipientDeviceId: bobConnectId,
      });

      // Flip the last byte of ciphertext
      const rawCipher = hexToBytes(envelope.ciphertext);
      rawCipher[rawCipher.length - 1] ^= 0x01;
      const tamperedEnvelope = {
        ...envelope,
        ciphertext: bytesToHex(rawCipher),
      };

      await assert.rejects(
        () => decryptMessage({ envelope: tamperedEnvelope, state: bob }),
        (err) => {
          assert(err instanceof CryptographicError);
          assert(err.message.includes("Decryption failed"));
          return true;
        },
        "Must reject tampered ciphertext with CryptographicError"
      );
    });

    it("C2: Tampered nonce (IV) causes AEAD decryption failure", async () => {
      const { alice, bob, sessionId, aliceConnectId, bobConnectId } = await createTestRatchetPair();

      const { envelope } = await encryptMessage({
        plaintext: "Integrity check message",
        state: alice,
        sessionId,
        senderDeviceId: aliceConnectId,
        recipientDeviceId: bobConnectId,
      });

      const rawIv = hexToBytes(envelope.iv);
      rawIv[0] ^= 0xff;
      const tamperedEnvelope = {
        ...envelope,
        iv: bytesToHex(rawIv),
      };

      await assert.rejects(
        () => decryptMessage({ envelope: tamperedEnvelope, state: bob }),
        (err) => err instanceof CryptographicError
      );
    });

    it("C3: Tampered Associated Data (senderDeviceId or sessionId) fails authentication", async () => {
      const { alice, bob, sessionId, aliceConnectId, bobConnectId } = await createTestRatchetPair();

      const { envelope } = await encryptMessage({
        plaintext: "Associated data binding check",
        state: alice,
        sessionId,
        senderDeviceId: aliceConnectId,
        recipientDeviceId: bobConnectId,
      });

      // Attacker modifies routing metadata in clear envelope
      const tamperedEnvelope = {
        ...envelope,
        senderDeviceId: "TALK-ATTACKER-999",
      };

      await assert.rejects(
        () => decryptMessage({ envelope: tamperedEnvelope, state: bob }),
        (err) => err instanceof CryptographicError,
        "Modifying unencrypted envelope headers must invalidate the AEAD authentication tag"
      );
    });

    it("C4: Decrypting with the wrong session fails", async () => {
      const { alice, sessionId, aliceConnectId, bobConnectId } = await createTestRatchetPair();
      const unrelatedPair = await createTestRatchetPair();

      const { envelope } = await encryptMessage({
        plaintext: "Wrong session test",
        state: alice,
        sessionId,
        senderDeviceId: aliceConnectId,
        recipientDeviceId: bobConnectId,
      });

      // Attempt to decrypt with Charlie (unrelated receiver ratchet)
      await assert.rejects(
        () => decryptMessage({ envelope, state: unrelatedPair.bob }),
        (err) => err instanceof CryptographicError
      );
    });
  });

  // =========================================================================
  // Group D: Out-of-Order Message Delivery
  // =========================================================================
  describe("Group D: Out-of-Order Message Delivery", () => {
    it("D1: Bob decrypts out-of-order messages (M1, M3, M2) using skipped-key cache", async () => {
      const { alice, bob, sessionId, aliceConnectId, bobConnectId } = await createTestRatchetPair();

      const { envelope: m1 } = await encryptMessage({
        plaintext: "Message 1",
        state: alice,
        sessionId,
        senderDeviceId: aliceConnectId,
        recipientDeviceId: bobConnectId,
      });

      const { envelope: m2 } = await encryptMessage({
        plaintext: "Message 2",
        state: alice,
        sessionId,
        senderDeviceId: aliceConnectId,
        recipientDeviceId: bobConnectId,
      });

      const { envelope: m3 } = await encryptMessage({
        plaintext: "Message 3",
        state: alice,
        sessionId,
        senderDeviceId: aliceConnectId,
        recipientDeviceId: bobConnectId,
      });

      // Deliver in order: M1, then M3 (skipping M2), then M2
      const dec1 = await decryptMessage({ envelope: m1, state: bob });
      assert.equal(dec1, "Message 1");

      const dec3 = await decryptMessage({ envelope: m3, state: bob });
      assert.equal(dec3, "Message 3");

      const dec2 = await decryptMessage({ envelope: m2, state: bob });
      assert.equal(dec2, "Message 2");
    });
  });

  // =========================================================================
  // Group E: Replay Defense & Strict Validation
  // =========================================================================
  describe("Group E: Replay Defense & Strict Validation", () => {
    it("E1: Replayed message cannot be decrypted again (single-use key consumption)", async () => {
      const { alice, bob, sessionId, aliceConnectId, bobConnectId } = await createTestRatchetPair();

      const { envelope } = await encryptMessage({
        plaintext: "One-time secret",
        state: alice,
        sessionId,
        senderDeviceId: aliceConnectId,
        recipientDeviceId: bobConnectId,
      });

      // First decryption succeeds
      const dec = await decryptMessage({ envelope, state: bob });
      assert.equal(dec, "One-time secret");

      // Replay attempt fails because message key was already consumed
      await assert.rejects(
        () => decryptMessage({ envelope, state: bob }),
        (err) => err instanceof CryptographicError
      );
    });

    it("E2: Absolute No-Downgrade Rule — rejects invalid inputs without producing plaintext", async () => {
      const { sessionId, aliceConnectId, bobConnectId } = await createTestRatchetPair();

      await assert.rejects(
        () => encryptMessage({
          plaintext: 12345, // invalid type
          state: {},
          sessionId,
          senderDeviceId: aliceConnectId,
          recipientDeviceId: bobConnectId,
        }),
        (err) => err instanceof CryptographicError
      );
    });
  });
});
