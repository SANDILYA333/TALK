import express from "express";
import {
  createGroup,
  getUserGroups,
  getGroupById,
  addGroupMember,
  removeGroupMember,
  sendGroupMessage,
  getGroupMessages,
} from "../controllers/group.controller.js";
import { protectRoute } from "../middleware/auth.middleware.js";

const router = express.Router();

router.use(protectRoute);

router.post("/", createGroup);
router.get("/", getUserGroups);
router.get("/:id", getGroupById);
router.post("/:id/members", addGroupMember);
router.delete("/:id/members/:memberId", removeGroupMember);
router.post("/:id/send", sendGroupMessage);
router.get("/:id/messages", getGroupMessages);

export default router;
