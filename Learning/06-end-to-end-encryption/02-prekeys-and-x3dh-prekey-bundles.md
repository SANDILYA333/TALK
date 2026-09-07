# 02 - Prekeys, Prekey Bundles & Asynchronous Session Setup

## 1. The Core Asymmetric Problem: Offline Recipients

In synchronous cryptography (such as standard TLS or interactive Diffie-Hellman):
- Alice and Bob must both be online simultaneously.
- Alice sends an ephemeral public key $g^a$ to Bob.
- Bob immediately responds with his ephemeral public key $g^b$.
- Both parties compute the shared secret $g^{ab}$.

In real-world messaging (like WhatsApp, Signal, or TALK):
- Alice wants to send a message to Bob at 2:00 AM while Bob's phone is switched off or offline.
- If Alice has to wait for Bob to wake up and exchange keys, instant asynchronous messaging is impossible.

---

## 2. The Solution: Prekeys & Prekey Bundles

A **Prekey** is a cryptographic key generated in advance by Bob's device and published to the server so that Alice can perform a Diffie-Hellman key agreement asynchronously.

```text
BOB (Offline)                         SERVER DIRECTORY                         ALICE (Online)
───────                              ────────────────                         ──────────────
1. Generates IK_sign, SPK, OPKs
2. Uploads Public Bundle ───────────> [ Stores Public Keys ]
3. Device Goes Offline ...                                                     1. Wants to chat with Bob
                                                                               2. Requests Bob's Bundle ─────>
                                     <── Returns Bob's Bundle (Consumes 1 OPK) 3. Receives Public Keys
                                                                               4. Computes X3DH Secret
                                                                               5. Sends 1st Encrypted Message
```

---

## 3. Why Two Types of Prekeys? (SPK vs OPK)

| Prekey Type | Lifetime | Quantity | Authentication | Purpose |
| :--- | :--- | :--- | :--- | :--- |
| **Signed Prekey ($SPK$)** | Medium (e.g. 7 days) | 1 active per device | Signed by $IK_{sign}$ | Authenticates prekey provenance; protects against rogue server MITM. |
| **One-Time Prekeys ($OPK$)** | Disposable (Single-use) | Pool of 50 (replenished) | Derived alongside SPK | Provides single-use forward secrecy; destroyed immediately after 1st use. |

### Why aren't Signed Prekeys enough?
If Alice and Bob only used a Signed Prekey (reused across all sessions initiated during that week), an attacker who compromises Bob's device 6 months later and extracts that specific $SPK$ private key could retroactively decrypt all session handshakes established during that week.

By introducing **One-Time Prekeys ($OPK$)**:
- Bob consumes and deletes $OPK_1$ from local storage as soon as he processes Alice's initial handshake.
- Even if Bob's long-term key or signed prekey is compromised later, the adversary cannot recreate the $DH4 = \text{X25519}(EK_A, OPK_1)$ component because the private scalar of $OPK_1$ was permanently erased from storage.

---

## 4. Atomic Consumption Semantics

A critical failure mode in naive prekey implementations is **concurrency double-allocation**:
- Alice and Charlie simultaneously request Bob's prekey bundle.
- If the server reads $OPK_1$ and returns it to both Alice and Charlie, both senders use the exact same $OPK_1$.
- Bob's device receives Alice's message, consumes $OPK_1$, and deletes it.
- When Charlie's message arrives, Bob cannot decrypt it because $OPK_1$ is already gone!

### TALK's Atomic Solution
In TALK, the backend uses MongoDB's atomic `findOneAndUpdate` with unique `consumptionId`:
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
This guarantees strict linearizable single-use semantics across any number of concurrent clients.

---

## 5. Architectural References
- ADR-011: [`Learning/12-architecture-decisions/ADR-011-prekey-bundle-infrastructure-and-atomic-consumption.md`](file:///home/kafka/Coding/Web_Dev/Projects/Real%20Time%20Chat%20Application/Real-Time-Chat-Application/Learning/12-architecture-decisions/ADR-011-prekey-bundle-infrastructure-and-atomic-consumption.md)
- Backend Registry: [`backend/src/controllers/prekey.controller.js`](file:///home/kafka/Coding/Web_Dev/Projects/Real%20Time%20Chat%20Application/Real-Time-Chat-Application/backend/src/controllers/prekey.controller.js)
- Client Prekeys: [`frontend/src/lib/crypto/e2e/prekeys.js`](file:///home/kafka/Coding/Web_Dev/Projects/Real%20Time%20Chat%20Application/Real-Time-Chat-Application/frontend/src/lib/crypto/e2e/prekeys.js)
