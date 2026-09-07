import mongoose from "mongoose";
import PreKeyBundle from "../models/prekey.model.js";
import DeviceIdentity from "../models/device-identity.model.js";
import { logger } from "../lib/logger.js";
import { normalizeConnectId, isValidConnectId } from "../lib/crypto/connect-id.js";
import { verifySignedPrekeySignature } from "../lib/crypto/prekey-verification.js";

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

function containsForbiddenSecrets(obj) {
  if (!obj || typeof obj !== "object") return false;
  const stack = [obj];
  const seen = new Set();

  while (stack.length > 0) {
    const current = stack.pop();
    if (!current || typeof current !== "object") continue;
    if (seen.has(current)) continue;
    seen.add(current);

    for (const key of Object.keys(current)) {
      const cleanKey = key.toLowerCase().replace(/[^a-z0-9]/g, "");
      for (const forbidden of FORBIDDEN_SECRET_FIELDS) {
        if (cleanKey === forbidden || cleanKey.includes("privatekey") || cleanKey.includes("secret")) {
          return true;
        }
      }
      if (typeof current[key] === "object" && current[key] !== null) {
        stack.push(current[key]);
      }
    }
  }
  return false;
}

function isValidHex(str, byteLength) {
  if (typeof str !== "string") return false;
  const clean = str.trim();
  if (clean.length !== byteLength * 2) return false;
  return /^[0-9a-fA-F]+$/.test(clean);
}

/**
 * Registers or updates the public Prekey Bundle for an authenticated device.
 */
