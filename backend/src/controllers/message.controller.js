import User from "../models/user.model.js";
import Message from "../models/message.model.js";
import { hasImageKitConfig, uploadChatMedia } from "../lib/imagekit.js";
import { getReceiverSocketId, io } from "../lib/socket.js";
import { logger } from "../lib/logger.js";

/**
 * Validates the structure and sanity of an incoming ciphertext envelope on the server.
 * Ensures strict typing, length caps, and zero presence of forbidden secret field names.
 *
 * @param {object} envelope
 * @returns {boolean}
 */
export function validateEncryptedEnvelopePayload(envelope) {
  if (!envelope || typeof envelope !== "object") return false;
  if (typeof envelope.version !== "number" || envelope.version !== 1) return false;
  if (
    typeof envelope.sessionId !== "string" ||
    envelope.sessionId.length === 0 ||
    envelope.sessionId.length > 100
  ) {
    return false;
  }
  if (
    typeof envelope.senderDeviceId !== "string" ||
    envelope.senderDeviceId.length === 0 ||
    envelope.senderDeviceId.length > 50
  ) {
    return false;
  }
  if (
    typeof envelope.recipientDeviceId !== "string" ||
    envelope.recipientDeviceId.length === 0 ||
    envelope.recipientDeviceId.length > 50
  ) {
    return false;
  }
  if (!["whisper", "prekey_init"].includes(envelope.messageType)) return false;

  const header = envelope.ratchetHeader;
  if (!header || typeof header !== "object") return false;
  if (
    typeof header.dhRatchetPublicKey !== "string" ||
    header.dhRatchetPublicKey.length !== 64 ||
    !/^[0-9a-fA-F]+$/.test(header.dhRatchetPublicKey)
  ) {
    return false;
  }
  if (
    typeof header.messageNumber !== "number" ||
    header.messageNumber < 0 ||
    !Number.isInteger(header.messageNumber)
  ) {
    return false;
  }
  if (
    typeof header.previousChainLength !== "number" ||
    header.previousChainLength < 0 ||
    !Number.isInteger(header.previousChainLength)
  ) {
    return false;
  }

  // Size constraints: ciphertext max 64KB (131072 hex characters), 12-byte IV (24 hex chars)
  if (
    typeof envelope.ciphertext !== "string" ||
    envelope.ciphertext.length === 0 ||
    envelope.ciphertext.length > 131072 ||
    !/^[0-9a-fA-F]+$/.test(envelope.ciphertext)
  ) {
    return false;
  }
  if (
    typeof envelope.iv !== "string" ||
    envelope.iv.length !== 24 ||
    !/^[0-9a-fA-F]+$/.test(envelope.iv)
  ) {
    return false;
  }

  // Enforce zero secret properties in envelope or x3dhInit
  const forbidden = ["privatekey", "secret", "rootkey", "chainkey", "messagekey", "mastersecret"];
  const checkSecrets = (obj) => {
    if (!obj || typeof obj !== "object") return true;
    for (const key of Object.keys(obj)) {
      const lower = key.toLowerCase();
      if (forbidden.some((f) => lower.includes(f))) return false;
      if (typeof obj[key] === "object" && !checkSecrets(obj[key])) return false;
    }
    return true;
  };

  return checkSecrets(envelope);
}

export async function getUsersForSidebar(req, res) {
  try {
    const loggedInUserId = req.user._id;

    const filteredUsers = await User.find({
      _id: { $ne: loggedInUserId },
    }).select("-clerkId");

    res.status(200).json(filteredUsers);
  } catch (error) {
    logger.error("get_users_for_sidebar_failed", "Error in getUsersForSidebar", {
      error: error.message,
    });
    res.status(500).json({ message: "Internal server error" });
  }
}

