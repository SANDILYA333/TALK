import { encryptMessage, decryptMessage } from "./messaging.js";

/**
 * Packs a message into a Sealed Sender envelope.
 * Wraps the sender's identity and timestamp inside the encrypted ciphertext,
 * allowing the untrusted server to route the envelope to the recipient without
 * learning or logging the sender's identity.
 *
 * @param {object} params
 * @param {string} params.plaintext - Message text content
 * @param {string} params.senderConnectId - Sender's verified Connect ID
 * @param {string} params.recipientConnectId - Recipient's Connect ID
 * @param {object} params.ratchetState - Double Ratchet state with recipient
 * @param {string} params.sessionId - Stable session ID
 * @param {string} [params.deliveryToken] - Short-lived delivery capability token
 * @returns {Promise<{ sealedEnvelope: object, updatedRatchetState: object }>}
 */
export async function packSealedSenderEnvelope({
  plaintext,
  senderConnectId,
  recipientConnectId,
  ratchetState,
  sessionId,
  deliveryToken,
}) {
  // Construct the inner authenticated payload containing sender metadata
  const innerPayload = JSON.stringify({
    version: 1,
    senderConnectId,
    timestamp: new Date().toISOString(),
    content: plaintext,
  });

  // Encrypt the inner payload using the existing pairwise Double Ratchet state
  const { envelope, state: updatedRatchetState } = await encryptMessage({
    plaintext: innerPayload,
    state: ratchetState,
    sessionId,
    senderDeviceId: senderConnectId,
    recipientDeviceId: recipientConnectId,
    messageType: "whisper",
  });

  // Construct outer sealed envelope (senderConnectId is omitted from outer headers)
  const sealedEnvelope = {
    protocol: "TALK-SEALED-SENDER-V1",
    recipientConnectId,
    deliveryToken: deliveryToken || null,
    // Outer payload contains only the opaque ratchet ciphertext and header
    innerCiphertext: envelope,
  };

  return {
    sealedEnvelope,
    updatedRatchetState,
  };
}

/**
 * Unpacks and decrypts a Sealed Sender envelope on the recipient's device.
 * Extracts and cryptographically verifies the sender's identity from the inner payload.
 *
 * @param {object} params
 * @param {object} params.sealedEnvelope
 * @param {object} params.ratchetState
 * @returns {Promise<{ plaintext: string, verifiedSenderConnectId: string, timestamp: string }>}
 */
export async function unpackSealedSenderEnvelope({ sealedEnvelope, ratchetState }) {
  if (sealedEnvelope.protocol !== "TALK-SEALED-SENDER-V1") {
    throw new Error("Invalid sealed sender protocol version");
  }

  const innerEnvelope = sealedEnvelope.innerCiphertext;
  if (!innerEnvelope) {
    throw new Error("Malformed sealed sender envelope: missing inner ciphertext");
  }

  // Decrypt inner payload with recipient's Double Ratchet
  const decryptedInnerString = await decryptMessage({
    envelope: innerEnvelope,
    state: ratchetState,
  });

  let innerData;
  try {
    innerData = JSON.parse(decryptedInnerString);
  } catch {
    throw new Error("Corrupted inner sealed payload");
  }

  if (!innerData.senderConnectId || !innerData.content) {
    throw new Error("Missing authenticated sender identity inside sealed payload");
  }

  return {
    plaintext: innerData.content,
    verifiedSenderConnectId: innerData.senderConnectId,
    timestamp: innerData.timestamp,
  };
}
