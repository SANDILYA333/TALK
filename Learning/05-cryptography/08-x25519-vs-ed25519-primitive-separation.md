# X25519 vs Ed25519: Cryptographic Primitive Separation

## 1. Overview: Two Curves, Two Purposes
Both X25519 and Ed25519 originate from Daniel J. Bernstein's Curve25519 work, but they are distinct cryptographic constructions designed for different purposes:

| Property | X25519 (RFC 7748) | Ed25519 (RFC 8032) |
| :--- | :--- | :--- |
| **Purpose** | Key Agreement (Diffie-Hellman) | Digital Signatures |
| **Curve Model** | Montgomery curve: $y^2 = x^3 + 486662x^2 + x$ | Twisted Edwards curve: $-x^2 + y^2 = 1 - \frac{121665}{121666}x^2y^2$ |
| **Point Representation** | $u$-coordinate only (32 bytes) | Compressed $(x, y)$ coordinate (32 bytes) |
| **Operations** | Montgomery Ladder scalar multiplication | Point addition / scalar multiplication with full coordinate recovery |
| **Web Crypto API Support** | `SubtleCrypto` (`"X25519"`) | `"Ed25519"` (RFC 8032) |

---

## 2. Why Never Abuse Key Types
In naive implementations, developers sometimes attempt to:
1. Use an X25519 key for signatures (or vice-versa).
2. Use the same private scalar across both DH and signature protocols simultaneously.

### Risks:
- **Cross-Protocol Attacks**: If the same key is used in Diffie-Hellman and a signature scheme, an attacker who obtains oracle queries on one scheme may compromise secrets in the other.
- **Birational Equivalence Pitfalls**: While Montgomery and Twisted Edwards curves are birationally equivalent, the mapping from Edwards to Montgomery is many-to-one regarding the $y$-coordinate sign bit. Inverting the map without care introduces signature malleability or identity confusion.

---

## 3. TALK's Design Pattern
TALK keeps **cryptographic primitives isolated**:
- **Identity & E2EE Key**: Pure X25519.
- **Proof of Possession**: Ephemeral Diffie-Hellman + HMAC (pure key agreement verification).
- **No mixed-mode curve conversions**: Avoids all sign-bit ambiguities and library incompatibilities.
