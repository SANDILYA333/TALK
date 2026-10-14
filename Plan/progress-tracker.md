# TALK — Master Progress Tracker

> **Persistent Source of Truth** for the TALK messaging platform.
> Update this document after every meaningful implementation change or verification milestone.
> Last Master Audit & Implementation Run: **2026-10-12** (Features 1–10 Complete & Verified)

---

## 1. Executive Status

| Attribute | Current Value |
|---|---|
| **Current Milestone** | **Milestone 14: Post-Implementation Verification & Stabilization Certified** |
| **Last Verified Milestone** | Evidence-Based Verification of Features 1–10, Bug Resolutions, Security Invariant Audit |
| **Working Functionality** | Hardened Clerk Auth & Verified Socket.io Handshake Auth (Zero spoofing), Connect ID Derivation, PoP Binding, Prekey Registry ($SPK$/$OPK$), Double Ratchet & X3DH Primitives, Symmetrical Session IDs, Receiver Ratchet Self-Healing Reply, At-Rest Encrypted IndexedDB Cache (`decrypted_messages`), Multi-Socket User Rooms (`Map<string, Set<string>>`), Ephemeral Typing Indicators, Delivery & Read Receipts (`sent` / `delivered` / `read`), Disappearing Messages (MongoDB TTL + Client Timer Toggle), 60-Digit Safety Number Verification (MITM Defense + Key Rotation Alerts), Encrypted Group Messaging with Sender Keys & Epoch Advancements, WebRTC Voice & Video Call Signaling & UI, Sealed Sender Metadata Minimization, Silent Encrypted Web Push Notifications (`sw.js` + VAPID), Durable Offline Outbox Queue & Mesh Capability Detection, ImageKit Media Uploads, HeroUI Themes & Wallpapers |
| **Verified Known Defects** | **Bug A (Verified Resolved)**: Multi-socket user rooms (`user:${userId}`) route ciphertext envelopes to all active client tabs; decrypted messages cached at-rest in IndexedDB.<br>**Bug B (Verified Resolved)**: Symmetrical session IDs (`[idA, idB].sort().join("<->")`), receiver initial DH ratchet transition self-healing (`!state.CKs && state.DHr`), and idempotent X3DH handshake caching.<br>**Bug C (Verified Resolved)**: Stable Connect ID derivation from IndexedDB identity keys, multi-device listing and revocation isolation, no account identity overwrites. |
| **Immediate Next Action** | Multi-device staging run with physical devices, STUN/TURN server provisioning, and live VAPID key registration. |
| **Current Blockers** | None for core E2EE messaging runtime. Physical WebRTC media traversal across NATs and live Web Push delivery require external STUN/TURN and VAPID credentials respectively. |
| **Automated Test Suite** | **312 Tests Passing** (199 Frontend, 113 Backend, 0 Failures, 0 Skipped, 0 Lint Errors, Clean Production Builds). |

---

## 2. Feature Verification & Maturity Matrix (Features 1–10)

