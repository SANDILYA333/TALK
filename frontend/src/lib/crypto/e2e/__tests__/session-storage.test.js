import test from "node:test";
import assert from "node:assert/strict";

import {
  saveSessionState,
  loadSessionState,
  loadSessionByPeerConnectId,
  deleteSessionState,
  listAllSessions,
  clearAllSessions,
} from "../session-storage.js";

test.beforeEach(async () => {
  await clearAllSessions();
});

test.describe("TALK Feature 2 Phase 3 — Session Storage Engine", () => {
  const mockSession = {
    sessionId: "session_1234567890abcdef1234567890abcdef",
    peerConnectId: "TALK-8F2K-91XZ",
    peerIdentityKeyDh: "01".repeat(32),
    rootKeyHex: "02".repeat(32),
    status: "ESTABLISHED",
    handshakeRole: "INITIATOR",
  };

  test("1. Saves and retrieves a session state record by sessionId", async () => {
    await saveSessionState(mockSession);

    const loaded = await loadSessionState(mockSession.sessionId);
    assert.ok(loaded, "Session should be retrieved from storage");
    assert.equal(loaded.sessionId, mockSession.sessionId);
    assert.equal(loaded.peerConnectId, mockSession.peerConnectId);
    assert.equal(loaded.rootKeyHex, mockSession.rootKeyHex);
    assert.equal(loaded.status, "ESTABLISHED");
    assert.ok(loaded.createdAt);
    assert.ok(loaded.updatedAt);
  });

  test("2. Retrieves session state by peerConnectId", async () => {
    await saveSessionState(mockSession);

    const loaded = await loadSessionByPeerConnectId("TALK-8F2K-91XZ");
    assert.ok(loaded, "Session should be found by peerConnectId");
    assert.equal(loaded.sessionId, mockSession.sessionId);

    const notFound = await loadSessionByPeerConnectId("TALK-NONEXISTENT");
    assert.equal(notFound, null, "Should return null for non-existent peer");
  });

  test("3. Deletes a session state record", async () => {
    await saveSessionState(mockSession);
    await deleteSessionState(mockSession.sessionId);

    const loaded = await loadSessionState(mockSession.sessionId);
    assert.equal(loaded, null, "Deleted session should return null");
  });

  test("4. Lists all active sessions and clears storage", async () => {
    const session2 = {
      sessionId: "session_abcdefabcdef1234567890abcdef12",
      peerConnectId: "TALK-3333-4444",
      peerIdentityKeyDh: "03".repeat(32),
      rootKeyHex: "04".repeat(32),
      status: "ACTIVE",
      handshakeRole: "RECEIVER",
    };

    await saveSessionState(mockSession);
    await saveSessionState(session2);

    const allSessions = await listAllSessions();
    assert.equal(allSessions.length, 2);

    await clearAllSessions();
    const emptyList = await listAllSessions();
    assert.equal(emptyList.length, 0);
  });

  test("5. Rejects invalid session records that violate validation rules", async () => {
    const invalidSession = {
      sessionId: "session_invalid",
      peerConnectId: "TALK-8F2K-91XZ",
      peerIdentityKeyDh: "bad_hex",
      rootKeyHex: "bad_hex",
      status: "UNKNOWN_STATUS",
      handshakeRole: "INVALID_ROLE",
    };

    await assert.rejects(
      async () => {
        await saveSessionState(invalidSession);
      },
      /Session record failed schema validation/i
    );
  });
});
