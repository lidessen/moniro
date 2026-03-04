# Architecture Overview: The Design Arc

**Date**: 2026-02-24
**Status**: Living document

---

## What This Document Is

This document explains **why** the agent-worker architecture is shaped the way it is. Not a module reference (see [ARCHITECTURE.md](../../ARCHITECTURE.md)), not an API guide (see [workflow/REFERENCE.md](../workflow/REFERENCE.md)) — this is the story of how each architectural layer exists because the previous one exposed a limitation.

Read this when you need to understand the design intent. Each section follows the pattern:
**what we had → what was missing → what we added → why it works**.

---

## The Core Question

**How do you make a system of short-lived agents accumulate progress over time?**

Most approaches answer this by making agents persistent — giving them memory, learning mechanisms, identity. We take the opposite stance: **an agent's lifetime is one tool loop.** It starts, works, and is gone. Continuity lives not in any individual agent, but in the shared artifacts they produce.

This has a property we find compelling: it scales with the context window. As models process more context, agents naturally absorb more shared history — without changing a line of code.

---

## Layer 1: AgentWorker — The Execution Primitive

**The simplest useful unit: send a message, get a response.**

```
AgentWorker
├── Conversation history (messages[])
├── Model configuration (model, system prompt)
├── Tool registry (AI SDK tools)
└── send(message) → LLM reasoning → tool loop → response
```

`AgentWorker` (`src/agent/worker.ts`) is a stateful conversation with an LLM. It manages the message-tool loop: send a message, the model responds, if it calls tools we execute them, repeat until done.

**What it knows**: How to talk to an LLM.
**What it doesn't know**: Why it was asked to talk, what workflow it belongs to, what happened before.

**Why this matters**: By keeping the worker pure, we can wrap it in any lifecycle manager without the execution engine caring about the orchestration policy.

---

## Layer 2: Backend Abstraction — Same Interface, Different Engines

**Problem with Layer 1**: AgentWorker is coupled to the Vercel AI SDK. But agents might need to run on Claude CLI, Cursor, Codex, or OpenCode — tools that manage their own tool loops.

**Solution**: The `Backend` interface (`src/backends/types.ts`).

```typescript
interface Backend {
  readonly type: BackendType;
  send(message: string, options?: { system?: string }): Promise<BackendResponse>;
  abort?(): void;
}
```

All backends implement `send()`. The loop writes MCP config to the workspace before calling `send()` — backends just read it from their cwd.

```
SDK backend:  AgentWorker → AI SDK → Model API (tools managed by us)
CLI backends: loop writes MCP config → spawn CLI in workspace → CLI manages tools
```

**The insight**: Backends are pure communication adapters. They don't know about inboxes, channels, or workflows. The loop owns the orchestration line:

```
inbox → build prompt → write MCP config → backend.send() → result
```

This means you can build a team with one agent on Claude CLI and another on the SDK — they coordinate through shared context, not shared infrastructure.

---

## Layer 3: Three-Layer Context — Shared Collaboration Substrate

**Problem with Layers 1-2**: A single agent can talk to an LLM. But how do multiple agents collaborate? They need shared state.

**Solution**: Three complementary context primitives, each answering a different cognitive question.

```
┌──────────────┐   ┌──────────────────┐   ┌─────────────────┐
│    INBOX     │   │     CHANNEL      │   │    DOCUMENT     │
│              │   │                  │   │                 │
│  "What's     │   │  "What happened  │   │  "What are we   │
│   for me?"   │   │   so far?"       │   │   working on?"  │
└──────────────┘   └──────────────────┘   └─────────────────┘
```

| Layer        | Purpose                         | Persistence                     | Access Pattern                 |
| ------------ | ------------------------------- | ------------------------------- | ------------------------------ |
| **Inbox**    | Unread @mentions for this agent | Transient (read state tracking) | Pull: agent checks when waking |
| **Channel**  | Append-only communication log   | Permanent                       | Read: full history, any agent  |
| **Document** | Structured workspace            | Editable                        | Read/write: owner or all       |

**Why three, not one?**

