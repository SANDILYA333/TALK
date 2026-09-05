# Code Standards

## General

- **Separation of Concerns**: Keep modules single-purpose. Handlers in controllers handle HTTP requests/responses, models define database schemas, middleware handles cross-cutting concerns (auth, upload), and Zustand stores manage client state.
- **Root-Cause Fixes**: Resolve bugs at their architectural origin rather than applying patching workarounds or masking null checks downstream.
- **Defensive Input Handling**: Never trust client input. Validate route parameters (`req.params.id`), body contents, and query strings before executing database queries or external API calls.
- **Consistent Error Handling**: Use `try/catch` blocks in all async Express controller functions and return standard HTTP status codes with informative JSON error payloads (`{ message: string }`).

## JavaScript & Node.js (ESM)

- **Native ES Modules**: The codebase uses Node.js ESM (`"type": "module"` in `package.json`). Always use explicit file extensions (`.js`) on local module imports in backend code.
- **Async/Await Pattern**: Prefer `async/await` over raw promise `.then()/.catch()` chains. Always handle errors cleanly with `try/catch`.
- **Environment Configuration**: Access environment variables through `process.env` after importing `"dotenv/config"`. Guard required variables (e.g. `MONGO_URI`, `CLERK_SECRET_KEY`) with explicit checks and helpful startup error messages.
- **No Console Clutter**: Avoid indiscriminate `console.log` in production execution paths. Use structured logging or prefix `console.error` with the component/controller context (e.g. `console.error("Error in sendMessage:", error.message)`).

## Frontend Architecture (React 19 + Vite)

- **Component Granularity**: Separate view containers (`pages/`) from modular UI components (`components/chat/`, `components/auth/`). Components should remain under 150 lines where possible.
- **Zustand State Access**: Prefer granular selector hooks over whole-store destructuring to prevent unnecessary component re-renders:
  ```javascript
  // Recommended
  const activeConversationId = useChatStore((state) => state.activeConversationId);
  // Avoid
  const { activeConversationId, messages, users } = useChatStore();
  ```
- **View-Model Adapters**: Use dedicated adapter hooks (such as `useSelectedConversation`) to transform raw backend models into clean view-models consumed by UI presentation components.
- **Media Query Synchronization**: Subscribe to browser media queries using `useSyncExternalStore` (as in `useMediaQuery.js`) for SSR-safe and tear-free responsive state.
- **Audio Management**: Wrap all Web Audio / HTMLAudioElement playback in error catch handlers to avoid breaking UI interactions when browser autoplay policies block audio.

## Styling & Design System

- **Tailwind CSS v4 & HeroUI v3 Tokens**: Style components using standard Tailwind utility classes and HeroUI component variants. Avoid hardcoded hex colors; use semantic CSS tokens (`text-foreground`, `text-muted`, `bg-surface`, `border-border`, `text-accent`).
- **Dynamic Accent Theme Presets**: HeroUI accents are driven dynamically by `data-theme-preset` attributes on `<html>` and defined in `heroui-theme-presets.css`. All accent-colored UI elements must use the `bg-accent`, `text-accent`, or `text-accent-foreground` classes.
- **Dark Mode Support**: Use Tailwind's `dark:` modifier in tandem with the custom dark variant registered in `index.css` that respects both system preferences and explicit `[data-theme="dark"]` overrides.
- **Responsive Layouts**: Design mobile-first. Chat viewports must fit `100dvh` (`h-dvh`) with `overflow-hidden` container shells to prevent double-scrollbar behavior on mobile devices.

## API Routes & Controllers

- **Route Registration**: Mount route sub-routers cleanly in `index.js` under `/api/<resource>`.
- **Middleware Stacking**: Protect sensitive endpoints by applying `protectRoute` at the router level (`router.use(protectRoute)`) or route level.
- **Standardized Response Shapes**:
  - Success: `res.status(200).json(data)` or `res.status(201).json(createdResource)`
  - Client Error: `res.status(400).json({ message: "Descriptive error message" })`
  - Unauthorized: `res.status(401).json({ message: "Unauthorized" })`
  - Not Found: `res.status(404).json({ message: "Resource not found" })`
  - Server Error: `res.status(500).json({ message: "Internal server error" })`