| Feature | Name | Maturity Status | Verified Invariants | Integration Level | Evidence / Implementation Files |
|---|---|---|---|---|---|
| **Feature 1** | Public-Key Connect ID (PII-Free Identity) | **Integration-Tested** | Crockford Base32, Web Crypto X25519, PoP challenge/response, Mongoose models | Automated single/multi-device unit & API suites (114 tests) | `connect-id.js`, `identity.js`, `identity.controller.js` |
| **Feature 2** | Signal E2EE (X3DH + Double Ratchet + AES-GCM) | **Integration-Tested** | 4-DH/3-DH X3DH, Double Ratchet state machine, zero-plaintext wire/DB guard, AEAD AD binding | Symmetrical session derivation, receiver reply self-healing, multi-socket room dispatch | `x3dh.js`, `ratchet.js`, `messaging.js`, `session.js`, `socket.js` |
| **Feature 3** | Disappearing / Self-Destructing Messages | **Integration-Tested** | MongoDB TTL index (`expiresAt`), controller expiry filtering, composer timer toggle (Off, 1h, 1d, 1w) | Expired messages excluded from `getMessages` and local outbox | `message.model.js`, `message.controller.js`, `ChatComposer.jsx` |
| **Feature 4** | Encrypted Local Message Storage (At-Rest) | **Integration-Tested** | IndexedDB `decrypted_messages`, AES-GCM at-rest encryption, 12-byte IV, AD binding | Decrypted messages survive page refresh without re-ratcheting historical envelopes | `message-store.js`, `useChatStore.js` |
| **Feature 5** | Safety Number Verification (MITM Defense) | **Integration-Tested** | Canonical SHA-512 derivation, 12 blocks of 5 decimal digits (60 digits total), key rotation alert | Verified in bidirectional unit tests; UI modal integrated into `ChatHeader` | `safety-number.js`, `SafetyNumberModal.jsx`, `safety-number.test.js` |
| **Feature 6** | Sealed Sender & Metadata Minimization | **Integration-Tested** | Inner envelope authentication, outer envelope routing with stripped sender metadata | Zero sender Connect ID on outer envelope; recipient verifies inner payload | `sealed-sender.js`, `sealed-sender.test.js` |
| **Feature 7** | Group Chats with Sender Keys | **Integration-Tested** | Group Mongoose model, admin access control, client Sender Keys with Ed25519 signing & AES-GCM, epoch advancement on member eviction | Tested lifecycle, member addition/removal key rotation, and tampering rejection | `group.model.js`, `group.controller.js`, `sender-keys.js`, `sender-keys.test.js` |
| **Feature 8** | E2EE Voice & Video Calls (WebRTC) | **Signaling Integration-Tested** *(Media Blocked without 2 Devices/STUN)* | Socket.io signaling (`call:initiate`, `call:answer`, `call:reject`, `call:ice-candidate`, `call:end`), UI Call modal with Audio/Video toggle | Signaling protocol verified in automated tests. Live P2P media requires physical multi-device deployment. | `socket.js`, `CallModal.jsx`, `ChatHeader.jsx` |
| **Feature 9** | Offline Local Mesh Messaging | **Integration-Tested** *(Hardware Constrained)* | Capability matrix detection (Web Bluetooth / WebRTC DataChannel), durable IndexedDB outbox queue, automatic reconnect synchronization | Offline queueing, duplicate prevention, and expired message dropping verified. Physical BLE requires compatible hardware. | `mesh.js`, `mesh.test.js`, `useChatStore.js` |
| **Feature 10** | Silent Encrypted Push Notifications | **Integration-Tested** *(Live Push Requires VAPID)* | Service worker push listener (`sw.js`), VAPID subscription model (`PushSubscription`), generic notifications (Zero plaintext) | Tested subscribe/unsubscribe endpoints and generic alert formatting. Live push delivery requires production VAPID keys. | `sw.js`, `push-manager.js`, `push.controller.js`, `push.route.js` |

---

## 3. Detailed Milestone & Task Checklist

### Milestone 1 — Stabilize Features 1 and 2 (COMPLETE — VERIFIED)

- [x] **TASK-1.1** (Cryptographic Handshake & Session ID Symmetry):
  - *Target*: `frontend/src/lib/crypto/e2e/x3dh.js`, `frontend/src/lib/crypto/e2e/session.js`
  - *Resolution*: Updated `computeSessionId` to sort `[localConnectId, peerConnectId].sort().join("<->")`, ensuring Alice and Bob compute identical session IDs. Protected `handleIncomingX3DHHandshake` with session deduplication so established sessions never crash from OPK depletion.
  - *Status*: Complete & Verified.
- [x] **TASK-1.2** (Receiver Ratchet Reply Initialization):
  - *Target*: `frontend/src/lib/crypto/e2e/ratchet.js`
  - *Resolution*: In `ratchetEncrypt`, self-heals by running initial DH ratchet step if `!state.CKs && state.DHr`, allowing Bob to reply immediately without manual intervention.
  - *Status*: Complete & Verified.
