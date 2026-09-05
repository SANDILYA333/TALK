# TALK — Complete Phase-Wise Implementation Roadmap

## Purpose

This document converts every feature defined in `additional-features.md` into a controlled, implementation-ready engineering roadmap.

The objective is **not** to build everything simultaneously.

Each feature is divided into independently verifiable phases so that:

* architecture is established before dependent functionality;
* security-sensitive changes are isolated;
* database migrations do not get mixed unnecessarily with UI work;
* every phase leaves the application in a usable state;
* another AI coding agent can implement one phase without guessing;
* documentation remains synchronized;
* regressions can be identified immediately;
* the final system remains understandable enough to defend technically in an interview.

---

# 0. GLOBAL DEVELOPMENT RULES

These rules apply to every feature and every phase.

## 0.1 Source of Truth Hierarchy

When implementing a feature, use this priority:

1. Actual repository implementation
2. `Plan/architecture.md`
3. `Plan/code-standards.md`
4. `Plan/ai-workflow-rules.md`
5. `Plan/project-overview.md`
6. `Plan/progress-tracker.md`
7. `additional-features.md`

If a roadmap description conflicts with the actual repository, **do not silently modify architecture**.

Document the conflict first.

---

## 0.2 Mandatory Phase Structure

Every implementation phase must answer:

### 1. Primary Goal

What single outcome must exist when the phase ends?

### 2. Why This Phase Exists

Why must this be completed before the next phase?

### 3. Required Implementation

Exactly what must change.

### 4. Backend Changes

Routes, controllers, middleware, services, models, infrastructure, etc.

### 5. Frontend Changes

Components, stores, hooks, contexts, utilities, UI, etc.

### 6. Data / Schema Changes

MongoDB, IndexedDB, key material, metadata, migrations, indexes, etc.

### 7. Protocol / API Changes

HTTP endpoints, Socket.io events, payloads, cryptographic envelopes, signaling messages, etc.

### 8. Security Requirements

What must be protected and what must never be trusted.

### 9. Files Allowed to Change

The implementation scope.

### 10. Files That MUST NOT Be Touched

Protected infrastructure and unrelated features.

### 11. Documentation That Must Be Referenced

The five context files plus feature-specific documentation.

### 12. Dependencies

What must already exist.

### 13. Implementation Order

The exact sequence the coding agent should follow.

### 14. Verification

How the agent proves the implementation works.

### 15. Failure Conditions

What constitutes an incomplete or unsafe implementation.

### 16. Success Criteria

Observable conditions proving the phase is complete.

### 17. Documentation Updates

Which context files must be updated afterward.

---

# 1. FEATURE — PUBLIC-KEY CONNECT ID

## Objective

Replace dependency on human-readable PII for user discovery with a client-generated cryptographic identity represented by a shareable Connect Code.

The source specification describes:

`TALK-XXXX-XXXX`

derived from a client-generated public key, with the private key remaining on-device. QR generation/scanning is part of the intended experience.

---

## Phase 1.1 — Cryptographic Identity Foundation

### Primary Goal

Create a persistent client-side cryptographic identity without changing normal messaging yet.

### Must Implement

* Generate an X25519 keypair on first identity initialization.
* Generate it entirely client-side.
* Persist private key material securely in IndexedDB.
* Persist public key material.
* Create a versioned identity representation.
* Ensure initialization is idempotent.
* Reloading the application must recover the same identity.

### MUST NOT BE TOUCHED

* Existing Clerk authentication flow
* Clerk webhook implementation
* Existing message schema
* Existing Socket.io protocol
* Existing ImageKit pipeline
* Existing theme system

### Refer To

* `architecture.md`
* `code-standards.md`
* `ai-workflow-rules.md`
* `project-overview.md`
* `additional-features.md`

### Success

The same browser/device produces the same identity after reload and the private key never appears in:

* MongoDB
* HTTP responses
* Socket payloads
* localStorage
* console logs

