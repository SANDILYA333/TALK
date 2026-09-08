/**
 * TALK Feature 2 — Phase 4: Double Ratchet Core Test Suite
 *
 * Test Groups:
 *  A — State Initialization (sender + receiver paths)
 *  B — KDF_RK Determinism & Domain Separation
 *  C — KDF_CK Chain Advancement & Message Key Uniqueness
 *  D — Bidirectional Message Exchange (full round-trip)
 *  E — Out-of-Order Message Delivery (skipped keys)
 *  F — Skipped-Key Bounds Enforcement
 *  G — Forward Secrecy Invariants
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  generateRatchetKeyPair,
  kdfRootKey,
  kdfChainKey,
  initSenderRatchet,
  initReceiverRatchet,
  ratchetEncrypt,
  ratchetDecrypt,
  skippedKeyCount,
} from "../ratchet.js";
import { CryptographicError } from "../../errors.js";

// ---------------------------------------------------------------------------
// Test Utilities
// ---------------------------------------------------------------------------

/**
 * Generates a deterministic-looking 32-byte root key hex string for tests.
 * Real root keys come from X3DH; this simulates one with actual crypto randomness.
 */
async function generateTestRootKey() {
  const subtle = globalThis.crypto.subtle;
  const key = await subtle.generateKey({ name: "AES-GCM", length: 256 }, true, ["encrypt"]);
  const raw = await subtle.exportKey("raw", key);
  return Array.from(new Uint8Array(raw))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/**
 * Simulates a complete Alice↔Bob session setup for testing.
 * Returns { alice: DoubleRatchetState, bob: DoubleRatchetState }
 */
async function buildSymmetricSession() {
  const rootKeyHex = await generateTestRootKey();
  const sessionId = "test_session_001";

  // Bob's initial ratchet keypair (receiver)
  const bobRatchetKeyPair = await generateRatchetKeyPair();

  // Alice initializes as sender, using Bob's ratchet public key
  const alice = await initSenderRatchet({
    rootKeyHex,
    sessionId,
    peerRatchetPublicKeyHex: bobRatchetKeyPair.publicKeyHex,
  });

  // Bob initializes as receiver, holding his own keypair
  const bob = initReceiverRatchet({
    rootKeyHex,
    sessionId,
    ourRatchetKeyPair: bobRatchetKeyPair,
  });

  return { alice, bob, rootKeyHex, sessionId };
}

// ---------------------------------------------------------------------------
// Test Suite
// ---------------------------------------------------------------------------

describe("TALK Feature 2 Phase 4 — Double Ratchet Core", () => {

  // =========================================================================
  // Group A — State Initialization
  // =========================================================================
  describe("Group A: State Initialization", () => {
    it("A1: generates a valid X25519 ratchet keypair with publicKeyHex", async () => {
      const kp = await generateRatchetKeyPair();
      assert(kp.publicKey, "publicKey must exist");
      assert(kp.privateKey, "privateKey must exist");
      assert.equal(typeof kp.publicKeyHex, "string");
      assert.equal(kp.publicKeyHex.length, 64, "publicKeyHex must be 64 hex chars (32 bytes)");
      assert(/^[0-9a-f]+$/.test(kp.publicKeyHex), "publicKeyHex must be lowercase hex");
    });

    it("A2: each generateRatchetKeyPair call produces a unique keypair", async () => {
      const kp1 = await generateRatchetKeyPair();
      const kp2 = await generateRatchetKeyPair();
      assert.notEqual(kp1.publicKeyHex, kp2.publicKeyHex, "keypairs must be unique");
    });

    it("A3: initSenderRatchet produces correct initial state shape", async () => {
      const rootKeyHex = await generateTestRootKey();
      const peerKp = await generateRatchetKeyPair();
      const state = await initSenderRatchet({
        rootKeyHex,
        sessionId: "sess_alice_001",
        peerRatchetPublicKeyHex: peerKp.publicKeyHex,
      });

      assert.equal(state.sessionId, "sess_alice_001");
      assert(state.DHs, "DHs must be present");
      assert.equal(state.DHr, peerKp.publicKeyHex, "DHr must equal peer ratchet key");
      assert.equal(typeof state.RK, "string");
      assert.equal(state.RK.length, 64, "RK must be 64 hex chars");
      assert.equal(typeof state.CKs, "string", "CKs (sending chain) must be set");
      assert.equal(state.CKs.length, 64, "CKs must be 64 hex chars");
      assert.equal(state.CKr, null, "CKr must be null initially for sender");
      assert.equal(state.Ns, 0, "Send counter must be 0");
      assert.equal(state.Nr, 0, "Receive counter must be 0");
      assert.equal(state.PN, 0, "PN must be 0");
      assert(state.skippedMessageKeys instanceof Map);
      assert.equal(skippedKeyCount(state), 0);
    });

    it("A4: initReceiverRatchet produces correct initial state shape", async () => {
      const rootKeyHex = await generateTestRootKey();
      const bobKp = await generateRatchetKeyPair();
      const state = initReceiverRatchet({
        rootKeyHex,
        sessionId: "sess_bob_001",
        ourRatchetKeyPair: bobKp,
      });

      assert.equal(state.sessionId, "sess_bob_001");
      assert.equal(state.DHr, null, "DHr must be null (no peer key seen yet)");
      assert.equal(state.RK, rootKeyHex, "RK must equal the provided root key");
      assert.equal(state.CKs, null, "No sending chain yet");
      assert.equal(state.CKr, null, "No receiving chain yet");
      assert.equal(state.Ns, 0);
      assert.equal(state.Nr, 0);
      assert.equal(state.PN, 0);
      assert(state.skippedMessageKeys instanceof Map);
    });

    it("A5: initSenderRatchet rejects invalid inputs", async () => {
      const peerKp = await generateRatchetKeyPair();
      await assert.rejects(
        () => initSenderRatchet({ rootKeyHex: null, sessionId: "s", peerRatchetPublicKeyHex: peerKp.publicKeyHex }),
        (e) => e instanceof CryptographicError
      );
      await assert.rejects(
        () => initSenderRatchet({ rootKeyHex: "a".repeat(64), sessionId: "", peerRatchetPublicKeyHex: peerKp.publicKeyHex }),
        (e) => e instanceof CryptographicError
      );
      await assert.rejects(
        () => initSenderRatchet({ rootKeyHex: "a".repeat(64), sessionId: "s", peerRatchetPublicKeyHex: "tooshort" }),
        (e) => e instanceof CryptographicError
      );
    });

    it("A6: initReceiverRatchet rejects invalid inputs", async () => {
      const bobKp = await generateRatchetKeyPair();
      assert.throws(
        () => initReceiverRatchet({ rootKeyHex: null, sessionId: "s", ourRatchetKeyPair: bobKp }),
        (e) => e instanceof CryptographicError
      );
      assert.throws(
        () => initReceiverRatchet({ rootKeyHex: "a".repeat(64), sessionId: "", ourRatchetKeyPair: bobKp }),
        (e) => e instanceof CryptographicError
      );
      assert.throws(
        () => initReceiverRatchet({ rootKeyHex: "a".repeat(64), sessionId: "s", ourRatchetKeyPair: null }),
        (e) => e instanceof CryptographicError
      );
    });
  });

  // =========================================================================
  // Group B — KDF_RK Determinism & Domain Separation
  // =========================================================================
  describe("Group B: KDF_RK Determinism & Domain Separation", () => {
    it("B1: kdfRootKey produces consistent outputs for same inputs", async () => {
      const rk = await generateTestRootKey();
      const dhOutput = new Uint8Array(32).fill(0xab);

      const { newRootKeyHex: rk1, newChainKeyHex: ck1 } = await kdfRootKey(rk, dhOutput);
      const { newRootKeyHex: rk2, newChainKeyHex: ck2 } = await kdfRootKey(rk, dhOutput);

      assert.equal(rk1, rk2, "KDF_RK must be deterministic for same inputs");
      assert.equal(ck1, ck2, "KDF_RK chain key must be deterministic for same inputs");
    });

    it("B2: kdfRootKey produces different root and chain keys (domain separation)", async () => {
      const rk = await generateTestRootKey();
      const dhOutput = new Uint8Array(32).fill(0xcd);

      const { newRootKeyHex, newChainKeyHex } = await kdfRootKey(rk, dhOutput);

      assert.notEqual(newRootKeyHex, newChainKeyHex, "Root key and chain key must differ");
      assert.equal(newRootKeyHex.length, 64);
      assert.equal(newChainKeyHex.length, 64);
    });

    it("B3: different root keys produce different outputs for same DH input", async () => {
      const rk1 = await generateTestRootKey();
      const rk2 = await generateTestRootKey();
      const dhOutput = new Uint8Array(32).fill(0xef);

      const result1 = await kdfRootKey(rk1, dhOutput);
      const result2 = await kdfRootKey(rk2, dhOutput);

      assert.notEqual(result1.newRootKeyHex, result2.newRootKeyHex);
      assert.notEqual(result1.newChainKeyHex, result2.newChainKeyHex);
    });

    it("B4: different DH outputs produce different KDF_RK results", async () => {
      const rk = await generateTestRootKey();
      const dh1 = new Uint8Array(32).fill(0x11);
      const dh2 = new Uint8Array(32).fill(0x22);

      const result1 = await kdfRootKey(rk, dh1);
      const result2 = await kdfRootKey(rk, dh2);

      assert.notEqual(result1.newRootKeyHex, result2.newRootKeyHex);
      assert.notEqual(result1.newChainKeyHex, result2.newChainKeyHex);
    });

    it("B5: kdfRootKey rejects invalid root key size", async () => {
      await assert.rejects(
        () => kdfRootKey("tooshort", new Uint8Array(32)),
        (e) => e instanceof CryptographicError
      );
      await assert.rejects(
        () => kdfRootKey("a".repeat(64), new Uint8Array(16)),
        (e) => e instanceof CryptographicError
      );
    });
  });

  // =========================================================================
  // Group C — KDF_CK Chain Advancement & Message Key Uniqueness
  // =========================================================================
  describe("Group C: KDF_CK Chain Advancement & Message Key Uniqueness", () => {
    it("C1: kdfChainKey produces deterministic new_CK and message_key", async () => {
      const ck = await generateTestRootKey();
      const r1 = await kdfChainKey(ck);
      const r2 = await kdfChainKey(ck);

      assert.equal(r1.newChainKeyHex, r2.newChainKeyHex, "KDF_CK must be deterministic");
      assert.equal(r1.messageKeyHex, r2.messageKeyHex);
    });

    it("C2: kdfChainKey produces different chain key and message key (domain separation)", async () => {
      const ck = await generateTestRootKey();
      const { newChainKeyHex, messageKeyHex } = await kdfChainKey(ck);

      assert.notEqual(newChainKeyHex, messageKeyHex, "Chain key and message key must differ");
      assert.equal(newChainKeyHex.length, 64);
      assert.equal(messageKeyHex.length, 64);
    });

    it("C3: successive KDF_CK steps produce unique message keys (forward secrecy)", async () => {
      let ck = await generateTestRootKey();
      const messageKeys = new Set();

      for (let i = 0; i < 10; i++) {
        const { newChainKeyHex, messageKeyHex } = await kdfChainKey(ck);
        assert(!messageKeys.has(messageKeyHex), `Message key at step ${i} must be unique`);
        messageKeys.add(messageKeyHex);
        ck = newChainKeyHex;
      }

      assert.equal(messageKeys.size, 10, "All 10 message keys must be distinct");
    });

    it("C4: kdfChainKey rejects invalid chain key", async () => {
      await assert.rejects(
        () => kdfChainKey("tooshort"),
        (e) => e instanceof CryptographicError
      );
      await assert.rejects(
        () => kdfChainKey(null),
        (e) => e instanceof CryptographicError
      );
    });

    it("C5: chain key after KDF_CK differs from the input chain key", async () => {
      const ck = await generateTestRootKey();
      const { newChainKeyHex } = await kdfChainKey(ck);
      assert.notEqual(newChainKeyHex, ck, "Chain key must advance forward");
    });
  });

  // =========================================================================
  // Group D — Bidirectional Message Exchange
  // =========================================================================
  describe("Group D: Bidirectional Message Exchange", () => {
    it("D1: Alice→Bob single message produces matching message key", async () => {
      const { alice, bob } = await buildSymmetricSession();

      // Alice encrypts one message
      const { messageKeyHex: aliceKey, header } = await ratchetEncrypt(alice);

      // Bob decrypts — should trigger DH ratchet + receive chain
      const bobKey = await ratchetDecrypt(bob, header);

      assert.equal(aliceKey, bobKey, "Alice and Bob must derive identical message key");
    });

    it("D2: Alice→Bob multiple sequential messages produce unique matching keys", async () => {
      const { alice, bob } = await buildSymmetricSession();
      const N = 5;
      const headers = [];
      const aliceKeys = [];

      // Alice encrypts N messages
      for (let i = 0; i < N; i++) {
        const { messageKeyHex, header } = await ratchetEncrypt(alice);
        aliceKeys.push(messageKeyHex);
        headers.push(header);
      }

      // Bob decrypts in order
      for (let i = 0; i < N; i++) {
        const bobKey = await ratchetDecrypt(bob, headers[i]);
        assert.equal(bobKey, aliceKeys[i], `Message ${i}: keys must match`);
      }

      // All message keys must be unique
      const uniqueKeys = new Set(aliceKeys);
      assert.equal(uniqueKeys.size, N, "All message keys must be unique");
    });

    it("D3: Alice→Bob then Bob→Alice (full bidirectional exchange)", async () => {
      const { alice, bob } = await buildSymmetricSession();

      // Alice sends message 0 to Bob
      const { messageKeyHex: aliceKey0, header: h0 } = await ratchetEncrypt(alice);
      const bobKey0 = await ratchetDecrypt(bob, h0);
      assert.equal(aliceKey0, bobKey0, "A→B message 0 must match");

      // Bob replies to Alice (triggers Bob's first DH ratchet step)
      const { messageKeyHex: bobKey1, header: h1 } = await ratchetEncrypt(bob);
      const aliceKey1 = await ratchetDecrypt(alice, h1);
      assert.equal(bobKey1, aliceKey1, "B→A reply must match");

      // Alice sends another message (triggers Alice's new DH ratchet step)
      const { messageKeyHex: aliceKey2, header: h2 } = await ratchetEncrypt(alice);
      const bobKey2 = await ratchetDecrypt(bob, h2);
      assert.equal(aliceKey2, bobKey2, "A→B message 2 must match");

      // All three message keys must be distinct
      const allKeys = [aliceKey0, bobKey1, aliceKey2];
      assert.equal(new Set(allKeys).size, 3, "All message keys across both directions must be unique");
    });

    it("D4: ratchetEncrypt advances send counter Ns", async () => {
      const { alice } = await buildSymmetricSession();

      assert.equal(alice.Ns, 0);
      await ratchetEncrypt(alice);
      assert.equal(alice.Ns, 1);
      await ratchetEncrypt(alice);
      assert.equal(alice.Ns, 2);
    });

    it("D5: ratchetDecrypt advances receive counter Nr", async () => {
      const { alice, bob } = await buildSymmetricSession();

      const { header: h0 } = await ratchetEncrypt(alice);
      const { header: h1 } = await ratchetEncrypt(alice);

      await ratchetDecrypt(bob, h0);
      assert.equal(bob.Nr, 1);
      await ratchetDecrypt(bob, h1);
      assert.equal(bob.Nr, 2);
    });

    it("D6: ratchetEncrypt throws when no sending chain is initialized", async () => {
      const rootKeyHex = await generateTestRootKey();
      const bobKp = await generateRatchetKeyPair();
      const bob = initReceiverRatchet({
        rootKeyHex,
        sessionId: "sess_bob",
        ourRatchetKeyPair: bobKp,
      });

      await assert.rejects(
        () => ratchetEncrypt(bob),
        (e) => e instanceof CryptographicError && e.message.includes("sending chain key")
      );
    });

    it("D7: ratchetDecrypt rejects malformed headers", async () => {
      const { bob } = await buildSymmetricSession();

      await assert.rejects(() => ratchetDecrypt(bob, null), (e) => e instanceof CryptographicError);
      await assert.rejects(() => ratchetDecrypt(bob, {}), (e) => e instanceof CryptographicError);
      await assert.rejects(
        () => ratchetDecrypt(bob, { dhRatchetPublicKey: "x", messageNumber: "bad" }),
        (e) => e instanceof CryptographicError
      );
    });
  });

  // =========================================================================
  // Group E — Out-of-Order Message Delivery
  // =========================================================================
  describe("Group E: Out-of-Order Message Delivery", () => {
    it("E1: Bob successfully decrypts messages received out of order", async () => {
      const { alice, bob } = await buildSymmetricSession();

      // Alice encrypts 3 messages in order 0, 1, 2
      const { messageKeyHex: mk0, header: h0 } = await ratchetEncrypt(alice);
      const { messageKeyHex: mk1, header: h1 } = await ratchetEncrypt(alice);
      const { messageKeyHex: mk2, header: h2 } = await ratchetEncrypt(alice);

      // Bob receives them out of order: 2 → 0 → 1
      const bobKey2 = await ratchetDecrypt(bob, h2);
      assert.equal(bobKey2, mk2, "Out-of-order message 2 must match");

      const bobKey0 = await ratchetDecrypt(bob, h0);
      assert.equal(bobKey0, mk0, "Delayed message 0 must match");

      const bobKey1 = await ratchetDecrypt(bob, h1);
      assert.equal(bobKey1, mk1, "Delayed message 1 must match");
    });

    it("E2: skipped keys are cached and then removed after use", async () => {
      const { alice, bob } = await buildSymmetricSession();

      const { header: h0 } = await ratchetEncrypt(alice);
      const { header: h1 } = await ratchetEncrypt(alice);

      // Bob receives message 1 first (skipping message 0)
      await ratchetDecrypt(bob, h1);
      assert.equal(skippedKeyCount(bob), 1, "One skipped key (for msg 0) must be cached");

      // Bob receives the skipped message 0
      await ratchetDecrypt(bob, h0);
      assert.equal(skippedKeyCount(bob), 0, "Skipped key cache must be empty after delivery");
    });

    it("E3: multiple out-of-order messages work across a DH ratchet boundary", async () => {
      const { alice, bob } = await buildSymmetricSession();

      // Alice sends 2 messages
      const { messageKeyHex: mk0, header: h0 } = await ratchetEncrypt(alice);
      const { messageKeyHex: mk1, header: h1 } = await ratchetEncrypt(alice);

      // Bob receives only h1 (skips h0) — triggers DH ratchet
      const bobKey1 = await ratchetDecrypt(bob, h1);
      assert.equal(bobKey1, mk1);

      // Bob then replies (generates new DH ratchet)
      const { header: hb0 } = await ratchetEncrypt(bob);
      const aliceKeyB0 = await ratchetDecrypt(alice, hb0);
      assert.equal(typeof aliceKeyB0, "string", "Alice must decrypt Bob's reply");

      // Bob receives the delayed h0 from Alice
      const bobKey0 = await ratchetDecrypt(bob, h0);
      assert.equal(bobKey0, mk0, "Delayed message 0 must still be decryptable from skip cache");
    });
  });

  // =========================================================================
  // Group F — Skipped-Key Bounds Enforcement
  // =========================================================================
  describe("Group F: Skipped-Key Bounds Enforcement", () => {
    it("F1: ratchetDecrypt rejects a header requesting more than MAX_SKIPPED_MESSAGE_KEYS skips", async () => {
      const { alice, bob } = await buildSymmetricSession();

      // Advance Alice's sending counter to a very high number by sending messages
      // but deliver only the last one to Bob, simulating 1001+ skipped messages.
      // We do this by crafting a header with an impossibly large messageNumber.
      const { header: realHeader } = await ratchetEncrypt(alice);

      // Create a crafted header with a message number far ahead
      const maliciousHeader = {
        ...realHeader,
        messageNumber: 1001,  // Forces 1001 skip operations on a chain at Nr=0
        previousChainLength: 0,
      };

      await assert.rejects(
        () => ratchetDecrypt(bob, maliciousHeader),
        (e) => e instanceof CryptographicError && e.message.includes("MAX_SKIPPED_MESSAGE_KEYS")
      );
    });

    it("F2: ratchetDecrypt allows skipping within the MAX_SKIPPED_MESSAGE_KEYS limit", async () => {
      const { alice, bob } = await buildSymmetricSession();

      // Alice sends 3 messages; Bob receives only the 3rd (skipping 2)
      // Encrypt two messages to advance Alice's chain (headers intentionally discarded)
      await ratchetEncrypt(alice);
      await ratchetEncrypt(alice);
      const { messageKeyHex: mk2, header: h2 } = await ratchetEncrypt(alice);

      const bobKey2 = await ratchetDecrypt(bob, h2);
      assert.equal(bobKey2, mk2, "Message 2 must be decryptable after skipping 0 and 1");
      assert.equal(skippedKeyCount(bob), 2, "2 skipped keys (0 and 1) must be cached");
    });
  });

  // =========================================================================
  // Group G — Forward Secrecy Invariants
  // =========================================================================
  describe("Group G: Forward Secrecy Invariants", () => {
    it("G1: root key changes after each DH ratchet step", async () => {
      const { alice, bob } = await buildSymmetricSession();

      const initialRK = alice.RK;

      // Alice sends a message (DH ratchet already done during initSenderRatchet)
      const { header: h0 } = await ratchetEncrypt(alice);
      await ratchetDecrypt(bob, h0);

      // Bob replies — this triggers Bob's first DH ratchet step
      const { header: hb0 } = await ratchetEncrypt(bob);

      // Alice receives Bob's reply — triggers Alice's DH ratchet step
      const rkBeforeAliceRatchet = alice.RK;
      await ratchetDecrypt(alice, hb0);

      assert.notEqual(alice.RK, rkBeforeAliceRatchet, "RK must change after each DH ratchet step");
      assert.notEqual(alice.RK, initialRK, "Final RK must differ from initial RK");
    });

    it("G2: Alice's sending ratchet keypair changes after a DH ratchet step triggered by Bob reply", async () => {
      const { alice, bob } = await buildSymmetricSession();

      const initialDHsPublicKeyHex = alice.DHs.publicKeyHex;

      // Alice encrypts, Bob decrypts, Bob replies → Alice ratchets
      const { header: h0 } = await ratchetEncrypt(alice);
      await ratchetDecrypt(bob, h0);
      const { header: hb0 } = await ratchetEncrypt(bob);
      await ratchetDecrypt(alice, hb0);

      assert.notEqual(
        alice.DHs.publicKeyHex,
        initialDHsPublicKeyHex,
        "Alice's DH ratchet keypair must rotate after receiving Bob's message"
      );
    });

    it("G3: successive message keys from the same chain are all unique", async () => {
      const { alice, bob } = await buildSymmetricSession();

      const N = 8;
      const aliceKeys = [];
      const headers = [];

      for (let i = 0; i < N; i++) {
        const { messageKeyHex, header } = await ratchetEncrypt(alice);
        aliceKeys.push(messageKeyHex);
        headers.push(header);
      }

      const uniqueKeys = new Set(aliceKeys);
      assert.equal(uniqueKeys.size, N, `All ${N} message keys must be unique`);

      // Verify Bob can decrypt all of them and gets matching keys
      for (let i = 0; i < N; i++) {
        const bobKey = await ratchetDecrypt(bob, headers[i]);
        assert.equal(bobKey, aliceKeys[i], `Message ${i} key must match`);
      }
    });

    it("G4: DH ratchet public keys change every time Bob's reply triggers a new ratchet step", async () => {
      const { alice, bob } = await buildSymmetricSession();

      const dhsHistory = new Set();
      dhsHistory.add(alice.DHs.publicKeyHex);

      // Perform 3 full exchange cycles
      for (let round = 0; round < 3; round++) {
        const { header: ha } = await ratchetEncrypt(alice);
        await ratchetDecrypt(bob, ha);
        const { header: hb } = await ratchetEncrypt(bob);
        await ratchetDecrypt(alice, hb);

        dhsHistory.add(alice.DHs.publicKeyHex);
      }

      // We should have 4 distinct DH public keys (1 initial + 3 rotations)
      assert.equal(dhsHistory.size, 4, "DH ratchet key must rotate every exchange cycle");
    });
  });
});
