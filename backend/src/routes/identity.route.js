import {
  registerIdentity,
  lookupIdentity,
  getMyIdentities,
  getDevices,
  revokeDevice,
  createChallenge,
  bindIdentity,
} from "../controllers/identity.controller.js";
import {
  registerPrekeyBundle,
  getPrekeyBundle,
  replenishOneTimePrekeys,
  getPrekeyStatus,
} from "../controllers/prekey.controller.js";
import { protectRoute } from "../middleware/auth.middleware.js";
import { createRateLimiter } from "../middleware/rate-limit.middleware.js";

const router = express.Router();

// Rate limiter for discovery lookups: max 30 requests per minute
const lookupRateLimiter = createRateLimiter({
  windowMs: 60 * 1000,
  maxRequests: 30,
  message: "Too many identity lookups. Please wait a minute before searching again.",
});

// Rate limiter for cryptographic binding challenges: max 20 requests per minute
const challengeRateLimiter = createRateLimiter({
  windowMs: 60 * 1000,
  maxRequests: 20,
  message: "Too many binding challenge requests. Please wait a minute.",
});

// Rate limiter for prekey bundle retrieval: max 60 requests per minute
const prekeyBundleRateLimiter = createRateLimiter({
  windowMs: 60 * 1000,
  maxRequests: 60,
  message: "Too many prekey bundle requests. Please wait a minute.",
});

// Request an ephemeral challenge nonce for identity binding
router.post("/challenge", protectRoute, challengeRateLimiter, createChallenge);

// Verify proof-of-possession and bind device identity to authenticated account
router.post("/bind", protectRoute, bindIdentity);

// Register or verify device identity (legacy / direct registration)
router.post("/register", protectRoute, registerIdentity);

// Look up public user profile by Connect ID (with rate limiting)
router.get("/lookup/:connectId", protectRoute, lookupRateLimiter, lookupIdentity);

// Multi-device management: list all registered devices for authenticated user
router.get("/devices", protectRoute, getDevices);

// Multi-device management: revoke a specific device identity
router.post("/devices/:id/revoke", protectRoute, revokeDevice);

// Get current user's registered device identities (legacy compatibility)
router.get("/me", protectRoute, getMyIdentities);

// --- Feature 2 Pre-Key Infrastructure Routes ---

// Register or update public Prekey Bundle for authenticated device
router.post("/prekeys/register", protectRoute, registerPrekeyBundle);

// Retrieve peer's public Prekey Bundle with atomic OPK consumption
router.get("/prekeys/bundle/:connectId", protectRoute, prekeyBundleRateLimiter, getPrekeyBundle);

// Replenish One-Time Prekeys for authenticated device
router.post("/prekeys/replenish", protectRoute, replenishOneTimePrekeys);

// Check prekey inventory status for authenticated device
router.get("/prekeys/status", protectRoute, getPrekeyStatus);
router.get("/prekeys/status/:connectId", protectRoute, getPrekeyStatus);

export default router;