---

## Phase 1.2 — Connect Code Derivation

### Primary Goal

Derive a stable human-shareable Connect Code from the public key.

### Must Implement

* Deterministic public-key hashing.
* Base32 representation.
* Truncation according to the defined format.
* `TALK-XXXX-XXXX` formatting.
* Collision handling strategy.
* Versioning of the code format.

### Important

The Connect Code must be a representation of the cryptographic identity, not a random username.

### MUST NOT BE TOUCHED

* Existing message sending
* Socket message delivery
* Existing Clerk login
* ImageKit
* Theme/wallpaper functionality

### Success

Given the same public key:

```text
public key
   ↓
hash
   ↓
encoded identity
   ↓
TALK-XXXX-XXXX
```

always produces the same Connect Code.

---

## Phase 1.3 — Server Identity Registry

### Primary Goal

Allow the server to resolve a Connect Code to a public identity without receiving the private key.

### Must Implement

Introduce the minimum server-side identity data required for discovery:

```text
Connect Identity
├── connectCode
├── publicKey
├── identityVersion
└── timestamps
```

Potentially associate it with the existing MongoDB user while preserving the current Clerk identity.

### MUST NOT BE TOUCHED

* Private-key storage
* Existing message persistence semantics
* Existing Clerk webhook verification
* Socket authentication implementation

### Success

A client can publish/register its public identity and another authenticated client can resolve the corresponding public key from a Connect Code.

The server still cannot reconstruct the private key.

---

## Phase 1.4 — Connect Code UI + QR

### Primary Goal

Make the cryptographic identity usable by humans.

### Must Implement

* Display own Connect Code.
* Copy button.
* Share functionality.
* QR generation.
* QR scanning.
* Manual Connect Code entry.
* Invalid-code handling.
* Loading/error states.

### UI Requirements

The feature should feel native to TALK rather than like an external cryptography tool.

### MUST NOT BE TOUCHED

* Existing message rendering
* Existing chat composer behavior
* Theme infrastructure
* Authentication internals

### Success

User A can:

```text
Open TALK
→ View Connect Code
→ Show QR
```

User B can:

```text
Scan QR
→ Resolve identity
→ Open/contact the correct user
```

---

## Phase 1.5 — Connect-ID-Based Contact Discovery

### Primary Goal

Integrate Connect IDs into the existing contact/discovery system.

### Must Implement

* Resolve Connect Code.
* Validate identity.
* Associate contact with cryptographic identity.
* Prevent duplicate identity records.
* Handle unknown/revoked identities.
* Preserve existing users during migration.

### Critical Constraint

**Do NOT immediately remove Clerk/email from the system.**

Connect ID should initially become an additional identity/discovery layer.

### Success

Existing users continue functioning while new users can discover contacts using Connect IDs.

---

## Phase 1.6 — Feature Hardening

### Must Implement

* Key persistence tests.
* Identity recovery tests.
* Collision handling.
* malformed QR tests.
* invalid code tests.
* duplicate registration handling.
* private-key leakage audit.
* browser storage inspection.

### Final Success

Feature 1 is complete only when:

> A user has a persistent cryptographic identity whose private key remains device-local, whose public identity can be shared as a Connect Code/QR, and which can be resolved by another user without exposing PII.

---

# 2. FEATURE — SIGNAL-PROTOCOL E2E ENCRYPTION

This is the most security-sensitive feature.

The roadmap specifies X3DH for initial key establishment, followed by root-key and chain-key ratcheting, using established cryptographic libraries rather than implementing cryptographic primitives manually.

---

## Phase 2.1 — Cryptographic Architecture Design

### Primary Goal

Define the exact encryption protocol before implementing it.

### Must Define

* Identity keys
* Signed prekeys
* One-time prekeys
* X3DH handshake
* Root key
* Sending chain
* Receiving chain
* Message keys
* Associated data
* Nonces
* Authentication tags
* Ratchet state
* Session identifiers
* Out-of-order messages
* Replay handling
* Key rotation
* Session reset
* Device loss behavior

