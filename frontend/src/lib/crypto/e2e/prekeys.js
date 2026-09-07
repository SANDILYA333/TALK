/**
 * TALK Client-Side Pre-Key Generator & Manager (Feature 2 — Phase 2)
 * 
 * Implements client-side generation, Ed25519 signing, verification, and replenishment
 * for Signed Prekeys (SPK) and One-Time Prekeys (OPK).
 */

import {
  SIGNATURE_ALGORITHM,
  DH_ALGORITHM,
  PREKEY_BUNDLE_BATCH_SIZE,
  MIN_ONE_TIME_PREKEYS_THRESHOLD,
  PROTOCOL_VERSION,
} from "./constants.js";
import {
  saveSigningIdentityKeyPair,
  loadSigningIdentityKeyPair,
  saveSignedPrekeyRecord,
  loadSignedPrekeyRecord,
  saveOneTimePrekeysPool,
  appendOneTimePrekeysToPool,
  loadOneTimePrekeysPool,
} from "./storage.js";
import { buildSignedPrekeySignableBytes } from "./types.js";
import { KeyGenerationError, CryptographicError } from "../errors.js";
import { getSubtleCrypto, bytesToHex, hexToBytes } from "../utils.js";

/**
 * Generates an Ed25519 signing identity keypair for authenticating prekeys.
 * 
 * @returns {Promise<{ privateKey: CryptoKey, publicKey: CryptoKey }>}
 */
export async function generateSigningIdentityKeyPair() {
  const subtle = getSubtleCrypto();
  try {
    const pair = await subtle.generateKey(
      { name: SIGNATURE_ALGORITHM },
      true,
      ["sign", "verify"]
    );
    return pair;
  } catch (error) {
    throw new KeyGenerationError("Failed to generate Ed25519 signing identity keypair", error);
  }
}

/**
 * Generates an X25519 Signed Prekey (SPK) and signs it with the device's Ed25519 signing private key.
 * 
 * @param {CryptoKey} signingPrivateKey - Device's Ed25519 private key
 * @param {number} [keyId=1] - Numeric identifier for this signed prekey
 * @returns {Promise<{
 *   keyId: number,
 *   publicKey: CryptoKey,
 *   privateKey: CryptoKey,
 *   publicKeyHex: string,
 *   signatureHex: string,
 *   createdAt: string,
 *   version: number
 * }>}
 */
export async function generateSignedPrekey(signingPrivateKey, keyId = 1) {
  if (!signingPrivateKey || signingPrivateKey.type !== "private") {
    throw new CryptographicError("Valid signing private key is required to create a Signed Prekey");
  }

  const subtle = getSubtleCrypto();

  try {
    // 1. Generate X25519 DH Prekey Pair
    const spkPair = await subtle.generateKey(
      { name: DH_ALGORITHM },
      true,
      ["deriveBits", "deriveKey"]
    );

    // 2. Export public key raw bytes
    const rawPub = new Uint8Array(await subtle.exportKey("raw", spkPair.publicKey));
    const publicKeyHex = bytesToHex(rawPub);

    // 3. Build canonical signable payload: "TALK-SPK-AUTH-V1:" || keyId (4 bytes) || rawPub (32 bytes)
    const signableBytes = buildSignedPrekeySignableBytes(keyId, rawPub);

    // 4. Sign payload using Ed25519
    const sigBuffer = await subtle.sign(
      { name: SIGNATURE_ALGORITHM },
      signingPrivateKey,
      signableBytes
    );
    const signatureHex = bytesToHex(new Uint8Array(sigBuffer));

    return {
      keyId,
      publicKey: spkPair.publicKey,
      privateKey: spkPair.privateKey,
      publicKeyHex,
      signatureHex,
      createdAt: new Date().toISOString(),
      version: 1,
    };
  } catch (error) {
    if (error instanceof CryptographicError) throw error;
    throw new KeyGenerationError("Failed to generate and sign Signed Prekey", error);
  }
}

/**
 * Verifies an Ed25519 signature on a Signed Prekey.
 * 
 * @param {string|CryptoKey} signingPublicKey - Ed25519 public key (hex string or CryptoKey)
 * @param {object} signedPrekey - { keyId: number, publicKey: string|CryptoKey, signatureHex?: string, signature?: string }
 * @returns {Promise<boolean>}
 */
export async function verifySignedPrekeySignature(signingPublicKey, signedPrekey) {
  const subtle = getSubtleCrypto();

  try {
    let signPubKey = signingPublicKey;
    if (typeof signingPublicKey === "string") {
      const pubBytes = hexToBytes(signingPublicKey);
      signPubKey = await subtle.importKey(
        "raw",
        pubBytes,
        { name: SIGNATURE_ALGORITHM },
        true,
        ["verify"]
      );
    }

    let rawSpkBytes;
    if (typeof signedPrekey.publicKey === "string") {
      rawSpkBytes = hexToBytes(signedPrekey.publicKey);
    } else {
      rawSpkBytes = new Uint8Array(await subtle.exportKey("raw", signedPrekey.publicKey));
    }

    const signableBytes = buildSignedPrekeySignableBytes(signedPrekey.keyId, rawSpkBytes);
    const sigHex = signedPrekey.signatureHex || signedPrekey.signature;
    const sigBytes = hexToBytes(sigHex);

    return await subtle.verify(
      { name: SIGNATURE_ALGORITHM },
      signPubKey,
      sigBytes,
      signableBytes
    );
  } catch {
    return false;
  }
}

