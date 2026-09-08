/**
 * TALK Extended Triple Diffie-Hellman (X3DH) Protocol Engine (Feature 2 — Phase 3)
 * 
 * Implements client-side asynchronous session establishment per the Signal X3DH specification:
 * 1. Mutual identity authentication (DH1)
 * 2. Forward secrecy against identity key compromise (DH2)
 * 3. Forward secrecy against prekey compromise (DH3)
 * 4. Disposable forward secrecy via single-use One-Time Prekeys (DH4)
 * 
 * Guarantees:
 * - Deterministic, symmetric master secret derivation via HKDF-SHA-256
 * - Automatic graceful fallback to Triple-DH if OPKs are depleted
 * - Immediate local OPK destruction upon receipt
 * - Zero-secret wire payload assertions
 */

import {
  DH_ALGORITHM,
  SIGNATURE_ALGORITHM,
  PROTOCOL_VERSION,
  DOMAIN_TAGS,
  X25519_PUBLIC_KEY_SIZE,
} from "./constants.js";
import {
  validatePrekeyBundle,
  validateX3DHHeader,
  buildSignedPrekeySignableBytes,
} from "./types.js";
import { assertNoSecretMaterial } from "./envelope.js";
import { consumeLocalOneTimePrekey } from "./storage.js";
import { getSubtleCrypto, hexToBytes, bytesToHex } from "../utils.js";
import { CryptographicError } from "../errors.js";

/**
 * Generates a fresh ephemeral X25519 keypair for session initiation.
 * @returns {Promise<CryptoKeyPair>}
 */
export async function generateEphemeralKeyPair() {
  const subtle = getSubtleCrypto();
  return subtle.generateKey(
    { name: DH_ALGORITHM },
    true,
    ["deriveBits", "deriveKey"]
  );
}

/**
 * Computes raw 32-byte X25519 Diffie-Hellman scalar multiplication.
 * 
 * @param {CryptoKey} privateKey - Local X25519 private key
 * @param {CryptoKey} publicKey - Peer X25519 public key
 * @returns {Promise<Uint8Array>} 32-byte raw shared secret
 */
export async function computeDiffieHellman(privateKey, publicKey) {
  const subtle = getSubtleCrypto();
  const bits = await subtle.deriveBits(
    {
      name: DH_ALGORITHM,
      public: publicKey,
    },
    privateKey,
    256
  );
  return new Uint8Array(bits);
}

/**
 * Imports a raw 32-byte X25519 public key into a Web Crypto CryptoKey.
 * 
 * @param {string|Uint8Array} publicKey - 64 hex chars or 32 raw bytes
 * @returns {Promise<CryptoKey>}
 */
export async function importX25519PublicKey(publicKey) {
  const bytes = typeof publicKey === "string" ? hexToBytes(publicKey) : publicKey;
  if (bytes.byteLength !== X25519_PUBLIC_KEY_SIZE) {
    throw new CryptographicError(`Invalid X25519 public key size: expected ${X25519_PUBLIC_KEY_SIZE} bytes`);
  }
  const subtle = getSubtleCrypto();
  return subtle.importKey(
    "raw",
    bytes,
    { name: DH_ALGORITHM },
    true,
    []
  );
}

/**
 * Imports a raw 32-byte Ed25519 public key into a Web Crypto CryptoKey for signature verification.
 * 
 * @param {string|Uint8Array} publicKey - 64 hex chars or 32 raw bytes
 * @returns {Promise<CryptoKey>}
 */
export async function importEd25519PublicKey(publicKey) {
  const bytes = typeof publicKey === "string" ? hexToBytes(publicKey) : publicKey;
  const subtle = getSubtleCrypto();
  return subtle.importKey(
    "raw",
    bytes,
    { name: SIGNATURE_ALGORITHM },
    true,
    ["verify"]
  );
}

/**
 * Verifies the Ed25519 signature of a Signed Prekey against the peer's signing identity key.
 * 
 * @param {string} identityKeySignHex - 64-char hex Ed25519 public key
 * @param {object} signedPrekey - { keyId, publicKey, signature }
 * @returns {Promise<boolean>}
 */
