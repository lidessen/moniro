# agent-worker Architecture

## Vision

An event-driven execution platform where agents, humans, and contracts collaborate through a unified protocol. The daemon is the execution environment — like an OS kernel for AI workflows.

```
                        ┌──────────────────────────────────────┐
                        │              Daemon                  │
                        │                                      │
   REST ───────────────►│  ┌────────────────────────────────┐  │
                        │  │         Service Layer          │  │
   MCP ────────────────►│  │   (one interface, N protocols) │  │
                        │  └──────────┬─────────────────────┘  │
   WebSocket ──────────►│             │                        │
                        │             ▼                        │
                        │  ┌──────────────────────┐            │
                        │  │      Event Bus       │            │
                        │  │                      │            │
                        │  │  mention  ─────┐     │            │
                        │  │  user_msg ─────┤     │            │
                        │  │  cron     ─────┤     │            │
                        │  │  approval ─────┘     │            │
                        │  └──────────┬───────────┘            │
                        │             │                        │
                        │      ┌──────┴──────┐                 │
                        │      ▼             ▼                 │
                        │  Contracts     Supervisors           │
                        │  (govern)      (schedule)            │
                        │      │             │                 │
                        │      ▼             ▼                 │
                        │  ┌──────────────────────┐            │
                        │  │     Executors        │            │
                        │  │  (prompt, tools) → ● │            │
                        │  └──────────┬───────────┘            │
                        │             │                        │
                        │             ▼                        │
                        │         Context                      │
                        │  (channels, docs, resources)         │
                        └──────────────────────────────────────┘

  CLI ─────── REST ──────────► Daemon
  Web UI ──── REST + WS ─────► Daemon
  AI Tool ─── MCP ───────────► Daemon
  Human ───── REST/WS ────────► Daemon  (human-as-agent)
```

## Core Model

### Everything is an Event

The system is fundamentally event-driven. Every trigger that causes an agent to act is an event:

| Event | Source | Example |
|-------|--------|---------|
| `mention` | Another agent @mentions this one | `@reviewer please check PR #42` |
| `user_message` | Human sends a message | CLI `send`, Web UI chat |
| `cron` | Time-based trigger | `every 30m: check inbox` |
| `approval` | Contract resolution | `deploy approved by 2/3 voters` |
| `webhook` | External system | GitHub push, Slack message |

There is no "inbox polling." Events enter a bus; subscribers consume them. The bus is the single source of truth for "what happened."

### Executor — Stateless Execution

An Executor is a single tool-loop execution. It receives a prompt and tools, runs to completion, and returns a result. It does not know:

- Why it was invoked
- What workflow it belongs to
- What other agents exist
- What happened before (except via system prompt)

```
Executor = (system_prompt, tools, message) → result
```

Context is provided entirely through **system prompt** (what you know) and **tools** (what you can do). The executor doesn't "have context" — it receives context as inputs. This is critical: an executor is a pure function over an LLM call.

This maps to any backend: AI SDK tool loop, Claude Code CLI, Codex CLI, a human reading a prompt and typing a response. The interface is the same.

```typescript
interface Executor {
  execute(config: {
    systemPrompt: string;
    tools: Tool[];
    message: string;
  }): AsyncGenerator<Chunk, Result>;
}
```

(Currently `AgentSession` in `src/agent/session.ts`)

### Supervisor — Lifecycle Management

A Supervisor manages the lifecycle of one agent identity across multiple executions. It answers "when to execute" and "what to do with results":

1. Subscribe to events from the bus
2. When an event arrives → build prompt with context → create Executor → run
3. On completion → write result to context → emit events (if @mentions)
4. On failure → retry with backoff
5. State machine: `idle → executing → idle → ...`

