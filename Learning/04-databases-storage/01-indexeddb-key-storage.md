# IndexedDB Secure Key Storage

## 1. What Is This?
**IndexedDB** is a low-level, asynchronous browser database that stores structured data, including binary `ArrayBuffer`, `Blob`, `TypedArray`, and structured clone objects like `CryptoKey`. Unlike `localStorage` (which is synchronous, string-only, and caps at 5MB), IndexedDB provides transactional storage, large quota limits, and native binary support.

## 2. Why Does TALK Need This?
TALK client devices generate an asymmetric cryptographic key pair that represents the device's communication identity. If this identity were lost on page refresh or browser restart, the user would generate a new identity every time, breaking conversation history and contact recognition. IndexedDB allows TALK to persist the keypair locally on the device across browser reloads without sending private keys to a backend server.

## 3. The Problem We Were Solving
- **`localStorage` Insecurity**: `localStorage` is synchronous and can block the main thread. It only stores strings, forcing Base64 conversions, and is directly exposed to synchronous XSS script scraping.
- **Session Volatility**: In-memory storage alone loses keys when the tab closes or refreshes.
- **Server Storage Insecurity**: Storing private keys in MongoDB violates zero-trust and End-to-End Encryption principles.

## 4. How It Works
```text
┌─────────────────────────────────────────────────────────────┐
│                      Browser Sandbox                        │
│                                                             │
│   ┌───────────────────────┐       ┌─────────────────────┐   │
│   │  TALK Application     │       │  IndexedDB Storage  │   │
│   │  (React / Web Crypto) │       │  (talk_crypto_db)   │   │
│   └──────────┬────────────┘       └──────────▲──────────┘   │
│              │                               │              │
│              │ Open DB & Readwrite Tx        │              │
│              ├───────────────────────────────┤              │
│              │ put(record, "device_identity")│              │
│              │                               │              │
│              │ Readonly Tx on Load           │              │
│              │<──────────────────────────────┤              │
│              │ get("device_identity")        │              │
└──────────────┴───────────────────────────────┴──────────────┘
```

## 5. How TALK Implements It
In [`frontend/src/lib/crypto/storage.js`](file:///home/kafka/Coding/Web_Dev/Projects/Real%20Time%20Chat%20Application/Real-Time-Chat-Application/frontend/src/lib/crypto/storage.js):
- Database name: `talk_crypto_db`, Version: `1`, Object store: `identity_keys`.
- `saveIdentityKeyPair(keyPair)` exports the private key to PKCS#8 and public key to raw bytes, storing a versioned record under key `"device_identity_keypair"`.
- `loadIdentityKeyPair()` reads the record and rehydrates `CryptoKey` instances. If the record is missing, it returns `null`. If corrupted, it throws an explicit `KeyStorageError` (preventing silent key regeneration).
- Includes an in-memory storage fallback for Node.js and automated test environments where browser `indexedDB` is not globally available.

## 6. Important Components
- [`frontend/src/lib/crypto/storage.js`](file:///home/kafka/Coding/Web_Dev/Projects/Real%20Time%20Chat%20Application/Real-Time-Chat-Application/frontend/src/lib/crypto/storage.js): Transaction management, storage lifecycle, error handling.
- [`frontend/src/lib/crypto/constants.js`](file:///home/kafka/Coding/Web_Dev/Projects/Real%20Time%20Chat%20Application/Real-Time-Chat-Application/frontend/src/lib/crypto/constants.js): `STORAGE_DB_NAME`, `STORAGE_STORE_NAME`, `DEVICE_IDENTITY_KEY`.

## 7. Data Flow
```text
Identity Creation:
keyPair ──> PKCS#8 / Raw Export ──> IDBTransaction ("readwrite") ──> store.put(record)

Identity Retrieval:
IDBTransaction ("readonly") ──> store.get("device_identity_keypair") ──> PKCS#8 / Raw Import ──> Rehydrated CryptoKeys
```

## 8. Security Implications
- **Asset**: Device Private Key.
- **Threat**: Cross-Site Scripting (XSS), physical device theft, malicious browser extensions.
- **Mitigation**: Private key is stored within origin-isolated IndexedDB. No server transmission.
- **Residual Risk**: A physical attacker with access to the unlocked device file system can inspect the browser profile directory. (Mitigated in Feature 4 via Encrypted Storage at Rest).

## 9. Architectural Decisions
- Used IndexedDB with PKCS#8 serialization rather than raw `localStorage` or server persistence.
- Enforced strict failure on corrupted data (no silent key regeneration).

## 10. Alternatives Considered
1. **`localStorage`**: Rejected due to plaintext string limitations and high XSS exposure.
2. **Web SQL**: Deprecated and removed from modern browser standards.
3. **HTTP-only Cookies**: Rejected because cookies are transmitted to the server with every HTTP request, violating the rule that private keys must never leave the device.

## 11. Trade-offs
- **Gained**: Asynchronous non-blocking storage, native binary support, origin isolation, persistence across reloads.
- **Sacrificed**: If the user explicitly clears browser site data / storage, the local identity key is lost (recovery mechanism is deferred to later roadmap phases).

## 12. Failure Modes & Edge Cases
- **Quota Exceeded / Private Browsing Restrictions**: Modern browsers permit IndexedDB in incognito mode (in-memory partition).
- **Corrupted Record**: Explicit `KeyStorageError` is thrown, alerting the system rather than silently corrupting identity state.

## 13. Common Mistakes
- Not closing database connections or leaving transactions hanging without error handlers.
- Silently generating a new identity key if storage loading fails, leading to ghost identity creation.

## 14. What I Should Understand (Key Takeaways)
IndexedDB is the secure client-side storage standard for cryptographic key material in web applications, allowing local persistence without server trust.

## 15. Relevant TALK Files
- [`frontend/src/lib/crypto/storage.js`](file:///home/kafka/Coding/Web_Dev/Projects/Real%20Time%20Chat%20Application/Real-Time-Chat-Application/frontend/src/lib/crypto/storage.js)
- [`frontend/src/lib/crypto/constants.js`](file:///home/kafka/Coding/Web_Dev/Projects/Real%20Time%20Chat%20Application/Real-Time-Chat-Application/frontend/src/lib/crypto/constants.js)

## 16. Interview Questions I Should Be Able to Answer
1. *Why is IndexedDB preferable over localStorage for storing cryptographic private keys?*
2. *How does IndexedDB enforce origin isolation in modern web browsers?*
3. *What happens to IndexedDB storage in browser incognito/private browsing mode?*
4. *Why is it dangerous to silently regenerate a cryptographic key if loading from IndexedDB fails?*
5. *How do you test IndexedDB-dependent code in a Node.js test environment?*