### MUST NOT BE TOUCHED

**No production message encryption yet.**

Do not modify the existing message pipeline until the cryptographic contract is documented.

### Success

A complete protocol diagram exists and every cryptographic value has:

* owner
* lifetime
* storage location
* transmission path
* protection requirements

---

## Phase 2.2 — Pre-Key Infrastructure

### Primary Goal

Implement server-supported key discovery.

### Must Implement

Server-side public cryptographic material:

```text
Identity Public Key
Signed Prekey
One-Time Prekeys
Signatures
Key version
```

### Critical Rule

Private cryptographic material remains client-side.

### MUST NOT BE TOUCHED

* Existing plaintext message rendering
* Existing message deletion behavior
* Existing ImageKit behavior

### Success

Two users can obtain the public material required to establish an encrypted session.

---

## Phase 2.3 — X3DH Session Establishment

### Primary Goal

Establish a shared secret between two clients.

### Must Implement

* X3DH-style handshake.
* Signature verification.
* One-time prekey consumption.
* Shared-secret derivation.
* Session initialization.
* Failure handling.

### Success

Both clients independently derive the same initial session secret without sending the secret through the server.

---

## Phase 2.4 — Double Ratchet Core

### Primary Goal

Implement message-key evolution.

### Must Implement

* Root-key derivation.
* Chain-key derivation.
* Sending chain.
* Receiving chain.
* DH ratchet.
* Message key generation.
* Message counter.
* Previous-chain counter.
* Skipped-message handling.

### MUST NOT BE TOUCHED

* UI redesign
* Group chat
* WebRTC
* Push notifications
* Offline mesh

### Success

Sequential messages do not reuse the same message key.

---

## Phase 2.5 — Encrypted Message Envelope

### Primary Goal

Replace plaintext message transport with encrypted ciphertext while maintaining the existing chat experience.

### Message should conceptually become:

```text
EncryptedMessage
├── messageId
├── conversation/session identifier
├── ciphertext
├── nonce
├── authentication data
├── ratchet metadata
└── protocol version
```

### Important

The server should persist ciphertext rather than plaintext content.

### Success

MongoDB inspection reveals ciphertext rather than readable message content.

The recipient decrypts locally.

---

## Phase 2.6 — Migration / Compatibility Layer

### Primary Goal

Transition existing plaintext conversations safely.

### Must Decide

* plaintext → encrypted migration
* mixed conversation support
* protocol versioning
* legacy message rendering
* migration boundary
* old message behavior

This directly addresses the existing project question about evolving MongoDB without breaking plaintext conversations.

### Success

Existing TALK users are not silently locked out of historical messages.

---

## Phase 2.7 — Security Testing

### Test

* wrong recipient
* modified ciphertext
* replayed message
* reordered messages
* dropped messages
* duplicated messages
* skipped messages
* invalid signatures
* compromised message key
* session reset
* device reload

### Final Success

Feature 2 is complete only when TALK can honestly claim:

> Message contents are encrypted/decrypted on endpoints and the server stores/transports ciphertext rather than plaintext.

Do **not** call it “Signal-grade” unless the implementation actually satisfies the protocol/security properties being claimed.

---

# 3. FEATURE — DISAPPEARING MESSAGES

The source design specifies configurable expiry of:

* 1 hour
* 1 day
* 1 week
* off

using `expiresAt`, MongoDB TTL, and client-side expiry handling.

---

## Phase 3.1 — Expiry Data Model

### Must Implement

Add:

```text
expiresAt
```

to message records where applicable.

### Define

* whether expiry is sender-selected
* conversation-level vs message-level expiry
* default behavior
* "off"
* timezone handling
* server authority

### Success

Every expiring message has an authoritative expiry timestamp.

---

## Phase 3.2 — MongoDB TTL

### Must Implement

