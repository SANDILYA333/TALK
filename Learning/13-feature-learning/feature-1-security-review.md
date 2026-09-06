# Feature 1 Security Review: Cryptographic Identity & Public-Key Connect ID

## 1. Executive Summary
This document provides the formal security evaluation of **Feature 1: Public-Key Connect ID / PII-Free Identity** for TALK. It covers threat modeling, cryptographic assumptions, trust boundaries, IDOR defenses, storage security, and residual risk assessments.

---

## 2. Threat Modeling Matrix

| Threat | Attack Vector | Expected Behavior | Actual Mitigation | Regression Test Reference | Remaining Risk / Note |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **Private Key Exfiltration** | Attacker intercepts network traffic or crafts payload containing private key | Private keys never leave IndexedDB / memory | Frontend asserts private keys not in payload (`assertNotInPayload`); Backend rejects forbidden fields (`FORBIDDEN_SECRET_FIELDS`) | [`integration-hardening.test.js:L301`](file:///home/kafka/Coding/Web_Dev/Projects/Real%20Time%20Chat%20Application/Real-Time-Chat-Application/backend/src/controllers/__tests__/integration-hardening.test.js#L301) | Physical host compromise of browser profile directory |
| **Connect ID Spoofing / Tampering** | Attacker sends valid public key with arbitrary or stolen Connect ID | Backend rejects tampered Connect ID (400) | Backend independently recalculates `deriveConnectId(publicKey)` and asserts equivalence | [`identity.test.js:L53`](file:///home/kafka/Coding/Web_Dev/Projects/Real%20Time%20Chat%20Application/Real-Time-Chat-Application/backend/src/controllers/__tests__/identity.test.js#L53) | None; derivation is deterministic |
| **Replay Attack on Binding** | Attacker intercepts proof-of-possession and resubmits | Replay rejected (400) | Server challenges have 60s TTL and are invalidated atomically before verification | [`binding.test.js:L277`](file:///home/kafka/Coding/Web_Dev/Projects/Real%20Time%20Chat%20Application/Real-Time-Chat-Application/backend/src/controllers/__tests__/binding.test.js#L277) | None; single-use challenge consumption |
| **Cross-Account IDOR on Revocation** | User A tries to revoke User B's device identity | Revocation denied (403 Forbidden) | Backend enforces `device.userId.toString() === req.user._id.toString()` derived from Clerk session | [`integration-hardening.test.js:L245`](file:///home/kafka/Coding/Web_Dev/Projects/Real%20Time%20Chat%20Application/Real-Time-Chat-Application/backend/src/controllers/__tests__/integration-hardening.test.js#L245) | None; verified on server session |
| **Cross-Account Identity Hijacking** | User A attempts to bind/register User B's public key | Registration denied (409 Conflict) | Database uniqueness constraints + ownership check on matching records | [`integration-hardening.test.js:L274`](file:///home/kafka/Coding/Web_Dev/Projects/Real%20Time%20Chat%20Application/Real-Time-Chat-Application/backend/src/controllers/__tests__/integration-hardening.test.js#L274) | None; database unique indexes prevent split ownership |
| **Connect ID Enumeration / DoS** | Automated scraping of public discovery endpoint | Rate limited (429 Too Many Requests) | Sliding-window in-memory rate limiter caps lookups at 30 req/min per IP | [`discovery.test.js:L67`](file:///home/kafka/Coding/Web_Dev/Projects/Real%20Time%20Chat%20Application/Real-Time-Chat-Application/backend/src/controllers/__tests__/discovery.test.js#L67) | Distributed botnets (mitigated via upstream Cloudflare / WAF in production) |
| **Silent Key Regeneration (Split-Brain)** | Local IndexedDB corruption causes client to generate replacement key | Client fails loudly with `KeyStorageError` | Storage loader validates schema integrity and throws explicit error without overwriting | [`identity.test.js:L178`](file:///home/kafka/Coding/Web_Dev/Projects/Real%20Time%20Chat%20Application/Real-Time-Chat-Application/frontend/src/lib/crypto/__tests__/identity.test.js#L178) | User must restore or clear storage explicitly |
| **Browser Fingerprinting Surveillance** | Application tracks device fingerprints (canvas, audio, screen, User-Agent) | Device matching uses purely cryptographic comparison | Client compares local public key and Connect ID via `isCurrentDevice()`. Zero fingerprinting. | [`integration-hardening.test.js:L100`](file:///home/kafka/Coding/Web_Dev/Projects/Real%20Time%20Chat%20Application/Real-Time-Chat-Application/frontend/src/lib/crypto/__tests__/integration-hardening.test.js#L100) | None; zero browser telemetry collected |
| **Zero-PII Response Exposure** | Public discovery endpoint leaks account email, phone, or Clerk ID | Exposes only public cryptographic metadata and display avatar/name | Controller projects only `connectId`, `publicKey`, `algorithm`, `version`, `fullName`, `profilePic` | [`integration-hardening.test.js:L301`](file:///home/kafka/Coding/Web_Dev/Projects/Real%20Time%20Chat%20Application/Real-Time-Chat-Application/backend/src/controllers/__tests__/integration-hardening.test.js#L301) | None; email and Clerk ID explicitly excluded |

---

## 3. Cryptographic Security Boundaries

```text
┌──────────────────────────────────────────────────────────────────┐
│                         TRUST BOUNDARY 1                         │
│                    Client Browser Memory & OS                    │
├──────────────────────────────────────────────────────────────────┤
│  • Private Scalar (CryptoKey) in Web Crypto non-extractable context│
│  • Ephemeral Diffie-Hellman Agreement                            │
│  • Stored in IndexedDB as PKCS#8 DER bytes                       │
└─────────────────────────────────┬────────────────────────────────┘
                                  │
                       No Private Keys Permitted
                                  │
                                  ▼
┌──────────────────────────────────────────────────────────────────┐
│                         TRUST BOUNDARY 2                         │
│                     Network Transport (HTTPS)                    │
├──────────────────────────────────────────────────────────────────┤
│  • Canonical 32-Byte Public Key (Hex / Crockford Base32)        │
│  • Single-Use Ephemeral Nonce & Challenge ID                     │
│  • HMAC-SHA256 Proof-of-Possession                               │
└─────────────────────────────────┬────────────────────────────────┘
                                  │
                      Clerk Session Authentication
                                  │
                                  ▼
┌──────────────────────────────────────────────────────────────────┐
│                         TRUST BOUNDARY 3                         │
│                    Backend Server & Database                     │
├──────────────────────────────────────────────────────────────────┤
│  • Express 5 Protected Middleware (req.user derived from JWT)    │
│  • Ephemeral Challenge Invalidation Store (60s TTL)              │
│  • Mongoose DeviceIdentity Collection ($1 \to N$ Isolation)      │
│  • Audit Preservation (status = "REVOKED", no hard deletion)     │
└──────────────────────────────────────────────────────────────────┘
```

---

## 4. Realistic XSS & Browser Storage Disclosure
IndexedDB provides origin isolation from third-party scripts. However, it is **not** a defense against arbitrary JavaScript execution within the same origin (XSS). If malicious code executes in the application origin, it can invoke Web Crypto or read IndexedDB records. To defend against this in future phases:
1. Strict Content Security Policy (CSP) headers restricting script sources.
2. Feature 4 (Encrypted Local Storage at Rest with user passphrases / WebAuthn PRF).

---

## 5. Security Invariant Checklist

- [x] **Invariant 1**: Private keys never leave the local device boundary.
- [x] **Invariant 2**: Connect IDs are deterministically derived using SHA-256 and Crockford Base32.
- [x] **Invariant 3**: Connect IDs are not authentication tokens or proof of identity without PoP binding.
- [x] **Invariant 4**: Account ownership is enforced by backend sessions, never trusted client parameters.
- [x] **Invariant 5**: $1 \to N$ multi-device topology allows multiple independent device keys per user.
- [x] **Invariant 6**: Revocation is audit-preserving and non-destructive.
- [x] **Invariant 7**: Zero PII (emails, phone numbers, Clerk IDs) is exposed in public discovery endpoints.
- [x] **Invariant 8**: Zero browser fingerprinting is employed for device identification.
