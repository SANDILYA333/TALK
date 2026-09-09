import {
  STORAGE_DB_NAME,
  STORAGE_STORE_NAME,
  STORAGE_DB_VERSION,
  DEVICE_IDENTITY_KEY,
  IDENTITY_VERSION,
  IDENTITY_ALGORITHM,
} from "./constants.js";
import { KeyStorageError } from "./errors.js";
import { exportPrivateKey, exportPublicKey, importPrivateKey, importPublicKey } from "./keypair.js";

// In-memory fallback map for non-browser/test environments where indexedDB is not available
const memoryStorage = new Map();

/**
 * Checks if IndexedDB is available in the current execution context.
 * @returns {boolean}
 */
function isIndexedDBAvailable() {
  return typeof globalThis !== "undefined" && Boolean(globalThis.indexedDB);
}

/**
 * Opens a connection to the IndexedDB crypto storage database.
 * @returns {Promise<IDBDatabase>}
 */
function openCryptoDatabase() {
  return new Promise((resolve, reject) => {
    if (!isIndexedDBAvailable()) {
      reject(new KeyStorageError("IndexedDB is not supported in this environment"));
      return;
    }

    const request = globalThis.indexedDB.open(STORAGE_DB_NAME, STORAGE_DB_VERSION);

    request.onupgradeneeded = (event) => {
      const db = event.target.result;
      if (!db.objectStoreNames.contains(STORAGE_STORE_NAME)) {
        db.createObjectStore(STORAGE_STORE_NAME);
      }
      if (!db.objectStoreNames.contains("e2e_prekey_store")) {
        db.createObjectStore("e2e_prekey_store");
      }
      if (!db.objectStoreNames.contains("e2e_sessions_store")) {
        const store = db.createObjectStore("e2e_sessions_store", { keyPath: "sessionId" });
        store.createIndex("peerConnectId", "peerConnectId", { unique: false });
      }
    };

    request.onsuccess = () => {
      resolve(request.result);
    };

    request.onerror = () => {
      reject(new KeyStorageError("Failed to open IndexedDB crypto database", request.error));
    };
  });
}

/**
 * Persists an identity keypair to local secure storage.
 * 
 * @param {{ privateKey: CryptoKey, publicKey: CryptoKey }} keyPair
 * @returns {Promise<void>}
 */
export async function saveIdentityKeyPair(keyPair) {
  if (!keyPair || !keyPair.privateKey || !keyPair.publicKey) {
    throw new KeyStorageError("Invalid keypair provided for storage");
  }

  try {
    const exportedPublic = await exportPublicKey(keyPair.publicKey);
    const exportedPrivatePkcs8 = await exportPrivateKey(keyPair.privateKey);

    const record = {
      version: IDENTITY_VERSION,
      algorithm: IDENTITY_ALGORITHM,
      publicKeyRaw: exportedPublic.raw,
      privateKeyPkcs8: exportedPrivatePkcs8,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    if (isIndexedDBAvailable()) {
      const db = await openCryptoDatabase();
      await new Promise((resolve, reject) => {
        const tx = db.transaction(STORAGE_STORE_NAME, "readwrite");
        const store = tx.objectStore(STORAGE_STORE_NAME);
        const putRequest = store.put(record, DEVICE_IDENTITY_KEY);

        putRequest.onsuccess = () => resolve();
        putRequest.onerror = () => reject(new KeyStorageError("Failed to write to IndexedDB", putRequest.error));
        tx.onabort = () => reject(new KeyStorageError("Transaction aborted while saving identity"));
      });
      db.close();
    } else {
      memoryStorage.set(DEVICE_IDENTITY_KEY, record);
    }
  } catch (error) {
    if (error instanceof KeyStorageError) throw error;
    throw new KeyStorageError("Failed to persist identity keypair", error);
  }
}

/**
 * Loads an existing identity keypair from local secure storage.
 * Returns null if no record exists. Throws KeyStorageError if the record is malformed.
 * 
 * @returns {Promise<{ privateKey: CryptoKey, publicKey: CryptoKey, createdAt: string } | null>}
 */
export async function loadIdentityKeyPair() {
  try {
    let record = null;

    if (isIndexedDBAvailable()) {
      const db = await openCryptoDatabase();
      record = await new Promise((resolve, reject) => {
        const tx = db.transaction(STORAGE_STORE_NAME, "readonly");
        const store = tx.objectStore(STORAGE_STORE_NAME);
        const getRequest = store.get(DEVICE_IDENTITY_KEY);

        getRequest.onsuccess = () => resolve(getRequest.result || null);
        getRequest.onerror = () => reject(new KeyStorageError("Failed to read from IndexedDB", getRequest.error));
      });
      db.close();
    } else {
      record = memoryStorage.get(DEVICE_IDENTITY_KEY) || null;
    }

    if (!record) {
      return null;
    }

    // Validate record schema integrity
    if (!record.publicKeyRaw || !record.privateKeyPkcs8 || record.version !== IDENTITY_VERSION) {
      throw new KeyStorageError("Corrupted or incompatible identity key record in storage");
    }

    const publicKey = await importPublicKey(record.publicKeyRaw);
    const privateKey = await importPrivateKey(record.privateKeyPkcs8);

    return {
      publicKey,
      privateKey,
      createdAt: record.createdAt,
    };
  } catch (error) {
    if (error instanceof KeyStorageError) throw error;
    throw new KeyStorageError("Failed to load identity keypair from storage", error);
  }
}

/**
 * Deletes the stored identity keypair (for testing or explicit reset).
 * 
 * @returns {Promise<void>}
 */
export async function clearIdentityKeyPair() {
  try {
    if (isIndexedDBAvailable()) {
      const db = await openCryptoDatabase();
      await new Promise((resolve, reject) => {
        const tx = db.transaction(STORAGE_STORE_NAME, "readwrite");
        const store = tx.objectStore(STORAGE_STORE_NAME);
        const delRequest = store.delete(DEVICE_IDENTITY_KEY);

        delRequest.onsuccess = () => resolve();
        delRequest.onerror = () => reject(new KeyStorageError("Failed to delete from IndexedDB", delRequest.error));
      });
      db.close();
    } else {
      memoryStorage.delete(DEVICE_IDENTITY_KEY);
    }
  } catch (error) {
    throw new KeyStorageError("Failed to clear identity keypair from storage", error);
  }
}
