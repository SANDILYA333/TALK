# Feature Learning Journal — Feature 1 (Phase 0: Reconnaissance & Architecture Lock)

## 1. Executive Summary & Objective

**Feature 1: Public-Key Connect ID (PII-Free Identity)** represents the foundational transition of TALK from a centralized account-identifier model (Clerk/email/MongoDB `_id`) to a decentralized, cryptographic communication identity layer. 

In **Phase 0 (Reconnaissance & Architecture Lock)**, no production code, cryptographic keys, database fields, or UI components are implemented. The sole objective is a rigorous, code-grounded audit of TALK's current identity, authentication, socket, and data persistence models to establish an exact baseline, identify architectural risks and assumptions, and define safe integration boundaries for Phase 1.

---

## 2. Current TALK Identity Architecture

TALK currently implements a **centralized identity architecture** where authentication, identity storage, real-time presence, and message routing are tightly coupled to Clerk accounts and MongoDB ObjectIds (`_id`).

### Identity Lifecycle Overview
```text
┌──────────────┐         ┌──────────────┐         ┌──────────────┐
│  End User    │ ──────> │  Clerk Auth  │ ──────> │  App.jsx     │
└──────────────┘         └──────────────┘         └──────────────┘
                                │                        │
                       Svix Webhook (JWT)       GET /api/auth/check
                                │                        │
                                ▼                        ▼
                         ┌──────────────┐         ┌──────────────┐
                         │ MongoDB User │ <────── │ protectRoute │
                         │ (users coll) │         └──────────────┘
                         └──────────────┘                │
                                │                        ▼
                                │                 useAuthStore.authUser
                                │                        │
                                ▼                        ▼
                         ┌──────────────┐         ┌──────────────┐
                         │ Message Model│ <────── │ Socket.io    │
                         │ (senderId/   │         │ (handshake   │
                         │  receiverId) │         │  query)      │
                         └──────────────┘         └──────────────┘
```

---

## 3. Current Authentication Flow

The complete authentication and session hydration flow was traced across the codebase:

```text
1. User Lands on Auth Page
   │
   ▼
2. Frontend: AuthActionPanel.jsx ([AuthActionPanel.jsx](file:///home/kafka/Coding/Web_Dev/Projects/Real%20Time%20Chat%20Application/Real-Time-Chat-Application/frontend/src/components/auth/AuthActionPanel.jsx#L54-L56))
   - User clicks "Continue"
   - Calls clerk.openSignIn({ fallbackRedirectUrl: "/", forceRedirectUrl: "/" })
   │
   ▼
3. Clerk Authentication Gateway
   - User signs in via OAuth (Google) or email/password
   - Clerk issues session JWT in HTTP cookies / headers
   │
   ├──────────────────────────────────────────────────────┐
   ▼ (Asynchronous Webhook Path)                          ▼ (Synchronous Client Path)
4a. Clerk Webhook Trigger                              4b. Client Redirected to "/"
   - POST /api/webhooks/clerk                             - App.jsx ([App.jsx](file:///home/kafka/Coding/Web_Dev/Projects/Real%20Time%20Chat%20Application/Real-Time-Chat-Application/frontend/src/App.jsx#L27)) detects isSignedIn === true
   - Verified via @clerk/backend/webhooks                - Triggers useAuthStore.checkAuth()
   - Upserts User document in MongoDB                      - Axios sends GET /api/auth/check withCredentials: true
   │                                                      │
   └──────────────────────────┬───────────────────────────┘
                              ▼
5. Backend Route: GET /api/auth/check
   - Middleware: protectRoute ([auth.middleware.js](file:///home/kafka/Coding/Web_Dev/Projects/Real%20Time%20Chat%20Application/Real-Time-Chat-Application/backend/src/middleware/auth.middleware.js#L4-L26))
     - Calls getAuth(req) to extract verified Clerk userId
     - Queries User.findOne({ clerkId: userId })
     - If not found: returns 404 ("User profile is not synced yet")
     - If found: attaches hydrated document to req.user
   - Controller: checkAuth ([auth.controller.js](file:///home/kafka/Coding/Web_Dev/Projects/Real%20Time%20Chat%20Application/Real-Time-Chat-Application/backend/src/controllers/auth.controller.js#L1-L7))
     - Returns res.status(200).json(req.user)
   │
   ▼
6. Client Session & Socket Activation
   - useAuthStore ([useAuthStore.js](file:///home/kafka/Coding/Web_Dev/Projects/Real%20Time%20Chat%20Application/Real-Time-Chat-Application/frontend/src/store/useAuthStore.js#L18-L20)) sets authUser: res.data
   - Calls connectSocket(res.data) passing authUser._id
   - Socket.io connects to server with query: { userId: user._id }
```

