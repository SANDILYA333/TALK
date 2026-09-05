# TALK — Engineering Knowledge Base & Learning System

> **"I want to learn software engineering, architecture, security, networking, databases, cryptography, distributed systems, and other concepts by actually building TALK."**

---

## 1. Purpose

The `Learning/` directory is a **living, TALK-specific engineering knowledge base**. 

While the `Plan/` directory contains execution contracts and specifications answering **"What are we building and how do we build it?"**, `Learning/` answers:

> **"What am I learning while building it, why does it matter, and how does it actually work inside TALK?"**

This repository is an educational vehicle to master real-world software engineering, distributed systems, network protocols, applied cryptography, and defensive security through deliberate, hands-on construction.

---

## 2. Learning Philosophy

Every technical concept documented here follows a first-principles learning progression:

```text
REAL PROBLEM IN TALK
        ↓
ENGINEERING CONCEPT
        ↓
WHY TALK NEEDS IT
        ↓
ARCHITECTURAL DESIGN
        ↓
ACTUAL IMPLEMENTATION (Source Code)
        ↓
VERIFICATION & TESTS
        ↓
FAILURES, BUGS & TRADE-OFFS
        ↓
LESSON LEARNED & INTERVIEW MASTERY
```

We do not write generic textbook summaries or regurgitate documentation. Every topic is tied directly to the real TALK codebase, real network interactions, and real architectural trade-offs.

---

## 3. Source of Truth Hierarchy

```text
Actual Code & Runtime Behavior (Ultimate Source of Truth)
            ↓
    Plan/ Context Files (Architecture, Standards, Roadmap)
            ↓
Learning/ Knowledge Base (Engineering Understanding & Retrospectives)
```

1. **Learning documentation explains the system; it never overrides `Plan/` or the code.**
2. If the codebase or architecture evolves, the corresponding learning documents must be updated to reflect the new reality.
3. Outdated learning documents must be corrected or archived—never leave explanations that describe an architecture that no longer exists.

---

## 4. Track Index & Directory Organization

The knowledge base is organized into 14 distinct tracks:

```text
Learning/
├── README.md                          # Master index and operational rules
│
├── 00-foundations/                    # First-principles prerequisites (HTTP, WebSockets, DB indices, async)
├── 01-talk-architecture/              # High-level architecture, lifecycles, and component interactions
├── 02-security/                       # Trust boundaries, auth vs authz, threat models, input sanitization
├── 03-realtime-systems/               # WebSockets, presence tracking, multi-session routing, race conditions
├── 04-databases-storage/              # MongoDB document modeling, aggregation pipelines, TTLs, IndexedDB
├── 05-cryptography/                   # Applied crypto: X25519, HKDF, AES-GCM, digital signatures, nonces
├── 06-end-to-end-encryption/          # Protocol design: X3DH, Double Ratchet, prekeys, session ratchets
├── 07-privacy/                        # Metadata minimization, sealed sender, safety numbers, silent push
├── 08-groups/                         # Multi-user encryption, Sender Keys, group key rotation
├── 09-webrtc/                         # P2P audio/video, SDP/ICE negotiation, STUN/TURN traversal, signaling
├── 10-offline-systems/                # Offline-first queues, transport abstraction, Bluetooth mesh, sync
├── 11-infrastructure/                 # Docker multi-stage builds, Render deployment, cron keep-alives, CORS
├── 12-architecture-decisions/         # Formal Architecture Decision Records (ADR-001, ADR-002, ...)
└── 13-feature-learning/               # Chronological learning journals for major roadmap features
```

### Track Descriptions

