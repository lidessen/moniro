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
                │  Session   Provider         │
                └─────────────────────────────┘

  CLI ─────── REST ──────────► Daemon
  Web UI ──── REST + WS ─────► Daemon
  AI Tool ─── MCP ───────────► Daemon
```

## Core Concepts

### Daemon — The Service

The daemon is the top-level service process. It owns everything: HTTP server, workflow instances, agent lifecycles, context storage. There is exactly one daemon process.

Discovery is minimal: the daemon writes `~/.agent-worker/daemon.json` with `{ pid, host, port }`. Clients read this file to find the daemon. Nothing else is stored on the filesystem for service coordination.

### Service Layer — One Interface, Multiple Protocols

REST and MCP expose the **same operations** through different protocols:

```
REST:  POST /session/send  { message: "..." }
MCP:   tool "agent_send"   { message: "..." }
WS:    { action: "send_stream", message: "..." }
```

All three call the same underlying handler. Adding a new operation means implementing it once, then exposing it through both REST and MCP.

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
        └── AgentController  (lifecycle: when to run, retry, inbox polling)
              └── AgentWorker   (execution: LLM conversation, tool loop, streaming)
```

### AgentWorker — The ToolLoop

The execution engine for a single agent. It owns:

- Conversation history (messages)
- Model configuration (model ID, system prompt)
- Tool registry (AI SDK tools)
- Approval mechanism
- `send(message)` → LLM reasoning → tool loop → response
- `sendStream(message)` → same, with token-level streaming

AgentWorker does not know _why_ it is asked to send. It does not know about inboxes, channels, or workflows. It is a pure execution primitive.

(`src/agent/worker.ts`)

### AgentController — Lifecycle Management

The lifecycle manager for a single agent within a workflow. It decides when to run the AgentWorker and what to do with the results:

1. Poll inbox for @mentions → build prompt → `session.send()` → write response to channel → ack inbox
2. On failure → retry with exponential backoff
3. External `wake()` → check inbox immediately
4. State machine: `stopped → idle → running → idle → ...`

AgentController wraps AgentWorker. The daemon does not do inbox polling or timer management directly — it delegates to controllers.

(`src/workflow/controller/controller.ts`)

### Context — Shared Storage

Context provides the collaboration substrate for agents within a workflow. Each workflow has its own context:

| Primitive | Purpose |
|-----------|---------|
| **Channel** | Append-only message log with @mentions |
| **Inbox** | Per-agent filtered view of channel |
| **Resources** | Content-addressed large content storage |
| **Documents** | Shared team workspace files |
| **Proposals** | Voting system for collaborative decisions |

Context is exposed to agents via MCP tools (`channel_send`, `channel_read`, `my_inbox`, `team_doc_*`, `resource_*`, etc.). The same MCP tools are also available through the daemon's MCP endpoint.

Context is backend-agnostic: `ContextProvider` interface with `FileContextProvider` (production) and `MemoryContextProvider` (testing).

## Module Structure

