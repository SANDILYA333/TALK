/**
 * TALK Pre-Key Local Storage Engine (Feature 2 — Phase 2)
 * 
 * Manages origin-isolated IndexedDB persistence for:
 * 1. Device Ed25519 Signing Keypair (IK_sign)
 * 2. Active X25519 Signed Prekey (SPK) + Private Key (PKCS#8)
 * 3. Pool of X25519 One-Time Prekey Private Keys (OPK pool)
 * 
 * In-memory fallback is provided for non-browser/test execution environments.
 */

import {
  STORAGE_DB_NAME,
  STORAGE_DB_VERSION,
} from "../constants.js";
import { KeyStorageError } from "../errors.js";
import { getSubtleCrypto, bytesToHex, hexToBytes } from "../utils.js";
import {
  SIGNATURE_ALGORITHM,
  DH_ALGORITHM,
} from "./constants.js";

const PREKEY_STORAGE_KEYS = Object.freeze({
  SIGNING_IDENTITY: "talk_signing_identity_keypair",
  SIGNED_PREKEY: "talk_active_signed_prekey",
  ONE_TIME_PREKEYS: "talk_one_time_prekeys_pool",
});

const PREKEY_STORE_NAME = "e2e_prekey_store";

// In-memory fallback map for test environments
const memoryPrekeyStorage = new Map();

function isIndexedDBAvailable() {
  return typeof globalThis !== "undefined" && Boolean(globalThis.indexedDB);
}

function openPrekeyDatabase() {
  return new Promise((resolve, reject) => {
    if (!isIndexedDBAvailable()) {
      reject(new KeyStorageError("IndexedDB is not supported in this environment"));
      return;
    }

    const request = globalThis.indexedDB.open(STORAGE_DB_NAME, STORAGE_DB_VERSION + 1);

    request.onupgradeneeded = (event) => {
      const db = event.target.result;
      if (!db.objectStoreNames.contains(PREKEY_STORE_NAME)) {
        db.createObjectStore(PREKEY_STORE_NAME);
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () =>
      reject(new KeyStorageError("Failed to open IndexedDB prekey storage", request.error));
  });
}

async function getRecord(key) {
  if (isIndexedDBAvailable()) {
    const db = await openPrekeyDatabase();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(PREKEY_STORE_NAME, "readonly");
      const store = tx.objectStore(PREKEY_STORE_NAME);
      const req = store.get(key);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => reject(new KeyStorageError(`Failed to read ${key} from storage`, req.error));
      tx.oncomplete = () => db.close();
    });
  }
  return memoryPrekeyStorage.get(key) || null;
}

async function putRecord(key, value) {
  if (isIndexedDBAvailable()) {
    const db = await openPrekeyDatabase();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(PREKEY_STORE_NAME, "readwrite");
      const store = tx.objectStore(PREKEY_STORE_NAME);
      const req = store.put(value, key);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(new KeyStorageError(`Failed to save ${key} to storage`, req.error));
      tx.oncomplete = () => db.close();
    });
  }
  memoryPrekeyStorage.set(key, value);
}

async function deleteRecord(key) {
  if (isIndexedDBAvailable()) {
    const db = await openPrekeyDatabase();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(PREKEY_STORE_NAME, "readwrite");
      const store = tx.objectStore(PREKEY_STORE_NAME);
      const req = store.delete(key);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(new KeyStorageError(`Failed to delete ${key} from storage`, req.error));
      tx.oncomplete = () => db.close();
    });
  }
  memoryPrekeyStorage.delete(key);
}

// --- 1. Signing Identity Keypair (Ed25519) ---

export async function saveSigningIdentityKeyPair(keyPair) {
  const subtle = getSubtleCrypto();
  const rawPub = await subtle.exportKey("raw", keyPair.publicKey);
  const rawPriv = await subtle.exportKey("pkcs8", keyPair.privateKey);

  const record = {
    algorithm: SIGNATURE_ALGORITHM,
    publicKeyHex: bytesToHex(new Uint8Array(rawPub)),
    privateKeyPkcs8: new Uint8Array(rawPriv),
    createdAt: new Date().toISOString(),
  };

  await putRecord(PREKEY_STORAGE_KEYS.SIGNING_IDENTITY, record);
}

export async function loadSigningIdentityKeyPair() {
  const record = await getRecord(PREKEY_STORAGE_KEYS.SIGNING_IDENTITY);
  if (!record) return null;

  const subtle = getSubtleCrypto();
  const pubBytes = hexToBytes(record.publicKeyHex);
  const publicKey = await subtle.importKey(
    "raw",
    pubBytes,
    { name: SIGNATURE_ALGORITHM },
    true,
    ["verify"]
  );
  const privateKey = await subtle.importKey(
    "pkcs8",
    record.privateKeyPkcs8,
    { name: SIGNATURE_ALGORITHM },
    true,
    ["sign"]
  );

  return {
    publicKey,
    privateKey,
    publicKeyHex: record.publicKeyHex,
    createdAt: record.createdAt,
  };
}

// --- 2. Signed Prekey (X25519 + Ed25519 Signature) ---

