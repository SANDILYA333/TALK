# ADR-004: Connect ID Discovery, Privacy Boundaries & Enumeration Defenses

## Status
**Accepted** (Feature 1 — Phase 4)

## Context
In Phase 3, TALK implemented the backend Public-Key Identity Registry (`DeviceIdentity` in MongoDB) and account binding layer. To make Connect IDs usable by real humans, the application needs a discovery and lookup mechanism where an authenticated user can input a peer's Connect ID (e.g. `TALK-8F2K-91XZ`), locate the public identity, and display verified identity information.

However, discovery mechanisms in privacy-focused messaging systems present critical security and privacy challenges:
1. **PII Scraping & Account Enumeration**: An unconstrained search API can be abused by automated bots to dictionary-scan Connect IDs and harvest user identities or correlate accounts.
2. **Asynchronous UI Race Conditions**: In fast or multi-tab web applications, out-of-order network responses can cause stale discovery results to overwrite newer searches.
3. **Premature Coupling**: The discovery lookup must strictly remain a query primitive—it must not automatically create database relationships, friend requests, or message threads.

## Decision

### 1. Zero-PII Public Identity Projection
The discovery endpoint `GET /api/identity/lookup/:connectId` queries the indexed `DeviceIdentity` collection and returns strictly minimal public metadata:
```json
{
  "connectId": "TALK-8F2K-91XZ",
  "publicKey": "010101...64hex",
  "algorithm": "X25519",
  "version": 1,
  "user": {
    "fullName": "Alice Cooper",
    "profilePic": "https://..."
  }
}
```
- **Strictly Excluded**: `email`, `clerkId`, phone numbers, MongoDB ObjectIds, account creation dates, and private keys are never returned.

### 2. Sliding-Window In-Memory Rate Limiting
To mitigate automated brute-force enumeration of the 40-bit ($2^{40} \approx 1.1 \times 10^{12}$) Connect ID namespace, the backend enforces a sliding-window rate limit on lookup queries:
- Max **30 lookup requests per 60-second window** per authenticated user ID (or IP address fallback).
- Returns `429 Too Many Requests` with a `Retry-After` header when exceeded.

### 3. Asynchronous Sequence Tracking in Frontend Hook (`useConnectIdDiscovery`)
To guarantee that fast typing or rapid sequential searches never result in stale state displays:
- Each invocation increments a monotonic sequence counter `searchSeqRef.current`.
- When an asynchronous network request resolves, the response is committed to React state **only if** its request sequence ID matches the active counter. If stale, the response is silently discarded.

```text
User enters Query A (seq=1, slow network 50ms)
User enters Query B (seq=2, fast network 10ms)
Response B arrives (seq=2 == currentSeq 2) ──► RENDERED (Success)
Response A arrives (seq=1 != currentSeq 2) ──► DISCARDED (Ignored)
```

### 4. Explicit Decoupling from Messaging & Relationships
Phase 4 implements **Discovery Only**. Searching for an identity does NOT:
- Add a contact or friend.
- Create a conversation in MongoDB.
- Send a message.
- Establish an E2EE session.

Establishing relationships is explicitly reserved for Phase 5 (Identity Binding) and Phase 7 (Connect ID UX).

## Alternatives Considered

| Alternative | Evaluation | Reason for Rejection |
| :--- | :--- | :--- |
| **Global Directory Browsing** (dumping all users) | High convenience | Violates privacy; leaks all registered user identities to scrapers. |
| **Public Unauthenticated Discovery API** | Allows searching without logging in | Enables anonymous bot scraping and dictionary enumeration. Authenticated discovery is required. |
| **Client-Side Search History Caching** | Stores past queries in localStorage | Leaks social graph and past discovery queries on shared devices. Search state remains ephemeral. |
| **Instant Real-Time Keystroke Querying** | Searches on every keystroke | Generates excessive server load and burns rate limit allowances. Requires explicit search submit. |

## Consequences
- **Positive**:
  - Authenticated, secure, privacy-preserving peer discovery.
  - Zero PII exposure (no email, no Clerk ID).
  - High resilience against bot enumeration and scraping via rate limiting.
  - Robust async UI state management with zero race conditions.
- **Operational Considerations**:
  - Rate limiting is in-memory per server instance; distributed multi-node deployments in future production will leverage Redis-backed rate limiting.
