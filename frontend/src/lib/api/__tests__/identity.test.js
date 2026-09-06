import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import {
  registerDeviceIdentityWithBackend,
  lookupIdentityByConnectId,
  fetchMyRegisteredIdentities,
} from "../identity.js";
import { resetDeviceIdentity, getOrCreateDeviceIdentity } from "../../crypto/identity.js";
import { axiosInstance } from "../../axios.js";

describe("Frontend Identity API Service", () => {
  beforeEach(async () => {
    await resetDeviceIdentity();
  });

  it("constructs and sends safe registration payload without private keys", async () => {
    let capturedUrl = "";
    let capturedPayload = null;
    let capturedHeaders = null;

    axiosInstance.post = async (url, payload, config) => {
      capturedUrl = url;
      capturedPayload = payload;
      capturedHeaders = config?.headers;
      return {
        data: {
          success: true,
          connectId: payload.connectId,
          publicKey: payload.publicKey,
          isNew: true,
        },
      };
    };

    const result = await registerDeviceIdentityWithBackend({ token: "test_jwt_token" });

    assert.equal(capturedUrl, "/identity/register");
    assert.equal(result.success, true);
    assert.ok(capturedPayload.publicKey);
    assert.ok(capturedPayload.connectId);
    assert.equal(capturedPayload.algorithm, "X25519");
    assert.equal(capturedPayload.version, 1);
    assert.equal(capturedHeaders?.Authorization, "Bearer test_jwt_token");

    // Critical Security Check: Assert ZERO private material in payload
    assert.equal("privateKey" in capturedPayload, false);
    assert.equal("pkcs8" in capturedPayload, false);
    assert.equal("private" in capturedPayload, false);
  });

  it("does not destroy or regenerate device key on network error", async () => {
    // Generate initial identity
    const identityBefore = await getOrCreateDeviceIdentity();

    // Mock network failure
    axiosInstance.post = async () => {
      const err = new Error("Network Error");
      err.response = { status: 500, data: { message: "Internal Server Error" } };
      throw err;
    };

    await assert.rejects(
      () => registerDeviceIdentityWithBackend(),
      /Internal Server Error/
    );

    // Verify same device key still exists locally
    const identityAfter = await getOrCreateDeviceIdentity();
    assert.equal(identityBefore.connectId, identityAfter.connectId);
  });

  it("looks up identity by Connect ID with normalization", async () => {
    let capturedUrl = "";
    axiosInstance.get = async (url) => {
      capturedUrl = url;
      return {
        data: {
          connectId: "TALK-8F2K-91XZ",
          publicKey: "01".repeat(32),
          user: { fullName: "Alice Cooper" },
        },
      };
    };

    const res = await lookupIdentityByConnectId("talk 8f2k 91xz");
    assert.equal(capturedUrl, "/identity/lookup/TALK-8F2K-91XZ");
    assert.equal(res.connectId, "TALK-8F2K-91XZ");
  });

  it("fetches registered identities for current user", async () => {
    axiosInstance.get = async () => {
      return {
        data: {
          identities: [{ connectId: "TALK-8F2K-91XZ", algorithm: "X25519" }],
        },
      };
    };

    const identities = await fetchMyRegisteredIdentities();
    assert.equal(identities.length, 1);
    assert.equal(identities[0].connectId, "TALK-8F2K-91XZ");
  });
});
