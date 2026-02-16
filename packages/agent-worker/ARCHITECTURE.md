# agent-worker Architecture

## Three-Tier Structure

agent-worker is a multi-agent collaboration system built on three layers: **Interface**, **Daemon**, and **Worker**. Each layer has a clear contract and strict boundaries.

```
┌──────────────────────────────────────────────────┐
│  Interface（接口层）                              │
│                                                  │
│  CLI / Web UI / External MCP clients             │
│  Stateless. Pure protocol translation.           │
└──────────────┬───────────────────────────────────┘
               │ Daemon Protocol (HTTP / MCP)
               ▼
┌──────────────────────────────────────────────────┐
│  Daemon（内核层）                                 │
│                                                  │
│  Registry / Scheduler / Context / StateStore     │
│  Single process. Single source of truth.         │
│  Decides: who runs, when, with what context.     │
│                                                  │
│  Daemon MCP ── context tools for workers         │
└──────────────┬───────────────────────────────────┘
               │ (system_prompt, daemon_mcp_url, worker_mcp_configs)
               ▼
┌──────────────────────────────────────────────────┐
│  Worker（工人层）                                  │
│                                                  │
│  LLM communication / Tool Loop / Streaming       │
│  Pure execution: f(prompt, tools) → result       │
│                                                  │
│  Daemon MCP ── connect to daemon for context     │
│  Worker MCP ── self-held task tools              │
└──────────────────────────────────────────────────┘
```

The analogy is an operating system:

| Layer | OS analogy | Owns | Does NOT own |
|-------|-----------|------|-------------|
| **Interface** | Shell, syscall interface | Protocol translation, UX, formatting | State, logic, scheduling |
| **Daemon** | Kernel | Registry, scheduling, context, lifecycle, state | LLM communication, prompt execution |
| **Worker** | Process | LLM conversation, tool loop, streaming | When to run, what context to use, retry |

---

## Interface — Protocol Layer

The interface layer translates external protocols into daemon operations. Every interface is stateless — it holds no agent state, makes no scheduling decisions, stores nothing.

```
CLI ─────── REST + SSE ────► Daemon
Web UI ──── REST + SSE ────► Daemon
AI Tool ─── MCP ───────────► Daemon (External MCP clients)
```

All interfaces are equal citizens. No interface has privileged access — everything goes through the daemon protocol.

### Daemon HTTP API

```
Daemon
  GET  /health                  Status (pid, uptime, agent count)
  POST /shutdown                Shutdown

Agent CRUD
  GET    /agents                List agents
  POST   /agents                Create agent { name, model, backend, system }
  GET    /agents/:name          Agent info
  DELETE /agents/:name          Delete agent

Execution
  POST   /run                   Execute workflow → SSE stream
  POST   /serve                 Execute workflow → JSON response

System
  ALL    /mcp                   Unified MCP endpoint
```

### CLI Discovery

```
~/.agent-worker/daemon.json = { pid, host, port, startedAt }

1. Read daemon.json → PID alive? → Use it
2. Missing or dead → Spawn daemon → Wait for daemon.json
3. Send HTTP requests
```

---

## Daemon — The Kernel

The daemon is the single long-lived process. It is the sole authority for all state.

### What the Daemon Owns

| Component | Responsibility |
|-----------|---------------|
| **Registry** | What agents exist (`Map<name, AgentConfig>`) |
| **Scheduler** | When agents run (inbox polling, cron, interval, wake) |
| **Context** | Collaboration substrate (channel, inbox, documents, proposals) |
| **StateStore** | Conversation history, usage stats (pluggable persistence) |
| **Daemon MCP** | Exposes context tools to workers |
| **Lifecycle** | Agent/workflow create, start, stop, destroy |

### What the Daemon Does NOT Own

- **LLM communication** — That's the worker's job
- **Tool execution** — Workers execute their own tools
- **Prompt content** — Workers receive prompts, daemon doesn't interpret them

### Workflow — The Execution Model

Every agent runs inside a workflow. A workflow is a named group of agents with shared context.

