import Group from "../models/group.model.js";
import User from "../models/user.model.js";
import Message from "../models/message.model.js";
import { io } from "../lib/socket.js";
import { logger } from "../lib/logger.js";
import { validateEncryptedEnvelopePayload } from "./message.controller.js";

/**
 * Creates a new group with the authenticated user as administrator.
 */
export async function createGroup(req, res) {
  try {
    const { name, description, memberIds } = req.body;
    const creatorId = req.user._id;

    if (!name || typeof name !== "string" || name.trim().length === 0) {
      return res.status(400).json({ message: "Group name is required" });
    }

    const members = [{ userId: creatorId, role: "admin", joinedAt: new Date() }];

    if (Array.isArray(memberIds)) {
      for (const id of memberIds) {
        if (id && String(id) !== String(creatorId)) {
          const userExists = await User.findById(id);
          if (userExists) {
            members.push({ userId: id, role: "member", joinedAt: new Date() });
          }
        }
      }
    }

    const group = new Group({
      name: name.trim(),
      description: (description || "").trim(),
      creatorId,
      epoch: 1,
      members,
    });

    await group.save();

    // Broadcast group invitation to all members
    for (const member of members) {
      io.to(`user:${member.userId}`).emit("groupCreated", group);
    }

    res.status(201).json(group);
  } catch (error) {
    logger.error("create_group_failed", "Error in createGroup", { error: error.message });
    res.status(500).json({ message: "Internal server error" });
  }
}

/**
 * Retrieves all groups where the authenticated user is an active member.
 */
export async function getUserGroups(req, res) {
  try {
    const userId = req.user._id;
    const groups = await Group.find({ "members.userId": userId })
      .populate("members.userId", "fullName profilePic connectId email")
      .sort({ updatedAt: -1 });

    res.status(200).json(groups);
  } catch (error) {
    logger.error("get_user_groups_failed", "Error in getUserGroups", { error: error.message });
    res.status(500).json({ message: "Internal server error" });
  }
}

/**
 * Retrieves group details by ID with authorization verification.
 */
export async function getGroupById(req, res) {
  try {
    const { id } = req.params;
    const userId = req.user._id;

    const group = await Group.findById(id).populate(
      "members.userId",
      "fullName profilePic connectId email"
    );

    if (!group) {
      return res.status(404).json({ message: "Group not found" });
    }

    const isMember = group.members.some(
      (m) => String(m.userId._id || m.userId) === String(userId)
    );
    if (!isMember) {
      return res.status(403).json({ message: "Not authorized to access this group" });
    }

    res.status(200).json(group);
  } catch (error) {
    logger.error("get_group_by_id_failed", "Error in getGroupById", { error: error.message });
    res.status(500).json({ message: "Internal server error" });
  }
}

/**
 * Adds a new member to the group (Admin only).
 * Increments group epoch to trigger sender key advancement.
 */
export async function addGroupMember(req, res) {
  try {
    const { id } = req.params;
    const { userId: newMemberId } = req.body;
    const actorId = req.user._id;

    const group = await Group.findById(id);
    if (!group) return res.status(404).json({ message: "Group not found" });

    // Verify actor is admin
    const actorMember = group.members.find((m) => String(m.userId) === String(actorId));
    if (!actorMember || actorMember.role !== "admin") {
      return res.status(403).json({ message: "Only group admins can add members" });
    }

    // Verify target user exists
    const targetUser = await User.findById(newMemberId);
    if (!targetUser) return res.status(404).json({ message: "Target user not found" });

    const alreadyMember = group.members.some((m) => String(m.userId) === String(newMemberId));
    if (alreadyMember) {
      return res.status(400).json({ message: "User is already a member of this group" });
    }

    group.members.push({ userId: newMemberId, role: "member", joinedAt: new Date() });
    group.epoch += 1; // Key rotation epoch

    await group.save();

    // Broadcast event
    for (const member of group.members) {
      io.to(`user:${member.userId}`).emit("groupMemberAdded", {
        groupId: group._id,
        newMember: targetUser,
        epoch: group.epoch,
      });
    }

    res.status(200).json(group);
  } catch (error) {
    logger.error("add_group_member_failed", "Error in addGroupMember", { error: error.message });
    res.status(500).json({ message: "Internal server error" });
  }
}

