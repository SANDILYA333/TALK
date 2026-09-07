import mongoose from "mongoose";

const oneTimePrekeySubSchema = new mongoose.Schema(
  {
    keyId: {
      type: Number,
      required: true,
    },
    publicKey: {
      type: String,
      required: true,
      trim: true,
      lowercase: true,
    },
    isConsumed: {
      type: Boolean,
      default: false,
      index: true,
    },
    consumedAt: {
      type: Date,
      default: null,
    },
    consumptionId: {
      type: String,
      default: null,
    },
    createdAt: {
      type: Date,
      default: Date.now,
    },
  },
  { _id: false }
);

const preKeyBundleSchema = new mongoose.Schema(
  {
    deviceId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "DeviceIdentity",
      required: true,
      unique: true,
      index: true,
    },
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    connectId: {
      type: String,
      required: true,
      index: true,
      uppercase: true,
      trim: true,
    },
    identityKeyDh: {
      type: String,
      required: true,
      trim: true,
      lowercase: true,
    },
    identityKeySign: {
      type: String,
      required: true,
      trim: true,
      lowercase: true,
    },
    signedPrekey: {
      keyId: {
        type: Number,
        required: true,
      },
      publicKey: {
        type: String,
        required: true,
        trim: true,
        lowercase: true,
      },
      signature: {
        type: String,
        required: true,
        trim: true,
        lowercase: true,
      },
      createdAt: {
        type: Date,
        default: Date.now,
      },
      version: {
        type: Number,
        default: 1,
      },
    },
    oneTimePrekeys: [oneTimePrekeySubSchema],
    activeOpkCount: {
      type: Number,
      default: 0,
      index: true,
    },
    protocolVersion: {
      type: Number,
      required: true,
      default: 1,
    },
  },
  { timestamps: true }
);

// Compound indexes for fast lookup and atomic consumption
preKeyBundleSchema.index({ connectId: 1, protocolVersion: 1 });
preKeyBundleSchema.index({ userId: 1, createdAt: -1 });

const PreKeyBundle = mongoose.model("PreKeyBundle", preKeyBundleSchema);

export default PreKeyBundle;