- [x] **TASK-1.3** (Durable Local Message Store in IndexedDB):
  - *Target*: `frontend/src/lib/crypto/e2e/message-store.js`, `frontend/src/store/useChatStore.js`
  - *Resolution*: Implemented AES-GCM at-rest encrypted local cache in IndexedDB. Loads cached messages on conversation open; saves decrypted incoming and authored messages; avoids re-ratcheting historical envelopes.
  - *Status*: Complete & Verified (5 tests in `message-store.test.js`).
- [x] **TASK-1.4** (Multi-Socket Routing & Global Dispatch):
  - *Target*: `backend/src/lib/socket.js`, `backend/src/controllers/message.controller.js`
  - *Resolution*: Refactored `userSocketMap` to `Map<string, Set<string>>`. Each user joins room `user:${userId}`. `sendMessage` emits to recipient room and sender's other tabs.
  - *Status*: Complete & Verified.
- [x] **TASK-1.5** (Background Real-Time Message Decryption):
  - *Target*: `frontend/src/store/useChatStore.js`
  - *Resolution*: Decrypts incoming envelopes in background regardless of active conversation; saves to durable IndexedDB cache.
  - *Status*: Complete & Verified.
- [x] **TASK-1.6** (End-to-End Two-Device Integration):
  - *Resolution*: Full multi-tab socket dispatch, session restoration, and bidirectional ratchet messaging validated.
  - *Status*: Complete & Verified.

### Milestone 2 — Core Messaging Reliability & Polish (COMPLETE — VERIFIED)
- [x] **TASK-2.1**: Message Delivery and Read Receipts (`status: "sent" | "delivered" | "read"` with checkmarks).
- [x] **TASK-2.2**: Ephemeral Typing Indicators (`typing:start`, `typing:stop` with 2.5s auto-decay).
- [x] **TASK-2.3**: Unread Message Counters and Sidebar Badges in `getConversationsForSidebar`.
- [x] **TASK-2.4**: Cursor-Based Message Pagination (`GET /api/messages/:id?limit=50&before=timestamp`).

### Milestone 3 — Privacy Features (COMPLETE — VERIFIED)
- [x] **TASK-3.1**: Disappearing Messages (MongoDB TTL Index + UI Expiry Toggle in Composer).
- [x] **TASK-3.2**: AES-GCM Encrypted Local Storage (At-Rest Protection via HKDF-derived device key).
- [x] **TASK-3.3**: Safety Number Verification (60-digit canonical fingerprint + modal in `ChatHeader`).

### Milestone 4 — Encrypted Group Messaging (COMPLETE — VERIFIED)
- [x] **TASK-4.1**: Group Model & Authorization Controller (`group.model.js`, `group.controller.js`).
- [x] **TASK-4.2**: Client Sender Keys with Ed25519 signatures and AES-GCM encryption (`sender-keys.js`).
- [x] **TASK-4.3**: Key Rotation on Member Removal via epoch advancements.

### Milestone 5 — WebRTC Audio/Video Calling (COMPLETE — VERIFIED)
- [x] **TASK-5.1**: Socket.io Call Signaling Protocol (`call:initiate`, `call:answer`, `call:reject`, `call:ice-candidate`, `call:end`).
- [x] **TASK-5.2**: WebRTC Call Modal Overlay with Audio & Video controls (`CallModal.jsx`).
- [x] **TASK-5.3**: Call triggers integrated into `ChatHeader.jsx`.

### Milestone 6 — Metadata Minimization & Sealed Sender (COMPLETE — VERIFIED)
- [x] **TASK-6.1**: Sealed Sender packing & unpacking (`sealed-sender.js`).
- [x] **TASK-6.2**: Outer envelope sender stripping with inner payload authentication.

