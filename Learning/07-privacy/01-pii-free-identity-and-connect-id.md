# PII-Free Identity Architecture & Connect ID

## 1. What Is This?
**Personally Identifiable Information (PII)** is any data that can be used to identify, contact, or locate a single person (e.g. real names, email addresses, phone numbers, IP addresses, physical addresses). A **PII-Free Identity Architecture** decouples communication handles from personal data, anchoring user identity purely in cryptographic keys and derived mathematical pseudonyms.

**TALK Connect ID** (`TALK-XXXX-XXXX`) is a deterministic, human-shareable pseudonym derived directly from an asymmetric cryptographic public key point on Curve25519, containing zero personal identifiers.

## 2. Why Does TALK Need This?
Traditional messaging apps require phone numbers (WhatsApp, Signal, Telegram) or email addresses. This exposes users to:
1. **SIM-Swapping Attacks**: Attackers hijacking SMS verification codes.
2. **Contact Scraping & Spam**: Phone numbers and emails are easily enumerated and harvested.
3. **Severe Regulatory Liabilities**: Storing phone numbers and emails subject companies to GDPR, CCPA, and data breach compliance burdens.
4. **Surveillance & Doxxing**: Knowing a user's messaging handle immediately exposes their real-world identity.

By using Connect IDs, TALK achieves the privacy model championed by **Session Messenger**: users connect purely by sharing cryptographic codes.

## 3. The Problem We Were Solving
In early versions of TALK, user discovery was built on `GET /api/messages/users`, which dumped every user's full name, email, and avatar picture to all authenticated peers. Connect IDs establish a privacy-preserving discovery mechanism where users only reveal safe cryptographic handles.

## 4. How It Works
The architecture establishes three distinct identity layers:

```text
Layer 1: Account Authentication (Clerk)
 - Handles passwordless OAuth, credentials, and session cookies.
 - Used strictly for account access, not for public chat handles.

Layer 2: Cryptographic Device Identity (X25519)
 - Private Key (held in local IndexedDB; never leaves device).
 - Public Key (32-byte point on Curve25519).

Layer 3: Human-Facing Connect ID (TALK-XXXX-XXXX)
 - SHA-256 hash of (DomainTag || PublicKey) truncated to 5 bytes and encoded in Crockford Base32.
 - Shareable via text, voice, or QR code.
```

```text
┌─────────────────────────┐
│     Clerk Account       │  <── Layer 1: Account Access
└────────────┬────────────┘
             │
             ▼
┌─────────────────────────┐
│ X25519 Key Pair         │  <── Layer 2: Cryptographic Identity
│ (Private Key: Local)    │
│ (Public Key: 32 bytes)  │
└────────────┬────────────┘
             │
             ▼
┌─────────────────────────┐
│ TALK-XXXX-XXXX          │  <── Layer 3: PII-Free Public Handle
└─────────────────────────┘
```

## 5. How TALK Implements It
In [`frontend/src/lib/crypto/connect-id.js`](file:///home/kafka/Coding/Web_Dev/Projects/Real%20Time%20Chat%20Application/Real-Time-Chat-Application/frontend/src/lib/crypto/connect-id.js) and [`frontend/src/lib/crypto/identity.js`](file:///home/kafka/Coding/Web_Dev/Projects/Real%20Time%20Chat%20Application/Real-Time-Chat-Application/frontend/src/lib/crypto/identity.js):
- `deriveConnectId(publicKey)` takes only the public key material (never accepts emails, names, or Clerk IDs).
- `getOrCreateDeviceIdentity()` coordinates the creation of the X25519 keypair and derives `connectId` automatically.

## 6. Important Components
- [`frontend/src/lib/crypto/connect-id.js`](file:///home/kafka/Coding/Web_Dev/Projects/Real%20Time%20Chat%20Application/Real-Time-Chat-Application/frontend/src/lib/crypto/connect-id.js): `deriveConnectId()`, `normalizeConnectId()`.
- [`frontend/src/lib/crypto/identity.js`](file:///home/kafka/Coding/Web_Dev/Projects/Real%20Time%20Chat%20Application/Real-Time-Chat-Application/frontend/src/lib/crypto/identity.js): `getOrCreateDeviceIdentity()`, `getDeviceConnectId()`.

## 7. Data Flow
```text
Device X25519 Public Key (32 bytes)
           │
           ▼
SHA-256("TALK-CONNECT-ID-V1:" || PublicKey)
           │
           ▼
Slice first 5 bytes ──> Crockford Base32 ──> TALK-8F2K-91XZ
```

## 8. Security Implications
- **Asset**: User anonymity and privacy graph.
- **Threat**: Correlation attacks linking messaging handles to real-world identity.
- **Mitigation**: Connect IDs are derived solely from pseudorandom public key bits with zero personal metadata.
- **Residual Risk**: Out-of-band correlation (e.g. if User A sends their Connect ID via unencrypted email).

## 9. Architectural Decisions
- **ADR-002**: Pure mathematical derivation from public key with zero dependence on account or database state.

## 10. Alternatives Considered
1. **Hashed Email/Phone (e.g., `SHA256(email)`)**: Vulnerable to offline dictionary attacks and rainbow tables because email address search spaces are small.
2. **User-Selected Usernames (e.g., `@alice`)**: Vulnerable to handle squatting, scraping, and social engineering.
3. **Random UUIDs**: Lacks cryptographic binding to the public key.

## 11. Trade-offs
- **Gained**: Complete PII elimination, zero spam enumeration, compliance immunity.
- **Sacrificed**: Connect IDs cannot be chosen by the user; they are derived from cryptographic key material.

## 12. Failure Modes & Edge Cases
- Passing PII or non-key material to `deriveConnectId` fails with `InvalidConnectIdError`.

## 13. Common Mistakes
- Collapsing Clerk account identity and Connect ID into one concept.
- Storing email addresses alongside Connect IDs in public discovery responses.

## 14. What I Should Understand (Key Takeaways)
Connect IDs turn cryptographic public keys into human-friendly, PII-free pseudonyms that eliminate spam, scraping, and identity correlation.

## 15. Relevant TALK Files
- [`frontend/src/lib/crypto/connect-id.js`](file:///home/kafka/Coding/Web_Dev/Projects/Real%20Time%20Chat%20Application/Real-Time-Chat-Application/frontend/src/lib/crypto/connect-id.js)
- [`frontend/src/lib/crypto/identity.js`](file:///home/kafka/Coding/Web_Dev/Projects/Real%20Time%20Chat%20Application/Real-Time-Chat-Application/frontend/src/lib/crypto/identity.js)

## 16. Interview Questions I Should Be Able to Answer
1. *What is PII-free identity and why is it superior to phone-number-based identity in modern chat apps?*
2. *Why is hashing an email address (e.g. SHA256(email)) insecure for anonymous identity derivation?*
3. *How does Session Messenger implement user identity without phone numbers or emails?*
4. *How does TALK decouple Clerk account authentication from cryptographic communication identity?*
5. *Why is the Connect ID derived from the public key rather than being a random UUID?*
