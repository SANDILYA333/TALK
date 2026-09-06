import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { lookupIdentity } from "../identity.controller.js";
import { createRateLimiter } from "../../middleware/rate-limit.middleware.js";
import DeviceIdentity from "../../models/device-identity.model.js";

function createMockRes() {
  return {
    statusCode: 200,
    body: null,
    headers: {},
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(data) {
      this.body = data;
      return this;
    },
    setHeader(key, val) {
      this.headers[key] = val;
      return this;
    },
  };
}

describe("Backend Connect ID Discovery & Lookup Suite", () => {
  const mockConnectId = "TALK-8F2K-91XZ";
  const mockPublicKey = "01".repeat(32);

  const mockIdentityDoc = {
    connectId: mockConnectId,
    publicKey: mockPublicKey,
    algorithm: "X25519",
    version: 1,
    userId: {
      _id: "660000000000000000000001",
      fullName: "Alice Cooper",
      profilePic: "https://example.com/alice.png",
      email: "alice@example.com", // SENSITIVE PII - MUST NOT BE LEAKED
      clerkId: "user_clerk_alice", // SENSITIVE - MUST NOT BE LEAKED
    },
  };

  beforeEach(() => {
    DeviceIdentity.findOne = function (filter) {
      if (filter.connectId === mockConnectId) {
        return {
          populate() {
            return mockIdentityDoc;
          },
        };
      }
      return {
        populate() {
          return null;
        },
      };
    };
  });

  it("Test 1: Valid Connect ID returns verified public identity", async () => {
    const req = { params: { connectId: "TALK-8F2K-91XZ" } };
    const res = createMockRes();

    await lookupIdentity(req, res);

    assert.equal(res.statusCode, 200);
    assert.equal(res.body.connectId, "TALK-8F2K-91XZ");
    assert.equal(res.body.publicKey, mockPublicKey);
    assert.equal(res.body.algorithm, "X25519");
    assert.equal(res.body.version, 1);
    assert.equal(res.body.user.fullName, "Alice Cooper");
    assert.equal(res.body.user.profilePic, "https://example.com/alice.png");
  });

  it("Test 2: Case normalization & unhyphenated input resolves correctly", async () => {
    const req = { params: { connectId: "talk 8f2k 91xz" } };
    const res = createMockRes();

    await lookupIdentity(req, res);

    assert.equal(res.statusCode, 200);
    assert.equal(res.body.connectId, "TALK-8F2K-91XZ");
  });

  it("Test 3: Nonexistent Connect ID returns safe 404 Not Found", async () => {
    const req = { params: { connectId: "TALK-0000-0000" } };
    const res = createMockRes();

    await lookupIdentity(req, res);

    assert.equal(res.statusCode, 404);
    assert.match(res.body.message, /Identity not found/);
  });

  it("Test 4: Invalid Connect ID format returns 400 Bad Request", async () => {
    const req = { params: { connectId: "invalid!@#$" } };
    const res = createMockRes();

    await lookupIdentity(req, res);

    assert.equal(res.statusCode, 400);
    assert.match(res.body.message, /Invalid Connect ID format/);
  });

  it("Test 5: Strictly excludes email, clerkId, and private keys from response (Zero PII)", async () => {
    const req = { params: { connectId: "TALK-8F2K-91XZ" } };
    const res = createMockRes();

    await lookupIdentity(req, res);

    assert.equal(res.statusCode, 200);
    assert.equal(res.body.user.email, undefined);
    assert.equal(res.body.user.clerkId, undefined);
    assert.equal(res.body.privateKey, undefined);
    assert.equal(res.body.user._id, undefined);

    const serialized = JSON.stringify(res.body);
    assert.equal(serialized.includes("alice@example.com"), false);
    assert.equal(serialized.includes("user_clerk_alice"), false);
  });

  it("Test 6: Rate limiter triggers 429 Too Many Requests when limit exceeded", async () => {
    const limiter = createRateLimiter({
      windowMs: 60 * 1000,
      maxRequests: 3,
      message: "Rate limit exceeded",
    });

    const mockReq = { ip: "127.0.0.1", user: null };

    // Request 1
    let nextCalled = 0;
    const res1 = createMockRes();
    limiter(mockReq, res1, () => { nextCalled++; });
    assert.equal(nextCalled, 1);

    // Request 2
    const res2 = createMockRes();
    limiter(mockReq, res2, () => { nextCalled++; });
    assert.equal(nextCalled, 2);

    // Request 3
    const res3 = createMockRes();
    limiter(mockReq, res3, () => { nextCalled++; });
    assert.equal(nextCalled, 3);

    // Request 4 -> Should be blocked with 429
    const res4 = createMockRes();
    limiter(mockReq, res4, () => { nextCalled++; });
    assert.equal(nextCalled, 3); // next was NOT called
    assert.equal(res4.statusCode, 429);
    assert.match(res4.body.message, /Rate limit exceeded/);
    assert.ok(res4.headers["Retry-After"] >= 1);
  });
});