* TTL index.
* Verify expiration behavior.
* Handle existing records.
* Ensure TTL applies only where appropriate.

### MUST NOT BE TOUCHED

* encryption protocol
* socket authentication
* WebRTC
* group architecture

### Success

Expired messages are eventually removed by MongoDB.

---

## Phase 3.3 — Real-Time Expiration

### Must Implement

* expiration events
* client removal
* remote participant synchronization
* conversation updates
* unread-state cleanup

### Success

A message disappearing on the server does not leave a stale copy in the active UI.

---

## Phase 3.4 — UX

### Must Implement

* timer control
* expiration indicators
* countdown/fade behavior
* settings
* confirmation where necessary

### Final Success

A message disappears from:

* sender UI
* recipient UI
* persistent storage

according to the selected policy.

---

# 4. FEATURE — ENCRYPTED LOCAL STORAGE

The source design calls for IndexedDB storage protected using AES-GCM, with a local key derived from device key material using HKDF and never stored directly.

---

## Phase 4.1 — Local Storage Architecture

### Primary Goal

Move sensitive cached chat state from plaintext browser storage into a dedicated encrypted storage layer.

### Must Define

* IndexedDB schema
* encryption envelope
* key derivation
* versioning
* migration
* recovery behavior

---

## Phase 4.2 — Key Derivation

### Must Implement

```text
Device Key Material
        ↓
HKDF
        ↓
Local Encryption Key
```

Use Web Crypto APIs.

Never store the derived key directly.

---

## Phase 4.3 — AES-GCM Storage Wrapper

### Must Implement

Centralized APIs:

```text
securePut()
secureGet()
secureDelete()
secureClear()
```

All sensitive local data should pass through them.

### MUST NOT BE TOUCHED

* remote MongoDB message schema unless required
* Socket.io protocol
* theme preferences

---

## Phase 4.4 — Zustand / Application Integration

### Must Implement

Replace sensitive plaintext local caching with encrypted persistence.

### Success

Inspecting IndexedDB shows ciphertext rather than readable message contents.

---

## Phase 4.5 — Recovery / Migration / Failure Handling

### Must Handle

* corrupted ciphertext
* missing key material
* browser storage cleared
* new device
* logout
* identity reset
* protocol version migration

### Final Success

Local chat cache is unreadable without the device's cryptographic identity.

---

# 5. FEATURE — SAFETY NUMBER VERIFICATION

The roadmap describes a fingerprint derived from both users' public keys, displayed as a short number/QR and verified independently between participants.

---

## Phase 5.1 — Fingerprint Specification

### Must Define

```text
User A public key
+
User B public key
        ↓
canonical ordering
        ↓
SHA-256
        ↓
formatted fingerprint
```

### Critical

Canonical ordering must be deterministic.

---

## Phase 5.2 — Verification UI

### Must Implement

* Verify Contact screen.
* fingerprint display.
* QR representation.
* manual comparison.
* verified/unverified state.

---

## Phase 5.3 — Persistent Verification State

### Must Define

Where verification state lives.

The server must not be able to silently mark two users as verified.

### Success

Changing a user's public identity invalidates the old verification state.

---

## Phase 5.4 — Contact-Key-Change Warning

### Must Implement

If a contact's cryptographic identity changes:

```text
Verified
   ↓
Identity changed
   ↓
Verification invalid
```

The user must be informed.

### Final Success

Users can independently establish that the cryptographic identity they're communicating with matches the one they verified.

---

# 6. FEATURE — SEALED SENDER / METADATA MINIMIZATION

The source roadmap proposes anonymous rotating session tokens, separately encrypted envelopes, and removing identity-to-identity information from logs.

This feature must be treated as an **architecture redesign**, not a cosmetic backend change.

---

## Phase 6.1 — Metadata Threat Model

### Primary Goal

Document exactly what TALK's server currently knows.

Inventory:

