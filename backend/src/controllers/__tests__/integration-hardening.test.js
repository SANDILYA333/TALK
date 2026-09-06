import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";

import {
  createChallenge,
  bindIdentity,
  lookupIdentity,
  getDevices,
  revokeDevice,
  registerIdentity,
} from "../identity.controller.js";
import DeviceIdentity from "../../models/device-identity.model.js";
import User from "../../models/user.model.js";
import { deriveConnectId } from "../../lib/crypto/connect-id.js";

// Helper to create mock Express response object
function createMockRes() {
  return {
    statusCode: 200,
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(data) {
      this.body = data;
      return this;
    },
  };
}

// Client helper to generate X25519 test keypair
function generateClientTestKey() {
  const { publicKey, privateKey } = crypto.generateKeyPairSync("x25519");
  const rawPubHex = publicKey
    .export({ type: "spki", format: "der" })
    .subarray(-32)
    .toString("hex");
  return { publicKey, privateKey, rawPubHex };
}

// Client-side helper to compute PoP HMAC proof
function computeClientProofNode(clientPrivateKeyObject, serverEphemeralPublicKeyHex, challengeNonce, clientPublicKeyHex) {
  const spkiHeader = Buffer.from("302a300506032b656e032100", "hex");
  const serverSpki = Buffer.concat([spkiHeader, Buffer.from(serverEphemeralPublicKeyHex, "hex")]);
  const serverKeyObject = crypto.createPublicKey({
    key: serverSpki,
    format: "der",
    type: "spki",
  });

  const sharedSecret = crypto.diffieHellman({
    privateKey: clientPrivateKeyObject,
    publicKey: serverKeyObject,
  });

  const domain = "TALK-IDENTITY-BINDING-V1:";
  const domainBuf = Buffer.from(domain, "utf-8");
  const nonceBuf = Buffer.from(challengeNonce, "hex");
  const clientKeyBuf = Buffer.from(clientPublicKeyHex, "hex");
  const message = Buffer.concat([domainBuf, nonceBuf, clientKeyBuf]);

  const hmac = crypto.createHmac("sha256", sharedSecret);
  hmac.update(message);
  return hmac.digest("hex");
}

