/**
 * TALK Double Ratchet State Machine (Feature 2 — Phase 4)
 *
 * Implements the Signal Double Ratchet Algorithm:
 *   https://signal.org/docs/specifications/doubleratchet/
 *
 * The Double Ratchet combines two ratchets:
 *  1. **DH Ratchet** (asymmetric): Advances the Root Key whenever a new
 *     sender ratchet keypair is introduced, providing break-in recovery.
 *  2. **Symmetric KDF Chain Ratchet**: Advances the sending or receiving
 *     chain key one step per message, deriving a unique Message Key each time.
 *
 * Security Properties:
 *  - Forward secrecy:      Compromise of current state cannot decrypt past messages.
 *  - Break-in recovery:    After key compromise, subsequent DH ratchet steps
 *                          re-establish secrecy.
 *  - Out-of-order support: Skipped message keys are cached (bounded).
 *  - Replay protection:    Message keys are single-use; the chain is monotonic.
 *
 * Constraints enforced in this module:
 *  - No raw secret material appears in logs, errors, or returned wire headers.
 *  - Skipped message key cache is hard-bounded by MAX_SKIPPED_MESSAGE_KEYS.
 *  - Private DH ratchet keys are replaced (not retained) after each DH step.
 *  - All KDF operations use HKDF-SHA-256 with protocol-specific domain tags.
 */

import {
  DH_ALGORITHM,
  DOMAIN_TAGS,
  X25519_PUBLIC_KEY_SIZE,
  MAX_SKIPPED_MESSAGE_KEYS,
  SKIPPED_MESSAGE_KEY_TTL_MS,
} from "./constants.js";
import { CryptographicError } from "../errors.js";
import { getSubtleCrypto, hexToBytes, bytesToHex } from "../utils.js";

// ---------------------------------------------------------------------------
// Internal DH helpers
// ---------------------------------------------------------------------------

/**
 * Generates a fresh X25519 DH ratchet keypair.
 * @returns {Promise<{ publicKey: CryptoKey, privateKey: CryptoKey, publicKeyHex: string }>}
 */
export async function generateRatchetKeyPair() {
  const subtle = getSubtleCrypto();
  const keyPair = await subtle.generateKey(
    { name: DH_ALGORITHM },
    true,
    ["deriveBits"]
  );
  const rawPub = await subtle.exportKey("raw", keyPair.publicKey);
  return {
    publicKey: keyPair.publicKey,
    privateKey: keyPair.privateKey,
    publicKeyHex: bytesToHex(new Uint8Array(rawPub)),
  };
}

/**
 * Imports a raw 32-byte X25519 public key.
 * @param {string|Uint8Array} publicKey - 64 hex chars or 32 raw bytes
 * @returns {Promise<CryptoKey>}
 */
async function importRatchetPublicKey(publicKey) {
  const bytes = typeof publicKey === "string" ? hexToBytes(publicKey) : publicKey;
  if (bytes.byteLength !== X25519_PUBLIC_KEY_SIZE) {
    throw new CryptographicError(
      `Invalid X25519 ratchet public key size: expected ${X25519_PUBLIC_KEY_SIZE} bytes`
    );
  }
  const subtle = getSubtleCrypto();
  return subtle.importKey("raw", bytes, { name: DH_ALGORITHM }, true, []);
}

/**
 * Computes X25519 DH scalar multiplication.
 * @param {CryptoKey} privateKey
 * @param {CryptoKey|string} publicKey - CryptoKey or hex string
 * @returns {Promise<Uint8Array>} 32-byte shared secret
 */
async function dh(privateKey, publicKey) {
  const peerKey =
    typeof publicKey === "string" || publicKey instanceof Uint8Array
      ? await importRatchetPublicKey(publicKey)
      : publicKey;

  const subtle = getSubtleCrypto();
  const bits = await subtle.deriveBits(
    { name: DH_ALGORITHM, public: peerKey },
    privateKey,
    256
  );
  return new Uint8Array(bits);
}

// ---------------------------------------------------------------------------
// KDF Functions
// ---------------------------------------------------------------------------

/**
 * KDF_RK — Root Key derivation step (DH Ratchet).
 *
 * Derives a new Root Key and a new Chain Key from the current Root Key
 * and a DH output using HKDF-SHA-256.
 *
 * KDF_RK(RK, dh_out) → (new_RK, new_CK)
 *
 * @param {string} rootKeyHex - Current 32-byte root key (64 hex chars)
 * @param {Uint8Array} dhOutput - 32-byte DH shared secret
 * @returns {Promise<{ newRootKeyHex: string, newChainKeyHex: string }>}
 */
