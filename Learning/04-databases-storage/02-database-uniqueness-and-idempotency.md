# Database Engineering: Uniqueness Constraints, Race Conditions, and Idempotent APIs

## 1. The Check-Then-Act Race Condition
A classic bug in distributed application development is relying purely on application-level checks to enforce uniqueness:

```text
Request 1 (Client A)          Request 2 (Client B)
       │                              │
       ▼                              ▼
findOne({ connectId: C })     findOne({ connectId: C })
       │                              │
   Returns null                   Returns null
       │                              │
       ▼                              ▼
  create(doc A)                  create(doc B)
       │                              │
       ▼                              ▼
    SUCCESS                        SUCCESS (Duplicate row in database!)
```

If two concurrent requests attempt to register the same Connect ID or public key simultaneously, both application checks may pass before either write commits.

### Mitigation: Database-Level Unique Indexes
MongoDB unique indexes (`unique: true`) guarantee atomicity at the storage engine layer (WiredTiger). If a second write attempts to insert an existing key, MongoDB throws an `E11000 duplicate key error`.

The API controller catches error code 11000 and maps it to a standard HTTP `409 Conflict` response.

```javascript
try {
  await DeviceIdentity.create({ connectId, publicKey, userId });
} catch (error) {
  if (error.code === 11000) {
    return res.status(409).json({ message: "Connect ID or public key is already registered." });
  }
  throw error;
}
```

## 2. Idempotent Registration Design
An API operation is **idempotent** if performing it multiple times produces the exact same state as performing it once:
$$f(f(x)) = f(x)$$

### Why Idempotency Matters for Client Device Registration:
1. When a user opens TALK on their laptop, the frontend loads the existing key from IndexedDB and calls `/api/identity/register`.
2. If the user refreshes the page 5 times, or network retries occur, the backend must not fail or generate duplicate rows.
3. Instead, the server detects that the same `(userId, connectId, publicKey)` tuple is being presented and returns:
   - Status: `200 OK`
   - Body: `{ isNew: false, message: "Device identity is already registered." }`

This guarantees frictionless client startup with zero side effects.
