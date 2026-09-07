# 01 - Protocol Foundation, Key Hierarchy & Threat Model

## 1. Overview
This module establishes the foundational principles, key relationships, and security invariants for End-to-End Encrypted messaging in TALK using the Signal Protocol (X3DH + Double Ratchet).

---

## 2. Core Security Invariants
1. **Zero Server Trust**: The server routes and stores only opaque ciphertext envelopes (`AES-256-GCM`). It never has access to plaintext, private keys, root keys, chain keys, or message keys.
2. **Cryptographic Primitive Separation**:
   - Key Agreement: `X25519` (RFC 7748)
   - Digital Signatures: `Ed25519` (RFC 8032)
   - Key Derivation: `HKDF-SHA-256` (RFC 5869)
   - Authenticated Encryption: `AES-256-GCM` with 96-bit unique IVs
3. **Multi-Device Isolation ($1:N$)**: Cryptographic sessions exist strictly between pairs of physical devices ($Device_A \leftrightarrow Device_B$), not abstract user accounts. Each device holds independent private keys.
4. **Immediate Key Zeroization**: Individual message keys ($MK$) are wiped from volatile memory immediately upon encryption or decryption.

---

## 3. Protocol Architecture Map

```text
+-------------------------------------------------------------------------+
|                              TALK CLIENT                                |
|                                                                         |
|  +---------------------------+        +------------------------------+  |
|  | Device Identity ($IK$)    |        | Prekey Store ($SPK, OPK_i$)  |  |
|  | - X25519 DH Identity      |        | - Signed Prekey              |  |
|  | - Ed25519 Signing Identity|        | - One-Time Prekey Pool       |  |
|  +-------------+-------------+        +--------------+---------------+  |
|                |                                     |                  |
|                +------------------+------------------+                  |
|                                   |                                     |
|                                   v                                     |
|                     +---------------------------+                       |
|                     |    X3DH Key Agreement     |                       |
|                     +-------------+-------------+                       |
|                                   |                                     |
|                                   v (Shared Master Secret)              |
|                     +---------------------------+                       |
|                     |   Double Ratchet Engine   |                       |
|                     | - Root KDF (DH Ratchet)   |                       |
|                     | - Sending / Recv Chains   |                       |
|                     +-------------+-------------+                       |
|                                   |                                     |
|                                   v (Per-Message AES Key)               |
|                     +---------------------------+                       |
|                     | AES-256-GCM + Assoc Data  |                       |
|                     +-------------+-------------+                       |
+-----------------------------------|-------------------------------------+
                                    | (Ciphertext Envelope)
                                    v
+-------------------------------------------------------------------------+
|                             BACKEND SERVER                              |
|                                                                         |
|  +---------------------------+        +------------------------------+  |
|  | Public Identity Registry  |        | Blind Message Dispatcher     |  |
|  | - Public Keys ($IK$)      |        | - Socket.io Relay            |  |
|  | - Prekey Bundles          |        | - MongoDB Ciphertext Store   |  |
|  +---------------------------+        +------------------------------+  |
+-------------------------------------------------------------------------+
```

---

## 4. Associated Data (AEAD) Integrity Contract
To prevent routing manipulation, replay, or cross-session tampering, the `AES-256-GCM` cipher utilizes domain-separated canonical Associated Data:

$$\text{AD} = \text{"TALK-AEAD-AD-V1:"} \parallel \text{version} \parallel \text{sessionId} \parallel \text{senderDeviceId} \parallel \text{recipientDeviceId} \parallel \text{messageType} \parallel \text{dhRatchetPublicKey} \parallel N \parallel PN$$

If an attacker alters the sender, recipient, session ID, or ratchet counter in transit, the GCM authentication tag verification will fail, ensuring zero silent tampering.

---

## 5. Architectural References
- ADR-010: [`Learning/12-architecture-decisions/ADR-010-e2e-encryption-cryptographic-architecture.md`](file:///home/kafka/Coding/Web_Dev/Projects/Real%20Time%20Chat%20Application/Real-Time-Chat-Application/Learning/12-architecture-decisions/ADR-010-e2e-encryption-cryptographic-architecture.md)
- Feature 2 Journal: [`Learning/13-feature-learning/e2e-encryption.md`](file:///home/kafka/Coding/Web_Dev/Projects/Real%20Time%20Chat%20Application/Real-Time-Chat-Application/Learning/13-feature-learning/e2e-encryption.md)
- Foundation Code: [`frontend/src/lib/crypto/e2e/`](file:///home/kafka/Coding/Web_Dev/Projects/Real%20Time%20Chat%20Application/Real-Time-Chat-Application/frontend/src/lib/crypto/e2e/)