| Track | Directory | Description & Scope |
| :--- | :--- | :--- |
| **00** | `00-foundations/` | Core engineering concepts (Client/Server, WebSockets, Asynchronous Event Loops, Indexing). Created on demand as prerequisites. |
| **01** | `01-talk-architecture/` | Deep-dives into TALK's actual architecture: Request lifecycles, Message lifecycles, Auth flows, State hierarchy. |
| **02** | `02-security/` | Threat modeling, identity spoofing vectors, webhook signature verification, secret management. |
| **03** | `03-realtime-systems/` | Socket.io lifecycle, connection handshakes, multi-tab presence maps, real-time event dispatching. |
| **04** | `04-databases-storage/` | Mongoose schema design, 6-stage aggregation pipelines, IndexedDB encrypted storage at rest. |
| **05** | `05-cryptography/` | Primitives and math: Diffie-Hellman, X25519, symmetric ciphers, authenticated encryption (AEAD), key derivation. |
| **06** | `06-end-to-end-encryption/`| Signal protocol implementation: Extended Triple Diffie-Hellman (X3DH), Double Ratchet, skipped keys. |
| **07** | `07-privacy/` | Communication graph leakage, sealed sender routing, fingerprint safety numbers. |
| **08** | `08-groups/` | Scalable group messaging using pairwise Sender Key distribution and rotation. |
| **09** | `09-webrtc/` | Peer-to-peer media streams, NAT traversal (STUN/TURN), Socket.io signaling vs WebRTC media separation. |
| **10** | `10-offline-systems/` | Transport interfaces, offline message queueing, conflict resolution, store-and-forward sync. |
| **11** | `11-infrastructure/` | Containerization, multi-stage Docker builds, production SPA serving, keep-alive daemons. |
| **12** | `12-architecture-decisions/`| Numbered ADRs (`ADR-001-...`) recording architectural contexts, decisions, trade-offs, and consequences. |
| **13** | `13-feature-learning/` | Retrospective engineering journals written alongside each feature from `Plan/implementation.md`. |

---

## 5. Standard Learning Document Structure

Whenever a new conceptual or architectural document is created in tracks `00` through `11`, use this standardized 16-point structure:

```markdown
# [Concept Name]

## 1. What Is This?
Explain the concept clearly from first principles.

## 2. Why Does TALK Need This?
Explain the concrete problem in TALK that requires this concept.

## 3. The Problem We Were Solving
Describe the original engineering constraint or bug.

## 4. How It Works
Explain the underlying protocol or mechanism using ASCII diagrams.

## 5. How TALK Implements It
Walk through the actual TALK implementation from start to finish.

## 6. Important Components
List the classes, functions, files, or middleware involved.

## 7. Data Flow
Provide an ASCII data-flow diagram tracing data transformations.

## 8. Security Implications
- Asset protected
- Threat & Attack vector
- Mitigation implemented
- Residual risk

## 9. Architectural Decisions
Explain specific design choices made for TALK.

## 10. Alternatives Considered
Explain 2-3 viable alternatives that existed.

## 11. Trade-offs (Why Alternatives Were Rejected)
What TALK gained vs what TALK sacrificed.

## 12. Failure Modes & Edge Cases
What can break, race conditions, or network edge cases.

## 13. Common Mistakes
Developer pitfalls when implementing or modifying this concept.

## 14. What I Should Understand (Key Takeaways)
The core mental model to retain permanently.

## 15. Relevant TALK Files
Clickable markdown links to actual source files in the repo.

## 16. Interview Questions I Should Be Able to Answer
5-10 technical interview questions testing deep understanding of this system.
```

---

## 6. Architecture Decision Record (ADR) Format

In `Learning/12-architecture-decisions/`, every record uses the filename `ADR-XXX-<slug>.md` and adheres to:

```markdown
# ADR-XXX — [Decision Title]

## Status
[Proposed | Accepted | Superseded | Deprecated]

## Context
What engineering problem or architectural challenge existed?

## Decision
What specific technology, pattern, or approach was chosen?

## Why?
Why was this choice superior to other options for TALK's constraints?

## Alternatives Considered
1. Alternative A — Description & why rejected
2. Alternative B — Description & why rejected

## Trade-offs
- **Gained**: What advantages did we unlock?
- **Sacrificed**: What complexity, cost, or limitation did we accept?

## Consequences
What parts of the codebase, data model, or future roadmap are affected?

## TALK Implementation
- Key files and modules implementing this decision.

## Future Impact
Which upcoming roadmap features build upon or might modify this decision?
```

