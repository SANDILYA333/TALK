import express from "express";
import { subscribe, unsubscribe } from "../controllers/push.controller.js";
import { protectRoute } from "../middleware/auth.middleware.js";

const router = express.Router();

router.use(protectRoute);

router.post("/subscribe", subscribe);
router.post("/unsubscribe", unsubscribe);

export default router;
