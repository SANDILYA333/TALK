# Observability 03: Operational Runbook for Identity Systems

## 1. Incident Diagnosis Procedures

### Scenario A: Identity Initialization Failure (`KeyStorageError`)
- **Symptoms**: Client displays "Local identity storage is inaccessible or corrupted."
- **Root Cause**: Browser private browsing mode blocking IndexedDB, storage quota exhaustion, or corrupted database schema.
- **Diagnostic Steps**:
  1. Inspect browser console for `KeyStorageError`.
  2. Verify IndexedDB database `talk_crypto_db` exists and object store `identity_keys` is readable.
  3. Verify browser permissions for local storage are not set to `Block All`.
- **Resolution**:
  - If storage is corrupted, user may clear site storage or reset keys in settings.
  - Server state remains unaffected; user must re-bind newly generated device key.

---

### Scenario B: Device Binding Failure (`400 Bad Request` on `/api/identity/bind`)
- **Symptoms**: Device cannot complete Proof-of-Possession handshake.
- **Diagnostic Steps**:
  1. Inspect backend logs for `pop_verification_failed`.
  2. Verify challenge is submitted within the 60-second TTL window.
  3. Verify challenge was not already consumed (single-use replay defense).
  4. Ensure client and server clocks are synchronized (NTP drift check).
- **Resolution**:
  - Request a fresh challenge via `POST /api/identity/challenge` and re-compute HMAC proof.

---

### Scenario C: Rate Limiting Alert (`429 Too Many Requests` on `/api/identity/lookup/:connectId`)
- **Symptoms**: Client receives 429 when searching for contacts.
- **Root Cause**: Client exceeded 30 lookups / min limit.
- **Diagnostic Steps**:
  1. Check response `Retry-After` header.
  2. Verify client discovery UI is not firing duplicate concurrent queries on keystroke (ensure `searchSeqRef` debounce is active).
- **Resolution**:
  - UI waits for `retryAfter` duration before allowing next lookup.

---

## 2. Safe Diagnostics Checklist for Support Engineers
- **Rule 1**: NEVER request the user's IndexedDB export or private keys under any circumstance.
- **Rule 2**: Check backend server logs using structured event filters:
  - `event="identity_registered"`
  - `event="device_bound"`
  - `event="device_revoked"`
  - `event="unauthorized_revocation_attempt"`
- **Rule 3**: Confirm user's active device list in MongoDB:
  ```javascript
  db.deviceidentities.find({ userId: ObjectId("..."), status: "ACTIVE" })
  ```