- Inbox alone is insufficient — an agent waking to 5 unread messages has no project context.
- Channel alone is overwhelming — scrolling 100 messages to find "what's for me" is wasteful.
- Document alone is static — goals don't change often, but work progresses dynamically.

Together: inbox → immediate attention, channel → situational awareness, document → strategic context.

**Storage**: `ContextProvider` interface with `FileContextProvider` (production, files on disk) and `MemoryContextProvider` (testing, in-memory). Backends don't know about storage — context is exposed to agents as MCP tools.

(`src/workflow/context/`)

---

## Layer 4: @mention Coordination — Natural Language Routing

**Problem with Layer 3**: Context exists, but how do agents know when to act? Polling the full channel is expensive. Explicit task queues are rigid.

**Solution**: @mention routing. Agents communicate naturally — `@reviewer check this`, `@coder fix it` — and the system routes messages to the right inbox.

```
channel.append("@reviewer check this code")
         │
         ├── Parse @mentions → ["reviewer"]
         ├── Deliver to reviewer's inbox
         └── loop.wake("reviewer")  ← Near-real-time response
```

The `wake()` call is the key mechanism: instead of waiting for the next poll cycle, the system immediately wakes the target agent's loop. This turns a polling-based system into a near-real-time reactive one while keeping the implementation simple.

**Why @mentions, not message queues?**

Familiar pattern from team chat. Natural language, no special syntax beyond `@name`. Agents can learn it from examples in the system prompt without special training. And the routing is embedded in the message content itself — no separate addressing layer needed.

---

## Layer 5: Loop — Lifecycle Orchestration

**Problem with Layers 1-4**: We have execution (worker), communication (backend), shared state (context), and routing (@mentions). But who decides _when_ to run an agent, _what_ to do on failure, and _how_ to manage the agent's lifecycle?

**Solution**: `AgentLoop` (`src/workflow/loop/loop.ts`) — the lifecycle manager for a single agent within a workflow.

```
State machine: stopped → idle ⇄ running → stopped

IDLE:
  - Wait for poll interval or wake()
  - Check inbox
  - If empty → check schedule → remain idle
  - If messages → transition to RUNNING

RUNNING:
  - Build prompt from context (inbox + channel + document)
  - Configure workspace with MCP
  - Call backend.send()
  - On success → write response to channel → ack inbox → IDLE
  - On failure → retry with exponential backoff → eventually ack to prevent loop
```

**Critical design choice: ack only on success.** The inbox acknowledgment happens only after a successful run. This gives exactly-once processing semantics — if the agent crashes mid-run, the message will be redelivered on the next poll.

**Schedule/Wakeup**: Loops support two wakeup patterns beyond @mention:

- **Interval** (e.g., `30s`, `5m`): Idle-based, resets on activity. Good for periodic checks.
- **Cron** (e.g., `0 9 * * 1-5`): Fixed schedule, ignores activity. Good for daily standups.

**sendDirect()**: For bypassing the poll loop entirely — the daemon calls `sendDirect(message)` for synchronous `/serve` requests. Uses a logical lock (`directRunning`) to prevent races with the poll loop.

---

## Layer 6: Workflow — The Orchestration Unit

**Problem with Layer 5**: Individual loops manage individual agents. But who creates the loops, wires them to shared context, handles startup/shutdown, and decides when the whole team is done?

**Solution**: Workflows. A workflow is a named group of agents with shared context, defined in YAML.

```yaml
# review.yaml
agents:
  reviewer:
    model: anthropic/claude-sonnet-4-5
    system_prompt: Review code, @coder to fix.
  coder:
    model: anthropic/claude-sonnet-4-5
    system_prompt: Fix issues from reviewer.

setup:
  - shell: git diff HEAD~1
    as: diff

kickoff: |
  ${{ diff }}
  @reviewer please review.
```

**The factory layer** (`src/workflow/factory.ts`) provides two composable primitives:

- `createMinimalRuntime()` — shared infrastructure (context provider + MCP server + event log)
- `createWiredLoop()` — per-agent setup (backend + workspace + loop)

Both the workflow runner (CLI) and the daemon use these same primitives, ensuring consistent behavior regardless of entry point.

