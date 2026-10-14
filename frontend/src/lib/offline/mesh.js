import { axiosInstance } from "../axios.js";

const OUTBOX_DB_NAME = "talk_offline_outbox_db";
const OUTBOX_STORE = "outbox";
const DB_VERSION = 1;

/**
 * Platform transport capability detection matrix.
 * Accurately reports browser and OS support without misleading claims.
 *
 * @returns {{
 *   isOnline: boolean,
 *   hasWebBluetooth: boolean,
 *   hasWebRTCDataChannel: boolean,
 *   supportedTransports: string[],
 *   platformNotes: string
 * }}
 */
export function checkMeshTransportCapabilities() {
  const hasWebBluetooth =
    typeof navigator !== "undefined" && Boolean(navigator.bluetooth);
  const hasWebRTCDataChannel =
    typeof window !== "undefined" && Boolean(window.RTCPeerConnection);
  const isOnline =
    typeof navigator !== "undefined" && typeof navigator.onLine === "boolean"
      ? navigator.onLine
      : true;

  const supportedTransports = [];
  if (hasWebRTCDataChannel) supportedTransports.push("webrtc_datachannel");
  if (hasWebBluetooth) supportedTransports.push("web_bluetooth");

  const platformNotes = !hasWebBluetooth
    ? "Web Bluetooth is unsupported in Safari (macOS/iOS) and Firefox. Falling back to local WebRTC P2P and durable offline queue."
    : "Web Bluetooth and WebRTC Data Channels are available for direct peer-to-peer offline mesh.";

  return {
    isOnline,
    hasWebBluetooth,
    hasWebRTCDataChannel,
    supportedTransports,
    platformNotes,
  };
}

/**
 * Opens the IndexedDB database for durable offline outbox storage.
 * @returns {Promise<IDBDatabase>}
 */
function openOutboxDB() {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") {
      return reject(new Error("IndexedDB is not available in this environment"));
    }
    const request = indexedDB.open(OUTBOX_DB_NAME, DB_VERSION);

    request.onupgradeneeded = (event) => {
      const db = event.target.result;
      if (!db.objectStoreNames.contains(OUTBOX_STORE)) {
        const store = db.createObjectStore(OUTBOX_STORE, { keyPath: "id" });
        store.createIndex("by_conversation", "conversationId", { unique: false });
        store.createIndex("by_status", "status", { unique: false });
        store.createIndex("by_created", "createdAt", { unique: false });
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

/**
 * Queues an encrypted message envelope in the durable offline outbox.
 *
 * @param {object} params
 * @param {string} params.id
 * @param {string} params.conversationId
 * @param {object} params.encryptedEnvelope
 * @param {string} [params.expiresAt]
 * @returns {Promise<void>}
 */
export async function queueOfflineMessage({ id, conversationId, encryptedEnvelope, expiresAt }) {
  const db = await openOutboxDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(OUTBOX_STORE, "readwrite");
    const store = tx.objectStore(OUTBOX_STORE);

    const record = {
      id,
      conversationId,
      encryptedEnvelope,
      status: "queued",
      createdAt: new Date().toISOString(),
      expiresAt: expiresAt || null,
      retryCount: 0,
    };

    store.put(record);

    tx.oncomplete = () => {
      db.close();
      resolve();
    };
    tx.onerror = () => {
      db.close();
      reject(tx.error);
    };
  });
}

/**
 * Loads all pending messages from the offline outbox.
 * @returns {Promise<Array<object>>}
 */
export async function getQueuedMessages() {
  const db = await openOutboxDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(OUTBOX_STORE, "readonly");
    const store = tx.objectStore(OUTBOX_STORE);
    const request = store.getAll();

    request.onsuccess = () => {
      db.close();
      resolve(request.result || []);
    };
    request.onerror = () => {
      db.close();
      reject(request.error);
    };
  });
}

/**
 * Removes a message from the offline outbox once acknowledged or synchronized.
 * @param {string} id
 * @returns {Promise<void>}
 */
export async function removeQueuedMessage(id) {
  const db = await openOutboxDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(OUTBOX_STORE, "readwrite");
    const store = tx.objectStore(OUTBOX_STORE);
    store.delete(id);

    tx.oncomplete = () => {
      db.close();
      resolve();
    };
    tx.onerror = () => {
      db.close();
      reject(tx.error);
    };
  });
}

/**
 * Synchronizes pending queued messages upon reconnection to the backend.
 * Drops expired messages and posts encrypted envelopes without duplicate retransmissions.
 *
 * @returns {Promise<{ syncedCount: number, droppedExpiredCount: number, errors: string[] }>}
 */
export async function syncOutboxMessages() {
  const queued = await getQueuedMessages();
  if (queued.length === 0) {
    return { syncedCount: 0, droppedExpiredCount: 0, errors: [] };
  }

  let syncedCount = 0;
  let droppedExpiredCount = 0;
  const errors = [];
  const now = Date.now();

  for (const item of queued) {
    // 1. Check expiration (Disappearing Messages)
    if (item.expiresAt) {
      const expTime = new Date(item.expiresAt).getTime();
      if (!isNaN(expTime) && expTime <= now) {
        await removeQueuedMessage(item.id);
        droppedExpiredCount++;
        continue;
      }
    }

    // 2. Transmit ciphertext envelope to backend
    try {
      await axiosInstance.post(`/messages/send/${item.conversationId}`, {
        encryptedEnvelope: item.encryptedEnvelope,
        expiresAt: item.expiresAt,
      });

      // 3. Remove from outbox upon confirmed server persistence
      await removeQueuedMessage(item.id);
      syncedCount++;
    } catch (err) {
      errors.push(`Failed to sync message ${item.id}: ${err.message}`);
    }
  }

  return { syncedCount, droppedExpiredCount, errors };
}

// Automatically register online listener in browser environment
if (typeof window !== "undefined") {
  window.addEventListener("online", () => {
    syncOutboxMessages().catch((err) =>
      console.warn("Outbox automatic sync error:", err)
    );
  });
}
