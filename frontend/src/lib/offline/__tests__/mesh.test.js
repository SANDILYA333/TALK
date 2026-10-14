import test from "node:test";
import assert from "node:assert/strict";

import {
  checkMeshTransportCapabilities,
  queueOfflineMessage,
  getQueuedMessages,
  removeQueuedMessage,
  syncOutboxMessages,
} from "../mesh.js";

// Mock IndexedDB for Node environment
class MockIDBRequest {
  constructor() {
    this.result = null;
    this.error = null;
    this.onsuccess = null;
    this.onerror = null;
  }
}

class MockIDBStore {
  constructor(map) {
    this.map = map;
  }
  put(record) {
    this.map.set(record.id, record);
    const req = new MockIDBRequest();
    setTimeout(() => {
      req.result = record.id;
      if (req.onsuccess) req.onsuccess();
    }, 0);
    return req;
  }
  getAll() {
    const req = new MockIDBRequest();
    setTimeout(() => {
      req.result = Array.from(this.map.values());
      if (req.onsuccess) req.onsuccess();
    }, 0);
    return req;
  }
  delete(id) {
    this.map.delete(id);
    const req = new MockIDBRequest();
    setTimeout(() => {
      if (req.onsuccess) req.onsuccess();
    }, 0);
    return req;
  }
  createIndex() {}
}

class MockIDBTransaction {
  constructor(map) {
    this.store = new MockIDBStore(map);
    this.oncomplete = null;
    this.onerror = null;
  }
  objectStore() {
    return this.store;
  }
}

class MockIDBDatabase {
  constructor(map) {
    this.map = map;
    this.objectStoreNames = { contains: () => true };
  }
  transaction() {
    const tx = new MockIDBTransaction(this.map);
    setTimeout(() => {
      if (tx.oncomplete) tx.oncomplete();
    }, 1);
    return tx;
  }
  createObjectStore() {
    return new MockIDBStore(this.map);
  }
  close() {}
}

const mockStoreMap = new Map();
if (typeof globalThis.indexedDB === "undefined") {
  globalThis.indexedDB = {
    open() {
      const req = new MockIDBRequest();
      setTimeout(() => {
        req.result = new MockIDBDatabase(mockStoreMap);
        if (req.onsuccess) req.onsuccess();
      }, 0);
      return req;
    },
  };
}

test.describe("TALK Feature 9 — Offline Local Mesh & Durable Outbox Suite", () => {
  test.beforeEach(() => {
    mockStoreMap.clear();
  });

  test("1. Reports platform transport capabilities and honest fallback matrix", () => {
    const caps = checkMeshTransportCapabilities();
    assert.equal(typeof caps.isOnline, "boolean");
    assert(Array.isArray(caps.supportedTransports));
    assert(typeof caps.platformNotes === "string");
  });

  test("2. Queues encrypted message in durable outbox", async () => {
    const msg = {
      id: "offline_msg_1",
      conversationId: "user_bob_123",
      encryptedEnvelope: { ciphertext: "abc", iv: "123" },
      expiresAt: null,
    };

    await queueOfflineMessage(msg);

    const queued = await getQueuedMessages();
    assert.equal(queued.length, 1);
    assert.equal(queued[0].id, "offline_msg_1");
    assert.equal(queued[0].status, "queued");
  });

  test("3. Successfully removes message from outbox on synchronization", async () => {
    const msg = {
      id: "offline_msg_2",
      conversationId: "user_bob_123",
      encryptedEnvelope: { ciphertext: "abc" },
    };

    await queueOfflineMessage(msg);
    await removeQueuedMessage("offline_msg_2");

    const queued = await getQueuedMessages();
    assert.equal(queued.length, 0);
  });

  test("4. Drops expired messages during synchronization without retransmission", async () => {
    const pastExpiry = new Date(Date.now() - 10000).toISOString();
    const expiredMsg = {
      id: "offline_expired_msg",
      conversationId: "user_bob_123",
      encryptedEnvelope: { ciphertext: "xyz" },
      expiresAt: pastExpiry,
    };

    await queueOfflineMessage(expiredMsg);

    const syncResult = await syncOutboxMessages();
    assert.equal(syncResult.droppedExpiredCount, 1, "Expired message must be dropped");

    const queued = await getQueuedMessages();
    assert.equal(queued.length, 0, "Expired message must no longer be in outbox");
  });
});
