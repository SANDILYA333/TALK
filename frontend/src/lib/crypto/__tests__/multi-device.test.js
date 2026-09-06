import { test, describe, beforeEach } from "node:test";
import assert from "node:assert/strict";

import {
  generateIdentityKeyPair,
  exportPublicKey,
  deriveConnectId,
  getOrCreateDeviceIdentity,
  resetDeviceIdentity,
  isCurrentDevice,
} from "../index.js";

describe("Frontend Multi-Device Identity & Fingerprint-Free Identification (Phase 6)", () => {
  beforeEach(async () => {
    await resetDeviceIdentity();
  });

  test("each simulated device generates an independent keypair and unique Connect ID", async () => {
    // Simulate Device A (e.g. Phone)
    const deviceA = await generateIdentityKeyPair();
    const exportA = await exportPublicKey(deviceA.publicKey);
    const connectIdA = await deriveConnectId(exportA.raw);

    // Simulate Device B (e.g. Laptop)
    const deviceB = await generateIdentityKeyPair();
    const exportB = await exportPublicKey(deviceB.publicKey);
    const connectIdB = await deriveConnectId(exportB.raw);

    assert.notEqual(exportA.hex, exportB.hex, "Distinct devices must have distinct public keys");
    assert.notEqual(connectIdA, connectIdB, "Distinct devices must have distinct Connect IDs");
  });

  test("isCurrentDevice correctly identifies current device by Connect ID without fingerprinting", async () => {
    const localIdentity = await getOrCreateDeviceIdentity();

    // Device record from backend matching this client's identity
    const currentDeviceRecord = {
      _id: "dev_123",
      connectId: localIdentity.connectId,
      publicKey: localIdentity.publicKeyHex,
      status: "ACTIVE",
    };

    // Another device record from backend (e.g. user's tablet)
    const otherDeviceRecord = {
      _id: "dev_456",
      connectId: "TALK-ZZZZ-9999",
      publicKey: "0000000000000000000000000000000000000000000000000000000000000000",
      status: "ACTIVE",
    };

    assert.equal(
      isCurrentDevice(currentDeviceRecord, localIdentity),
      true,
      "Current device record must match local identity"
    );

    assert.equal(
      isCurrentDevice(otherDeviceRecord, localIdentity),
      false,
      "Other device record must not match local identity"
    );
  });

  test("isCurrentDevice handles case-insensitivity and null safety", async () => {
    const localIdentity = await getOrCreateDeviceIdentity();

    const lowerCaseRecord = {
      connectId: localIdentity.connectId.toLowerCase(),
      publicKey: localIdentity.publicKeyHex.toUpperCase(),
    };

    assert.equal(isCurrentDevice(lowerCaseRecord, localIdentity), true);
    assert.equal(isCurrentDevice(null, localIdentity), false);
    assert.equal(isCurrentDevice(lowerCaseRecord, null), false);
  });
});