export async function kdfRootKey(rootKeyHex, dhOutput) {
  if (!rootKeyHex || typeof rootKeyHex !== "string" || rootKeyHex.length !== 64) {
    throw new CryptographicError("KDF_RK: rootKeyHex must be a 64-character hex string (32 bytes)");
  }
  if (!(dhOutput instanceof Uint8Array) || dhOutput.byteLength !== 32) {
    throw new CryptographicError("KDF_RK: dhOutput must be a 32-byte Uint8Array");
  }

  const subtle = getSubtleCrypto();
  const saltBytes = hexToBytes(rootKeyHex);

  // Import the DH output as HKDF key material (IKM)
  const ikmKey = await subtle.importKey("raw", dhOutput, { name: "HKDF" }, false, ["deriveBits"]);

  // Derive new Root Key — 256 bits from HKDF with RATCHET_ROOT_INFO tag
  const newRootKeyBits = await subtle.deriveBits(
    {
      name: "HKDF",
      hash: "SHA-256",
      salt: saltBytes,
      info: new TextEncoder().encode(DOMAIN_TAGS.RATCHET_ROOT_INFO),
    },
    ikmKey,
    256
  );

  // Derive new Chain Key — 256 bits from HKDF with RATCHET_CHAIN_INFO tag
  const newChainKeyBits = await subtle.deriveBits(
    {
      name: "HKDF",
      hash: "SHA-256",
      salt: saltBytes,
      info: new TextEncoder().encode(DOMAIN_TAGS.RATCHET_CHAIN_INFO),
    },
    ikmKey,
    256
  );

  return {
    newRootKeyHex: bytesToHex(new Uint8Array(newRootKeyBits)),
    newChainKeyHex: bytesToHex(new Uint8Array(newChainKeyBits)),
  };
}

/**
 * KDF_CK — Chain Key derivation step (Symmetric Ratchet).
 *
 * Advances the symmetric chain one step, producing a new Chain Key and a
 * unique Message Key. The Message Key is the only output used for encryption.
 *
 * KDF_CK(CK) → (new_CK, message_key)
 *
 * Both outputs are 32 bytes. The new Chain Key replaces CK in state;
 * the Message Key is used to encrypt/decrypt exactly one message.
 *
 * @param {string} chainKeyHex - Current 32-byte chain key (64 hex chars)
 * @returns {Promise<{ newChainKeyHex: string, messageKeyHex: string }>}
 */
export async function kdfChainKey(chainKeyHex) {
  if (!chainKeyHex || typeof chainKeyHex !== "string" || chainKeyHex.length !== 64) {
    throw new CryptographicError("KDF_CK: chainKeyHex must be a 64-character hex string (32 bytes)");
  }

  const subtle = getSubtleCrypto();
  const chainKeyBytes = hexToBytes(chainKeyHex);

  // Import chain key as HKDF key material
  const ikmKey = await subtle.importKey("raw", chainKeyBytes, { name: "HKDF" }, false, ["deriveBits"]);

  // Use a zero salt (standard for symmetric ratchet steps)
  const zeroSalt = new Uint8Array(32);

  // Derive new Chain Key
  const newChainKeyBits = await subtle.deriveBits(
    {
      name: "HKDF",
      hash: "SHA-256",
      salt: zeroSalt,
      info: new TextEncoder().encode(DOMAIN_TAGS.RATCHET_CHAIN_INFO),
    },
    ikmKey,
    256
  );

  // Derive Message Key
  const messageKeyBits = await subtle.deriveBits(
    {
      name: "HKDF",
      hash: "SHA-256",
      salt: zeroSalt,
      info: new TextEncoder().encode(DOMAIN_TAGS.MESSAGE_KEY_INFO),
    },
    ikmKey,
    256
  );

  return {
    newChainKeyHex: bytesToHex(new Uint8Array(newChainKeyBits)),
    messageKeyHex: bytesToHex(new Uint8Array(messageKeyBits)),
  };
}

// ---------------------------------------------------------------------------
// State Initialization
// ---------------------------------------------------------------------------

/**
 * Initializes a Double Ratchet state for the **initiator** (Alice / sender).
 *
 * Per the Signal spec, the initiator performs the first DH ratchet step
 * immediately using Bob's SPK (or ratchet key) from the X3DH bundle.
 *
 * @param {object} params
 * @param {string} params.rootKeyHex - Initial root key from X3DH (64 hex chars)
 * @param {string} params.sessionId  - Session identifier
 * @param {string} params.peerRatchetPublicKeyHex - Bob's initial ratchet key (64 hex chars)
 * @returns {Promise<DoubleRatchetState>}
 */
