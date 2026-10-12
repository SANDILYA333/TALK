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
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 50, 1), 100);
    const { before } = req.query;

    const query = {
      $or: [
        { senderId: myId, receiverId: userToChatId },
        { senderId: userToChatId, receiverId: myId },
      ],
      $and: [
        {
          $or: [
            { expiresAt: null },
            { expiresAt: { $gt: new Date() } },
          ],
        },
      ],
    };

    if (before) {
      query.createdAt = { $lt: new Date(before) };
    }

    // Retrieve up to limit messages ordered by createdAt descending, then reverse for chronological order
    const messages = await Message.find(query)
      .sort({ createdAt: -1 })
      .limit(limit);

    res.status(200).json(messages.reverse());
  } catch (error) {
    logger.error("get_messages_failed", "Error in getMessages", {
      error: error.message,
    });
    res.status(500).json({ message: "Internal server error" });
  }
}

export async function sendMessage(req, res) {
  try {
    const { text, encryptedEnvelope, expiresAt } = req.body;
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

    let validatedExpiresAt = null;
    if (expiresAt) {
      const expDate = new Date(expiresAt);
      if (!isNaN(expDate.getTime()) && expDate.getTime() > Date.now()) {
        validatedExpiresAt = expDate;
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
      status: "sent",
      expiresAt: validatedExpiresAt,
    });

    await newMessage.save();

    const receiverSocketId = getReceiverSocketId(receiverId);
    // Real-time broadcast of ciphertext envelope to online recipient
    if (receiverSocketId) {
      io.to(receiverSocketId).emit("newMessage", newMessage);
    }
    // Multi-socket room broadcast to all active devices of the recipient
    io.to(`user:${receiverId}`).emit("newMessage", newMessage);
    // Broadcast to other tabs of the sender
    io.to(`user:${senderId}`).emit("messageSent", newMessage);

    res.status(201).json(newMessage);
  } catch (error) {
    logger.error("send_message_failed", "Error in sendMessage", {
      error: error.message,
    });
    res.status(500).json({ message: "Internal server error" });
  }
}

/**
 * Updates message delivery or read receipt status.
 * Authorized strictly to the recipient of the message.
 */
export async function updateMessageStatus(req, res) {
  try {
    const { id: messageId } = req.params;
    const { status } = req.body; // "delivered" | "read"
    const myId = req.user._id;

    if (!["delivered", "read"].includes(status)) {
      return res.status(400).json({ message: "Invalid receipt status" });
    }

    const message = await Message.findById(messageId);
    if (!message) {
      return res.status(404).json({ message: "Message not found" });
    }

    // Only the recipient can acknowledge delivery or read
    if (message.receiverId.toString() !== myId.toString()) {
      return res.status(403).json({ message: "Not authorized to update receipt for this message" });
    }

    // Monotonic idempotent status updates: read > delivered > sent
    if (message.status === "read") {
      return res.status(200).json(message);
    }
    if (message.status === "delivered" && status === "delivered") {
      return res.status(200).json(message);
    }

    const now = new Date();
    message.status = status;
    if (status === "delivered" && !message.deliveredAt) {
      message.deliveredAt = now;
    }
    if (status === "read") {
      if (!message.deliveredAt) message.deliveredAt = now;
      message.readAt = now;
    }

    await message.save();

    // Broadcast receipt to sender's active devices
    io.to(`user:${message.senderId}`).emit("messageReceipt", {
      messageId: message._id,
      status: message.status,
      deliveredAt: message.deliveredAt,
      readAt: message.readAt,
    });

    res.status(200).json(message);
  } catch (error) {
    logger.error("update_message_status_failed", "Error in updateMessageStatus", {
      error: error.message,
    });
    res.status(500).json({ message: "Internal server error" });
  }
}

/**
 * Marks all unread messages from a contact as read.
 */
export async function markConversationRead(req, res) {
  try {
    const { id: senderId } = req.params;
    const myId = req.user._id;
    const now = new Date();

    const result = await Message.updateMany(
      {
        senderId,
        receiverId: myId,
        status: { $ne: "read" },
      },
      {
        $set: {
          status: "read",
          readAt: now,
        },
      }
    );

    io.to(`user:${senderId}`).emit("conversationRead", {
      readerId: myId,
      readAt: now,
    });

    res.status(200).json({
      message: "Conversation marked as read",
      modifiedCount: result.modifiedCount,
    });
  } catch (error) {
    logger.error("mark_conversation_read_failed", "Error in markConversationRead", {
      error: error.message,
    });
    res.status(500).json({ message: "Internal server error" });
  }
}
