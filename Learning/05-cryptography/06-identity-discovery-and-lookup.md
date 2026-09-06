# Concept Guide: Cryptographic Identity Discovery & Decoupled Architecture

## 1. The Separation of Identity Phases
A robust secure messaging architecture enforces strict boundaries between identity stages:

```text
1. GENERATION (Phase 1)
   Generate X25519 asymmetric keypair on device ($k_{priv}, K_{pub}$).
       │
       ▼
2. DERIVATION (Phase 2)
   Derive human-friendly Connect ID ($C = \text{Base32}(\text{SHA-256}(K_{pub}))_5$).
       │
       ▼
3. REGISTRATION (Phase 3)
   Bind authenticated account to public key & Connect ID in server registry.
       │
       ▼
4. DISCOVERY (Phase 4)
   Query registry by Connect ID to retrieve public identity ($K_{pub}, \text{avatar}, \text{name}$).
       │
       ▼
5. RELATIONSHIP & HANDSHAKE (Phase 5+)
   Initiate contact, verify safety numbers, and establish Signal Double Ratchet session.
```

## 2. Why Discovery Must Not Create Relationships
In traditional social networks, looking up a user or typing a username often immediately triggers automated side effects (e.g., adding to "recent contacts", sending friend suggestions, or pinging presence).

In cryptographic privacy systems:
- **Discovery is a pure read operation**: Asking "Does this public key exist?" should leave no persistent trace on the target's device.
- **Zero Premature State**: Searching for a peer does NOT create conversation documents in MongoDB, does NOT allocate message channels, and does NOT broadcast Socket.io events.

## 3. Cryptographic Invariants During Lookup
When the client receives a lookup response:
1. `connectId`: Canonical `TALK-XXXX-XXXX` string.
2. `publicKey`: Canonical 64-character hex string representing the 32-byte X25519 public key.
3. `algorithm`: `"X25519"`.
4. `version`: `1`.

The client can optionally verify locally that $\text{deriveConnectId}(\text{publicKey}) === \text{connectId}$, reinforcing end-to-end mathematical trust before initiating any future cryptographic handshake.
