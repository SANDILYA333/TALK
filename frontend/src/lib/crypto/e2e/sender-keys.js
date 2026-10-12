import { getSubtleCrypto, bytesToHex, hexToBytes } from "../utils.js";
import { generateSigningIdentityKeyPair } from "./prekeys.js";

const DOMAIN_CHAIN_STEP = new Uint8Array([0x01]);
const DOMAIN_MESSAGE_KEY = new Uint8Array([0x02]);

/**
 * Initializes a new Sender Key state for group messaging.
 *
 * @param {string} groupId
 * @param {number} [epoch=1]
 * @returns {Promise<object>}
 */
export async function createSenderKeyState(groupId, epoch = 1) {
  const chainKeyBytes = new Uint8Array(32);
  globalThis.crypto.getRandomValues(chainKeyBytes);

  const subtle = getSubtleCrypto();
  const signingPair = await generateSigningIdentityKeyPair();
  const pubRaw = await subtle.exportKey("raw", signingPair.publicKey);
  const privPkcs8 = await subtle.exportKey("pkcs8", signingPair.privateKey);

  return {
    groupId,
    epoch,
    iteration: 0,
    chainKeyHex: bytesToHex(chainKeyBytes),
    signingPublicKeyHex: bytesToHex(new Uint8Array(pubRaw)),
    signingPrivateKeyHex: bytesToHex(new Uint8Array(privPkcs8)),
  };
}

/**
 * Step KDF for sender keys: advances chain and derives message key.
 *
 * @param {Uint8Array} chainKeyBytes
 * @returns {Promise<{ nextChainKeyBytes: Uint8Array, messageKeyBytes: Uint8Array }>}
 */
async function stepSenderKeyKDF(chainKeyBytes) {
  const subtle = getSubtleCrypto();
  const hmacKey = await subtle.importKey(
    "raw",
    chainKeyBytes,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );

  const nextChainBuf = await subtle.sign("HMAC", hmacKey, DOMAIN_CHAIN_STEP);
  const messageKeyBuf = await subtle.sign("HMAC", hmacKey, DOMAIN_MESSAGE_KEY);

  return {
    nextChainKeyBytes: new Uint8Array(nextChainBuf),
    messageKeyBytes: new Uint8Array(messageKeyBuf),
  };
}

/**
 * Encrypts a message using the local Sender Key state.
 * Advances the chain key and signs the ciphertext with Ed25519.
 *
 * @param {object} params
 * @param {string} params.plaintext
 * @param {object} params.senderState
 * @param {string} params.groupId
 * @returns {Promise<{ envelope: object, updatedState: object }>}
 */
export async function encryptSenderKeyMessage({ plaintext, senderState, groupId }) {
  const currentChainKeyBytes = hexToBytes(senderState.chainKeyHex);
  const { nextChainKeyBytes, messageKeyBytes } = await stepSenderKeyKDF(currentChainKeyBytes);

  const currentIteration = senderState.iteration;
  const nextIteration = currentIteration + 1;

  const subtle = getSubtleCrypto();
  const iv = new Uint8Array(12);
  globalThis.crypto.getRandomValues(iv);

  const encoder = new TextEncoder();
  const plaintextBytes = encoder.encode(plaintext);

  // Associated Data binds groupId, epoch, and iteration
  const adString = `TALK-SENDERKEY-V1:${groupId}:${senderState.epoch}:${currentIteration}`;
  const adBytes = encoder.encode(adString);

  const aesKey = await subtle.importKey("raw", messageKeyBytes, { name: "AES-GCM" }, false, [
    "encrypt",
  ]);

  const ciphertextBuf = await subtle.encrypt(
    { name: "AES-GCM", iv, additionalData: adBytes },
    aesKey,
    plaintextBytes
  );
  const ciphertextBytes = new Uint8Array(ciphertextBuf);

  // Sign (AD + IV + Ciphertext) with Ed25519
  const signTarget = new Uint8Array(adBytes.length + iv.length + ciphertextBytes.length);
  signTarget.set(adBytes, 0);
  signTarget.set(iv, adBytes.length);
  signTarget.set(ciphertextBytes, adBytes.length + iv.length);

  // Import private signing key
  const privateSigningKey = await subtle.importKey(
    "pkcs8",
    hexToBytes(senderState.signingPrivateKeyHex),
    { name: "Ed25519" },
    false,
    ["sign"]
  );

  const signatureBuf = await subtle.sign("Ed25519", privateSigningKey, signTarget);

  const updatedState = {
    ...senderState,
    iteration: nextIteration,
    chainKeyHex: bytesToHex(nextChainKeyBytes),
  };

  const envelope = {
    protocol: "TALK-SENDERKEY-V1",
    groupId,
    epoch: senderState.epoch,
    iteration: currentIteration,
    ciphertextHex: bytesToHex(ciphertextBytes),
    ivHex: bytesToHex(iv),
    signatureHex: bytesToHex(new Uint8Array(signatureBuf)),
    signingPublicKeyHex: senderState.signingPublicKeyHex,
  };

  return { envelope, updatedState };
}

