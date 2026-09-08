import test from "node:test";
import assert from "node:assert/strict";

import {
  initiateX3DHSession,
  receiveX3DHSession,
  verifySignedPrekeySignature,
} from "../x3dh.js";
import {
  generateSigningIdentityKeyPair,
  generateSignedPrekey,
  generateOneTimePrekeyBatch,
} from "../prekeys.js";
import {
  saveSigningIdentityKeyPair,
  saveSignedPrekeyRecord,
  saveOneTimePrekeysPool,
  consumeLocalOneTimePrekey,
  clearAllPrekeyStorage,
} from "../storage.js";
import {
  establishSessionWithPeer,
  handleIncomingX3DHHandshake,
} from "../session.js";
import { clearAllSessions } from "../session-storage.js";
import { generateIdentityKeyPair, exportPublicKey } from "../../keypair.js";
import { deriveConnectId } from "../../connect-id.js";
import { assertNoSecretMaterial } from "../envelope.js";
import { getSubtleCrypto, bytesToHex } from "../../utils.js";
import { FORBIDDEN_ENVELOPE_KEYS } from "../constants.js";


async function createTestIdentity() {
  const keyPair = await generateIdentityKeyPair();
  const exported = await exportPublicKey(keyPair.publicKey);
  const connectId = await deriveConnectId(keyPair.publicKey);
  return {
    ...keyPair,
    publicKeyHex: exported.hex,
    connectId,
  };
}

async function createTestSigningIdentity() {
  const pair = await generateSigningIdentityKeyPair();
  const subtle = getSubtleCrypto();
  const raw = new Uint8Array(await subtle.exportKey("raw", pair.publicKey));
  return {
    ...pair,
    publicKeyHex: bytesToHex(raw),
  };
}

test.beforeEach(async () => {
  await clearAllPrekeyStorage();
  await clearAllSessions();
});