- **`@global`** — Default workflow. Standalone agents live here.
- **Named workflows** — From YAML or API. `@review:pr-123` = workflow `review`, tag `pr-123`.

There is no distinction between "single-agent mode" and "multi-agent mode" at runtime. A single agent is a workflow with one agent.

```
Daemon
  └── Workflow (@global, @review:pr-123, ...)
        ├── Context (channel, inbox, documents, proposals)
        ├── Scheduler (polling, cron, wake signals)
        └── Worker[] (pure execution units)
```

### Two Kinds of MCP

The daemon hosts an MCP server (Daemon MCP). Workers connect to it for collaboration capabilities. Workers also have their own MCP connections (Worker MCP) for task-specific tools.

```
Daemon MCP（内核 API）
  Daemon holds. Exposes to workers and external clients.
  Provides: context tools (channel_send, inbox_read, document_write, ...)
  Provides: management tools (for external interface clients)
  Analogy: syscall interface

Worker MCP（自持工具）
  Worker holds/connects independently.
  Loads: task tools (bash, file ops, custom MCP servers)
  Source: agent config declarations
  Analogy: process-loaded libraries
```

Workers access context **only** through Daemon MCP tools. They cannot read or write context storage directly. This enforces sandboxing — a worker can only do what its tools allow.

```
✗  Daemon assembles context → injects into prompt → passes to worker
✓  Daemon starts MCP server → worker connects → calls context tools on demand
```

### Context — Shared Storage

Context provides the collaboration substrate within a workflow. Each workflow has its own context, owned by the daemon:

| Primitive | Purpose |
|-----------|---------|
| **Channel** | Append-only message log with @mentions |
| **Inbox** | Per-agent filtered view of channel |
| **Documents** | Shared team workspace files |
| **Resources** | Content-addressed large content storage |
| **Proposals** | Voting system for collaborative decisions |

Context is backend-agnostic: `ContextProvider` interface with `FileContextProvider` (production) and `MemoryContextProvider` (testing).

---

## Worker — The Execution Unit

The worker is a pure execution primitive. It receives a prompt and tools, runs an LLM tool loop, and returns results. It does not know why it was invoked, what workflow it belongs to, or when it will run next.

```
Worker contract:
  Input:  (system_prompt, daemon_mcp_url, worker_mcp_configs)
  Output: (response, tool_calls, usage)
  Model:  f(prompt, tools) → result
```

### What the Worker Owns

- **LLM conversation** — Messages, model config, tool loop
- **Tool execution** — Runs tools within its sandbox
- **Streaming** — Token-level output streaming
- **Worker MCP connections** — Self-held task tools (bash, file ops, custom)
- **Daemon MCP connection** — For context access (channel, documents, proposals)

### What the Worker Does NOT Own

- **Scheduling** — Daemon decides when to run the worker
- **Context assembly** — Daemon provides context via MCP, not injected prompts
- **Retry logic** — Daemon retries on failure
- **Lifecycle** — Daemon creates and destroys workers

### Backend Abstraction

Workers use backends for LLM communication. A backend is a pure communication adapter — it only knows how to `send()`.

| Backend | Integration |
|---------|------------|
| **SDK** (Vercel AI SDK) | Direct API, full tool injection, streaming |
| **Claude CLI** | Native Claude, MCP via `--mcp-config` |
| **Cursor CLI** | Cursor Agent, MCP via `.cursor/mcp.json` |
| **Codex CLI** | Codex, MCP via `.codex/config.toml` |
| **Mock** | Testing without API calls |

---

## Module Structure

