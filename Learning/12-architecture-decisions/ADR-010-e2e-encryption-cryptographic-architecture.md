# ADR-010: TALK End-to-End Encryption Cryptographic Architecture

## Status
Accepted (Feature 2 — Phase 1: Cryptographic Architecture & Protocol Foundation)

## Context
TALK currently secures user authentication and account synchronization via Clerk and mirrors metadata in MongoDB Atlas. Feature 1 (Public-Key Connect ID / PII-Free Identity) established an asymmetric $1:N$ multi-device identity layer based on native `X25519` key agreements, zero-secret logging, and challenge-response Proof-of-Possession (frozen in ADR-009).

However, real-time message payloads (`text`, `image`, `video`) are currently transmitted and stored in plaintext. To eliminate server trust for message content and provide military-grade confidentiality, integrity, forward secrecy, and post-compromise security, TALK is implementing **Feature 2: Signal-Protocol End-to-End Encryption** (X3DH + Double Ratchet).

### The Core Architectural Problem
Feature 1 established `X25519` as the device identity key. However, X25519 (RFC 7748) is strictly a Diffie-Hellman key agreement function; it does not compute digital signatures. In Signal's X3DH (Extended Triple Diffie-Hellman) protocol, a user's Signed Prekey ($SPK$) must be authenticated by their long-term identity key to prevent man-in-the-middle (MITM) adversaries from publishing spoofed prekeys on the server registry.

We must resolve:
1. How TALK authenticates X3DH prekeys while preserving the frozen Feature 1 device identity architecture.
2. Which cryptographic primitives, libraries, and key derivation structures TALK will adopt.
3. The exact boundaries between client trust, server knowledge, and Clerk authentication.

---

## Decisions

### 1. Dual-Key Device Identity Architecture ($IK_{dh} + IK_{sign}$)
To achieve authenticated prekey bundles without compromising cryptographic primitive separation or risking sign-bit malleability:
- **DH Identity Key ($IK_{dh}$)**: `X25519` (RFC 7748). Preserves Feature 1 Connect ID derivation (`TALK-XXXX-XXXX`), device lookup, and Diffie-Hellman calculations ($DH1$, $DH2$ in X3DH).
- **Signing Identity Key ($IK_{sign}$)**: `Ed25519` (RFC 8032). Generated client-side alongside $IK_{dh}$ on device registration, persisted in origin-isolated IndexedDB, and used exclusively to create and verify signatures on Signed Prekeys ($SPK$).
- **No Cross-Curve Conversion**: We reject ad-hoc X25519-to-Ed25519 birational conversions (e.g. naive Edwards-to-Montgomery mapping without sign bits), keeping both primitives standard, clean, and isolated.

### 2. Cryptographic Primitives & Library Selection
We evaluate native Web Crypto API (`SubtleCrypto`), `@noble/curves`, and `libsodium-wrappers`:

| Criterion | Native Web Crypto API | libsodium-wrappers | @noble/curves |
| :--- | :--- | :--- | :--- |
| **Browser Support** | Universal (Chrome 113+, Safari 17+, Firefox 129+) | Universal (WASM/JS fallback) | Universal (Pure JS) |
| **Node.js Support** | Universal (`node:crypto` / global `crypto`) | Universal | Universal |
| **X25519 & Ed25519** | Native hardware/C++ backed in SubtleCrypto | Native via WASM | Pure JS implementation |
| **HKDF-SHA-256** | Native (`SubtleCrypto.deriveBits`) | Native (`crypto_kdf`) | Pure JS (`@noble/hashes`) |
| **AES-256-GCM** | Native hardware accelerated (AES-NI) | Native | Pure JS (`@noble/ciphers`) |
| **Bundle Impact** | **0 KB** (Built-in runtime primitive) | ~180 KB WASM/JS bundle | ~30–50 KB minified |
| **Auditability** | Browser engine core (BoringSSL/NSS/OpenSSL) | Vetted Libsodium C core | Highly respected independent audit |
| **Protocol Suitability** | Standardized, non-extractable CryptoKey handles | Functional C-style APIs | Pure algorithmic primitives |