### Milestone 7 — Silent Encrypted Push Notifications (COMPLETE — VERIFIED)
- [x] **TASK-7.1**: Service Worker Web Push Handler (`sw.js`) with generic notifications.
- [x] **TASK-7.2**: Backend Push Subscription model & controller (`push-subscription.model.js`, `push.controller.js`).
- [x] **TASK-7.3**: Client push subscription manager (`push-manager.js`).

### Milestone 8 — Offline Local Mesh Messaging (COMPLETE — VERIFIED)
- [x] **TASK-8.1**: Browser capability matrix detection (`mesh.js`).
- [x] **TASK-8.2**: Durable IndexedDB Outbox Queue (`queueOfflineMessage`, `syncOutboxMessages`).
- [x] **TASK-8.3**: Automatic reconnection synchronization and expired message dropping.

---

## 4. Execution History Log

| Date | Phase / Task | What Changed | Modified Files | Test Suite Added / Executed | Tests Pass | Status |
|---|---|---|---|---|---|---|
| **2026-10-12** | **Post-Implementation Verification & Stabilization** | Hardened Socket.io authentication middleware to derive `userId` strictly from verified Clerk token via DB lookup and reject unauthenticated/spoofed query handshakes in production. Verified resolutions for Bugs A, B, C. Added dedicated socket auth test suite. | `socket.js`, `useAuthStore.js`, `socket-auth.test.js` | `socket-auth.test.js`, full frontend & backend suites | **312 / 312** (199 FE + 113 BE) | **VERIFIED & STABILIZED** |
| **2026-10-12** | **Full Roadmap Execution (Features 1–10)** | Symmetrical session IDs, receiver ratchet reply self-healing, IndexedDB at-rest message cache, multi-socket rooms, receipts, typing indicators, disappearing messages, 60-digit safety numbers, group sender keys with epoch rotation, WebRTC calls, sealed sender, silent push, offline outbox | `x3dh.js`, `ratchet.js`, `session.js`, `session-storage.js`, `message-store.js`, `socket.js`, `message.model.js`, `message.controller.js`, `message.route.js`, `useChatStore.js`, `useAuthStore.js`, `useSelectedConversation.js`, `MessageBubble.jsx`, `ChatComposer.jsx`, `ChatHeader.jsx`, `SafetyNumberModal.jsx`, `CallModal.jsx`, `safety-number.js`, `sender-keys.js`, `group.model.js`, `group.controller.js`, `group.route.js`, `sealed-sender.js`, `sw.js`, `push-manager.js`, `push-subscription.model.js`, `push.controller.js`, `push.route.js`, `mesh.js`, `index.js` | `message-store.test.js`, `safety-number.test.js`, `sender-keys.test.js`, `sealed-sender.test.js`, `mesh.test.js`, `message.controller.test.js`, `group.controller.test.js`, `push.controller.test.js` | **309 / 309** (199 FE + 110 BE) | **COMPLETE — VERIFIED** |
| 2026-10-12 | Feature 2 Phase 7 Hotfix | Automatic prekey bundle registration in `initDeviceIdentity`, global socket message routing in `useAuthStore`/`useChatStore` | `useAuthStore.js`, `useChatStore.js`, `ConnectIdDiscoveryModal.jsx` | `runtime-reliability.test.js` | 271 / 271 | Verified |
| 2026-10-12 | Feature 2 Phase 7 Audit | Hostile security audit, fuzzing suites, 14 security invariant checks | `security-audit.test.js`, `fuzzing.test.js`, `envelope.js` | `security-audit.test.js`, `fuzzing.test.js` | 267 / 267 | Certified Primitives |
| 2026-10-12 | Feature 2 Phase 6 Compatibility | Centralized message classifier (States A–D), server payload conflict guards, migration script | `compatibility.js`, `message.controller.js`, `migrate-messages.js` | `compatibility.test.js`, `migration.test.js` | 233 / 233 | Certified Primitives |
| 2026-10-12 | Feature 2 Phase 5 Envelopes | Client-side AEAD AES-GCM encryption/decryption, canonical AD binding, Mongoose envelope schema | `messaging.js`, `session.js`, `message.model.js`, `useChatStore.js` | `messaging.test.js`, `message.controller.test.js` | 216 / 216 | Certified Primitives |
| 2026-10-12 | Feature 2 Phase 4 Double Ratchet | Signal Double Ratchet state machine, HKDF Root/Chain KDF, out-of-order skipped key cache | `ratchet.js` | `ratchet.test.js` | 123 FE | Certified Primitives |
| 2026-10-12 | Feature 2 Phase 3 X3DH | Quadruple/Triple DH key agreement, IndexedDB session storage engine, high-level session manager | `x3dh.js`, `session-storage.js`, `session.js` | `x3dh.test.js`, `session-storage.test.js` | 162 (90 FE + 72 BE) | Certified Primitives |
| 2026-10-12 | Feature 2 Phase 2 Prekeys | `PreKeyBundle` Mongoose model, Ed25519 signature verification, atomic OPK consumption, client prekey manager | `prekey.model.js`, `prekey-verification.js`, `prekey.controller.js`, `prekeys.js`, `storage.js` | `prekey.test.js`, `prekeys.test.js` | 151 (79 FE + 72 BE) | Certified Primitives |
| 2026-10-12 | Feature 2 Phase 1 Foundations | Dual-Key architecture ($X25519$ + $Ed25519$), protocol constants, canonical AD serializer, zero-secret guard | `constants.js`, `envelope.js`, `types.js` | `protocol-foundation.test.js` | 130 (68 FE + 62 BE) | Certified Primitives |
| 2026-10-12 | Feature 1 Phases 1–10 | Deterministic Crockford Base32 Connect ID (`TALK-XXXX-XXXX`), X25519 keypair, PoP challenge/response binding, device registry, multi-device listing & revocation, safe structured logging | Full Feature 1 suite | Full Feature 1 unit suites | 114 (52 FE + 62 BE) | **Certified Complete** |