/**
 * Removes a member from the group.
 * Increments group epoch so removed member cannot decrypt future messages.
 */
export async function removeGroupMember(req, res) {
  try {
    const { id, memberId } = req.params;
    const actorId = req.user._id;

    const group = await Group.findById(id);
    if (!group) return res.status(404).json({ message: "Group not found" });

    const isSelfRemoval = String(memberId) === String(actorId);
    const actorMember = group.members.find((m) => String(m.userId) === String(actorId));

    if (!isSelfRemoval && (!actorMember || actorMember.role !== "admin")) {
      return res.status(403).json({ message: "Only group admins can remove members" });
    }

    group.members = group.members.filter((m) => String(m.userId) !== String(memberId));
    group.epoch += 1; // Advance epoch to trigger key rotation

    await group.save();

    // Notify removed user
    io.to(`user:${memberId}`).emit("groupRemoved", { groupId: group._id });

    // Notify remaining members
    for (const member of group.members) {
      io.to(`user:${member.userId}`).emit("groupMemberRemoved", {
        groupId: group._id,
        removedMemberId: memberId,
        epoch: group.epoch,
      });
    }

    res.status(200).json({ message: "Member removed successfully", epoch: group.epoch });
  } catch (error) {
    logger.error("remove_group_member_failed", "Error in removeGroupMember", { error: error.message });
    res.status(500).json({ message: "Internal server error" });
  }
}

/**
 * Sends an encrypted message to a group.
 * Verifies sender membership and broadcasts to all group members.
 */
export async function sendGroupMessage(req, res) {
  try {
    const { id: groupId } = req.params;
    const { encryptedEnvelope, text, expiresAt } = req.body;
    const senderId = req.user._id;

    const group = await Group.findById(groupId);
    if (!group) return res.status(404).json({ message: "Group not found" });

    const isMember = group.members.some((m) => String(m.userId) === String(senderId));
    if (!isMember) {
      return res.status(403).json({ message: "Not authorized to send messages to this group" });
    }

    if (encryptedEnvelope) {
      const isValid = validateEncryptedEnvelopePayload(encryptedEnvelope);
      if (!isValid) {
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
      groupId,
      encryptedEnvelope: encryptedEnvelope || null,
      text: encryptedEnvelope ? null : text || null,
      status: "sent",
      expiresAt: validatedExpiresAt,
    });

    await newMessage.save();

    // Broadcast to each group member's active sessions
    for (const member of group.members) {
      io.to(`user:${member.userId}`).emit("newGroupMessage", {
        groupId,
        message: newMessage,
      });
    }

    res.status(201).json(newMessage);
  } catch (error) {
    logger.error("send_group_message_failed", "Error in sendGroupMessage", { error: error.message });
    res.status(500).json({ message: "Internal server error" });
  }
}

/**
 * Retrieves group messages with pagination and expiration filtering.
 */
export async function getGroupMessages(req, res) {
  try {
    const { id: groupId } = req.params;
    const userId = req.user._id;
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 50, 1), 100);
    const { before } = req.query;

    const group = await Group.findById(groupId);
    if (!group) return res.status(404).json({ message: "Group not found" });

    const isMember = group.members.some((m) => String(m.userId) === String(userId));
    if (!isMember) {
      return res.status(403).json({ message: "Not authorized to view messages of this group" });
    }

    const query = {
      groupId,
      $and: [
        {
          $or: [{ expiresAt: null }, { expiresAt: { $gt: new Date() } }],
        },
      ],
    };

    if (before) {
      query.createdAt = { $lt: new Date(before) };
    }

    const messages = await Message.find(query).sort({ createdAt: -1 }).limit(limit);

    res.status(200).json(messages.reverse());
  } catch (error) {
    logger.error("get_group_messages_failed", "Error in getGroupMessages", { error: error.message });
    res.status(500).json({ message: "Internal server error" });
  }
}