**Decision**: TALK adopts the **native Web Crypto API (`SubtleCrypto`)** as the primary runtime engine for X25519, Ed25519, HKDF-SHA-256, and AES-256-GCM. If rare legacy browser environments lack SubtleCrypto Ed25519 support, micro-scoped audited fallbacks will be used without altering wire schemas.

### 3. Key Hierarchy & Lifecycle Matrix

| Key Type | Primitive | Location | Published to Server? | Rotated? | Destroyed / Deleted? | Purpose |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **DH Identity Key ($IK_{dh}$)** | X25519 | Client IndexedDB | Public Key only | No (Device lifetime) | On device revocation | Connect ID derivation & X3DH DH agreement |
| **Signing Identity Key ($IK_{sign}$)** | Ed25519 | Client IndexedDB | Public Key only | No (Device lifetime) | On device revocation | Authenticates Signed Prekey ($SPK$) |
| **Signed Prekey ($SPK$)** | X25519 | Client IndexedDB | Public Key + Signature | Periodically (e.g. 7 days) | After rotation retention | Asynchronous DH key agreement |
| **One-Time Prekeys ($OPK_i$)** | X25519 | Client IndexedDB | Public Keys (batch of 50) | Constantly replenished | Deleted immediately upon first use | Single-use forward secrecy protection |
| **Ephemeral Key ($EK$)** | X25519 | Transient Client RAM | Public Key in initial msg | Per session init | Discarded immediately after X3DH KDF | Sender ephemeral DH entropy |
| **Root Key ($RK$)** | 256-bit symmetric | Client Session RAM/IDB | **NEVER** | Every DH ratchet step | Replaced by KDF output | Advances the DH Ratchet |
| **Sending Chain Key ($CK_s$)** | 256-bit symmetric | Client Session RAM/IDB | **NEVER** | Every message sent | Replaced by KDF output | Generates sending message keys |
| **Receiving Chain Key ($CK_r$)** | 256-bit symmetric | Client Session RAM/IDB | **NEVER** | Every message received | Replaced by KDF output | Generates receiving message keys |
| **Message Key ($MK$)** | 256-bit AES-GCM | Transient Client RAM | **NEVER** | Unique per message | **Zeroized immediately** after enc/dec | Symmetric message encryption |

### 4. X3DH Protocol Specification
When Alice initiates an encrypted session with Bob:
1. **Bob's Published Prekey Bundle**: Bob maintains on the backend registry:
   $$\text{Bundle}_B = \{ IK_{dh}^B, IK_{sign}^B, SPK^B, \text{Sig}(IK_{sign}^B, \text{SPK}^B), OPK_1^B \dots OPK_n^B \}$$
2. **Alice Fetches & Verifies**: Alice retrieves Bob's bundle and verifies:
   $$\text{Verify}(IK_{sign}^B, \text{SPK}^B, \text{Signature}) == \text{TRUE}$$
