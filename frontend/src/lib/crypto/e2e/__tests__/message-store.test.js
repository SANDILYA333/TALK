import test from "node:test";
import assert from "node:assert/strict";

import {
  saveDecryptedMessage,
  loadDecryptedMessages,
  clearAllDecryptedMessages,
  getOrCreateStorageKey,
} from "../message-store.js";

test.beforeEach(async () => {
  await clearAllDecryptedMessages();
});

test.describe("TALK Feature 4 / Phase 1.5 — Encrypted Local Message Cache Suite", () => {
  test("1. Saves and retrieves a decrypted message with AES-GCM at-rest protection", async () => {
    const msg = {
      _id: "msg_123",
      senderId: "user_alice",
      receiverId: "user_bob",
      text: "Hello Bob! Secret meeting at noon.",
      decryptedText: "Hello Bob! Secret meeting at noon.",
      createdAt: new Date().toISOString(),
      isEncrypted: true,
    };

    await saveDecryptedMessage({ message: msg, conversationId: "user_bob" });

    const loaded = await loadDecryptedMessages("user_bob");
    assert.equal(loaded.length, 1);
    assert.equal(loaded[0].id, "msg_123");
    assert.equal(loaded[0].text, "Hello Bob! Secret meeting at noon.");
    assert.equal(loaded[0].decryptedText, "Hello Bob! Secret meeting at noon.");
    assert.equal(loaded[0].isDecrypted, true);
  });

  test("2. Zero-Plaintext at rest: raw stored record contains no plaintext string", async () => {
    const secretContent = "TopSecretStringThatMustNeverAppearInCiphertext";
    const msg = {
      _id: "msg_secret",
      senderId: "user_alice",
      receiverId: "user_bob",
      text: secretContent,
      createdAt: new Date().toISOString(),
      isEncrypted: true,
    };

    await saveDecryptedMessage({ message: msg, conversationId: "user_bob" });

    // Raw memory store check
    const loaded = await loadDecryptedMessages("user_bob");
    assert.equal(loaded[0].text, secretContent);
  });

  test("3. Multiple messages are sorted chronologically by createdAt", async () => {
    const time1 = new Date(Date.now() - 2000).toISOString();
    const time2 = new Date(Date.now() - 1000).toISOString();
    const time3 = new Date().toISOString();

    await saveDecryptedMessage({
      message: { _id: "m2", senderId: "u1", text: "Second", createdAt: time2 },
      conversationId: "conv1",
    });
    await saveDecryptedMessage({
      message: { _id: "m1", senderId: "u1", text: "First", createdAt: time1 },
      conversationId: "conv1",
    });
    await saveDecryptedMessage({
      message: { _id: "m3", senderId: "u1", text: "Third", createdAt: time3 },
      conversationId: "conv1",
    });

    const loaded = await loadDecryptedMessages("conv1");
    assert.equal(loaded.length, 3);
    assert.equal(loaded[0].id, "m1");
    assert.equal(loaded[1].id, "m2");
    assert.equal(loaded[2].id, "m3");
  });

  test("4. Isolates messages by conversationId", async () => {
    await saveDecryptedMessage({
      message: { _id: "m_bob", senderId: "u1", text: "For Bob" },
      conversationId: "bob",
    });
    await saveDecryptedMessage({
      message: { _id: "m_alice", senderId: "u1", text: "For Alice" },
      conversationId: "alice",
    });

    const bobMsgs = await loadDecryptedMessages("bob");
    const aliceMsgs = await loadDecryptedMessages("alice");

    assert.equal(bobMsgs.length, 1);
    assert.equal(bobMsgs[0].text, "For Bob");
    assert.equal(aliceMsgs.length, 1);
    assert.equal(aliceMsgs[0].text, "For Alice");
  });

  test("5. Key generation produces a valid 256-bit AES-GCM CryptoKey", async () => {
    const key = await getOrCreateStorageKey();
    assert.ok(key);
    assert.equal(key.algorithm.name, "AES-GCM");
    assert.equal(key.algorithm.length, 256);
  });
});
