/**
 * TALK Cryptographic Session Manager (Feature 2 — Phase 3 & Phase 5)
 * 
 * Orchestrates session discovery, X3DH handshake execution, Double Ratchet state binding,
 * and session persistence between local and remote devices.
 */

import {
  initiateX3DHSession,
  receiveX3DHSession,
} from "./x3dh.js";
import {
  saveSessionState,
  loadSessionByPeerConnectId,
  loadSessionState,
} from "./session-storage.js";
import {
  initSenderRatchet,
  initReceiverRatchet,
} from "./ratchet.js";
import { fetchPrekeyBundleByConnectId } from "../../api/prekey.js";
import { loadSignedPrekeyRecord } from "./storage.js";
import { CryptographicError } from "../errors.js";

/**
 * Retrieves an existing cryptographic session or establishes a new one with a peer using X3DH,
 * initializing the Double Ratchet sender state machine upon initiation.
 * 
 * @param {object} params
 * @param {string} params.peerConnectId - Peer's Connect ID (e.g. TALK-XXXX-XXXX)
 * @param {object} params.localIdentityKeyPair - Local X25519 identity keypair
 * @param {string} params.localConnectId - Local Connect ID
 * @param {Function} [params.fetchBundleFn] - Optional hook to fetch prekey bundle (defaults to API client)
 * @returns {Promise<{ session: object, x3dhHeader?: object, isNewSession: boolean, masterSecretHex?: string }>}
 */
export async function establishSessionWithPeer({
  peerConnectId,
  localIdentityKeyPair,
  localConnectId,
  fetchBundleFn = fetchPrekeyBundleByConnectId,
}) {
  if (!peerConnectId || !localIdentityKeyPair || !localConnectId) {
    throw new CryptographicError("Missing required parameters to establish session");
  }

  // 1. Check if an active session already exists in storage
  const existingSession = await loadSessionByPeerConnectId(peerConnectId);
  if (existingSession && existingSession.status === "ESTABLISHED") {
    return {
      session: existingSession,
      isNewSession: false,
    };
  }

  // 2. Fetch peer's prekey bundle from server registry
  const peerBundle = await fetchBundleFn(peerConnectId);
  if (!peerBundle) {
    throw new CryptographicError(`Failed to retrieve prekey bundle for peer ${peerConnectId}`);
  }

  // 3. Initiate X3DH cryptographic agreement
  const x3dhResult = await initiateX3DHSession({
    localIdentityKeyPair,
    localConnectId,
    peerBundle,
  });

  // 4. Initialize Double Ratchet for sender (initiator)
  const ratchetState = await initSenderRatchet({
    rootKeyHex: x3dhResult.rootKeyHex,
    sessionId: x3dhResult.sessionId,
    peerRatchetPublicKeyHex: peerBundle.signedPrekey.publicKey,
  });

  // 5. Construct and persist session record with bound ratchet state
  const sessionRecord = {
    sessionId: x3dhResult.sessionId,
    peerConnectId,
    peerIdentityKeyDh: x3dhResult.peerIdentityKeyDh,
    rootKeyHex: x3dhResult.rootKeyHex,
    status: "ESTABLISHED",
    handshakeRole: "INITIATOR",
    ephemeralPublicKeyHex: x3dhResult.ephemeralPublicKeyHex,
    isTripleDhFallback: x3dhResult.isTripleDhFallback,
    ratchetState,
  };

  await saveSessionState(sessionRecord);

  return {
    session: sessionRecord,
    x3dhHeader: x3dhResult.x3dhHeader,
    masterSecretHex: x3dhResult.masterSecretHex,
    isNewSession: true,
  };
}

/**
 * Handles an incoming initial message containing an X3DH header, derives matching session state,
 * and initializes the Double Ratchet receiver state machine.
 * 
 * @param {object} params
 * @param {object} params.x3dhHeader - Incoming X3DH handshake header
 * @param {object} params.localIdentityKeyPair - Local X25519 identity keypair
 * @param {string} params.localConnectId - Local Connect ID
 * @param {object} [params.localSignedPrekey] - Optional active local SPK record (loaded from storage if omitted)
 * @param {Function} [params.consumeOpkFn] - Optional hook to consume local OPK
 * @returns {Promise<{ session: object, masterSecretHex: string }>} Established session record
 */
export async function handleIncomingX3DHHandshake({
  x3dhHeader,
  localIdentityKeyPair,
  localConnectId,
  localSignedPrekey,
  consumeOpkFn,
}) {
  if (!x3dhHeader || !localIdentityKeyPair || !localConnectId) {
    throw new CryptographicError("Missing required parameters to handle incoming X3DH handshake");
  }

  // 1. Load active local signed prekey if not explicitly provided
  const activeSpk = localSignedPrekey || (await loadSignedPrekeyRecord());
  if (!activeSpk) {
    throw new CryptographicError("No active Signed Prekey found on local device to process handshake");
  }

  // 2. Perform receiver-side X3DH key agreement
  const x3dhResult = await receiveX3DHSession({
    localIdentityKeyPair,
    localConnectId,
    localSignedPrekey: activeSpk,
    x3dhHeader,
    consumeOpkFn,
  });

  // 3. Initialize Double Ratchet for receiver (responder)
  const ratchetState = initReceiverRatchet({
    rootKeyHex: x3dhResult.rootKeyHex,
    sessionId: x3dhResult.sessionId,
    ourRatchetKeyPair: {
      publicKey: activeSpk.publicKey,
      privateKey: activeSpk.privateKey,
      publicKeyHex: activeSpk.publicKeyHex,
    },
  });

  // 4. Construct and persist receiver session record with bound ratchet state
  const sessionRecord = {
    sessionId: x3dhResult.sessionId,
    peerConnectId: x3dhResult.peerConnectId,
    peerIdentityKeyDh: x3dhResult.peerIdentityKeyDh,
    rootKeyHex: x3dhResult.rootKeyHex,
    status: "ESTABLISHED",
    handshakeRole: "RECEIVER",
    ephemeralPublicKeyHex: x3dhResult.ephemeralPublicKeyHex,
    oneTimePrekeyUsed: x3dhResult.oneTimePrekeyUsed,
    ratchetState,
  };

  await saveSessionState(sessionRecord);

  return {
    session: sessionRecord,
    masterSecretHex: x3dhResult.masterSecretHex,
  };
}

/**
 * Retrieves the active Double Ratchet state for a session, checking memory/storage.
 * 
 * @param {string} sessionId
 * @returns {Promise<object|null>}
 */
export async function getSessionRatchetState(sessionId) {
  const session = await loadSessionState(sessionId);
  return session?.ratchetState || null;
}