export async function initSenderRatchet({ rootKeyHex, sessionId, peerRatchetPublicKeyHex }) {
  if (!rootKeyHex || typeof rootKeyHex !== "string" || rootKeyHex.length !== 64) {
    throw new CryptographicError("initSenderRatchet: rootKeyHex must be a 64-char hex string");
  }
  if (!sessionId || typeof sessionId !== "string") {
    throw new CryptographicError("initSenderRatchet: sessionId is required");
  }
  if (!peerRatchetPublicKeyHex || typeof peerRatchetPublicKeyHex !== "string" ||
      peerRatchetPublicKeyHex.length !== 64) {
    throw new CryptographicError("initSenderRatchet: peerRatchetPublicKeyHex must be a 64-char hex string");
  }

  // 1. Generate a fresh sending DH ratchet keypair
  const DHs = await generateRatchetKeyPair();

  // 2. Perform the initial DH ratchet step: DH(DHs.private, DHr)
  const dhOutput = await dh(DHs.privateKey, peerRatchetPublicKeyHex);

  // 3. Derive new Root Key and initial sending Chain Key
  const { newRootKeyHex, newChainKeyHex } = await kdfRootKey(rootKeyHex, dhOutput);

  return {
    sessionId,
    DHs,
    DHr: peerRatchetPublicKeyHex,
    RK: newRootKeyHex,
    CKs: newChainKeyHex, // Sender starts with a sending chain
    CKr: null,           // No receiving chain until first message from peer
    Ns: 0,
    Nr: 0,
    PN: 0,
    skippedMessageKeys: new Map(),
    _skippedKeyTimestamps: new Map(),
  };
}

/**
 * Initializes a Double Ratchet state for the **receiver** (Bob / responder).
 *
 * The receiver starts with no sending chain — they wait for a first message
 * from Alice (which will trigger a DH ratchet step to establish the receiving chain).
 *
 * @param {object} params
 * @param {string} params.rootKeyHex    - Initial root key from X3DH (64 hex chars)
 * @param {string} params.sessionId     - Session identifier
 * @param {object} params.ourRatchetKeyPair - Our initial ratchet keypair (from SPK or generated)
 *   { publicKey: CryptoKey, privateKey: CryptoKey, publicKeyHex: string }
 * @returns {DoubleRatchetState}
 */
export function initReceiverRatchet({ rootKeyHex, sessionId, ourRatchetKeyPair }) {
  if (!rootKeyHex || typeof rootKeyHex !== "string" || rootKeyHex.length !== 64) {
    throw new CryptographicError("initReceiverRatchet: rootKeyHex must be a 64-char hex string");
  }
  if (!sessionId || typeof sessionId !== "string") {
    throw new CryptographicError("initReceiverRatchet: sessionId is required");
  }
  if (!ourRatchetKeyPair || !ourRatchetKeyPair.privateKey || !ourRatchetKeyPair.publicKeyHex) {
    throw new CryptographicError("initReceiverRatchet: ourRatchetKeyPair must have privateKey and publicKeyHex");
  }

  return {
    sessionId,
    DHs: ourRatchetKeyPair,   // Our receiving ratchet keypair (private key used for DH steps)
    DHr: null,                 // Unknown until first message from initiator arrives
    RK: rootKeyHex,
    CKs: null,                 // No sending chain until Bob sends a message
    CKr: null,                 // No receiving chain until first message arrives
    Ns: 0,
    Nr: 0,
    PN: 0,
    skippedMessageKeys: new Map(),
    _skippedKeyTimestamps: new Map(),
  };
}

// ---------------------------------------------------------------------------
// Ratchet Step — Encrypt (Advance Sending Chain)
// ---------------------------------------------------------------------------

/**
 * Advances the sending chain and produces a message key for encrypting one message.
 *
 * If the receiving ratchet key in `header.dhRatchetPublicKey` differs from
 * the current `state.DHr`, a DH ratchet step is performed first.
 *
 * @param {DoubleRatchetState} state - Mutable ratchet state (updated in place)
 * @returns {Promise<{ messageKeyHex: string, header: RatchetHeader }>}
 *   header contains: dhRatchetPublicKey, messageNumber (N), previousChainLength (PN)
 */