---

## 4. Clerk → TALK Identity Mapping

The boundary between Clerk and TALK is mediated by the MongoDB `users` collection and Clerk Svix webhooks.

| Property | Implementation Details | Code Reference |
| :--- | :--- | :--- |
| **Clerk Identifier** | String (e.g. `user_2...`) | Generated by Clerk Identity Platform |
| **TALK Storage Field** | `User.clerkId` | [`user.model.js`](file:///home/kafka/Coding/Web_Dev/Projects/Real%20Time%20Chat%20Application/Real-Time-Chat-Application/backend/src/models/user.model.js#L5-L9) |
| **Uniqueness & Index** | `unique: true`, indexed automatically by Mongoose | [`user.model.js`](file:///home/kafka/Coding/Web_Dev/Projects/Real%20Time%20Chat%20Application/Real-Time-Chat-Application/backend/src/models/user.model.js#L8) |
| **Creation Point** | `POST /api/webhooks/clerk` webhook handler | [`clerk.webhooks.js`](file:///home/kafka/Coding/Web_Dev/Projects/Real%20Time%20Chat%20Application/Real-Time-Chat-Application/backend/src/webhooks/clerk.webhooks.js#L36-L40) |
| **Trust Model (REST)** | Server-derived via `@clerk/express` `getAuth(req)` | Verified cryptographic JWT token |
| **Trust Model (Socket)** | Client-provided query param `socket.handshake.query.userId` | **Untrusted / Unverified** |
| **Client Exposure** | Filtered via `.select("-clerkId")` and `$project: { clerkId: 0 }` | Excluded from peer responses |

---

## 5. User Model Analysis

The Mongoose `User` schema (`backend/src/models/user.model.js`) contains:

```javascript
// backend/src/models/user.model.js
const userSchema = new mongoose.Schema({
    clerkId: { type: String, required: true, unique: true },
    email: { type: String, required: true, unique: true },
    fullName: { type: String, required: true },
    profilePic: { type: String, default: "" },
}, { timestamps: true });
```

### Detailed Field Breakdown
1. `_id` (`ObjectId`):
   - Primary key generated by MongoDB.
   - Used universally across the backend and frontend as the internal and external participant identifier for messages, conversations, and sockets.
2. `clerkId` (`String`):
   - External Clerk account ID.
   - PII-adjacent. Unique index. Never exposed to peer clients.
3. `email` (`String`):
   - User's primary email address from Clerk.
   - **PII**. Unique index. Stored in plaintext. Exposed in peer conversation view-models ([`useSelectedConversation.js:L35`](file:///home/kafka/Coding/Web_Dev/Projects/Real%20Time%20Chat%20Application/Real-Time-Chat-Application/frontend/src/hooks/useSelectedConversation.js#L35)).
4. `fullName` (`String`):
   - User's real name or derived username from Clerk.
   - **PII**. Exposed to all users via global discovery directory.
5. `profilePic` (`String`):
   - Avatar image URL (hosted on Clerk CDN or Gravatar).
6. `createdAt` / `updatedAt` (`Date`):
   - Managed automatically by Mongoose timestamps.

---

## 6. User Creation & Synchronization Flow

User creation is decoupled from REST API authentication:
1. When a user signs up on Clerk, Clerk issues a `user.created` event payload to `POST /api/webhooks/clerk`.
2. The endpoint verifies the Svix signature against `CLERK_WEBHOOK_SIGNING_SECRET` using `verifyWebhook()` ([`clerk.webhooks.js:L24`](file:///home/kafka/Coding/Web_Dev/Projects/Real%20Time%20Chat%20Application/Real-Time-Chat-Application/backend/src/webhooks/clerk.webhooks.js#L24)).
3. An upsert operation (`findOneAndUpdate` with `{ upsert: true }`) creates or updates the MongoDB `User` document.
4. **Race Condition Hazard**: If the user completes the client sign-in flow before Clerk's webhook reaches the backend server, the client's subsequent call to `GET /api/auth/check` will return `404 User profile is not synced yet`.

---

## 7. User Lookup Mechanisms

The codebase currently performs user lookups in four specific ways:

```text
┌────────────────────────┬─────────────────────────────┬───────────────────────────────────────────┬───────────────────────────────────────────┐
│ Input                  │ Function / Endpoint         │ Database Query                            │ Consumer                                  │
├────────────────────────┼─────────────────────────────┼───────────────────────────────────────────┼───────────────────────────────────────────┤
│ Clerk userId           │ protectRoute middleware     │ User.findOne({ clerkId: userId })         │ Attaches req.user to API requests         │
│ req.user._id           │ GET /api/messages/users     │ User.find({ _id: { $ne: loggedInUserId } })│ ChatSidebar "Users" tab (all users)       │
│ req.user._id           │ GET /api/messages/          │ Message.aggregate([ ... $lookup:          │ ChatSidebar "Chats" tab (active partners) │
│                        │   conversations             │   "users" ... ])                          │                                           │
│ Client search string   │ Frontend ChatSidebar.jsx    │ In-memory filter on peer.name             │ Client search field UI                    │
└────────────────────────┴─────────────────────────────┴───────────────────────────────────────────┴───────────────────────────────────────────┘
```

**Critical Discovery**: There is currently **no targeted lookup endpoint** (e.g. search by username, search by ID, or lookup by phone). The client downloads all platform users via `/api/messages/users` and filters them in browser memory.

---

## 8. Conversation Identity

TALK has **no `Conversation` collection** in MongoDB:
- 1-on-1 conversations are derived purely dynamically via a 6-stage aggregation pipeline on the `Message` collection (`backend/src/controllers/message.controller.js:L21-L68`).
- A conversation's identity is defined solely by the partner's MongoDB `User._id`.
- The frontend tracks active conversations using `activeConversationId` in `useChatStore`, which holds the peer's `_id`.

---

## 9. Message Identity

The `Message` schema (`backend/src/models/message.model.js`) directly links messages to MongoDB users:
- `senderId` (`ObjectId`, ref: `"User"`): Enforced on the backend via `req.user._id` (derived from authenticated Clerk session). Client input is ignored.
- `receiverId` (`ObjectId`, ref: `"User"`): Taken from route parameter `req.params.id`.
- `text` (`String`): Plaintext message content.
- `image` / `video` (`String`): ImageKit CDN URLs.
- `timestamps`: `createdAt` used for chronological sorting (`sort({ createdAt: 1 })`).

When a message is sent via `POST /api/messages/send/:id`:
1. Message document is created and saved to MongoDB.
2. Receiver socket is looked up via `getReceiverSocketId(receiverId)`.
3. If receiver is online, `io.to(receiverSocketId).emit("newMessage", newMessage)` dispatches the raw JSON message document.

---

## 10. Socket.io Identity & Presence Architecture

The Socket.io implementation resides in `backend/src/lib/socket.js`.

### Socket Lifecycle
```text
Client (useAuthStore.js)
  │
  ▼
io(BASE_URL, { query: { userId: user._id } })
  │
  ▼
Server Connection Listener (socket.js)
  │
  ├─► Reads socket.handshake.query.userId (UNAUTHENTICATED)
  ├─► Sets userSocketMap[userId] = socket.id
  └─► Broadcasts io.emit("getOnlineUsers", Object.keys(userSocketMap))
  │
Client Disconnect Listener
  │
  ├─► delete userSocketMap[userId]
  └─► Broadcasts io.emit("getOnlineUsers", Object.keys(userSocketMap))
```

### Critical Socket Limitations & Vulnerabilities:
1. **Unauthenticated Handshake**: Socket.io does not inspect Clerk JWT or session cookies. Anyone can pass an arbitrary `userId` query parameter and register as that user in `userSocketMap`.
2. **Single-Socket Assumption (`userId -> socketId`)**:
   - `userSocketMap` is a flat JavaScript object storing a single `socketId` string per `userId`.
   - If a user opens a second tab or logs in from a second device, the second socket overwrites the first in `userSocketMap`.
   - When the first tab closes, `delete userSocketMap[userId]` executes, immediately broadcasting that the user is offline, even though the second tab is still active.
   - Real-time messages are emitted only to `userSocketMap[receiverId]`, meaning only the latest connected tab receives live messages.

---

## 11. State Management & Frontend Identity

| Module | Identifier Used | Purpose |
| :--- | :--- | :--- |
| `useAuthStore.authUser` | MongoDB `User` object (`_id`, `fullName`, `email`, `profilePic`) | Represents current authenticated user |
| `useAuthStore.onlineUsers` | Array of MongoDB `_id` strings | Live presence indicator list |
| `useChatStore.selectedUser` | Peer MongoDB `User` object | Active chat partner |
| `useChatStore.activeConversationId` | Peer MongoDB `_id` string | Route/view active thread selector |
| `useSelectedConversation` | `String(message.senderId) === String(authUser?._id)` | Determines message bubble role (`"me"` vs `"them"`) |

---

## 12. Current PII Audit

The current TALK application collects and exposes the following PII:

```text
┌───────────────┬───────────────────────────┬─────────────────────────────────┬──────────────────────────────────┐
│ PII Element   │ Storage Location          │ Transmission Path               │ Exposure / Risk                  │
├───────────────┼───────────────────────────┼─────────────────────────────────┼──────────────────────────────────┤
│ Email         │ MongoDB User.email        │ REST API (/users, /auth/check)  │ Exposed in peer chat header      │
│ Full Name     │ MongoDB User.fullName     │ REST API, Socket messages       │ Listed globally to all users     │
│ Profile Photo │ MongoDB User.profilePic   │ REST API, Image CDN             │ Publicly accessible avatar       │
│ Clerk ID      │ MongoDB User.clerkId      │ Webhook, Auth Middleware        │ Protected (excluded from peers)  │
└───────────────┴───────────────────────────┴─────────────────────────────────┴──────────────────────────────────┘
```

---

## 13. Current Identity Assumptions (Conflicts with Feature 1)

1. **Assumption: Account Identity == Communication Identity**
   - *Current Code*: The Clerk account is directly synonymous with the messaging identity.
   - *Feature 1 Conflict*: Feature 1 introduces a cryptographic identity (keypair) that represents communication identity independently of external auth accounts.
2. **Assumption: User Identity == MongoDB `_id`**
   - *Current Code*: Routing, socket dispatch, and message sender/receiver foreign keys rely on MongoDB `_id`.
   - *Feature 1 Conflict*: In a PII-free/cryptographic system, peers should be discovered and referenced via public-key Connect IDs.
3. **Assumption: 1 User == 1 Device**
   - *Current Code*: The database and socket layer assume a single identity instance per user.
   - *Feature 1 Conflict*: Cryptographic private keys cannot leave the device. Therefore, one user account may own multiple devices, each holding an independent keypair.
4. **Assumption: 1 User == 1 Socket Connection**
   - *Current Code*: `userSocketMap = { [userId]: socketId }`.
   - *Feature 1 Conflict*: Multi-device messaging requires multi-socket message fanout (`Set<socketId>`).
5. **Assumption: Global User Directory is Acceptable**
   - *Current Code*: `/api/messages/users` dumps every user in the database.
   - *Feature 1 Conflict*: PII-free privacy requires selective contact discovery via shared Connect Codes / QR codes rather than global directory scraping.

---

## 14. Preliminary Security Review

```text
Finding 1: Unauthenticated Socket Handshake
Severity: High
Evidence: backend/src/lib/socket.js:L20 (const userId = socket.handshake.query.userId;)
Why it matters: An attacker can connect to Socket.io claiming any target user's ID, intercepting online status broadcasts and potentially hijacking real-time message delivery.
Future Mitigation: Validate Clerk session token in Socket.io connection middleware before registering socket.

Finding 2: Global User Directory Enumeration & PII Leakage
Severity: Medium
Evidence: backend/src/controllers/message.controller.js:L10-L12, frontend/src/hooks/useSelectedConversation.js:L35
Why it matters: Any authenticated user can scrape the entire user database, including full names and email addresses.
Future Mitigation: Replace open /users directory with targeted Connect ID search and remove email from peer presentation models.

Finding 3: Multi-Tab Disconnect Race Condition (DoS on Presence)
Severity: Low
Evidence: backend/src/lib/socket.js:L29 (delete userSocketMap[userId];)
Why it matters: Closing one tab drops presence and live message delivery for all other open tabs of that user.
Future Mitigation: Implement userSocketMap with Set<socketId> and only mark offline when set is empty.
```

---

## 15. Future Cryptographic Architecture & Integration Boundary

Feature 1 will establish a clean separation between **Account Authentication** (Clerk) and **Communication Identity** (TALK Cryptographic Layer).

```text
                           TALK ACCOUNT (Clerk)
                                   │
                                   ▼
                           Account Identity
                     (Sync via Webhook / Session)
                                   │
                    ┌──────────────┴──────────────┐
                    ▼                             ▼
             Device A (Browser 1)          Device B (Browser 2)
                    │                             │
             IndexedDB Storage             IndexedDB Storage
             (Private Key - NEVER leaves)  (Private Key - NEVER leaves)
                    │                             │
             Public Key A                  Public Key B
                    │                             │
                    └──────────────┬──────────────┘
                                   ▼
                       Server Identity Registry
                   (Stores Public Keys & Connect IDs)
                                   │
                                   ▼
                              Connect ID
                         (`TALK-XXXX-XXXX-XXXX`)
```

### Open Architectural Decisions (To Be Resolved in Phase 1 & 2):
- **OAD-1 (Key Derivation Algorithm)**: Whether to use X25519 for combined identity/Diffie-Hellman or Ed25519 for signing + X25519 for key agreement.
- **OAD-2 (Connect Code Encoding)**: Public key hashing algorithm (SHA-256 vs BLAKE2b), Base32 truncation length (e.g. 8 bytes -> 12-16 characters), and checksum inclusion.
- **OAD-3 (Multi-Device Identity Binding)**: How secondary devices prove ownership of an account identity without exposing private keys across devices.

---

## 16. What to Understand Before Phase 1 (Learning Checklist)

Before beginning **Phase 1 (Cryptographic Identity Foundation)**, ensure deep understanding of:
- [x] Web Crypto API (`SubtleCrypto`) vs pure JS crypto libraries (`tweetnacl`, `noble-curves`).
- [x] Why private keys must reside in `IndexedDB` and never in `localStorage` (XSS vulnerability surface).
- [x] Asymmetric keypair generation mechanics (Private scalar vs Public curve point).
- [x] Key serialization standards (Raw bytes, PKCS#8, SPKI, JWK).
- [x] Idempotent client-side identity initialization lifecycle in React SPAs.

---

## 17. Phase 0 Implementation Confirmation

```text
Phase 0 implementation status:

NO Feature 1 production functionality was implemented.

No:
- cryptographic keys
- Connect IDs
- database identity fields
- identity APIs
- UI components
- socket protocol changes
- authentication changes
- encryption
- device registration

were implemented during Phase 0. All work was strictly analytical, observational, and documentational.
```
