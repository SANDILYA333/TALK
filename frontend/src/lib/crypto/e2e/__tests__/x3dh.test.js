import test from "node:test";
import assert from "node:assert/strict";

import {
  initiateX3DHSession,
  receiveX3DHSession,
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
import { validateX3DHHeader } from "../types.js";
import { assertNoSecretMaterial } from "../envelope.js";
import { getSubtleCrypto, bytesToHex } from "../../utils.js";


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

test.describe("TALK Feature 2 Phase 3 — X3DH Session Establishment & Master Secret Agreement", () => {
  
  test("1. Full 4-DH X3DH handshake derives identical Master Secret and Root Key between Alice and Bob", async () => {
    // 1. Setup Alice's Identity
    const alice = await createTestIdentity();

    // 2. Setup Bob's Identity & Prekeys
    const bob = await createTestIdentity();
    const bobSigningIdentity = await createTestSigningIdentity();
    const bobSpk = await generateSignedPrekey(bobSigningIdentity.privateKey, 1);
    const bobOpks = await generateOneTimePrekeyBatch(1, 5);

    // Save Bob's keys in his local storage
    await saveSigningIdentityKeyPair(bobSigningIdentity);
    await saveSignedPrekeyRecord(bobSpk);
    await saveOneTimePrekeysPool(bobOpks);

    // 3. Assemble Bob's Public Prekey Bundle (as served by registry)
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

    // 4. Alice executes X3DH Initiation
    const aliceResult = await initiateX3DHSession({
      localIdentityKeyPair: alice,
      localConnectId: alice.connectId,
      peerBundle: bobBundle,
    });

    assert.ok(aliceResult.masterSecretHex, "Alice should have derived a master secret");
    assert.ok(aliceResult.rootKeyHex, "Alice should have derived a root key");
    assert.equal(aliceResult.masterSecretHex.length, 64, "Master secret must be 32 bytes (64 hex chars)");
    assert.equal(aliceResult.rootKeyHex.length, 64, "Root key must be 32 bytes (64 hex chars)");
    assert.equal(aliceResult.isTripleDhFallback, false, "4-DH was executed");

    // Verify Alice's wire header
    assert.ok(validateX3DHHeader(aliceResult.x3dhHeader), "X3DH header must pass validation");
    assert.equal(aliceResult.x3dhHeader.oneTimePrekeyUsed, true);
    assert.equal(aliceResult.x3dhHeader.opkKeyId, bobOpks[0].keyId);
    assert.doesNotThrow(() => assertNoSecretMaterial(aliceResult.x3dhHeader));

    // 5. Bob executes X3DH Reception
    const bobResult = await receiveX3DHSession({
      localIdentityKeyPair: bob,
      localConnectId: bob.connectId,
      localSignedPrekey: bobSpk,
      x3dhHeader: aliceResult.x3dhHeader,
      consumeOpkFn: consumeLocalOneTimePrekey,
    });

    // 6. Symmetrical Secret Verification
    assert.equal(
      bobResult.masterSecretHex,
      aliceResult.masterSecretHex,
      "Bob and Alice must derive 100% identical Master Secrets"
    );
    assert.equal(
      bobResult.rootKeyHex,
      aliceResult.rootKeyHex,
      "Bob and Alice must derive 100% identical Root Keys"
    );

    // 7. Verify Bob deleted the consumed OPK (Single-use invariant)
    const doubleConsume = await consumeLocalOneTimePrekey(bobOpks[0].keyId);
    assert.equal(doubleConsume, null, "Consumed OPK must be permanently erased from local storage");
  });

  test("2. Triple-DH fallback executes successfully when OPK is exhausted (null)", async () => {
    const alice = await createTestIdentity();
    const bob = await createTestIdentity();
    const bobSigningIdentity = await createTestSigningIdentity();
    const bobSpk = await generateSignedPrekey(bobSigningIdentity.privateKey, 1);

    await saveSignedPrekeyRecord(bobSpk);

    // Bob has NO OPK (exhausted)
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

    assert.equal(aliceResult.isTripleDhFallback, true);
    assert.equal(aliceResult.x3dhHeader.oneTimePrekeyUsed, false);
    assert.equal(aliceResult.x3dhHeader.opkKeyId, null);

    const bobResult = await receiveX3DHSession({
      localIdentityKeyPair: bob,
      localConnectId: bob.connectId,
      localSignedPrekey: bobSpk,
      x3dhHeader: aliceResult.x3dhHeader,
      consumeOpkFn: consumeLocalOneTimePrekey,
    });

    assert.equal(bobResult.masterSecretHex, aliceResult.masterSecretHex);
    assert.equal(bobResult.rootKeyHex, aliceResult.rootKeyHex);
  });

  test("3. Alice rejects initiation if Bob's Signed Prekey signature is forged or corrupted", async () => {
    const alice = await createTestIdentity();
    const bob = await createTestIdentity();
    const bobSigningIdentity = await createTestSigningIdentity();
    const bobSpk = await generateSignedPrekey(bobSigningIdentity.privateKey, 1);

    // Corrupt Bob's SPK signature (64 bytes = 128 hex chars)
    const corruptedSignature = "00".repeat(64);

    const tamperedBundle = {
      deviceId: "device_bob_1",
      connectId: bob.connectId,
      identityKeyDh: bob.publicKeyHex,
      identityKeySign: bobSigningIdentity.publicKeyHex,
      signedPrekey: {
        keyId: bobSpk.keyId,
        publicKey: bobSpk.publicKeyHex,
        signature: corruptedSignature,
        createdAt: bobSpk.createdAt,
      },
      oneTimePrekey: null,
    };

    await assert.rejects(
      async () => {
        await initiateX3DHSession({
          localIdentityKeyPair: alice,
          localConnectId: alice.connectId,
          peerBundle: tamperedBundle,
        });
      },
      /signature verification failed/i
    );
  });

  test("4. Bob rejects incoming handshake if Signed Prekey ID does not match local SPK", async () => {
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

    // Mismatched local SPK keyId
    const wrongSpk = { ...bobSpk, keyId: 999 };

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
  });

  test("5. Bob rejects incoming handshake if requested OPK was already consumed or deleted", async () => {
    const alice = await createTestIdentity();
    const bob = await createTestIdentity();
    const bobSigningIdentity = await createTestSigningIdentity();
    const bobSpk = await generateSignedPrekey(bobSigningIdentity.privateKey, 1);
    const bobOpks = await generateOneTimePrekeyBatch(1, 2);

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

    // Bob processes once (succeeds & deletes OPK)
    await receiveX3DHSession({
      localIdentityKeyPair: bob,
      localConnectId: bob.connectId,
      localSignedPrekey: bobSpk,
      x3dhHeader: aliceResult.x3dhHeader,
      consumeOpkFn: consumeLocalOneTimePrekey,
    });

    // An attacker replaying the exact same initial handshake fails because OPK was deleted
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
  });

  test("6. High-level Session Manager coordinates complete session establishment flow", async () => {
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

    // Alice initiates session via Session Manager
    const aliceInit = await establishSessionWithPeer({
      peerConnectId: bob.connectId,
      localIdentityKeyPair: alice,
      localConnectId: alice.connectId,
      fetchBundleFn: mockFetchBundle,
    });

    assert.equal(aliceInit.isNewSession, true);
    assert.ok(aliceInit.session);
    assert.equal(aliceInit.session.peerConnectId, bob.connectId);
    assert.equal(aliceInit.session.handshakeRole, "INITIATOR");

    // Bob processes incoming X3DH handshake
    const bobReceive = await handleIncomingX3DHHandshake({
      x3dhHeader: aliceInit.x3dhHeader,
      localIdentityKeyPair: bob,
      localConnectId: bob.connectId,
      localSignedPrekey: bobSpk,
      consumeOpkFn: consumeLocalOneTimePrekey,
    });

    assert.ok(bobReceive.session);
    assert.equal(bobReceive.session.peerConnectId, alice.connectId);
    assert.equal(bobReceive.session.handshakeRole, "RECEIVER");
    assert.equal(bobReceive.session.rootKeyHex, aliceInit.session.rootKeyHex);
    assert.equal(bobReceive.masterSecretHex, aliceInit.masterSecretHex);

    // Second call for Alice returns existing session without re-running X3DH
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
