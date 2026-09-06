import { generateIdentityKeyPair, exportPublicKey } from "./keypair.js";
import { loadIdentityKeyPair, saveIdentityKeyPair, clearIdentityKeyPair } from "./storage.js";
import { deriveConnectId } from "./connect-id.js";

// Cached in-memory active device identity
let activeIdentity = null;

/**
 * High-level idempotent entry point for device cryptographic identity and Connect ID.
 * 
 * Flow:
 * 1. Checks in-memory cache.
 * 2. Checks local persistent storage (IndexedDB).
 * 3. If missing, generates a fresh X25519 keypair and persists it.
 * 4. Derives deterministic Connect ID from canonical public key.
 * 5. Returns canonical identity object containing public metadata, connectId, and internal CryptoKey references.
 * 
 * @returns {Promise<{
 *   version: number,
 *   algorithm: string,
 *   connectId: string,
 *   publicKeyRaw: Uint8Array,
 *   publicKeyHex: string,
 *   publicKeyBase64: string,
 *   createdAt: string,
 *   publicKey: CryptoKey,
 *   privateKey: CryptoKey,
 * }>}
 */
export async function getOrCreateDeviceIdentity() {
  if (activeIdentity) {
    return activeIdentity;
  }

  // 1. Try loading existing persisted identity
  const existing = await loadIdentityKeyPair();

  if (existing) {
    const exportedPublic = await exportPublicKey(existing.publicKey);
    const connectId = await deriveConnectId(exportedPublic.raw);

    activeIdentity = {
      version: exportedPublic.version,
      algorithm: exportedPublic.algorithm,
      connectId,
      publicKeyRaw: exportedPublic.raw,
      publicKeyHex: exportedPublic.hex,
      publicKeyBase64: exportedPublic.base64,
      createdAt: existing.createdAt,
      publicKey: existing.publicKey,
      privateKey: existing.privateKey,
    };

    return activeIdentity;
  }

  // 2. Generate fresh keypair if no record exists
  const newKeyPair = await generateIdentityKeyPair();
  await saveIdentityKeyPair(newKeyPair);

  const exportedPublic = await exportPublicKey(newKeyPair.publicKey);
  const connectId = await deriveConnectId(exportedPublic.raw);
  const now = new Date().toISOString();

  activeIdentity = {
    version: exportedPublic.version,
    algorithm: exportedPublic.algorithm,
    connectId,
    publicKeyRaw: exportedPublic.raw,
    publicKeyHex: exportedPublic.hex,
    publicKeyBase64: exportedPublic.base64,
    createdAt: now,
    publicKey: newKeyPair.publicKey,
    privateKey: newKeyPair.privateKey,
  };

  return activeIdentity;
}

/**
 * Returns the currently active in-memory device identity without triggering generation.
 * @returns {object|null}
 */
export function getActiveDeviceIdentity() {
  return activeIdentity;
}

/**
 * Returns the active device's Connect ID if loaded, or null.
 * @returns {string|null}
 */
export function getDeviceConnectId() {
  return activeIdentity?.connectId || null;
}

/**
 * Resets the in-memory cache and clears storage (for testing and isolated resets).
 * @returns {Promise<void>}
 */
export async function resetDeviceIdentity() {
  activeIdentity = null;
  await clearIdentityKeyPair();
}