export async function registerPrekeyBundle(req, res) {
  try {
    if (!req.user) {
      return res.status(401).json({ message: "Unauthorized" });
    }

    if (containsForbiddenSecrets(req.body)) {
      return res.status(400).json({
        message: "Private key or secret material is strictly forbidden from transmission to the server.",
      });
    }

    const {
      connectId,
      identityKeyDh,
      identityKeySign,
      signedPrekey,
      oneTimePrekeys = [],
      protocolVersion = 1,
    } = req.body || {};

    if (!connectId || typeof connectId !== "string") {
      return res.status(400).json({ message: "Missing or invalid connectId." });
    }

    let normalizedConnectId;
    try {
      normalizedConnectId = normalizeConnectId(connectId);
      if (!isValidConnectId(normalizedConnectId)) {
        return res.status(400).json({ message: "Invalid Connect ID format." });
      }
    } catch {
      return res.status(400).json({ message: "Invalid Connect ID format." });
    }

    // Verify Device Ownership & Active Status
    const device = await DeviceIdentity.findOne({ connectId: normalizedConnectId });
    if (!device) {
      return res.status(404).json({ message: "Device identity not found." });
    }

    if (device.userId.toString() !== req.user._id.toString()) {
      logger.warn("unauthorized_prekey_registration_attempt", "User attempted to register prekeys for another account", {
        actorUserId: req.user._id,
        deviceOwnerId: device.userId,
        connectId: normalizedConnectId,
      });
      return res.status(403).json({ message: "You do not have permission to register prekeys for this device." });
    }

    if (device.status !== "ACTIVE") {
      return res.status(400).json({ message: "Cannot register prekeys for a revoked device identity." });
    }

    // Validate Identity Keys
    if (!isValidHex(identityKeyDh, 32)) {
      return res.status(400).json({ message: "Invalid identityKeyDh (expected 64 hex characters)." });
    }
    if (identityKeyDh.toLowerCase() !== device.publicKey.toLowerCase()) {
      return res.status(400).json({ message: "identityKeyDh does not match registered device public key." });
    }

    if (!isValidHex(identityKeySign, 32)) {
      return res.status(400).json({ message: "Invalid identityKeySign (expected 64 hex characters for Ed25519)." });
    }

    // Validate Signed Prekey
    if (!signedPrekey || typeof signedPrekey !== "object") {
      return res.status(400).json({ message: "Missing signedPrekey object." });
    }
    if (typeof signedPrekey.keyId !== "number" || signedPrekey.keyId < 0) {
      return res.status(400).json({ message: "Invalid signedPrekey.keyId." });
    }
    if (!isValidHex(signedPrekey.publicKey, 32)) {
      return res.status(400).json({ message: "Invalid signedPrekey.publicKey (expected 64 hex characters)." });
    }
    if (!isValidHex(signedPrekey.signature, 64)) {
      return res.status(400).json({ message: "Invalid signedPrekey.signature (expected 128 hex characters)." });
    }

    // Cryptographic Signature Verification on Signed Prekey
    const isSignatureValid = await verifySignedPrekeySignature({
      signingPublicKeyHex: identityKeySign.toLowerCase(),
      keyId: signedPrekey.keyId,
      signedPrekeyPublicKeyHex: signedPrekey.publicKey.toLowerCase(),
      signatureHex: signedPrekey.signature.toLowerCase(),
    });

    if (!isSignatureValid) {
      logger.warn("invalid_signed_prekey_signature", "Prekey bundle registration rejected: invalid signature", {
        userId: req.user._id,
        connectId: normalizedConnectId,
      });
      return res.status(400).json({ message: "Signed prekey signature verification failed." });
    }

    // Validate One-Time Prekeys (if provided)
    if (!Array.isArray(oneTimePrekeys)) {
      return res.status(400).json({ message: "oneTimePrekeys must be an array." });
    }

    const seenOpkIds = new Set();
    const formattedOpks = [];

    for (const opk of oneTimePrekeys) {
      if (!opk || typeof opk !== "object") {
        return res.status(400).json({ message: "Malformed one-time prekey entry." });
      }
      if (typeof opk.keyId !== "number" || opk.keyId < 0) {
        return res.status(400).json({ message: "Invalid one-time prekey keyId." });
      }
      if (seenOpkIds.has(opk.keyId)) {
        return res.status(400).json({ message: `Duplicate one-time prekey keyId: ${opk.keyId}.` });
      }
      seenOpkIds.add(opk.keyId);

      if (!isValidHex(opk.publicKey, 32)) {
        return res.status(400).json({ message: `Invalid one-time prekey publicKey for keyId ${opk.keyId}.` });
      }

      formattedOpks.push({
        keyId: opk.keyId,
        publicKey: opk.publicKey.toLowerCase(),
        isConsumed: false,
        consumedAt: null,
        createdAt: new Date(),
      });
    }

    // Upsert PreKeyBundle
    const bundleData = {
      deviceId: device._id,
      userId: req.user._id,
      connectId: normalizedConnectId,
      identityKeyDh: identityKeyDh.toLowerCase(),
      identityKeySign: identityKeySign.toLowerCase(),
      signedPrekey: {
        keyId: signedPrekey.keyId,
        publicKey: signedPrekey.publicKey.toLowerCase(),
        signature: signedPrekey.signature.toLowerCase(),
        createdAt: signedPrekey.createdAt ? new Date(signedPrekey.createdAt) : new Date(),
        version: signedPrekey.version || 1,
      },
      oneTimePrekeys: formattedOpks,
      activeOpkCount: formattedOpks.length,
      protocolVersion: Number(protocolVersion) || 1,
    };

    const savedBundle = await PreKeyBundle.findOneAndUpdate(
      { deviceId: device._id },
      { $set: bundleData },
      { upsert: true, new: true }
    );

    logger.info("prekeys_registered", "Prekey bundle registered successfully", {
      userId: req.user._id,
      connectId: normalizedConnectId,
      opkCount: formattedOpks.length,
    });

    return res.status(200).json({
      message: "Prekey bundle registered successfully.",
      connectId: normalizedConnectId,
      activeOpkCount: savedBundle.activeOpkCount,
      protocolVersion: savedBundle.protocolVersion,
    });
  } catch (error) {
    logger.error("prekey_registration_failed", error.message, { userId: req.user?._id, error });
    return res.status(500).json({ message: "Internal server error" });
  }
}

/**
 * Retrieves a public Prekey Bundle for a target Connect ID and atomically consumes one One-Time Prekey.
 */