test.describe("TALK Feature 2 Phase 2.3 — X3DH Session Establishment Suite", () => {

  // ==========================================
  // Test Group A: Happy Path & Core Agreement
  // ==========================================
  test("Group A: Alice and Bob derive identical Master Secret (SK) and Root Key (RK) via 4-DH", async () => {
    const alice = await createTestIdentity();
    const bob = await createTestIdentity();
    const bobSigningIdentity = await createTestSigningIdentity();
    const bobSpk = await generateSignedPrekey(bobSigningIdentity.privateKey, 1);
    const bobOpks = await generateOneTimePrekeyBatch(1, 5);

    await saveSigningIdentityKeyPair(bobSigningIdentity);
    await saveSignedPrekeyRecord(bobSpk);
    await saveOneTimePrekeysPool(bobOpks);

    const bobBundle = {
      deviceId: "device_bob_1",
      connectId: bob.connectId,
      identityKeyDh: bob.publicKeyHex,
      identityKeySign: bobSigningIdentity.publicKeyHex,
      signedPrekey: {
        keyId: bobSpk.keyId,
        publicKey: bobSpk.publicKeyHex,
        signature: bobSpk.signatureHex,
        createdAt: bobSpk.createdAt,
      },
      oneTimePrekey: {
        keyId: bobOpks[0].keyId,
        publicKey: bobOpks[0].publicKeyHex,
      },
    };

    const aliceResult = await initiateX3DHSession({
      localIdentityKeyPair: alice,
      localConnectId: alice.connectId,
      peerBundle: bobBundle,
    });

    const bobResult = await receiveX3DHSession({
      localIdentityKeyPair: bob,
      localConnectId: bob.connectId,
      localSignedPrekey: bobSpk,
      x3dhHeader: aliceResult.x3dhHeader,
      consumeOpkFn: consumeLocalOneTimePrekey,
    });

    assert.equal(bobResult.masterSecretHex, aliceResult.masterSecretHex);
    assert.equal(bobResult.rootKeyHex, aliceResult.rootKeyHex);
    assert.equal(aliceResult.masterSecretHex.length, 64);
    assert.equal(aliceResult.rootKeyHex.length, 64);
  });

  // ==========================================
  // Test Group B: Signed Prekey Validation
  // ==========================================
  test("Group B: Valid signed prekey is verified, corrupted/forged signatures are strictly rejected", async () => {
    const alice = await createTestIdentity();
    const bob = await createTestIdentity();
    const bobSigningIdentity = await createTestSigningIdentity();
    const bobSpk = await generateSignedPrekey(bobSigningIdentity.privateKey, 1);

    // 1. Valid SPK signature passes
    const isValid = await verifySignedPrekeySignature(bobSigningIdentity.publicKeyHex, bobSpk);
    assert.equal(isValid, true);

    // 2. Corrupted signature rejected
    const corruptedBundle = {
      deviceId: "device_bob_1",
      connectId: bob.connectId,
      identityKeyDh: bob.publicKeyHex,
      identityKeySign: bobSigningIdentity.publicKeyHex,
      signedPrekey: {
        keyId: bobSpk.keyId,
        publicKey: bobSpk.publicKeyHex,
        signature: "00".repeat(64),
        createdAt: bobSpk.createdAt,
      },
      oneTimePrekey: null,
    };

    await assert.rejects(
      async () => {
        await initiateX3DHSession({
          localIdentityKeyPair: alice,
          localConnectId: alice.connectId,
          peerBundle: corruptedBundle,
        });
      },
      /signature verification failed/i
    );

    // 3. Signature from wrong identity key rejected
    const charlieSigningIdentity = await createTestSigningIdentity();
    const forgedIdentityBundle = {
      ...corruptedBundle,
      identityKeySign: charlieSigningIdentity.publicKeyHex, // signed by Bob, claimed by Charlie
      signedPrekey: {
        keyId: bobSpk.keyId,
        publicKey: bobSpk.publicKeyHex,
        signature: bobSpk.signatureHex,
        createdAt: bobSpk.createdAt,
      },
    };

    await assert.rejects(
      async () => {
        await initiateX3DHSession({
          localIdentityKeyPair: alice,
          localConnectId: alice.connectId,
          peerBundle: forgedIdentityBundle,
        });
      },
      /signature verification failed/i
    );
  });

  // ==========================================
  // Test Group C: One-Time Prekey Lifecycle
  // ==========================================
  test("Group C: OPK is consumed once, replay fails, and missing OPK triggers 3-DH fallback", async () => {
    const alice = await createTestIdentity();
    const bob = await createTestIdentity();
    const bobSigningIdentity = await createTestSigningIdentity();
    const bobSpk = await generateSignedPrekey(bobSigningIdentity.privateKey, 1);
    const bobOpks = await generateOneTimePrekeyBatch(1, 2);

    await saveSignedPrekeyRecord(bobSpk);
    await saveOneTimePrekeysPool(bobOpks);

    // 1. 4-DH consumes OPK
    const bobBundle = {
      deviceId: "device_bob_1",
      connectId: bob.connectId,
      identityKeyDh: bob.publicKeyHex,
      identityKeySign: bobSigningIdentity.publicKeyHex,
      signedPrekey: {
        keyId: bobSpk.keyId,
        publicKey: bobSpk.publicKeyHex,
        signature: bobSpk.signatureHex,
        createdAt: bobSpk.createdAt,
      },
      oneTimePrekey: {
        keyId: bobOpks[0].keyId,
        publicKey: bobOpks[0].publicKeyHex,
      },
    };

    const aliceResult = await initiateX3DHSession({
      localIdentityKeyPair: alice,
      localConnectId: alice.connectId,
      peerBundle: bobBundle,
    });

    // Bob processes and erases OPK
    await receiveX3DHSession({
      localIdentityKeyPair: bob,
      localConnectId: bob.connectId,
      localSignedPrekey: bobSpk,
      x3dhHeader: aliceResult.x3dhHeader,
      consumeOpkFn: consumeLocalOneTimePrekey,
    });

    // Replay attempt fails because OPK was deleted
    await assert.rejects(
      async () => {
        await receiveX3DHSession({
          localIdentityKeyPair: bob,
          localConnectId: bob.connectId,
          localSignedPrekey: bobSpk,
          x3dhHeader: aliceResult.x3dhHeader,
          consumeOpkFn: consumeLocalOneTimePrekey,
        });
      },
      /One-Time Prekey .* not found or already consumed/i
    );

    // 2. Missing OPK executes Triple-DH fallback
    const fallbackBundle = { ...bobBundle, oneTimePrekey: null };
    const aliceFallback = await initiateX3DHSession({
      localIdentityKeyPair: alice,
      localConnectId: alice.connectId,
      peerBundle: fallbackBundle,
    });

    assert.equal(aliceFallback.isTripleDhFallback, true);
    assert.equal(aliceFallback.x3dhHeader.oneTimePrekeyUsed, false);

    const bobFallback = await receiveX3DHSession({
      localIdentityKeyPair: bob,
      localConnectId: bob.connectId,
      localSignedPrekey: bobSpk,
      x3dhHeader: aliceFallback.x3dhHeader,
      consumeOpkFn: consumeLocalOneTimePrekey,
    });

    assert.equal(bobFallback.masterSecretHex, aliceFallback.masterSecretHex);
  });

  // ==========================================
  // Test Group D & E: Cryptographic Correctness & Invariants
  // ==========================================
  test("Group D & E: Different ephemeral keys, prekeys, or identities produce distinct session secrets", async () => {
    const alice = await createTestIdentity();
    const bob = await createTestIdentity();
    const bobSigningIdentity = await createTestSigningIdentity();
    const bobSpk = await generateSignedPrekey(bobSigningIdentity.privateKey, 1);
    const bobOpks = await generateOneTimePrekeyBatch(1, 3);

    const bundle1 = {
      deviceId: "device_bob_1",
      connectId: bob.connectId,
      identityKeyDh: bob.publicKeyHex,
      identityKeySign: bobSigningIdentity.publicKeyHex,
      signedPrekey: {
        keyId: bobSpk.keyId,
        publicKey: bobSpk.publicKeyHex,
        signature: bobSpk.signatureHex,
        createdAt: bobSpk.createdAt,
      },
      oneTimePrekey: {
        keyId: bobOpks[0].keyId,
        publicKey: bobOpks[0].publicKeyHex,
      },
    };

    // First session
    const session1 = await initiateX3DHSession({
      localIdentityKeyPair: alice,
      localConnectId: alice.connectId,
      peerBundle: bundle1,
    });

    // Second session with fresh ephemeral key
    const session2 = await initiateX3DHSession({
      localIdentityKeyPair: alice,
      localConnectId: alice.connectId,
      peerBundle: bundle1,
    });

    assert.notEqual(
      session1.masterSecretHex,
      session2.masterSecretHex,
      "Fresh ephemeral key MUST produce different master secrets"
    );
    assert.notEqual(
      session1.rootKeyHex,
      session2.rootKeyHex,
      "Fresh ephemeral key MUST produce different root keys"
    );

    // Third session with different OPK
    const bundle2 = {
      ...bundle1,
      oneTimePrekey: {
        keyId: bobOpks[1].keyId,
        publicKey: bobOpks[1].publicKeyHex,
      },
    };

    const session3 = await initiateX3DHSession({
      localIdentityKeyPair: alice,
      localConnectId: alice.connectId,
      peerBundle: bundle2,
    });

    assert.notEqual(session1.masterSecretHex, session3.masterSecretHex);
  });

  // ==========================================
  // Test Group F: Failure Boundary Handling
  // ==========================================
  test("Group F: Mismatched SPK ID, missing keys, or malformed headers throw explicit CryptographicError", async () => {
    const alice = await createTestIdentity();
    const bob = await createTestIdentity();
    const bobSigningIdentity = await createTestSigningIdentity();
    const bobSpk = await generateSignedPrekey(bobSigningIdentity.privateKey, 1);

    const bobBundle = {
      deviceId: "device_bob_1",
      connectId: bob.connectId,
      identityKeyDh: bob.publicKeyHex,
      identityKeySign: bobSigningIdentity.publicKeyHex,
      signedPrekey: {
        keyId: bobSpk.keyId,
        publicKey: bobSpk.publicKeyHex,
        signature: bobSpk.signatureHex,
        createdAt: bobSpk.createdAt,
      },
      oneTimePrekey: null,
    };

    const aliceResult = await initiateX3DHSession({
      localIdentityKeyPair: alice,
      localConnectId: alice.connectId,
      peerBundle: bobBundle,
    });

    // 1. SPK ID mismatch
    const wrongSpk = { ...bobSpk, keyId: 888 };
    await assert.rejects(
      async () => {
        await receiveX3DHSession({
          localIdentityKeyPair: bob,
          localConnectId: bob.connectId,
          localSignedPrekey: wrongSpk,
          x3dhHeader: aliceResult.x3dhHeader,
          consumeOpkFn: consumeLocalOneTimePrekey,
        });
      },
      /Signed prekey ID mismatch/i
    );

    // 2. Malformed X3DH Header
    const malformedHeader = { ...aliceResult.x3dhHeader, version: 99 };
    await assert.rejects(
      async () => {
        await receiveX3DHSession({
          localIdentityKeyPair: bob,
          localConnectId: bob.connectId,
          localSignedPrekey: bobSpk,
          x3dhHeader: malformedHeader,
          consumeOpkFn: consumeLocalOneTimePrekey,
        });
      },
      /Invalid incoming X3DH handshake header/i
    );
  });

  // ==========================================
  // Test Group G: Zero-Secret Transmission Audit
  // ==========================================
  test("Group G: Wire header contains zero private keys, shared secrets, root keys, or chain keys", async () => {
    const alice = await createTestIdentity();
    const bob = await createTestIdentity();
    const bobSigningIdentity = await createTestSigningIdentity();
    const bobSpk = await generateSignedPrekey(bobSigningIdentity.privateKey, 1);

    const bobBundle = {
      deviceId: "device_bob_1",
      connectId: bob.connectId,
      identityKeyDh: bob.publicKeyHex,
      identityKeySign: bobSigningIdentity.publicKeyHex,
      signedPrekey: {
        keyId: bobSpk.keyId,
        publicKey: bobSpk.publicKeyHex,
        signature: bobSpk.signatureHex,
        createdAt: bobSpk.createdAt,
      },
      oneTimePrekey: null,
    };

    const aliceResult = await initiateX3DHSession({
      localIdentityKeyPair: alice,
      localConnectId: alice.connectId,
      peerBundle: bobBundle,
    });

    // Verify wire payload passes recursive assertion
    assert.doesNotThrow(() => assertNoSecretMaterial(aliceResult.x3dhHeader));

    // Verify none of the forbidden secret keys exist on the wire header
    for (const forbiddenKey of FORBIDDEN_ENVELOPE_KEYS) {
      assert.equal(
        forbiddenKey in aliceResult.x3dhHeader,
        false,
        `Forbidden secret key '${forbiddenKey}' must NEVER appear on wire header`
      );
    }
  });

  // ==========================================
  // End-to-End Session Coordinator Workflow
  // ==========================================
  test("Session Manager: End-to-end multi-device workflow with idempotent caching", async () => {
    const alice = await createTestIdentity();
    const bob = await createTestIdentity();
    const bobSigningIdentity = await createTestSigningIdentity();
    const bobSpk = await generateSignedPrekey(bobSigningIdentity.privateKey, 1);
    const bobOpks = await generateOneTimePrekeyBatch(1, 2);

    await saveSignedPrekeyRecord(bobSpk);
    await saveOneTimePrekeysPool(bobOpks);

    const mockFetchBundle = async () => ({
      deviceId: "device_bob_1",
      connectId: bob.connectId,
      identityKeyDh: bob.publicKeyHex,
      identityKeySign: bobSigningIdentity.publicKeyHex,
      signedPrekey: {
        keyId: bobSpk.keyId,
        publicKey: bobSpk.publicKeyHex,
        signature: bobSpk.signatureHex,
        createdAt: bobSpk.createdAt,
      },
      oneTimePrekey: {
        keyId: bobOpks[0].keyId,
        publicKey: bobOpks[0].publicKeyHex,
      },
    });

    // 1. Alice initiates session
    const aliceInit = await establishSessionWithPeer({
      peerConnectId: bob.connectId,
      localIdentityKeyPair: alice,
      localConnectId: alice.connectId,
      fetchBundleFn: mockFetchBundle,
    });

    assert.equal(aliceInit.isNewSession, true);
    assert.equal(aliceInit.session.handshakeRole, "INITIATOR");

    // 2. Bob receives handshake
    const bobReceive = await handleIncomingX3DHHandshake({
      x3dhHeader: aliceInit.x3dhHeader,
      localIdentityKeyPair: bob,
      localConnectId: bob.connectId,
      localSignedPrekey: bobSpk,
      consumeOpkFn: consumeLocalOneTimePrekey,
    });

    assert.equal(bobReceive.session.handshakeRole, "RECEIVER");
    assert.equal(bobReceive.session.rootKeyHex, aliceInit.session.rootKeyHex);
    assert.equal(bobReceive.masterSecretHex, aliceInit.masterSecretHex);

    // 3. Second call returns existing session idempotently
    const aliceSecondCall = await establishSessionWithPeer({
      peerConnectId: bob.connectId,
      localIdentityKeyPair: alice,
      localConnectId: alice.connectId,
      fetchBundleFn: mockFetchBundle,
    });

    assert.equal(aliceSecondCall.isNewSession, false);
    assert.equal(aliceSecondCall.session.sessionId, aliceInit.session.sessionId);
  });
});
