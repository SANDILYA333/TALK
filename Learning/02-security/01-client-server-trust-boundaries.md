# Security Architecture: Client-Server Trust Boundaries & Zero-Trust Inputs

## 1. The Core Security Perimeter
In end-to-end encrypted messaging systems, the server must be treated as a **semi-trusted (honest-but-curious) relay and directory**, rather than an omniscient authority.

```text
══════════════════════════════════════════════════════════════════════
                      CLIENT TRUST PERIMETER
══════════════════════════════════════════════════════════════════════
  • X25519 Private Key ($k_{priv}$) stored in IndexedDB (non-extractable)
  • Plaintext message editing & rendering
  • Local cryptographic secret derivations (HKDF, Double Ratchet)
──────────────────────────────────────────────────────────────────────
                      NETWORK BOUNDARY (TLS)
──────────────────────────────────────────────────────────────────────
  • Public Key ($K_{pub}$) in transit
  • Connect ID in transit
  • Clerk Bearer Auth Tokens
══════════════════════════════════════════════════════════════════════
                      SERVER TRUST PERIMETER
══════════════════════════════════════════════════════════════════════
  • Account Authentication & Session Verification (Clerk Middleware)
  • Public Key Registry (`DeviceIdentity` in MongoDB)
  • Independent Connect ID Mathematical Verification
  • Rate Limiting & Uniqueness Enforcement
```

## 2. Rules of the Trust Boundary

### Rule 1: Never Trust Client-Asserted Identity Claims
Clients cannot be trusted to self-report their `userId`, `accountRole`, or `connectId`.
- The user account MUST be extracted from the cryptographically verified session token (`req.user` from `protectRoute`).
- The `connectId` MUST be mathematically verified against the submitted `publicKey`.

### Rule 2: Strict Exclusion of Secret Material
The client must never transmit private key material, and the backend must actively enforce this invariant:
```javascript
// Server-side guardrail against accidental secret leaks
const FORBIDDEN_SECRET_FIELDS = [
  "privatekey", "secretkey", "pkcs8", "secret", "sharedsecret", "sessionkey"
];
```
If any forbidden field is detected in the HTTP request payload, the server rejects the request immediately.

### Rule 3: Isolation of PII in Discovery Queries
When user A searches for user B using B's Connect ID:
- The registry returns: `{ connectId, publicKey, fullName, profilePic }`
- The registry MUST NOT return: `{ email, clerkId, phone, mongoId }`

This prevents Connect IDs from becoming an enumeration vector for scraping personal identifiable information.
