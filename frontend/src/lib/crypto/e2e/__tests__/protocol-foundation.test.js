import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  PROTOCOL_VERSION,
  PROTOCOL_IDENTIFIER,
  DH_ALGORITHM,
  SIGNATURE_ALGORITHM,
  AEAD_ALGORITHM,
  X25519_PUBLIC_KEY_SIZE,
  ED25519_PUBLIC_KEY_SIZE,
  ED25519_SIGNATURE_SIZE,
  AES_KEY_SIZE,
  AES_GCM_NONCE_SIZE,
  MAX_SKIPPED_MESSAGE_KEYS,
  ENVELOPE_TYPES,
  DOMAIN_TAGS,
  FORBIDDEN_ENVELOPE_KEYS,
} from "../constants.js";

import {
  assertNoSecretMaterial,
  buildAssociatedData,
  createMessageEnvelope,
  validateEnvelopeStructure,
} from "../envelope.js";

import {
  validatePrekeyBundle,
  isHexOfByteLength,
  buildSignedPrekeySignableBytes,
} from "../types.js";

import { CryptographicError } from "../../errors.js";

describe("TALK Feature 2 — Protocol Foundation & Architectural Contracts (Phase 1)", () => {
  describe("1. Protocol Constants & Invariants", () => {
    it("exports correct protocol versions and cryptographic algorithms", () => {
      assert.equal(PROTOCOL_VERSION, 1);
      assert.equal(PROTOCOL_IDENTIFIER, "TALK-E2EE-V1");
      assert.equal(DH_ALGORITHM, "X25519");
      assert.equal(SIGNATURE_ALGORITHM, "Ed25519");
      assert.equal(AEAD_ALGORITHM, "AES-GCM");
    });

    it("enforces standard 256-bit cryptographic key sizes", () => {
      assert.equal(X25519_PUBLIC_KEY_SIZE, 32);
      assert.equal(ED25519_PUBLIC_KEY_SIZE, 32);
      assert.equal(ED25519_SIGNATURE_SIZE, 64);
      assert.equal(AES_KEY_SIZE, 32);
      assert.equal(AES_GCM_NONCE_SIZE, 12);
      assert.equal(MAX_SKIPPED_MESSAGE_KEYS, 1000);
    });

    it("contains distinct domain separation tags for HKDF operations", () => {
      const tags = Object.values(DOMAIN_TAGS);
      const uniqueTags = new Set(tags);
      assert.equal(tags.length, uniqueTags.size, "All domain tags must be unique");
      assert(DOMAIN_TAGS.X3DH_INFO.startsWith("TALK-X3DH-V1:"));
      assert(DOMAIN_TAGS.RATCHET_ROOT_INFO.startsWith("TALK-DOUBLE-RATCHET-V1:"));
    });
  });

  describe("2. Zero-Secret Leakage Assertion Guard", () => {
    it("passes for objects with public metadata only", () => {
      const safeObject = {
        version: 1,
        sessionId: "sess_123",
        senderDeviceId: "dev_alice",
        ratchetHeader: {
          dhRatchetPublicKey: "a".repeat(64),
          messageNumber: 0,
        },
        ciphertext: "base64ciphertext",
      };

      assert.doesNotThrow(() => assertNoSecretMaterial(safeObject));
    });

    it("strictly rejects objects containing private key material or unratcheted secrets", () => {
      for (const forbiddenKey of FORBIDDEN_ENVELOPE_KEYS) {
        const unsafeObject = {
          sessionId: "sess_123",
          [forbiddenKey]: "super_secret_scalar_bytes",
        };

        assert.throws(
          () => assertNoSecretMaterial(unsafeObject),
          (err) => {
            assert(err instanceof CryptographicError);
            assert(err.message.includes("Security Violation"));
            return true;
          },
          `Expected rejection for forbidden key: ${forbiddenKey}`
        );
      }
    });

    it("recursively detects nested private keys", () => {
      const nestedSecret = {
        header: {
          publicInfo: "ok",
          inner: {
            deep: {
              privateKey: "leaked_secret",
            },
          },
        },
      };

      assert.throws(
        () => assertNoSecretMaterial(nestedSecret),
        (err) => err instanceof CryptographicError
      );
    });
  });

  describe("3. Associated Data Canonical Serialization", () => {
    const validParams = {
      version: 1,
      sessionId: "session_alice_bob_123",
      senderDeviceId: "dev_alice_01",
      recipientDeviceId: "dev_bob_01",
      messageType: ENVELOPE_TYPES.WHISPER_MESSAGE,
      dhRatchetPublicKey: "a".repeat(64),
      messageNumber: 5,
      previousChainLength: 2,
    };

    it("deterministically serializes Associated Data bytes", () => {
      const ad1 = buildAssociatedData(validParams);
      const ad2 = buildAssociatedData(validParams);

      assert(ad1 instanceof Uint8Array);
      assert.deepEqual(ad1, ad2);
    });

    it("produces different AD when any header parameter changes", () => {
      const ad1 = buildAssociatedData(validParams);

      const adModifiedSession = buildAssociatedData({ ...validParams, sessionId: "session_alt" });
      const adModifiedSender = buildAssociatedData({ ...validParams, senderDeviceId: "dev_attacker" });
      const adModifiedMsgNum = buildAssociatedData({ ...validParams, messageNumber: 6 });
      const adModifiedPrevLen = buildAssociatedData({ ...validParams, previousChainLength: 3 });

      assert.notDeepEqual(ad1, adModifiedSession);
      assert.notDeepEqual(ad1, adModifiedSender);
      assert.notDeepEqual(ad1, adModifiedMsgNum);
      assert.notDeepEqual(ad1, adModifiedPrevLen);
    });

    it("rejects invalid ratchet key sizes or invalid numeric counters", () => {
      assert.throws(
        () => buildAssociatedData({ ...validParams, dhRatchetPublicKey: "invalid_short_hex" }),
        (err) => err instanceof CryptographicError
      );

      assert.throws(
        () => buildAssociatedData({ ...validParams, messageNumber: -1 }),
        (err) => err instanceof CryptographicError
      );
    });
  });

  describe("4. Message Envelope Construction & Validation", () => {
    const validEnvelopeParams = {
      version: 1,
      sessionId: "sess_456",
      senderDeviceId: "dev_alice",
      recipientDeviceId: "dev_bob",
      messageType: ENVELOPE_TYPES.WHISPER_MESSAGE,
      ratchetHeader: {
        dhRatchetPublicKey: "b".repeat(64),
        messageNumber: 0,
        previousChainLength: 0,
      },
      ciphertext: "dGVzdF9jaXBoZXJ0ZXh0",
      iv: "1234567890abcdef12345678",
    };

    it("creates a well-formed envelope complying with the schema", () => {
      const env = createMessageEnvelope(validEnvelopeParams);
      assert.equal(env.version, 1);
      assert.equal(env.sessionId, "sess_456");
      assert.equal(env.ciphertext, "dGVzdF9jaXBoZXJ0ZXh0");
      assert(validateEnvelopeStructure(env));
    });

    it("rejects malformed or incomplete envelope objects", () => {
      assert.equal(validateEnvelopeStructure(null), false);
      assert.equal(validateEnvelopeStructure({}), false);
      assert.equal(validateEnvelopeStructure({ ...validEnvelopeParams, version: 2 }), false);
      assert.equal(validateEnvelopeStructure({ ...validEnvelopeParams, ciphertext: "" }), false);
    });

    it("refuses to create envelopes containing secret material", () => {
      assert.throws(
        () =>
          createMessageEnvelope({
            ...validEnvelopeParams,
            rootKey: "secret_root_key",
          }),
        (err) => err instanceof CryptographicError
      );
    });
  });

  describe("5. Prekey Bundle & Signed Prekey Validation", () => {
    it("correctly identifies valid hex byte lengths", () => {
      assert.equal(isHexOfByteLength("a".repeat(64), 32), true);
      assert.equal(isHexOfByteLength("a".repeat(128), 64), true);
      assert.equal(isHexOfByteLength("a".repeat(62), 32), false);
      assert.equal(isHexOfByteLength("not-hex!", 32), false);
    });

    it("validates a full prekey bundle with Signed Prekey and OPK", () => {
      const bundle = {
        deviceId: "dev_bob_01",
        identityKeyDh: "1".repeat(64),
        identityKeySign: "2".repeat(64),
        signedPrekey: {
          keyId: 1,
          publicKey: "3".repeat(64),
          signature: "4".repeat(128),
          createdAt: new Date().toISOString(),
        },
        oneTimePrekey: {
          keyId: 101,
          publicKey: "5".repeat(64),
        },
      };

      assert.equal(validatePrekeyBundle(bundle), true);
    });

    it("rejects prekey bundles missing mandatory signature or keys", () => {
      const invalidBundle = {
        deviceId: "dev_bob_01",
        identityKeyDh: "1".repeat(64),
        // missing identityKeySign
        signedPrekey: {
          keyId: 1,
          publicKey: "3".repeat(64),
          signature: "4".repeat(128),
        },
      };

      assert.equal(validatePrekeyBundle(invalidBundle), false);
    });

    it("builds canonical signable bytes for Signed Prekey", () => {
      const signableBytes = buildSignedPrekeySignableBytes(1, "f".repeat(64));
      assert(signableBytes instanceof Uint8Array);
      assert.equal(
        signableBytes.byteLength,
        DOMAIN_TAGS.SIGNED_PREKEY_SIGNATURE_PREFIX.length + 4 + 32
      );
    });
  });
});
