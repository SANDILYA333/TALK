import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";

import {
  createChallenge,
  bindIdentity,
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

// Client-side helper to simulate valid proof generation in Node test environment
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

describe("Backend Account-Device Identity Binding (Phase 5)", () => {
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

    // Mock Mongoose model methods on DeviceIdentity
    DeviceIdentity.findOne = async (query) => {
      return fakeIdentities.find((item) => {
        if (query.connectId && item.connectId !== query.connectId) return false;
        if (query.publicKey && item.publicKey !== query.publicKey) return false;
        return true;
      }) || null;
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
        _id: `fake_id_${fakeIdentities.length + 1}`,
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

  describe("POST /api/identity/challenge", () => {
    it("returns 401 if user is unauthenticated", async () => {
      const req = { user: null };
      const res = createMockRes();

      await createChallenge(req, res);
      assert.equal(res.statusCode, 401);
    });

    it("generates an ephemeral challenge with valid nonce and expiration", async () => {
      const req = { user: mockUser1 };
      const res = createMockRes();

      await createChallenge(req, res);
      assert.equal(res.statusCode, 200);
      assert.ok(res.body.challengeId);
      assert.ok(res.body.serverEphemeralPublicKey);
      assert.ok(res.body.challengeNonce);
      assert.ok(res.body.expiresAt);
      assert.equal(res.body.serverEphemeralPublicKey.length, 64);
      assert.equal(res.body.challengeNonce.length, 64);
    });
  });

  describe("POST /api/identity/bind", () => {
    it("returns 401 if user is unauthenticated", async () => {
      const req = { user: null, body: {} };
      const res = createMockRes();

      await bindIdentity(req, res);
      assert.equal(res.statusCode, 401);
    });

    it("rejects request if private key material is included in body", async () => {
      const req = {
        user: mockUser1,
        body: {
          privateKey: "some_secret_bytes",
          publicKey: "0101010101010101010101010101010101010101010101010101010101010101",
        },
      };
      const res = createMockRes();

      await bindIdentity(req, res);
      assert.equal(res.statusCode, 400);
      assert.match(res.body.message, /forbidden/i);
    });

    it("successfully binds fresh device identity with valid proof-of-possession", async () => {
      // 1. Client creates keypair
      const client = generateClientTestKey();
      const clientConnectId = deriveConnectId(client.rawPubHex);

      // 2. Request challenge
      const challengeReq = { user: mockUser1 };
      const challengeRes = createMockRes();
      await createChallenge(challengeReq, challengeRes);
      const { challengeId, serverEphemeralPublicKey, challengeNonce } = challengeRes.body;

      // 3. Client computes proof
      const proof = computeClientProofNode(
        client.privateKey,
        serverEphemeralPublicKey,
        challengeNonce,
        client.rawPubHex
      );

      // 4. Submit binding
      const bindReq = {
        user: mockUser1,
        body: {
          publicKey: client.rawPubHex,
          connectId: clientConnectId,
          challengeId,
          proof,
          algorithm: "X25519",
          version: 1,
        },
      };
      const bindRes = createMockRes();

      await bindIdentity(bindReq, bindRes);
      assert.equal(bindRes.statusCode, 201);
      assert.equal(bindRes.body.connectId, clientConnectId);
      assert.equal(bindRes.body.status, "ACTIVE");
      assert.equal(bindRes.body.isNew, true);

      // Verify user model updated
      const updatedUser = fakeUsers.find((u) => u._id.toString() === mockUser1._id.toString());
      assert.equal(updatedUser.connectId, clientConnectId);
    });

    it("rejects replay attack (re-submitting identical proof with already consumed challengeId)", async () => {
      const client = generateClientTestKey();
      const clientConnectId = deriveConnectId(client.rawPubHex);

      const challengeReq = { user: mockUser1 };
      const challengeRes = createMockRes();
      await createChallenge(challengeReq, challengeRes);
      const { challengeId, serverEphemeralPublicKey, challengeNonce } = challengeRes.body;

      const proof = computeClientProofNode(
        client.privateKey,
        serverEphemeralPublicKey,
        challengeNonce,
        client.rawPubHex
      );

      const bindReq = {
        user: mockUser1,
        body: {
          publicKey: client.rawPubHex,
          connectId: clientConnectId,
          challengeId,
          proof,
        },
      };
      const bindRes1 = createMockRes();
      await bindIdentity(bindReq, bindRes1);
      assert.equal(bindRes1.statusCode, 201);

      // Replay attempt with same challengeId
      const bindRes2 = createMockRes();
      await bindIdentity(bindReq, bindRes2);
      assert.equal(bindRes2.statusCode, 400);
      assert.match(bindRes2.body.message, /expired or invalid/i);
    });

    it("rejects proof with invalid cryptographic signature/HMAC", async () => {
      const client = generateClientTestKey();
      const clientConnectId = deriveConnectId(client.rawPubHex);

      const challengeReq = { user: mockUser1 };
      const challengeRes = createMockRes();
      await createChallenge(challengeReq, challengeRes);
      const { challengeId } = challengeRes.body;

      const bindReq = {
        user: mockUser1,
        body: {
          publicKey: client.rawPubHex,
          connectId: clientConnectId,
          challengeId,
          proof: "0000000000000000000000000000000000000000000000000000000000000000",
        },
      };
      const bindRes = createMockRes();

      await bindIdentity(bindReq, bindRes);
      assert.equal(bindRes.statusCode, 400);
      assert.match(bindRes.body.message, /failed|expired/i);
    });

    it("returns 409 Conflict if identity is already bound to another account", async () => {
      const client = generateClientTestKey();
      const clientConnectId = deriveConnectId(client.rawPubHex);

      // First bind to user1
      fakeIdentities.push({
        _id: "fake_id_1",
        userId: mockUser1._id,
        clerkId: mockUser1.clerkId,
        connectId: clientConnectId,
        publicKey: client.rawPubHex,
        algorithm: "X25519",
        version: 1,
        status: "ACTIVE",
        save: async function () { return this; },
      });

      // User2 requests challenge and attempts to bind user1's identity
      const challengeReq = { user: mockUser2 };
      const challengeRes = createMockRes();
      await createChallenge(challengeReq, challengeRes);
      const { challengeId, serverEphemeralPublicKey, challengeNonce } = challengeRes.body;

      const proof = computeClientProofNode(
        client.privateKey,
        serverEphemeralPublicKey,
        challengeNonce,
        client.rawPubHex
      );

      const bindReq = {
        user: mockUser2,
        body: {
          publicKey: client.rawPubHex,
          connectId: clientConnectId,
          challengeId,
          proof,
        },
      };
      const bindRes = createMockRes();

      await bindIdentity(bindReq, bindRes);
      assert.equal(bindRes.statusCode, 409);
      assert.match(bindRes.body.message, /already bound to another account/i);
    });

    it("returns 200 OK idempotently when re-binding identity already owned by user", async () => {
      const client = generateClientTestKey();
      const clientConnectId = deriveConnectId(client.rawPubHex);

      // Already exists for user1
      fakeIdentities.push({
        _id: "fake_id_1",
        userId: mockUser1._id,
        clerkId: mockUser1.clerkId,
        connectId: clientConnectId,
        publicKey: client.rawPubHex,
        algorithm: "X25519",
        version: 1,
        status: "ACTIVE",
        save: async function () { return this; },
      });

      // User1 requests fresh challenge
      const challengeReq = { user: mockUser1 };
      const challengeRes = createMockRes();
      await createChallenge(challengeReq, challengeRes);
      const { challengeId, serverEphemeralPublicKey, challengeNonce } = challengeRes.body;

      const proof = computeClientProofNode(
        client.privateKey,
        serverEphemeralPublicKey,
        challengeNonce,
        client.rawPubHex
      );

      const bindReq = {
        user: mockUser1,
        body: {
          publicKey: client.rawPubHex,
          connectId: clientConnectId,
          challengeId,
          proof,
        },
      };
      const bindRes = createMockRes();

      await bindIdentity(bindReq, bindRes);
      assert.equal(bindRes.statusCode, 200);
      assert.equal(bindRes.body.isNew, false);
      assert.equal(bindRes.body.status, "ACTIVE");
    });
  });
});