export async function getConversationsForSidebar(req, res) {
  try {
    const loggedInUserId = req.user._id;

    const conversations = await Message.aggregate([
      // 1. Keep only the messages I sent or received.
      {
        $match: {
          $or: [{ senderId: loggedInUserId }, { receiverId: loggedInUserId }],
        },
      },
      // 2. Collapse them into one row per chat partner, noting our latest message time.
      {
        $group: {
          // The partner is the other person on the message (not me).
          _id: {
            $cond: [
              { $eq: ["$senderId", loggedInUserId] },
              "$receiverId",
              "$senderId",
            ],
          },
          lastMessageAt: { $max: "$createdAt" },
        },
      },
      // 3. Put the most recent conversation at the top.
      { $sort: { lastMessageAt: -1 } },
      // 4. Look up each partner's user profile (comes back as an array).
      {
        $lookup: {
          from: "users",
          localField: "_id",
          foreignField: "_id",
          as: "user",
        },
      },
      // 5. Pull that profile out of the array and make it the document.
      { $replaceRoot: { newRoot: { $first: "$user" } } },
      // 6. Hide the private clerkId field from the result.
      { $project: { clerkId: 0 } },
    ]);

    res.status(200).json(conversations);
  } catch (error) {
    logger.error("get_conversations_for_sidebar_failed", "Error in getConversationsForSidebar", {
      error: error.message,
    });
    res.status(500).json({ message: "Internal server error" });
  }
}

export async function getMessages(req, res) {
  try {
    const { id: userToChatId } = req.params;
    const myId = req.user._id;

    const messages = await Message.find({
      $or: [
        { senderId: myId, receiverId: userToChatId },
        { senderId: userToChatId, receiverId: myId },
      ],
    }).sort({ createdAt: 1 });

    res.status(200).json(messages);
  } catch (error) {
    logger.error("get_messages_failed", "Error in getMessages", {
      error: error.message,
    });
    res.status(500).json({ message: "Internal server error" });
  }
}

export async function sendMessage(req, res) {
  try {
    const { text, encryptedEnvelope } = req.body;
    const { id: receiverId } = req.params;
    const senderId = req.user._id;

    // Verify recipient user exists
    const recipientUser = await User.findById(receiverId);
    if (!recipientUser) {
      return res.status(404).json({ message: "Recipient user not found" });
    }

    let imageUrl;
    let videoUrl;

    if (req.file) {
      if (!hasImageKitConfig()) {
        return res
          .status(500)
          .json({ message: "Media upload is not configured" });
      }

      const url = await uploadChatMedia(req.file);
      if (req.file.mimetype.startsWith("video/")) videoUrl = url;
      else imageUrl = url;
    }

    // 1. Conflict Prevention: Forbid ambiguous payloads containing both text and encryptedEnvelope
    if (encryptedEnvelope && text !== undefined && text !== null && text !== "") {
      return res.status(400).json({
        message: "Conflicting message payload: cannot provide both plaintext and encrypted envelope",
      });
    }

    // 2. Validate payload presence: must contain encryptedEnvelope, text, or media
    if (!encryptedEnvelope && !text && !imageUrl && !videoUrl) {
      return res.status(400).json({ message: "Message content or encrypted envelope is required" });
    }

    // 3. Downgrade Prevention: If recipient has a registered E2EE identity (Connect ID), enforce encryptedEnvelope
    if (recipientUser.connectId && !encryptedEnvelope && text) {
      return res.status(400).json({
        message: "Recipient requires end-to-end encryption. Plaintext sending is disabled.",
      });
    }

    // 4. Validate encrypted envelope structure if provided
    if (encryptedEnvelope) {
      const isValidEnvelope = validateEncryptedEnvelopePayload(encryptedEnvelope);
      if (!isValidEnvelope) {
        return res.status(400).json({ message: "Invalid encrypted message envelope" });
      }
    }

    const newMessage = new Message({
      senderId,
      receiverId,
      // Zero-plaintext guarantee: when encryptedEnvelope is present, text is strictly null
      encryptedEnvelope: encryptedEnvelope || null,
      text: encryptedEnvelope ? null : text || null,
      image: imageUrl,
      video: videoUrl,
    });

    await newMessage.save();

    const receiverSocketId = getReceiverSocketId(receiverId);
    // Real-time broadcast of ciphertext envelope to online recipient
    if (receiverSocketId) {
      io.to(receiverSocketId).emit("newMessage", newMessage);
    }

    res.status(201).json(newMessage);
  } catch (error) {
    logger.error("send_message_failed", "Error in sendMessage", {
      error: error.message,
    });
    res.status(500).json({ message: "Internal server error" });
  }
}
