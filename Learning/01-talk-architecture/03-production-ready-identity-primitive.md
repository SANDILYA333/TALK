# Architecture 03: Production-Ready Cryptographic Identity Primitive

## Introduction
With the completion of Feature 1 (Public-Key Connect ID / PII-Free Identity), TALK possesses a production-grade cryptographic identity foundation. This document summarizes the architectural structure, modules, invariants, and integration points.

---

## Architectural Decomposition

```
├── frontend/src/lib/crypto/
│   ├── constants.js          # Canonical algorithm ("X25519") & schema version (1)
│   ├── keypair.js            # Web Crypto X25519 key generation & PKCS#8 serialization
│   ├── storage.js            # IndexedDB persistent keypair storage & integrity checks
│   ├── connect-id.js         # Deterministic Crockford Base32 derivation & normalization
│   ├── binding.js            # Proof-of-Possession (PoP) Diffie-Hellman + HMAC generation
│   ├── identity.js           # High-level entry point (getOrCreateDeviceIdentity) & isCurrentDevice
│   └── index.js              # Unified public API export
├── backend/src/
│   ├── models/
│   │   └── device-identity.model.js  # Schema: connectId, publicKey, status, boundAt, revokedAt
│   ├── lib/crypto/
│   │   ├── constants.js      # Server-side algorithm and version constants
│   │   ├── connect-id.js     # Node.js canonical derivation & validation
│   │   └── binding.js        # Ephemeral challenge generator & constant-time PoP verifier
│   ├── middleware/
│   │   └── rate-limit.middleware.js  # Sliding-window rate limiter for public endpoints
│   ├── controllers/
│   │   └── identity.controller.js    # Hardened controllers (register, bind, lookup, devices, revoke)
│   └── routes/
│       └── identity.route.js         # REST endpoints mounted at /api/identity
```

---

## System Invariants

1. **Self-Sovereign Device Keypairs**:
   Private keys exist exclusively in client IndexedDB storage. Under no circumstances are private keys exposed to the backend, logs, or other devices.
2. **Deterministic Public Mapping**:
   A Connect ID is a strictly deterministic projection of an X25519 public key.
3. **Cryptographic Proof of Ownership**:
   Device registration to an account requires a zero-knowledge Proof-of-Possession handshake, proving ownership of the corresponding private key without exposing it.
4. **$1 \to N$ Multi-Device Support**:
   An authenticated user account can own multiple active cryptographic device identities. Revoking one device does not impair the operation of remaining devices.
5. **No Browser Fingerprinting**:
   Device disambiguation uses local cryptographic key matching (`isCurrentDevice`), avoiding invasive device fingerprinting.

---

## Readiness for Feature 2 (End-to-End Encryption)

Feature 1 provides the foundational cryptographic primitive required for upcoming E2EE features:
- The public key registry can be extended to publish and fetch **Signal Prekey Bundles** (Identity Key, Signed Prekey, One-Time Prekeys).
- The Connect ID provides a contact exchange handle that contains no personal information (phone numbers, emails, real names).
- The multi-device lifecycle guarantees that future ratchet sessions can be established across all active devices registered under a recipient account.
