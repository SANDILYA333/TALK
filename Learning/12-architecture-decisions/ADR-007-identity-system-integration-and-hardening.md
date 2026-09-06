# ADR-007: Identity System Integration & Security Hardening

## Status
Accepted (Phase 7 — Feature 1 Completion)

## Context
Across Phases 0 through 6 of Feature 1 (Public-Key Connect ID / PII-Free Identity), TALK established:
1. **Local Cryptographic Foundation**: X25519 asymmetric key generation and non-extractable IndexedDB persistence.
2. **Deterministic Connect ID Derivation**: SHA-256 digest truncated to 40 bits and Crockford Base32 encoded as `TALK-XXXX-XXXX`.
3. **Backend Public Key Registry**: MongoDB schema storing `connectId` and canonical `publicKey` without private key material.
4. **Zero-PII Discovery**: Rate-limited identity lookup returning only public cryptographic and display attributes (`fullName`, `profilePic`).
5. **Cryptographic Account Binding & Proof-of-Possession (PoP)**: Ephemeral X25519 Diffie-Hellman + HMAC-SHA256 handshake.
6. **Multi-Device Lifecycle Topology**: $1 \to N$ device ownership with `ACTIVE` and `REVOKED` states, fingerprint-free current device matching, and IDOR protection.

To ensure production stability, the final Phase 7 required a cohesive integration review, input boundary hardening, zero-knowledge payload verification, and property-based verification across the entire lifecycle.

## Decisions

### 1. In-Depth Input Validation & Boundary Hardening
All backend controllers enforce strict runtime type checks, length caps, and sanitization:
- `lookupIdentity`: Restricts raw Connect ID query parameters to strings $\le 50$ characters and normalizes Crockford Base32 characters prior to database execution.
- `revokeDevice`: Validates non-empty string IDs within safe length bounds, precluding prototype pollution, invalid type errors, or injection vectors.
- `bindIdentity`: Enforces string types on `publicKey`, `connectId`, `challengeId`, and `proof`, rejecting non-string structures before cryptographic execution.
- Rejection of Forbidden Fields: Explicit filter scanning (`FORBIDDEN_SECRET_FIELDS`) rejecting requests with private key or secret parameters.

### 2. Zero-Knowledge Network Payload Guarantees
All network boundaries strictly filter out sensitive credentials and authentication tokens:
- No private keys, PKCS#8 blobs, or shared secrets are accepted by or transmitted from the backend.
- Account identifiers (`clerkId`, email address, internal password hashes) are stripped from public responses.
- Client-side device matching utilizes `isCurrentDevice(deviceRecord, localIdentity)` comparing local public key and Connect ID, eliminating device fingerprinting (no User-Agent, canvas, or hardware sniffing).

### 3. Non-Destructive Audit Retention on Revocation
When a device is revoked:
- The database record is transitioned to `status = "REVOKED"` and `revokedAt = new Date()`.
- The record is retained to preserve historical message signatures, audit logs, and foreign key references.
- Active account `connectId` fallback syncs automatically to another active device if present, or `null` if no active devices remain.

### 4. Comprehensive Invariant & Integration Verification
- Automated node test runner suites execute property-based tests across 50 randomized keypairs verifying Crockford Base32 invariants.
- Integration tests assert full lifecycle progression: Challenge $\to$ PoP Bind $\to$ Lookup $\to$ Revoke $\to$ Cross-Account Isolation (IDOR defense).

## Consequences
- **Positive**: Complete defense-in-depth security model protecting user identity and privacy across multi-device setups.
- **Positive**: 100% test coverage across both backend (59 unit/integration tests) and frontend (47 unit/integration tests) with clean linter and production builds.
- **Positive**: Modular, decoupled cryptographic primitives prepared for Feature 2 (End-to-End Encryption, Double Ratchet, Prekey Bundles).
