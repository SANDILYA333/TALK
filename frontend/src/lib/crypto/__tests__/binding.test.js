import { test, describe } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { Buffer } from "node:buffer";

import {
  generateIdentityKeyPair,
  exportPublicKey,
  generateBindingProof,
} from "../index.js";

// Helper matching backend verification for testing frontend proof generation
function verifyProofNode(serverPrivateKeyObject, clientPublicKeyHex, challengeNonce, proofHex) {
  try {
    const spkiHeader = Buffer.from("302a300506032b656e032100", "hex");
    const clientSpki = Buffer.concat([spkiHeader, Buffer.from(clientPublicKeyHex, "hex")]);
    const clientKeyObject = crypto.createPublicKey({
      key: clientSpki,
      format: "der",
      type: "spki",
    });

    const sharedSecret = crypto.diffieHellman({
      privateKey: serverPrivateKeyObject,
      publicKey: clientKeyObject,
    });

    const domain = "TALK-IDENTITY-BINDING-V1:";
    const domainBuf = Buffer.from(domain, "utf-8");
    const nonceBuf = Buffer.from(challengeNonce, "hex");
    const clientKeyBuf = Buffer.from(clientPublicKeyHex, "hex");
    const message = Buffer.concat([domainBuf, nonceBuf, clientKeyBuf]);

    const hmac = crypto.createHmac("sha256", sharedSecret);
    hmac.update(message);
    const expectedProofHex = hmac.digest("hex");

    return crypto.timingSafeEqual(
      Buffer.from(proofHex, "hex"),
      Buffer.from(expectedProofHex, "hex")
    );
  } catch {
    return false;
  }
}

describe("TALK Cryptographic Account-Device Identity Binding (Phase 5)", () => {
  test("generates a valid proof-of-possession verifiable by server with shared secret", async () => {
    // 1. Client generates persistent identity keypair
    const clientKeyPair = await generateIdentityKeyPair();
    const exportedClient = await exportPublicKey(clientKeyPair.publicKey);

    // 2. Server generates ephemeral X25519 keypair and nonce
    const { publicKey: serverPub, privateKey: serverPriv } = crypto.generateKeyPairSync("x25519");
    const serverEphemeralPublicKeyHex = serverPub
      .export({ type: "spki", format: "der" })
      .subarray(-32)
      .toString("hex");
    const challengeNonce = crypto.randomBytes(32).toString("hex");

    // 3. Client generates proof using clientPrivateKey
    const proofHex = await generateBindingProof({
      clientPrivateKey: clientKeyPair.privateKey,
      serverEphemeralPublicKeyHex,
      challengeNonce,
      clientPublicKeyHex: exportedClient.hex,
    });

    assert.equal(typeof proofHex, "string");
    assert.equal(proofHex.length, 64, "HMAC-SHA256 hex proof must be 64 characters (32 bytes)");

    // 4. Verify on server side
    const isValid = verifyProofNode(
      serverPriv,
      exportedClient.hex,
      challengeNonce,
      proofHex
    );

    assert.equal(isValid, true, "Valid proof must be verified successfully by server");
  });

  test("rejects proof if challenge nonce was modified (replay / tampering protection)", async () => {
    const clientKeyPair = await generateIdentityKeyPair();
    const exportedClient = await exportPublicKey(clientKeyPair.publicKey);

    const { publicKey: serverPub, privateKey: serverPriv } = crypto.generateKeyPairSync("x25519");
    const serverEphemeralPublicKeyHex = serverPub
      .export({ type: "spki", format: "der" })
      .subarray(-32)
      .toString("hex");
    const challengeNonce = crypto.randomBytes(32).toString("hex");

    const proofHex = await generateBindingProof({
      clientPrivateKey: clientKeyPair.privateKey,
      serverEphemeralPublicKeyHex,
      challengeNonce,
      clientPublicKeyHex: exportedClient.hex,
    });

    const tamperedNonce = crypto.randomBytes(32).toString("hex");

    const isValid = verifyProofNode(
      serverPriv,
      exportedClient.hex,
      tamperedNonce,
      proofHex
    );
    assert.equal(isValid, false, "Modified nonce must return false");
  });

  test("rejects proof if generated with wrong private key (impersonation protection)", async () => {
    const legitKeyPair = await generateIdentityKeyPair();
    const exportedLegit = await exportPublicKey(legitKeyPair.publicKey);

    const attackerKeyPair = await generateIdentityKeyPair();

    const { publicKey: serverPub, privateKey: serverPriv } = crypto.generateKeyPairSync("x25519");
    const serverEphemeralPublicKeyHex = serverPub
      .export({ type: "spki", format: "der" })
      .subarray(-32)
      .toString("hex");
    const challengeNonce = crypto.randomBytes(32).toString("hex");

    // Attacker tries to prove ownership of legit public key using attacker's private key
    const forgedProofHex = await generateBindingProof({
      clientPrivateKey: attackerKeyPair.privateKey,
      serverEphemeralPublicKeyHex,
      challengeNonce,
      clientPublicKeyHex: exportedLegit.hex,
    });

    const isValid = verifyProofNode(
      serverPriv,
      exportedLegit.hex,
      challengeNonce,
      forgedProofHex
    );
    assert.equal(isValid, false, "Forged proof using incorrect private key must return false");
  });

  test("rejects proof if server ephemeral public key is altered", async () => {
    const clientKeyPair = await generateIdentityKeyPair();
    const exportedClient = await exportPublicKey(clientKeyPair.publicKey);

    const { publicKey: serverPub } = crypto.generateKeyPairSync("x25519");
    const serverEphemeralPublicKeyHex = serverPub
      .export({ type: "spki", format: "der" })
      .subarray(-32)
      .toString("hex");
    const challengeNonce = crypto.randomBytes(32).toString("hex");

    const proofHex = await generateBindingProof({
      clientPrivateKey: clientKeyPair.privateKey,
      serverEphemeralPublicKeyHex,
      challengeNonce,
      clientPublicKeyHex: exportedClient.hex,
    });

    // Another server ECDH key
    const { privateKey: otherServerPriv } = crypto.generateKeyPairSync("x25519");

    const isValid = verifyProofNode(
      otherServerPriv,
      exportedClient.hex,
      challengeNonce,
      proofHex
    );
    assert.equal(isValid, false, "Verification with different server private key must return false");
  });
});
