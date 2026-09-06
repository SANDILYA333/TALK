# ADR-005: Account ↔ Device Identity Binding via Cryptographic Proof-of-Possession

## Status
Accepted

## Context
TALK establishes user authentication through Clerk JWT sessions (`req.user`), while end-to-end identity foundation is anchored on local device-generated X25519 keypairs and deterministic Connect IDs (`TALK-XXXX-XXXX`).

In Phase 3, public keys could be submitted directly via registration. However, without Proof of Possession (PoP), the server could not mathematically prove that the authenticated client actually possessed the private key corresponding to the claimed public key, allowing hypothetical identity claiming or replay attacks.

Furthermore, X25519 is a key-agreement primitive (Montgomery curve $y^2 = x^3 + 486662x^2 + x$) designed for Diffie-Hellman scalar multiplication, not digital signatures. Converting X25519 to Ed25519 (or dual-key management) introduces curve conversion risks (sign-bit ambiguities) and complexity.

## Decision
1. **Challenge-Response Ephemeral Diffie-Hellman + HMAC Protocol**:
   - The client requests an ephemeral challenge from `POST /api/identity/challenge`.
   - The server generates an ephemeral X25519 keypair and a cryptographically secure 32-byte random nonce with a 60-second TTL.
   - The client performs Diffie-Hellman key agreement: $\text{sharedSecret} = \text{X25519}(\text{clientPrivKey}, \text{serverEphemeralPubKey})$.
   - The client computes proof: $\text{HMAC-SHA256}(\text{sharedSecret}, \text{"TALK-IDENTITY-BINDING-V1:"} \parallel \text{challengeNonce} \parallel \text{clientPublicKey})$.
   - The server validates the proof, verifies ownership against the authenticated Clerk session, and invalidates the challenge immediately (single-use).

2. **Replay & Impersonation Mitigations**:
   - Challenges are single-use (`activeChallenges.delete(challengeId)` occurs immediately upon verification attempt).
   - Domain separation tag `TALK-IDENTITY-BINDING-V1:` prevents cross-protocol reuse.
   - Challenge is cryptographically bound to the authenticated `userId`.

3. **Ownership Conflict and Idempotence**:
   - If an identity is already bound to another account $\to$ `409 Conflict`.
   - If an identity is re-bound by the same account with matching public key $\to$ `200 OK` (idempotent status update).

## Consequences
- **Positive**:
  - Proves possession of the X25519 private key without transmitting or exposing private key material.
  - Avoids dangerous curve conversions or dual signing key overhead.
  - Native Web Crypto API support across all modern browsers and Node.js.
  - Zero PII leaks to the public registry.
- **Negative / Trade-offs**:
  - Ephemeral challenges require server-side state in memory during the 60s TTL window.