- **Controller Purity**: Controllers should not manage raw socket connection state directly; import clean helper functions (e.g. `getReceiverSocketId`, `io`) from `src/lib/socket.js`.

## Data & Storage

- **Mongoose Schema Hygiene**:
  - Always enable `{ timestamps: true }` on collections to track `createdAt` and `updatedAt`.
  - Use Mongoose `ObjectId` types with explicit `ref: "User"` for relational references.
  - Define explicit `unique: true` indexes on unique identifiers (`clerkId`, `email`).
- **Sensitive Field Projection**: Always exclude sensitive properties (e.g. `clerkId`) when returning user documents to other users (`.select("-clerkId")` or `$project: { clerkId: 0 }`).
- **External Blob Storage**: Large binary payloads (images, videos) must never be stored directly in MongoDB (e.g., as base64 strings). Always upload to ImageKit and store the returned CDN URL string.

## Real-Time Communication (Socket.io)

- **Event Naming Conventions**: Use camelCase for socket events (`newMessage`, `getOnlineUsers`).
- **Socket Authentication**: Socket connections must authenticate against a verified user session (via Clerk JWT) rather than blindly trusting handshake query strings.
- **Connection Lifecycle Management**:
  - Track connected sockets per user without dropping other active tabs/sessions.
  - Disconnect handlers must clean up socket entries and broadcast presence updates.
- **Persistence First, Real-Time Second**: Messages must be saved and confirmed in MongoDB before emitting real-time socket events to recipients. Real-time emission failure must not roll back or corrupt persistent storage.

## File Organization

```
/
├── backend/
│   ├── src/
│   │   ├── controllers/     # Express route handler functions
│   │   ├── lib/             # Shared DB, Socket, ImageKit, Cron instances
│   │   ├── middleware/      # Auth (Clerk) and Upload (Multer) middleware
│   │   ├── models/          # Mongoose database models (User, Message)
│   │   ├── routes/          # Express route definitions (auth, message)
│   │   ├── seeds/           # Database seed scripts
│   │   ├── webhooks/        # Webhook ingestion handlers (Clerk)
│   │   └── index.js         # Backend server entry point
│   ├── package.json
│   └── .env
│
├── frontend/
│   ├── src/
│   │   ├── components/      # Shared and feature UI components
│   │   │   ├── auth/        # Login/auth page components
│   │   │   └── chat/        # Messaging, sidebar, and composer components
│   │   ├── context/         # Theme and Wallpaper React context providers
│   │   ├── data/            # Static presets, themes, and wallpaper lists
│   │   ├── hooks/           # Custom React hooks (useSelectedConversation, etc.)
│   │   ├── lib/             # Axios, ImageKit utils, timestamp formatting
│   │   ├── pages/           # Top-level route pages (AuthPage, ChatPage)
│   │   ├── store/           # Zustand global stores (useAuthStore, useChatStore)
│   │   ├── styles/          # Custom CSS stylesheets and theme presets
│   │   ├── App.jsx          # App root component with routing & auth gating
│   │   ├── index.css        # Global CSS imports and custom dark mode variant
│   │   └── main.jsx         # Vite entry point
│   ├── public/              # Static assets (sounds, wallpapers, logo, auth graphics)
│   ├── package.json
│   └── vite.config.js
│
├── Plan/                    # Project context and living documentation
│   ├── ai-workflow-rules.md # Operational protocol for AI assistants
│   ├── architecture.md      # System architecture and boundary specs
│   ├── code-standards.md    # Engineering and styling guidelines
│   ├── progress-tracker.md  # Implementation roadmap and status tracker
│   └── project-overview.md  # Product specification and goals
│
├── Dockerfile               # Multi-stage production container build
├── README.md                # Project documentation
└── additional-features.md   # Next-level feature roadmap (E2E, WebRTC, etc.)
```
