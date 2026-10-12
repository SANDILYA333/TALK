import mongoose from "mongoose";

const encryptedEnvelopeSubSchema = new mongoose.Schema(
  {
    version: {
      type: Number,
      required: true,
      default: 1,
    },
    protocol: {
      type: String,
      required: true,
      default: "TALK-AEAD-AD-V1",
    },
    sessionId: {
      type: String,
      required: true,
      index: true,
    },
    senderDeviceId: {
      type: String,
      required: true,
    },
    recipientDeviceId: {
      type: String,
      required: true,
    },
    messageType: {
      type: String,
      enum: ["whisper", "prekey_init"],
      default: "whisper",
    },
    ratchetHeader: {
      dhRatchetPublicKey: {
        type: String,
        required: true,
      },
      messageNumber: {
        type: Number,
        required: true,
      },
      previousChainLength: {
        type: Number,
        required: true,
      },
    },
    ciphertext: {
      type: String,
      required: true,
    },
    iv: {
      type: String,
      required: true,
    },
    x3dhInit: {
      type: mongoose.Schema.Types.Mixed,
      default: null,
    },
    createdAt: {
      type: String,
    },
  },
  { _id: false }
);

const messageSchema = new mongoose.Schema(
  {
    senderId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    receiverId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: function () {
        return !this.groupId;
      },
      index: true,
    },
    groupId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Group",
      default: null,
      index: true,
    },
    encryptedEnvelope: {
      type: encryptedEnvelopeSubSchema,
      default: null,
    },
    // Legacy / fallback fields preserved for Phase 2.6 migration
    text: {
      type: String,
      default: null,
    },
    image: {
      type: String,
      default: null,
    },
    video: {
      type: String,
      default: null,
    },
    status: {
      type: String,
      enum: ["sent", "delivered", "read"],
      default: "sent",
      index: true,
    },
    deliveredAt: {
      type: Date,
      default: null,
    },
    readAt: {
      type: Date,
      default: null,
    },
    expiresAt: {
      type: Date,
      default: null,
    },
  },
  { timestamps: true }
);

// Compound index for message queries
messageSchema.index({ senderId: 1, receiverId: 1, createdAt: 1 });
// TTL index for automatic expiration of disappearing messages
messageSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0, sparse: true });

const Message = mongoose.model("Message", messageSchema);

export default Message;