**Workflow vs Agent distinction**: There is no "single-agent mode" vs "multi-agent mode" at the runtime level. A standalone agent is a workflow with one agent under `@global`. The runtime doesn't know or care.

**Idle detection**: A workflow is "done" when all loops are idle + no unread messages + no active proposals + debounce elapsed. This is how `run` mode knows when to exit.

(`src/workflow/runner.ts`, `src/workflow/factory.ts`)

---

## Layer 7: Proposal & Voting — Structured Decision-Making

**Problem with Layer 6**: Agents can collaborate through messages. But some decisions need structure — who should own a document, which approach to take, whether to merge. Free-form conversation can go in circles.

**Solution**: A formal proposal and voting system.

```
proposal_create → [PROPOSAL] in channel → agents vote → quorum → [RESOLVED]
```

| Type         | Use Case                           |
| ------------ | ---------------------------------- |
| `election`   | Document owner, coordinator role   |
| `decision`   | Design choices, approach selection |
| `approval`   | Merge sign-off, release gates      |
| `assignment` | Task allocation                    |

| Resolution  | Rule            |
| ----------- | --------------- |
| `plurality` | Most votes wins |
| `majority`  | >50% required   |
| `unanimous` | All must agree  |

**Why formalize decisions?** Without it, agents can disagree endlessly or silently override each other. Proposals create a convergence mechanism — a way to force a decision with clear rules.

Binding proposals are enforced by the system (e.g., document ownership). Advisory proposals rely on agent cooperation.

(`src/workflow/context/proposals.ts`)

---

## Layer 8: Smart Send + Resources — Context Window Protection

**Problem**: Long messages (large diffs, full file contents) can overwhelm the context window — both the sending agent's and the receiving agent's.

**Solution**: Messages exceeding a size threshold are automatically converted to content-addressed resource blobs. The channel message becomes a reference; the full content lives in storage.

```
agent sends 50KB diff
  │
  ├── Content exceeds threshold
  ├── Store as resource (content-addressed hash)
  └── Channel message: "[resource:abc123] PR diff (50KB)"
```

Agents can fetch the full resource when they need it via MCP tools. This keeps the channel lightweight while preserving access to large content.

---

## Layer 9: Daemon + Registry — The Service Layer

**Problem with Layers 1-8**: Everything works within a single process. But in practice: the CLI is one process, the web UI is another, and AI tools (Claude Code, Cursor) are yet another. How do they all interact with the same agent state?

**Solution**: A single daemon process that owns everything.

```
┌─────────────────────────────┐
│     Daemon (:5099)          │
│                             │
│  REST ────► Service Layer   │
│  SSE  ────► (9 endpoints)   │
│  MCP  ────►                 │
│             │               │
│             ▼               │
│       Workflow Manager      │
│       Map<name, Agent>      │
│             │               │
│        Loops                │
│        + Context            │
└─────────────────────────────┘

CLI ─── REST+SSE ──► Daemon
Web UI ─ REST+SSE ──► Daemon
AI Tool ─ MCP ─────► Daemon
```

**Discovery**: The daemon writes `~/.agent-worker/daemon.json` with `{ pid, host, port, token }`. Clients read this file to find the daemon.

**Why one daemon?** Without it, each agent is its own process. N agents = N processes, N ports, stale registry files when processes crash. One daemon = one process, one HTTP server, one MCP endpoint. Lifecycle, health, context — all centralized.

**Auth**: Random token per daemon instance, validated on every request.

(`src/daemon/`)

---

## Proposed: Agent as Top-Level Entity

> **Status**: Proposed. See [AGENT-TOP-LEVEL.md](./AGENT-TOP-LEVEL.md) for full design.

**Problem with the current architecture**: Agents are defined _inside_ workflows. There's no persistent identity — if alice participates in both `review` and `deploy`, she's defined twice with no shared state. Agents have no memory, no soul, no continuity across workflows.

**Proposed solution**: Elevate agents to top-level entities with their own persistent context.