3. **Alice Ephemeral Generation**: Alice generates a fresh ephemeral X25519 keypair $EK^A$.
4. **Triple / Quadruple Diffie-Hellman Calculation**:
   - $DH1 = \text{X25519}(IK_{dh}^A, SPK^B)$ (Provides mutual authentication & resistance to MITM)
   - $DH2 = \text{X25519}(EK^A, IK_{dh}^B)$ (Provides forward secrecy with respect to Alice's long-term key)
   - $DH3 = \text{X25519}(EK^A, SPK^B)$ (Provides forward secrecy with respect to ephemeral keys)
   - $DH4 = \text{X25519}(EK^A, OPK^B)$ (If OPK available; provides single-use replay & forward secrecy)
5. **Master Shared Secret Derivation**:
   $$SK = \text{HKDF-SHA-256}(\text{salt}=0^{32}, \text{IKM}=DH1 \parallel DH2 \parallel DH3 [\parallel DH4], \text{info}=\text{"TALK-X3DH-V1:ROOT-AGREEMENT"})$$
6. Alice initializes her Double Ratchet root key with $SK$.

### 5. Double Ratchet State Machine & Key Derivation
- **DH Ratchet (Asymmetric)**: Generates a new Root Key ($RK_{i+1}$) and Chain Key ($CK$) whenever a new ratchet public key is received from the partner:
  $$(RK_{i+1}, CK) = \text{HKDF-SHA-256}(RK_i, \text{X25519}(DH_{local}, DH_{remote}), \text{"TALK-DOUBLE-RATCHET-V1:ROOT-KDF"})$$
- **Symmetric Ratchet (Per-Message)**: Advances chain key and computes single-use message key:
  $$MK_{i,j} = \text{HMAC-SHA-256}(CK_{i,j}, \text{"TALK-DOUBLE-RATCHET-V1:MESSAGE-KEY"})$$
  $$CK_{i,j+1} = \text{HMAC-SHA-256}(CK_{i,j}, \text{"TALK-DOUBLE-RATCHET-V1:CHAIN-KDF"})$$
- **Skipped Message Keys**:
  - When messages arrive out of order, the receiver steps the symmetric chain forward, stores intermediate $MK$s in a local dictionary indexed by $(DH_{pub}, N)$, bounded by `MAX_SKIPPED_MESSAGE_KEYS = 1000` and `SKIPPED_MESSAGE_KEY_TTL_MS = 7 days`.
  - Stored $MK$ is immediately deleted once the skipped message is decrypted.

### 6. Message Envelope & Associated Data (AEAD)
Every encrypted payload is encapsulated in a canonical envelope:
```json
{
  "version": 1,
  "protocol": "TALK-E2EE-V1",
  "sessionId": "sess_<uuid>",
  "senderDeviceId": "TALK-XXXX-XXXX",
  "recipientDeviceId": "TALK-YYYY-YYYY",
  "messageType": "whisper",
  "ratchetHeader": {
    "dhRatchetPublicKey": "<64-hex>",
    "messageNumber": 0,
    "previousChainLength": 0
  },
  "ciphertext": "<base64>",
  "iv": "<hex-24-chars>",
  "createdAt": "2026-09-07T..."
}
```
**Associated Data Invariant**:
The Associated Data passed into `AES-256-GCM` contains the canonical byte serialization of `version || sessionId || senderDeviceId || recipientDeviceId || messageType || dhRatchetPublicKey || messageNumber || previousChainLength`. Any tampering with message routing, ordering, or ratchet keys causes authentication tag verification to fail immediately.

### 7. Server Knowledge Boundary
- **Server May Know**: Account ownership, public keys ($IK_{dh}, IK_{sign}, SPK, OPKs$), signatures, ciphertext envelopes, routing metadata, timestamps.
- **Server Must Never Know**: Private keys, root keys, chain keys, message keys, plaintext messages, plaintext media.

---

## Consequences

### Positive
- **Cryptographic Separation**: Strictly respects RFC 7748 (Diffie-Hellman) and RFC 8032 (Ed25519 Signatures) without dangerous curve conversions.
- **Feature 1 Compatibility**: 100% preserves existing Connect ID derivation, device identity models, and challenge-response binding (ADR-001 through ADR-009).
- **Forward Secrecy & Healing**: Compromise of a device's current state cannot reveal past messages (forward secrecy) and future messages heal as soon as an uncompromised DH ratchet step executes (post-compromise security).
- **Zero Secrets on Wire/Server**: Formally enforced by client-side assertion guards and backend secret filters.

### Trade-offs & Mitigations
- **Storage Overhead**: Clients store skipped message keys until received or expired (bounded to 1000 keys to prevent memory exhaustion).
- **Prekey Replenishment**: Clients must monitor and replenish OPK pools when count drops below `MIN_ONE_TIME_PREKEYS_THRESHOLD = 10`.

---

## References
- RFC 7748: Elliptic Curves for Security (Curve25519 / X25519)
- RFC 8032: Edwards-Curve Digital Signature Algorithm (Ed25519)
- RFC 5869: HMAC-based Extract-and-Expand Key Derivation Function (HKDF)
- Signal Protocol X3DH Specification (P. Rösler et al.)
- Signal Protocol Double Ratchet Specification (Trevor Perrin, Moxie Marlinspike)
