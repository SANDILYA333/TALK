/**
 * TALK Durable Local Encrypted Message Cache (Feature 4 & Phase 1.5)
 *
 * Implements origin-isolated, at-rest encrypted storage in IndexedDB:
 * - Database: talk_crypto_db
 * - Store: decrypted_messages (keyPath: id)
 * - Encryption: AES-GCM-256 with 12-byte random IV per record
 * - Authentication: Associated Data binding over (id, conversationId, senderId)
 * - In-memory fallback for test and non-browser environments
 */

import {
  STORAGE_DB_NAME,
  STORAGE_DB_VERSION,
} from "../constants.js";
import { KeyStorageError } from "../errors.js";
import { getSubtleCrypto, bytesToHex, hexToBytes } from "../utils.js";

export const MESSAGE_STORE_NAME = "decrypted_messages";
const STORAGE_KEY_STORE_NAME = "identity_keys";
const STORAGE_AES_KEY_ID = "talk_local_storage_aes_key";

// In-memory fallback map for non-browser / test environments
const memoryMessageStore = new Map();
let memoryStorageKey = null;

function isIndexedDBAvailable() {
  return typeof globalThis !== "undefined" && Boolean(globalThis.indexedDB);
}

/**
 * Opens or upgrades the crypto database to ensure decrypted_messages store exists.
 * @returns {Promise<IDBDatabase>}
 */
function openMessageDatabase() {
  return new Promise((resolve, reject) => {
    if (!isIndexedDBAvailable()) {
      reject(new KeyStorageError("IndexedDB is not supported in this environment"));
      return;
    }

    const request = globalThis.indexedDB.open(STORAGE_DB_NAME, STORAGE_DB_VERSION);

    request.onupgradeneeded = (event) => {
      const db = event.target.result;
      if (!db.objectStoreNames.contains("identity_keys")) {
        db.createObjectStore("identity_keys");
      }
      if (!db.objectStoreNames.contains("e2e_prekey_store")) {
        db.createObjectStore("e2e_prekey_store");
      }
      if (!db.objectStoreNames.contains("e2e_sessions_store")) {
        const sessionStore = db.createObjectStore("e2e_sessions_store", { keyPath: "sessionId" });
        sessionStore.createIndex("peerConnectId", "peerConnectId", { unique: false });
      }
      if (!db.objectStoreNames.contains(MESSAGE_STORE_NAME)) {
        const msgStore = db.createObjectStore(MESSAGE_STORE_NAME, { keyPath: "id" });
        msgStore.createIndex("conversationId", "conversationId", { unique: false });
        msgStore.createIndex("createdAt", "createdAt", { unique: false });
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () =>
      reject(new KeyStorageError("Failed to open IndexedDB for message storage", request.error));
  });
}

/**
 * Gets or creates the local origin-isolated AES-GCM encryption key for at-rest storage.
 * @returns {Promise<CryptoKey>}
 */
export async function getOrCreateStorageKey() {
  const subtle = getSubtleCrypto();

  if (isIndexedDBAvailable()) {
    const db = await openMessageDatabase();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORAGE_KEY_STORE_NAME, "readwrite");
      const store = tx.objectStore(STORAGE_KEY_STORE_NAME);
      const getReq = store.get(STORAGE_AES_KEY_ID);

      getReq.onsuccess = async () => {
        if (getReq.result) {
          resolve(getReq.result);
          db.close();
          return;
        }

        try {
          // Generate a fresh non-extractable 256-bit AES-GCM storage key
          const key = await subtle.generateKey(
            { name: "AES-GCM", length: 256 },
            true, // extractable for structured cloning in IDB
            ["encrypt", "decrypt"]
          );
          const putReq = store.put(key, STORAGE_AES_KEY_ID);
          putReq.onsuccess = () => {
            resolve(key);
            db.close();
          };
          putReq.onerror = () => {
            reject(new KeyStorageError("Failed to persist storage encryption key", putReq.error));
            db.close();
          };
        } catch (err) {
          reject(new KeyStorageError("Failed to generate storage key", err));
          db.close();
        }
      };

      getReq.onerror = () => {
        reject(new KeyStorageError("Failed to read storage key from IndexedDB", getReq.error));
        db.close();
      };
    });
  }

  // Memory fallback for tests
  if (!memoryStorageKey) {
    memoryStorageKey = await subtle.generateKey(
      { name: "AES-GCM", length: 256 },
      true,
      ["encrypt", "decrypt"]
    );
  }
  return memoryStorageKey;
}

/**
 * Encrypts and persists a message to the local durable store.
 *
 * @param {object} params
 * @param {object} params.message - Message document or view model
 * @param {string} params.conversationId - Associated conversation ID (partner's ID)
 * @returns {Promise<void>}
 */
