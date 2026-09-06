import crypto from "node:crypto";
import { canonicalizePublicKey } from "./connect-id.js";

// Domain separation tag for identity binding proofs
export const BINDING_DOMAIN_TAG = "TALK-IDENTITY-BINDING-V1:";
export const CHALLENGE_TTL_MS = 60 * 1000; // 60 seconds

// In-memory challenge store: challengeId -> challenge record
const activeChallenges = new Map();

// Periodic cleanup of expired challenges every 30 seconds
const cleanupTimer = setInterval(() => {
  const now = Date.now();
  for (const [id, record] of activeChallenges.entries()) {
    if (now > record.expiresAt) {
      activeChallenges.delete(id);
    }
  }
}, 30 * 1000);

if (cleanupTimer.unref) {
  cleanupTimer.unref();
}

/**
 * Generates an ephemeral X25519 challenge for Proof-of-Possession.
 *
 * @param {string} userId Authenticated user ObjectId string
 * @returns {{ challengeId: string, serverEphemeralPublicKey: string, challengeNonce: string, expiresAt: number }}
 */
export function generateBindingChallenge(userId) {
  if (!userId) {
    throw new Error("userId is required to generate binding challenge");
  }

  // 1. Generate an ephemeral server X25519 keypair
  const { publicKey: serverPub, privateKey: serverPriv } = crypto.generateKeyPairSync("x25519");
  const serverEphemeralPublicKey = serverPub
    .export({ type: "spki", format: "der" })
    .subarray(-32)
    .toString("hex");

  // 2. Generate a 32-byte cryptographic random nonce
  const nonceBytes = crypto.randomBytes(32);
  const challengeNonce = nonceBytes.toString("hex");
  const challengeId = crypto.randomUUID();
  const expiresAt = Date.now() + CHALLENGE_TTL_MS;

  // 3. Store server-side state bound to userId and server private key
  activeChallenges.set(challengeId, {
    challengeId,
    userId: userId.toString(),
    serverPrivateKey: serverPriv,
    serverEphemeralPublicKey,
    challengeNonce,
    expiresAt,
    used: false,
  });

  return {
    challengeId,
    serverEphemeralPublicKey,
    challengeNonce,
    expiresAt,
  };
}

/**
 * Verifies a client-submitted Proof-of-Possession against an active challenge.
 *
 * Verification steps:
 * 1. Challenge lookup, expiry check, and single-use enforcement (replay protection).
 * 2. Ownership binding check (challenge must belong to the same authenticated userId).
 * 3. Perform Diffie-Hellman: sharedSecret = X25519(serverPrivKey, clientPubKey).
 * 4. Compute expected HMAC: HMAC-SHA256(sharedSecret, "TALK-IDENTITY-BINDING-V1:" || challengeNonce || clientPublicKey).
 * 5. Constant-time comparison of expectedProof and clientProof.
 * 6. Invalidate challenge immediately.
 *
 * @param {object} params
 * @param {string} params.challengeId
 * @param {string} params.clientPublicKeyHex
 * @param {string} params.proofHex
 * @param {string} params.userId
 * @returns {boolean}
 */
export function verifyBindingProof({ challengeId, clientPublicKeyHex, proofHex, userId }) {
  if (!challengeId || !clientPublicKeyHex || !proofHex || !userId) {
    return false;
  }

  const record = activeChallenges.get(challengeId);
  if (!record) {
    return false;
  }

  // Replay Protection: Delete challenge immediately upon retrieval
  activeChallenges.delete(challengeId);

  // Expiry check
  if (Date.now() > record.expiresAt || record.used) {
    return false;
  }

  // Session Account Binding check: Challenge must belong to this authenticated user
  if (record.userId !== userId.toString()) {
    return false;
  }

  try {
    const { hex: canonicalClientKeyHex, bytes: clientKeyBytes } =
      canonicalizePublicKey(clientPublicKeyHex);

    // Import client public key into Node KeyObject (wrap raw 32 bytes in SPKI header)
    const spkiHeader = Buffer.from("302a300506032b656e032100", "hex");
    const clientSpki = Buffer.concat([spkiHeader, Buffer.from(clientKeyBytes)]);
    const clientKeyObject = crypto.createPublicKey({
      key: clientSpki,
      format: "der",
      type: "spki",
    });

    // Compute Diffie-Hellman shared secret
    const sharedSecret = crypto.diffieHellman({
      privateKey: record.serverPrivateKey,
      publicKey: clientKeyObject,
    });

    // Construct tagged payload: "TALK-IDENTITY-BINDING-V1:" + challengeNonce + clientPublicKeyHex
    const tagBytes = Buffer.from(BINDING_DOMAIN_TAG, "utf8");
    const nonceBytes = Buffer.from(record.challengeNonce, "hex");
    const pubKeyBytes = Buffer.from(canonicalClientKeyHex, "hex");
    const payload = Buffer.concat([tagBytes, nonceBytes, pubKeyBytes]);

    // Compute expected HMAC-SHA256
    const expectedHmac = crypto.createHmac("sha256", sharedSecret).update(payload).digest();
    const clientProofBuffer = Buffer.from(proofHex.trim(), "hex");

    if (expectedHmac.length !== clientProofBuffer.length) {
      return false;
    }

    return crypto.timingSafeEqual(expectedHmac, clientProofBuffer);
  } catch {
    return false;
  }
}

/**
 * Resets all active in-memory challenges (useful for test isolation).
 */
export function resetBindingChallenges() {
  activeChallenges.clear();
}
