import { axiosInstance } from "../axios.js";
import { getOrCreateDeviceIdentity } from "../crypto/identity.js";
import { exportPublicKey } from "../crypto/keypair.js";
import { normalizeConnectId } from "../crypto/connect-id.js";
import { generateBindingProof } from "../crypto/binding.js";

/**
 * Registers the local device's cryptographic public identity with the TALK backend.
 * 
 * Invariants:
 * 1. Strictly transmits ONLY public key, connectId, algorithm, and version.
 * 2. Never attaches or serializes private key material.
 * 3. Network or server errors do NOT regenerate or wipe local cryptographic identity.
 *
 * @param {object} [options]
 * @param {string} [options.token] Optional Clerk session token for Authorization header
 * @returns {Promise<{ success: boolean, connectId: string, publicKey: string, isNew: boolean }>}
 */
export async function registerDeviceIdentityWithBackend(options = {}) {
  // Step 1: Ensure local device identity exists (creates once if missing, loads from IndexedDB)
  const identity = await getOrCreateDeviceIdentity();

  // Step 2: Canonicalize public key to hex
  const exported = await exportPublicKey(identity.publicKey);
  const canonicalHex = exported.hex;

  // Step 3: Construct safe public-only payload
  const payload = {
    publicKey: canonicalHex,
    connectId: identity.connectId,
    algorithm: "X25519",
    version: 1,
  };

  // Security Invariant Assertion: Verify no private material accidentally leaks
  if ("privateKey" in payload || "private" in payload || "pkcs8" in payload) {
    throw new Error("Security Violation: Private key material detected in registration payload.");
  }

  const headers = {};
  if (options.token) {
    headers["Authorization"] = `Bearer ${options.token}`;
  }

  try {
    const res = await axiosInstance.post("/identity/register", payload, { headers });
    return {
      success: true,
      connectId: res.data.connectId,
      publicKey: res.data.publicKey,
      isNew: res.data.isNew,
    };
  } catch (error) {
    // Network or server failures must propagate without wiping or re-generating the local key
    const message =
      error.response?.data?.message || error.message || "Failed to register identity with backend";
    const status = error.response?.status;
    const err = new Error(message);
    err.status = status;
    throw err;
  }
}

/**
 * Performs cryptographic challenge-response proof-of-possession and establishes
 * an explicit verified binding between the user's account and local device identity.
 *
 * Invariants:
 * 1. Strictly transmits ONLY public key, connectId, challengeId, proof, algorithm, version.
 * 2. Never attaches or transmits private key material.
 * 3. Uses local private key strictly for local ephemeral DH key agreement + HMAC proof generation.
 *
 * @param {object} [options]
 * @param {string} [options.token] Optional Clerk session token
 * @returns {Promise<{ success: boolean, connectId: string, publicKey: string, status: string, isNew: boolean }>}
 */
export async function bindDeviceIdentityWithBackend(options = {}) {
  // Step 1: Ensure local device identity exists
  const identity = await getOrCreateDeviceIdentity();

  // Step 2: Canonicalize public key to hex
  const exported = await exportPublicKey(identity.publicKey);
  const canonicalHex = exported.hex;

  const headers = {};
  if (options.token) {
    headers["Authorization"] = `Bearer ${options.token}`;
  }

  try {
    // Step 3: Request ephemeral challenge nonce from backend
    const challengeRes = await axiosInstance.post("/identity/challenge", {}, { headers });
    const { challengeId, serverEphemeralPublicKey, challengeNonce } = challengeRes.data;

    if (!challengeId || !serverEphemeralPublicKey || !challengeNonce) {
      throw new Error("Invalid challenge response received from server.");
    }

    // Step 4: Compute cryptographic Proof of Possession locally
    const proof = await generateBindingProof({
      clientPrivateKey: identity.privateKey,
      serverEphemeralPublicKeyHex: serverEphemeralPublicKey,
      challengeNonce,
      clientPublicKeyHex: canonicalHex,
    });

    // Step 5: Construct binding payload
    const payload = {
      publicKey: canonicalHex,
      connectId: identity.connectId,
      challengeId,
      proof,
      algorithm: "X25519",
      version: 1,
    };

    // Security Invariant Assertion: Verify no private material leaks
    if ("privateKey" in payload || "private" in payload || "pkcs8" in payload) {
      throw new Error("Security Violation: Private key material detected in binding payload.");
    }

    // Step 6: Submit proof to backend
    const res = await axiosInstance.post("/identity/bind", payload, { headers });
    return {
      success: true,
      connectId: res.data.connectId,
      publicKey: res.data.publicKey,
      status: res.data.status,
      isNew: res.data.isNew,
    };
  } catch (error) {
    const message =
      error.response?.data?.message || error.message || "Failed to bind device identity with backend";
    const status = error.response?.status;
    const err = new Error(message);
    err.status = status;
    throw err;
  }
}