* sender
* recipient
* timestamp
* socket ID
* IP/network metadata where infrastructure exposes it
* message size
* conversation relationship
* connection lifetime
* media metadata
* logs

### Success

A formal list exists of:

```text
metadata retained
metadata removed
metadata minimized
metadata unavoidable
```

---

## Phase 6.2 — Anonymous Session Routing

### Must Implement

Replace persistent identity-based socket routing with privacy-preserving routing identifiers where feasible.

### MUST NOT BE TOUCHED

* message encryption implementation until the routing contract is established
* group messaging
* offline mesh

---

## Phase 6.3 — Encrypted Message Envelope

### Must Implement

Separate:

```text
message ciphertext
```

from:

```text
recipient routing envelope
```

The server should learn as little as practically possible.

---

## Phase 6.4 — Logging Minimization

### Must Implement

Remove identity relationships from logs.

Prefer:

```text
socket connected
socket disconnected
message relay completed
```

over:

```text
User A → User B
```

### Success

Logs cannot trivially reconstruct communication graphs.

---

## Phase 6.5 — Metadata Audit

### Final Verification

Perform a complete request/socket/database/log audit.

### Final Success

The server can relay encrypted communication while minimizing persistent knowledge of sender-recipient relationships.

---

# 7. FEATURE — GROUP CHATS WITH SENDER KEYS

The roadmap specifies Sender Keys so messages can be encrypted once for a group instead of separately for every member, with key rotation when members leave.

---

## Phase 7.1 — Group Domain Model

### Must Implement

Define:

```text
Group
GroupMember
GroupRole
GroupMembershipVersion
```

Potential group lifecycle:

```text
created
member added
member removed
group renamed
group archived
```

### Success

Groups can exist independently from 1-to-1 conversations.

---

## Phase 7.2 — Group Permissions

### Define

* creator
* administrator
* member
* invitation
* removal
* leaving
* ownership
* membership changes

### MUST NOT BE TOUCHED

* E2E cryptographic primitives themselves
* WebRTC
* offline mesh

---

## Phase 7.3 — Sender-Key Distribution

### Must Implement

Each participant:

```text
Generate sender key
        ↓
Distribute securely to members
        ↓
Store locally
```

Distribution uses the established secure 1-to-1 mechanism.

---

## Phase 7.4 — Group Message Encryption

### Must Implement

```text
Plaintext
   ↓
Sender Key
   ↓
Ciphertext
   ↓
Group broadcast
```

Recipient decrypts locally.

---

## Phase 7.5 — Membership Rotation

### Must Implement

When membership changes:

```text
Member leaves
     ↓
Old sender keys invalidated
     ↓
New key generation
     ↓
Redistribution
```

This is required to prevent removed members from decrypting future group traffic.

---

## Phase 7.6 — Group UX

### Must Implement

* create group
* name group
* add members
* remove members
* leave group
* group avatar
* member list
* encrypted message indicators

### Final Success

A group of dozens of users can exchange encrypted messages without encrypting every message independently for every recipient.

---

# 8. FEATURE — E2E ENCRYPTED VOICE & VIDEO CALLS

The source feature specifies WebRTC for peer-to-peer media, Socket.io only for signaling, and TURN fallback for restrictive networks.

---

## Phase 8.1 — Call Architecture

### Must Define

```text
Caller
   ↓
Socket.io signaling
   ↓
Callee
   ↓
WebRTC negotiation
   ↓
P2P media
```

Server must not receive the actual audio/video stream.

---

## Phase 8.2 — Signaling Protocol

### Define

Events for:

* call invitation
* offer
* answer
* ICE candidate
* call accepted
* call rejected
* call ended
* timeout

### MUST NOT BE TOUCHED

* existing message protocol
* encryption storage
* group sender keys

---

## Phase 8.3 — Audio Calling

### Must Implement

* microphone permissions
* peer connection
* mute/unmute
* connection state
* hangup
* reconnection/error states

---

## Phase 8.4 — Video Calling

### Must Implement