```
Project
├── Agents (top-level definitions)
│   ├── alice (prompt, soul, memory, notes, todo)
│   └── bob (prompt, soul, memory, notes, todo)
│
├── Global Workspace (for standalone use)
│
└── Workflows (orchestrate agents)
    ├── review → agents: [alice (ref), bob (ref)]
    └── deploy → agents: [alice (ref), deployer (local)]
```

Three orthogonal concepts replace the current conflated model:

| Concept       | What It Is                                                 | Persistence                                |
| ------------- | ---------------------------------------------------------- | ------------------------------------------ |
| **Agent**     | Identity + own context (prompt, soul, memory, notes, todo) | Persistent across workflows                |
| **Workspace** | Collaboration space (channel, documents)                   | Per-workflow instance                      |
| **Workflow**  | Orchestration definition                                   | Definition persistent, instances ephemeral |

**Soul**: Captures _who the agent is_ beyond the system prompt — role, expertise, style, principles. The system prompt says "what to do now"; the soul says "who you are always."

**Key mechanism: `ref`**. Workflows reference global agents with optional overrides:

```yaml
agents:
  alice: { ref: alice } # Use as-is
  bob:
    ref: bob
    prompt:
      append: Focus on security. # Workflow-specific addition
  helper:
    model: anthropic/claude-haiku-4-5 # Workflow-local, no persistence
    prompt:
      system: Quick lookup helper.
```

---

## Proposed: Guard Agent (看守者)

> **Status**: Proposed. See [GUARD-AGENT.md](./GUARD-AGENT.md) for full design.

**Problem with Agent-as-Top-Level**: Agents have persistent context (soul, memory, notes, todo). But critical questions remain: Who assembles the right context for each run? Who manages soul evolution without identity drift? Who mediates cross-agent memory access? How does context size stay manageable?

**Proposed solution**: The Guard Agent (看守者) — a meta-agent that mediates context, memory, and identity for other agents.

### Three Responsibilities

**1. Context Assembly** — Replace naive concatenation with intelligent selection:

```
Guard.assembleContext(alice, workflow, task)
  ├── Soul (always, full)
  ├── Memory (selected by relevance + token budget)
  ├── Active todos (compact)
  ├── Workflow context (inbox, channel, docs)
  └── Compress if exceeding budget
```

Three-tier memory: Core (always loaded) → Working (selected by relevance) → Archive (searched on demand).

**2. Memory Mediation** — Agents never directly access each other's memory:

```
alice asks: "What does bob know about deploy?"
  │
  Guard.askAbout(from: alice, about: bob, query: "deploy")
  ├── Permission check
  ├── Search bob's shareable memory
  ├── Filter private entries
  ├── Summarize (not raw dump)
  └── Log the query
```

Visibility levels: private (agent-only) → shareable (ask protocol) → public (workspace documents).

**3. Identity Governance** — Soul evolution through observation, not self-modification:

```
Guard observes: alice consistently explains trade-offs
Current soul doesn't mention this
→ Propose soul update: add "Always explain trade-offs"
→ Auto-apply (low risk) or require user approval (significant change)
→ Version the change (diffable, rollbackable)
```

### Hybrid Implementation

The Guard is not purely an LLM agent. Most operations are deterministic:

| Operation                  | Implementation                      |
| -------------------------- | ----------------------------------- |
| Memory search              | Deterministic (SQLite FTS5 + vec)   |
| Memory write validation    | LLM (is this worth remembering?)    |
| Context assembly selection | LLM (what's relevant to this task?) |
| Cross-agent summarization  | LLM (summarize for requester)       |
| Permission checks          | Deterministic                       |
| Audit logging              | Deterministic                       |

### Storage: Files + SQLite

Files are the source of truth (human-readable, git-friendly). SQLite is a derived, rebuildable index (queryable, searchable via FTS5 + sqlite-vec).

```
.agents/alice/
├── memory/              # Source of truth
│   ├── core.yaml
│   └── notes/
├── soul.yaml            # Guard-managed
├── todo/
└── .index/              # Derived (rebuildable, gitignored)
    └── memory.sqlite
```

---

## The Arc

Reading the layers in sequence reveals the design trajectory:

```
Layer 1  AgentWorker        → "I can talk to an LLM"
Layer 2  Backend            → "I can talk to any LLM, through any tool"
Layer 3  Three-Layer Context → "Multiple agents can share state"
Layer 4  @mention           → "Agents can address each other naturally"
Layer 5  Loop               → "Agent lifecycle is managed with retry and scheduling"
Layer 6  Workflow           → "Teams of agents can be defined and orchestrated"
Layer 7  Proposals          → "Structured decisions prevent endless disagreement"
Layer 8  Smart Send         → "Large content doesn't overwhelm context windows"
Layer 9  Daemon             → "All clients (CLI, Web, AI tools) share one service"
   ─── implemented above / proposed below ───
Layer 10 Agent Identity     → "Agents have persistent soul, memory, notes"
Layer 11 Guard Agent        → "Context is curated, memory is mediated, identity evolves"
```

Each layer exists because the previous one created a capability that exposed a new limitation. The arc goes from "execute a single LLM call" to "a community of agents with persistent identity, curated context, and governed evolution."

The key insight is that we never made the agents smarter. We made the environment they work in richer. The agents are still ephemeral tool loops — they just have better context each time they wake up.

---

## Design Principles (Emergent)

These principles emerged from building the layers, not the other way around:

| Principle                                    | Expressed In                                                                      |
| -------------------------------------------- | --------------------------------------------------------------------------------- |
| **Backends are dumb pipes**                  | Backend only knows `send()`. Loop owns orchestration.                             |
| **Context answers cognitive questions**      | Inbox (what's for me), Channel (what happened), Document (what we're building).   |
| **Ack on success only**                      | Inbox acknowledgment gives exactly-once semantics with retry.                     |
| **No distinction between 1 and N agents**    | Single agent = 1-agent workflow under `@global`.                                  |
| **Files are truth, databases are indexes**   | Markdown/YAML authoritative; SQLite is acceleration.                              |
| **Agents don't access each other directly**  | Cross-agent communication via channel; cross-agent memory via Guard ask protocol. |
| **Mediate, don't block**                     | Guard curates context, doesn't gatekeep it.                                       |
| **Identity is behavioral, not aspirational** | Soul describes what agent does, not what it "should be."                          |

---

## Evolution History

| Version        | Key Change                                                                     |
| -------------- | ------------------------------------------------------------------------------ |
| v0.1.0         | CLI backend support (Claude, Codex, Cursor)                                    |
| v0.2.0         | Skill imports from Git                                                         |
| v0.3.0         | Async messaging, `peek` command                                                |
| v0.4.0         | Multi-agent workflows, shared context, proposals, @mention coordination        |
| v0.5.0-v0.10.0 | CLI refinements, smart send, streaming, display improvements                   |
| v0.11.0        | Daemon rewrite: Unix sockets → HTTP server                                     |
| v0.12.0        | Daemon-managed workflows (run/start inside daemon process)                     |
| v0.13.0        | OpenCode backend, provider config system                                       |
| v0.14.0        | Schedule/wakeup, sendDirect(), interface-daemon-worker three-layer unification |
| _next_         | _Agent as Top-Level Entity (proposed)_                                         |
| _future_       | _Guard Agent (proposed)_                                                       |

---

## Reading Guide

| If you want to understand...            | Read                                              |
| --------------------------------------- | ------------------------------------------------- |
| Module structure and dependencies       | [ARCHITECTURE.md](../../ARCHITECTURE.md)          |
| This design overview (you are here)     | [OVERVIEW.md](./OVERVIEW.md)                      |
| Workflow context model and coordination | [workflow/DESIGN.md](../workflow/DESIGN.md)       |
| MCP tools and loop details              | [workflow/REFERENCE.md](../workflow/REFERENCE.md) |
| Agent-as-entity proposal                | [AGENT-TOP-LEVEL.md](./AGENT-TOP-LEVEL.md)        |
| Guard agent proposal                    | [GUARD-AGENT.md](./GUARD-AGENT.md)                |
| Backend comparison                      | [backends.md](../backends.md)                     |
