import mongoose from "mongoose";

const deviceIdentitySchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    clerkId: {
      type: String,
      required: true,
      index: true,
    },
    connectId: {
      type: String,
      required: true,
      unique: true,
      index: true,
      uppercase: true,
      trim: true,
    },
    publicKey: {
      type: String,
      required: true,
      unique: true,
      index: true,
      trim: true,
    },
    algorithm: {
      type: String,
      required: true,
      default: "X25519",
    },
    version: {
      type: Number,
      required: true,
      default: 1,
    },
    status: {
      type: String,
      enum: ["ACTIVE", "REVOKED"],
      default: "ACTIVE",
      index: true,
    },
    boundAt: {
      type: Date,
      default: Date.now,
    },
    lastVerifiedAt: {
      type: Date,
      default: Date.now,
    },
    revokedAt: {
      type: Date,
    },
  },
  { timestamps: true }
);

// Compound indexes for querying user devices and active status
deviceIdentitySchema.index({ userId: 1, publicKey: 1 });
deviceIdentitySchema.index({ userId: 1, status: 1 });
deviceIdentitySchema.index({ userId: 1, createdAt: -1 });

const DeviceIdentity = mongoose.model("DeviceIdentity", deviceIdentitySchema);

export default DeviceIdentity;