```
src/
├── daemon/                        # The service
│   ├── daemon.ts                  # Process lifecycle: start, shutdown, signals, HTTP routes
│   ├── handler.ts                 # Request handler: action dispatch
│   ├── server.ts                  # Hono app: REST routes + MCP endpoint + WebSocket
│   ├── registry.ts                # Read/write daemon.json for discovery
│   └── cron.ts                    # Cron schedule management
│
├── workflow/                      # Execution model
│   ├── runner.ts                  # Single workflow execution
│   ├── parser.ts                  # YAML workflow definition → typed config
│   ├── interpolate.ts             # Variable interpolation (${{ }})
│   ├── types.ts                   # Workflow types
│   ├── layout.ts                  # Layout management
│   ├── display.ts                 # Workflow display formatting
│   │
│   ├── controller/                # Agent lifecycle management
│   │   ├── controller.ts          # Poll → run → ack → retry loop
│   │   ├── prompt.ts              # Agent prompt building from context
│   │   ├── send.ts                # Message sending logic
│   │   ├── sdk-runner.ts          # AI SDK backend runner
│   │   ├── mock-runner.ts         # Mock backend runner (testing)
│   │   ├── backend.ts             # Backend adapter
│   │   ├── mcp-config.ts          # MCP tool configuration
│   │   └── types.ts               # Controller types
│   │
│   └── context/                   # Shared storage
│       ├── provider.ts            # ContextProvider interface + implementation
│       ├── types.ts               # Channel, inbox, document types
│       ├── storage.ts             # StorageBackend interface
│       ├── file-provider.ts       # File-based storage
│       ├── memory-provider.ts     # In-memory storage (testing)
│       ├── mcp-server.ts          # Context MCP server (tool definitions)
│       ├── http-transport.ts      # MCP HTTP transport
│       └── proposals.ts           # Proposal/voting system
│
├── agent/                         # Execution engine
│   ├── worker.ts                 # AgentWorker: LLM conversation + tool loop
│   ├── models.ts                  # Model creation, provider registry
│   ├── types.ts                   # Core types
│   ├── tools/                     # Built-in tool factories
│   │   ├── bash.ts                # Sandboxed bash/readFile/writeFile
│   │   ├── skills.ts              # Skills tool
│   │   └── feedback.ts            # Feedback tool
│   └── skills/                    # Skill loading + importing
│       ├── provider.ts            # SkillsProvider
│       ├── importer.ts            # Git-based skill import
│       └── import-spec.ts         # Import spec parsing
│
├── backends/                      # AI provider adapters
│   ├── types.ts                   # Backend interface
│   ├── index.ts                   # Factory + availability checks
│   ├── model-maps.ts              # Model name translation
│   ├── sdk.ts                     # Vercel AI SDK
│   ├── claude-code.ts             # Claude Code CLI
│   ├── codex.ts                   # Codex CLI
│   ├── cursor.ts                  # Cursor CLI
│   ├── mock.ts                    # Mock (testing)
│   ├── idle-timeout.ts            # Idle timeout management
│   └── stream-json.ts             # JSON streaming utilities
│
└── cli/                           # Independent client (NOT under daemon)
    ├── client.ts                  # HTTP client → daemon REST API
    ├── instance.ts                # CLI instance management
    ├── output.ts                  # Output formatting
    ├── target.ts                  # Target resolution
    └── commands/                  # One file per command group
        ├── agent.ts               # new, list, stop, info
        ├── send.ts                # send, peek, stats, export, clear
        ├── tool.ts                # tool add, import, mock, list
        ├── workflow.ts            # run, start, stop, list
        ├── approval.ts            # pending, approve, deny
        ├── info.ts                # providers, backends
        ├── doc.ts                 # document operations
        ├── feedback.ts            # feedback commands
        └── mock.ts                # mock commands
```

## Dependency Graph

```
cli/ ──── HTTP ────► daemon/
                       │
                       ├──► workflow/
                       │       │
                       │       ├──► workflow/controller/  (AgentController)
                       │       │       └──► agent/        (AgentWorker)
                       │       │
                       │       └──► workflow/context/     (ContextProvider)
                       │
                       └──► backends/                     (backend factory)
```

Rules:
- `cli/` imports nothing from `daemon/` except registry (reading daemon.json)
- `daemon/` imports from `workflow/`, `agent/`, `backends/`
- `workflow/controller/` imports from `agent/`, `workflow/context/`, `backends/`
- `agent/` imports from `backends/` (types only)
- `workflow/context/` imports nothing from other app modules (pure domain)
- No circular dependencies. No upward imports.

## Key Design Decisions

### Why daemon as the top-level service?

Without a daemon, each agent is its own process. N agents = N processes, N sockets, stale registry files when processes crash. With one daemon, there's one process, one HTTP server, one MCP endpoint. Agent lifecycle, health checks, context — all centralized.

### Why one interface, multiple protocols?

CLI and Web UI speak REST. AI tools (Claude Code, Cursor) speak MCP. Both need the same operations (send message, read channel, manage workflows). Implementing the operations once and exposing through multiple protocols eliminates duplication and keeps behavior consistent.

### Why all agents live in workflows?

Eliminates the split between "single-agent daemon" and "multi-agent workflow" code paths. `agent new` creates an agent under `@global` — it's just a 1-agent workflow with simplified CLI ergonomics. The runtime doesn't know or care.

### Why AgentWorker vs AgentController?