/**
 * Decrypts a group message using the stored sender's chain key and signing public key.
 *
 * @param {object} params
 * @param {object} params.envelope
 * @param {object} params.remoteSenderRecord - { chainKeyHex, iteration, signingPublicKeyHex, epoch }
 * @returns {Promise<{ plaintext: string, updatedRecord: object }>}
 */
export async function decryptSenderKeyMessage({ envelope, remoteSenderRecord }) {
  if (envelope.epoch !== remoteSenderRecord.epoch) {
    throw new Error("Sender key epoch mismatch");
  }

  const subtle = getSubtleCrypto();
  const encoder = new TextEncoder();
  const adString = `TALK-SENDERKEY-V1:${envelope.groupId}:${envelope.epoch}:${envelope.iteration}`;
  const adBytes = encoder.encode(adString);
  const ivBytes = hexToBytes(envelope.ivHex);
  const ciphertextBytes = hexToBytes(envelope.ciphertextHex);

  // 1. Verify Ed25519 signature
  const signTarget = new Uint8Array(adBytes.length + ivBytes.length + ciphertextBytes.length);
  signTarget.set(adBytes, 0);
  signTarget.set(ivBytes, adBytes.length);
  signTarget.set(ciphertextBytes, adBytes.length + ivBytes.length);

  const publicSigningKey = await subtle.importKey(
    "raw",
    hexToBytes(envelope.signingPublicKeyHex),
    { name: "Ed25519" },
    false,
    ["verify"]
  );

  const isValidSig = await subtle.verify(
    "Ed25519",
    publicSigningKey,
    hexToBytes(envelope.signatureHex),
    signTarget
  );

  if (!isValidSig) {
    throw new Error("Invalid sender key signature: message tampering detected");
  }

  // 2. Advance chain key to message iteration if needed
  let curChainBytes = hexToBytes(remoteSenderRecord.chainKeyHex);
  let curIteration = remoteSenderRecord.iteration;
  const targetIteration = envelope.iteration;

  if (targetIteration < curIteration) {
    throw new Error("Replayed or expired sender key message iteration");
  }

  if (targetIteration - curIteration > 1000) {
    throw new Error("Sender key iteration skip exceeds DoS limit (max 1000)");
  }

  let messageKeyBytes = null;
  while (curIteration <= targetIteration) {
    const step = await stepSenderKeyKDF(curChainBytes);
    curChainBytes = step.nextChainKeyBytes;
    if (curIteration === targetIteration) {
      messageKeyBytes = step.messageKeyBytes;
    }
    curIteration++;
  }

  // 3. Decrypt ciphertext using derived message key
  const aesKey = await subtle.importKey("raw", messageKeyBytes, { name: "AES-GCM" }, false, [
    "decrypt",
  ]);

  const plaintextBuf = await subtle.decrypt(
    { name: "AES-GCM", iv: ivBytes, additionalData: adBytes },
    aesKey,
    ciphertextBytes
  );

  const decoder = new TextDecoder();
  const plaintext = decoder.decode(plaintextBuf);

  const updatedRecord = {
    ...remoteSenderRecord,
    iteration: curIteration,
    chainKeyHex: bytesToHex(curChainBytes),
  };

  return { plaintext, updatedRecord };
}
