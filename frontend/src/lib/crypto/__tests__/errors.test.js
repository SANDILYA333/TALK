import { test, describe } from "node:test";
import assert from "node:assert/strict";

import {
  CryptographicError,
  KeyGenerationError,
  KeySerializationError,
  KeyStorageError,
  ConnectIdError,
  InvalidConnectIdError,
} from "../errors.js";

describe("Frontend Cryptographic Error Taxonomy & Classification (Phase 9)", () => {
  test("KeyGenerationError has CRITICAL severity and permanent failure classification", () => {
    const err = new KeyGenerationError("Web Crypto failed");
    assert.equal(err.name, "KeyGenerationError");
    assert.equal(err.code, "KEY_GENERATION_ERROR");
    assert.equal(err.severity, "CRITICAL");
    assert.equal(err.isTransient, false);
    assert.equal(err.isPermanent, true);
    assert.ok(err.userMessage);
  });

  test("KeySerializationError has ERROR severity and formatting message", () => {
    const err = new KeySerializationError("DER export failed");
    assert.equal(err.name, "KeySerializationError");
    assert.equal(err.code, "KEY_SERIALIZATION_ERROR");
    assert.equal(err.severity, "ERROR");
    assert.equal(err.isPermanent, true);
    assert.match(err.userMessage, /formatting/i);
  });

  test("KeyStorageError indicates permanent storage corruption with clear user message", () => {
    const err = new KeyStorageError("Corrupted record");
    assert.equal(err.name, "KeyStorageError");
    assert.equal(err.code, "KEY_STORAGE_ERROR");
    assert.equal(err.severity, "CRITICAL");
    assert.equal(err.isPermanent, true);
    assert.match(err.userMessage, /storage/i);
  });

  test("ConnectIdError and InvalidConnectIdError provide clear user-facing guidance", () => {
    const baseErr = new ConnectIdError("Derivation failed");
    assert.equal(baseErr.name, "ConnectIdError");
    assert.equal(baseErr.code, "CONNECT_ID_ERROR");

    const err = new InvalidConnectIdError("Invalid length");
    assert.equal(err.name, "InvalidConnectIdError");
    assert.equal(err.code, "INVALID_CONNECT_ID_ERROR");
    assert.equal(err.severity, "ERROR");
    assert.match(err.userMessage, /TALK-XXXX-XXXX/);
  });

  test("CryptographicError allows custom transient flags and cause chaining", () => {
    const rootCause = new Error("Network timeout");
    const customErr = new CryptographicError({
      message: "Transient key lookup timeout",
      code: "LOOKUP_TIMEOUT",
      cause: rootCause,
      isTransient: true,
      severity: "WARN",
      userMessage: "Network is slow. Retrying...",
    });

    assert.equal(customErr.isTransient, true);
    assert.equal(customErr.isPermanent, false);
    assert.equal(customErr.severity, "WARN");
    assert.equal(customErr.cause, rootCause);
  });
});
