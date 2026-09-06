import mongoose from "mongoose";
import DeviceIdentity from "../models/device-identity.model.js";
import User from "../models/user.model.js";
import { logger } from "../lib/logger.js";
import {
  canonicalizePublicKey,
  deriveConnectId,
  normalizeConnectId,
  isValidConnectId,
} from "../lib/crypto/connect-id.js";
import {
  IDENTITY_ALGORITHM,
  IDENTITY_VERSION,
} from "../lib/crypto/constants.js";
import {
  generateBindingChallenge,
  verifyBindingProof,
} from "../lib/crypto/binding.js";

// Explicit forbidden secret keys that must never be accepted by the registry
const FORBIDDEN_SECRET_FIELDS = [
  "privatekey",
  "secretkey",
  "pkcs8",
  "secret",
  "sharedsecret",
  "sessionkey",
  "privatekeyhex",
  "privatekeybase64",
  "private",
];

/**
 * Registers an X25519 public key and derived Connect ID for the authenticated user.
 * 
 * Invariants enforced:
 * 1. Strict rejection of private key material in request body.
 * 2. Authenticated user ID derived from server session (req.user), not client body.
 * 3. Independent server-side cryptographic derivation & verification of Connect ID from public key.
 * 4. Idempotent success when re-registering the same key on the same account.
 * 5. Database-level uniqueness and ownership conflict detection.
 */
export async function registerIdentity(req, res) {
  try {
    if (!req.user) {
      return res.status(401).json({ message: "Unauthorized" });
    }

    // Security Gate 1: Check for accidental or malicious private-key submissions
    const bodyKeys = Object.keys(req.body || {}).map((k) => k.toLowerCase().replace(/[^a-z0-9]/g, ""));
    for (const forbidden of FORBIDDEN_SECRET_FIELDS) {
      if (bodyKeys.includes(forbidden)) {
        return res.status(400).json({
          message: "Private key or secret material is strictly forbidden from transmission to the server.",
        });
      }
    }

    const {
      publicKey,
      connectId,
      algorithm = IDENTITY_ALGORITHM,
      version = IDENTITY_VERSION,
    } = req.body || {};

    if (!publicKey || typeof publicKey !== "string" || !connectId || typeof connectId !== "string") {
      return res.status(400).json({
        message: "Invalid or missing public key or Connect ID.",
      });
    }

    // Validation 1: Algorithm & Version
    if (algorithm !== IDENTITY_ALGORITHM) {
      return res.status(400).json({
        message: `Unsupported algorithm '${algorithm}'. Expected '${IDENTITY_ALGORITHM}'.`,
      });
    }

    if (Number(version) !== IDENTITY_VERSION) {
      return res.status(400).json({
        message: `Unsupported version '${version}'. Expected '${IDENTITY_VERSION}'.`,
      });
    }

    // Validation 2: Public Key Format & Canonicalization
    let canonicalHex;
    try {
      const canonical = canonicalizePublicKey(publicKey);
      canonicalHex = canonical.hex;
    } catch (err) {
      return res.status(400).json({
        message: `Invalid public key: ${err.message}`,
      });
    }

    // Validation 3: Connect ID Format
    let normalizedConnectId;
    try {
      normalizedConnectId = normalizeConnectId(connectId);
      if (!isValidConnectId(normalizedConnectId)) {
        return res.status(400).json({
          message: "Connect ID format is invalid.",
        });
      }
    } catch (err) {
      return res.status(400).json({
        message: `Invalid Connect ID: ${err.message}`,
      });
    }

    // Validation 4: Independent Server-Side Cryptographic Derivation
    const expectedConnectId = deriveConnectId(canonicalHex);
    if (expectedConnectId !== normalizedConnectId) {
      return res.status(400).json({
        message: "Connect ID does not match the supplied public key.",
      });
    }

    // Check existing registration for this connectId
    const existingByConnectId = await DeviceIdentity.findOne({
      connectId: normalizedConnectId,
    });

    if (existingByConnectId) {
      // If it belongs to another user -> Conflict
      if (existingByConnectId.userId.toString() !== req.user._id.toString()) {
        return res.status(409).json({
          message: "This Connect ID is already registered to another account.",
        });
      }

      // If it belongs to the same user and has same public key -> Idempotent success
      if (existingByConnectId.publicKey === canonicalHex) {
        // Ensure user model has connectId synced
        if (req.user.connectId !== normalizedConnectId) {
          await User.findByIdAndUpdate(req.user._id, {
            connectId: normalizedConnectId,
          });
        }

        return res.status(200).json({
          message: "Device identity is already registered.",
          connectId: normalizedConnectId,
          publicKey: canonicalHex,
          algorithm,
          version,
          isNew: false,
        });
      }

      // Same Connect ID but different public key (collision or tampering)
      return res.status(409).json({
        message: "Connect ID collision detected for existing device identity.",
      });
    }

    // Check if public key is already registered to another account
    const existingByKey = await DeviceIdentity.findOne({
      publicKey: canonicalHex,
    });

    if (existingByKey && existingByKey.userId.toString() !== req.user._id.toString()) {
      return res.status(409).json({
        message: "This public key is already registered to another account.",
      });
    }

    // Create new DeviceIdentity record
    const newIdentity = await DeviceIdentity.create({
      userId: req.user._id,
      clerkId: req.user.clerkId,
      connectId: normalizedConnectId,
      publicKey: canonicalHex,
      algorithm,
      version,
    });

    // Update primary user connectId
    await User.findByIdAndUpdate(req.user._id, {
      connectId: normalizedConnectId,
    });

    logger.info("identity_registered", "Device identity registered successfully", {
      userId: req.user._id,
      connectId: newIdentity.connectId,
      isNew: true,
    });

    return res.status(201).json({
      message: "Device identity registered successfully.",
      connectId: newIdentity.connectId,
      publicKey: newIdentity.publicKey,
      algorithm: newIdentity.algorithm,
      version: newIdentity.version,
      isNew: true,
    });
  } catch (error) {
    // Handle MongoDB duplicate key error (11000) during concurrent race condition
    if (error.code === 11000) {
      logger.warn("registration_conflict_race", "Duplicate key race detected during registration", {
        userId: req.user?._id,
      });
      return res.status(409).json({
        message: "Connect ID or public key is already registered.",
      });
    }

    logger.error("registration_failed", error.message, { userId: req.user?._id, error });
    return res.status(500).json({ message: "Internal server error" });
  }
}