export async function getPrekeyBundle(req, res) {
  try {
    if (!req.user) {
      return res.status(401).json({ message: "Unauthorized" });
    }

    const rawConnectId = req.params.connectId;
    if (!rawConnectId || typeof rawConnectId !== "string" || rawConnectId.length > 50) {
      return res.status(400).json({ message: "Invalid Connect ID parameter." });
    }

    let normalizedConnectId;
    try {
      normalizedConnectId = normalizeConnectId(rawConnectId);
      if (!isValidConnectId(normalizedConnectId)) {
        return res.status(400).json({ message: "Invalid Connect ID format." });
      }
    } catch {
      return res.status(400).json({ message: "Invalid Connect ID format." });
    }

    const device = await DeviceIdentity.findOne({
      connectId: normalizedConnectId,
      status: "ACTIVE",
    });

    if (!device) {
      return res.status(404).json({ message: "Active device identity not found." });
    }

    // Atomic Step: Find unconsumed OPK and mark it as consumed in one atomic operation
    const consumeTime = new Date();
    let consumedOpk = null;

    const bundleWithConsumedOpk = await PreKeyBundle.findOneAndUpdate(
      {
        deviceId: device._id,
        "oneTimePrekeys.isConsumed": false,
      },
      {
        $set: {
          "oneTimePrekeys.$.isConsumed": true,
          "oneTimePrekeys.$.consumedAt": consumeTime,
        },
        $inc: { activeOpkCount: -1 },
      },
      { new: true }
    );

    let finalBundle = bundleWithConsumedOpk;

    if (bundleWithConsumedOpk) {
      // Find the OPK that was just consumed at consumeTime
      consumedOpk = bundleWithConsumedOpk.oneTimePrekeys.find(
        (k) => k.consumedAt && Math.abs(k.consumedAt.getTime() - consumeTime.getTime()) < 50
      );
      if (!consumedOpk) {
        // Fallback: take the last consumed OPK
        consumedOpk = bundleWithConsumedOpk.oneTimePrekeys.filter((k) => k.isConsumed).pop();
      }
    } else {
      // OPK pool exhausted: retrieve base bundle without OPK
      finalBundle = await PreKeyBundle.findOne({ deviceId: device._id });
    }

    if (!finalBundle) {
      return res.status(404).json({ message: "Prekey bundle not published for this device." });
    }

    return res.status(200).json({
      connectId: finalBundle.connectId,
      identityKeyDh: finalBundle.identityKeyDh,
      identityKeySign: finalBundle.identityKeySign,
      signedPrekey: {
        keyId: finalBundle.signedPrekey.keyId,
        publicKey: finalBundle.signedPrekey.publicKey,
        signature: finalBundle.signedPrekey.signature,
        createdAt: finalBundle.signedPrekey.createdAt,
        version: finalBundle.signedPrekey.version,
      },
      oneTimePrekey: consumedOpk
        ? {
            keyId: consumedOpk.keyId,
            publicKey: consumedOpk.publicKey,
          }
        : null,
      protocolVersion: finalBundle.protocolVersion,
    });
  } catch (error) {
    logger.error("get_prekey_bundle_failed", error.message, { connectId: req.params.connectId, error });
    return res.status(500).json({ message: "Internal server error" });
  }
}

/**
 * Replenishes One-Time Prekeys for the authenticated device.
 */
