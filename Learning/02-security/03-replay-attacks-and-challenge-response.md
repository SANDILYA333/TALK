# Replay Attacks & Ephemeral Challenge-Response Protocols

## 1. What is a Replay Attack?
A replay attack occurs when an attacker intercepts a valid authentication or verification payload transmitted over the network and re-transmits it at a later time to impersonate the legitimate client or duplicate state changes.

Even over TLS/HTTPS, replay protection at the application level is critical to defend against:
- Man-in-the-Middle proxies with compromised root CAs.
- Compromised intermediate logs or network caches.
- Race conditions and malicious retry spamming.

---

## 2. Ephemeral Nonce & Single-Use Challenge Pattern
To guarantee freshness, TALK implements an ephemeral challenge-response pattern:

1. **Random Nonce Generation**:
   The server generates a 32-byte cryptographic random nonce ($256$ bits of entropy) using `crypto.randomBytes(32)`:
   ```javascript
   const challengeNonce = crypto.randomBytes(32).toString("hex");
   const challengeId = crypto.randomUUID();
   ```

2. **Time-to-Live (TTL) Expiration**:
   Challenges are valid for at most 60 seconds (`CHALLENGE_TTL_MS = 60000`). A periodic background cleanup removes stale challenges.

3. **Immediate Invalidation (Atomic Single-Use)**:
   When `verifyBindingProof()` is invoked, the challenge is removed from active memory *before* mathematical verification completes:
   ```javascript
   const record = activeChallenges.get(challengeId);
   activeChallenges.delete(challengeId); // Immediately consumed
   ```
   This guarantees that even if verification succeeds or fails, the same `challengeId` can never be re-submitted.

4. **Account Binding Enforcement**:
   The challenge record stores `userId: req.user._id`. If Account B attempts to submit a proof for a challenge issued to Account A, verification fails immediately.

5. **Domain Separation**:
   All proofs are computed over `TALK-IDENTITY-BINDING-V1:` prefix, preventing attacks where proofs could be transplanted into message authentication or session initiation.