The Supervisor is stateful (it is an agent's persistent identity), but each execution it spawns is stateless.

```
Supervisor
  ├── subscribes to: Event Bus (filtered by relevance)
  ├── creates: Executor (per invocation)
  ├── reads/writes: Context (channels, docs, resources)
  └── state: idle | executing | stopped
```

(Currently `AgentController` in `src/workflow/controller/controller.ts`)

### Context — The World

Context is the shared substrate that gives agents their world. It is the only state that persists across executions.

| Primitive | Purpose |
|-----------|---------|
| **Channel** | Append-only message log. The communication backbone. |
| **Inbox** | Per-agent filtered view of channel (derived from @mentions) |
| **Resources** | Content-addressed blob storage (files, images, large text) |
| **Documents** | Shared workspace files (team docs, scratch pads) |
| **Proposals** | Voting mechanism for collaborative decisions |

Agents interact with context exclusively via **tools** — `channel_send`, `channel_read`, `my_inbox`, `team_doc_*`, `resource_*`, etc. An executor never directly accesses context; it calls tools that the supervisor provided.

Context is backend-agnostic: `ContextProvider` interface with pluggable storage (`FileContextProvider`, `MemoryContextProvider`, future: distributed).

### Contracts — Governance

A Contract is a declarative rule that governs system behavior. Contracts unify what are traditionally separate systems:

| Traditional Concept | As a Contract |
|--------------------|---------------|
| **Permission** | "Agent X may execute bash commands" |
| **Approval flow** | "Deployments require 2/3 team vote" |
| **Workflow routing** | "When PR opened → route to @reviewer then @coder" |
| **Rate limiting** | "Agent X may send at most 10 messages per hour" |
| **Escalation** | "If cost > $5, require human approval" |

A contract has three defining properties:

1. **Human-describable** — A non-technical person can read and understand what it does
2. **Agent-generatable** — An AI agent can author contracts from natural language requirements
3. **Hot-loadable** — Contracts can be added, modified, or removed at runtime without restarting

```typescript
interface Contract {
  id: string;
  name: string;                    // Human-readable name
  description: string;             // Natural language description
  condition: EventPattern;         // When does this contract apply?
  action: ContractAction;          // What does it do?
  scope: OrganizationId | 'global';
}

// Examples:
// { condition: "bash_tool_call", action: "require_approval(agent.creator)" }
// { condition: "deploy_*", action: "require_votes(2, org.members)" }
// { condition: "pr_opened", action: "route(@reviewer, @coder)" }
```

The daemon is the contract execution environment — like a blockchain runtime, but centralized and practical. Contracts are evaluated against events; when conditions match, actions execute.

### Organization — Crystallized Collaboration

An Organization is a group with shared governance: fixed contracts, established workflows, relatively stable membership.

```
Organization = Contracts + Members + Context
```

| Component | Purpose |
|-----------|---------|
| **Contracts** | The rules everyone agrees to |
| **Members** | Agents and humans in the group |
| **Context** | Shared channels, docs, resources |

`@global` is the degenerate organization: zero contracts, anyone can join, no governance. It's the default workspace where standalone agents live.

A named organization like `@review-team` has contracts ("PRs require reviewer + coder", "deployments need 2/3 approval"), fixed members (`@reviewer`, `@coder`, `@lead`), and shared context (review channel, standards doc).

Organizations form naturally: start with ad-hoc collaboration in `@global`, notice patterns, solidify them into contracts, name the group. The path from chaos to structure is:

```
@global (zero contracts)
  → ad-hoc patterns emerge
    → formalize as contracts
      → name the group → Organization
```

### Workflow — Solidified Event Patterns

A Workflow is a specific pattern of event routing within an organization. It defines "when X happens, do Y then Z":

```yaml
name: code-review
trigger: pr_opened
steps:
  - agent: reviewer
    on: trigger
    action: review PR, post findings to #review
  - agent: coder
    on: reviewer.complete
    action: address findings, push fixes
  - agent: reviewer
    on: coder.complete
    action: verify fixes, approve or request changes
```

Workflows are contracts with temporal ordering. The difference is conceptual, not technical — a workflow is a set of routing contracts that form a directed graph.

### Humans as Agents

A human interacts with the system through the same interface as an AI agent:

- **Inbox**: events/mentions addressed to them
- **Tools**: REST/WebSocket endpoints to read context, post messages, vote on proposals
- **Execution**: human reads prompt (inbox message), performs actions (via tools), posts result

The supervisor for a human agent simply waits for external input instead of spawning an executor. From the system's perspective, a human is a slow agent with high-quality judgment.

## Current Implementation

The system today implements a subset of this vision:

```
src/
├── daemon/                     # The service
│   ├── daemon.ts               # Process lifecycle, HTTP server, routes
│   ├── handler.ts              # Request handler (legacy, being absorbed into service)
│   ├── server.ts               # Hono app: REST + MCP + WebSocket
│   ├── service.ts              # Service layer operations
│   └── discovery.ts            # Read/write daemon.json
│
├── workflow/                   # Workflow execution
│   ├── manager.ts              # Workflow instance management
│   ├── runner.ts               # Single workflow execution
│   ├── controller/             # Agent lifecycle (→ future: supervisor/)
│   │   └── controller.ts       # Poll → run → ack → retry
│   ├── parser.ts               # YAML workflow definitions
│   ├── interpolate.ts          # Variable interpolation (${{ }})
│   └── prompt.ts               # Prompt building from context
│
├── agent/                      # Execution engine (→ future: executor/)
│   ├── session.ts              # LLM conversation + tool loop
│   ├── models.ts               # Model creation, provider registry
│   ├── types.ts                # Core types
│   ├── tools/                  # Built-in tool factories
│   └── skills/                 # Skill loading + importing
│
├── context/                    # Shared storage
│   ├── provider.ts             # ContextProvider interface
│   ├── file-provider.ts        # File-based storage
│   ├── memory-provider.ts      # In-memory (testing)
│   ├── mcp-tools.ts            # Context MCP tool definitions
│   ├── proposals.ts            # Voting system (→ future: contracts)
│   └── types.ts                # Channel, inbox, document types
│
├── backends/                   # AI provider adapters
│   ├── types.ts                # Backend interface
│   ├── index.ts                # Factory + availability
│   ├── sdk.ts                  # Vercel AI SDK
│   ├── claude-code.ts          # Claude Code CLI
│   ├── codex.ts                # Codex CLI
│   ├── cursor.ts               # Cursor CLI
│   └── mock.ts                 # Mock (testing)
│
└── cli/                        # Client (NOT under daemon)
    ├── client.ts               # HTTP client → daemon REST API
    └── commands/               # One file per command group
```

### What Exists vs What's Planned

| Vision Concept | Current State | Gap |
|----------------|---------------|-----|
| **Daemon** | Hono + Bun.serve, REST + WS + MCP | Solid foundation |
| **Service Layer** | REST routes + MCP expose same ops | Need formal service interface |
| **Event Bus** | Inbox polling in controller | Replace polling with pub/sub |
| **Executor** | AgentSession (stateful, knows history) | Extract stateless execution core |
| **Supervisor** | AgentController (poll + run + ack) | Rename, subscribe to bus instead of poll |
| **Context** | Channels, docs, resources, proposals | Complete. Add event sourcing later. |
| **Contracts** | Approval mechanism (ad-hoc) | Need contract engine |
| **Organizations** | Workflows with named groups | Need contract binding |
| **Human-as-agent** | Not implemented | Need human supervisor variant |

## Dependency Graph

```
cli/ ──── HTTP ────► daemon/
                       │
                       ├──► workflow/
                       │       │
                       │       ├──► agent/     (Executor)
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

## Evolution Path

### Phase 1: Current (Done)

Daemon as HTTP service with REST, WebSocket, and MCP. Agent lifecycle managed by controller with inbox polling. Single-process, file-based context.

### Phase 2: Naming + Extraction

Align code with architecture concepts:
- `AgentSession` → `AgentRuntime` (then extract stateless `Executor` interface)
- `AgentController` → `AgentSupervisor`
- Extract `service.ts` as the formal service layer (all operations, protocol-agnostic)
- Move `handler.ts` logic into service layer

### Phase 3: Event Bus

Replace inbox polling with event-driven architecture:
- Introduce `EventBus` with typed events and subscriptions
- Supervisors subscribe to events instead of polling inbox
- User messages, cron triggers, mentions all become events
- Context writes emit events (channel_send → `mention` event)

### Phase 4: Contracts

Introduce declarative governance:
- Define `Contract` type (condition + action + scope)
- Contract engine evaluates contracts against events
- Migrate approval mechanism to contract form
- Workflow YAML definitions become contract sets
- Hot-loading: add/modify contracts without restart

### Phase 5: Organizations

Formalize group governance:
- Organization = contracts + members + context
- `@global` as default (zero-contract) organization
- Named organizations with bound contracts
- Human members alongside agent members

## Key Design Decisions

### Why event-driven?

Polling creates coupling: the supervisor must know about inbox structure, timing, and filtering. Events invert this: things happen, interested parties react. This naturally supports distribution (events can cross process boundaries), extensibility (new event types don't require changes to existing code), and human participation (humans emit and consume events too).

### Why stateless executors?

An executor that knows its history, context, and purpose is hard to test, hard to distribute, and hard to replace. An executor that receives `(prompt, tools, message)` and returns a result is a pure function — test it with mocks, run it anywhere, swap the backend without touching the supervisor. Context is managed by the supervisor and injected via tools, not embedded in the executor.

### Why contracts instead of a permission system?

A "permission system" implies a fixed taxonomy of allow/deny rules. Contracts are more general: they can express permissions, approval flows, routing rules, rate limits, escalation policies — anything that governs behavior. And because they're human-describable and agent-generatable, they can evolve with the organization rather than being hardcoded by developers.

### Why organizations?

Without organizations, governance is per-workflow — scattered and duplicated. Organizations provide a named scope for contracts, a stable membership list, and shared context. They're the natural unit of "a team that works together with agreed-upon rules." `@global` exists so you don't need an organization for simple use cases.

### Why humans as agents?

If humans and AI agents use different interfaces, every feature must be built twice. If humans are agents (with the same inbox, tools, and event protocol), the system is automatically collaborative. A human can join a workflow, vote on proposals, review code — all through the same mechanisms agents use.