export async function replenishOneTimePrekeys(req, res) {
  try {
    if (!req.user) {
      return res.status(401).json({ message: "Unauthorized" });
    }

    if (containsForbiddenSecrets(req.body)) {
      return res.status(400).json({
        message: "Private key or secret material is strictly forbidden from transmission to the server.",
      });
    }

    const { connectId, oneTimePrekeys = [] } = req.body || {};
    if (!connectId || typeof connectId !== "string") {
      return res.status(400).json({ message: "Missing connectId." });
    }

    const normalizedConnectId = normalizeConnectId(connectId);
    const device = await DeviceIdentity.findOne({ connectId: normalizedConnectId });

    if (!device) {
      return res.status(404).json({ message: "Device identity not found." });
    }

    if (device.userId.toString() !== req.user._id.toString()) {
      return res.status(403).json({ message: "You do not have permission to replenish prekeys for this device." });
    }

    if (!Array.isArray(oneTimePrekeys) || oneTimePrekeys.length === 0) {
      return res.status(400).json({ message: "oneTimePrekeys must be a non-empty array." });
    }

    const bundle = await PreKeyBundle.findOne({ deviceId: device._id });
    if (!bundle) {
      return res.status(404).json({ message: "Initial prekey bundle must be registered before replenishing." });
    }

    const existingIds = new Set(bundle.oneTimePrekeys.map((k) => k.keyId));
    const newOpks = [];

    for (const opk of oneTimePrekeys) {
      if (!opk || typeof opk.keyId !== "number" || opk.keyId < 0) {
        return res.status(400).json({ message: "Invalid one-time prekey keyId." });
      }
      if (existingIds.has(opk.keyId)) {
        return res.status(400).json({ message: `Prekey keyId ${opk.keyId} already exists.` });
      }
      existingIds.add(opk.keyId);

      if (!isValidHex(opk.publicKey, 32)) {
        return res.status(400).json({ message: `Invalid one-time prekey publicKey for keyId ${opk.keyId}.` });
      }

      newOpks.push({
        keyId: opk.keyId,
        publicKey: opk.publicKey.toLowerCase(),
        isConsumed: false,
        consumedAt: null,
        createdAt: new Date(),
      });
    }

    bundle.oneTimePrekeys.push(...newOpks);
    bundle.activeOpkCount = bundle.oneTimePrekeys.filter((k) => !k.isConsumed).length;
    await bundle.save();

    logger.info("prekeys_replenished", "One-time prekeys replenished successfully", {
      userId: req.user._id,
      connectId: normalizedConnectId,
      addedCount: newOpks.length,
      activeCount: bundle.activeOpkCount,
    });

    return res.status(200).json({
      message: "One-time prekeys replenished successfully.",
      connectId: normalizedConnectId,
      activeOpkCount: bundle.activeOpkCount,
    });
  } catch (error) {
    logger.error("replenish_prekeys_failed", error.message, { userId: req.user?._id, error });
    return res.status(500).json({ message: "Internal server error" });
  }
}

/**
 * Returns prekey status (remaining active OPK count and SPK age) for the authenticated device.
 */
export async function getPrekeyStatus(req, res) {
  try {
    if (!req.user) {
      return res.status(401).json({ message: "Unauthorized" });
    }

    const rawConnectId = req.params.connectId || req.user.connectId;
    if (!rawConnectId) {
      return res.status(400).json({ message: "Connect ID is required." });
    }

    const normalizedConnectId = normalizeConnectId(rawConnectId);
    const device = await DeviceIdentity.findOne({ connectId: normalizedConnectId });

    if (!device) {
      return res.status(404).json({ message: "Device identity not found." });
    }

    if (device.userId.toString() !== req.user._id.toString()) {
      return res.status(403).json({ message: "Forbidden." });
    }

    const bundle = await PreKeyBundle.findOne({ deviceId: device._id });
    if (!bundle) {
      return res.status(200).json({
        hasBundle: false,
        activeOpkCount: 0,
        signedPrekeyAgeMs: null,
        needsReplenishment: true,
      });
    }

    const activeOpks = bundle.oneTimePrekeys.filter((k) => !k.isConsumed).length;
    const spkAge = bundle.signedPrekey?.createdAt
      ? Date.now() - new Date(bundle.signedPrekey.createdAt).getTime()
      : null;

    return res.status(200).json({
      hasBundle: true,
      connectId: normalizedConnectId,
      activeOpkCount: activeOpks,
      signedPrekeyAgeMs: spkAge,
      needsReplenishment: activeOpks < 10,
    });
  } catch (error) {
    logger.error("get_prekey_status_failed", error.message, { userId: req.user?._id, error });
    return res.status(500).json({ message: "Internal server error" });
  }
}
