import mongoose from "mongoose";

const groupMemberSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    role: {
      type: String,
      enum: ["admin", "member"],
      default: "member",
    },
    joinedAt: {
      type: Date,
      default: Date.now,
    },
  },
  { _id: false }
);

const groupSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true,
      maxlength: 100,
    },
    description: {
      type: String,
      default: "",
      maxlength: 300,
    },
    avatar: {
      type: String,
      default: null,
    },
    creatorId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    epoch: {
      type: Number,
      required: true,
      default: 1,
    },
    members: {
      type: [groupMemberSchema],
      validate: {
        validator: function (members) {
          return members && members.length >= 1;
        },
        message: "Group must have at least one member",
      },
    },
  },
  { timestamps: true }
);

groupSchema.index({ "members.userId": 1 });

const Group = mongoose.model("Group", groupSchema);

export default Group;
