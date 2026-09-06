# Cryptographic Hashing & SHA-256

## 1. What Is This?
A **cryptographic hash function** is a mathematical algorithm that transforms an arbitrary-length block of binary data into a fixed-size bit string (a digest) such that:
1. **Deterministic**: The exact same input always produces the exact same digest.
2. **Pre-image Resistant (One-Way)**: Given a digest $h$, it is computationally infeasible to find the original message $m$ such that $\text{hash}(m) = h$.
3. **Second Pre-image Resistant**: Given input $m_1$, it is infeasible to find a distinct $m_2$ such that $\text{hash}(m_1) = \text{hash}(m_2)$.
4. **Collision Resistant**: It is infeasible to find any two distinct inputs that produce the same digest.
5. **Avalanche Effect**: Changing a single bit in the input radically alters the resulting digest.

**SHA-256** (Secure Hash Algorithm 256-bit) is a member of the SHA-2 family standardized by NIST (FIPS 180-4), producing a 32-byte (256-bit) digest.

## 2. Why Does TALK Need This?
TALK uses SHA-256 to convert a device's 32-byte X25519 public key point into a uniform, pseudorandom 32-byte digest that can be safely truncated and encoded into a human-shareable Connect ID (`TALK-XXXX-XXXX`). Hashing ensures that the resulting identifier has uniform entropy distribution across all bits regardless of elliptic curve coordinate distribution.

## 3. The Problem We Were Solving
- Public keys on Curve25519 are elliptic curve points. Truncating raw public key coordinates directly could bias specific bit positions.
- Using the raw public key as a user handle is too long (64 hex characters / 44 base64 characters) for human typing or verbal exchange.
- Hashing creates a compact, uniform fingerprint of the public key.

## 4. How It Works
In TALK, domain-tagged hashing is computed over the public key bytes:

```text
Domain Tag: "TALK-CONNECT-ID-V1:" (19 bytes ASCII)
                    +
Raw Public Key: 32 bytes (Curve25519 point)
                    │
                    ▼ (51 bytes total payload)
               ┌──────────┐
               │ SHA-256  │
               └────┬─────┘
                    ▼
          32-Byte Hash Digest
                    │
                    ▼ (Extract first 5 bytes)
           [B0, B1, B2, B3, B4] (40 bits)
                    │
                    ▼
          Crockford Base32 (8 chars)
```

## 5. How TALK Implements It
In [`frontend/src/lib/crypto/connect-id.js`](file:///home/kafka/Coding/Web_Dev/Projects/Real%20Time%20Chat%20Application/Real-Time-Chat-Application/frontend/src/lib/crypto/connect-id.js):
```javascript
const domainBytes = new TextEncoder().encode("TALK-CONNECT-ID-V1:");
const payload = new Uint8Array(domainBytes.length + rawPublicKey.length);
payload.set(domainBytes, 0);
payload.set(rawPublicKey, domainBytes.length);

const hashBuffer = await subtle.digest("SHA-256", payload);
const hashBytes = new Uint8Array(hashBuffer);
const truncatedBytes = hashBytes.slice(0, 5);
```

## 6. Important Components
- [`frontend/src/lib/crypto/constants.js`](file:///home/kafka/Coding/Web_Dev/Projects/Real%20Time%20Chat%20Application/Real-Time-Chat-Application/frontend/src/lib/crypto/constants.js): `CONNECT_ID_DOMAIN_TAG = "TALK-CONNECT-ID-V1:"`.
- [`frontend/src/lib/crypto/connect-id.js`](file:///home/kafka/Coding/Web_Dev/Projects/Real%20Time%20Chat%20Application/Real-Time-Chat-Application/frontend/src/lib/crypto/connect-id.js): `deriveConnectId()`.

## 7. Data Flow
```text
X25519 Public Key ──> Prepend Domain Tag ──> SHA-256 Digest ──> Slice 5 Bytes ──> Base32 Encode ──> TALK-XXXX-XXXX
```

## 8. Security Implications
- **Asset**: Public key derivation integrity.
- **Threat**: Cross-protocol replay attack where a hash digest is mistaken for an encryption key or signature verification hash.
- **Mitigation**: Domain separation tag (`TALK-CONNECT-ID-V1:`) guarantees the digest is unique to Connect ID derivation.
- **Residual Risk**: 40-bit truncation ($2^{40}$) space is vulnerable to intentional birthday-bound search if an attacker deliberately generates $2^{20} \approx 10^6$ keys to find a target Connect ID. (Mitigated in Phase 3 by requiring the backend to verify the full 256-bit public key on registration).

## 9. Architectural Decisions
- **ADR-002**: Selected SHA-256 with domain tagging and 5-byte truncation for Connect ID derivation.

## 10. Alternatives Considered
1. **BLAKE3 / BLAKE2b**: Faster in software, but lacks native Web Crypto API support in browsers (would require a 30KB+ WASM/JS library).
2. **SHA-1 / MD5**: Broken cryptographic collision resistance; prohibited by modern security standards.
3. **SHA-512**: Produces 64-byte digest; unnecessary overhead when only 5 bytes are extracted.

## 11. Trade-offs
- **Gained**: Native Web Crypto support, zero external dependencies, robust pre-image resistance.
- **Sacrificed**: SHA-256 is slightly slower than BLAKE3 on massive data, but for 51-byte payloads execution time is $<0.1\text{ms}$.

## 12. Failure Modes & Edge Cases
- Calling `crypto.subtle.digest` in an unsupported environment throws `KeySerializationError`.

## 13. Common Mistakes
- Hashing raw JSON or Base64 strings instead of canonical raw 32-byte binary buffers.
- Omitting domain separation tags, leading to cross-protocol hash collisions.

## 14. What I Should Understand (Key Takeaways)
SHA-256 provides a deterministic, one-way bridge from a 32-byte public key to a compact 40-bit identifier with uniform bit distribution.

## 15. Relevant TALK Files
- [`frontend/src/lib/crypto/connect-id.js`](file:///home/kafka/Coding/Web_Dev/Projects/Real%20Time%20Chat%20Application/Real-Time-Chat-Application/frontend/src/lib/crypto/connect-id.js)
- [`frontend/src/lib/crypto/constants.js`](file:///home/kafka/Coding/Web_Dev/Projects/Real%20Time%20Chat%20Application/Real-Time-Chat-Application/frontend/src/lib/crypto/constants.js)

## 16. Interview Questions I Should Be Able to Answer
1. *What is domain separation in cryptographic hashing and why is it important?*
2. *Why do we hash the public key before truncating it, instead of truncating the public key directly?*
3. *What is the birthday paradox and how does it relate to the 40-bit truncation of Connect IDs?*
4. *How does SHA-256 guarantee that two users with different keys will not easily generate the same Connect ID?*
5. *Why is Web Crypto's subtle.digest preferable to importing a third-party SHA-256 JavaScript library?*