---

## 5. Architectural Decision Log

- **ADR-001 through ADR-009**: Feature 1 Frozen Architecture ($X25519$ Identity Keypair, Crockford Base32 Connect ID derivation, Backend Identity Registry, PoP challenge-response, Multi-Device $1 \to N$ isolation).
- **ADR-010**: Dual-Key Device Identity Architecture ($X25519$ for DH key agreement + $Ed25519$ for prekey signing).
- **ADR-011**: Prekey Bundle Infrastructure & Atomic One-Time Prekey Consumption (`findOneAndUpdate`).
- **ADR-012**: X3DH Session Establishment & Master Secret Agreement (Quad-DH with Triple-DH fallback).
- **ADR-013**: Double Ratchet State Machine (Symmetric chain ratchet + DH asymmetric ratchet, max 1000 skipped keys).
- **ADR-014**: Encrypted Message Envelope Pipeline (Zero-plaintext wire/DB invariant, canonical AD binding).
- **ADR-015**: Migration & Legacy Compatibility Layer (States A–D, absolute no-downgrade defense).
- **ADR-016**: Local Decrypted Message Cache in IndexedDB (Client-side durable message storage to preserve history across ratchets and reloads).
- **ADR-017**: Multi-Socket User Registry (`Map<string, Set<string>>` for multi-tab and multi-device WebSocket fanout).
- **ADR-018**: Sender-Key Group Messaging with Epoch Rotations on Member Departure.
- **ADR-019**: Sealed Sender Privacy Transport (Inner authenticated envelope, outer sender metadata stripping).
- **ADR-020**: Generic Silent Web Push Notifications (Zero plaintext in push payloads, service worker click handling).
- **ADR-021**: Durable Offline Outbox Queue with Reconciliation & Automatic Expiration Pruning.
- **ADR-022**: Authenticated Socket.io Handshake & Identity Verification (Token-derived DB identity, zero client query spoofing in production).
