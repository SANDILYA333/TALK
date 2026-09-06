# Asymmetric Key Pairs & Curve25519 (X25519)

## 1. What Is This?
Asymmetric cryptography (or public-key cryptography) uses mathematically linked pairs of cryptographic keys: a **Private Key** (kept secret by the owner) and a **Public Key** (which can be safely published to anyone). While symmetric cryptography requires both parties to share the same secret key beforehand, asymmetric cryptography allows two parties who have never communicated to establish a secure shared secret over an insecure channel.

**Curve25519 / X25519** is an elliptic curve designed by Daniel J. Bernstein (RFC 7748) providing 128-bit security (comparable to 3072-bit RSA) using compact 256-bit (32-byte) keys, immune to timing and side-channel attacks.

## 2. Why Does TALK Need This?
In TALK, user communication was historically identified by centralized account data (Clerk ID, email, MongoDB `ObjectId`). To achieve PII-free privacy and pave the way for End-to-End Encryption (E2E), every TALK client device requires its own autonomous cryptographic identity. With an asymmetric key pair, the device's public key acts as its cryptographic identity anchor, while the private key enables it to decrypt incoming messages and derive shared secrets without trusting the central server with private data.

## 3. The Problem We Were Solving
1. **Server Trust Violation**: If identity and session keys are derived on the server, the server can decrypt all user messages and impersonate users.
2. **PII Exposure**: Using emails or phone numbers for user lookup creates massive privacy liabilities and spam vectors.
3. **Key Size & Performance**: Legacy primitives like RSA-4096 produce huge 512-byte keys that are slow to generate and expensive to transmit over mobile networks.

## 4. How It Works
X25519 relies on the **Diffie-Hellman problem on the Montgomery curve** $y^2 = x^3 + 486662x^2 + x$ over the prime field $2^{255} - 19$:

```text
Alice (Device A)                             Bob (Device B)
Private: a (256-bit scalar)                  Private: b (256-bit scalar)
Public:  A = a * G                           Public:  B = b * G
               │                                    │
               ├──────────── Public Key A ─────────>│ (Bob computes K = b * A)
               │<─────────── Public Key B ──────────┤ (Alice computes K = a * B)
               ▼                                    ▼
       Shared Secret K                      Shared Secret K
       (K = a * b * G)                      (K = b * a * G)
```

Both parties derive the exact same 32-byte shared secret point $K$ without ever transmitting their private scalars $a$ or $b$.

## 5. How TALK Implements It
TALK implements native X25519 keypair generation using the browser's Web Cryptography API (`crypto.subtle`):

```javascript
// frontend/src/lib/crypto/keypair.js
export async function generateIdentityKeyPair() {
  const subtle = getSubtleCrypto();
  const keyPair = await subtle.generateKey(
    { name: "X25519" },
    true, // extractable for local encrypted persistence
    ["deriveKey", "deriveBits"]
  );
  return { privateKey: keyPair.privateKey, publicKey: keyPair.publicKey };
}
```

## 6. Important Components
- [`frontend/src/lib/crypto/keypair.js`](file:///home/kafka/Coding/Web_Dev/Projects/Real%20Time%20Chat%20Application/Real-Time-Chat-Application/frontend/src/lib/crypto/keypair.js): Generates keypairs, handles PKCS#8 and raw exports/imports.
- [`frontend/src/lib/crypto/constants.js`](file:///home/kafka/Coding/Web_Dev/Projects/Real%20Time%20Chat%20Application/Real-Time-Chat-Application/frontend/src/lib/crypto/constants.js): Defines `IDENTITY_ALGORITHM = "X25519"` and key usages.
- [`frontend/src/lib/crypto/identity.js`](file:///home/kafka/Coding/Web_Dev/Projects/Real%20Time%20Chat%20Application/Real-Time-Chat-Application/frontend/src/lib/crypto/identity.js): High-level device identity lifecycle manager.

## 7. Data Flow
```text
Browser Launch / Login
         │
         ▼
getOrCreateDeviceIdentity()
         │
         ├── Check in-memory cache
         ├── Check IndexedDB
         │
         ▼ (If not found)
generateIdentityKeyPair()
         │
         ├── Web Crypto generates Curve25519 scalar (Private)
         ├── Derives curve base point multiple (Public)
         │
         ▼
exportPublicKey() ──> Canonical 32 bytes (Raw, Hex, Base64)
exportPrivateKey() ─> PKCS#8 ──> Stored in IndexedDB
```

## 8. Security Implications
- **Asset Protected**: Device private key scalar ($a$).
- **Threat & Attack Vector**: Malicious script / XSS attempting to inspect local state or exfiltrate credentials over network.
- **Mitigation Implemented**: The private key is held in non-global `CryptoKey` references and never serialized to public metadata objects, network payloads, or logs.
- **Residual Risk**: Root device compromise / malicious browser extension with full DOM and storage access.

## 9. Architectural Decisions
- **ADR-001**: Selected X25519 and Web Crypto API over RSA/P-256 and pure JavaScript libraries to eliminate dependencies and ensure native performance.

## 10. Alternatives Considered
1. **Ed25519**: Excellent for signatures, but requires curve conversion for Diffie-Hellman key exchange.
2. **P-256 (NIST)**: Vulnerable to implementation side-channels; larger key signatures.
3. **RSA-2048**: Slow key generation, massive key size (256 bytes vs 32 bytes).

## 11. Trade-offs (Why Alternatives Were Rejected)
- **Gained**: Compact 32-byte keys, constant-time arithmetic, direct compatibility with Signal X3DH protocol.
- **Sacrificed**: Cannot directly generate digital signatures without adding Ed25519 in later phases.

## 12. Failure Modes & Edge Cases
- **Unsupported Browser**: Very old browsers lacking `X25519` in `crypto.subtle` will throw explicit `KeyGenerationError`.
- **RNG Depletion**: Handled gracefully by OS entropy pool via `crypto.getRandomValues`.

## 13. Common Mistakes
- Storing private keys in `localStorage` as plaintext strings.
- Regenerating a new keypair on every component re-render instead of maintaining idempotent persistence.
- Transmitting private keys to the backend server.

## 14. What I Should Understand (Key Takeaways)
X25519 gives TALK devices a permanent, compact (32-byte) cryptographic identity that enables decentralized key agreement without trusting the server with secret keys.

## 15. Relevant TALK Files
- [`frontend/src/lib/crypto/keypair.js`](file:///home/kafka/Coding/Web_Dev/Projects/Real%20Time%20Chat%20Application/Real-Time-Chat-Application/frontend/src/lib/crypto/keypair.js)
- [`frontend/src/lib/crypto/constants.js`](file:///home/kafka/Coding/Web_Dev/Projects/Real%20Time%20Chat%20Application/Real-Time-Chat-Application/frontend/src/lib/crypto/constants.js)
- [`frontend/src/lib/crypto/__tests__/identity.test.js`](file:///home/kafka/Coding/Web_Dev/Projects/Real%20Time%20Chat%20Application/Real-Time-Chat-Application/frontend/src/lib/crypto/__tests__/identity.test.js)

## 16. Interview Questions I Should Be Able to Answer
1. *Why did you choose X25519 instead of RSA or P-256 for TALK's identity layer?*
2. *How does Diffie-Hellman allow two devices to compute a shared secret without sending the secret across the network?*
3. *What is the difference between Ed25519 and X25519, and when would you use each?*
4. *Why should private keys never be stored in localStorage?*
5. *How does the Web Cryptography API protect cryptographic key material in browser memory?*