* camera permissions
* local preview
* remote video
* camera toggle
* audio toggle
* full-screen mode
* responsive layout

---

## Phase 8.5 — STUN/TURN

### Must Implement

* STUN configuration
* TURN configuration
* credential management
* environment variables
* fallback behavior

### Success

Calls work across different networks rather than only on localhost/LAN.

---

## Phase 8.6 — Call Security

### Must Verify

* authenticated signaling
* correct peer identity
* unauthorized call attempts
* call hijacking resistance
* signaling payload validation
* WebRTC transport security

### Final Success

Two authenticated TALK users can establish an audio/video call across real-world networks without routing media through the application server.

---

# 9. FEATURE — OFFLINE LOCAL MESH MESSAGING

The source roadmap describes a "Nearby" mode using local Bluetooth/WebRTC-style transport, encrypted message payloads, local queueing, and synchronization with MongoDB once connectivity returns. It explicitly notes browser/platform limitations around Web Bluetooth.

This should be the **last feature**.

---

## Phase 9.1 — Transport Abstraction

### Primary Goal

Decouple messaging from Socket.io.

Create conceptual transport layers:

```text
Message
  ↓
Transport Interface
  ├── InternetTransport
  ├── BluetoothTransport
  └── FutureTransport
```

### This is critical.

Without this abstraction, offline mesh will contaminate the existing online messaging architecture.

---

## Phase 9.2 — Local Message Queue

### Must Implement

Persistent queue:

```text
pending
sending
sent
failed
synced
```

### Must Define

* message ID
* encryption state
* retry count
* created timestamp
* transport source
* synchronization status

---

## Phase 9.3 — Nearby Discovery

### Must Implement

Investigate and implement supported local discovery mechanisms.

For the roadmap's browser approach:

```text
navigator.bluetooth
```

with explicit capability detection.

### MUST NOT BE TOUCHED

* normal online transport
* existing authentication
* existing database schema until sync contract is established

---

## Phase 9.4 — Encrypted Local Transport

### Must Implement

Exchange already-encrypted message payloads.

The mesh layer should **not implement a second plaintext messaging protocol**.

Conceptually:

```text
Plaintext
   ↓
E2E encryption
   ↓
Encrypted payload
   ↓
Bluetooth/local transport
```

---

## Phase 9.5 — Offline Synchronization

### Must Implement

When internet returns:

```text
Offline queue
      ↓
Connectivity detected
      ↓
Authenticate
      ↓
Upload encrypted messages
      ↓
Server deduplication
      ↓
MongoDB persistence
      ↓
Queue marked synced
```

### Critical

Use globally unique message IDs/idempotency.

---

## Phase 9.6 — Conflict Resolution

### Must Define

* duplicate messages
* ordering
* delayed messages
* deleted messages
* expired messages
* revoked identities
* membership changes
* stale keys

### Final Success

Two supported devices can communicate locally without internet, preserve encrypted messages locally, and synchronize safely when connectivity returns.

---

# 10. FEATURE — SILENT ENCRYPTED PUSH NOTIFICATIONS

The source roadmap proposes Web Push + VAPID, with only generic notification content transmitted through the push channel and the actual encrypted message retrieved/decrypted separately.

---

## Phase 10.1 — Push Subscription Architecture

### Must Implement

* service worker
* push subscription
* VAPID configuration
* subscription persistence
* device registration
* unsubscribe flow

### Success

A user can register a device for push notifications.

---

## Phase 10.2 — Notification Privacy Contract

### Primary Goal

Guarantee that notification payloads contain no message content.

Allowed concept:

```text
"New message"
```

Not:

```text
"Hey, are you coming tomorrow?"
```

### MUST NOT BE TOUCHED

* E2E encryption internals
* message plaintext handling
* unrelated UI

---

## Phase 10.3 — Backend Push Trigger

### Must Implement

When a message is delivered while the recipient is unavailable:

```text
New encrypted message
       ↓
Recipient offline
       ↓
Push trigger
       ↓
Generic notification
```

---

## Phase 10.4 — Client Retrieval

### Must Implement

Notification click:

```text
Notification
     ↓
Open TALK
     ↓
Authenticate
     ↓
Fetch encrypted message
     ↓
Decrypt locally
     ↓
Display
```

---

## Phase 10.5 — Privacy Verification

### Must Audit

* push payload
* server logs
* service worker
* browser notifications
* backend notification provider
* message previews

### Final Success

Push infrastructure never receives the actual plaintext message content.

---

# 11. CROSS-FEATURE DEPENDENCY GRAPH

Do not implement these independently.

The correct dependency chain is:

```text
PHASE 0
Foundation Hardening
        │
        ▼
FEATURE 1
Public-Key Connect ID
        │
        ▼
FEATURE 2
E2E / Double Ratchet
        │
        ├───────────────┐
        ▼               ▼
FEATURE 3          FEATURE 4
Disappearing       Encrypted
Messages           Local Storage
        │               │
        └───────┬───────┘
                ▼
FEATURE 5
Safety Numbers
        │
        ▼
FEATURE 6
Sealed Sender
        │
        ├───────────────┐
        ▼               ▼
FEATURE 7          FEATURE 8
Groups             WebRTC
Sender Keys
        │
        └───────┬───────┘
                ▼
FEATURE 10
Silent Push
                │
                ▼
FEATURE 9
Offline Mesh
```

---

# 12. PRE-ROADMAP FOUNDATION

Before Feature 1, finish the current Phase 2 hardening work.

This includes:

### Foundation A

Socket authentication.

### Foundation B

Multi-tab/multi-device socket routing.

### Foundation C

Global real-time message dispatch/unread state.

### Foundation D

Backend validation.

### Foundation E

Cursor-based message pagination.

### Foundation F

Environment/secret hygiene.

These are already identified in `progress-tracker.md`.

Do not build cryptographic identity on top of a known insecure socket identity mechanism.

---

# 13. STANDARD FILE-PROTECTION POLICY

The following files are high-risk and should not be modified casually:

```text
backend/src/webhooks/clerk.webhooks.js
backend/src/lib/db.js
backend/src/lib/socket.js
Dockerfile
frontend/src/index.css
frontend/src/styles/heroui-theme-presets.css
```

The current AI workflow explicitly identifies these areas as protected.

For each feature, the implementing agent must explicitly state:

```text
Files I will modify:
...

Files I will not modify:
...
```

before implementation.

---

# 14. REQUIRED DOCUMENTATION AFTER EVERY PHASE

After every completed phase:

## `progress-tracker.md`

Update:

* phase status
* completed work
* next phase
* architecture decisions
* open questions

## `architecture.md`

Update if:

* schema changed
* protocol changed
* storage changed
* service boundary changed
* socket behavior changed
* cryptographic architecture changed

## `code-standards.md`

Update if:

* new coding pattern introduced
* new security rule introduced
* new socket event convention introduced
* new storage rule introduced

## `project-overview.md`

Update if:

* user-facing scope changed
* new feature became operational
* old functionality changed

## `ai-workflow-rules.md`

Update if:

* implementation workflow changed
* new protected files exist
* new verification requirements exist

This follows the project's existing documentation synchronization rules.

---

# 15. UNIVERSAL VERIFICATION GATE

Every phase must pass:

## Build

Frontend:

```text
npm run build
```

Backend:

```text
npm run build
```

using the actual commands defined by the repository.

---

## Functional Verification

Test the exact feature behavior.

---

## Regression Verification

Verify:

* authentication
* existing 1-to-1 messaging
* media
* presence
* responsive UI
* theme system

unless the phase explicitly changes one of them.

---

## Security Verification

Ask:

```text
Can the client impersonate another identity?
Can plaintext leak to the server?
Can sensitive keys leak?
Can a stale identity remain trusted?
Can a malicious payload corrupt state?
Can an unauthorized socket perform the operation?
```

