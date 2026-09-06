# Concept Guide: Public-Key Identity Registries & Server-Side Verification

## 1. What is a Public-Key Identity Registry?
In decentralized or end-to-end encrypted messaging architectures (like Signal, WhatsApp, and Session), the server acts as an **untrusted public-key directory** (or key registry). 

The registry's primary responsibility is mapping a human-usable handle (such as a phone number, username, or in TALK's case, a PII-free **Connect ID**) to that entity's **cryptographic public key**.

```text
┌────────────────────────────────────────────────────────┐
│                   PUBLIC KEY REGISTRY                  │
├───────────────────┬────────────────────────────────────┤
│ Connect ID        │ Public Key (X25519)                │
├───────────────────┼────────────────────────────────────┤
│ TALK-8F2K-91XZ    │ e3b0c44298fc1c149afbf4c8996fb9... │
│ TALK-4M7Q-2V9L    │ 7d4a211832049e7b235941829a2862... │
└───────────────────┴────────────────────────────────────┘
```

## 2. The Asymmetric Trust Model
The fundamental beauty of asymmetric cryptography is the absolute division of responsibility:

| Material | Location | Server Access | Purpose |
| :--- | :--- | :--- | :--- |
| **Private Key** ($k_{priv}$) | Client IndexedDB (`talk_crypto_db`) | **NEVER** | Decrypting incoming messages, producing signatures, deriving shared secrets. |
| **Public Key** ($K_{pub}$) | Backend MongoDB (`DeviceIdentity`) | **YES** | Enabling other users to find the device and encrypt messages to it. |

Because the public key is mathematically safe to publish worldwide, the server can store and distribute it freely without compromising user confidentiality.

## 3. Why the Server Must Independently Derive Connect IDs
A common pitfall in naive registry designs is accepting both the identifier and the public key from the client and storing them blindly:

```text
❌ Naive Flawed Approach:
Client -> POST { connectId: "TALK-TARGET", publicKey: "ATTACKER_KEY" }
Server -> Saves directly into database
Result -> Attacker hijacks TARGET's Connect ID and receives their encrypted handshakes!
```

### The Fix: Server-Side Cryptographic Derivation
To prevent Connect ID spoofing and identity squatting, the server treats the client's public key as the **single source of truth** and re-executes the exact derivation algorithm:

```text
✓ Secure Zero-Trust Derivation:
1. Canonicalize client's submitted public key bytes (32 bytes).
2. Compute SHA-256("TALK-CONNECT-ID-V1:" || publicKey).
3. Truncate digest to 5 bytes (40 bits).
4. Encode into Crockford Base32 ("TALK-XXXX-XXXX").
5. Assert derivedID === clientSubmittedID.
```

If the client claims an ID that does not correspond mathematically to their public key, the server rejects the registration before any database write occurs.

## 4. Discovery vs Authentication
It is critical to distinguish between:
- **Authentication**: Proving to the server who is initiating the HTTP request (handled by Clerk session tokens).
- **Public Identity**: The cryptographic handle by which peers discover and address each other (handled by TALK Connect ID and X25519 public keys).

The backend registry bridges these two worlds: it binds an authenticated account to a verified public cryptographic key.
