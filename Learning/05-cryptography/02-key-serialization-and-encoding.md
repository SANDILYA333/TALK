# Key Serialization & Canonical Encodings

## 1. What Is This?
Cryptographic keys in memory exist as opaque structured objects (such as `CryptoKey` in the Web Crypto API) or raw byte buffers. **Key Serialization** is the process of converting these in-memory key objects into standardized binary or string formats (such as raw bytes, PKCS#8, SPKI, Hex, or Base64) for secure storage or transmission, while **Deserialization** reconstructs the valid cryptographic object.

## 2. Why Does TALK Need This?
TALK needs deterministic, canonical representations of public keys so that:
1. Public keys can be hashed into stable Connect Codes (`TALK-XXXX-XXXX`) without character encoding ambiguities.
2. Public keys can be transmitted over REST/JSON APIs and stored in MongoDB as uniform strings.
3. Private keys can be safely serialized into PKCS#8 binary format for local IndexedDB persistence and re-imported upon browser launch.

## 3. The Problem We Were Solving
- If two different encodings or non-canonical serializations are used for the same public key, hashing will produce different Connect Codes for the same identity.
- Inconsistent byte lengths or endianness issues can break cryptographic verification across heterogeneous client platforms.

## 4. How It Works
```text
                  CryptoKey (Web Crypto Object)
                               │
                ┌──────────────┴──────────────┐
                ▼                             ▼
        Public Key Export             Private Key Export
        (Format: "raw")               (Format: "pkcs8")
                │                             │
         32 Raw Bytes                 ASN.1 DER Buffer
                │                             │
        ┌───────┴───────┐                     │
        ▼               ▼                     ▼
   Hex String     Base64 String        Uint8Array Buffer
    (64 chars)     (44 chars)                 │
        │               │                     ▼
        ▼               ▼             IndexedDB Storage
  Human Display   API Transport          (Local Only)
```

## 5. How TALK Implements It
In [`frontend/src/lib/crypto/keypair.js`](file:///home/kafka/Coding/Web_Dev/Projects/Real%20Time%20Chat%20Application/Real-Time-Chat-Application/frontend/src/lib/crypto/keypair.js):
- `exportPublicKey(publicKey)` exports the key using format `"raw"`, verifying the result is exactly 32 bytes, and provides both lowercase 64-char hex and standard Base64.
- `importPublicKey(keyData)` accepts raw `Uint8Array`, hex strings, or base64 strings, validates the 32-byte length, and imports it into a public `CryptoKey`.
- `exportPrivateKey(privateKey)` exports the private key using `"pkcs8"` format for persistence.
- `importPrivateKey(pkcs8Buffer)` rehydrates the private `CryptoKey`.

## 6. Important Components
- [`frontend/src/lib/crypto/utils.js`](file:///home/kafka/Coding/Web_Dev/Projects/Real%20Time%20Chat%20Application/Real-Time-Chat-Application/frontend/src/lib/crypto/utils.js): `bytesToHex`, `hexToBytes`, `bytesToBase64`, `base64ToBytes`.
- [`frontend/src/lib/crypto/keypair.js`](file:///home/kafka/Coding/Web_Dev/Projects/Real%20Time%20Chat%20Application/Real-Time-Chat-Application/frontend/src/lib/crypto/keypair.js): `exportPublicKey`, `importPublicKey`, `exportPrivateKey`, `importPrivateKey`.

## 7. Data Flow
```text
Public Key Object ──> exportPublicKey() ──> { raw: Uint8Array(32), hex: string(64), base64: string }
Hex/Base64/Raw ────> importPublicKey() ──> Validated Public CryptoKey
Private Key Object ─> exportPrivateKey() ─> Uint8Array (PKCS#8 DER)
PKCS#8 Buffer ─────> importPrivateKey() ─> Validated Private CryptoKey
```

## 8. Security Implications
- **Asset**: Key integrity and private scalar secrecy.
- **Threat**: Malformed key injection, invalid curve attacks, or small-subgroup attacks.
- **Mitigation**: Strict validation enforcing exact 32-byte length and format checks before calling `crypto.subtle.importKey`.
- **Residual Risk**: Zero private key exposure in exported public metadata structures.

## 9. Architectural Decisions
- Enforced canonical lowercase hexadecimal (64 chars) and standard Base64 for all public key representations to guarantee deterministic hashing in Phase 2.

## 10. Alternatives Considered
1. **JWK (JSON Web Key)**: Verbose JSON format with extra metadata fields (`kty`, `crv`, `x`); rejected for public key transport to minimize bandwidth.
2. **SPKI (SubjectPublicKeyInfo)**: Adds 12 bytes of ASN.1 header overhead to public keys; raw 32-byte export is more compact and standard for Curve25519.

## 11. Trade-offs
- **Gained**: Minimal byte footprint, zero ambiguity, fast deterministic encoding.
- **Sacrificed**: Raw format requires explicit algorithm tagging in application code (`IDENTITY_ALGORITHM = "X25519"`).

## 12. Failure Modes & Edge Cases
- Invalid hex characters or odd string lengths throw explicit `KeySerializationError`.
- Buffer length $\neq$ 32 bytes throws explicit `KeySerializationError`.

## 13. Common Mistakes
- Using non-standard base64 padding or URL-safe character replacements inconsistently.
- Assuming private keys can be exported in raw format (Web Crypto requires PKCS#8 or JWK for private keys).

## 14. What I Should Understand (Key Takeaways)
Public keys are compact 32-byte points that must be canonically serialized to ensure consistent Connect ID hashing. Private keys are serialized via standard PKCS#8 DER exclusively for local storage.

## 15. Relevant TALK Files
- [`frontend/src/lib/crypto/utils.js`](file:///home/kafka/Coding/Web_Dev/Projects/Real%20Time%20Chat%20Application/Real-Time-Chat-Application/frontend/src/lib/crypto/utils.js)
- [`frontend/src/lib/crypto/keypair.js`](file:///home/kafka/Coding/Web_Dev/Projects/Real%20Time%20Chat%20Application/Real-Time-Chat-Application/frontend/src/lib/crypto/keypair.js)

## 16. Interview Questions I Should Be Able to Answer
1. *Why is canonical serialization essential before hashing a public key into a user identifier?*
2. *What is the difference between raw key export, SPKI, and PKCS#8 formats in Web Crypto?*
3. *Why can't Web Crypto export private keys as raw byte arrays?*
4. *How does TALK validate imported public keys before using them?*
5. *How do you convert between binary TypedArrays and Hex/Base64 strings in JavaScript without external dependencies?*