```
src/
├── cli/                           # Interface layer
│   ├── client.ts                  # HTTP client → daemon REST API
│   ├── instance.ts                # CLI instance management
│   ├── output.ts                  # Output formatting
│   ├── target.ts                  # Target resolution
│   └── commands/                  # One file per command group
│       ├── agent.ts               # new, list, stop, info
│       ├── send.ts                # send, peek, stats, export, clear
│       ├── tool.ts                # tool add, import, mock, list
│       ├── workflow.ts            # run, start, stop, list
│       ├── approval.ts            # pending, approve, deny
│       ├── info.ts                # providers, backends
│       ├── doc.ts                 # document operations
│       ├── feedback.ts            # feedback commands
│       └── mock.ts                # mock commands
│
├── daemon/                        # Daemon (kernel) layer
│   ├── daemon.ts                  # Process lifecycle, HTTP routes
│   ├── handler.ts                 # Request dispatch
│   ├── server.ts                  # Hono app: REST + MCP endpoint
│   ├── registry.ts                # Discovery via daemon.json
│   └── cron.ts                    # Cron schedule management
│
├── workflow/                      # Daemon internals: orchestration
│   ├── runner.ts                  # Workflow execution
│   ├── parser.ts                  # YAML → typed config
│   ├── interpolate.ts             # Variable interpolation (${{ }})
│   ├── types.ts                   # Workflow types
│   ├── layout.ts                  # Layout management
│   ├── display.ts                 # Display formatting
│   │
│   ├── controller/                # Scheduling + lifecycle (daemon concern)
│   │   ├── controller.ts          # Poll → run → ack → retry loop
│   │   ├── prompt.ts              # Prompt building from context
│   │   ├── send.ts                # Message sending
│   │   ├── sdk-runner.ts          # SDK backend runner
│   │   ├── mock-runner.ts         # Mock backend runner
│   │   ├── backend.ts             # Backend adapter
│   │   ├── mcp-config.ts          # MCP configuration
│   │   └── types.ts               # Controller types
│   │
│   └── context/                   # Context storage (daemon concern)
│       ├── provider.ts            # ContextProvider interface
│       ├── types.ts               # Channel, inbox, document types
│       ├── storage.ts             # StorageBackend interface
│       ├── file-provider.ts       # File-based storage
│       ├── memory-provider.ts     # In-memory storage (testing)
│       ├── mcp-server.ts          # Daemon MCP server (context tools)
│       ├── http-transport.ts      # MCP HTTP transport
│       └── proposals.ts           # Proposal/voting system
│
├── agent/                         # Worker layer
│   ├── worker.ts                  # AgentWorker: LLM conversation + tool loop
│   ├── models.ts                  # Model creation, provider registry
│   ├── types.ts                   # Core types
│   ├── tools/                     # Built-in worker tools
│   │   ├── bash.ts                # Sandboxed bash/readFile/writeFile
│   │   ├── skills.ts              # Skills tool
│   │   └── feedback.ts            # Feedback tool
│   └── skills/                    # Skill loading + importing
│       ├── provider.ts            # SkillsProvider
│       ├── importer.ts            # Git-based skill import
│       └── import-spec.ts         # Import spec parsing
│
└── backends/                      # Worker internals: LLM adapters
    ├── types.ts                   # Backend interface
    ├── index.ts                   # Factory + availability checks
    ├── model-maps.ts              # Model name translation
    ├── sdk.ts                     # Vercel AI SDK
    ├── claude-code.ts             # Claude Code CLI
    ├── codex.ts                   # Codex CLI
    ├── cursor.ts                  # Cursor CLI
    ├── mock.ts                    # Mock (testing)
    ├── idle-timeout.ts            # Idle timeout management
    └── stream-json.ts             # JSON streaming utilities
```

## Dependency Graph

```
Interface              Daemon (Kernel)                Worker
─────────              ───────────────                ──────

cli/ ──── HTTP ────►  daemon/
                        │
                        ├──► workflow/controller/     (scheduling, lifecycle)
                        │       │
                        │       └──► agent/worker     (execution)
                        │
                        ├──► workflow/context/         (context storage)
                        │       │
                        │       └──► context/mcp-server (Daemon MCP)
                        │                │
                        │                └ ─ ─ MCP ─ ─ ► agent/worker connects
                        │
                        └──► backends/                 (worker LLM adapters)
```

