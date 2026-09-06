import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import {
  registerIdentity,
  lookupIdentity,
  getMyIdentities,
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

describe("Backend Identity Controller Suite", () => {
  const validHexKey = "0101010101010101010101010101010101010101010101010101010101010101";
  const validConnectId = deriveConnectId(validHexKey);

  const otherHexKey = "ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff";
  const otherConnectId = deriveConnectId(otherHexKey);

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

  // In-memory fake database for unit test isolation
  let fakeIdentities = [];
  let fakeUsers = [mockUser1, mockUser2];

  beforeEach(() => {
    fakeIdentities = [];
    fakeUsers = [{ ...mockUser1 }, { ...mockUser2 }];

    // Mock DeviceIdentity static methods
    DeviceIdentity.findOne = async function (filter) {
      return fakeIdentities.find((doc) => {
        if (filter.connectId && doc.connectId !== filter.connectId) return false;
        if (filter.publicKey && doc.publicKey !== filter.publicKey) return false;
        return true;
      }) || null;
    };

    DeviceIdentity.create = async function (data) {
      const existing = fakeIdentities.find(
        (d) => d.connectId === data.connectId || d.publicKey === data.publicKey
      );
      if (existing) {
        const err = new Error("E11000 duplicate key error collection");
        err.code = 11000;
        throw err;
      }
      const created = {
        _id: `id_${fakeIdentities.length + 1}`,
        ...data,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      fakeIdentities.push(created);
      return created;
    };

    DeviceIdentity.find = function (filter) {
      let results = fakeIdentities.filter((doc) => {
        if (filter.userId && doc.userId.toString() !== filter.userId.toString()) return false;
        return true;
      });
      return {
        select() {
          return this;
        },
        sort() {
          return this;
        },
        async lean() {
          return results;
        },
      };
    };

    User.findByIdAndUpdate = async function (id, update) {
      const user = fakeUsers.find((u) => u._id === id.toString());
      if (user && update.connectId) {
        user.connectId = update.connectId;
      }
      return user;
    };
  });

  describe("Group 1: Successful Registration", () => {
    it("registers a valid public key and matching Connect ID", async () => {
      const req = {
        user: mockUser1,
        body: {
          publicKey: validHexKey,
          connectId: validConnectId,
          algorithm: "X25519",
          version: 1,
        },
      };
      const res = createMockRes();

      await registerIdentity(req, res);

      assert.equal(res.statusCode, 201);
      assert.equal(res.body.connectId, validConnectId);
      assert.equal(res.body.publicKey, validHexKey);
      assert.equal(res.body.isNew, true);
      assert.equal(fakeIdentities.length, 1);
    });
  });

  describe("Group 2: Unauthenticated Registration", () => {
    it("rejects when req.user is missing", async () => {
      const req = {
        user: null,
        body: {
          publicKey: validHexKey,
          connectId: validConnectId,
        },
      };
      const res = createMockRes();

      await registerIdentity(req, res);

      assert.equal(res.statusCode, 401);
      assert.match(res.body.message, /Unauthorized/);
    });
  });

  describe("Group 3: Invalid Public Key", () => {
    it("rejects malformed public key string", async () => {
      const req = {
        user: mockUser1,
        body: {
          publicKey: "invalid-hex-short",
          connectId: validConnectId,
        },
      };
      const res = createMockRes();

      await registerIdentity(req, res);

      assert.equal(res.statusCode, 400);
      assert.match(res.body.message, /Invalid public key/);
    });
  });

  describe("Group 4: Invalid Connect ID", () => {
    it("rejects malformed Connect ID format", async () => {
      const req = {
        user: mockUser1,
        body: {
          publicKey: validHexKey,
          connectId: "TALK-INVALID-CHARS-12345",
        },
      };
      const res = createMockRes();

      await registerIdentity(req, res);

      assert.equal(res.statusCode, 400);
      assert.match(res.body.message, /Invalid Connect ID|Connect ID format is invalid/);
    });
  });

  describe("Group 5: Connect ID / Public Key Mismatch", () => {
    it("rejects when Connect ID does not match public key", async () => {
      const req = {
        user: mockUser1,
        body: {
          publicKey: validHexKey,
          connectId: otherConnectId, // Mismatched!
        },
      };
      const res = createMockRes();

      await registerIdentity(req, res);

      assert.equal(res.statusCode, 400);
      assert.match(res.body.message, /does not match the supplied public key/);
    });
  });

  describe("Group 6: Duplicate Connect ID & Uniqueness", () => {
    it("rejects when Connect ID is already registered to a different account", async () => {
      // Register for User 1 first
      fakeIdentities.push({
        userId: mockUser1._id,
        clerkId: mockUser1.clerkId,
        connectId: validConnectId,
        publicKey: validHexKey,
        algorithm: "X25519",
        version: 1,
      });

      // User 2 attempts to register the same Connect ID
      const req = {
        user: mockUser2,
        body: {
          publicKey: validHexKey,
          connectId: validConnectId,
        },
      };
      const res = createMockRes();

      await registerIdentity(req, res);

      assert.equal(res.statusCode, 409);
      assert.match(res.body.message, /already registered to another account/);
    });
  });

  describe("Group 7: Idempotent Registration", () => {
    it("returns 200 OK and isNew: false for re-registration by same account", async () => {
      // Pre-existing identity
      fakeIdentities.push({
        userId: mockUser1._id,
        clerkId: mockUser1.clerkId,
        connectId: validConnectId,
        publicKey: validHexKey,
        algorithm: "X25519",
        version: 1,
      });

      const req = {
        user: mockUser1,
        body: {
          publicKey: validHexKey,
          connectId: validConnectId,
        },
      };
      const res = createMockRes();

      await registerIdentity(req, res);

      assert.equal(res.statusCode, 200);
      assert.equal(res.body.isNew, false);
      assert.equal(res.body.connectId, validConnectId);
      assert.equal(fakeIdentities.length, 1); // No duplicates created
    });
  });

  describe("Group 8: Ownership Conflict", () => {
    it("rejects when public key is registered to another account", async () => {
      fakeIdentities.push({
        userId: mockUser1._id,
        clerkId: mockUser1.clerkId,
        connectId: "TALK-OLD1-KEY1",
        publicKey: validHexKey,
        algorithm: "X25519",
        version: 1,
      });

      const req = {
        user: mockUser2,
        body: {
          publicKey: validHexKey,
          connectId: validConnectId,
        },
      };
      const res = createMockRes();

      await registerIdentity(req, res);

      assert.equal(res.statusCode, 409);
      assert.match(res.body.message, /already registered to another account/);
    });
  });

  describe("Group 9: Forbidden Secret Field Rejection", () => {
    it("strictly rejects requests containing private key material", async () => {
      const req = {
        user: mockUser1,
        body: {
          publicKey: validHexKey,
          connectId: validConnectId,
          privateKey: "some-secret-private-key",
        },
      };
      const res = createMockRes();

      await registerIdentity(req, res);

      assert.equal(res.statusCode, 400);
      assert.match(res.body.message, /Private key or secret material is strictly forbidden/);
      assert.equal(fakeIdentities.length, 0);
    });
  });

  describe("Group 10: Database Uniqueness Race Condition", () => {
    it("handles Mongo 11000 duplicate key error gracefully", async () => {
      DeviceIdentity.findOne = async () => null; // Simulate race where findOne missed concurrent write
      DeviceIdentity.create = async () => {
        const err = new Error("E11000 duplicate key");
        err.code = 11000;
        throw err;
      };

      const req = {
        user: mockUser1,
        body: {
          publicKey: validHexKey,
          connectId: validConnectId,
        },
      };
      const res = createMockRes();

      await registerIdentity(req, res);

      assert.equal(res.statusCode, 409);
      assert.match(res.body.message, /already registered/);
    });
  });

  describe("Group 11: Identity Lookup & Discovery (Zero PII)", () => {
    it("returns public metadata without email or clerkId", async () => {
      DeviceIdentity.findOne = function () {
        return {
          populate() {
            return {
              connectId: validConnectId,
              publicKey: validHexKey,
              algorithm: "X25519",
              version: 1,
              userId: {
                fullName: "Alice Cooper",
                profilePic: "https://example.com/avatar1.png",
                email: "secret@example.com", // Should be omitted
              },
            };
          },
        };
      };

      const req = { params: { connectId: validConnectId } };
      const res = createMockRes();

      await lookupIdentity(req, res);

      assert.equal(res.statusCode, 200);
      assert.equal(res.body.connectId, validConnectId);
      assert.equal(res.body.publicKey, validHexKey);
      assert.equal(res.body.user.fullName, "Alice Cooper");
      assert.equal(res.body.user.email, undefined);
      assert.equal(res.body.user.clerkId, undefined);
    });

    it("returns 404 for nonexistent Connect ID", async () => {
      DeviceIdentity.findOne = function () {
        return {
          populate() {
            return null;
          },
        };
      };

      const req = { params: { connectId: otherConnectId } };
      const res = createMockRes();

      await lookupIdentity(req, res);

      assert.equal(res.statusCode, 404);
      assert.match(res.body.message, /Identity not found/);
    });

    it("retrieves current user's registered identities", async () => {
      fakeIdentities.push({
        userId: mockUser1._id,
        connectId: validConnectId,
        publicKey: validHexKey,
        algorithm: "X25519",
        version: 1,
      });

      const req = { user: mockUser1 };
      const res = createMockRes();

      await getMyIdentities(req, res);

      assert.equal(res.statusCode, 200);
      assert.equal(res.body.identities.length, 1);
      assert.equal(res.body.identities[0].connectId, validConnectId);
    });
  });
});
