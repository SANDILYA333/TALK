# Device Revocation & Authorization Model

## 1. Why Revocation $\neq$ Deletion
When a device is decommissioned, lost, or compromised, a user revokes the device identity.

In secure architectures:
- **Deletion** removes the database record completely, causing dangling references in conversation histories and loss of security audit logs.
- **Revocation** retains the immutable record, changes `status` from `ACTIVE` to `REVOKED`, records `revokedAt`, and prevents future cryptographic operations.

---

## 2. Server-Enforced Authorization Rules
All device management operations (listing, revoking) enforce strict server-side authorization:

1. **Session-Derived Account ID**: The user identity is extracted strictly from the verified Clerk JWT token (`req.user._id`).
2. **Ownership Assertion**:
   ```javascript
   if (device.userId.toString() !== req.user._id.toString()) {
     return res.status(403).json({ message: "You do not have permission to revoke this device identity." });
   }
   ```
3. **Idempotence**: Re-revoking an already revoked device safely returns `200 OK`.
4. **Primary Pointer Synchronization**: If the user's primary `User.connectId` was set to the revoked device, the system automatically points `User.connectId` to the latest remaining active device (or `null`).

---

## 3. Fingerprint-Free Client Device Identification
To indicate which device is the "Current Device" in device management UI, applications often resort to browser fingerprinting (User-Agent, IP, screen resolution, audio context, canvas hashes).

### Fingerprinting Pitfalls:
- Highly invasive to user privacy.
- Unreliable across browser updates and privacy extensions (Brave, Safari).

### TALK's Solution:
TALK matches the local `connectId` and `publicKeyHex` loaded from IndexedDB directly against the server-returned device list:
```javascript
export function isCurrentDevice(deviceRecord, localIdentity) {
  return deviceRecord.connectId === localIdentity.connectId;
}
```
This is 100% deterministic, zero-dependency, and 100% privacy-preserving.
