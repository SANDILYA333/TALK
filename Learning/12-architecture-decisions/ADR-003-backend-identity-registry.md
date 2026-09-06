# ADR-003: Backend Public-Key Identity Registry & Account Binding

## Status
**Accepted** (Feature 1 — Phase 3)

## Context
In Phase 1 and Phase 2, TALK established client-side X25519 asymmetric device key generation and deterministic Connect ID derivation (`TALK-XXXX-XXXX` via SHA-256 and Crockford Base32). However, this cryptographic identity existed only on local client devices in IndexedDB (`talk_crypto_db`).

To enable peer-to-peer discovery (Phase 4), contact exchanges, safety number verifications (Feature 5), and Signal Protocol key agreements (Feature 2), the TALK backend must maintain a centralized public-key registry. The server must be able to answer:
> "Which registered TALK account/device corresponds to this Connect ID, and what public key belongs to it?"

At the same time, the system must strictly prevent private keys from ever reaching the server and reject forged or mismatched Connect ID claims.

## Problem Statement
1. **Zero-Trust Client Claims**: If the server blindly trusts a client's assertion that `connectId = "TALK-8F2K-91XZ"`, a malicious actor could claim another user's Connect ID without holding the corresponding private/public key.
2. **Private Key Boundary**: Private keys must remain exclusively on the client device. Any inadvertent transmission or persistence of private key material compromises the security posture.
3. **Multi-Device Extensibility**: The database model must not tightly couple one user account to exactly one public key, or future multi-device support (Phase 6) would require painful migrations.
4. **Idempotency & Concurrency**: Client application reloads or network retries must not create duplicate identity records or trigger spurious errors.
5. **PII Isolation**: The identity lookup mechanism must allow discovery by Connect ID without exposing email addresses or Clerk account identifiers.

## Decision

### 1. Dedicated `DeviceIdentity` Collection & Schema
We introduced a dedicated Mongoose model `DeviceIdentity` (`backend/src/models/device-identity.model.js`) referencing the authenticated `User._id`:
```javascript
{
  userId: { type: ObjectId, ref: "User", required: true, index: true },
  clerkId: { type: String, required: true, index: true },
  connectId: { type: String, required: true, unique: true, index: true, uppercase: true, trim: true },
  publicKey: { type: String, required: true, unique: true, index: true, trim: true },
  algorithm: { type: String, required: true, default: "X25519" },
  version: { type: Number, required: true, default: 1 },
  createdAt: Date,
  updatedAt: Date
}
```
- A sparse `connectId` field is also maintained on `User` for backward-compatible user queries and profile joins.
- Compound indexing on `{ userId: 1, publicKey: 1 }` allows efficient multi-device querying per account.

### 2. Independent Server-Side Cryptographic Verification
When a client submits `{ publicKey, connectId, algorithm, version }` to `POST /api/identity/register`, the backend:
1. Extracts the authenticated account from Clerk session middleware (`req.user`), ignoring any client-supplied user identifiers.
2. Canonicalizes the public key (verifying 32-byte length and valid hexadecimal encoding).
3. Independently computes:
   $$\text{expectedConnectId} = \text{deriveConnectId}(\text{publicKey})$$
   using the exact domain separation tag `TALK-CONNECT-ID-V1:`, SHA-256 hash, 5-byte truncation, and Crockford Base32 encoding.
4. Asserts that $\text{expectedConnectId} === \text{normalizeConnectId}(\text{connectId})$. If unequal, the registration is immediately rejected with `400 Bad Request`.

```text
Client Payload: { publicKey, connectId }
                       │
                       ▼
Backend Derivation: deriveConnectId(publicKey)
                       │
                       ▼
Is expectedConnectId === client connectId?
         ├── NO  ──► 400 Bad Request ("Connect ID mismatch")
         └── YES ──► Enforce Uniqueness & Persist
```

### 3. Strict Forbidden Field Guardrail
The registration controller checks for forbidden secret keys (`privateKey`, `secretKey`, `pkcs8`, `sharedSecret`, `sessionKey`) in the incoming payload and rejects the request with `400 Bad Request` if detected, ensuring no accidental leakage occurs.

### 4. Idempotency & Conflict Handling
- **Same user + same key + same Connect ID**: Returns `200 OK` (`isNew: false`), idempotently succeeding without creating duplicate database rows.
- **Different user + existing Connect ID / Public Key**: Returns `409 Conflict` ("already registered to another account").
- **Database Unique Constraint**: MongoDB unique indexes on `connectId` and `publicKey` catch concurrent race conditions, mapping error code 11000 to `409 Conflict`.

### 5. PII-Free Identity Lookup
`GET /api/identity/lookup/:connectId` populates only public user profile fields (`fullName`, `profilePic`) alongside `connectId` and `publicKey`, strictly omitting `email` and `clerkId`.

## Alternatives Considered

| Alternative | Evaluation | Reason for Rejection |
| :--- | :--- | :--- |
| **Store identity directly in `User` model only** | Simple 1:1 embedding | Fails multi-device requirements (Phase 6) where one account operates multiple independent devices/keypairs. |
| **Blindly trust client-supplied Connect ID** | Low server CPU overhead | Catastrophic security vulnerability: allows arbitrary Connect ID squatting and impersonation. |
| **Require digital signature proof of possession (X25519 Ed25519 dual-key)** | Cryptographically proves private key possession during registration | Adds significant complexity before needed; deferred to Phase 5 (Identity Binding & Authentication) where formal signature proofs are scheduled. |
| **Require private key escrow on server** | Allows server-side key backup | Violates zero-knowledge and end-to-end security principles; private keys must NEVER leave the device. |

## Consequences
- **Positive**:
  - Secure, tamper-proof binding between Clerk accounts and public cryptographic keys.
  - Zero private key leakage to server or database.
  - Full multi-device readiness from day one via separate `DeviceIdentity` collection.
  - Safe, deterministic public lookup with zero PII exposure.
  - Idempotent client startup workflow.
- **Negative / Operational Considerations**:
  - Requires maintaining matching cryptographic derivation logic across both frontend (Web Crypto) and backend (Node `node:crypto`). Both are fully covered by synchronized unit test suites.