/**
 * Queries public user details associated with a Connect ID.
 *
 * @param {string} connectId
 * @param {object} [options]
 * @param {string} [options.token] Optional Clerk session token
 * @returns {Promise<{ connectId: string, publicKey: string, algorithm: string, version: number, user: { fullName: string, profilePic: string } }>}
 */
export async function lookupIdentityByConnectId(connectId, options = {}) {
  let normalized;
  try {
    normalized = normalizeConnectId(connectId);
  } catch (err) {
    const formatErr = new Error(`Invalid Connect ID format: ${err.message}`);
    formatErr.status = 400;
    formatErr.code = "INVALID_FORMAT";
    throw formatErr;
  }

  const headers = {};
  if (options.token) {
    headers["Authorization"] = `Bearer ${options.token}`;
  }

  try {
    const res = await axiosInstance.get(`/identity/lookup/${encodeURIComponent(normalized)}`, {
      headers,
    });
    return res.data;
  } catch (error) {
    const status = error.response?.status;
    const message =
      error.response?.data?.message || error.message || "Failed to lookup identity";
    const err = new Error(message);
    err.status = status;

    if (status === 404) {
      err.code = "NOT_FOUND";
    } else if (status === 429) {
      err.code = "RATE_LIMITED";
      err.retryAfter = error.response?.data?.retryAfter || 60;
    } else if (status === 400) {
      err.code = "INVALID_FORMAT";
    } else {
      err.code = "UNKNOWN_ERROR";
    }

    throw err;
  }
}

/**
 * Retrieves all registered device identities for the authenticated user (legacy).
 *
 * @param {object} [options]
 * @param {string} [options.token] Optional Clerk session token
 * @returns {Promise<Array<{ connectId: string, publicKey: string, algorithm: string, version: number, createdAt: string }>>}
 */
export async function fetchMyRegisteredIdentities(options = {}) {
  const headers = {};
  if (options.token) {
    headers["Authorization"] = `Bearer ${options.token}`;
  }

  const res = await axiosInstance.get("/identity/me", { headers });
  return res.data.identities || res.data.devices;
}

/**
 * Retrieves all device identities owned by the authenticated account.
 *
 * @param {object} [options]
 * @param {string} [options.token] Optional Clerk session token
 * @returns {Promise<Array<{ _id: string, connectId: string, publicKey: string, algorithm: string, version: number, status: string, boundAt: string, lastVerifiedAt: string, createdAt: string }>>}
 */
export async function fetchMyDevices(options = {}) {
  const headers = {};
  if (options.token) {
    headers["Authorization"] = `Bearer ${options.token}`;
  }

  try {
    const res = await axiosInstance.get("/identity/devices", { headers });
    return res.data.devices || [];
  } catch (error) {
    const message =
      error.response?.data?.message || error.message || "Failed to fetch registered devices";
    const status = error.response?.status;
    const err = new Error(message);
    err.status = status;
    throw err;
  }
}

/**
 * Revokes a specific device identity owned by the authenticated user.
 *
 * @param {object} params
 * @param {string} params.deviceId The MongoDB _id of the device identity to revoke
 * @param {string} [params.token] Optional Clerk session token
 * @returns {Promise<{ success: boolean, deviceId: string, status: string, revokedAt: string }>}
 */
export async function revokeDeviceIdentity({ deviceId, token } = {}) {
  if (!deviceId) {
    throw new Error("deviceId is required to revoke device identity");
  }

  const headers = {};
  if (token) {
    headers["Authorization"] = `Bearer ${token}`;
  }

  try {
    const res = await axiosInstance.post(`/identity/devices/${deviceId}/revoke`, {}, { headers });
    return {
      success: true,
      deviceId: res.data.deviceId,
      status: res.data.status,
      revokedAt: res.data.revokedAt,
    };
  } catch (error) {
    const message =
      error.response?.data?.message || error.message || "Failed to revoke device identity";
    const status = error.response?.status;
    const err = new Error(message);
    err.status = status;
    throw err;
  }
}