export async function verifySignedPrekeySignature(identityKeySignHex, signedPrekey) {
  try {
    const signingKey = await importEd25519PublicKey(identityKeySignHex);
    const keyId = signedPrekey.keyId;
    const publicKey = signedPrekey.publicKeyHex || signedPrekey.publicKey;
    const signatureHex = signedPrekey.signature || signedPrekey.signatureHex;

    if (!signatureHex) {
      return false;
    }

    const signableBytes = buildSignedPrekeySignableBytes(keyId, publicKey);
    const signatureBytes = hexToBytes(signatureHex);
    const subtle = getSubtleCrypto();

    return subtle.verify(
      { name: SIGNATURE_ALGORITHM },
      signingKey,
      signatureBytes,
      signableBytes
    );
  } catch (err) {
    throw new CryptographicError("Failed to verify Signed Prekey signature", err);
  }
}


/**
 * Derives the Master Shared Secret (SK) and initial Root Key (RK) from the concatenated DH outputs.
 * Uses HKDF-SHA-256 with standard domain separation tags.
 * 
 * @param {Uint8Array} dhConcatBytes - Concatenation of DH1 || DH2 || DH3 [|| DH4]
 * @returns {Promise<{ masterSecretHex: string, rootKeyHex: string }>}
 */
export async function deriveX3DHSecrets(dhConcatBytes) {
  const subtle = getSubtleCrypto();
  const zeroSalt = new Uint8Array(32); // Standard 32-byte zero salt per RFC 5869 / Signal

  // 1. Import IKM (concatenated DH secrets) as HKDF base key
  const baseKey = await subtle.importKey(
    "raw",
    dhConcatBytes,
    { name: "HKDF" },
    false,
    ["deriveBits"]
  );

  // 2. Derive Master Shared Secret (SK)
  const masterSecretBits = await subtle.deriveBits(
    {
      name: "HKDF",
      hash: "SHA-256",
      salt: zeroSalt,
      info: new TextEncoder().encode("TALK-X3DH-V1:MASTER-SECRET"),
    },
    baseKey,
    256
  );
  const masterSecretBytes = new Uint8Array(masterSecretBits);

  // 3. Derive Initial Root Key (RK) from Master Secret
  const rootBaseKey = await subtle.importKey(
    "raw",
    masterSecretBytes,
    { name: "HKDF" },
    false,
    ["deriveBits"]
  );

  const rootKeyBits = await subtle.deriveBits(
    {
      name: "HKDF",
      hash: "SHA-256",
      salt: zeroSalt,
      info: new TextEncoder().encode(DOMAIN_TAGS.X3DH_INFO),
    },
    rootBaseKey,
    256
  );
  const rootKeyBytes = new Uint8Array(rootKeyBits);

  return {
    masterSecretHex: bytesToHex(masterSecretBytes),
    rootKeyHex: bytesToHex(rootKeyBytes),
  };
}

/**
 * Computes a deterministic session ID scoped to the local device and peer.
 * 
 * @param {string} localConnectId
 * @param {string} peerConnectId
 * @param {string} ephemeralPublicKeyHex
 * @returns {Promise<string>}
 */
export async function computeSessionId(localConnectId, peerConnectId, ephemeralPublicKeyHex) {
  const subtle = getSubtleCrypto();
  const input = `${localConnectId}->${peerConnectId}:${ephemeralPublicKeyHex}`;
  const hash = await subtle.digest("SHA-256", new TextEncoder().encode(input));
  return `session_${bytesToHex(new Uint8Array(hash)).substring(0, 32)}`;
}


/**
 * Initiates an X3DH cryptographic session (Alice / Sender).
 * 
 * @param {object} params
 * @param {object} params.localIdentityKeyPair - Alice's X25519 identity keypair { publicKey, privateKey, publicKeyHex }
 * @param {string} params.localConnectId - Alice's Connect ID
 * @param {object} params.peerBundle - Bob's verified prekey bundle from registry
 * @returns {Promise<object>} Initialized session parameters and public handshake header
 */
