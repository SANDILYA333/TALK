# Account Identity vs Device Identity vs Session vs Connect ID

## 1. The Four Layers of TALK Identity

In TALK, identity is structured into four distinct layers:

| Layer | Question Answered | Technology / Storage | Lifetime |
| :--- | :--- | :--- | :--- |
| **Account Identity** | *Who is the TALK user?* | Clerk Auth + MongoDB `User` | Long-lived (Account lifetime) |
| **Device Identity** | *Which cryptographic endpoint is this?* | X25519 Keypair (IndexedDB) + `DeviceIdentity` | Long-lived per device (survives logout) |
| **Connect ID** | *What handle can peers use to find this device?* | `TALK-XXXX-XXXX` (derived from public key) | Bound to Device Identity |
| **Authentication Session** | *Is this HTTP/Socket request authorized right now?* | Clerk JWT cookie / Bearer token | Short-lived (Minutes to days) |

---

## 2. Common Misconceptions Disproved

### Misconception 1: "Logout should delete the device's cryptographic identity."
**Reality**: Logging out expires the session token. Deleting the device's keypair on logout would destroy the user's cryptographic identity, breaking end-to-end encryption history.

### Misconception 2: "One account should share a single public key."
**Reality**: Sharing a public key requires sharing the private key. In multi-device systems, each device generates its own keypair, and the account acts as the parent container.

### Misconception 3: "Closing a browser tab revokes the device."
**Reality**: Browser tabs share access to the same origin-isolated IndexedDB database (`talk_crypto_db`). All tabs within the same browser profile operate on the same persistent device identity.
