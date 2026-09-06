# Observability 02: Error Taxonomy & Failure Classification

## 1. Error Taxonomy Overview
To prevent silent identity corruption and infinite retry loops, TALK classifies errors along two orthogonal axes:
1. **Permanence**: `isTransient` (safe to retry) vs `isPermanent` (fatal / stateful).
2. **Severity**: `INFO`, `WARN`, `ERROR`, `CRITICAL`.

---

## 2. Cryptographic Error Hierarchy

```text
CryptographicError (Base Class)
├── KeyGenerationError (CRITICAL, Permanent)
│   └── Trigger: Web Crypto API unavailable or entropy generation failure.
├── KeyStorageError (CRITICAL, Permanent)
│   └── Trigger: IndexedDB corrupted, quota exceeded, or permissions denied.
├── KeySerializationError (ERROR, Permanent)
│   └── Trigger: Malformed DER/SPKI bytes or invalid curve parameters.
├── ConnectIdError (ERROR, Permanent)
│   ├── InvalidConnectIdError (ERROR, Permanent)
│   │   └── Trigger: Invalid Crockford Base32 characters or malformed format.
│   └── Trigger: SHA-256 hash or domain tag mismatch.
└── BindingError (WARN / ERROR, Contextual)
    └── Trigger: Expired challenge, replay attempt, or invalid HMAC signature.
```

---

## 3. Failure Classification & Retry Matrix

| Error Class | Category | Severity | Retry Policy | User Experience |
| :--- | :--- | :--- | :--- | :--- |
| `KeyGenerationError` | Permanent | CRITICAL | Do NOT retry automatically | Prompt user to reload browser / verify Web Crypto support |
| `KeyStorageError` | Permanent | CRITICAL | Do NOT regenerate key silently | Display fatal storage warning (prevent identity split) |
| `InvalidConnectIdError` | Permanent | ERROR | Do NOT retry | Highlight input field with format correction guidance |
| `NetworkTimeout` | Transient | WARN | Exponential backoff (max 3 retries) | Display non-intrusive "Reconnecting..." indicator |
| `RateLimited (429)` | Transient | WARN | Retry after `retryAfter` seconds | Display cooldown countdown in UI |
| `Conflict (409)` | Permanent | WARN | Do NOT retry | Inform user that Connect ID is already bound |
| `Unauthorized (403)` | Permanent | ERROR | Do NOT retry | Show permission denied dialog |
