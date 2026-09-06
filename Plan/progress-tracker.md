# Progress Tracker

Update this file after every meaningful implementation change.

## Current Phase

- **Feature 1 (Public-Key Connect ID) — Phase 1: Cryptographic Identity Foundation Complete**
- **Next: Feature 1 — Phase 2: Connect ID Generation**

## Current Goal

- Transform the client-side cryptographic identity into a human-shareable, privacy-preserving Connect ID (`TALK-XXXX-XXXX` format) with deterministic hashing, Base32 encoding, and validation rules.

## Completed

- **Feature 1 — Phase 1: Cryptographic Identity Foundation**:
  - Implemented isolated, dependency-free Web Crypto `X25519` keypair generation in [`frontend/src/lib/crypto/keypair.js`](file:///home/kafka/Coding/Web_Dev/Projects/Real%20Time%20Chat%20Application/Real-Time-Chat-Application/frontend/src/lib/crypto/keypair.js).
  - Implemented canonical public-key serialization (32-byte raw Uint8Array, 64-character lowercase hex, and Base64) with deterministic format validation.
  - Implemented secure local persistence in IndexedDB (`talk_crypto_db` / `identity_keys`) with PKCS#8 DER private key serialization and in-memory test fallback ([`frontend/src/lib/crypto/storage.js`](file:///home/kafka/Coding/Web_Dev/Projects/Real%20Time%20Chat%20Application/Real-Time-Chat-Application/frontend/src/lib/crypto/storage.js)).
  - Implemented idempotent device identity manager [`frontend/src/lib/crypto/identity.js`](file:///home/kafka/Coding/Web_Dev/Projects/Real%20Time%20Chat%20Application/Real-Time-Chat-Application/frontend/src/lib/crypto/identity.js) (`getOrCreateDeviceIdentity`).
  - Added 13 unit tests via `node:test` covering generation, uniqueness, Diffie-Hellman consistency, serialization round-trips, invalid key rejection, and persistence idempotence ([`frontend/src/lib/crypto/__tests__/identity.test.js`](file:///home/kafka/Coding/Web_Dev/Projects/Real%20Time%20Chat%20Application/Real-Time-Chat-Application/frontend/src/lib/crypto/__tests__/identity.test.js)).
  - Created ADR-001 ([`Learning/12-architecture-decisions/ADR-001-x25519-identity-keypair.md`](file:///home/kafka/Coding/Web_Dev/Projects/Real%20Time%20Chat%20Application/Real-Time-Chat-Application/Learning/12-architecture-decisions/ADR-001-x25519-identity-keypair.md)) and conceptual learning documentation in `Learning/05-cryptography/` and `Learning/04-databases-storage/`.


- **Feature 1 — Phase 0: Reconnaissance & Architecture Lock**:
  - Executed comprehensive identity reconnaissance across backend, frontend, database, and socket layers ([`Learning/13-feature-learning/connect-id.md`](file:///home/kafka/Coding/Web_Dev/Projects/Real%20Time%20Chat%20Application/Real-Time-Chat-Application/Learning/13-feature-learning/connect-id.md)).
  - Audited Clerk-to-MongoDB synchronization, Webhook Svix verification, and `req.user` hydration.
  - Identified core architectural assumptions (1 user = 1 socket, 1 user = 1 device, user identity = MongoDB `_id`).
  - Audited PII exposure vectors (`User.email` in conversation subtitles, global directory enumeration on `/api/messages/users`).
  - Audited Socket.io trust boundaries (unauthenticated query `userId`, flat `userSocketMap` multi-tab race condition).
  - Defined the future integration boundary between Clerk account authentication and cryptographic communication identity.

- **Core Full-Stack Infrastructure**:
  - Express 5 ESM backend configured with CORS, dotenv, and MongoDB Atlas connectivity via Mongoose (`backend/src/index.js`, `backend/src/lib/db.js`).
  - Vite + React 19 SPA frontend with Tailwind CSS v4, HeroUI v3 component suite, and Lucide icons (`frontend/package.json`, `frontend/vite.config.js`).
- **Authentication & User Synchronization**:
  - Clerk authentication integration on frontend (`@clerk/react` `ClerkProvider`, `useAuth`, `useClerk`, `UserButton`).
  - Backend auth middleware with `@clerk/express` `clerkMiddleware` and `protectRoute` inspecting Clerk session tokens.
  - Webhook listener (`/api/webhooks/clerk`) utilizing `@clerk/backend/webhooks` signature verification to synchronize `user.created`, `user.updated`, and `user.deleted` events into MongoDB `User` model.
  - Auth route `/api/auth/check` returning sanitized database user profile.
- **Direct Messaging & Chat Persistence**:
  - MongoDB `Message` model storing `senderId`, `receiverId`, `text`, `image`, and `video` timestamps.
  - MongoDB aggregation pipeline in `getConversationsForSidebar` grouping chat partners by latest message timestamp and joining profile details.
  - Direct message retrieval `/api/messages/:id` and sending `/api/messages/send/:id`.
- **Real-Time Communication (Socket.io)**:
  - Socket.io server integrated with HTTP server (`backend/src/lib/socket.js`).
  - Real-time user online/offline presence tracking broadcasting `getOnlineUsers` on connection/disconnection.
  - Instant direct message forwarding via `io.to(receiverSocketId).emit("newMessage", newMessage)`.
- **Media Handling & CDN Optimization**:
  - Multer memory storage middleware (`upload.middleware.js`) supporting image/video formats up to 25MB.
  - Server-side ImageKit integration (`backend/src/lib/imagekit.js`) for authenticated uploads into `/chat` folder.
  - Frontend dynamic URL transformation utilities (`frontend/src/lib/imagekit.js`) generating responsive, compressed image (`q-auto,w-640,f-auto`) and video (`q-80,w-640`) assets with thumbnail poster generation.
- **Client State & Design System**:
  - Zustand stores (`useAuthStore`, `useChatStore`) managing auth, socket lifecycle, conversation lists, message state, and local persistence.
  - Light/Dark theme toggle with DOM synchronization (`ThemeContext.jsx`).
  - 11 Accent color presets (Sky, Lavender, Mint, Netflix, Uber, Spotify, Coinbase, Airbnb, Discord, Rabbit, Default) dynamically modifying CSS variables (`heroui-theme-presets.css`).
  - 13 Custom desktop and abstract wallpaper backdrops with live preview modal (`WallpaperPicker.jsx`, `wallpapers.js`).
  - Interactive keyboard sound feedback system with randomized audio assets (`useKeyboardSound.js`).
  - Responsive layout switching between sidebar conversation list and active chat view on mobile screens (`useMediaQuery.js`).
- **Learning & Knowledge-Base Infrastructure**:
  - Initialized structured 14-track `Learning/` directory layout ([`Learning/README.md`](file:///home/kafka/Coding/Web_Dev/Projects/Real%20Time%20Chat%20Application/Real-Time-Chat-Application/Learning/README.md)).
  - Established standardized 16-point learning document framework, Architecture Decision Record (`ADR-XXX`) templates, and feature journal requirements.
  - Linked engineering knowledge capture requirements into [`Plan/ai-workflow-rules.md`](file:///home/kafka/Coding/Web_Dev/Projects/Real%20Time%20Chat%20Application/Real-Time-Chat-Application/Plan/ai-workflow-rules.md).
- **Developer Experience & Tooling**:
  - Docker multi-stage containerization (`Dockerfile`) packaging Vite static build into Express production runtime.
  - Database seeding utility (`backend/src/seeds/user.seed.js`) generating 20 mock users with avatars.
  - Keep-alive cron task (`backend/src/lib/cron.js`) pinging health endpoint every 14 minutes for free-tier hosting.


## In Progress

- **Context Initialization & Codebase Hardening Audit**:
  - Reconciling discrepancies between documentation and actual implementation (e.g. client/server folder names, port mismatches, API base URL configuration).
  - Comprehensive architectural and security analysis of socket trust boundaries, identity propagation, and data lifecycle.

## Next Up

1. **Socket Handshake Security & Authentication**:
   - Replace unauthenticated `query.userId` with Clerk session token verification in Socket.io connection middleware.
2. **Multi-Session & Multi-Tab Socket Routing**:
   - Refactor `userSocketMap` from `userId -> socketId` (string) to `userId -> Set<socketId>` to prevent multi-device / multi-tab disconnect race conditions.
3. **Global Real-Time Message Dispatch & Unread Tracking**:
   - Update frontend socket subscription so messages from non-active conversations update sidebar badge/ordering rather than being dropped.
4. **Input Validation & Payload Sanitization**:
   - Implement backend schema validation (Zod) on `sendMessage` (disallowing empty text + no media, validating ObjectId params, sanitizing text input).
5. **Cursor-Based Message Pagination**:
   - Introduce `limit` and `before` cursor queries to `/api/messages/:id` to prevent memory overload on long conversation histories.
6. **Environment Variable Hygiene & Secret Rotation**:
   - Audit and sanitize `.env` files, remove hardcoded test API keys from repository tracking, and standardize port variables across client and server.

## Open Questions

- **Q1: Webhook Latency vs JIT Auth Provisioning**:
  - *Context*: If a newly registered user logs in before the Clerk webhook finishes executing, `protectRoute` returns 404 "User profile is not synced yet".
  - *Decision Required*: Should `protectRoute` or `checkAuth` perform on-demand Just-In-Time (JIT) provisioning from Clerk SDK if the database record is missing?
- **Q2: Media Lifecycle & Orphaned Blob Cleanup**:
  - *Context*: When messages or users are deleted, uploaded files in ImageKit remain stored indefinitely.
  - *Decision Required*: Should an asynchronous background job or webhook handler call ImageKit deletion APIs when messages/users are purged?
- **Q3: E2E Cryptographic Migration Strategy**:
  - *Context*: `additional-features.md` proposes Public-Key Connect IDs and Double Ratchet E2E encryption.
  - *Decision Required*: How will MongoDB schema evolve to store encrypted envelopes without breaking existing plaintext conversation records?
- **Q4: Real-Time Typing Indicators & Delivery Receipts**:
  - *Context*: The current Socket.io implementation only handles `newMessage` and `getOnlineUsers`.
  - *Decision Required*: Should `typing_start`, `typing_stop`, and `message_read` status receipts be standardized prior to or alongside E2E encryption?

## Architecture Decisions

- **AD-01: Clerk Identity Provider with Relational MongoDB Mirror**
  - *Decision*: Offload authentication, OAuth providers, and credentials to Clerk while mirroring essential user metadata (`clerkId`, `email`, `fullName`, `profilePic`) into MongoDB `User` collection via webhooks.
  - *Rationale*: Eliminates password management vulnerabilities while allowing fast native Mongoose joins and aggregations for chat threads.
  - *Impact*: Requires webhook synchronization integrity and careful handling of dual identifiers (`clerkId` vs MongoDB `_id`).
- **AD-02: Server-Proxied Media Pipeline to ImageKit**
  - *Decision*: Client uploads media buffers to Express endpoint via Multer memory storage; Express securely transmits to ImageKit via server SDK and persists the resulting CDN URL.
  - *Rationale*: Keeps ImageKit private API keys hidden from client bundles while enabling server-side MIME type filtering and size validation.
  - *Impact*: Server memory temporarily holds file payloads up to 25MB; requires memory management under high concurrency.
- **AD-03: Dynamic Aggregation-Based Conversation Threading**
  - *Decision*: Derive conversation lists dynamically via MongoDB aggregation over the `Message` collection rather than maintaining a separate `Conversation` state document.
  - *Rationale*: Avoids distributed state desynchronization between conversations and messages for 1-on-1 direct messaging.
  - *Impact*: Simplifies 1-on-1 chat creation; requires indexing on `{ senderId: 1, receiverId: 1, createdAt: -1 }` to maintain performance as volume scales.
- **AD-04: In-Memory Single-Node Socket Registry**
  - *Decision*: Maintain online user tracking in a transient in-memory dictionary `userSocketMap = { userId: socketId }`.
  - *Rationale*: Zero external dependencies (no Redis needed for MVP development).
  - *Impact*: Restricts scaling to single backend instance; susceptible to state loss during multi-tab usage or server restarts.

## Session Notes

- Completed deep repository reconnaissance across `backend/` and `frontend/`.
- Validated Vite frontend production build (`npm run build` completed cleanly, generating SPA assets in `frontend/dist`).
- Validated Backend build script (`npm run build` successfully copies `src/` to `dist/`).
- Identified architectural nuances: Express 5 routing syntax (`app.get("/{*any}")`), dynamic CSS variables for theme presets, and Zustand selector patterns.