---

## Documentation Verification

No phase is complete until the five context files are synchronized.

---

# 16. FINAL IMPLEMENTATION ORDER

The complete execution order should be:

## PHASE 0 — Foundation

1. Socket authentication
2. Multi-session socket routing
3. Global real-time state
4. Validation
5. Pagination
6. Environment hygiene

---

## PHASE 1 — Cryptographic Identity

7. Identity keypair
8. Private-key storage
9. Connect Code derivation
10. Public-key registry
11. QR generation
12. QR scanning
13. Connect-ID discovery

---

## PHASE 2 — E2E

14. Protocol design
15. Prekeys
16. X3DH
17. Double Ratchet
18. Encrypted envelope
19. Message migration
20. cryptographic testing

---

## PHASE 3 — Ephemeral Messaging

21. Expiry model
22. TTL
23. realtime expiry
24. UI
25. synchronization

---

## PHASE 4 — Local Encryption

26. IndexedDB architecture
27. HKDF key derivation
28. AES-GCM wrapper
29. Zustand integration
30. migration/recovery

---

## PHASE 5 — Verification

31. Safety fingerprint
32. QR/manual verification
33. persistent verification
34. identity-change detection

---

## PHASE 6 — Metadata Privacy

35. metadata audit
36. anonymous routing
37. encrypted envelope
38. log minimization
39. privacy verification

---

## PHASE 7 — Groups

40. group model
41. membership
42. permissions
43. sender-key distribution
44. group encryption
45. rotation
46. group UX

---

## PHASE 8 — Calls

47. call architecture
48. signaling
49. audio
50. video
51. STUN/TURN
52. security testing

---

## PHASE 9 — Push

53. service worker
54. subscriptions
55. backend trigger
56. generic notification
57. encrypted retrieval

---

## PHASE 10 — Offline Mesh

58. transport abstraction
59. local queue
60. nearby discovery
61. encrypted transport
62. synchronization
63. conflict resolution

---

# 17. WHAT "DONE" MEANS FOR THE ENTIRE ROADMAP

The roadmap is complete only when TALK can provide all of the following:

### Identity

Users can communicate using cryptographic Connect IDs without requiring PII for discovery.

### Encryption

Message content is encrypted at the endpoints using a correctly designed ratcheting protocol.

### Local Privacy

Browser-persisted sensitive chat data is encrypted at rest.

### Verification

Users can independently verify cryptographic identities.

### Ephemeral Privacy

Messages can disappear according to user-defined expiry policies.

### Metadata Privacy

The server's knowledge of communication relationships is minimized.

### Groups

Encrypted groups use an efficient Sender Key architecture.

### Calls

Users can establish secure peer-to-peer audio/video communication.

### Push

Notifications do not expose message plaintext.

### Offline

Supported devices can exchange encrypted messages locally and synchronize later.

---

# 18. MOST IMPORTANT ENGINEERING PRINCIPLE

Do **not** think of this as:

```text
10 unrelated features
```

Think of it as:

```text
TALK MVP
   ↓
Secure Infrastructure
   ↓
Cryptographic Identity
   ↓
Encrypted Communication
   ↓
Privacy-Preserving Storage
   ↓
Identity Verification
   ↓
Metadata Privacy
   ↓
Encrypted Groups
   ↓
Encrypted Calls
   ↓
Private Notifications
   ↓
Offline Communication
```

Every layer exists because the next layer depends on it.

The original `additional-features.md` already identifies Connect ID as the feature that unlocks the rest of the roadmap and recommends the sequence through E2E, disappearing/local encryption, verification, calls, groups, sealed sender, push, and finally offline mesh.

Therefore:

**Do not skip ahead because a later feature looks more exciting.**

The strongest version of TALK is not the one with the most features.

It is the one where every feature is built on a coherent architecture that can be explained, tested, defended, and extended.
