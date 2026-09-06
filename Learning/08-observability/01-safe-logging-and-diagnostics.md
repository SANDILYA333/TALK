# Observability 01: Safe Logging & Cryptographic Sanitization

## 1. Principles of Zero-Secret Observability
In cryptographic applications like TALK, observability and diagnostics must never compromise privacy or secret isolation.

### Forbidden Logging Rule
Under NO circumstances may any logging subsystem capture:
- Device private keys (CryptoKey, raw buffers, PKCS#8 DER strings)
- Shared secrets derived via Diffie-Hellman
- Session tokens, Authorization headers, or Clerk private keys
- Full raw unencrypted message bodies

---

## 2. Automatic Sanitizer Architecture (`backend/src/lib/logger.js`)
The TALK backend implements recursive data sanitization before serializing logs:

```javascript
const FORBIDDEN_SECRET_KEYS = new Set([
  "privatekey", "secretkey", "pkcs8", "secret", "sharedsecret",
  "sessionkey", "privatekeyhex", "privatekeybase64", "private",
  "password", "authorization", "cookie", "token", "clerksecretkey",
]);
```

### Log Schema
Every emitted log conforms to a structured JSON format:
```json
{
  "timestamp": "2026-09-06T06:58:03.794Z",
  "level": "INFO",
  "event": "device_bound",
  "message": "Device identity bound successfully with verified PoP",
  "metadata": {
    "userId": "660000000000000000000001",
    "connectId": "TALK-QQJR-7SQP"
  }
}
```

---

## 3. Safe vs Unsafe Diagnostic Data

| Data Field | Classification | Logging Guidance |
| :--- | :--- | :--- |
| `userId` (MongoDB ObjectId) | Safe | Permitted in authenticated backend contexts for correlation |
| `connectId` (`TALK-XXXX-XXXX`) | Public Identifier | Permitted in lifecycle event tracking |
| `deviceId` (Mongoose `_id`) | Safe | Permitted in revocation and lifecycle auditing |
| `publicKeyHex` (X25519) | Public Key | Permitted when diagnosing key agreement failures |
| `privateKey` / `PKCS#8` | **STRICT SECRET** | **NEVER PERMITTED** (Sanitized to `[REDACTED]`) |
| `sharedSecret` (DH Output) | **STRICT SECRET** | **NEVER PERMITTED** (Sanitized to `[REDACTED]`) |
| `Authorization` header | **AUTHENTICATION SECRET** | **NEVER PERMITTED** (Sanitized to `[REDACTED]`) |