/**
 * Looks up public identity metadata by Connect ID.
 * Returns safe public details (fullName, profilePic, publicKey, connectId) with ZERO PII.
 */
export async function lookupIdentity(req, res) {
  try {
    const rawConnectId = req.params.connectId;
    if (!rawConnectId || typeof rawConnectId !== "string" || rawConnectId.length > 50) {
      return res.status(400).json({ message: "Connect ID parameter is invalid or missing" });
    }

    let normalizedConnectId;
    try {
      normalizedConnectId = normalizeConnectId(rawConnectId);
    } catch {
      return res.status(400).json({ message: "Invalid Connect ID format" });
    }

    const identity = await DeviceIdentity.findOne({
      connectId: normalizedConnectId,
    }).populate("userId", "fullName profilePic");

    if (!identity) {
      return res.status(404).json({ message: "Identity not found" });
    }

    return res.status(200).json({
      connectId: identity.connectId,
      publicKey: identity.publicKey,
      algorithm: identity.algorithm,
      version: identity.version,
      user: {
        fullName: identity.userId?.fullName || "TALK User",
        profilePic: identity.userId?.profilePic || "",
      },
    });
  } catch (error) {
    logger.error("lookup_failed", error.message, { connectId: req.params.connectId, error });
    return res.status(500).json({ message: "Internal server error" });
  }
}

/**
 * Returns all registered device identities for the authenticated user.
 */
export async function getMyIdentities(req, res) {
  try {
    if (!req.user) {
      return res.status(401).json({ message: "Unauthorized" });
    }

    const devices = await DeviceIdentity.find({ userId: req.user._id })
      .select("_id connectId publicKey algorithm version status boundAt lastVerifiedAt revokedAt createdAt updatedAt")
      .sort({ createdAt: -1 })
      .lean();

    return res.status(200).json({
      identities: devices,
      devices,
    });
  } catch (error) {
    logger.error("get_my_identities_failed", error.message, { userId: req.user?._id, error });
    return res.status(500).json({ message: "Internal server error" });
  }
}

/**
 * Returns all registered device identities for the authenticated user (alias for getMyIdentities).
 */
export async function getDevices(req, res) {
  return getMyIdentities(req, res);
}

/**
 * Revokes a device identity owned by the authenticated user.
 *
 * Invariants enforced:
 * 1. Authenticated user derived from server session (req.user).
 * 2. Strict ownership verification: cannot revoke another account's device (403).
 * 3. Idempotent: revoking an already revoked device returns 200 OK.
 * 4. Audit retention: marks status = "REVOKED" and sets revokedAt, never deletes record.
 * 5. Syncs User.connectId if the revoked device was active on the user document.
 */
