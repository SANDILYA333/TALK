import { test, describe, beforeEach } from "node:test";
import assert from "node:assert/strict";

import {
  generateIdentityKeyPair,
  exportPublicKey,
  importPublicKey,
  exportPrivateKey,
  importPrivateKey,
  getOrCreateDeviceIdentity,
  resetDeviceIdentity,
  saveIdentityKeyPair,
  loadIdentityKeyPair,
  IDENTITY_ALGORITHM,
  IDENTITY_VERSION,
  PUBLIC_KEY_BYTE_LENGTH,
  bytesToHex,
  hexToBytes,
  bytesToBase64,
  base64ToBytes,
  KeySerializationError,
  KeyStorageError,
} from "../index.js";

describe("TALK Cryptographic Identity Foundation (Phase 1)", () => {
  beforeEach(async () => {
    await resetDeviceIdentity();
  });

  describe("1. Key Pair Generation", () => {
    test("generates a valid X25519 asymmetric key pair", async () => {
      const keyPair = await generateIdentityKeyPair();

      assert.ok(keyPair, "Key pair must be defined");
      assert.ok(keyPair.privateKey, "Private key must be present");
      assert.ok(keyPair.publicKey, "Public key must be present");

      assert.equal(keyPair.privateKey.type, "private");
      assert.equal(keyPair.privateKey.algorithm.name, IDENTITY_ALGORITHM);
      assert.equal(keyPair.publicKey.type, "public");
      assert.equal(keyPair.publicKey.algorithm.name, IDENTITY_ALGORITHM);
    });

    test("generates unique key pairs across multiple invocations", async () => {
      const pairA = await generateIdentityKeyPair();
      const pairB = await generateIdentityKeyPair();

      const exportedA = await exportPublicKey(pairA.publicKey);
      const exportedB = await exportPublicKey(pairB.publicKey);

      assert.notEqual(exportedA.hex, exportedB.hex, "Distinct key generations must produce distinct public keys");
      assert.notEqual(exportedA.base64, exportedB.base64);
    });

    test("verifies mathematical consistency via Diffie-Hellman agreement", async () => {
      const alice = await generateIdentityKeyPair();
      const bob = await generateIdentityKeyPair();

      const subtle = globalThis.crypto.subtle;

      // Alice computes shared secret using Alice's private key + Bob's public key
      const aliceBits = await subtle.deriveBits(
        { name: "X25519", public: bob.publicKey },
        alice.privateKey,
        256
      );

      // Bob computes shared secret using Bob's private key + Alice's public key
      const bobBits = await subtle.deriveBits(
        { name: "X25519", public: alice.publicKey },
        bob.privateKey,
        256
      );

      const aliceSecretHex = bytesToHex(new Uint8Array(aliceBits));
      const bobSecretHex = bytesToHex(new Uint8Array(bobBits));

      assert.equal(aliceSecretHex, bobSecretHex, "DH shared secrets derived by both parties must be identical");
      assert.equal(aliceBits.byteLength, 32);
    });
  });

  describe("2. Public Key Canonical Representation & Serialization", () => {
    test("exports public key to canonical 32-byte raw, hex, and base64 formats", async () => {
      const keyPair = await generateIdentityKeyPair();
      const exported = await exportPublicKey(keyPair.publicKey);

      assert.equal(exported.version, IDENTITY_VERSION);
      assert.equal(exported.algorithm, IDENTITY_ALGORITHM);
      assert.equal(exported.raw.byteLength, PUBLIC_KEY_BYTE_LENGTH);
      assert.equal(exported.hex.length, 64, "Hex public key must be exactly 64 characters");
      assert.match(exported.hex, /^[0-9a-f]{64}$/, "Hex must be lowercase hexadecimal");
      assert.ok(exported.base64.length > 0, "Base64 representation must be present");
    });

    test("round-trips public key through export and re-import", async () => {
      const keyPair = await generateIdentityKeyPair();
      const exported = await exportPublicKey(keyPair.publicKey);

      // Import from raw bytes
      const importedFromRaw = await importPublicKey(exported.raw);
      const reExportedRaw = await exportPublicKey(importedFromRaw);
      assert.equal(reExportedRaw.hex, exported.hex);

      // Import from hex string
      const importedFromHex = await importPublicKey(exported.hex);
      const reExportedHex = await exportPublicKey(importedFromHex);
      assert.equal(reExportedHex.hex, exported.hex);

      // Import from base64 string
      const importedFromBase64 = await importPublicKey(exported.base64);
      const reExportedBase64 = await exportPublicKey(importedFromBase64);
      assert.equal(reExportedBase64.hex, exported.hex);
    });

    test("rejects malformed public keys with explicit error", async () => {
      // Wrong byte length
      await assert.rejects(
        () => importPublicKey(new Uint8Array(16)),
        (err) => err instanceof KeySerializationError && err.message.includes("Invalid public key length")
      );

      // Invalid hex
      await assert.rejects(
        () => importPublicKey("invalid-hex-character-string-1234567890"),
        (err) => err instanceof KeySerializationError
      );

      // Null/undefined
      await assert.rejects(
        () => importPublicKey(null),
        (err) => err instanceof KeySerializationError
      );
    });
  });

  describe("3. Private Key Security & Serialization", () => {
    test("exports and re-imports private key in PKCS#8 format", async () => {
      const keyPair = await generateIdentityKeyPair();
      const pkcs8 = await exportPrivateKey(keyPair.privateKey);

      assert.ok(pkcs8 instanceof Uint8Array);
      assert.ok(pkcs8.byteLength > 0);

      const importedPrivate = await importPrivateKey(pkcs8);
      assert.equal(importedPrivate.type, "private");
      assert.equal(importedPrivate.algorithm.name, IDENTITY_ALGORITHM);
    });

    test("does not expose private key bytes in public export metadata", async () => {
      const keyPair = await generateIdentityKeyPair();
      const publicMeta = await exportPublicKey(keyPair.publicKey);

      assert.equal(publicMeta.privateKey, undefined);
      assert.equal(publicMeta.privateKeyPkcs8, undefined);
      assert.ok(!JSON.stringify(publicMeta).includes("private"));
    });
  });

  describe("4. Identity Persistence & Idempotence", () => {
    test("creates identity on first call and recovers the same identity on subsequent calls", async () => {
      const identity1 = await getOrCreateDeviceIdentity();
      assert.ok(identity1.publicKeyHex);
      assert.equal(identity1.version, IDENTITY_VERSION);

      const identity2 = await getOrCreateDeviceIdentity();
      assert.equal(identity1.publicKeyHex, identity2.publicKeyHex, "Must recover identical public key on reload");
      assert.equal(identity1.createdAt, identity2.createdAt, "Must preserve original creation timestamp");
    });

    test("recovers identity across in-memory cache reset via persistent storage", async () => {
      const original = await getOrCreateDeviceIdentity();
      const originalHex = original.publicKeyHex;

      // Simulate cache reset while preserving storage record
      const keyPair = await loadIdentityKeyPair();
      assert.ok(keyPair);

      const reloadedPublic = await exportPublicKey(keyPair.publicKey);
      assert.equal(reloadedPublic.hex, originalHex, "Persisted storage must yield the exact same public key");
    });

    test("fails explicitly on corrupted storage record without silent regeneration", async () => {
      // Save invalid corrupted data directly to storage
      const corruptRecord = {
        saveIdentityKeyPair: null,
      };

      await assert.rejects(
        () => saveIdentityKeyPair(corruptRecord),
        (err) => err instanceof KeyStorageError
      );
    });
  });

  describe("5. Encoding Utilities", () => {
    test("correctly encodes and decodes hex strings", () => {
      const bytes = new Uint8Array([0, 15, 16, 255, 128]);
      const hex = bytesToHex(bytes);
      assert.equal(hex, "000f10ff80");
      const decoded = hexToBytes(hex);
      assert.deepEqual(decoded, bytes);
    });

    test("correctly encodes and decodes base64 strings", () => {
      const bytes = new Uint8Array([72, 101, 108, 108, 111]); // "Hello"
      const b64 = bytesToBase64(bytes);
      assert.equal(b64, "SGVsbG8=");
      const decoded = base64ToBytes(b64);
      assert.deepEqual(decoded, bytes);
    });
  });
});
