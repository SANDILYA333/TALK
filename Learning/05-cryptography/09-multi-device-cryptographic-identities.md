# Multi-Device Cryptographic Identities

## 1. The Core Architecture: $1 \to N$ Identity Topology
In a secure messaging architecture, human accounts and cryptographic endpoints have distinct identities:

- **Human Account**: Identified by Clerk JWT / OAuth / Email (`User` model).
- **Cryptographic Device**: Identified by a distinct, locally generated X25519 asymmetric keypair and its deterministically derived Connect ID (`TALK-XXXX-XXXX`).

```text
                  TALK ACCOUNT (Alice)
                           │
        ┌──────────────────┼──────────────────┐
        │                  │                  │
        ▼                  ▼                  ▼
    Device 1           Device 2           Device 3
  (iPhone 15)        (MacBook Pro)      (iPad Air)
        │                  │                  │
   X25519 Key 1       X25519 Key 2       X25519 Key 3
  (IndexedDB 1)      (IndexedDB 2)      (IndexedDB 3)
        │                  │                  │
        ▼                  ▼                  ▼
  Connect ID 1       Connect ID 2       Connect ID 3
(`TALK-8F2K-91XZ`) (`TALK-3M9P-44TK`) (`TALK-W7X2-L99A`)
```

---

## 2. Why Never Share or Synchronize Private Keys
In naive systems, developers might attempt to synchronize private keys across a user's devices so that all devices have the exact same cryptographic key.

### Fatal Flaws of Key Synchronization:
1. **Destruction of Zero-Knowledge Boundary**: Sending a private key across the network (even encrypted) introduces key escrow and cloud-compromise vulnerabilities.
2. **Revocation Impossibility**: If one device is stolen or lost, all devices must discard their keys simultaneously because the compromised private scalar is identical across all devices.
3. **Hardware Isolation Violation**: Modern platforms store private keys in secure hardware enclaves / isolated browser databases that cannot and should not be exported.

In TALK, each device generates and retains its own independent private key.

---

## 3. How Multi-Device Messaging Scales
When Bob sends a message to Alice in a multi-device architecture:
1. Bob queries the public key registry for Alice's active device identities (`DeviceIdentity.find({ userId: aliceId, status: "ACTIVE" })`).
2. Bob receives public keys $[K_{1}, K_{2}, K_{3}]$.
3. Bob encrypts the message payload separately for each device public key (pairwise encryption fanout).
4. Each of Alice's devices decrypts the message using its own independent private scalar.
