# ADR-008: Production Observability & Safe Diagnostics

## Status
Accepted (Phase 9 — Feature 1 Operationalization)

## Context
Following the security validation in Phase 8, Feature 1 required a robust operational framework to support production monitoring, incident triage, and debugging without introducing privacy vulnerabilities or secret leakage. Unstructured `console.error` logging presented risks of logging raw secret buffers or authorization headers.

## Decisions

### 1. Zero-Secret Structured Logger (`logger.js`)
- Replaced direct `console.error` calls in identity controllers with a centralized safe logger (`backend/src/lib/logger.js`).
- Implemented recursive key sanitization that automatically redacts forbidden secret keys (`privateKey`, `secretKey`, `pkcs8`, `password`, `authorization`, `cookie`, `token`) to `[REDACTED]`.
- Enforced structured JSON log schemas with timestamp, log level (`INFO`, `WARN`, `ERROR`, `CRITICAL`), event name, and safe metadata.

### 2. Failure Classification & Error Taxonomy
- Enriched client cryptographic errors with `isTransient` vs `isPermanent` properties to prevent infinite retry loops on fatal errors (e.g. `KeyStorageError`).
- Separated developer diagnostics (`error.message`) from user-facing presentations (`error.userMessage`) to avoid exposing internal implementation details to end users.

### 3. Operational Runbook & Incident Triage
- Documented standardized operational procedures (`Learning/08-observability/03-operational-runbook.md`) for diagnosing storage corruption, binding failures, rate limits, and cross-account collisions without requesting private key material.

## Consequences
- **Positive**: Production-grade observability without any possibility of secret leakage into centralized log aggregators (e.g., Datadog, CloudWatch).
- **Positive**: Clear separation between recoverable network glitches and fatal cryptographic storage corruptions.
- **Positive**: Comprehensive operational documentation for future developers and support engineers.
