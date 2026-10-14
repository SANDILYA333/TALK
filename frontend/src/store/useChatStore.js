import { create } from "zustand";
import { persist } from "zustand/middleware";
import toast from "react-hot-toast";

import { axiosInstance } from "../lib/axios.js";
import { useAuthStore } from "./useAuthStore.js";
import { getOrCreateDeviceIdentity } from "../lib/crypto/identity.js";
import {
  establishSessionWithPeer,
  handleIncomingX3DHHandshake,
} from "../lib/crypto/e2e/session.js";
import {
  saveSessionState,
  loadSessionState,
  loadSessionByPeerConnectId,
} from "../lib/crypto/e2e/session-storage.js";
import { encryptMessage, decryptMessage } from "../lib/crypto/e2e/messaging.js";
import { classifyMessage, MESSAGE_STATES } from "../lib/crypto/e2e/compatibility.js";
import {
  saveDecryptedMessage,
  loadDecryptedMessages,
} from "../lib/crypto/e2e/message-store.js";
import { queueOfflineMessage } from "../lib/offline/mesh.js";

/**
 * Processes and decrypts a single message using the centralized compatibility classifier.
 * Handles legacy historical records (State A) and Double Ratchet encrypted envelopes (State B).
 *
 * @param {object} message
 * @param {object} authUser
 * @returns {Promise<object>}
 */
async function decryptSingleMessage(message, authUser) {
  if (!message) return message;

  // Classify message state via compatibility layer
  const classification = classifyMessage(message);

  // If already decrypted in local memory
  if (message.decryptedText) {
    return message;
  }

  // State A: Legacy plaintext record (read-only historical path)
  if (classification.state === MESSAGE_STATES.STATE_A_LEGACY) {
    return message;
  }

  // If this message was sent by the local logged-in user
  if (String(message.senderId) === String(authUser?._id)) {
    return {
      ...message,
      text: message.text || message.decryptedText || "[Encrypted Message]",
      isEncrypted: true,
    };
  }

  // State C: Invalid / Malformed / Unsupported version
  if (classification.state === MESSAGE_STATES.STATE_C_INVALID) {
    return {
      ...message,
      text: "[Invalid Message Format]",
      decryptionFailed: true,
    };
  }

  // State B: Valid E2EE message — attempt Double Ratchet local decryption
  try {
    const localIdentity = await getOrCreateDeviceIdentity();
    const localConnectId = localIdentity.connectId;
    const envelope = message.encryptedEnvelope;

    // 1. If this envelope contains initial X3DH handshake parameters, process them first
    if (envelope.x3dhInit) {
      await handleIncomingX3DHHandshake({
        x3dhHeader: envelope.x3dhInit,
        localIdentityKeyPair: {
          publicKey: localIdentity.publicKey,
          privateKey: localIdentity.privateKey,
          publicKeyHex: localIdentity.publicKeyHex,
        },
        localConnectId,
      });
    }

    // 2. Load active session record
    let session =
      (await loadSessionState(envelope.sessionId)) ||
      (await loadSessionByPeerConnectId(envelope.senderDeviceId));

    if (!session || !session.ratchetState) {
      return {
        ...message,
        text: "Unable to decrypt message",
        decryptionFailed: true,
      };
    }

    // 3. Decrypt ciphertext with Double Ratchet receive step
    const plaintext = await decryptMessage({
      envelope,
      state: session.ratchetState,
    });

    // 4. Save updated ratchet and session state
    await saveSessionState(session);

    return {
      ...message,
      text: plaintext,
      decryptedText: plaintext,
      isDecrypted: true,
      isEncrypted: true,
    };
  } catch {
    // State D: Decryption failed (MAC mismatch or corrupted session)
    return {
      ...message,
      text: "Unable to decrypt message",
      decryptionFailed: true,
      isEncrypted: true,
    };
  }
}

