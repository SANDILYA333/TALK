import { useMediaQuery } from "./useMediaQuery";
import { formatMessageTime } from "../lib/utils";
import { useChatStore } from "../store/useChatStore";
import { useAuthStore } from "../store/useAuthStore";
import { normalizeMessage } from "../lib/crypto/e2e/compatibility.js";

// John Doe -> JD
export function getInitials(name) {
  return name
    .split(" ")
    .filter(Boolean)
    .map((namePart) => namePart[0])
    .join("");
}

// mapUserToConversation is an adapter — it converts the raw backend shapes (a user document + an array of message documents) into the clean view-model that the chat UI components expect to render.

function mapUserToConversation({ user, messages, authUser, onlineUsers }) {
  const mappedMessages = messages.map((message) => {
    const normalized = normalizeMessage(message, authUser?._id);
    return {
      id: normalized.id,
      role: normalized.role,
      text: normalized.displayText,
      time: formatMessageTime(normalized.createdAt),
      imageUrl: normalized.imageUrl,
      videoUrl: normalized.videoUrl,
      isLegacy: normalized.isLegacy,
      isEncrypted: normalized.isEncrypted,
      isDecrypted: normalized.isDecrypted,
      decryptionFailed: normalized.decryptionFailed,
    };
  });

  return {
    id: user._id,
    peer: {
      name: user.fullName,
      subtitle: user.email,
      isOnline: onlineUsers.includes(user._id),
      avatarUrl: user.profilePic,
      initials: getInitials(user.fullName),
    },
    messages: mappedMessages,
  };
}

export function useSelectedConversation() {
  const activeConversationId = useChatStore((state) => state.activeConversationId);
  const conversations = useChatStore((state) => state.conversations);
  const users = useChatStore((state) => state.users);
  const messages = useChatStore((state) => state.messages);

  const authUser = useAuthStore((state) => state.authUser);
  const onlineUsers = useAuthStore((state) => state.onlineUsers);

  const isLargeScreen = useMediaQuery("(min-width: 1024px)");

  const selectedUser = activeConversationId
    ? users.find((user) => user._id === activeConversationId) ||
      conversations.find((user) => user._id === activeConversationId)
    : null;

  const activeConversation = selectedUser
    ? mapUserToConversation({ user: selectedUser, messages, authUser, onlineUsers })
    : null;

  return {
    activeConversation,
    activeConversationId,
    isLargeScreen,
  };
}