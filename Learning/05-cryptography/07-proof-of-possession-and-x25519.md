# Proof of Possession (PoP) with X25519 Key Agreement

## 1. What is Proof of Possession?
Proof of Possession (PoP) is a cryptographic verification mechanism where an entity demonstrates that it holds the private key corresponding to a claimed public key without exposing or transmitting the private key itself.

In public-key registries (like TALK's device identity system), PoP prevents an attacker from claiming or binding another user's public key to their own account.

---

## 2. The Challenge with X25519
In digital signature schemes (such as Ed25519, RSA, or ECDSA), proving possession is straightforward: the server issues a random challenge nonce, and the client signs it using its private signing key:
$$\sigma = \text{Sign}(K_{\text{priv}}, \text{nonce})$$

However, TALK uses **X25519** (RFC 7748) for end-to-end encryption and device identity. X25519 is a **Diffie-Hellman Key Agreement primitive** on Curve25519, not a digital signature algorithm. 

X25519 points only retain the $u$-coordinate (x-coordinate on Montgomery curve), meaning signature operations cannot directly be evaluated on standard X25519 keys without either:
1. Generating a second Ed25519 key (increasing complexity and device state).
2. Performing birational curve conversion from Montgomery Curve25519 to Edwards25519 (which introduces sign ambiguities and risks of implementation pitfalls).

---

## 3. The Solution: Ephemeral Diffie-Hellman + HMAC Protocol
TALK uses a zero-conversion, pure X25519 challenge-response proof-of-possession protocol:

```text
CLIENT (Device)                                           SERVER
   │                                                        │
   │ 1. POST /api/identity/challenge                        │
   │───────────────────────────────────────────────────────>│
   │                                                        │ Generates ephemeral (s_priv, S_pub)
   │                                                        │ Generates random nonce (32 bytes)
   │ 2. Returns { challengeId, S_pub, nonce, expiresAt }    │ Saves activeChallenges[id] (TTL: 60s)
   │<───────────────────────────────────────────────────────│
   │                                                        │
   │ Computes sharedSecret = X25519(c_priv, S_pub)          │
   │ Computes proof = HMAC-SHA256(                          │
   │   sharedSecret,                                        │
   │   "TALK-IDENTITY-BINDING-V1:" || nonce || c_pub        │
   │ )                                                      │
   │                                                        │
   │ 3. POST /api/identity/bind { c_pub, challengeId, proof }
   │───────────────────────────────────────────────────────>│
   │                                                        │ Deletes challengeId (Replay Protection)
   │                                                        │ Computes sharedSecret = X25519(s_priv, c_pub)
   │                                                        │ Computes expectedProof = HMAC-SHA256(...)
   │                                                        │ Verifies timingSafeEqual(expected, proof)
   │ 4. Returns 200/201 { status: "ACTIVE" }                │
   │<───────────────────────────────────────────────────────│
```

---

## 4. Mathematical Guarantees
1. **Unforgeability**: Because only the client holding $c_{\text{priv}}$ can compute the scalar multiplication $c_{\text{priv}} \cdot S_{\text{pub}} = s_{\text{priv}} \cdot C_{\text{pub}}$, no third party can derive the `sharedSecret` needed to generate the HMAC proof.
2. **Forward Secrecy of Challenges**: The server generates an ephemeral keypair $(s_{\text{priv}}, S_{\text{pub}})$ per challenge and discards it upon single use.
3. **Zero Private Key Leakage**: Neither the client private key nor the server private key is ever serialized or sent across the network.
