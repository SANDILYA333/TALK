# Cryptography 10: End-to-End Identity Lifecycle

## Overview
This document specifies the complete end-to-end lifecycle of a cryptographic device identity in TALK, from local keypair generation to server-side binding, multi-device management, discovery, and revocation.

```mermaid
sequenceDiagram
    autonumber
    actor User as User Device (Client)
    participant Storage as IndexedDB (Local)
    participant Server as TALK Backend
    participant DB as MongoDB (Registry)

    Note over User,Storage: 1. Key Generation & Persistence
    User->>User: Web Crypto X25519 Keypair Generation
    User->>Storage: Store CryptoKey pair (non-extractable)
    User->>User: SHA-256(PublicKey) -> Truncate 40b -> Crockford Base32 -> Connect ID

    Note over User,Server: 2. Proof-of-Possession Handshake
    User->>Server: POST /api/identity/challenge (Authenticated Session)
    Server->>Server: Generate Server Ephemeral Key + Nonce (60s TTL)
    Server-->>User: Return challengeId, serverEphemeralPubKey, nonce
    User->>User: X25519 DH Agreement + HMAC-SHA256(domain || nonce || clientPubKey)
    User->>Server: POST /api/identity/bind (clientPubKey, connectId, challengeId, proof)
    Server->>Server: Invalidate Challenge + Recompute DH/HMAC + Verify
    Server->>DB: Upsert DeviceIdentity (status: ACTIVE, boundAt: now)
    Server-->>User: 201 Created (status: ACTIVE)

    Note over User,Server: 3. Discovery & Multi-Device Operation
    actor Peer as Remote Peer
    Peer->>Server: GET /api/identity/lookup/:connectId
    Server->>DB: Query DeviceIdentity by Connect ID
    Server-->>Peer: Return publicKey, connectId, fullName, profilePic (Zero PII)

    Note over User,DB: 4. Revocation
    User->>Server: POST /api/identity/devices/:id/revoke (Authenticated)
    Server->>DB: Verify Ownership (userId == session.userId)
    Server->>DB: Set status = REVOKED, revokedAt = now
    Server-->>User: 200 OK (status: REVOKED)
```

## Cryptographic Guarantees Across Lifecycle

### 1. Generation & Storage Isolation
- **Algorithm**: X25519 Curve25519 Diffie-Hellman Key Exchange (`{ name: "X25519" }`).
- **Private Key Invariant**: The private key is generated with `extractable: true` solely for internal IndexedDB serialization via PKCS#8 formatting, but is never transmitted across the network.
- **Fail-Safe Persistence**: If storage corruption occurs, the client fails explicitly with `KeyStorageError` rather than silently generating an untrusted replacement key.

### 2. Connect ID Derivation Invariant
$$\text{Digest} = \text{SHA-256}(\text{CanonicalRawPublicKey})$$
$$\text{Entropy} = \text{Digest}[0..4] \quad (40 \text{ bits})$$
$$\text{ConnectID} = \text{"TALK-"} + \text{CrockfordBase32}(\text{Entropy})$$
- 32-character alphabet excluding ambiguous characters `I`, `L`, `O`, `U`.
- Hyphenated representation: `TALK-XXXX-XXXX` with total case-insensitive normalization.

### 3. Proof-of-Possession (PoP) Binding
- **Domain Separation**: `TALK-IDENTITY-BINDING-V1:`
- **Replay Resistance**: Server challenges are single-use and expire within 60 seconds.
- **Constant-Time Verification**: `crypto.timingSafeEqual` prevents side-channel timing attacks on the HMAC proof.

### 4. Zero-Knowledge Audit & Privacy Protection
- Public identity queries return zero account PII (no Clerk ID, email, or telephone number).
- Multiple devices per user are managed independently without device fingerprinting or cross-tenant exposure.
