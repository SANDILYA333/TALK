# ADR-002 — Deterministic Connect ID Derivation via Domain-Tagged SHA-256 and Crockford Base32

## Status
Accepted

## Context
In Phase 1, TALK established a local cryptographic device identity based on Curve25519 (X25519) with a 32-byte public key. However, raw 32-byte binary buffers or 64-character hexadecimal strings are impractical for human communication, manual keyboard entry, and visual verification.

TALK requires a human-shareable, PII-free public identifier (the "Connect ID") that:
1. Is deterministically derived from the canonical 32-byte X25519 public key.
2. Contains zero personally identifiable information (no email, phone, Clerk ID, usernames, timestamps).
3. Is compact, readable, and resistant to transcription errors (e.g. confusing `0` with `O` or `1` with `I`/`L`).
4. Employs cryptographic domain separation to prevent cross-protocol hash collision or reuse.
5. Does not require or expose the device private key.

## Decision
We define the TALK Connect ID derivation standard using **Domain-Tagged SHA-256 Hashing** and **Crockford's Base32 Encoding**:

1. **Domain Separation Tag**: `TALK-CONNECT-ID-V1:` (ASCII string prepended to the public key before hashing).
2. **Hash Function**: `SHA-256` via Web Cryptography API (`crypto.subtle.digest("SHA-256", payload)`).
3. **Truncation**: The first 5 bytes (40 bits) of the 32-byte SHA-256 digest are extracted.
4. **Encoding**: The 5 bytes are encoded into 8 uppercase characters using **Crockford's Base32 alphabet** (`0123456789ABCDEFGHJKMNPQRSTVWXYZ`).
5. **Formatting**: Formatted with the prefix `TALK-` and two 4-character blocks separated by a hyphen: `TALK-XXXX-XXXX` (e.g., `TALK-8F2K-91XZ`). Total length is exactly 14 characters.
6. **Error Tolerance & Normalization**: User inputs are normalized by converting to uppercase, stripping whitespace/hyphens, and mapping ambiguous characters (`I`/`L` $\rightarrow$ `1`, `O` $\rightarrow$ `0`).

## Pipeline Diagram
```text
X25519 Public Key (32 bytes)
              │
              ▼
Domain Tag: "TALK-CONNECT-ID-V1:" (19 bytes)
              │
              ▼
   SHA-256(Tag || PublicKey) ──> 32-Byte Digest
              │
              ▼
     Extract First 5 Bytes (40 bits)
              │
              ▼
  Crockford Base32 Encoding (8 chars)
              │
              ▼
    Format as TALK-XXXX-XXXX (14 chars)
```

## Why This Approach?
1. **Collision Resistance for PII-Free Discovery**: 40 bits ($2^{40} \approx 1.1 \times 10^{12}$) provides over 1 trillion unique codes, making accidental collision among active users negligible while keeping the code human-typable.
2. **Human Error Immunity (Crockford Base32)**: Traditional Base64 and standard RFC 4648 Base32 include ambiguous characters (`0`/`O`, `1`/`I`/`l`) and case sensitivity. Crockford Base32 excludes `I`, `L`, `O`, and `U`, preventing transcription mistakes and accidental offensive words.
3. **Zero Dependencies & Native Performance**: SHA-256 is natively supported in all browsers via `crypto.subtle`, executing in $<0.1\text{ms}$.
4. **Domain Separation Security**: Prepended domain tagging guarantees that the hash cannot be replayed or conflated with message authentication tags, ratchet keys, or other future SHA-256 digests derived from the same public key.

## Alternatives Considered
1. **Direct Hexadecimal Truncation (e.g., `TALK-7A8B-C9D0`)**:
   - *Why rejected*: Hexadecimal has only 16 symbols (4 bits/char). Representing 40 bits would require 10 characters instead of 8, making the code longer and less memorable.
2. **Raw Public Key as ID (64 Hex / 44 Base64)**:
   - *Why rejected*: Far too long for humans to type or read aloud over a call; contradicts the goal of user-friendly PII-free discovery.
3. **Random Nonce / Database Auto-Increment ID**:
   - *Why rejected*: Breaks cryptographic determinism. A user reloading their device without database access would not be able to locally reconstruct their own Connect ID.

## Trade-offs
- **Gained**: Compact 14-character format (`TALK-XXXX-XXXX`), human-tolerant character set, 100% deterministic, zero network requirements, zero private-key exposure.
- **Sacrificed**: 40-bit truncation does not represent the full 256-bit public key. The backend registry (Phase 3) must resolve the Connect ID to the full 32-byte public key point for cryptographic handshakes.

## Security Consequences
- **PII Isolation**: The derivation function takes only the 32-byte public key. It is mathematically impossible for user names, emails, or Clerk IDs to leak into the Connect ID.
- **Private Key Isolation**: Connect ID derivation is a pure function operating exclusively on public key material. The private scalar is never passed or inspected.

## TALK Implementation
- Constants: [`frontend/src/lib/crypto/constants.js`](file:///home/kafka/Coding/Web_Dev/Projects/Real%20Time%20Chat%20Application/Real-Time-Chat-Application/frontend/src/lib/crypto/constants.js)
- Derivation logic: [`frontend/src/lib/crypto/connect-id.js`](file:///home/kafka/Coding/Web_Dev/Projects/Real%20Time%20Chat%20Application/Real-Time-Chat-Application/frontend/src/lib/crypto/connect-id.js)
- Error classes: [`frontend/src/lib/crypto/errors.js`](file:///home/kafka/Coding/Web_Dev/Projects/Real%20Time%20Chat%20Application/Real-Time-Chat-Application/frontend/src/lib/crypto/errors.js)
- Identity integration: [`frontend/src/lib/crypto/identity.js`](file:///home/kafka/Coding/Web_Dev/Projects/Real%20Time%20Chat%20Application/Real-Time-Chat-Application/frontend/src/lib/crypto/identity.js)
- Automated tests: [`frontend/src/lib/crypto/__tests__/connect-id.test.js`](file:///home/kafka/Coding/Web_Dev/Projects/Real%20Time%20Chat%20Application/Real-Time-Chat-Application/frontend/src/lib/crypto/__tests__/connect-id.test.js)

## Future Impact
- **Phase 3 (Backend Identity Registry)**: MongoDB will store `connectId` with a unique index alongside the full `publicKey` string.
- **Phase 4 (User Discovery)**: Users will search for contacts by entering their `TALK-XXXX-XXXX` Connect ID.
- **Phase 7 (Connect ID UX)**: UI will render the Connect ID with copy buttons and QR code representations.
