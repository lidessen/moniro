# agent-worker Architecture

## Overview

agent-worker is a daemon service that manages AI agent workflows. The daemon is the single long-lived process — all other interfaces (CLI, Web UI, AI tools) are clients that connect to it.

```
                ┌─────────────────────────────┐
                │          Daemon             │
                │                             │
   REST ───────►│  ┌───────────────────────┐  │
                │  │    Service Layer      │  │
   MCP ────────►│  │  (one interface,      │  │
                │  │   multiple protocols) │  │
   WebSocket ──►│  └───────┬───────────────┘  │
                │          │                  │
                │          ▼                  │
                │  ┌───────────────────────┐  │
                │  │   Workflow Manager    │  │
                │  │                       │  │
                │  │  @global              │  │
                │  │   ├── my-bot          │  │
                │  │   └── assistant       │  │
                │  │                       │  │
                │  │  @review:pr-123       │  │
                │  │   ├── reviewer        │  │
                │  │   └── coder           │  │
                │  └───────┬───────────────┘  │
                │          │                  │
                │     ┌────┴────┐             │
                │     ▼         ▼             │
                │  Agent     Context          │
                │  Service   Service          │
                └─────────────────────────────┘

  CLI ─────── REST ──────────► Daemon
  Web UI ──── REST + WS ─────► Daemon
  AI Tool ─── MCP ───────────► Daemon
```

## Core Concepts

### Daemon — The Service

The daemon is the top-level service process. It owns everything: HTTP server, workflow instances, agent lifecycles, context storage. There is exactly one daemon process.

Discovery is minimal: the daemon writes `~/.agent-worker/daemon.json` with `{ pid, host, port }`. Clients read this file to find the daemon. Nothing else is stored on the filesystem for service coordination.

### Service Layer — One Interface, Two Protocols

REST and MCP expose the **same operations** through different protocols:

```
REST:  POST /workflows/global/agents/bot/send  { message: "..." }
MCP:   tool "agent_send" { workflow: "global", agent: "bot", message: "..." }
WS:    { action: "send_stream", workflow: "global", agent: "bot", message: "..." }
```

All three call the same underlying service function. Adding a new operation means implementing it once in the service layer, then exposing it through both REST and MCP.

This matters because different clients speak different protocols:
- **CLI, Web UI, scripts** → REST (request/response) + WebSocket (streaming)
- **AI tools** (Claude Code, Cursor, etc.) → MCP (tool calling)

### Workflow — The Execution Model

Every agent runs inside a workflow. A workflow is a named group of agents with shared context.

- **`@global`** — The default workflow. Standalone agents live here. `agent new --name bot` creates an agent under `@global`.
- **Named workflows** — Created from YAML definitions or API calls. `@review:pr-123` is a workflow named `review` with tag `pr-123`.

There is no distinction between "single-agent mode" and "multi-agent mode" at the runtime level. A single agent is a workflow with one agent.

```
Workflow Manager
  └── Workflow (@global, @review:pr-123, ...)
        └── AgentSupervisor  (lifecycle: when to run, retry, inbox polling)
              └── AgentRuntime   (execution: LLM conversation, tool loop, streaming)
```

### AgentRuntime — How to Think

The execution engine for a single agent. It owns:

- Conversation history (messages)
- Model configuration (model ID, system prompt)
- Tool registry (AI SDK tools)
- Approval mechanism
- `send(message)` → LLM reasoning → tool loop → response
- `sendStream(message)` → same, with token-level streaming

AgentRuntime does not know _why_ it is asked to send. It does not know about inboxes, channels, or workflows. It is a pure execution primitive.

(Currently `AgentSession` in `src/agent/session.ts`)

### AgentSupervisor — When to Think

The lifecycle manager for a single agent within a workflow. It decides when to run the AgentRuntime and what to do with the results:

1. Poll inbox for @mentions → build prompt → `runtime.send()` → write response to channel → ack inbox
2. On failure → retry with exponential backoff
3. External `wake()` → check inbox immediately
4. State machine: `stopped → idle → running → idle → ...`

AgentSupervisor wraps AgentRuntime. The daemon does not do inbox polling or timer management directly — it delegates to supervisors.

(Currently `AgentController` in `src/workflow/controller/controller.ts`)

### Context — Shared Storage

Context provides the collaboration substrate for agents within a workflow. Each workflow has its own context:

| Primitive | Purpose |
|-----------|---------|
| **Channel** | Append-only message log with @mentions |
| **Inbox** | Per-agent filtered view of channel |
| **Resources** | Content-addressed large content storage |
| **Documents** | Shared team workspace files |
| **Proposals** | Voting system for collaborative decisions |

Context is exposed to agents via MCP tools (channel_send, channel_read, my_inbox, team_doc_*, resource_*, etc.). The same MCP tools are also available through the daemon's REST API.

Context is backend-agnostic: `ContextProvider` interface with `FileContextProvider` (production) and `MemoryContextProvider` (testing).

