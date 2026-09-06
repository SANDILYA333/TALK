import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";

import {
  getDevices,
  getMyIdentities,
  revokeDevice,
  bindIdentity,
  createChallenge,
} from "../identity.controller.js";
import DeviceIdentity from "../../models/device-identity.model.js";
import User from "../../models/user.model.js";
import { deriveConnectId } from "../../lib/crypto/connect-id.js";

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

function generateClientTestKey() {
  const { publicKey, privateKey } = crypto.generateKeyPairSync("x25519");
  const rawPubHex = publicKey
    .export({ type: "spki", format: "der" })
    .subarray(-32)
    .toString("hex");
  return { publicKey, privateKey, rawPubHex };
}

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

describe("Backend Multi-Device Identity & Lifecycle Management (Phase 6)", () => {
  const mockUser1 = {
    _id: "660000000000000000000001",
    clerkId: "user_clerk_123",
    email: "user1@example.com",
    fullName: "Alice Cooper",
    profilePic: "https://example.com/avatar1.png",
    connectId: null,
  };

  const mockUser2 = {
    _id: "660000000000000000000002",
    clerkId: "user_clerk_456",
    email: "user2@example.com",
    fullName: "Bob Marley",
    profilePic: "https://example.com/avatar2.png",
    connectId: null,
  };

  let fakeIdentities = [];
  let fakeUsers = [mockUser1, mockUser2];

  beforeEach(() => {
    fakeIdentities = [];
    fakeUsers = [{ ...mockUser1 }, { ...mockUser2 }];

    DeviceIdentity.find = (query) => {
      const filtered = fakeIdentities.filter((item) => {
        if (query.userId && item.userId.toString() !== query.userId.toString()) return false;
        if (query.status && item.status !== query.status) return false;
        return true;
      });

      return {
        select: function () {
          return this;
        },
        sort: function () {
          return this;
        },
        lean: async function () {
          return filtered;
        },
      };
    };

    DeviceIdentity.findOne = async (query) => {
      let filtered = fakeIdentities.filter((item) => {
        if (query.userId && item.userId.toString() !== query.userId.toString()) return false;
        if (query.connectId && item.connectId !== query.connectId) return false;
        if (query.publicKey && item.publicKey !== query.publicKey) return false;
        if (query.status && item.status !== query.status) return false;
        return true;
      });

      const res = filtered[0] || null;
      if (res) {
        res.sort = function () {
          return this;
        };
      }
      return res;
    };

    DeviceIdentity.findById = async (id) => {
      const found = fakeIdentities.find((i) => i._id.toString() === id.toString());
      if (found) {
        found.save = async function () {
          return this;
        };
      }
      return found || null;
    };

    DeviceIdentity.create = async (doc) => {
      const existing = fakeIdentities.find(
        (i) => i.connectId === doc.connectId || i.publicKey === doc.publicKey
      );
      if (existing) {
        const error = new Error("E11000 duplicate key error collection");
        error.code = 11000;
        throw error;
      }
      const created = {
        ...doc,
        _id: `device_id_${fakeIdentities.length + 1}`,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        save: async function () {
          return this;
        },
      };
      fakeIdentities.push(created);
      return created;
    };

    User.findByIdAndUpdate = async (id, update) => {
      const user = fakeUsers.find((u) => u._id.toString() === id.toString());
      if (user) {
        Object.assign(user, update);
      }
      return user;
    };
  });

  describe("1. Multi-Device Registration ($1 \\to N$)", () => {
    it("allows a single user account to own multiple distinct device identities", async () => {
      // Register Device 1 (Phone)
      const phone = generateClientTestKey();
      const phoneConnectId = deriveConnectId(phone.rawPubHex);

      const chalReq1 = { user: mockUser1 };
      const chalRes1 = createMockRes();
      await createChallenge(chalReq1, chalRes1);

      const phoneProof = computeClientProofNode(
        phone.privateKey,
        chalRes1.body.serverEphemeralPublicKey,
        chalRes1.body.challengeNonce,
        phone.rawPubHex
      );

      const bindReq1 = {
        user: mockUser1,
        body: {
          publicKey: phone.rawPubHex,
          connectId: phoneConnectId,
          challengeId: chalRes1.body.challengeId,
          proof: phoneProof,
        },
      };
      const bindRes1 = createMockRes();
      await bindIdentity(bindReq1, bindRes1);
      assert.equal(bindRes1.statusCode, 201);
      assert.equal(bindRes1.body.connectId, phoneConnectId);

      // Register Device 2 (Laptop) on same account
      const laptop = generateClientTestKey();
      const laptopConnectId = deriveConnectId(laptop.rawPubHex);

      const chalReq2 = { user: mockUser1 };
      const chalRes2 = createMockRes();
      await createChallenge(chalReq2, chalRes2);

      const laptopProof = computeClientProofNode(
        laptop.privateKey,
        chalRes2.body.serverEphemeralPublicKey,
        chalRes2.body.challengeNonce,
        laptop.rawPubHex
      );

      const bindReq2 = {
        user: mockUser1,
        body: {
          publicKey: laptop.rawPubHex,
          connectId: laptopConnectId,
          challengeId: chalRes2.body.challengeId,
          proof: laptopProof,
        },
      };
      const bindRes2 = createMockRes();
      await bindIdentity(bindReq2, bindRes2);
      assert.equal(bindRes2.statusCode, 201);
      assert.equal(bindRes2.body.connectId, laptopConnectId);

      // Verify account owns 2 separate devices
      const listReq = { user: mockUser1 };
      const listRes = createMockRes();
      await getDevices(listReq, listRes);
      assert.equal(listRes.statusCode, 200);
      assert.equal(listRes.body.devices.length, 2);
      assert.ok(listRes.body.devices.some((d) => d.connectId === phoneConnectId));
      assert.ok(listRes.body.devices.some((d) => d.connectId === laptopConnectId));
    });
  });

  describe("2. Device Listing & Privacy Protection", () => {
    it("returns 401 if unauthenticated", async () => {
      const req = { user: null };
      const res = createMockRes();
      await getDevices(req, res);
      assert.equal(res.statusCode, 401);
    });

    it("strictly isolates devices by authenticated user account", async () => {
      // Create Device for User 1
      fakeIdentities.push({
        _id: "dev_user1",
        userId: mockUser1._id,
        clerkId: mockUser1.clerkId,
        connectId: "TALK-DEV1-AAAA",
        publicKey: "1111111111111111111111111111111111111111111111111111111111111111",
        status: "ACTIVE",
      });

      // Create Device for User 2
      fakeIdentities.push({
        _id: "dev_user2",
        userId: mockUser2._id,
        clerkId: mockUser2.clerkId,
        connectId: "TALK-DEV2-BBBB",
        publicKey: "2222222222222222222222222222222222222222222222222222222222222222",
        status: "ACTIVE",
      });

      // User 1 requests devices
      const req1 = { user: mockUser1 };
      const res1 = createMockRes();
      await getDevices(req1, res1);
      assert.equal(res1.statusCode, 200);
      assert.equal(res1.body.devices.length, 1);
      assert.equal(res1.body.devices[0].connectId, "TALK-DEV1-AAAA");

      // User 2 requests devices
      const req2 = { user: mockUser2 };
      const res2 = createMockRes();
      await getDevices(req2, res2);
      assert.equal(res2.statusCode, 200);
      assert.equal(res2.body.devices.length, 1);
      assert.equal(res2.body.devices[0].connectId, "TALK-DEV2-BBBB");
    });

    it("guarantees zero private key material in device listing", async () => {
      fakeIdentities.push({
        _id: "dev_user1",
        userId: mockUser1._id,
        clerkId: mockUser1.clerkId,
        connectId: "TALK-DEV1-AAAA",
        publicKey: "1111111111111111111111111111111111111111111111111111111111111111",
        status: "ACTIVE",
      });

      const req = { user: mockUser1 };
      const res = createMockRes();
      await getDevices(req, res);

      const device = res.body.devices[0];
      assert.equal(device.privateKey, undefined);
      assert.equal(device.privateKeyBytes, undefined);
      assert.equal(device.pkcs8, undefined);
    });
  });

  describe("3. Device Revocation & Authorization", () => {
    it("returns 401 if unauthenticated", async () => {
      const req = { user: null, params: { id: "dev_123" } };
      const res = createMockRes();
      await revokeDevice(req, res);
      assert.equal(res.statusCode, 401);
    });

    it("returns 404 if device does not exist", async () => {
      const req = { user: mockUser1, params: { id: "non_existent_device" } };
      const res = createMockRes();
      await revokeDevice(req, res);
      assert.equal(res.statusCode, 404);
      assert.match(res.body.message, /not found/i);
    });

    it("returns 403 if user attempts to revoke a device owned by another account", async () => {
      fakeIdentities.push({
        _id: "dev_user2_target",
        userId: mockUser2._id,
        clerkId: mockUser2.clerkId,
        connectId: "TALK-USER2-DEV1",
        publicKey: "2222222222222222222222222222222222222222222222222222222222222222",
        status: "ACTIVE",
      });

      // User 1 tries to revoke User 2's device
      const req = { user: mockUser1, params: { id: "dev_user2_target" } };
      const res = createMockRes();
      await revokeDevice(req, res);
      assert.equal(res.statusCode, 403);
      assert.match(res.body.message, /permission/i);

      // Verify device remains ACTIVE
      assert.equal(fakeIdentities[0].status, "ACTIVE");
    });

    it("successfully revokes user's own device and preserves audit record without deletion", async () => {
      const dev = {
        _id: "dev_user1_laptop",
        userId: mockUser1._id,
        clerkId: mockUser1.clerkId,
        connectId: "TALK-USER1-DEV1",
        publicKey: "1111111111111111111111111111111111111111111111111111111111111111",
        status: "ACTIVE",
      };
      fakeIdentities.push(dev);

      const req = { user: mockUser1, params: { id: "dev_user1_laptop" } };
      const res = createMockRes();
      await revokeDevice(req, res);
      assert.equal(res.statusCode, 200);
      assert.equal(res.body.status, "REVOKED");
      assert.ok(res.body.revokedAt);

      // Verify record still exists in database with REVOKED status
      const updated = fakeIdentities.find((i) => i._id === "dev_user1_laptop");
      assert.ok(updated, "Record must NOT be deleted");
      assert.equal(updated.status, "REVOKED");
      assert.ok(updated.revokedAt);
    });

    it("idempotently handles re-revoking an already revoked device", async () => {
      const dev = {
        _id: "dev_user1_old",
        userId: mockUser1._id,
        clerkId: mockUser1.clerkId,
        connectId: "TALK-USER1-DEV2",
        publicKey: "3333333333333333333333333333333333333333333333333333333333333333",
        status: "REVOKED",
        revokedAt: new Date("2026-01-01"),
      };
      fakeIdentities.push(dev);

      const req = { user: mockUser1, params: { id: "dev_user1_old" } };
      const res = createMockRes();
      await revokeDevice(req, res);
      assert.equal(res.statusCode, 200);
      assert.equal(res.body.status, "REVOKED");
      assert.match(res.body.message, /already revoked/i);
    });
  });
});
