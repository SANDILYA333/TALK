/**
 * TALK Cryptographic Session Storage Engine (Feature 2 — Phase 3)
 * 
 * Manages origin-isolated IndexedDB persistence for active Double Ratchet & X3DH sessions:
 * - Session ID indexed
 * - Peer Connect ID lookup
 * - Root keys & chain state
 * - Automatic in-memory fallback for non-browser/test environments
 */

import {
  STORAGE_DB_NAME,
  STORAGE_DB_VERSION,
} from "../constants.js";
import { KeyStorageError } from "../errors.js";
import { validateSessionRecord } from "./types.js";

const SESSION_STORE_NAME = "e2e_sessions_store";

// In-memory fallback map for test environments
const memorySessionStorage = new Map();

function isIndexedDBAvailable() {
  return typeof globalThis !== "undefined" && Boolean(globalThis.indexedDB);
}

function openSessionDatabase() {
  return new Promise((resolve, reject) => {
    if (!isIndexedDBAvailable()) {
      reject(new KeyStorageError("IndexedDB is not supported in this environment"));
      return;
    }

    const request = globalThis.indexedDB.open(STORAGE_DB_NAME, STORAGE_DB_VERSION + 1);

    request.onupgradeneeded = (event) => {
      const db = event.target.result;
      if (!db.objectStoreNames.contains(SESSION_STORE_NAME)) {
        const store = db.createObjectStore(SESSION_STORE_NAME, { keyPath: "sessionId" });
        store.createIndex("peerConnectId", "peerConnectId", { unique: false });
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () =>
      reject(new KeyStorageError("Failed to open IndexedDB session storage", request.error));
  });
}

/**
 * Saves or updates an active session state record.
 * 
 * @param {object} sessionRecord
 * @returns {Promise<void>}
 */
export async function saveSessionState(sessionRecord) {
  if (!sessionRecord || !sessionRecord.sessionId || !sessionRecord.peerConnectId) {
    throw new KeyStorageError("Invalid session record for storage");
  }

  const recordToSave = {
    ...sessionRecord,
    status: sessionRecord.status || "ESTABLISHED",
    createdAt: sessionRecord.createdAt || new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  if (!validateSessionRecord(recordToSave)) {
    throw new KeyStorageError("Session record failed schema validation");
  }

  if (isIndexedDBAvailable()) {
    const db = await openSessionDatabase();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(SESSION_STORE_NAME, "readwrite");
      const store = tx.objectStore(SESSION_STORE_NAME);
      const req = store.put(recordToSave);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(new KeyStorageError(`Failed to save session ${sessionRecord.sessionId}`, req.error));
      tx.oncomplete = () => db.close();
    });
  }

  memorySessionStorage.set(recordToSave.sessionId, recordToSave);
}

/**
 * Loads a session state record by its unique sessionId.
 * 
 * @param {string} sessionId
 * @returns {Promise<object|null>}
 */
export async function loadSessionState(sessionId) {
  if (!sessionId) return null;

  if (isIndexedDBAvailable()) {
    const db = await openSessionDatabase();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(SESSION_STORE_NAME, "readonly");
      const store = tx.objectStore(SESSION_STORE_NAME);
      const req = store.get(sessionId);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => reject(new KeyStorageError(`Failed to load session ${sessionId}`, req.error));
      tx.oncomplete = () => db.close();
    });
  }

  return memorySessionStorage.get(sessionId) || null;
}

/**
 * Loads the latest active session for a specific peer Connect ID.
 * 
 * @param {string} peerConnectId
 * @returns {Promise<object|null>}
 */
export async function loadSessionByPeerConnectId(peerConnectId) {
  if (!peerConnectId) return null;

  if (isIndexedDBAvailable()) {
    const db = await openSessionDatabase();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(SESSION_STORE_NAME, "readonly");
      const store = tx.objectStore(SESSION_STORE_NAME);
      const index = store.index("peerConnectId");
      const req = index.getAll(peerConnectId);
      req.onsuccess = () => {
        const results = req.result || [];
        if (results.length === 0) {
          resolve(null);
          return;
        }
        // Sort descending by updatedAt
        results.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
        resolve(results[0]);
      };
      req.onerror = () => reject(new KeyStorageError(`Failed to find session for peer ${peerConnectId}`, req.error));
      tx.oncomplete = () => db.close();
    });
  }

  // In-memory lookup
  const matches = [];
  for (const session of memorySessionStorage.values()) {
    if (session.peerConnectId === peerConnectId) {
      matches.push(session);
    }
  }
  if (matches.length === 0) return null;
  matches.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
  return matches[0];
}

/**
 * Deletes a session state record from storage.
 * 
 * @param {string} sessionId
 * @returns {Promise<void>}
 */
export async function deleteSessionState(sessionId) {
  if (!sessionId) return;

  if (isIndexedDBAvailable()) {
    const db = await openSessionDatabase();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(SESSION_STORE_NAME, "readwrite");
      const store = tx.objectStore(SESSION_STORE_NAME);
      const req = store.delete(sessionId);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(new KeyStorageError(`Failed to delete session ${sessionId}`, req.error));
      tx.oncomplete = () => db.close();
    });
  }

  memorySessionStorage.delete(sessionId);
}

/**
 * Lists all active session state records.
 * 
 * @returns {Promise<Array<object>>}
 */
export async function listAllSessions() {
  if (isIndexedDBAvailable()) {
    const db = await openSessionDatabase();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(SESSION_STORE_NAME, "readonly");
      const store = tx.objectStore(SESSION_STORE_NAME);
      const req = store.getAll();
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => reject(new KeyStorageError("Failed to list sessions", req.error));
      tx.oncomplete = () => db.close();
    });
  }

  return Array.from(memorySessionStorage.values());
}

/**
 * Clears all stored sessions (used for testing and key resets).
 * 
 * @returns {Promise<void>}
 */
export async function clearAllSessions() {
  if (isIndexedDBAvailable()) {
    const db = await openSessionDatabase();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(SESSION_STORE_NAME, "readwrite");
      const store = tx.objectStore(SESSION_STORE_NAME);
      const req = store.clear();
      req.onsuccess = () => resolve();
      req.onerror = () => reject(new KeyStorageError("Failed to clear sessions", req.error));
      tx.oncomplete = () => db.close();
    });
  }

  memorySessionStorage.clear();
}
