# TALK — Project Overview

## Overview

**TALK** is a modern, full-stack real-time direct messaging application built on the MERN stack (MongoDB, Express, React, Node.js) supplemented with Socket.io, Clerk Authentication, and ImageKit CDN media storage. It provides instant peer-to-peer 1-on-1 text and rich-media conversations, live presence detection, and an Apple iMessage-inspired user experience featuring dynamic themes, custom wallpaper backdrops, and keystroke audio feedback. TALK solves the friction of clunky web chat interfaces by offering a lightweight, responsive, and visually refined communication environment optimized for desktop and mobile web browsers.

## Goals

1. **Sub-100ms Real-Time Delivery**: Deliver messages instantly to active peer connections over persistent WebSockets with graceful fallback to HTTP persistence.
2. **Seamless Zero-Friction Authentication**: Authenticate users securely via Clerk OAuth/credentials, with instantaneous session hydration and automatic profile synchronization to MongoDB.
3. **High-Fidelity Rich Media Sharing**: Support image and video uploads up to 25MB with on-the-fly CDN transformation and compression for immediate viewing across all bandwidth conditions.
4. **Delightful, Customizable User Experience**: Provide fluid responsive navigation, customizable visual aesthetics (11 color presets + 13 wallpapers), sound effects, and smooth keyboard-first interactions.
5. **Architectural Readiness for Privacy & Scalability**: Establish clean service boundaries and robust data modeling that pave the way for End-to-End (E2E) encryption, message auto-deletion, and distributed socket clustering.

## Core User Flow

1. **Landing & Authentication**:
   - An unauthenticated user lands on `/auth`, seeing the branded welcome interface, visual backdrop, and security highlights.
   - The user clicks **Continue** to open the Clerk modal and signs in via OAuth (e.g. Google) or email credentials.
   - Clerk processes the authentication and issues a session token. Simultaneously, Clerk's webhook triggers a server-side synchronization event saving or updating the user's profile (`clerkId`, `fullName`, `email`, `profilePic`) in MongoDB.
2. **Session Initialization & Socket Connection**:
   - The user is redirected to `/`, triggering `App.jsx` to load and verify the session via `/api/auth/check`.
   - Once verified, `useAuthStore` establishes a persistent Socket.io connection to the backend, broadcasting the user's online presence to all connected clients.
3. **Discovering Contacts & Existing Conversations**:
   - `ChatPage` mounts and fetches the user's existing conversation threads (`/api/messages/conversations`) and all platform users (`/api/messages/users`).
   - The user browses the sidebar, toggles between "Chats" and "Users" tabs, or filters contacts using the real-time search field.
4. **Engaging in a Conversation**:
   - The user selects a contact from the list. The chat pane opens, loading conversation message history (`/api/messages/:id`) and scrolling automatically to the latest message.
   - Live online/offline status indicators update dynamically based on the contact's socket presence.
5. **Sending & Receiving Real-Time Messages**:
   - The user types a text message or attaches an image/video via the media upload button.
   - Pressing `Enter` or clicking **Send** dispatches an HTTP POST request (`/api/messages/send/:id`) with optional Multer multipart payload.
   - The backend stores the message document in MongoDB, forwards media to ImageKit (if attached), and emits a `newMessage` event via Socket.io directly to the recipient's socket ID.
   - The recipient's UI receives the socket event and appends the message bubble immediately; the sender's UI updates optimistically upon HTTP completion.
6. **Customizing the Environment**:
   - At any time, the user can toggle between Light and Dark mode, select an Accent Color preset from the Palette picker, change the wallpaper backdrop from the Backdrop picker, or mute keyboard typing sounds.

## Features

### 1. Authentication & Identity Management
- **User Experience**: One-click authentication with social logins or email, user profile avatars, and session persistence across browser reloads.
- **System Behavior**: Clerk SDK manages JWT verification and session cookies; backend receives raw webhook payloads verified with `@clerk/backend/webhooks` to keep MongoDB user collections synchronized.
- **Dependencies**: `@clerk/react`, `@clerk/express`, `@clerk/backend`, Mongoose `User` model.
- **Constraints**: Requires valid Clerk API keys and webhook signing secret. New accounts depend on webhook delivery or prior database seeding.

### 2. Real-Time 1-on-1 Direct Messaging
- **User Experience**: Instant transmission and receipt of text messages with automatic chronological sorting, timestamp formatting, and auto-scroll to the latest bubble.
- **System Behavior**: Messages are posted via REST API, saved to MongoDB with foreign keys to sender and receiver, and emitted across active WebSockets via `io.to(recipientSocketId)`.
- **Dependencies**: `socket.io`, `socket.io-client`, Express, Mongoose `Message` model.
- **Constraints**: Unbounded message fetching currently loads entire conversation history; single-instance memory socket map limits multi-tab or distributed scaling.

