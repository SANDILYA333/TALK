import crypto from "node:crypto";

const SIGNED_PREKEY_SIGNATURE_PREFIX = "TALK-SPK-AUTH-V1:";
const ED25519_PUBLIC_KEY_SIZE = 32;
const ED25519_SIGNATURE_SIZE = 64;
const X25519_PUBLIC_KEY_SIZE = 32;

/**
 * Builds the canonical byte representation of a Signed Prekey to be verified.
 * 
 * Canonical representation:
 * "TALK-SPK-AUTH-V1:" || keyId (4 bytes BE uint32) || spkPublicKey (32 raw bytes)
 * 
 * @param {number} keyId
 * @param {string|Buffer} publicKeyHexOrBytes
 * @returns {Buffer}
 */
export function buildSignedPrekeySignableBuffer(keyId, publicKeyHexOrBytes) {
  if (typeof keyId !== "number" || keyId < 0 || !Number.isInteger(keyId)) {
    throw new Error("Invalid keyId for signed prekey verification");
  }

  const rawKeyBuffer = Buffer.isBuffer(publicKeyHexOrBytes)
    ? publicKeyHexOrBytes
    : Buffer.from(publicKeyHexOrBytes, "hex");

  if (rawKeyBuffer.length !== X25519_PUBLIC_KEY_SIZE) {
    throw new Error(`Invalid signed prekey length: expected ${X25519_PUBLIC_KEY_SIZE} bytes`);
  }

  const prefixBuffer = Buffer.from(SIGNED_PREKEY_SIGNATURE_PREFIX, "utf8");
  const keyIdBuffer = Buffer.alloc(4);
  keyIdBuffer.writeUInt32BE(keyId, 0);

  return Buffer.concat([prefixBuffer, keyIdBuffer, rawKeyBuffer]);
}

/**
 * Verifies an Ed25519 signature on a Signed Prekey using Web Crypto API.
 * 
 * @param {object} params
 * @param {string} params.signingPublicKeyHex - 64-char hex string of device's Ed25519 signing public key
 * @param {number} params.keyId - Numeric ID of the signed prekey
 * @param {string} params.signedPrekeyPublicKeyHex - 64-char hex string of the X25519 signed prekey
 * @param {string} params.signatureHex - 128-char hex string of the Ed25519 signature
 * @returns {Promise<boolean>} True if signature is valid
 */
export async function verifySignedPrekeySignature({
  signingPublicKeyHex,
  keyId,
  signedPrekeyPublicKeyHex,
  signatureHex,
}) {
  try {
    if (
      !signingPublicKeyHex ||
      typeof signingPublicKeyHex !== "string" ||
      signingPublicKeyHex.length !== ED25519_PUBLIC_KEY_SIZE * 2
    ) {
      return false;
    }

    if (
      !signedPrekeyPublicKeyHex ||
      typeof signedPrekeyPublicKeyHex !== "string" ||
      signedPrekeyPublicKeyHex.length !== X25519_PUBLIC_KEY_SIZE * 2
    ) {
      return false;
    }

    if (
      !signatureHex ||
      typeof signatureHex !== "string" ||
      signatureHex.length !== ED25519_SIGNATURE_SIZE * 2
    ) {
      return false;
    }

    const { subtle } = globalThis.crypto;

    // 1. Import Ed25519 signing public key
    const rawSigningPubKey = Buffer.from(signingPublicKeyHex, "hex");
    const cryptoPubKey = await subtle.importKey(
      "raw",
      rawSigningPubKey,
      { name: "Ed25519" },
      false,
      ["verify"]
    );

    // 2. Build signable buffer
    const signableBuffer = buildSignedPrekeySignableBuffer(keyId, signedPrekeyPublicKeyHex);

    // 3. Verify signature
    const signatureBuffer = Buffer.from(signatureHex, "hex");
    return await subtle.verify(
      { name: "Ed25519" },
      cryptoPubKey,
      signatureBuffer,
      signableBuffer
    );
  } catch {
    return false;
  }
}