export async function saveSignedPrekeyRecord(spkRecord) {
  const subtle = getSubtleCrypto();
  const rawPub = await subtle.exportKey("raw", spkRecord.publicKey);
  const rawPriv = await subtle.exportKey("pkcs8", spkRecord.privateKey);

  const record = {
    keyId: spkRecord.keyId,
    publicKeyHex: bytesToHex(new Uint8Array(rawPub)),
    privateKeyPkcs8: new Uint8Array(rawPriv),
    signatureHex: spkRecord.signatureHex,
    version: spkRecord.version || 1,
    createdAt: spkRecord.createdAt || new Date().toISOString(),
  };

  await putRecord(PREKEY_STORAGE_KEYS.SIGNED_PREKEY, record);
}

export async function loadSignedPrekeyRecord() {
  const record = await getRecord(PREKEY_STORAGE_KEYS.SIGNED_PREKEY);
  if (!record) return null;

  const subtle = getSubtleCrypto();
  const pubBytes = hexToBytes(record.publicKeyHex);
  const publicKey = await subtle.importKey(
    "raw",
    pubBytes,
    { name: DH_ALGORITHM },
    true,
    []
  );
  const privateKey = await subtle.importKey(
    "pkcs8",
    record.privateKeyPkcs8,
    { name: DH_ALGORITHM },
    true,
    ["deriveBits", "deriveKey"]
  );

  return {
    keyId: record.keyId,
    publicKey,
    privateKey,
    publicKeyHex: record.publicKeyHex,
    signatureHex: record.signatureHex,
    version: record.version,
    createdAt: record.createdAt,
  };
}

// --- 3. One-Time Prekeys Pool (X25519) ---

export async function saveOneTimePrekeysPool(opkList) {
  const subtle = getSubtleCrypto();
  const storedList = [];

  for (const opk of opkList) {
    const rawPub = await subtle.exportKey("raw", opk.publicKey);
    const rawPriv = await subtle.exportKey("pkcs8", opk.privateKey);
    storedList.push({
      keyId: opk.keyId,
      publicKeyHex: bytesToHex(new Uint8Array(rawPub)),
      privateKeyPkcs8: new Uint8Array(rawPriv),
      createdAt: opk.createdAt || new Date().toISOString(),
    });
  }

  await putRecord(PREKEY_STORAGE_KEYS.ONE_TIME_PREKEYS, storedList);
}

export async function appendOneTimePrekeysToPool(newOpkList) {
  const currentPool = (await getRecord(PREKEY_STORAGE_KEYS.ONE_TIME_PREKEYS)) || [];
  const subtle = getSubtleCrypto();

  for (const opk of newOpkList) {
    const rawPub = await subtle.exportKey("raw", opk.publicKey);
    const rawPriv = await subtle.exportKey("pkcs8", opk.privateKey);
    currentPool.push({
      keyId: opk.keyId,
      publicKeyHex: bytesToHex(new Uint8Array(rawPub)),
      privateKeyPkcs8: new Uint8Array(rawPriv),
      createdAt: opk.createdAt || new Date().toISOString(),
    });
  }

  await putRecord(PREKEY_STORAGE_KEYS.ONE_TIME_PREKEYS, currentPool);
}

export async function loadOneTimePrekeysPool() {
  const rawList = (await getRecord(PREKEY_STORAGE_KEYS.ONE_TIME_PREKEYS)) || [];
  const subtle = getSubtleCrypto();
  const loadedList = [];

  for (const item of rawList) {
    const pubBytes = hexToBytes(item.publicKeyHex);
    const publicKey = await subtle.importKey(
      "raw",
      pubBytes,
      { name: DH_ALGORITHM },
      true,
      []
    );
    const privateKey = await subtle.importKey(
      "pkcs8",
      item.privateKeyPkcs8,
      { name: DH_ALGORITHM },
      true,
      ["deriveBits", "deriveKey"]
    );
    loadedList.push({
      keyId: item.keyId,
      publicKey,
      privateKey,
      publicKeyHex: item.publicKeyHex,
      createdAt: item.createdAt,
    });
  }

  return loadedList;
}

export async function consumeLocalOneTimePrekey(keyId) {
  const rawList = (await getRecord(PREKEY_STORAGE_KEYS.ONE_TIME_PREKEYS)) || [];
  const index = rawList.findIndex((k) => k.keyId === keyId);
  if (index !== -1) {
    const [consumed] = rawList.splice(index, 1);
    await putRecord(PREKEY_STORAGE_KEYS.ONE_TIME_PREKEYS, rawList);

    const subtle = getSubtleCrypto();
    const pubBytes = hexToBytes(consumed.publicKeyHex);
    const publicKey = await subtle.importKey(
      "raw",
      pubBytes,
      { name: DH_ALGORITHM },
      true,
      []
    );
    const privateKey = await subtle.importKey(
      "pkcs8",
      consumed.privateKeyPkcs8,
      { name: DH_ALGORITHM },
      true,
      ["deriveBits", "deriveKey"]
    );

    return {
      keyId: consumed.keyId,
      publicKey,
      privateKey,
      publicKeyHex: consumed.publicKeyHex,
    };
  }
  return null;
}

export async function clearAllPrekeyStorage() {
  await deleteRecord(PREKEY_STORAGE_KEYS.SIGNING_IDENTITY);
  await deleteRecord(PREKEY_STORAGE_KEYS.SIGNED_PREKEY);
  await deleteRecord(PREKEY_STORAGE_KEYS.ONE_TIME_PREKEYS);
}