### 3. Rich Media Upload & ImageKit CDN Delivery
- **User Experience**: Users can attach images and videos directly from the chat input. Images render inline with rounded corners; videos include playback controls and auto-generated poster thumbnails.
- **System Behavior**: Multer intercepts multipart form data in server memory; `@imagekit/nodejs` uploads files to ImageKit storage and returns CDN URLs; client applies on-the-fly URL transformation parameters (`q-auto,w-640,f-auto`).
- **Dependencies**: `multer`, `@imagekit/nodejs`, ImageKit CDN, `frontend/src/lib/imagekit.js`.
- **Constraints**: File size capped at 25MB per upload; supports `image/*` and `video/*` MIME types only.

### 4. Real-Time Presence & Status Tracking
- **User Experience**: Green badge indicator and status text ("Online" / "Offline") update live on avatars across sidebar conversation rows and chat header.
- **System Behavior**: Backend maintains connected user IDs in memory and broadcasts `getOnlineUsers` array to all clients whenever a socket connects or disconnects.
- **Dependencies**: Socket.io server and client listeners in `useAuthStore`.
- **Constraints**: Reconnecting or refreshing tabs can trigger transient online/offline flaps due to single socketId mapping per userId.

### 5. UI Customization & Audio Feedback
- **User Experience**:
  - Light/Dark mode with system preference auto-detection.
  - 11 Accent Color themes (Default, Sky, Lavender, Mint, Netflix, Uber, Spotify, Coinbase, Airbnb, Discord, Rabbit).
  - 13 High-resolution desktop and abstract backdrop wallpapers.
  - Realistic keyboard typing sounds played dynamically as users type in the composer.
- **System Behavior**: Theme and wallpaper preferences persist in browser `localStorage` and modify CSS variables on `<html>` / container background inline styles.
- **Dependencies**: `@heroui/react`, `@heroui/styles`, Tailwind CSS v4, `ThemeContext.jsx`, `WallpaperContext.jsx`, Web Audio API / HTMLAudioElement.
- **Constraints**: Visual customizations are stored on the local client device and not synced across multiple devices.

### 6. Responsive Mobile-First Navigation
- **User Experience**: On mobile/tablet screens (<1024px), selecting a conversation slides into full-screen chat mode with a back button; on desktop (>=1024px), sidebar and chat pane display side-by-side.
- **System Behavior**: React hook `useMediaQuery` tracks viewport width and dynamically toggles CSS visibility classes.
- **Dependencies**: `useMediaQuery.js`, React state.
- **Constraints**: Relies on browser `matchMedia` listener.

## Scope

### In Scope
- Secure 1-on-1 direct messaging between authenticated users.
- Live real-time message delivery and online presence status via Socket.io.
- Image and video attachments with CDN optimization.
- Sidebar search and conversation filtering.
- Client-side visual themes, backdrop selection, and typing sounds.
- Mobile and desktop responsive layouts.
- Monolithic Docker deployment supporting unified container execution on Render.

### Out of Scope
- Group messaging / multi-user chat rooms (planned for future phases).
- End-to-End Encryption (E2E) with Double Ratchet / Signal protocol (scoped for Phase 3).
- WebRTC Peer-to-Peer Voice and Video calling.
- Message reactions, message edits, and message deletion (soft/hard delete).
- Read receipts ("seen" / "delivered" checkmarks) and real-time typing indicators.
- Offline-first mesh messaging (Bluetooth / local network transport).
- Web push notifications via Service Workers.

## Success Criteria

1. **Authentication & Session**: A user can register/sign in through Clerk and have their profile reflected immediately in the application without authorization errors.
2. **Real-Time Delivery**: A message sent from User A appears in User B's active chat window within 100ms without manual page refresh.
3. **Presence Detection**: When User B opens or closes the application, User A's contact list reflects User B's online/offline status in real time.
4. **Media Sharing**: A user can upload an image or video under 25MB, see an upload spinner, and have the optimized media rendered in both participants' chat streams.
5. **Persistence**: Reloading the browser maintains the user's session, recent conversations, chat history, and chosen visual theme/wallpaper settings.
6. **Responsive UX**: The UI adapts seamlessly from mobile screens (<=640px) to wide desktop monitors (>=1280px) without broken layout elements or horizontal overflow.
