/**
 * TALK Pre-Key API Service (Feature 2 — Phase 2)
 * 
 * HTTP client communicating with backend prekey registry.
 * Guarantees zero private key transmission via strict assertNoSecretMaterial guards.
 */

import { axiosInstance } from "../axios.js";
import { assertNoSecretMaterial } from "../crypto/e2e/envelope.js";
import { CryptographicError } from "../crypto/errors.js";

/**
 * Registers or updates the public Prekey Bundle on the server registry.
 * 
 * @param {object} publicBundle
 * @returns {Promise<object>}
 */
export async function registerPrekeyBundleWithBackend(publicBundle) {
  if (!publicBundle || typeof publicBundle !== "object") {
    throw new CryptographicError("Invalid prekey bundle for registration");
  }

  // Enforce zero-secret invariant before wire transmission
  assertNoSecretMaterial(publicBundle);

  try {
    const response = await axiosInstance.post("/identity/prekeys/register", publicBundle);
    return response.data;
  } catch (error) {
    const message = error.response?.data?.message || error.message || "Failed to register prekey bundle";
    throw new CryptographicError({
      message,
      code: "PREKEY_REGISTRATION_FAILED",
      cause: error,
      isTransient: !error.response || error.response.status >= 500,
      userMessage: "Unable to publish cryptographic prekeys. Please check your connection.",
    });
  }
}

/**
 * Retrieves another user's public Prekey Bundle with single-use atomic OPK consumption.
 * 
 * @param {string} connectId
 * @returns {Promise<object>}
 */
export async function fetchPeerPrekeyBundle(connectId) {
  if (!connectId || typeof connectId !== "string") {
    throw new CryptographicError("Valid Connect ID is required to fetch prekey bundle");
  }

  try {
    const response = await axiosInstance.get(`/identity/prekeys/bundle/${encodeURIComponent(connectId)}`);
    const bundle = response.data;

    // Verify received bundle contains no private keys
    assertNoSecretMaterial(bundle);

    return bundle;
  } catch (error) {
    const status = error.response?.status;
    const message = error.response?.data?.message || error.message || "Failed to fetch prekey bundle";

    throw new CryptographicError({
      message,
      code: status === 404 ? "PREKEY_BUNDLE_NOT_FOUND" : "PREKEY_FETCH_FAILED",
      cause: error,
      isTransient: !status || status >= 500,
      userMessage: status === 404 ? "The recipient has not published encryption prekeys." : "Failed to retrieve prekeys.",
    });
  }
}

export const fetchPrekeyBundleByConnectId = fetchPeerPrekeyBundle;


/**
 * Replenishes One-Time Prekeys for the active device on the server.
 * 
 * @param {string} connectId
 * @param {Array<{ keyId: number, publicKey: string }>} oneTimePrekeys
 * @returns {Promise<object>}
 */
export async function replenishPrekeysWithBackend(connectId, oneTimePrekeys) {
  const payload = { connectId, oneTimePrekeys };
  assertNoSecretMaterial(payload);

  try {
    const response = await axiosInstance.post("/identity/prekeys/replenish", payload);
    return response.data;
  } catch (error) {
    const message = error.response?.data?.message || error.message || "Failed to replenish prekeys";
    throw new CryptographicError({
      message,
      code: "PREKEY_REPLENISH_FAILED",
      cause: error,
      isTransient: true,
      userMessage: "Failed to upload new encryption prekeys.",
    });
  }
}

/**
 * Checks the active prekey inventory status on the backend.
 * 
 * @param {string} [connectId]
 * @returns {Promise<{ hasBundle: boolean, activeOpkCount: number, needsReplenishment: boolean }>}
 */
export async function fetchPrekeyStatus(connectId) {
  try {
    const path = connectId
      ? `/identity/prekeys/status/${encodeURIComponent(connectId)}`
      : "/identity/prekeys/status";
    const response = await axiosInstance.get(path);
    return response.data;
  } catch (error) {
    const message = error.response?.data?.message || error.message || "Failed to fetch prekey status";
    throw new CryptographicError({
      message,
      code: "PREKEY_STATUS_FAILED",
      cause: error,
      isTransient: true,
    });
  }
}
