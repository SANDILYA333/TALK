import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { lookupIdentityByConnectId } from "../../lib/api/identity.js";
import { axiosInstance } from "../../lib/axios.js";

describe("Frontend Connect ID Discovery Service & Race Condition Suite", () => {
  const mockConnectId = "TALK-8F2K-91XZ";
  const mockPublicKey = "01".repeat(32);

  beforeEach(() => {
    axiosInstance.get = async (url) => {
      if (url.includes("TALK-8F2K-91XZ")) {
        return {
          data: {
            connectId: mockConnectId,
            publicKey: mockPublicKey,
            algorithm: "X25519",
            version: 1,
            user: { fullName: "Alice Cooper", profilePic: "https://example.com/alice.png" },
          },
        };
      }
      const err = new Error("Not Found");
      err.response = { status: 404, data: { message: "Identity not found" } };
      throw err;
    };
  });

  it("Test 1: Successfully fetches public identity for valid Connect ID", async () => {
    const res = await lookupIdentityByConnectId("TALK-8F2K-91XZ");
    assert.equal(res.connectId, mockConnectId);
    assert.equal(res.publicKey, mockPublicKey);
    assert.equal(res.user.fullName, "Alice Cooper");
    assert.equal(res.user.email, undefined);
  });

  it("Test 2: Normalizes lowercase and unhyphenated input before sending query", async () => {
    let capturedUrl = "";
    axiosInstance.get = async (url) => {
      capturedUrl = url;
      return {
        data: {
          connectId: mockConnectId,
          publicKey: mockPublicKey,
          user: { fullName: "Alice Cooper" },
        },
      };
    };

    const res = await lookupIdentityByConnectId("talk 8f2k 91xz");
    assert.equal(capturedUrl, "/identity/lookup/TALK-8F2K-91XZ");
    assert.equal(res.connectId, mockConnectId);
  });

  it("Test 3: Correctly tags 404 response with code NOT_FOUND", async () => {
    await assert.rejects(
      () => lookupIdentityByConnectId("TALK-0000-0000"),
      (err) => {
        assert.equal(err.status, 404);
        assert.equal(err.code, "NOT_FOUND");
        return true;
      }
    );
  });

  it("Test 4: Correctly tags 429 response with code RATE_LIMITED and retryAfter", async () => {
    axiosInstance.get = async () => {
      const err = new Error("Too Many Requests");
      err.response = { status: 429, data: { message: "Rate limit exceeded", retryAfter: 45 } };
      throw err;
    };

    await assert.rejects(
      () => lookupIdentityByConnectId("TALK-8F2K-91XZ"),
      (err) => {
        assert.equal(err.status, 429);
        assert.equal(err.code, "RATE_LIMITED");
        assert.equal(err.retryAfter, 45);
        return true;
      }
    );
  });

  it("Test 5: Rejects malformed input client-side with code INVALID_FORMAT", async () => {
    await assert.rejects(
      () => lookupIdentityByConnectId("not-a-valid-code!"),
      (err) => {
        assert.equal(err.code, "INVALID_FORMAT");
        return true;
      }
    );
  });

  it("Test 6: Async Race Condition Simulation (Slow Query A followed by Fast Query B)", async () => {
    let currentSeq = 0;
    let latestDisplayState = null;

    async function executeSearch(id, delayMs, resultName) {
      const seq = ++currentSeq;
      // Simulate network delay
      await new Promise((resolve) => setTimeout(resolve, delayMs));
      // Guard: Discard if stale
      if (seq === currentSeq) {
        latestDisplayState = resultName;
      }
    }

    // Launch Query A (slow: 50ms) -> Bob
    const promiseA = executeSearch("TALK-1111-1111", 50, "Bob");
    // Launch Query B (fast: 10ms) -> Alice
    const promiseB = executeSearch("TALK-2222-2222", 10, "Alice");

    await Promise.all([promiseA, promiseB]);

    // Query B should be the final displayed result, NOT Query A!
    assert.equal(latestDisplayState, "Alice");
  });
});