export async function initiateX3DHSession({
  localIdentityKeyPair,
  localConnectId,
  peerBundle,
}) {
  if (!localIdentityKeyPair || !localIdentityKeyPair.privateKey || !localIdentityKeyPair.publicKeyHex) {
    throw new CryptographicError("Missing local identity keypair for X3DH initialization");
  }
  if (!localConnectId) {
    throw new CryptographicError("Missing local Connect ID for X3DH initialization");
  }
  if (!peerBundle || !validatePrekeyBundle(peerBundle)) {
    throw new CryptographicError("Invalid peer prekey bundle for X3DH initialization");
  }

  // 1. Verify Bob's SPK signature with Bob's Ed25519 identity key
  const isSignatureValid = await verifySignedPrekeySignature(
    peerBundle.identityKeySign,
    peerBundle.signedPrekey
  );
  if (!isSignatureValid) {
    throw new CryptographicError("Bob's Signed Prekey signature verification failed (possible forgery or tampering)");
  }

  // 2. Generate Alice's fresh Ephemeral Keypair (EK_A)
  const ephemeralKeyPair = await generateEphemeralKeyPair();
  const subtle = getSubtleCrypto();
  const ephemeralRawPub = await subtle.exportKey("raw", ephemeralKeyPair.publicKey);
  const ephemeralPublicKeyHex = bytesToHex(new Uint8Array(ephemeralRawPub));

  // 3. Import Bob's public keys
  const peerSpk = await importX25519PublicKey(peerBundle.signedPrekey.publicKey);
  const peerIdentityKeyDh = await importX25519PublicKey(peerBundle.identityKeyDh);
  const hasOpk = Boolean(peerBundle.oneTimePrekey);
  const peerOpk = hasOpk ? await importX25519PublicKey(peerBundle.oneTimePrekey.publicKey) : null;

  // 4. Compute Diffie-Hellman agreements:
  // DH1 = DH(IK_A, SPK_B)
  const dh1 = await computeDiffieHellman(localIdentityKeyPair.privateKey, peerSpk);
  // DH2 = DH(EK_A, IK_B)
  const dh2 = await computeDiffieHellman(ephemeralKeyPair.privateKey, peerIdentityKeyDh);
  // DH3 = DH(EK_A, SPK_B)
  const dh3 = await computeDiffieHellman(ephemeralKeyPair.privateKey, peerSpk);
  // DH4 = DH(EK_A, OPK_B) (if OPK present)
  const dh4 = hasOpk ? await computeDiffieHellman(ephemeralKeyPair.privateKey, peerOpk) : null;

  // 5. Concatenate DH outputs
  const dhLength = hasOpk ? 128 : 96;
  const dhConcat = new Uint8Array(dhLength);
  dhConcat.set(dh1, 0);
  dhConcat.set(dh2, 32);
  dhConcat.set(dh3, 64);
  if (hasOpk) {
    dhConcat.set(dh4, 96);
  }

  // 6. Derive Master Secret and Root Key
  const { masterSecretHex, rootKeyHex } = await deriveX3DHSecrets(dhConcat);

  // 7. Construct Handshake Header for the wire
  const peerConnectId = peerBundle.connectId || peerBundle.deviceId;
  const sessionId = await computeSessionId(localConnectId, peerConnectId, ephemeralPublicKeyHex);

  const x3dhHeader = {
    version: PROTOCOL_VERSION,
    senderConnectId: localConnectId,
    senderIdentityKeyDh: localIdentityKeyPair.publicKeyHex,
    ephemeralPublicKey: ephemeralPublicKeyHex,
    spkKeyId: peerBundle.signedPrekey.keyId,
    opkKeyId: hasOpk ? peerBundle.oneTimePrekey.keyId : null,
    oneTimePrekeyUsed: hasOpk,
  };

  // Zero-secret assertion
  assertNoSecretMaterial(x3dhHeader);

  return {
    sessionId,
    masterSecretHex,
    rootKeyHex,
    x3dhHeader,
    ephemeralPublicKeyHex,
    peerConnectId,
    peerIdentityKeyDh: peerBundle.identityKeyDh,
    isTripleDhFallback: !hasOpk,
    handshakeRole: "INITIATOR",
  };
}