export async function revokeDevice(req, res) {
  try {
    if (!req.user) {
      return res.status(401).json({ message: "Unauthorized" });
    }

    const { id } = req.params;
    if (!id || typeof id !== "string" || id.trim().length === 0 || id.length > 100) {
      return res.status(400).json({ message: "Valid device ID is required." });
    }

    const device = await DeviceIdentity.findById(id);
    if (!device) {
      return res.status(404).json({ message: "Device identity not found." });
    }

    // Authorization & Ownership Check
    if (device.userId.toString() !== req.user._id.toString()) {
      logger.warn("unauthorized_revocation_attempt", "User attempted to revoke device belonging to another account", {
        actorUserId: req.user._id,
        targetDeviceId: id,
        deviceOwnerId: device.userId,
      });
      return res.status(403).json({
        message: "You do not have permission to revoke this device identity.",
      });
    }

    // Idempotent Check: if already revoked, return 200
    if (device.status === "REVOKED") {
      return res.status(200).json({
        message: "Device identity is already revoked.",
        deviceId: device._id,
        status: "REVOKED",
        revokedAt: device.revokedAt,
      });
    }

    device.status = "REVOKED";
    device.revokedAt = new Date();
    await device.save();

    // If User.connectId matches this device, update User.connectId
    if (req.user.connectId === device.connectId) {
      const remainingActiveDevice = await DeviceIdentity.findOne({
        userId: req.user._id,
        status: "ACTIVE",
      }).sort({ createdAt: -1 });

      await User.findByIdAndUpdate(req.user._id, {
        connectId: remainingActiveDevice ? remainingActiveDevice.connectId : null,
      });
    }

    logger.info("device_revoked", "Device identity revoked successfully", {
      userId: req.user._id,
      deviceId: device._id,
    });

    return res.status(200).json({
      message: "Device identity successfully revoked.",
      deviceId: device._id,
      status: "REVOKED",
      revokedAt: device.revokedAt,
    });
  } catch (error) {
    logger.error("revoke_device_failed", error.message, { userId: req.user?._id, error });
    return res.status(500).json({ message: "Internal server error" });
  }
}

/**
 * Creates an ephemeral cryptographic binding challenge for the authenticated user.
 */
export async function createChallenge(req, res) {
  try {
    if (!req.user) {
      return res.status(401).json({ message: "Unauthorized" });
    }

    const challenge = generateBindingChallenge(req.user._id);

    return res.status(200).json({
      challengeId: challenge.challengeId,
      serverEphemeralPublicKey: challenge.serverEphemeralPublicKey,
      challengeNonce: challenge.challengeNonce,
      expiresAt: challenge.expiresAt,
    });
  } catch (error) {
    logger.error("create_challenge_failed", error.message, { userId: req.user?._id, error });
    return res.status(500).json({ message: "Internal server error" });
  }
}

/**
 * Verifies proof-of-possession and establishes an authenticated binding
 * between the user's account and their device identity.
 *
 * Invariants enforced:
 * 1. Strict rejection of private key material in request body.
 * 2. Authenticated user ID derived from server session (req.user), ignoring client parameters.
 * 3. Independent server-side cryptographic derivation & verification of Connect ID.
 * 4. Single-use challenge validation and ephemeral X25519 Diffie-Hellman + HMAC verification.
 * 5. Ownership conflict rejection (409) if identity belongs to another account.
 * 6. Idempotent re-binding (200) for same account and same public key.
 */
