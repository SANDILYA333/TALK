# Security 05: Identity Threat Model & Hardening Matrix

## Executive Summary
This document defines the comprehensive threat model and defensive mechanisms established in TALK for Feature 1 (Public-Key Connect ID / PII-Free Identity).

---

## Threat Matrix & Mitigations

| Threat Vector | Attack Scenario | Defensive Mechanism | Status |
| :--- | :--- | :--- | :--- |
| **Private Key Exfiltration** | Attacker intercepts network traffic or crafts payload containing private key | Client never exports private key to network; backend actively rejects any request with forbidden fields (`FORBIDDEN_SECRET_FIELDS`). | **Mitigated** |
| **Connect ID Spoofing / Tampering** | Attacker registers a public key with an arbitrary, stolen Connect ID | Backend independently recalculates `deriveConnectId(publicKey)` and rejects mismatches (400 Bad Request). | **Mitigated** |
| **Challenge Replay Attack** | Attacker captures a valid proof-of-possession and replays it later | Server invalidates challenge atomically on first read (`delete challenges[challengeId]`) and enforces 60-second TTL. | **Mitigated** |
| **Account Identity Takeover (IDOR)** | User A attempts to revoke or claim User B's device identity | All revocation and binding checks enforce `device.userId.toString() === req.user._id.toString()`, returning `403 Forbidden` on unauthorized actions and `409 Conflict` on cross-account collisions. | **Mitigated** |
| **Connect ID Enumeration / DoS** | Attacker floods `/lookup/:connectId` to map user identities or exhaust server | Sliding-window in-memory rate limiter caps lookups (30 req / min per IP), returning `429 Too Many Requests`. | **Mitigated** |
| **Race Condition / State Mismatch** | Slow network response for Query A arrives after fast response for Query B | Frontend search sequence tracker (`searchSeqRef`) drops stale asynchronous responses. | **Mitigated** |
| **Silent Key Regeneration / Split Brain** | IndexedDB corruption causes client to silently regenerate key, breaking contact links | Client throws fatal `KeyStorageError` when storage is corrupted, alerting the user rather than creating a split-brain identity. | **Mitigated** |
| **Browser Fingerprinting Surveillance** | Application tracks device fingerprints (canvas, User-Agent, screen resolution) | Device matching uses purely cryptographic comparison `isCurrentDevice(device, localIdentity)` comparing public keys / Connect IDs. Zero fingerprinting. | **Mitigated** |

---

## Defensive Coding Checklist

- [x] **Strict Type & Length Validation**: Every endpoint validates parameter types and enforces maximum buffer limits.
- [x] **Constant-Time Cryptographic Comparison**: `crypto.timingSafeEqual` used on all proof and secret evaluations.
- [x] **Zero-PII Serialization**: Stripping all internal account IDs, emails, and tokens from public-facing responses.
- [x] **Idempotent State Handling**: Re-registering, re-binding, or re-revoking identical identities returns safe `200 OK` responses without corrupting state.
- [x] **Audit Preservation**: Revocation alters lifecycle status (`status = "REVOKED"`, `revokedAt = new Date()`) without destroying historical relationship records.