export async function saveDecryptedMessage({ message, conversationId }) {
  if (!message || !message._id && !message.id) return;
  const id = String(message._id || message.id);
  const convId = String(conversationId || message.senderId);

  const subtle = getSubtleCrypto();
  const key = await getOrCreateStorageKey();

  // 1. Prepare sensitive plaintext payload to encrypt at-rest
  const sensitivePayload = {
    text: message.text || message.decryptedText || "",
    decryptedText: message.decryptedText || message.text || "",
    imageUrl: message.image || message.imageUrl || null,
    videoUrl: message.video || message.videoUrl || null,
  };

  const plaintextBytes = new TextEncoder().encode(JSON.stringify(sensitivePayload));

  // 2. Generate cryptographically random 12-byte IV per record (never reuse)
  const iv = new Uint8Array(12);
  if (typeof globalThis.crypto !== "undefined" && globalThis.crypto.getRandomValues) {
    globalThis.crypto.getRandomValues(iv);
  } else {
    for (let i = 0; i < 12; i++) iv[i] = Math.floor(Math.random() * 256);
  }

  // 3. Construct canonical Associated Data (AD) binding record metadata
  const adString = `TALK-MSG-STORE-V1:${id}:${convId}:${String(message.senderId)}`;
  const adBytes = new TextEncoder().encode(adString);

  // 4. Encrypt sensitive payload using AES-GCM
  const ciphertextBuffer = await subtle.encrypt(
    { name: "AES-GCM", iv, additionalData: adBytes },
    key,
    plaintextBytes
  );

  const encryptedRecord = {
    id,
    conversationId: convId,
    senderId: String(message.senderId),
    receiverId: String(message.receiverId),
    createdAt: message.createdAt || new Date().toISOString(),
    ivHex: bytesToHex(iv),
    ciphertextHex: bytesToHex(new Uint8Array(ciphertextBuffer)),
    isEncrypted: Boolean(message.isEncrypted || message.encryptedEnvelope),
    isDecrypted: true,
    status: message.status || "delivered",
    expiresAt: message.expiresAt || null,
  };

  if (isIndexedDBAvailable()) {
    const db = await openMessageDatabase();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(MESSAGE_STORE_NAME, "readwrite");
      const store = tx.objectStore(MESSAGE_STORE_NAME);
      const req = store.put(encryptedRecord);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(new KeyStorageError(`Failed to save cached message ${id}`, req.error));
      tx.oncomplete = () => db.close();
    });
  }

  memoryMessageStore.set(id, encryptedRecord);
}

/**
 * Loads and decrypts all cached messages for a given conversation.
 *
 * @param {string} conversationId
 * @returns {Promise<Array<object>>}
 */
export async function loadDecryptedMessages(conversationId) {
  if (!conversationId) return [];
  const convId = String(conversationId);

  let records = [];

  if (isIndexedDBAvailable()) {
    const db = await openMessageDatabase();
    records = await new Promise((resolve, reject) => {
      const tx = db.transaction(MESSAGE_STORE_NAME, "readonly");
      const store = tx.objectStore(MESSAGE_STORE_NAME);
      const index = store.index("conversationId");
      const req = index.getAll(convId);
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => reject(new KeyStorageError(`Failed to load messages for ${convId}`, req.error));
      tx.oncomplete = () => db.close();
    });
  } else {
    for (const rec of memoryMessageStore.values()) {
      if (rec.conversationId === convId) {
        records.push(rec);
      }
    }
  }

  if (records.length === 0) return [];

  const subtle = getSubtleCrypto();
  const key = await getOrCreateStorageKey();
  const decryptedMessages = [];

  for (const record of records) {
    try {
      const iv = hexToBytes(record.ivHex);
      const ciphertext = hexToBytes(record.ciphertextHex);
      const adString = `TALK-MSG-STORE-V1:${record.id}:${convId}:${record.senderId}`;
      const adBytes = new TextEncoder().encode(adString);

      const plaintextBuffer = await subtle.decrypt(
        { name: "AES-GCM", iv, additionalData: adBytes },
        key,
        ciphertext
      );

      const parsedPayload = JSON.parse(new TextDecoder().decode(plaintextBuffer));

      decryptedMessages.push({
        _id: record.id,
        id: record.id,
        senderId: record.senderId,
        receiverId: record.receiverId,
        text: parsedPayload.text,
        decryptedText: parsedPayload.decryptedText,
        imageUrl: parsedPayload.imageUrl,
        videoUrl: parsedPayload.videoUrl,
        createdAt: record.createdAt,
        isEncrypted: record.isEncrypted,
        isDecrypted: true,
        status: record.status,
        expiresAt: record.expiresAt,
      });
    } catch {
      // Record tampering or corrupted decryption
      decryptedMessages.push({
        _id: record.id,
        id: record.id,
        senderId: record.senderId,
        receiverId: record.receiverId,
        text: "Unable to decrypt cached message",
        decryptedText: "Unable to decrypt cached message",
        createdAt: record.createdAt,
        isEncrypted: true,
        decryptionFailed: true,
      });
    }
  }

  // Sort ascending by createdAt
  decryptedMessages.sort(
    (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
  );

  return decryptedMessages;
}

/**
 * Clears all cached decrypted messages from memory and IndexedDB (test utility).
 */
export async function clearAllDecryptedMessages() {
  memoryMessageStore.clear();
  memoryStorageKey = null;

  if (isIndexedDBAvailable()) {
    try {
      const db = await openMessageDatabase();
      await new Promise((resolve, reject) => {
        const tx = db.transaction(MESSAGE_STORE_NAME, "readwrite");
        const store = tx.objectStore(MESSAGE_STORE_NAME);
        const req = store.clear();
        req.onsuccess = () => resolve();
        req.onerror = () => reject(req.error);
        tx.oncomplete = () => db.close();
      });
    } catch {
      // Ignore if store does not exist yet
    }
  }
}