/**
 * Receives an initial X3DH handshake and derives the matching master secret (Bob / Receiver).
 * 
 * @param {object} params
 * @param {object} params.localIdentityKeyPair - Bob's X25519 identity keypair { publicKey, privateKey, publicKeyHex }
 * @param {string} params.localConnectId - Bob's Connect ID
 * @param {object} params.localSignedPrekey - Bob's active signed prekey record { keyId, publicKey, privateKey }
 * @param {object} params.x3dhHeader - Alice's incoming handshake header
 * @param {Function} [params.consumeOpkFn] - Optional hook to consume local OPK (defaults to storage function)
 * @returns {Promise<object>} Established session parameters matching Alice's derivation
 */
export async function receiveX3DHSession({
  localIdentityKeyPair,
  localConnectId,
  localSignedPrekey,
  x3dhHeader,
  consumeOpkFn = consumeLocalOneTimePrekey,
}) {
  if (!localIdentityKeyPair || !localIdentityKeyPair.privateKey) {
    throw new CryptographicError("Missing local identity keypair for X3DH reception");
  }
  if (!localSignedPrekey || !localSignedPrekey.privateKey) {
    throw new CryptographicError("Missing local signed prekey private key for X3DH reception");
  }
  if (!x3dhHeader || !validateX3DHHeader(x3dhHeader)) {
    throw new CryptographicError("Invalid incoming X3DH handshake header");
  }

  // 1. Verify SPK keyId matches Bob's local SPK
  if (x3dhHeader.spkKeyId !== localSignedPrekey.keyId) {
    throw new CryptographicError(`Signed prekey ID mismatch: expected ${localSignedPrekey.keyId}, got ${x3dhHeader.spkKeyId}`);
  }

  // 2. If OPK was used, retrieve and immediately ERASE Bob's local OPK private key
  let localOpk = null;
  if (x3dhHeader.oneTimePrekeyUsed) {
    localOpk = await consumeOpkFn(x3dhHeader.opkKeyId);
    if (!localOpk || !localOpk.privateKey) {
      throw new CryptographicError(`One-Time Prekey (ID: ${x3dhHeader.opkKeyId}) not found or already consumed`);
    }
  }

  // 3. Import Alice's public keys
  const aliceIdentityKeyDh = await importX25519PublicKey(x3dhHeader.senderIdentityKeyDh);
  const aliceEphemeralKey = await importX25519PublicKey(x3dhHeader.ephemeralPublicKey);

  // 4. Compute matching Diffie-Hellman agreements:
  // DH1 = DH(SPK_B, IK_A)
  const dh1 = await computeDiffieHellman(localSignedPrekey.privateKey, aliceIdentityKeyDh);
  // DH2 = DH(IK_B, EK_A)
  const dh2 = await computeDiffieHellman(localIdentityKeyPair.privateKey, aliceEphemeralKey);
  // DH3 = DH(SPK_B, EK_A)
  const dh3 = await computeDiffieHellman(localSignedPrekey.privateKey, aliceEphemeralKey);
  // DH4 = DH(OPK_B, EK_A) (if OPK was used)
  const dh4 = localOpk ? await computeDiffieHellman(localOpk.privateKey, aliceEphemeralKey) : null;

  // 5. Concatenate DH outputs
  const hasOpk = Boolean(localOpk);
  const dhLength = hasOpk ? 128 : 96;
  const dhConcat = new Uint8Array(dhLength);
  dhConcat.set(dh1, 0);
  dhConcat.set(dh2, 32);
  dhConcat.set(dh3, 64);
  if (hasOpk) {
    dhConcat.set(dh4, 96);
  }

  // 6. Derive identical Master Secret and Root Key
  const { masterSecretHex, rootKeyHex } = await deriveX3DHSecrets(dhConcat);

  const sessionId = await computeSessionId(
    localConnectId,
    x3dhHeader.senderConnectId,
    x3dhHeader.ephemeralPublicKey
  );


  return {
    sessionId,
    masterSecretHex,
    rootKeyHex,
    peerConnectId: x3dhHeader.senderConnectId,
    peerIdentityKeyDh: x3dhHeader.senderIdentityKeyDh,
    ephemeralPublicKeyHex: x3dhHeader.ephemeralPublicKey,
    oneTimePrekeyUsed: x3dhHeader.oneTimePrekeyUsed,
    handshakeRole: "RECEIVER",
  };
}