## Module Structure

```
src/
├── daemon/                     # The service
│   ├── daemon.ts               # Process lifecycle: start, shutdown, signals
│   ├── server.ts               # Hono app: REST routes + MCP endpoint + WebSocket
│   ├── service.ts              # Service layer: the actual operations
│   └── discovery.ts            # Read/write daemon.json
│
├── workflow/                   # Execution model
│   ├── manager.ts              # Manages workflow instances (create, list, destroy)
│   ├── runner.ts               # Single workflow execution
│   ├── supervisor.ts           # Agent lifecycle (poll → run → ack → retry)
│   ├── parser.ts               # YAML workflow definition → typed config
│   ├── interpolate.ts          # Variable interpolation (${{ }})
│   └── prompt.ts               # Agent prompt building from context
│
├── agent/                      # Execution engine
│   ├── runtime.ts              # AgentRuntime: LLM conversation + tool loop
│   ├── models.ts               # Model creation, provider registry
│   ├── types.ts                # Core types
│   ├── tools/                  # Built-in tool factories
│   │   ├── bash.ts             # Sandboxed bash/readFile/writeFile
│   │   └── skills.ts           # Skills tool
│   └── skills/                 # Skill loading + importing
│       ├── provider.ts         # SkillsProvider
│       ├── importer.ts         # Git-based skill import
│       └── import-spec.ts      # Import spec parsing
│
├── context/                    # Shared storage (extracted from workflow/context/)
│   ├── provider.ts             # ContextProvider interface + implementation
│   ├── storage.ts              # StorageBackend interface
│   ├── file-provider.ts        # File-based storage
│   ├── memory-provider.ts      # In-memory storage (testing)
│   ├── mcp-tools.ts            # Context MCP tool definitions
│   ├── proposals.ts            # Proposal/voting system
│   └── types.ts                # Channel, inbox, document types
│
├── backends/                   # AI provider adapters
│   ├── types.ts                # Backend interface
│   ├── index.ts                # Factory + availability checks
│   ├── model-maps.ts           # Model name translation
│   ├── sdk.ts                  # Vercel AI SDK
│   ├── claude-code.ts          # Claude Code CLI
│   ├── codex.ts                # Codex CLI
│   ├── cursor.ts               # Cursor CLI
│   └── mock.ts                 # Mock (testing)
│
└── cli/                        # Independent client (NOT under daemon)
    ├── client.ts               # HTTP client → daemon REST API
    └── commands/               # One file per command group
        ├── agent.ts            # new, list, stop, info
        ├── send.ts             # send, peek, stats, export, clear
        ├── tool.ts             # tool add, import, mock, list
        ├── workflow.ts         # run, start, stop, list
        ├── approval.ts         # pending, approve, deny
        └── info.ts             # providers, backends
```

## Dependency Graph

```
cli/ ──── HTTP ────► daemon/
                       │
                       ├──► workflow/
                       │       │
                       │       ├──► agent/     (AgentRuntime)
                       │       └──► context/   (ContextProvider)
                       │
                       ├──► context/           (MCP tool definitions)
                       └──► backends/          (backend factory)
```

Rules:
- `cli/` imports nothing from `daemon/` except discovery (reading daemon.json)
- `daemon/` imports from `workflow/`, `context/`, `agent/`, `backends/`
- `workflow/` imports from `agent/`, `context/`, `backends/`
- `agent/` imports from `backends/` (types only)
- `context/` imports nothing from other app modules (pure domain)
- No circular dependencies. No upward imports.

## Key Design Decisions

### Why daemon as the top-level service?

Without a daemon, each agent is its own process. N agents = N processes, N sockets, stale registry files when processes crash. With one daemon, there's one process, one HTTP server, one MCP endpoint. Agent lifecycle, health checks, context — all centralized.

### Why one interface, two protocols?

CLI and Web UI speak REST. AI tools (Claude Code, Cursor) speak MCP. Both need the same operations (send message, read channel, manage workflows). Implementing the operations once in the service layer and exposing them through both protocols eliminates duplication and keeps behavior consistent.

### Why all agents live in workflows?

Eliminates the split between "single-agent daemon" and "multi-agent workflow" code paths. `agent new` creates an agent under `@global` — it's just a 1-agent workflow with simplified CLI ergonomics. The runtime doesn't know or care.

### Why AgentRuntime vs AgentSupervisor?

Separation of concerns:
- **Runtime** answers "how to talk to an LLM" — stateful conversation, tool loop, streaming
- **Supervisor** answers "when to talk and what to do with results" — inbox polling, retry, error recovery

The supervisor calls `runtime.send()` when it decides the agent should act. The daemon doesn't do inbox polling — supervisors do.

### Why Context is a separate module?

Context (channel, inbox, documents, resources) is used by both daemon (to expose via MCP/REST) and workflow (for agent collaboration). If it lives under `workflow/`, the daemon has an awkward reverse dependency. As a top-level module, both can import it cleanly.
