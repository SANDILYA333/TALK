import { getSubtleCrypto, hexToBytes, bytesToHex } from "./utils.js";
import { CryptographicError } from "./errors.js";

export const BINDING_DOMAIN_TAG = "TALK-IDENTITY-BINDING-V1:";

/**
 * Generates a cryptographic Proof-of-Possession (PoP) proving the client holds the private key
 * corresponding to clientPublicKeyHex, using X25519 Diffie-Hellman key agreement with the server's
 * ephemeral public key and domain-separated HMAC-SHA256.
 *
 * Security Invariant: The client private key NEVER leaves this function or the local memory boundary.
 *
 * @param {object} params
 * @param {CryptoKey} params.clientPrivateKey Device X25519 private key
 * @param {string} params.serverEphemeralPublicKeyHex 64-char hex string of server's ephemeral public key
 * @param {string} params.challengeNonce 64-char hex string of challenge nonce
 * @param {string} params.clientPublicKeyHex 64-char hex string of client's public key
 * @returns {Promise<string>} 64-character hexadecimal HMAC-SHA256 proof string
 */
export async function generateBindingProof({
  clientPrivateKey,
  serverEphemeralPublicKeyHex,
  challengeNonce,
  clientPublicKeyHex,
}) {
  if (
    !clientPrivateKey ||
    !serverEphemeralPublicKeyHex ||
    !challengeNonce ||
    !clientPublicKeyHex
  ) {
    throw new CryptographicError("Missing required parameters for Proof of Possession");
  }

  const subtle = getSubtleCrypto();

  try {
    // 1. Import server ephemeral public key (raw 32 bytes)
    const serverKeyBytes = hexToBytes(serverEphemeralPublicKeyHex);
    const serverCryptoKey = await subtle.importKey(
      "raw",
      serverKeyBytes,
      { name: "X25519" },
      false,
      []
    );

    // 2. Perform X25519 Diffie-Hellman key agreement to derive shared secret bits
    const sharedSecretBuffer = await subtle.deriveBits(
      {
        name: "X25519",
        public: serverCryptoKey,
      },
      clientPrivateKey,
      256
    );

    // 3. Import shared secret as an HMAC key
    const hmacKey = await subtle.importKey(
      "raw",
      sharedSecretBuffer,
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"]
    );

    // 4. Construct domain-separated payload: "TALK-IDENTITY-BINDING-V1:" || challengeNonce || clientPublicKey
    const tagBytes = new TextEncoder().encode(BINDING_DOMAIN_TAG);
    const nonceBytes = hexToBytes(challengeNonce);
    const pubKeyBytes = hexToBytes(clientPublicKeyHex);

    const payload = new Uint8Array(
      tagBytes.length + nonceBytes.length + pubKeyBytes.length
    );
    payload.set(tagBytes, 0);
    payload.set(nonceBytes, tagBytes.length);
    payload.set(pubKeyBytes, tagBytes.length + nonceBytes.length);

    // 5. Compute HMAC-SHA256
    const signatureBuffer = await subtle.sign("HMAC", hmacKey, payload);
    return bytesToHex(new Uint8Array(signatureBuffer));
  } catch (error) {
    if (error instanceof CryptographicError) throw error;
    throw new CryptographicError("Failed to generate Proof of Possession", error);
  }
}