Separation of concerns:
- **Session** answers "how to talk to an LLM" — stateful conversation, tool loop, streaming
- **Controller** answers "when to talk and what to do with results" — inbox polling, retry, error recovery

The controller calls `session.send()` when it decides the agent should act. The daemon doesn't do inbox polling — controllers do.

### Why Context lives under workflow/?

Context (channel, inbox, documents, resources) is the collaboration substrate within a workflow. It is exposed to agents via MCP tools and to the daemon for REST/MCP endpoints. The `ContextProvider` interface keeps it backend-agnostic.

---

## Target Architecture

> The following describes the theoretical direction for the system's evolution. It is not the current implementation, but a guiding model that future work can evolve toward.

### Four Primitives

```
Message    — 数据
Proposal   — 逻辑（schema + function，状态转移）
Agent      — 执行者（ToolLoop）
System     — 运行时（提供 tools，驱动求值循环）
```

Tool is the interface System exposes to Agent. Agent is sandboxed — what tools it gets determines what it can do.

### Core Rule

```
message + proposal → message | task
task = agent.execute(prompt, tools, message) → message
```

Message enters. Proposal (state transition function) evaluates. Produces new Message or Task. Task is one Agent execution. Result becomes Message. Cycle continues.

### Proposal — Schema + Function

Proposal is a composable state transition function: receives Message (validated by schema), executes function, produces new Messages or Tasks.

```typescript
interface Proposal<T> {
  schema: Schema<T>;
  execute(data: T, ctx: SystemContext): void;
}
```

Proposals compose — function body can invoke sub-Proposals. YAML/JSON are serialization formats for schema data.

**Workflow as Proposal composition**:

```typescript
const WorkflowProposal = defineProposal({
  schema: WorkflowSchema,
  execute(data, ctx) {
    for (const agent of data.agents) {
      ctx.propose(CreateAgentProposal, agent)
    }
    for (const trigger of data.triggers) {
      ctx.propose(RegisterTriggerProposal, trigger)
    }
  }
})
```

### Agent — ToolLoop

Agent receives `(prompt, tools, message)`, runs LLM tool loop, returns result. Closed system — can only interact via tools. Does not know why it was invoked, what workflow it belongs to, or what happened before.

### System — Runtime

Drives the Message + Proposal evaluation loop. Manages Agent lifecycle. Holds state. Exposes interface to Agents via Tools:

| Tool category | Purpose |
|---------------|---------|
| `channel.*` | Message read/write |
| `space.*` | Space/workflow management |
| `proposal.*` | Proposal operations |
| `auth.*` | Authorization operations |

What tools an Agent gets = what it's authorized to do.

### Emergent Concepts

All other concepts emerge from the four primitives:

| Concept | Emerges from |
|---------|-------------|
| **Routing** | Proposal that routes Message to Agent |
| **Workflow** | Chain of Proposals (each `when` references prior step's completion) |
| **Permission** | Proposal that gates on authorization Message |
| **Authorization** | Special Message type (agent grants a right) |
| **Channel** | Messages accumulating in a Space |
| **Inbox** | Proposal filtering Messages by @mention |
| **Space** | Scoped binding of Proposals + Agents + Messages |
| **Organization** | Space with fixed Proposals + fixed members |

### Current System as Degenerate Case

| Primitive | Current implementation |
|-----------|----------------------|
| **Message** | `ChannelMessage` in `workflow/context/types.ts` |
| **Proposal** | Implicit, hardcoded in controller (inbox polling), approval mechanism, workflow YAML |
| **Agent** | `AgentWorker` in `agent/worker.ts` |
| **System** | `Daemon` in `daemon/daemon.ts` |

Evolution direction: make implicit Proposals explicit (schema + function).

### Evolution Path

**Phase 1 (current)**: System = daemon. Proposal hardcoded in controller. Agent = AgentWorker. Single process, file storage.

**Phase 2**: Define `Proposal<T>` interface. Refactor controller inbox polling, approval mechanism, and workflow YAML parser into explicit Proposals.

**Phase 3**: Composable Proposals. Agent can define new Proposals via `proposal.*` tools. Hot-loading at runtime.

**Phase 4**: Authorization as special Message type. Space as scoped binding. `@global` as default Space.
