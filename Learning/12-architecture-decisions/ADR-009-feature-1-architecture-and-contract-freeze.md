# ADR-009: Feature 1 Architecture & Contract Freeze

## Status
Accepted & Frozen (Phase 10 — Feature 1 Release Certification)

## Context
Feature 1 (Public-Key Connect ID / PII-Free Identity) has completed implementation across Phases 0 through 9:
- Phase 0: Identity Reconnaissance & Architecture Lock
- Phase 1: Cryptographic Identity Foundation (X25519)
- Phase 2: Deterministic Connect ID Generation (Crockford Base32)
- Phase 3: Backend Public-Key Identity Registry ($1:N$ topology)
- Phase 4: Connect ID Discovery & Identity Lookup
- Phase 5: Account ↔ Device Identity Binding & Ownership Proof (Ephemeral Diffie-Hellman + HMAC PoP)
- Phase 6: Multi-Device Identity Management & Non-Destructive Revocation
- Phase 7: Identity System Integration & Security Hardening
- Phase 8: Final System Validation & Security Audit
- Phase 9: Production Hardening, Safe Logging Observability & Runbooks

To ensure TALK maintains a solid foundation for Feature 2 (End-to-End Encrypted Messaging / Double Ratchet), all Feature 1 interfaces, cryptographic primitives, serialization formats, API contracts, and database schemas must be formally frozen against arbitrary modifications.

## Decisions

### 1. Cryptographic Primitive Freeze
- **Key Algorithm**: `X25519` (Curve25519 Diffie-Hellman) generated natively via Web Crypto API on client (`frontend/src/lib/crypto/keypair.js`).
- **Public Key Canonical Format**: 32-byte raw bytes, exported as 64-character lowercase hexadecimal string (`[0-9a-f]{64}`).
- **Private Key Storage**: Origin-isolated IndexedDB database (`talk_crypto_db`, object store `identity_keys`), serialized in PKCS#8 DER binary format.
- **Connect ID Derivation**: SHA-256 hash of domain tag (`TALK-CONNECT-ID-V1:`) + raw 32 public key bytes, truncated to first 5 bytes (40 bits), encoded in uppercase Crockford Base32 (`0-9, A-Z excluding I, L, O, U`), formatted with hyphen as `TALK-XXXX-XXXX`.

### 2. Zero-Secret Boundary Guarantee
- Private keys NEVER leave client memory/IndexedDB.
- Zero private keys, shared secrets, or seed bytes are ever transmitted over HTTP/WebSocket, persisted in MongoDB, or output to logs.
- Proof of private key ownership is strictly conducted via single-use ephemeral Diffie-Hellman challenge-response Proof-of-Possession (`TALK-IDENTITY-BINDING-V1:` domain tag).

### 3. API Contract Freeze
- `POST /api/identity/challenge`: Generates single-use 60s TTL server ephemeral X25519 key + nonce.
- `POST /api/identity/bind`: Verifies client PoP HMAC-SHA256 and registers/activates device identity.
- `POST /api/identity/register`: Idempotent registration with forbidden-secret-field filters.
- `GET /api/identity/lookup/:connectId`: Rate-limited zero-PII public key lookup returning `{ connectId, publicKey, createdAt }`.
- `GET /api/identity/devices`: Authenticated device list belonging to requesting user.
- `POST /api/identity/devices/:id/revoke`: Non-destructive revocation marking device `status: "REVOKED"` with audit timestamp.
- `GET /api/identity/me`: Current user's registered public identity metadata.

### 4. Database Schema Freeze
- **Mongoose Model**: `DeviceIdentity` with compound index `{ userId: 1, status: 1 }`, unique index on `connectId` and `publicKey`.
- Non-destructive audit trail: records are updated to `status: "REVOKED"` with `revokedAt`, never hard-deleted.

### 5. Modification Rules for Future Features
- Feature 1 contracts are frozen.
- Feature 2 (Signal Protocol / Double Ratchet) and downstream features MUST consume Feature 1 through its exposed public APIs (`getOrCreateDeviceIdentity`, `getDeviceConnectId`, `fetchMyDevices`, `lookupDeviceIdentity`) and MUST NOT mutate Feature 1 cryptographic internals or bypass server authorization boundaries.

## Consequences
- **Positive**: Complete architectural stability for downstream E2E messaging development.
- **Positive**: Deterministic client and server behavior across all multi-device and failure conditions.
- **Guaranteed Invariants**: Zero PII leakage, zero private key transmission, and strict IDOR protection permanently certified.
