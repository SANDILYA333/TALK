# ADR-011: Prekey Bundle Infrastructure & Atomic One-Time Prekey Consumption

## Status
Accepted (Feature 2 — Phase 2: Pre-Key Infrastructure)

## Context
Feature 2 Phase 1 established the overarching cryptographic architecture (ADR-010) based on Dual-Key Device Identities ($X25519$ $IK_{dh}$ + $Ed25519$ $IK_{sign}$) and specified the Extended Triple Diffie-Hellman (X3DH) protocol.

To enable asynchronous session setup (where Alice can initiate a forward-secure encrypted conversation with Bob while Bob is offline), Bob's device must publish a **Public Prekey Bundle** to the server. The server acts as a blind public cryptographic directory.

However, three key design problems must be resolved:
1. **Model Architecture**: How to persist public prekey material in MongoDB without modifying or destabilizing the frozen Feature 1 `DeviceIdentity` schema.
2. **Single-Use OPK Concurrency**: How to guarantee that two simultaneous clients requesting Bob's prekey bundle never receive the same One-Time Prekey (OPK), which would violate single-use forward secrecy.
3. **Pool Depletion & Replenishment**: How the system behaves when OPKs are exhausted and how clients safely replenish the pool.

---

## Decisions

### 1. Dedicated `PreKeyBundle` Mongoose Model
Rather than bloating the frozen `DeviceIdentity` collection (ADR-009), we introduce a dedicated `PreKeyBundle` collection in [`backend/src/models/prekey.model.js`](file:///home/kafka/Coding/Web_Dev/Projects/Real%20Time%20Chat%20Application/Real-Time-Chat-Application/backend/src/models/prekey.model.js):
- `deviceId`: ObjectId referencing `DeviceIdentity` (unique, indexed)
- `userId`: ObjectId referencing `User` (indexed)
- `connectId`: Canonical Connect ID string (`TALK-XXXX-XXXX`, indexed)
- `identityKeyDh`: 64-character lowercase hex string ($IK_{dh}$, X25519)
- `identityKeySign`: 64-character lowercase hex string ($IK_{sign}$, Ed25519)
- `signedPrekey`: `{ keyId, publicKey, signature, createdAt, version }`
- `oneTimePrekeys`: Array of `{ keyId, publicKey, isConsumed, consumedAt, consumptionId, createdAt }`
- `activeOpkCount`: Number of unconsumed OPKs (indexed)
- `protocolVersion`: Number (default: 1)

### 2. Atomic Single-Step OPK Allocation & Consumption
To eliminate race conditions and double-allocation during concurrent handshake requests, the server uses MongoDB's atomic `findOneAndUpdate` with unique `consumptionId`:
```javascript
const consumptionId = crypto.randomUUID();
const bundle = await PreKeyBundle.findOneAndUpdate(
  {
    deviceId: targetDevice._id,
    "oneTimePrekeys.isConsumed": false,
  },
  {
    $set: {
      "oneTimePrekeys.$.isConsumed": true,
      "oneTimePrekeys.$.consumedAt": new Date(),
      "oneTimePrekeys.$.consumptionId": consumptionId,
    },
    $inc: { activeOpkCount: -1 },
  },
  { new: true }
);
```
- Because MongoDB executes document-level updates atomically, concurrent requests will match distinct array elements or return `null`.
- The allocated OPK is retrieved via `k.consumptionId === consumptionId`.

### 3. Graceful Pool Exhaustion Fallback (Triple-DH Mode)
When all OPKs for a device are consumed (`activeOpkCount === 0`):
- The retrieval endpoint does not fail or error.
- It returns the verified public bundle with `oneTimePrekey: null`.
- This signals the sender to execute Triple-DH ($DH1, DH2, DH3$) per the Signal / X3DH specification.

### 4. Cryptographic Signature Verification on Ingestion
Before persisting any prekey bundle or signed prekey update:
- The backend independently verifies the Ed25519 signature of `signedPrekey` against `identityKeySign` using domain separation tag `TALK-SPK-AUTH-V1:`.
- Any invalid or tampered signature is rejected immediately with `400 Bad Request`.

### 5. Client Local Storage & Replenishment
- Client stores $IK_{sign}$ private key, active $SPK$ private key, and $OPK$ private key pool in origin-isolated IndexedDB (`talk_crypto_db` / `e2e_prekey_store`).
- Batch size: `PREKEY_BUNDLE_BATCH_SIZE = 50`.
- Replenishment threshold: `MIN_ONE_TIME_PREKEYS_THRESHOLD = 10`.
- When local pool count drops below 10, client generates 50 new keys and uploads them to `POST /api/identity/prekeys/replenish`.

---

## Consequences

### Positive
- **Guaranteed Single-Use OPK Allocation**: Concurrency-safe without distributed locks or Redis dependencies.
- **Zero-Secret Boundary Preserved**: Private keys remain exclusively in client IndexedDB; server strictly stores public material.
- **Independent Signature Validation**: Prevents malicious or corrupted prekeys from entering the public directory.
- **Feature 1 Compatibility**: Preserves all frozen Feature 1 `DeviceIdentity` contracts.

### Trade-offs & Mitigations
- **Array Growth**: Historical consumed OPKs remain in the array for audit/session correlation.
  - *Mitigation*: Array is bounded by periodic pruning or compaction in background tasks.

---

## References
- ADR-009: Feature 1 Architecture & Contract Freeze
- ADR-010: TALK E2E Encryption Cryptographic Architecture
- Signal Protocol X3DH Specification (Section 3: Prekey Bundles)