Rules:
- `cli/` imports nothing from `daemon/` except registry (reading daemon.json)
- `daemon/` imports from `workflow/`, `agent/`, `backends/`
- `workflow/controller/` is a daemon concern — scheduling, retry, prompt assembly
- `agent/` is a worker concern — pure execution, no scheduling awareness
- `workflow/context/` is a daemon concern — workers access via MCP only
- `backends/` is a worker concern — LLM communication adapters
- No circular dependencies. No upward imports.

---

## Key Design Decisions

### Why three tiers?

Without explicit tiers, responsibilities bleed. The CLI accumulates business logic. The daemon embeds execution details. Workers grow scheduling awareness. Three tiers with strict contracts prevent this:

- Interface → "How do users/tools talk to us?" (protocol)
- Daemon → "Who runs when with what?" (orchestration)
- Worker → "How do I execute this prompt?" (execution)

### Why daemon as kernel?

Without a daemon, N agents = N processes, N sockets, stale registry files. With one daemon: one process, one HTTP server, one MCP endpoint. Agent lifecycle, health checks, context, scheduling — all centralized in one authority.

### Why two kinds of MCP?

Daemon MCP is the kernel API — stable, minimal, context-focused. Worker MCP is task-specific tooling that varies per agent. Separating them enforces that workers can only access context through the daemon's controlled interface, while remaining free to load whatever task tools they need.

### Why context via MCP, not injected?

If the daemon assembles context and injects it into prompts, the worker boundary leaks — the daemon must understand prompt structure, and context size is fixed at invocation time. With MCP, workers pull context on demand. The daemon stays format-agnostic, and workers can read exactly what they need.

### Why workers are stateless about scheduling?

A worker that knows about polling, retry, and cron is coupled to the daemon's orchestration model. A pure `f(prompt, tools) → result` worker can be invoked by any orchestrator — the current daemon, a future distributed scheduler, or a test harness. Scheduling is policy; execution is mechanism.

### Why all agents live in workflows?

Eliminates the split between "single-agent" and "multi-agent" code paths. `agent new` creates an agent under `@global` — it's a 1-agent workflow with simplified CLI ergonomics. The runtime doesn't know or care.

---

## Target Architecture

> Theoretical direction for the system's evolution. Not the current implementation.

### Four Primitives

```
Message    — Data
Proposal   — Logic (schema + function, state transitions)
Agent      — Executor (ToolLoop)
System     — Runtime (provides tools, drives evaluation loop)
```

Tool is the interface System exposes to Agent. Agent is sandboxed — what tools it gets determines what it can do.

In the three-tier model:
- **System** = Daemon (kernel)
- **Agent** = Worker (execution unit)
- **Tool** = Daemon MCP (kernel API) + Worker MCP (task tools)

### Core Rule

```
message + proposal → message | task
task = agent.execute(prompt, tools, message) → message
```

Message enters. Proposal evaluates. Produces new Message or Task. Task is one Worker execution. Result becomes Message. Cycle continues.

### Proposal — Schema + Function

```typescript
interface Proposal<T> {
  schema: Schema<T>;
  execute(data: T, ctx: SystemContext): void;
}
```

Proposals compose — function body can invoke sub-Proposals. Workflow is a composition of Proposals.

### Emergent Concepts

All other concepts emerge from the four primitives:

| Concept | Emerges from |
|---------|-------------|
| **Routing** | Proposal that routes Message to Worker |
| **Workflow** | Chain of Proposals |
| **Permission** | Proposal that gates on authorization Message |
| **Channel** | Messages accumulating in a Space |
| **Inbox** | Proposal filtering Messages by @mention |
| **Space** | Scoped binding of Proposals + Workers + Messages |

### Evolution Path

**Phase 1 (current)**: System = daemon. Proposal hardcoded in controller. Agent = AgentWorker. Single process, file storage.

**Phase 2**: Define `Proposal<T>` interface. Refactor controller inbox polling, approval mechanism, and workflow YAML parser into explicit Proposals.

**Phase 3**: Composable Proposals. Worker can define new Proposals via `proposal.*` tools. Hot-loading at runtime.

**Phase 4**: Authorization as special Message type. Space as scoped binding. `@global` as default Space.
