import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  deriveConnectId,
  encodeCrockfordBase32,
  canonicalizePublicKey,
  isValidConnectId,
  normalizeConnectId,
  parseConnectId,
  verifyConnectIdBinding,
} from "../connect-id.js";
import {
  CONNECT_ID_PREFIX,
  CONNECT_ID_REGEX,
} from "../constants.js";

describe("Backend Connect ID Derivation & Verification Layer", () => {
  // Test Vector: 32 bytes of 0x01
  const allOnesHex = "0101010101010101010101010101010101010101010101010101010101010101";
  const allOnesBytes = new Uint8Array(32).fill(1);

  describe("Crockford Base32 Encoding", () => {
    it("encodes 5 zero bytes as 0000-0000", () => {
      const zeros = new Uint8Array(5).fill(0);
      assert.equal(encodeCrockfordBase32(zeros), "0000-0000");
    });

    it("encodes 5 0xFF bytes as ZZZZ-ZZZZ", () => {
      const maxBytes = new Uint8Array(5).fill(0xff);
      assert.equal(encodeCrockfordBase32(maxBytes), "ZZZZ-ZZZZ");
    });

    it("rejects byte buffers not equal to 5 bytes", () => {
      assert.throws(() => encodeCrockfordBase32(new Uint8Array(4)), /requires exactly 5 bytes/);
      assert.throws(() => encodeCrockfordBase32(new Uint8Array(6)), /requires exactly 5 bytes/);
    });
  });

  describe("Canonicalize Public Key", () => {
    it("accepts 32-byte Uint8Array and returns canonical lowercase hex", () => {
      const res = canonicalizePublicKey(allOnesBytes);
      assert.equal(res.hex, allOnesHex);
      assert.equal(res.bytes.byteLength, 32);
    });

    it("accepts 64-char hex string (case-insensitive)", () => {
      const res = canonicalizePublicKey(allOnesHex.toUpperCase());
      assert.equal(res.hex, allOnesHex);
      assert.equal(res.bytes.byteLength, 32);
    });

    it("accepts 32-byte Base64 string", () => {
      const b64 = Buffer.from(allOnesBytes).toString("base64");
      const res = canonicalizePublicKey(b64);
      assert.equal(res.hex, allOnesHex);
    });

    it("rejects invalid length hex or non-hex string", () => {
      assert.throws(() => canonicalizePublicKey("010203"), /Invalid public key length|Failed to parse/);
      assert.throws(() => canonicalizePublicKey("not-a-valid-hex-or-base64-string!@#$"), /Failed to parse/);
    });
  });

  describe("Deterministic Derivation", () => {
    it("produces identical Connect ID for identical inputs", () => {
      const id1 = deriveConnectId(allOnesHex);
      const id2 = deriveConnectId(allOnesBytes);
      assert.equal(id1, id2);
      assert.match(id1, CONNECT_ID_REGEX);
      assert.ok(id1.startsWith(`${CONNECT_ID_PREFIX}-`));
    });

    it("produces different Connect IDs for different public keys", () => {
      const keyA = "00".repeat(32);
      const keyB = "ff".repeat(32);
      const idA = deriveConnectId(keyA);
      const idB = deriveConnectId(keyB);
      assert.notEqual(idA, idB);
    });
  });

  describe("Validation & Normalization", () => {
    it("validates well-formed canonical Connect ID", () => {
      const id = deriveConnectId(allOnesHex);
      assert.equal(isValidConnectId(id), true);
      assert.equal(isValidConnectId("INVALID"), false);
      assert.equal(isValidConnectId(null), false);
    });

    it("normalizes lowercase and missing hyphens", () => {
      const normalized = normalizeConnectId("talk 8f2k 91xz");
      assert.equal(normalized, "TALK-8F2K-91XZ");
    });

    it("normalizes ambiguous characters (I -> 1, L -> 1, O -> 0)", () => {
      const raw = "TALK-IL00-8F2K";
      const normalized = normalizeConnectId(raw);
      assert.equal(normalized, "TALK-1100-8F2K");
    });
  });

  describe("Verify Connect ID Binding", () => {
    it("returns true when Connect ID matches public key", () => {
      const id = deriveConnectId(allOnesHex);
      assert.equal(verifyConnectIdBinding(allOnesHex, id), true);
    });

    it("returns false when Connect ID does not match public key", () => {
      const id = deriveConnectId(allOnesHex);
      const otherKey = "00".repeat(32);
      assert.equal(verifyConnectIdBinding(otherKey, id), false);
    });

    it("returns false for invalid Connect ID format", () => {
      assert.equal(verifyConnectIdBinding(allOnesHex, "not-a-connect-id"), false);
    });
  });
});
