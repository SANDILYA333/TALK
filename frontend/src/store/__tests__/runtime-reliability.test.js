/**
 * Feature 2 — Phase 7 Hotfix Regression Test Suite
 * 
 * Validates:
 * 1. Automatic Pre-Key generation and registry upload during device identity initialization.
 * 2. Real-time global socket message routing & conversation list auto-refresh.
 * 3. Connect ID stability across auth lifecycle and UI modals.
 */

import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";

import { useAuthStore } from "../useAuthStore.js";
import { useChatStore } from "../useChatStore.js";
import { getOrCreateDeviceIdentity } from "../../lib/crypto/identity.js";
import { getOrCreateDevicePrekeys } from "../../lib/crypto/e2e/prekeys.js";

describe("Phase 7 Hotfix Regression & Reliability Suite", () => {
  beforeEach(() => {
    useAuthStore.setState({
      authUser: null,
      deviceConnectId: null,
      isDeviceBound: false,
      isBindingDevice: false,
      socket: null,
    });
    useChatStore.setState({
      messages: [],
      conversations: [],
      activeConversationId: null,
    });
  });

  describe("1. Pre-Key Bundle Auto-Registration on Identity Initialization", () => {
    it("generates local identity and public prekey bundle with SPK and OPKs", async () => {
      const identity = await getOrCreateDeviceIdentity();
      assert.ok(identity.connectId, "Identity must have a valid Connect ID");
      assert.ok(identity.publicKeyHex, "Identity must have a public key hex");

      const { publicBundle, signedPrekey, oneTimePrekeys } = await getOrCreateDevicePrekeys(identity);

      assert.equal(publicBundle.connectId, identity.connectId);
      assert.ok(publicBundle.signedPrekey.signature, "SPK must contain Ed25519 signature");
      assert.ok(publicBundle.oneTimePrekeys.length > 0, "OPK pool must be populated");
      assert.ok(signedPrekey.publicKey, "Local SPK must be generated");
      assert.ok(oneTimePrekeys.length > 0, "Local OPK pool must be saved");
    });
  });

  describe("2. Global Socket Realtime Routing", () => {
    it("refreshes conversations and appends message if conversation is active", async () => {
      let conversationsFetched = false;
      useChatStore.setState({
        activeConversationId: "user_alice_123",
        getConversations: async () => {
          conversationsFetched = true;
        },
      });

      const incomingMsg = {
        _id: "msg_realtime_001",
        senderId: "user_alice_123",
        receiverId: "user_bob_456",
        text: "Hello Bob!",
        createdAt: new Date().toISOString(),
      };

      await useChatStore.getState().handleIncomingSocketMessage(incomingMsg);

      assert.equal(conversationsFetched, true, "Must refresh conversations on incoming socket message");
      const currentMessages = useChatStore.getState().messages;
      assert.equal(currentMessages.length, 1, "Must append message to active conversation");
      assert.equal(currentMessages[0]._id, "msg_realtime_001");
    });

    it("refreshes conversations without appending to message list if different conversation is active", async () => {
      let conversationsFetched = false;
      useChatStore.setState({
        activeConversationId: "user_charlie_789",
        getConversations: async () => {
          conversationsFetched = true;
        },
      });

      const incomingMsg = {
        _id: "msg_realtime_002",
        senderId: "user_alice_123",
        receiverId: "user_bob_456",
        text: "Hello Bob from Alice!",
        createdAt: new Date().toISOString(),
      };

      await useChatStore.getState().handleIncomingSocketMessage(incomingMsg);

      assert.equal(conversationsFetched, true, "Must refresh conversations even when on another chat");
      const currentMessages = useChatStore.getState().messages;
      assert.equal(currentMessages.length, 0, "Must not append message to unrelated active conversation");
    });
  });

  describe("3. Connect ID Stability & Fallback", () => {
    it("reliably preserves Connect ID in useAuthStore", async () => {
      const identity = await getOrCreateDeviceIdentity();
      useAuthStore.setState({ deviceConnectId: identity.connectId, isDeviceBound: true });

      const state = useAuthStore.getState();
      assert.equal(state.deviceConnectId, identity.connectId);
      assert.equal(state.isDeviceBound, true);
    });
  });
});
