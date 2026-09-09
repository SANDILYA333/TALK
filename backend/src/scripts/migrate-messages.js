/**
 * TALK Database Message Migration & Schema Alignment Script (Feature 2 — Phase 2.6)
 *
 * Provides safe, idempotent database auditing and remediation:
 *  1. Identifies legitimate historical legacy messages (text != null, encryptedEnvelope == null) and preserves them.
 *  2. Identifies valid E2EE encrypted messages (text == null, encryptedEnvelope != null).
 *  3. Remediates conflicting records (text != null, encryptedEnvelope != null) by nullifying text in favor of E2EE.
 *  4. Identifies invalid or corrupted message records.
 *  5. Operates in dry-run mode by default; executes writes only when explicitly instructed.
 *  6. Zero secret leakage: No plaintext message contents or cryptographic keys are ever logged.
 */

import mongoose from "mongoose";
import Message from "../models/message.model.js";
import { logger } from "../lib/logger.js";

/**
 * Audits and migrates message records in the database.
 *
 * @param {object} [options={}]
 * @param {boolean} [options.dryRun=true] - If true, scans and audits without modifying documents
 * @param {object} [options.query={}] - Optional query filter
 * @returns {Promise<{
 *   total: number,
 *   legacyCount: number,
 *   encryptedCount: number,
 *   conflictedCount: number,
 *   remediatedCount: number,
 *   invalidCount: number,
 *   errors: Array<string>
 * }>}
 */
export async function runMessageMigration({ dryRun = true, query = {} } = {}) {
  const summary = {
    total: 0,
    legacyCount: 0,
    encryptedCount: 0,
    conflictedCount: 0,
    remediatedCount: 0,
    invalidCount: 0,
    errors: [],
  };

  try {
    const cursor = Message.find(query).cursor();

    for await (const doc of cursor) {
      summary.total += 1;

      const hasEnvelope = Boolean(doc.encryptedEnvelope);
      const hasText = doc.text !== null && doc.text !== undefined && doc.text !== "";
      const hasMedia = Boolean(doc.image || doc.video);

      // Case 1: Conflicted state (both text and encryptedEnvelope present)
      if (hasEnvelope && hasText) {
        summary.conflictedCount += 1;
        if (!dryRun) {
          doc.text = null;
          await doc.save();
          summary.remediatedCount += 1;
        }
        continue;
      }

      // Case 2: Valid E2EE Encrypted Message
      if (hasEnvelope && !hasText) {
        summary.encryptedCount += 1;
        continue;
      }

      // Case 3: Legitimate Legacy Plaintext / Media Message (Historical record)
      if (!hasEnvelope && (hasText || hasMedia)) {
        summary.legacyCount += 1;
        // Non-destructive: Historical text is left intact
        continue;
      }

      // Case 4: Invalid empty record
      summary.invalidCount += 1;
    }

    logger.info("message_migration_completed", "Message migration audit completed", {
      dryRun,
      total: summary.total,
      legacyCount: summary.legacyCount,
      encryptedCount: summary.encryptedCount,
      conflictedCount: summary.conflictedCount,
      remediatedCount: summary.remediatedCount,
      invalidCount: summary.invalidCount,
    });

    return summary;
  } catch (error) {
    logger.error("message_migration_failed", "Error during message migration", {
      error: error.message,
    });
    summary.errors.push(error.message);
    return summary;
  }
}

// Standalone execution entrypoint (if run directly via Node CLI)
if (process.argv[1] && process.argv[1].endsWith("migrate-messages.js")) {
  const isExecute = process.argv.includes("--execute");
  const mongoUri = process.env.MONGODB_URI || "mongodb://localhost:27017/chat_db";

  (async () => {
    try {
      await mongoose.connect(mongoUri);
      console.log(`Connected to MongoDB. Starting migration (Mode: ${isExecute ? "EXECUTE" : "DRY-RUN"})...`);
      const result = await runMessageMigration({ dryRun: !isExecute });
      console.log("Migration Summary:", JSON.stringify(result, null, 2));
      await mongoose.disconnect();
      process.exit(0);
    } catch (err) {
      console.error("Migration fatal error:", err);
      process.exit(1);
    }
  })();
}
