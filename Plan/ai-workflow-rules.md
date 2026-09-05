# AI Workflow Rules

## Approach

Develop and evolve the **TALK** codebase incrementally using a strict, spec-driven workflow. The five context files in the `Plan/` directory (`project-overview.md`, `architecture.md`, `code-standards.md`, `progress-tracker.md`, and `ai-workflow-rules.md`) serve as the living source of truth for all requirements, architecture constraints, and implementation status. 

Every AI coding session must:
1. **Inspect before changing**: Verify the actual filesystem, code structure, and active dependencies before proposing or writing modifications.
2. **Implement against the specs**: Adhere strictly to the defined stack (React 19, Express 5, Mongoose, Socket.io, HeroUI, Tailwind v4). Do not introduce unauthorized libraries or alternative frameworks.
3. **Execute in atomic feature units**: Limit code modifications to one cohesive, verifiable unit at a time.
4. **Verify changes immediately**: Test builds and runtime behavior after every implementation step.
5. **Synchronize documentation**: Update `progress-tracker.md` and related context files immediately upon completing any meaningful unit of work.

## Scoping Rules

- **Single Feature Unit**: Work on one isolated capability per step (e.g., "Socket handshake token verification" OR "Message cursor pagination", never both in one step).
- **Verifiable Increments**: Every step must leave the repository in a working, deployable state where both frontend and backend builds pass.
- **Respect System Boundaries**: Do not blend frontend UI redesigns with database schema migrations in the same prompt cycle unless an explicit schema contract requires coordinated updates.

## When to Split Work

An implementation step **must** be split into multiple smaller sub-tasks if it combines:
- Database schema changes (e.g. migrating `Message` model) and client-side UI rendering.
- Real-time Socket.io protocol adjustments and REST API route modifications.
- External service integrations (e.g., ImageKit, Clerk webhooks) and local UI logic.
- Complex security overhauls (e.g., Double Ratchet encryption) and view layout components.

*Rule of thumb*: If a change cannot be verified end-to-end within 5 minutes or spans more than 3 distinct architectural layers (e.g. Model + Middleware + Controller + Store + Component), split it into separate phases.

## Handling Missing Requirements

- **Never Invent Behavior Silently**: If product requirements, error fallbacks, or data retention rules are ambiguous, do not make arbitrary assumptions.
- **Log in Open Questions**: Record the unresolved item in the `Open Questions` section of `Plan/progress-tracker.md`.
- **Adopt Minimal Safe Defaults**: If progress is blocked, make the smallest, non-breaking, most defensive choice and document it explicitly in `progress-tracker.md` under `Architecture Decisions`.

## Protected Files & Sensitive Areas

Exercise extreme caution and obtain clear context before modifying:
- `backend/src/webhooks/clerk.webhooks.js` — Modifying signature verification or raw body parsing can break user provisioning and lock out authentication.
- `backend/src/lib/db.js` & `backend/src/lib/socket.js` — Core infrastructure lifecycles; improper connection logic can crash the HTTP server or orphan sockets.
- `Dockerfile` — Multi-stage build configuration tuned for production deployment on Render; changes must preserve asset copying and port binding.
- `frontend/src/index.css` & `frontend/src/styles/heroui-theme-presets.css` — Contains custom Tailwind v4 `@custom-variant dark` overrides and CSS variable tokens critical for theme presets.

## Keeping Docs in Sync

Whenever code changes impact any of the following, update the corresponding `Plan/` documentation immediately:
- **Architecture changes** (e.g. new middleware, service integrations) $\rightarrow$ `Plan/architecture.md`
- **New API endpoints or schemas** $\rightarrow$ `Plan/architecture.md` & `Plan/code-standards.md`
- **Completed features or new backlog items** $\rightarrow$ `Plan/progress-tracker.md`
- **Product scope additions or exclusions** $\rightarrow$ `Plan/project-overview.md`
- **New styling or coding conventions** $\rightarrow$ `Plan/code-standards.md`

## Learning Knowledge Base Integration

The `Learning/` directory is TALK's living engineering knowledge base, answering **"What am I learning while building it, why does it matter, and how does it actually work inside TALK?"**

- **Mandatory Creation Rule**: Any implementation introducing a meaningful new engineering concept, architectural pattern, security mechanism, cryptographic primitive/protocol, networking mechanism, storage mechanism, or infrastructure decision must create or update the corresponding documentation under `Learning/`.
- **Content Requirements**: Every learning document must include:
  1. Concrete references to actual TALK source files, models, functions, or middleware.
  2. The underlying engineering rationale for why the concept is needed in TALK.
  3. Alternatives considered and explicit trade-offs accepted.
  4. Security implications (Asset $\rightarrow$ Threat $\rightarrow$ Attack $\rightarrow$ Mitigation $\rightarrow$ Residual risk).
  5. Failure modes, edge cases, and debugging lessons.
  6. Core takeaways and interview defense questions.
- **Architectural Decisions**: Whenever a decision materially impacts architecture, cryptography, security, data modeling, or networking, create a formal Architecture Decision Record under `Learning/12-architecture-decisions/ADR-XXX-<slug>.md`.
- **Feature Learning Journals**: Upon beginning implementation of a major roadmap feature from `Plan/implementation.md`, initialize a feature learning journal under `Learning/13-feature-learning/<feature-name>.md`.
- **No Speculative Filler or Codebase Duplication**: Do not pre-populate empty documents for future features. Do not copy entire source files into learning documentation.

## Verification Gate

Before concluding any implementation unit or transitioning to a new task, complete the following verification checklist:
1. **Frontend Production Build**: Run `npm run build` from `frontend/` and ensure zero compilation or syntax errors.
2. **Backend Production Build**: Run `npm run build` from `backend/` and verify assets copy cleanly to `dist/`.
3. **Architectural Invariants**: Confirm that no invariants in `Plan/architecture.md` were breached (e.g. unauthenticated routes, exposed secrets).
4. **Documentation Sync**: Verify that `Plan/progress-tracker.md` and any affected `Learning/` modules reflect the current implementation state.