---

## 7. Feature Learning Journal Format

In `Learning/13-feature-learning/`, each journal is created **only when implementation of that feature begins** (following `Plan/implementation.md`):

```markdown
# Feature Learning Journal — [Feature Name]

## 1. What Were We Trying to Build?
## 2. What Problem Does It Solve?
## 3. Concepts Required & Prerequisites Learned
## 4. Architecture Before vs Architecture After
## 5. Implementation Step-by-Step Flow
## 6. Important Files Modified
## 7. Data Flow & Security Model
## 8. Problems, Bugs & Roadblocks Encountered
## 9. How We Solved Them (Root-Cause Fixes)
## 10. Failed Approaches & Why They Failed
## 11. What Did I Learn? (Engineering Insights)
## 12. Interview Defense: Key Questions & Answers
```

---

## 8. Mandatory Operating Rules for Learning Documentation

1. **Grounded in Code, Not Theory**: Never write abstract textbook summaries. Always tie explanations to actual files (e.g. `backend/src/lib/socket.js`), actual models, and actual network payloads.
2. **First-Principles Progression**: Break down complex cryptography or distributed state into logical building blocks before presenting advanced protocols (e.g. `Symmetric Crypto → Asymmetric Keys → Diffie-Hellman → X3DH → Double Ratchet`).
3. **Extensive ASCII Diagrams**: Use clean ASCII diagrams for state machines, sequence flows, protocol handshakes, and trust boundaries.
4. **Security-First Thinking**: For all security topics, explicitly document:
   $$\text{Asset} \longrightarrow \text{Threat} \longrightarrow \text{Attack Vector} \longrightarrow \text{Mitigation} \longrightarrow \text{Residual Risk}$$
5. **No Speculative Pre-Documentation**: Do **not** pre-populate empty documents for future features. Documents are created when the feature is built or actively studied.
6. **No Secret Leakage**: Never paste real API keys, Clerk secrets, ImageKit private keys, MongoDB connection URIs, or private keys into learning documents.
7. **No Codebase Duplication**: Do not copy-paste 200 lines of source code into learning documents. Use focused, 5-15 line snippets to highlight specific logic.
8. **Claim Status Labels**: When describing features, always distinguish:
   - `[Verified]`: Confirmed present in the active codebase.
   - `[Documented]`: Formally specified in `Plan/`.
   - `[Proposed]`: Planned for a future roadmap phase.

---

## 9. Recommended Initial Learning Documents (Current Codebase)

Based on the actual TALK codebase, the following 7 core learning documents should be populated first:

1. `01-talk-architecture/system-overview.md` — High-level MERN + Socket.io + Clerk architecture and data flow.
2. `02-security/auth-and-webhook-sync.md` — Decoupled Clerk authentication, Svix signature verification, and MongoDB user mirroring.
3. `03-realtime-systems/socket-lifecycle-and-presence.md` — WebSocket handshakes, in-memory presence tracking, and multi-session routing.
4. `04-databases-storage/sidebar-aggregation-pipeline.md` — Deriving conversation threads dynamically using MongoDB 6-stage aggregation pipelines.
5. `04-databases-storage/media-cdn-pipeline.md` — Multer memory buffering, ImageKit SDK uploads, and on-the-fly URL transformations.
6. `01-talk-architecture/client-state-and-adapters.md` — Zustand store architecture, selector performance patterns, and view-model adapters.
7. `11-infrastructure/docker-monolith-deployment.md` — Multi-stage Docker packaging and unified SPA static serving from Express.