export const useChatStore = create(
  persist(
    (set, get) => ({
      users: [],
      conversations: [],
      messages: [],
      selectedUser: null,
      isConversationsLoading: false,
      isUsersLoading: false,
      isMessagesLoading: false,
      activeConversationId: null,
      searchQuery: "",
      sidebarTab: "chats",
      composerText: "",
      isSoundEnabled: true,
      isSendingMedia: false,
      typingUsers: {},
      disappearingTimer: 0,
      activeCall: null,
      isSafetyModalOpen: false,
      isCallModalOpen: false,

      setDisappearingTimer: (disappearingTimer) => set({ disappearingTimer }),
      setTypingUser: (userId, isTyping) =>
        set((state) => ({
          typingUsers: { ...state.typingUsers, [userId]: isTyping },
        })),
      setActiveCall: (activeCall) => set({ activeCall }),
      setIsSafetyModalOpen: (isSafetyModalOpen) => set({ isSafetyModalOpen }),
      setIsCallModalOpen: (isCallModalOpen) => set({ isCallModalOpen }),

      handleMessageReceipt: ({ messageId, status, deliveredAt, readAt }) => {
        set((state) => ({
          messages: state.messages.map((m) => {
            if (String(m._id || m.id) === String(messageId)) {
              return {
                ...m,
                status,
                deliveredAt: deliveredAt || m.deliveredAt,
                readAt: readAt || m.readAt,
              };
            }
            return m;
          }),
        }));
      },

      getUsers: async () => {
        set({ isUsersLoading: true });
        try {
          const res = await axiosInstance.get("/messages/users");
          set((state) => ({
            users: res.data,
            selectedUser:
              state.selectedUser && res.data.some((user) => user._id === state.selectedUser._id)
                ? state.selectedUser
                : null,
          }));
        } catch (error) {
          console.error("Error in getUsers:", error.message);
        } finally {
          set({ isUsersLoading: false });
        }
      },

      getConversations: async () => {
        set({ isConversationsLoading: true });
        try {
          const res = await axiosInstance.get("/messages/conversations");
          set({ conversations: res.data });
        } catch (error) {
          console.error("Error in getConversations:", error.message);
        } finally {
          set({ isConversationsLoading: false });
        }
      },

      getMessages: async (userId) => {
        if (!userId) return;
        set({ isMessagesLoading: true });
        try {
          // 1. Instantly load locally cached decrypted messages first
          const cachedMessages = await loadDecryptedMessages(userId);
          if (cachedMessages && cachedMessages.length > 0) {
            set({ messages: cachedMessages });
          }

          // 2. Fetch latest messages from backend
          const res = await axiosInstance.get(`/messages/${userId}`);
          const authUser = useAuthStore.getState().authUser;
          const rawMessages = res.data;

          const processedMessages = [];
          for (const msg of rawMessages) {
            // Check if already decrypted and cached locally
            const cached = cachedMessages?.find((c) => String(c._id || c.id) === String(msg._id));
            if (cached && (cached.decryptedText || cached.text)) {
              processedMessages.push(cached);
              continue;
            }

            // Otherwise decrypt fresh envelope and cache locally
            const processed = await decryptSingleMessage(msg, authUser);
            processedMessages.push(processed);
            await saveDecryptedMessage({
              message: processed,
              conversationId: userId,
            });
          }

          set({ messages: processedMessages });
        } catch (error) {
          toast.error(error.response?.data?.message || "Failed to load messages");
        } finally {
          set({ isMessagesLoading: false });
        }
      },

      sendMessage: async (messageData) => {
        const { selectedUser, messages } = get();
        if (!selectedUser) return false;

        try {
          const res = await axiosInstance.post(`/messages/send/${selectedUser._id}`, messageData);
          set({ messages: [...messages, res.data], composerText: "" });
          get().getConversations();
          return true;
        } catch (error) {
          toast.error(error.response?.data?.message || "Failed to send message");
          return false;
        }
      },

      handleIncomingSocketMessage: async (newMessage) => {
        if (!newMessage) return;
        const authUser = useAuthStore.getState().authUser;
        const activeConversationId = get().activeConversationId;

        // 1. Always refresh conversations list so sidebar updates immediately
        get().getConversations();

        // 2. Identify partner ID for local caching
        const partnerId =
          String(newMessage.senderId) === String(authUser?._id)
            ? String(newMessage.receiverId)
            : String(newMessage.senderId);

        try {
          // 3. Decrypt incoming message and store in durable local encrypted cache
          const processedMessage = await decryptSingleMessage(newMessage, authUser);
          await saveDecryptedMessage({
            message: processedMessage,
            conversationId: partnerId,
          });

          // 4. If this is the active conversation, append to current messages list
          const isCurrentChat =
            activeConversationId &&
            (String(newMessage.senderId) === String(activeConversationId) ||
              String(newMessage.receiverId) === String(activeConversationId));

          if (isCurrentChat) {
            set((state) => {
              const alreadyExists = state.messages.some(
                (m) => String(m._id || m.id) === String(processedMessage._id || processedMessage.id)
              );
              if (alreadyExists) return state;
              return { messages: [...state.messages, processedMessage] };
            });
          }
        } catch (err) {
          console.error("Failed to decrypt real-time incoming message:", err);
        }
      },

      subscribeToMessages: (userId) => {
        if (!userId) return;
        // Global socket listener handles incoming messages; ensure messages are loaded
        get().getMessages(userId);
      },

      unsubscribeFromMessages: () => {
        // No-op to preserve global socket message routing
      },

      setSelectedUser: (selectedUser) => set({ selectedUser }),

      setActiveConversationId: (activeConversationId) => {
        set((state) => ({
          activeConversationId,
          selectedUser:
            state.users.find((user) => user._id === activeConversationId) ||
            state.conversations.find((user) => user._id === activeConversationId) ||
            null,
          messages: [],
        }));
      },

      setSearchQuery: (searchQuery) => set({ searchQuery }),
      setSidebarTab: (sidebarTab) => set({ sidebarTab }),
      setComposerText: (composerText) => set({ composerText }),
      setSoundEnabled: (isSoundEnabled) => set({ isSoundEnabled }),

      sendTextMessage: async (conversationId) => {
        const messageText = get().composerText.trim();
        const selectedUser = get().selectedUser;
        if (!conversationId || !messageText || !selectedUser) return false;

        try {
          // E2EE Path: If peer has a registered Connect ID
          if (selectedUser.connectId) {
            const localIdentity = await getOrCreateDeviceIdentity();
            const localConnectId = localIdentity.connectId;

            if (!localConnectId) {
              throw new Error("Local device identity not ready");
            }

            // 1. Establish or retrieve existing X3DH + Double Ratchet session
            const { session, x3dhHeader, isNewSession } = await establishSessionWithPeer({
              peerConnectId: selectedUser.connectId,
              localIdentityKeyPair: {
                publicKey: localIdentity.publicKey,
                privateKey: localIdentity.privateKey,
                publicKeyHex: localIdentity.publicKeyHex,
              },
              localConnectId,
            });

            if (!session || !session.ratchetState) {
              throw new Error("Failed to initialize Double Ratchet session");
            }

            // 2. Encrypt plaintext into ciphertext envelope using Double Ratchet
            const { envelope } = await encryptMessage({
              plaintext: messageText,
              state: session.ratchetState,
              sessionId: session.sessionId,
              senderDeviceId: localConnectId,
              recipientDeviceId: selectedUser.connectId,
              messageType: isNewSession ? "prekey_init" : "whisper",
              x3dhInit: isNewSession ? x3dhHeader : null,
            });

            // 3. Persist updated session state
            await saveSessionState(session);

            const disappearingTimer = get().disappearingTimer;
            const expiresAt =
              disappearingTimer > 0
                ? new Date(Date.now() + disappearingTimer * 1000).toISOString()
                : null;

            let messageRecord;

            // Check if client is offline or network fails
            if (typeof navigator !== "undefined" && !navigator.onLine) {
              const tempId = `offline_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
              await queueOfflineMessage({
                id: tempId,
                conversationId: selectedUser._id,
                encryptedEnvelope: envelope,
                expiresAt,
              });
              messageRecord = {
                _id: tempId,
                senderId: localIdentity._id || "me",
                receiverId: selectedUser._id,
                encryptedEnvelope: envelope,
                status: "queued",
                expiresAt,
                createdAt: new Date().toISOString(),
              };
              toast("Offline: message queued in durable outbox", { icon: "📡" });
            } else {
              // 4. Transmit ciphertext envelope to backend (ZERO PLAINTEXT ON WIRE)
              const res = await axiosInstance.post(`/messages/send/${selectedUser._id}`, {
                encryptedEnvelope: envelope,
                expiresAt,
              });
              messageRecord = res.data;
            }

            // Store local optimistic decrypted representation for immediate sender rendering
            const localMessage = {
              ...messageRecord,
              text: messageText,
              decryptedText: messageText,
              isDecrypted: true,
              isEncrypted: true,
              expiresAt,
            };

            await saveDecryptedMessage({
              message: localMessage,
              conversationId: selectedUser._id,
            });

            set((state) => ({
              messages: [...state.messages, localMessage],
              composerText: "",
            }));

            get().getConversations();
            return true;
          }

          // Legacy plaintext fallback for users without Connect ID
          return get().sendMessage({ text: messageText });
        } catch (error) {
          // ABSOLUTE NO-DOWNGRADE RULE: Never send plaintext if encryption fails
          toast.error(error.response?.data?.message || error.message || "Failed to securely send message");
          return false;
        }
      },

      sendMediaMessage: async ({ conversationId, file }) => {
        if (!conversationId || !file) return false;

        const formData = new FormData();
        formData.append("media", file);

        set({ isSendingMedia: true });
        try {
          return await get().sendMessage(formData);
        } finally {
          set({ isSendingMedia: false });
        }
      },
    }),
    {
      name: "imessage-storage",
      partialize: (state) => ({ isSoundEnabled: state.isSoundEnabled }),
    },
  ),
);