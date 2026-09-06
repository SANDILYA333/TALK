import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { sanitizeLogData, logger, LogLevel } from "../logger.js";

describe("Backend Safe Structured Logger (Phase 9)", () => {
  it("redacts known forbidden secret keys recursively", () => {
    const rawData = {
      userId: "user_123",
      privateKey: "302e020100300506032b656e04220420...",
      nested: {
        secretKey: "super_secret_material",
        authorization: "Bearer secret_jwt_token",
        safeField: "safe_value",
      },
      tags: ["active", "test"],
    };

    const sanitized = sanitizeLogData(rawData);

    assert.equal(sanitized.userId, "user_123");
    assert.equal(sanitized.privateKey, "[REDACTED]");
    assert.equal(sanitized.nested.secretKey, "[REDACTED]");
    assert.equal(sanitized.nested.authorization, "[REDACTED]");
    assert.equal(sanitized.nested.safeField, "safe_value");
    assert.deepEqual(sanitized.tags, ["active", "test"]);
  });

  it("handles null, undefined, primitive, and Error objects safely", () => {
    assert.equal(sanitizeLogData(null), null);
    assert.equal(sanitizeLogData(undefined), undefined);
    assert.equal(sanitizeLogData(12345), 12345);

    const err = new Error("Database timeout");
    err.code = "ECONNRESET";
    const sanitizedErr = sanitizeLogData(err);
    assert.equal(sanitizedErr.name, "Error");
    assert.equal(sanitizedErr.message, "Database timeout");
    assert.equal(sanitizedErr.code, "ECONNRESET");
  });

  it("safely logs without throwing exceptions across all log levels", () => {
    assert.doesNotThrow(() => {
      logger.info("test_event", "Test info message", { user: "u1" });
      logger.warn("test_event", "Test warn message", { warning: "high_load" });
      logger.error("test_event", "Test error message", { error: new Error("fail") });
      logger.critical("test_event", "Test critical message", { privateKey: "leak" });
    });
  });
});