export async function ratchetEncrypt(state) {
  if (!state || !state.CKs) {
    throw new CryptographicError(
      "ratchetEncrypt: No sending chain key available. " +
      "Ensure initSenderRatchet was called before encrypting."
    );
  }

  // Advance the sending chain
  const { newChainKeyHex, messageKeyHex } = await kdfChainKey(state.CKs);

  // Capture header values BEFORE advancing counters
  const header = {
    dhRatchetPublicKey: state.DHs.publicKeyHex,
    messageNumber: state.Ns,
    previousChainLength: state.PN,
  };

  // Update state
  state.CKs = newChainKeyHex;
  state.Ns += 1;

  return { messageKeyHex, header };
}

// ---------------------------------------------------------------------------
// Ratchet Step — Decrypt (Advance Receiving Chain or Skip)
// ---------------------------------------------------------------------------

/**
 * Derives the message key for decrypting one received message.
 *
 * Implements the full Double Ratchet receive logic:
 * 1. If the incoming ratchet key matches a skipped key cache entry → return it immediately.
 * 2. If the incoming ratchet key is NEW → perform a DH ratchet step to advance root/chains.
 * 3. Skip ahead to the correct message number in the receiving chain (caching skipped keys).
 * 4. Advance the receiving chain one step to produce the correct Message Key.
 *
 * @param {DoubleRatchetState} state - Mutable ratchet state (updated in place)
 * @param {RatchetHeader} header    - Header from received message
 *   { dhRatchetPublicKey: string, messageNumber: number, previousChainLength: number }
 * @returns {Promise<string>} messageKeyHex — key to decrypt the message
 */
export async function ratchetDecrypt(state, header) {
  if (!header || typeof header.dhRatchetPublicKey !== "string" ||
      typeof header.messageNumber !== "number") {
    throw new CryptographicError("ratchetDecrypt: invalid message header");
  }

  // Evict stale skipped keys first
  _evictStaleSkippedKeys(state);

  // 1. Check if this is a cached skipped message key
  const cachedKey = _lookupSkippedKey(state, header.dhRatchetPublicKey, header.messageNumber);
  if (cachedKey !== undefined) {
    _deleteSkippedKey(state, header.dhRatchetPublicKey, header.messageNumber);
    return cachedKey;
  }

  // 2. Determine if we need a DH ratchet step (new peer ratchet key)
  const isNewRatchetKey = header.dhRatchetPublicKey !== state.DHr;

  if (isNewRatchetKey) {
    // 2a. Skip any remaining messages in the OLD receiving chain up to PN
    if (state.CKr !== null) {
      await _skipMessageKeys(state, state.DHr, state.Nr, header.previousChainLength);
    }

    // 2b. Perform DH Ratchet Step — advance Root Key and receiving chain
    const dhOutputReceive = await dh(state.DHs.privateKey, header.dhRatchetPublicKey);
    const { newRootKeyHex: rkAfterReceive, newChainKeyHex: newCKr } =
      await kdfRootKey(state.RK, dhOutputReceive);

    // 2c. Generate a new sending ratchet keypair and advance Root Key + sending chain
    const newDHs = await generateRatchetKeyPair();
    const dhOutputSend = await dh(newDHs.privateKey, header.dhRatchetPublicKey);
    const { newRootKeyHex: rkAfterSend, newChainKeyHex: newCKs } =
      await kdfRootKey(rkAfterReceive, dhOutputSend);

    // 2d. Update state with new ratchet key and chains
    state.PN = state.Ns;
    state.Ns = 0;
    state.Nr = 0;
    state.DHs = newDHs;
    state.DHr = header.dhRatchetPublicKey;
    state.RK = rkAfterSend;
    state.CKs = newCKs;
    state.CKr = newCKr;
  }

  // 3. Skip messages in the current receiving chain if out-of-order
  await _skipMessageKeys(state, header.dhRatchetPublicKey, state.Nr, header.messageNumber);

  // 4. Advance the receiving chain to get the message key for this message
  if (!state.CKr) {
    throw new CryptographicError("ratchetDecrypt: receiving chain key is null after ratchet step");
  }

  const { newChainKeyHex, messageKeyHex } = await kdfChainKey(state.CKr);
  state.CKr = newChainKeyHex;
  state.Nr += 1;

  return messageKeyHex;
}

// ---------------------------------------------------------------------------
// Skipped Message Key Helpers
// ---------------------------------------------------------------------------

/**
 * Builds the canonical map key for a skipped message entry.
 * @param {string} dhRatchetPublicKeyHex
 * @param {number} messageNumber
 * @returns {string}
 */
function _skippedKeyId(dhRatchetPublicKeyHex, messageNumber) {
  return `${dhRatchetPublicKeyHex}:${messageNumber}`;
}

/**
 * Looks up a cached skipped message key.
 * @returns {string|undefined} messageKeyHex if found
 */
