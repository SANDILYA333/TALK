# ADR-006: Multi-Device Cryptographic Identity Model and Device Lifecycle

## Status
Accepted

## Context
In early phases of TALK's architecture, identity was predominantly single-device: an authenticated user account was associated with a single active Connect ID / public key.

However, secure communication systems in practice operate across multiple devices per user (phones, laptops, tablets, browser sessions). A naive approach would either:
1. Copy/synchronize private keys across devices via cloud backup or export (violating the core zero-knowledge invariant that private keys never leave their originating device).
2. Collapse all devices under a single shared public key (which is impossible without sharing the corresponding private key).
3. Create separate user accounts for each device (ruining the user experience and social graph).

## Decision
1. **$1 \to N$ Account-to-Device Cryptographic Relationship**:
   - The user account (`User` model / Clerk authentication) is the human entity.
   - Each device generates its own independent X25519 asymmetric keypair locally in IndexedDB.
   - Each device deterministically derives its own unique Connect ID (`TALK-XXXX-XXXX`).
   - The backend `DeviceIdentity` collection stores each device as an independent document with `userId: req.user._id`, `publicKey`, `connectId`, and `status`.

2. **Zero Private-Key Synchronization**:
   - Private keys are never synchronized, exported, or transmitted across devices.
   - Multi-device message fanout and cryptographic key exchange will occur at the protocol level (via per-device encryption in later phases) rather than key sharing.

3. **Lifecycle States: `ACTIVE` vs `REVOKED`**:
   - A device becomes `ACTIVE` upon successful Proof-of-Possession binding.
   - An authenticated account owner can revoke any of their devices via `POST /api/identity/devices/:id/revoke`.
   - Revocation marks `status = "REVOKED"` and sets `revokedAt = new Date()`.
   - Records are never deleted to preserve cryptographic audit trails and prevent dangling foreign keys.

4. **Fingerprint-Free Local Device Detection**:
   - The frontend identifies the "Current Device" strictly by matching the local keypair's `connectId` / `publicKeyHex` from IndexedDB against the server's registered devices list, completely avoiding invasive browser fingerprinting (canvas, User-Agent, IP, screen size).

## Consequences
- **Positive**:
  - Full multi-device support with zero private-key exposure across devices.
  - Transparent device management and instant revocation of lost/compromised devices.
  - Preserves privacy with zero browser fingerprinting.
  - Clear separation of concerns between account auth and device cryptography.
- **Negative / Trade-offs**:
  - Outgoing messages to a multi-device recipient will eventually need to be encrypted separately for each of the recipient's active devices (standard Signal-style fanout in Feature 2).
