# ADR-001 — Client-Side X25519 Asymmetric Identity Key Pair & IndexedDB Storage

## Status
Accepted

## Context
TALK requires a cryptographic, PII-free communication identity foundation to replace dependence on plaintext personal identifiers (email, phone numbers, MongoDB `_id`) for discovery and messaging. In subsequent phases, this identity layer will support human-shareable Connect IDs (`TALK-XXXX-XXXX`), public-key safety number verification, and Signal-protocol End-to-End Encryption (X3DH + Double Ratchet).

Before generating Connect IDs or encrypting messages, TALK must establish a local cryptographic identity primitive on client devices. This primitive must:
1. Generate a mathematically secure asymmetric key pair with cryptographically secure randomness.
2. Ensure the private key remains strictly on the client device (never transmitted over REST, Socket.io, or stored in MongoDB).
3. Provide deterministic, canonical serialization for the public key.
4. Support secure local persistence (surviving page reloads and browser restarts without key regeneration).
5. Align seamlessly with future Diffie-Hellman key agreement protocols (X3DH) and symmetric key derivation (HKDF).

## Decision
We select **Curve25519 (X25519)** as TALK's primary device identity keypair primitive, implemented natively via the **Web Cryptography API (`crypto.subtle`)** and persisted locally in **IndexedDB (`talk_crypto_db` / `identity_keys`)**:

- **Algorithm**: `X25519` (RFC 7748), 256-bit elliptic curve Diffie-Hellman key agreement.
- **Runtime API**: Standard Web Crypto API (`crypto.subtle.generateKey`, `exportKey`, `importKey`).
- **Key Usages**: `["deriveKey", "deriveBits"]` on private key; `[]` on public key.
- **Canonical Public Key Representation**: 32 raw bytes (`Uint8Array`), canonical lowercase 64-character hexadecimal, and standard Base64.
- **Storage Strategy**: Isolated IndexedDB database with PKCS#8 serialized private key material and raw public key bytes, paired with an in-memory fallback for non-browser/test environments.

## Why X25519 & Web Crypto API?
1. **Direct Alignment with Signal Protocol & E2E Roadmap**: X25519 is the exact primitive required for X3DH (Extended Triple Diffie-Hellman) and the Double Ratchet key exchange planned in Feature 2.
2. **Zero External Cryptographic Dependencies**: Modern Web Crypto natively supports X25519 in all target browser runtimes (Chrome 113+, Safari 17+, Firefox 130+, Node 20+), eliminating supply-chain vulnerabilities and reducing bundle size.
3. **High Performance & Constant-Time Security**: Curve25519 operations are immune to timing attacks by design and operate in sub-millisecond execution times.
4. **Canonical 32-Byte Public Keys**: Curve25519 public keys are exactly 32 bytes (256 bits), making them compact for subsequent hashing and truncation into Connect Codes.

## Alternatives Considered
1. **Ed25519 (Digital Signatures Only)**:
   - *Why rejected as primary identity*: While Ed25519 is optimal for signing messages, it cannot directly participate in Diffie-Hellman key derivation without curve conversion (Birational Equivalence / Montgomery-Edwards mapping). Starting with X25519 provides direct compatibility with X3DH and Double Ratchet key exchanges. If signing is required in Phase 5/6, dual-key bundles (Identity Key + Prekey) will be introduced.
2. **RSA-2048 / RSA-4096**:
   - *Why rejected*: Large key sizes (256 to 512 bytes), slow key generation, high bandwidth overhead for real-time mobile messaging, and legacy mathematical structure.
3. **P-256 (secp256r1 / NIST Curve)**:
   - *Why rejected*: Distrusted by the modern cryptographic privacy community due to unexplained seed parameters; inferior implementation resilience against side-channel attacks compared to Curve25519.
4. **`localStorage` Key Storage**:
   - *Why rejected*: Synchronous, accessible to any synchronous JavaScript script (high XSS attack surface), and cannot store binary buffers or `CryptoKey` objects directly.

## Trade-offs
- **Gained**:
  - Secure, native, dependency-free key generation.
  - Sub-millisecond execution with hardware acceleration where available.
  - Direct compatibility with X3DH key agreement and HKDF key derivation.
  - Robust IndexedDB persistent storage surviving reloads without regeneration.
- **Sacrificed**:
  - Requires X25519-compatible browsers (mitigated: all evergreen browsers supported since 2023).
  - Private keys are stored in IndexedDB on the device; clearing browser storage without backup resets device identity (recovery mechanisms deferred to later phases).

## Security Consequences
- **Asset**: Device Private Key (scalar integer on Curve25519).
- **Protection**: Private keys are held in `CryptoKey` in-memory references and persisted in PKCS#8 form within IndexedDB.
- **Invariant**: The private key is never exported into public API metadata, never sent across network interfaces (REST/Socket), and never logged to console.
- **Residual Risk**: A device compromised by full browser zero-day exploit or malicious browser extensions could inspect IndexedDB. (Mitigated in Feature 4 via Encrypted Storage at Rest with user passkeys).

## TALK Implementation
- Key generation & serialization: [`frontend/src/lib/crypto/keypair.js`](file:///home/kafka/Coding/Web_Dev/Projects/Real%20Time%20Chat%20Application/Real-Time-Chat-Application/frontend/src/lib/crypto/keypair.js)
- Persistent storage: [`frontend/src/lib/crypto/storage.js`](file:///home/kafka/Coding/Web_Dev/Projects/Real%20Time%20Chat%20Application/Real-Time-Chat-Application/frontend/src/lib/crypto/storage.js)
- Device identity lifecycle: [`frontend/src/lib/crypto/identity.js`](file:///home/kafka/Coding/Web_Dev/Projects/Real%20Time%20Chat%20Application/Real-Time-Chat-Application/frontend/src/lib/crypto/identity.js)
- Public barrel exports: [`frontend/src/lib/crypto/index.js`](file:///home/kafka/Coding/Web_Dev/Projects/Real%20Time%20Chat%20Application/Real-Time-Chat-Application/frontend/src/lib/crypto/index.js)
- Unit tests: [`frontend/src/lib/crypto/__tests__/identity.test.js`](file:///home/kafka/Coding/Web_Dev/Projects/Real%20Time%20Chat%20Application/Real-Time-Chat-Application/frontend/src/lib/crypto/__tests__/identity.test.js)

## Future Impact
- **Phase 2 (Connect ID)**: Connect Code generation will directly hash the canonical 32-byte public key produced by this module.
- **Phase 3 (Backend Registry)**: The server will store the canonical Base64 public key exported by this module.
- **Feature 2 (E2E Encryption)**: The X25519 keypair will serve as the device's long-term Identity Key ($IK$) for X3DH session handshakes.