/**
 * Generates a batch of X25519 One-Time Prekeys (OPKs).
 * 
 * @param {number} [startKeyId=1] - Starting numeric identifier
 * @param {number} [count=PREKEY_BUNDLE_BATCH_SIZE] - Number of OPKs to generate
 * @returns {Promise<Array<{ keyId: number, publicKey: CryptoKey, privateKey: CryptoKey, publicKeyHex: string, createdAt: string }>>}
 */
export async function generateOneTimePrekeyBatch(startKeyId = 1, count = PREKEY_BUNDLE_BATCH_SIZE) {
  const subtle = getSubtleCrypto();
  const opkList = [];

  for (let i = 0; i < count; i++) {
    const keyId = startKeyId + i;
    const pair = await subtle.generateKey(
      { name: DH_ALGORITHM },
      true,
      ["deriveBits", "deriveKey"]
    );
    const rawPub = new Uint8Array(await subtle.exportKey("raw", pair.publicKey));
    opkList.push({
      keyId,
      publicKey: pair.publicKey,
      privateKey: pair.privateKey,
      publicKeyHex: bytesToHex(rawPub),
      createdAt: new Date().toISOString(),
    });
  }

  return opkList;
}

/**
 * Idempotently initializes or loads all local prekey material for the current device.
 * 
 * Returns the public bundle payload ready for server registration alongside in-memory CryptoKeys.
 * 
 * @param {object} deviceIdentity - Active device identity from getOrCreateDeviceIdentity()
 * @returns {Promise<{
 *   publicBundle: object,
 *   signingIdentity: object,
 *   signedPrekey: object,
 *   oneTimePrekeys: Array<object>
 * }>}
 */
export async function getOrCreateDevicePrekeys(deviceIdentity) {
  if (!deviceIdentity || !deviceIdentity.connectId) {
    throw new CryptographicError("Valid device identity is required to initialize prekeys");
  }

  // 1. Load or generate Signing Identity Keypair (Ed25519)
  let signingIdentity = await loadSigningIdentityKeyPair();
  if (!signingIdentity) {
    const newPair = await generateSigningIdentityKeyPair();
    await saveSigningIdentityKeyPair(newPair);
    signingIdentity = await loadSigningIdentityKeyPair();
  }

  // 2. Load or generate Signed Prekey (X25519)
  let signedPrekey = await loadSignedPrekeyRecord();
  if (!signedPrekey) {
    const newSpk = await generateSignedPrekey(signingIdentity.privateKey, 1);
    await saveSignedPrekeyRecord(newSpk);
    signedPrekey = await loadSignedPrekeyRecord();
  }

  // 3. Load or generate One-Time Prekeys pool
  let opkPool = await loadOneTimePrekeysPool();
  if (!opkPool || opkPool.length === 0) {
    const newOpks = await generateOneTimePrekeyBatch(1, PREKEY_BUNDLE_BATCH_SIZE);
    await saveOneTimePrekeysPool(newOpks);
    opkPool = await loadOneTimePrekeysPool();
  }

  // Assemble public bundle format for wire transmission
  const publicBundle = {
    connectId: deviceIdentity.connectId,
    identityKeyDh: deviceIdentity.publicKeyHex,
    identityKeySign: signingIdentity.publicKeyHex,
    signedPrekey: {
      keyId: signedPrekey.keyId,
      publicKey: signedPrekey.publicKeyHex,
      signature: signedPrekey.signatureHex,
      createdAt: signedPrekey.createdAt,
      version: signedPrekey.version,
    },
    oneTimePrekeys: opkPool.map((k) => ({
      keyId: k.keyId,
      publicKey: k.publicKeyHex,
    })),
    protocolVersion: PROTOCOL_VERSION,
  };

  return {
    publicBundle,
    signingIdentity,
    signedPrekey,
    oneTimePrekeys: opkPool,
  };
}

/**
 * Checks local OPK inventory and generates additional keys if below threshold.
 * 
 * @param {number} [minThreshold=MIN_ONE_TIME_PREKEYS_THRESHOLD]
 * @returns {Promise<Array<{ keyId: number, publicKey: string }> | null>} Newly generated public OPKs or null
 */
export async function replenishLocalPrekeysIfNeeded(minThreshold = MIN_ONE_TIME_PREKEYS_THRESHOLD) {
  const currentPool = await loadOneTimePrekeysPool();
  if (currentPool.length < minThreshold) {
    const maxExistingKeyId = currentPool.reduce((max, k) => Math.max(max, k.keyId), 0);
    const newBatch = await generateOneTimePrekeyBatch(
      maxExistingKeyId + 1,
      PREKEY_BUNDLE_BATCH_SIZE
    );
    await appendOneTimePrekeysToPool(newBatch);

    return newBatch.map((k) => ({
      keyId: k.keyId,
      publicKey: k.publicKeyHex,
    }));
  }
  return null;
}