function _lookupSkippedKey(state, dhRatchetPublicKeyHex, messageNumber) {
  return state.skippedMessageKeys.get(_skippedKeyId(dhRatchetPublicKeyHex, messageNumber));
}

/**
 * Removes a cached skipped message key after use.
 */
function _deleteSkippedKey(state, dhRatchetPublicKeyHex, messageNumber) {
  const id = _skippedKeyId(dhRatchetPublicKeyHex, messageNumber);
  state.skippedMessageKeys.delete(id);
  state._skippedKeyTimestamps.delete(id);
}

/**
 * Derives and caches message keys for all messages between `from` and `upto` (exclusive).
 * Enforces the MAX_SKIPPED_MESSAGE_KEYS hard limit.
 *
 * @param {DoubleRatchetState} state
 * @param {string} dhRatchetPublicKeyHex
 * @param {number} from - Starting message number (inclusive, current Nr)
 * @param {number} upto - Target message number (exclusive)
 */
async function _skipMessageKeys(state, dhRatchetPublicKeyHex, from, upto) {
  if (upto - from > MAX_SKIPPED_MESSAGE_KEYS) {
    throw new CryptographicError(
      `Refusing to skip ${upto - from} message keys: exceeds MAX_SKIPPED_MESSAGE_KEYS (${MAX_SKIPPED_MESSAGE_KEYS}). ` +
      "Possible desynchronization or malicious header."
    );
  }

  let currentCKr = state.CKr;
  const now = Date.now();

  for (let n = from; n < upto; n++) {
    if (!currentCKr) {
      throw new CryptographicError(`_skipMessageKeys: chain key is null at message ${n}`);
    }

    if (state.skippedMessageKeys.size >= MAX_SKIPPED_MESSAGE_KEYS) {
      throw new CryptographicError(
        `Skipped message key cache is full (${MAX_SKIPPED_MESSAGE_KEYS} entries). Cannot buffer more skipped keys.`
      );
    }

    const { newChainKeyHex, messageKeyHex } = await kdfChainKey(currentCKr);
    const id = _skippedKeyId(dhRatchetPublicKeyHex, n);
    state.skippedMessageKeys.set(id, messageKeyHex);
    state._skippedKeyTimestamps.set(id, now);
    currentCKr = newChainKeyHex;
  }

  // Update the receiving chain key to the position just after what we skipped
  if (from < upto) {
    state.CKr = currentCKr;
    state.Nr = upto;
  }
}

/**
 * Evicts skipped message keys that have exceeded SKIPPED_MESSAGE_KEY_TTL_MS.
 * @param {DoubleRatchetState} state
 */
function _evictStaleSkippedKeys(state) {
  const now = Date.now();
  for (const [id, timestamp] of state._skippedKeyTimestamps.entries()) {
    if (now - timestamp > SKIPPED_MESSAGE_KEY_TTL_MS) {
      state.skippedMessageKeys.delete(id);
      state._skippedKeyTimestamps.delete(id);
    }
  }
}

/**
 * Returns the number of currently cached skipped message keys.
 * Useful for diagnostics and testing.
 *
 * @param {DoubleRatchetState} state
 * @returns {number}
 */
export function skippedKeyCount(state) {
  return state.skippedMessageKeys.size;
}

// ---------------------------------------------------------------------------
// JSDoc Type Definitions
// ---------------------------------------------------------------------------

/**
 * @typedef {object} DoubleRatchetState
 * @property {string} sessionId - Session ID from X3DH
 * @property {{ publicKey: CryptoKey, privateKey: CryptoKey, publicKeyHex: string }} DHs - Our sending ratchet keypair
 * @property {string|null} DHr - Peer's last received ratchet public key (hex)
 * @property {string} RK - Current Root Key (64 hex chars)
 * @property {string|null} CKs - Sending Chain Key (64 hex chars, or null if no chain yet)
 * @property {string|null} CKr - Receiving Chain Key (64 hex chars, or null if no chain yet)
 * @property {number} Ns - Sending message counter
 * @property {number} Nr - Receiving message counter
 * @property {number} PN - Previous sending chain length
 * @property {Map<string, string>} skippedMessageKeys - Cache of skipped message keys
 * @property {Map<string, number>} _skippedKeyTimestamps - Timestamps for TTL eviction
 */

/**
 * @typedef {object} RatchetHeader
 * @property {string} dhRatchetPublicKey - Sender's current DH ratchet public key (64 hex chars)
 * @property {number} messageNumber      - Message counter within current sending chain (N)
 * @property {number} previousChainLength - Messages in previous sending chain (PN)
 */