describe("Phase 7 — Identity Integration & Security Hardening Suite", () => {
  const mockUserAlice = {
    _id: "660000000000000000000001",
    clerkId: "clerk_alice_123",
    email: "alice@example.com",
    fullName: "Alice Cooper",
    profilePic: "https://example.com/alice.png",
    connectId: null,
  };

  const mockUserBob = {
    _id: "660000000000000000000002",
    clerkId: "clerk_bob_456",
    email: "bob@example.com",
    fullName: "Bob Marley",
    profilePic: "https://example.com/bob.png",
    connectId: null,
  };

  let fakeIdentities = [];
  let fakeUsers = [];

  beforeEach(() => {
    fakeIdentities = [];
    fakeUsers = [{ ...mockUserAlice }, { ...mockUserBob }];

    DeviceIdentity.findOne = async (query) => {
      return fakeIdentities.find((item) => {
        if (query.connectId && item.connectId !== query.connectId) return false;
        if (query.publicKey && item.publicKey !== query.publicKey) return false;
        if (query.userId && item.userId.toString() !== query.userId.toString()) return false;
        if (query.status && item.status !== query.status) return false;
        return true;
      }) || null;
    };

    DeviceIdentity.findById = async (id) => {
      const match = fakeIdentities.find((item) => item._id === id);
      if (!match) return null;
      return {
        ...match,
        save: async function () {
          const idx = fakeIdentities.findIndex((i) => i._id === this._id);
          if (idx !== -1) fakeIdentities[idx] = { ...this };
        },
      };
    };

    DeviceIdentity.find = (query) => {
      let filtered = fakeIdentities.filter((item) => {
        if (query.userId && item.userId.toString() !== query.userId.toString()) return false;
        return true;
      });
      let selectedFields = null;
      return {
        select: function (fields) {
          if (typeof fields === "string") {
            selectedFields = fields.split(" ");
          }
          return this;
        },
        sort: function () {
          return this;
        },
        lean: async function () {
          if (!selectedFields) return filtered;
          return filtered.map((item) => {
            const projected = {};
            for (const field of selectedFields) {
              if (field in item) projected[field] = item[field];
            }
            return projected;
          });
        },
      };
    };

    DeviceIdentity.create = async (doc) => {
      const newDoc = {
        _id: `dev_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
        status: doc.status || "ACTIVE",
        boundAt: doc.boundAt || null,
        lastVerifiedAt: doc.lastVerifiedAt || null,
        revokedAt: null,
        createdAt: new Date(),
        updatedAt: new Date(),
        ...doc,
      };
      fakeIdentities.push(newDoc);
      return newDoc;
    };

    User.findByIdAndUpdate = async (id, update) => {
      const u = fakeUsers.find((user) => user._id.toString() === id.toString());
      if (u) {
        Object.assign(u, update);
      }
      return u;
    };
  });

  describe("1. End-to-End Multi-Device Identity Lifecycle", () => {
    it("executes complete lifecycle: challenge -> PoP bind (phone) -> PoP bind (laptop) -> lookup -> revoke -> isolate", async () => {
      // Step A: Alice registers Device 1 (Phone) via PoP Binding
      const alicePhoneKey = generateClientTestKey();
      const phoneConnectId = deriveConnectId(alicePhoneKey.rawPubHex);

      const chalReq1 = { user: mockUserAlice };
      const chalRes1 = createMockRes();
      await createChallenge(chalReq1, chalRes1);
      assert.equal(chalRes1.statusCode, 200);
      assert.ok(chalRes1.body.challengeId);
      assert.ok(chalRes1.body.serverEphemeralPublicKey);

      const phoneProof = computeClientProofNode(
        alicePhoneKey.privateKey,
        chalRes1.body.serverEphemeralPublicKey,
        chalRes1.body.challengeNonce,
        alicePhoneKey.rawPubHex
      );

      const bindReq1 = {
        user: mockUserAlice,
        body: {
          publicKey: alicePhoneKey.rawPubHex,
          connectId: phoneConnectId,
          challengeId: chalRes1.body.challengeId,
          proof: phoneProof,
        },
      };
      const bindRes1 = createMockRes();
      await bindIdentity(bindReq1, bindRes1);
      assert.equal(bindRes1.statusCode, 201);
      assert.equal(bindRes1.body.status, "ACTIVE");

      // Step B: Alice registers Device 2 (Laptop) via PoP Binding
      const aliceLaptopKey = generateClientTestKey();
      const laptopConnectId = deriveConnectId(aliceLaptopKey.rawPubHex);

      const chalReq2 = { user: mockUserAlice };
      const chalRes2 = createMockRes();
      await createChallenge(chalReq2, chalRes2);
      assert.equal(chalRes2.statusCode, 200);

      const laptopProof = computeClientProofNode(
        aliceLaptopKey.privateKey,
        chalRes2.body.serverEphemeralPublicKey,
        chalRes2.body.challengeNonce,
        aliceLaptopKey.rawPubHex
      );

      const bindReq2 = {
        user: mockUserAlice,
        body: {
          publicKey: aliceLaptopKey.rawPubHex,
          connectId: laptopConnectId,
          challengeId: chalRes2.body.challengeId,
          proof: laptopProof,
        },
      };
      const bindRes2 = createMockRes();
      await bindIdentity(bindReq2, bindRes2);
      assert.equal(bindRes2.statusCode, 201);
      assert.equal(bindRes2.body.status, "ACTIVE");

      // Step C: Verify Alice now owns 2 active devices
      const listReq = { user: mockUserAlice };
      const listRes = createMockRes();
      await getDevices(listReq, listRes);
      assert.equal(listRes.statusCode, 200);
      assert.equal(listRes.body.devices.length, 2);

      // Step D: Revoke Phone device
      const phoneDeviceDoc = fakeIdentities.find((i) => i.connectId === phoneConnectId);
      assert.ok(phoneDeviceDoc);

      const revokeReq = { user: mockUserAlice, params: { id: phoneDeviceDoc._id } };
      const revokeRes = createMockRes();
      await revokeDevice(revokeReq, revokeRes);
      assert.equal(revokeRes.statusCode, 200);
      assert.equal(revokeRes.body.status, "REVOKED");

      // Step E: Verify Phone is REVOKED in database, Laptop remains ACTIVE
      const updatedPhone = fakeIdentities.find((i) => i.connectId === phoneConnectId);
      const updatedLaptop = fakeIdentities.find((i) => i.connectId === laptopConnectId);
      assert.equal(updatedPhone.status, "REVOKED");
      assert.ok(updatedPhone.revokedAt);
      assert.equal(updatedLaptop.status, "ACTIVE");
    });
  });

  describe("2. IDOR Protection & Cross-Account Isolation", () => {
    it("strictly forbids Alice from revoking Bob's device identity (403)", async () => {
      const bobKey = generateClientTestKey();
      const bobConnectId = deriveConnectId(bobKey.rawPubHex);
      const bobDev = await DeviceIdentity.create({
        userId: mockUserBob._id,
        clerkId: mockUserBob.clerkId,
        connectId: bobConnectId,
        publicKey: bobKey.rawPubHex,
        status: "ACTIVE",
      });

      // Alice tries to revoke Bob's device
      const attackReq = { user: mockUserAlice, params: { id: bobDev._id } };
      const attackRes = createMockRes();
      await revokeDevice(attackReq, attackRes);

      assert.equal(attackRes.statusCode, 403);
      assert.match(attackRes.body.message, /permission/i);

      // Verify Bob's device was not modified
      const bobDevAfter = fakeIdentities.find((i) => i._id === bobDev._id);
      assert.equal(bobDevAfter.status, "ACTIVE");
    });

    it("prevents Alice from binding or claiming Bob's registered Connect ID (409 Conflict)", async () => {
      const bobKey = generateClientTestKey();
      const bobConnectId = deriveConnectId(bobKey.rawPubHex);
      await DeviceIdentity.create({
        userId: mockUserBob._id,
        clerkId: mockUserBob.clerkId,
        connectId: bobConnectId,
        publicKey: bobKey.rawPubHex,
        status: "ACTIVE",
      });

      // Alice tries to register Bob's public key & Connect ID
      const claimReq = {
        user: mockUserAlice,
        body: {
          publicKey: bobKey.rawPubHex,
          connectId: bobConnectId,
        },
      };
      const claimRes = createMockRes();
      await registerIdentity(claimReq, claimRes);
      assert.equal(claimRes.statusCode, 409);
      assert.match(claimRes.body.message, /already registered to another account/i);
    });
  });

  describe("3. Zero-Knowledge Response Audit & PII Leakage Defense", () => {
    it("guarantees zero leakage of private keys, emails, clerkIds, or secret tokens across all endpoints", async () => {
      const testKey = generateClientTestKey();
      const connectId = deriveConnectId(testKey.rawPubHex);

      // Challenge endpoint
      const chalReq = { user: mockUserAlice };
      const chalRes = createMockRes();
      await createChallenge(chalReq, chalRes);
      const chalStr = JSON.stringify(chalRes.body).toLowerCase();
      assert.ok(!chalStr.includes("private"));
      assert.ok(!chalStr.includes("clerk"));
      assert.ok(!chalStr.includes("alice@"));

      // Bind endpoint
      const proof = computeClientProofNode(
        testKey.privateKey,
        chalRes.body.serverEphemeralPublicKey,
        chalRes.body.challengeNonce,
        testKey.rawPubHex
      );
      const bindReq = {
        user: mockUserAlice,
        body: {
          publicKey: testKey.rawPubHex,
          connectId,
          challengeId: chalRes.body.challengeId,
          proof,
        },
      };
      const bindRes = createMockRes();
      await bindIdentity(bindReq, bindRes);
      const bindStr = JSON.stringify(bindRes.body).toLowerCase();
      assert.ok(!bindStr.includes("private"));
      assert.ok(!bindStr.includes("secret"));
      assert.ok(!bindStr.includes("clerk"));
      assert.ok(!bindStr.includes("alice@"));

      // Devices list endpoint
      const devReq = { user: mockUserAlice };
      const devRes = createMockRes();
      await getDevices(devReq, devRes);
      const devStr = JSON.stringify(devRes.body).toLowerCase();
      assert.ok(!devStr.includes("private"));
      assert.ok(!devStr.includes("clerk"));
      assert.ok(!devStr.includes("alice@"));
    });
  });

  describe("4. Malformed Input & Boundary Hardening", () => {
    it("rejects overlong Connect ID lookup strings (>50 chars)", async () => {
      const longId = "A".repeat(51);
      const req = { params: { connectId: longId } };
      const res = createMockRes();
      await lookupIdentity(req, res);
      assert.equal(res.statusCode, 400);
    });

    it("rejects invalid or empty revoke IDs gracefully", async () => {
      const req = { user: mockUserAlice, params: { id: "" } };
      const res = createMockRes();
      await revokeDevice(req, res);
      assert.equal(res.statusCode, 400);
    });

    it("rejects binding payloads with invalid non-string types", async () => {
      const req = {
        user: mockUserAlice,
        body: {
          publicKey: 12345,
          connectId: {},
          challengeId: [],
          proof: null,
        },
      };
      const res = createMockRes();
      await bindIdentity(req, res);
      assert.equal(res.statusCode, 400);
      assert.match(res.body.message, /missing or invalid/i);
    });
  });
});