export async function bindIdentity(req, res) {
  try {
    if (!req.user) {
      return res.status(401).json({ message: "Unauthorized" });
    }

    // Security Gate 1: Check for accidental or malicious private-key submissions
    const bodyKeys = Object.keys(req.body || {}).map((k) => k.toLowerCase().replace(/[^a-z0-9]/g, ""));
    for (const forbidden of FORBIDDEN_SECRET_FIELDS) {
      if (bodyKeys.includes(forbidden)) {
        return res.status(400).json({
          message: "Private key or secret material is strictly forbidden from transmission to the server.",
        });
      }
    }

    const {
      publicKey,
      connectId,
      challengeId,
      proof,
      algorithm = IDENTITY_ALGORITHM,
      version = IDENTITY_VERSION,
    } = req.body || {};

    // Validation 1: Required fields & strict type checks
    if (
      !publicKey ||
      typeof publicKey !== "string" ||
      !connectId ||
      typeof connectId !== "string" ||
      !challengeId ||
      typeof challengeId !== "string" ||
      !proof ||
      typeof proof !== "string"
    ) {
      return res.status(400).json({
        message: "Missing or invalid required fields (publicKey, connectId, challengeId, proof) in binding request.",
      });
    }

    // Validation 2: Algorithm & Version
    if (algorithm !== IDENTITY_ALGORITHM) {
      return res.status(400).json({
        message: `Unsupported algorithm '${algorithm}'. Expected '${IDENTITY_ALGORITHM}'.`,
      });
    }

    if (Number(version) !== IDENTITY_VERSION) {
      return res.status(400).json({
        message: `Unsupported version '${version}'. Expected '${IDENTITY_VERSION}'.`,
      });
    }

    // Validation 3: Public Key Format & Canonicalization
    let canonicalHex;
    try {
      const canonical = canonicalizePublicKey(publicKey);
      canonicalHex = canonical.hex;
    } catch (err) {
      return res.status(400).json({
        message: `Invalid public key: ${err.message}`,
      });
    }

    // Validation 4: Connect ID Format & Verification
    let normalizedConnectId;
    try {
      normalizedConnectId = normalizeConnectId(connectId);
      if (!isValidConnectId(normalizedConnectId)) {
        return res.status(400).json({
          message: "Connect ID format is invalid.",
        });
      }
    } catch (err) {
      return res.status(400).json({
        message: `Invalid Connect ID: ${err.message}`,
      });
    }

    const expectedConnectId = deriveConnectId(canonicalHex);
    if (expectedConnectId !== normalizedConnectId) {
      return res.status(400).json({
        message: "Connect ID does not match the supplied public key.",
      });
    }

    // Validation 5: Cryptographic Proof-of-Possession Verification
    const isValid = verifyBindingProof({
      challengeId,
      clientPublicKeyHex: canonicalHex,
      proofHex: proof,
      userId: req.user._id,
    });

    if (!isValid) {
      logger.warn("pop_verification_failed", "Proof-of-possession verification failed or expired", {
        userId: req.user._id,
      });
      return res.status(400).json({
        message: "Proof-of-possession verification failed or challenge is expired or invalid.",
      });
    }

    // Check existing registration for this connectId
    const existingByConnectId = await DeviceIdentity.findOne({
      connectId: normalizedConnectId,
    });

    if (existingByConnectId) {
      // If it belongs to another user -> Conflict
      if (existingByConnectId.userId.toString() !== req.user._id.toString()) {
        logger.warn("binding_ownership_conflict", "Connect ID collision across accounts", {
          actorUserId: req.user._id,
          existingOwnerId: existingByConnectId.userId,
        });
        return res.status(409).json({
          message: "This Connect ID is already bound to another account.",
        });
      }

      // If it belongs to the same user and has same public key -> Idempotent re-binding
      if (existingByConnectId.publicKey === canonicalHex) {
        existingByConnectId.status = "ACTIVE";
        existingByConnectId.lastVerifiedAt = new Date();
        existingByConnectId.boundAt = existingByConnectId.boundAt || new Date();
        await existingByConnectId.save();

        if (req.user.connectId !== normalizedConnectId) {
          await User.findByIdAndUpdate(req.user._id, {
            connectId: normalizedConnectId,
          });
        }

        return res.status(200).json({
          message: "Device identity is already bound to this account.",
          connectId: normalizedConnectId,
          publicKey: canonicalHex,
          status: "ACTIVE",
          isNew: false,
        });
      }

      // Same Connect ID but different public key (collision or tampering)
      return res.status(409).json({
        message: "Connect ID collision detected for existing device identity.",
      });
    }

    // Check if public key is already registered to another account
    const existingByKey = await DeviceIdentity.findOne({
      publicKey: canonicalHex,
    });

    if (existingByKey && existingByKey.userId.toString() !== req.user._id.toString()) {
      return res.status(409).json({
        message: "This public key is already registered to another account.",
      });
    }

    // Create new DeviceIdentity record with verified active binding
    const newIdentity = await DeviceIdentity.create({
      userId: req.user._id,
      clerkId: req.user.clerkId,
      connectId: normalizedConnectId,
      publicKey: canonicalHex,
      algorithm,
      version,
      status: "ACTIVE",
      boundAt: new Date(),
      lastVerifiedAt: new Date(),
    });

    // Update primary user connectId
    await User.findByIdAndUpdate(req.user._id, {
      connectId: normalizedConnectId,
    });

    logger.info("device_bound", "Device identity bound successfully with verified PoP", {
      userId: req.user._id,
      connectId: newIdentity.connectId,
    });

    return res.status(201).json({
      message: "Device identity successfully bound to account.",
      connectId: newIdentity.connectId,
      publicKey: newIdentity.publicKey,
      status: newIdentity.status,
      isNew: true,
    });
  } catch (error) {
    if (error.code === 11000) {
      return res.status(409).json({
        message: "Connect ID or public key is already registered.",
      });
    }

    logger.error("bind_identity_failed", error.message, { userId: req.user?._id, error });
    return res.status(500).json({ message: "Internal server error" });
  }
}

