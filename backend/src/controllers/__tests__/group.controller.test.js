import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";

import {
  createGroup,
  getGroupById,
  addGroupMember,
  removeGroupMember,
  sendGroupMessage,
  getGroupMessages,
} from "../group.controller.js";
import Group from "../../models/group.model.js";
import User from "../../models/user.model.js";
import Message from "../../models/message.model.js";

function createMockRes() {
  return {
    statusCode: 200,
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(data) {
      this.body = data;
      return this;
    },
  };
}

describe("Backend Group Messaging & Sender-Key Epoch Suite (Feature 7)", () => {
  const aliceId = "660000000000000000000001";
  const bobId = "660000000000000000000002";
  const charlieId = "660000000000000000000003";
  const eveId = "660000000000000000000099";

  let mockGroups = [];
  let mockMessages = [];

  beforeEach(() => {
    mockGroups = [];
    mockMessages = [];

    // Mock User findById
    User.findById = async (id) => {
      if ([aliceId, bobId, charlieId].includes(String(id))) {
        return { _id: id, fullName: `User ${id}`, connectId: `TALK-USER-${id.slice(-4)}` };
      }
      return null;
    };

    // Mock Group prototype save
    Group.prototype.save = async function () {
      if (!this._id) this._id = "grp_test_1";
      const idx = mockGroups.findIndex((g) => String(g._id) === String(this._id));
      if (idx >= 0) mockGroups[idx] = this;
      else mockGroups.push(this);
      return this;
    };

    // Mock Message prototype save
    Message.prototype.save = async function () {
      if (!this._id) this._id = `msg_${Date.now()}`;
      mockMessages.push(this);
      return this;
    };
  });

  it("1. Creates a new group with creator as admin and epoch 1", async () => {
    const req = {
      user: { _id: aliceId },
      body: {
        name: "Crypto Core Team",
        description: "Private E2EE group chat",
        memberIds: [bobId],
      },
    };
    const res = createMockRes();

    await createGroup(req, res);

    assert.equal(res.statusCode, 201);
    assert.equal(res.body.name, "Crypto Core Team");
    assert.equal(res.body.epoch, 1);
    assert.equal(res.body.members.length, 2);
    assert.equal(res.body.members[0].role, "admin");
    assert.equal(String(res.body.members[0].userId), aliceId);
  });

  it("2. Strictly rejects access from non-members (403 Forbidden)", async () => {
    const testGroup = {
      _id: "grp_123",
      name: "Secret Group",
      epoch: 1,
      members: [{ userId: { _id: aliceId }, role: "admin" }],
      populate() { return this; },
    };
    Group.findById = () => ({
      populate: async () => testGroup,
    });

    const req = {
      user: { _id: eveId }, // Eve is not a member
      params: { id: "grp_123" },
    };
    const res = createMockRes();

    await getGroupById(req, res);

    assert.equal(res.statusCode, 403);
    assert.equal(res.body.message, "Not authorized to access this group");
  });

  it("3. Forbids non-admins from adding group members", async () => {
    const testGroup = {
      _id: "grp_123",
      name: "Team",
      epoch: 1,
      members: [
        { userId: aliceId, role: "admin" },
        { userId: bobId, role: "member" },
      ],
      save: async function () { return this; },
    };
    Group.findById = async () => testGroup;

    const req = {
      user: { _id: bobId }, // Bob is a regular member, not admin
      params: { id: "grp_123" },
      body: { userId: charlieId },
    };
    const res = createMockRes();

    await addGroupMember(req, res);

    assert.equal(res.statusCode, 403);
    assert.equal(res.body.message, "Only group admins can add members");
  });

  it("4. Advances epoch upon adding a new member (Key Rotation Trigger)", async () => {
    const testGroup = {
      _id: "grp_123",
      name: "Team",
      epoch: 1,
      members: [{ userId: aliceId, role: "admin" }],
      save: async function () { return this; },
    };
    Group.findById = async () => testGroup;

    const req = {
      user: { _id: aliceId },
      params: { id: "grp_123" },
      body: { userId: bobId },
    };
    const res = createMockRes();

    await addGroupMember(req, res);

    assert.equal(res.statusCode, 200);
    assert.equal(testGroup.epoch, 2, "Epoch must advance from 1 to 2 when new member joins");
    assert.equal(testGroup.members.length, 2);
  });

  it("5. Advances epoch upon member removal (Post-Compromise / Forward Secrecy)", async () => {
    const testGroup = {
      _id: "grp_123",
      name: "Team",
      epoch: 2,
      members: [
        { userId: aliceId, role: "admin" },
        { userId: bobId, role: "member" },
      ],
      save: async function () { return this; },
    };
    Group.findById = async () => testGroup;

    const req = {
      user: { _id: aliceId },
      params: { id: "grp_123", memberId: bobId },
    };
    const res = createMockRes();

    await removeGroupMember(req, res);

    assert.equal(res.statusCode, 200);
    assert.equal(testGroup.epoch, 3, "Epoch must increment to 3 upon member eviction");
    assert.equal(testGroup.members.length, 1);
  });

  it("6. Rejects message submission from unauthorized non-members", async () => {
    const testGroup = {
      _id: "grp_123",
      name: "Team",
      members: [{ userId: aliceId, role: "admin" }],
    };
    Group.findById = async () => testGroup;

    const req = {
      user: { _id: eveId }, // Eve is not a member
      params: { id: "grp_123" },
      body: { text: "Unauthenticated intrusion" },
    };
    const res = createMockRes();

    await sendGroupMessage(req, res);

    assert.equal(res.statusCode, 403);
    assert.equal(res.body.message, "Not authorized to send messages to this group");
  });
});
