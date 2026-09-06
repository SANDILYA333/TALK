import { test, describe, beforeEach } from "node:test";
import assert from "node:assert/strict";

import {
  generateIdentityKeyPair,
  exportPublicKey,
  deriveConnectId,
  isValidConnectId,
  normalizeConnectId,
  parseConnectId,
  getOrCreateDeviceIdentity,
  resetDeviceIdentity,
  CONNECT_ID_PREFIX,
  CONNECT_ID_REGEX,
  InvalidConnectIdError,
  KeySerializationError,
} from "../index.js";

describe("TALK Connect ID Derivation & Validation (Phase 2)", () => {
  beforeEach(async () => {
    await resetDeviceIdentity();
  });

  describe("1. Determinism", () => {
    test("same public key always produces identical Connect ID across repeated calls", async () => {
      const keyPair = await generateIdentityKeyPair();
      const exported = await exportPublicKey(keyPair.publicKey);

      const id1 = await deriveConnectId(keyPair.publicKey);
      const id2 = await deriveConnectId(keyPair.publicKey);
      const id3 = await deriveConnectId(exported.raw);
      const id4 = await deriveConnectId(exported.hex);
      const id5 = await deriveConnectId(exported.base64);

      assert.equal(id1, id2, "Repeated derivations from CryptoKey must be identical");
      assert.equal(id1, id3, "Derivation from raw bytes must match CryptoKey derivation");
      assert.equal(id1, id4, "Derivation from hex string must match CryptoKey derivation");
      assert.equal(id1, id5, "Derivation from base64 string must match CryptoKey derivation");
    });
  });

  describe("2. Uniqueness", () => {
    test("distinct public keys produce distinct Connect IDs", async () => {
      const pair1 = await generateIdentityKeyPair();
      const pair2 = await generateIdentityKeyPair();
      const pair3 = await generateIdentityKeyPair();

      const id1 = await deriveConnectId(pair1.publicKey);
      const id2 = await deriveConnectId(pair2.publicKey);
      const id3 = await deriveConnectId(pair3.publicKey);

      assert.notEqual(id1, id2, "Distinct identities must produce distinct Connect IDs");
      assert.notEqual(id1, id3);
      assert.notEqual(id2, id3);
    });
  });

  describe("3. Canonicalization Across Input Formats", () => {
    test("produces the exact same Connect ID regardless of public key input format", async () => {
      const keyPair = await generateIdentityKeyPair();
      const exported = await exportPublicKey(keyPair.publicKey);

      const idFromCryptoKey = await deriveConnectId(keyPair.publicKey);
      const idFromRawUint8Array = await deriveConnectId(exported.raw);
      const idFromArrayBuffer = await deriveConnectId(exported.raw.buffer);
      const idFromHex = await deriveConnectId(exported.hex);
      const idFromBase64 = await deriveConnectId(exported.base64);

      assert.equal(idFromCryptoKey, idFromRawUint8Array);
      assert.equal(idFromCryptoKey, idFromArrayBuffer);
      assert.equal(idFromCryptoKey, idFromHex);
      assert.equal(idFromCryptoKey, idFromBase64);
    });
  });

  describe("4. Format & Character Set Verification", () => {
    test("conforms strictly to TALK-XXXX-XXXX format and Crockford Base32 alphabet", async () => {
      const keyPair = await generateIdentityKeyPair();
      const connectId = await deriveConnectId(keyPair.publicKey);

      assert.ok(isValidConnectId(connectId), `Generated Connect ID "${connectId}" must pass isValidConnectId`);
      assert.match(connectId, CONNECT_ID_REGEX);
      assert.equal(connectId.length, 14, "Format 'TALK-XXXX-XXXX' must be exactly 14 characters");
      assert.ok(connectId.startsWith(`${CONNECT_ID_PREFIX}-`));

      // Crockford alphabet excludes I, L, O, U
      const codeOnly = connectId.replace("TALK-", "").replace("-", "");
      assert.equal(codeOnly.length, 8);
      assert.ok(!/[ILOUilou]/.test(codeOnly), "Crockford Base32 code must not contain I, L, O, or U");
    });
  });

  describe("5. Rejection of Invalid Inputs", () => {
    test("rejects null, undefined, or empty inputs", async () => {
      await assert.rejects(
        () => deriveConnectId(null),
        (err) => err instanceof InvalidConnectIdError
      );

      await assert.rejects(
        () => deriveConnectId(undefined),
        (err) => err instanceof InvalidConnectIdError
      );

      await assert.rejects(
        () => deriveConnectId(""),
        (err) => err instanceof InvalidConnectIdError
      );
    });

    test("rejects wrong-length raw byte arrays", async () => {
      // 16 bytes instead of 32
      await assert.rejects(
        () => deriveConnectId(new Uint8Array(16)),
        (err) => err instanceof InvalidConnectIdError
      );

      // 64 bytes instead of 32
      await assert.rejects(
        () => deriveConnectId(new Uint8Array(64)),
        (err) => err instanceof InvalidConnectIdError
      );
    });

    test("rejects invalid hex or base64 strings", async () => {
      // Invalid hex character 'Z'
      await assert.rejects(
        () => deriveConnectId("Z".repeat(64)),
        (err) => err instanceof InvalidConnectIdError || err instanceof KeySerializationError
      );

      // Invalid length
      await assert.rejects(
        () => deriveConnectId("abcd1234"),
        (err) => err instanceof InvalidConnectIdError || err instanceof KeySerializationError
      );
    });

    test("rejects private key passed as public key", async () => {
      const keyPair = await generateIdentityKeyPair();
      await assert.rejects(
        () => deriveConnectId(keyPair.privateKey),
        (err) => err instanceof InvalidConnectIdError || err instanceof KeySerializationError
      );
    });
  });

  describe("6. PII & Private Key Independence", () => {
    test("derives Connect ID purely from public key without accessing private key", async () => {
      const keyPair = await generateIdentityKeyPair();
      const publicOnly = await exportPublicKey(keyPair.publicKey);

      // Pass only raw public key without private key reference
      const connectId = await deriveConnectId(publicOnly.raw);
      assert.ok(isValidConnectId(connectId));
      assert.ok(!connectId.includes("private"));
    });
  });

  describe("7. Normalization & Parsing", () => {
    test("normalizes user input with lowercase, missing hyphens, or spaces", () => {
      const canonical = "TALK-8F2K-91XZ";

      // Lowercase with hyphens
      assert.equal(normalizeConnectId("talk-8f2k-91xz"), canonical);

      // No hyphens
      assert.equal(normalizeConnectId("TALK8F2K91XZ"), canonical);

      // No prefix and lowercase
      assert.equal(normalizeConnectId("8f2k91xz"), canonical);

      // Extra spaces
      assert.equal(normalizeConnectId("  talk - 8f2k - 91xz  "), canonical);
    });

    test("normalizes ambiguous characters (I, L -> 1; O -> 0)", () => {
      // 'O' -> '0', 'I' -> '1', 'L' -> '1'
      const input = "talk-of2k-l1xz";
      const normalized = normalizeConnectId(input);
      assert.equal(normalized, "TALK-0F2K-11XZ");
    });

    test("parses canonical Connect ID into components", () => {
      const parsed = parseConnectId("TALK-8F2K-91XZ");
      assert.equal(parsed.prefix, "TALK");
      assert.equal(parsed.code, "8F2K-91XZ");
      assert.equal(parsed.rawCode, "8F2K91XZ");
      assert.equal(parsed.version, 1);
    });

    test("rejects invalid characters during normalization", () => {
      // 'U' is disallowed in Crockford Base32
      assert.throws(
        () => normalizeConnectId("TALK-8U2K-91XZ"),
        (err) => err instanceof InvalidConnectIdError
      );

      // Invalid length
      assert.throws(
        () => normalizeConnectId("TALK-123"),
        (err) => err instanceof InvalidConnectIdError
      );
    });
  });

  describe("8. High-Level Identity Integration", () => {
    test("getOrCreateDeviceIdentity includes derived connectId", async () => {
      const identity = await getOrCreateDeviceIdentity();

      assert.ok(identity.connectId, "Identity object must include connectId");
      assert.ok(isValidConnectId(identity.connectId));
      assert.match(identity.connectId, CONNECT_ID_REGEX);

      // Reloading identity preserves the same connectId
      const reloaded = await getOrCreateDeviceIdentity();
      assert.equal(identity.connectId, reloaded.connectId);
      assert.equal(identity.publicKeyHex, reloaded.publicKeyHex);
    });
  });
});
