# System Design

**Status**: Living document
**Date**: 2026-03-08

---

## What This Is

This is the definitive technical design document for the agent-worker system. It describes what the system is, how it's structured, and why.

This document mixes **current implementation** and **design targets**. Each section is marked:

- **Implemented** — working in code today
- **Partial** — concept exists in code but incomplete or not yet cleanly separated
- **Target** — design goal, not yet implemented

For implementation history, see `packages/agent-worker/docs/architecture/OVERVIEW.md`.
For conceptual design thinking, see `.memory/designs/`.

### Implementation vs Target Summary

| Area | Status |
|------|--------|
| Four-package split | **Implemented** |
| Agent Loop (backends, worker, tools, skills) | **Implemented** |
| Agent Worker (personal context, prompt sections, conversation) | **Implemented** (core) |
| Agent Worker (AgentSession, feature composition, waiting model) | **Target** |
| Workspace (context, loop, factory, runner, MCP, bridge, proposals) | **Implemented** |
| Workspace (plugin system, inbox ownership migration) | **Target** |
| Runtime Host / Interface Layer separation | **Target** (currently mixed in daemon) |
| CLI (commands, target addressing, workflows) | **Implemented** |
| Provider model (pluggable storage, backends) | **Implemented** |
| Feature composition model (agent capabilities) | **Target** |
| Scheduling (priority queue, cooperative preemption) | **Implemented** |
| Channel Bridge + Telegram adapter | **Implemented** |

---

## The Core Question

**How do you make a system of short-lived agents accumulate progress over time?**

Most approaches make agents persistent — giving them memory, learning, identity. We take a complementary stance: **an agent's lifetime is one tool loop**, but the environment it works in is rich and persistent. Continuity lives in shared artifacts (channels, documents, memory) and personal context (soul, notes, todos), not in any individual execution.

This means:
- Agents are **stateless executors** that become capable through context
- **Personal context** (soul, memory, todos) travels with agent identity across sessions
- **Shared context** (channel, inbox, documents) enables collaboration without shared infrastructure
- As models process more context, agents naturally absorb more — without changing code

---

## Architecture

### Four Packages

The system is split into four packages: three internal (`@moniro/*`, not published) and one umbrella (published as `agent-worker`).

```
packages/
├── agent/           → @moniro/agent-loop      Execution primitives
├── worker/          → @moniro/agent-worker     Personal agent runtime
├── workspace/       → @moniro/workspace        Collaboration & orchestration
└── agent-worker/    → agent-worker             Umbrella (CLI + daemon + re-exports)
```

Dependency direction is strictly one-way:

```
@moniro/workspace → @moniro/agent-worker → @moniro/agent-loop
                                              ↑
agent-worker (umbrella) ──── re-exports all ──┘
```

### Six Conceptual Layers

The four packages map to six conceptual layers. The runtime layers (1–3) are cleanly separated into packages. The service layers (4–5) exist conceptually but are currently mixed together in the umbrella's daemon module.

| Layer | Concept | Package | Status |
|-------|---------|---------|--------|
| 1. Agent Loop | Execution runtime | `@moniro/agent-loop` | **Implemented** |
| 2. Agent Worker | Personal agent runtime | `@moniro/agent-worker` | **Implemented** (core); plugin system is **target** |
| 3. Workspace | Collaboration adapter | `@moniro/workspace` | **Implemented** (core); plugin system is **target** |
| 4. Runtime Host | Object ownership & lifecycle | `agent-worker` (daemon/) | **Partial** — mixed into umbrella daemon |
| 5. Interface Layer | Protocol boundary | `agent-worker` (daemon/) | **Partial** — mixed into umbrella daemon |
| 6. CLI | Product surface | `agent-worker` (cli/) | **Implemented** |

Layers 4 and 5 are currently combined in `daemon.ts`. The design target is to separate "who owns runtime objects" (host) from "how protocols access them" (interface). This separation matters for understanding responsibilities even before they become separate modules.

### Layer Isolation Rules

Each layer has strict boundaries about what it knows. The first three are **enforced** by package boundaries. The last three are **design targets** (currently enforced by convention within the umbrella):

- **agent-loop** does not know about workspace, daemon, CLI, or personal context
- **agent-worker** does not know about channels, proposals, or workspace collaboration
- **workspace** does not know about CLI commands or daemon lifecycle
- **runtime-host** does not define agent behavior or collaboration semantics
- **interface-layer** does not own runtime state
- **CLI** does not invent new architectural concepts

> **Current gap**: Inbox is conceptually an agent-worker abstraction (personal input view), but is currently implemented in the workspace package because it was built as part of the collaboration context. The design target is for inbox to be an agent-worker concept with workspace providing the event source.

---

## Layer 1: Agent Loop (`@moniro/agent-loop`)

> **Status: Implemented.** This layer is stable and well-tested.

**One sentence**: Backend-agnostic execution runtime.

**It solves**: "Given a model, tools, and a message — run the agent loop."

### What It Provides

| Component | Purpose |
|-----------|---------|
| `AgentWorker` | Stateful conversation: message history, model config, tool registry, `send()`/`sendStream()` |
| Backend abstraction | Unified `Backend` interface over SDK, Claude CLI, Cursor, Codex, OpenCode, Mock |
| Model resolution | Provider registry, auto-discovery, `createModelAsync()`, gateway/direct/auto formats |
| Tool infrastructure | `createTool()` wrapper, approval workflows, mock support |
| Skills | Git-based skill importing, `createSkillTool()` |
| Agent definition | `AgentDefinition`, `AgentSoul`, `AgentPromptConfig` (pure data types) |

### Backend Capability Model

Different backends have fundamentally different capabilities. This layer explicitly acknowledges the asymmetry:

| Backend | Type | Tool Loop | Step Control |
|---------|------|-----------|-------------|
| Vercel AI SDK | `default` | Full agentic loop | Per-step hooks via `onStepFinish` |
| Claude Code CLI | `claude` | CLI-managed | Limited (whole-run) |
| Cursor Agent | `cursor` | CLI-managed | Limited |
| Codex CLI | `codex` | CLI-managed | Limited |
| OpenCode | `opencode` | CLI-managed | Limited |
| Mock | `mock` | Configurable | Full |

The layer provides a **capability surface**, not a false equivalence.

### Key Types

```typescript
interface Backend {
  readonly type: BackendType;
  send(message: string, options?: { system?: string }): Promise<BackendResponse>;
  abort?(): void;
  isAvailable?(): Promise<boolean>;
}

interface AgentWorkerConfig {
  model: string;          // e.g. "anthropic/claude-sonnet-4-5"
  system: string;         // System prompt
  tools?: Record<string, Tool>;
  maxTokens?: number;     // Default: 4096
  maxSteps?: number;      // Default: 200
}

interface AgentDefinition {
  name: string;
  model: string;
  backend?: BackendType;
  provider?: string | ProviderConfig;
  prompt: AgentPromptConfig;
  soul?: AgentSoul;
  context?: AgentContextConfig;
  schedule?: ScheduleConfig;
}
```

### Model Resolution

Three formats supported:

1. **Gateway**: `anthropic/claude-sonnet-4-5` — routed through AI Gateway
2. **Direct**: `anthropic:claude-sonnet-4-5` — direct provider SDK (lazy-loaded)
3. **Auto**: `"auto"` — scans environment for available providers

Auto-discovery priority: `AGENT_DEFAULT_MODELS` env → Gateway → Anthropic → OpenAI → DeepSeek → Google → Groq → Mistral → XAI.

### What It Does NOT Include

- Personal context (memory, notes, todos) — agent-worker
- Prompt assembly from soul/memory — agent-worker
- Shared context (channel, inbox, documents) — workspace
- Daemon, CLI, lifecycle management — umbrella

---

## Layer 2: Agent Worker (`@moniro/agent-worker`)

> **Status: Implemented** (core capabilities). **Target**: Plugin architecture, AgentSession, structured PromptSection IR, async waiting model.

**One sentence**: Personal agent runtime — makes an executor into a "person".

**It solves**: "How does an agent remember, wait, and carry identity across sessions?"

### What It Provides

| Component | Purpose |
|-----------|---------|
| `PersonalContextProvider` | Pluggable storage for memory, notes, todos |
| `createPersonalContextTools()` | 6 AI SDK tools: `my_memory_read/write`, `my_notes_read/write`, `my_todos_read/write` |
| Prompt sections | `soulSection`, `memorySection`, `todoSection` — composable prompt builders |
| `assemblePersonalPrompt()` | Joins sections into final system prompt addition |
| `ConversationLog` | JSONL-based persistent conversation history |
| `ThinThread` | Bounded in-memory message buffer (default: 10 messages) |
| `createBashTools()` | Bash execution tools for personal agents |

### Personal Context Model

```typescript
interface PersonalContextProvider {
  readMemory?(): Promise<Record<string, unknown>>;
  writeMemory?(key: string, value: unknown): Promise<void>;
  readNotes?(limit?: number): Promise<string[]>;
  appendNote?(content: string, slug?: string): Promise<string>;
  readTodos?(): Promise<string[]>;
  writeTodos?(todos: string[]): Promise<void>;
}

interface PersonalContext {
  soul?: AgentSoul;
  memory?: Record<string, unknown>;
  todos?: string[];
}
```

All methods are optional — an agent without storage simply has no personal context and degrades to a plain executor.

### Prompt Composition

Prompts are built from composable sections, not monolithic string concatenation:

```typescript
type PersonalPromptSection = (ctx: PersonalPromptContext) => string | null;

// Built-in sections
soulSection    // Identity: role, expertise, style, principles
memorySection  // Key-value pairs as markdown list
todoSection    // Active tasks as checkbox list

// Assembly
const prompt = assemblePersonalPrompt(
  [soulSection, memorySection, todoSection],
  { name: "alice", personalContext }
);
```

Each section returns `null` when its data is absent — graceful degradation, not errors.

### Context Layers (Target)

The design target organizes personal context into three tiers:

| Tier | Contents | Update Frequency |
|------|----------|-----------------|
| Background | Soul, personal memory, active todos | Slow (cross-session) |
| Current Input | Inbox batch, pending instructions | Per-turn |
| Runtime Signals | New message alerts, wait cancellation | Real-time |

Currently, the Background tier is implemented (soul/memory/todo sections). Current Input and Runtime Signals are partially implemented — inbox exists at the workspace layer, and there's no formal runtime signal injection yet. The design target is to formalize all three tiers as `PromptSection[]` within agent-worker.

### Storage Layout

```
~/.agent-worker/agents/{name}/
├── memory/              YAML key-value store
├── conversations/       JSONL conversation log
├── notes/               Markdown reflections
└── todo/                Task tracking (index.md)
```

### AgentSession (Target)

`AgentSession` is the design target for this layer's core runtime abstraction. It would express:

- What the agent is currently processing
- Which personal context it entered execution with
- Whether it's waiting for new input
- Whether it received runtime signals during execution

Currently, session-like behavior is split across `AgentLoop` (workspace layer) and `AgentHandle` (umbrella layer). The design target is to consolidate personal session semantics here, with workspace only injecting collaboration context.

### Async Asymmetric Conversation (Target)

The design target supports non-trivial interaction patterns:

- Agent can process first, then reply
- Agent can explicitly wait for next message (`inbox_wait`)
- Agent can be nudged with new input while working
- Agent's execution rhythm doesn't need to match external message rhythm

This is the existence justification for `AgentSession` and `WaiterRegistry` (both target, not yet implemented in agent-worker).

### Feature Composition Model (Target)

Agent capabilities are composed from explicit features, not hardcoded. agent-loop provides bare execution (model + tools + loop); everything else is opt-in via features:

```typescript
interface AgentFeature {
  name: string;
  sections?: PromptSection[];       // Prompt contributions
  mcpTools?: McpToolDef[];          // MCP tools to register
  tools?: ToolSpec[];               // AI SDK tools
  skills?: SkillSpec[];             // Skill imports
  beforeStep?: (ctx: StepContext) => StepMutation | void;
  afterStep?: (ctx: StepContext) => void;
}
```

Each feature contributes across multiple dimensions (prompt + tools + step hooks). Features come in two kinds:

**Built-in features** — always present, with customization points:
```typescript
soul(definition)                          // Default rendering
soul(definition, { render: customFn })    // Custom prompt template

todo(handle)                              // Default file-based storage
todo(handle, { store: inMemoryStore })    // Custom storage implementation

inbox(source)                             // Async interaction: inbox_wait, inbox_ack tools
                                          // Customizable: message source, filters
```

**Optional features** — explicit opt-in:
```typescript
const loop = createAgentLoop({
  ...config,
  // Built-in (soul, todo) included automatically, customizable via config
  // Optional features declared explicitly:
  features: [
    memory(handle),
    conversation(log),
    workspace(provider),
    bash({ cwd: dir }),
  ],
});
```

Feature determines capability; provider/config within the feature determines implementation.

**Not a plugin system**: no registry, no dynamic loading, no session lifecycle. Static composition at creation time. When AgentSession lands, features can extend with session hooks.

### What It Does NOT Include

- Channel collaboration — workspace
- Proposal / voting — workspace
- Shared documents — workspace
- Daemon lifecycle — umbrella

---

## Layer 3: Workspace (`@moniro/workspace`)

> **Status: Implemented** (core: context, loop, factory, runner, bridge, parser, MCP server, proposals). **Target**: Workspace plugin system, clean separation from agent-worker inbox.

**One sentence**: Collaboration adapter — connects personal agents to shared environments.

**It solves**: "How do agents collaborate through shared channels, documents, and tools?"

### What It Provides

| Component | Purpose |
|-----------|---------|
| Workflow parser | YAML → typed config with validation |
| Factory | `createMinimalRuntime()`, `createWiredLoop()` |
| Runner | `runWorkflow()`, `runWorkflowWithLoops()` |
| `AgentLoop` | Per-agent lifecycle: poll → run → ack → retry (state machine) |
| `ContextProvider` | Shared context: channel, inbox, documents, resources, proposals |
| MCP context server | Standard MCP server exposing workspace tools to agents |
| `ChannelBridge` | Event-driven channel with external platform adapters |
| `InstructionQueue` | Three-lane priority queue with cooperative preemption |
| Collaboration prompt sections | `activitySection`, `inboxSection`, `documentSection` |
| Display | Channel watcher, pretty printing |

### Three-Layer Shared Context

```
┌──────────────┐   ┌──────────────────┐   ┌─────────────────┐
│    INBOX     │   │     CHANNEL      │   │    DOCUMENT     │
│  "What's     │   │  "What happened  │   │  "What are we   │
│   for me?"   │   │   so far?"       │   │   working on?"  │
└──────────────┘   └──────────────────┘   └─────────────────┘
```

| Layer | Purpose | Persistence | Access |
|-------|---------|-------------|--------|
| Inbox | Unread @mentions for this agent | Transient (read tracking) | Pull: check when waking |
| Channel | Append-only communication log | Permanent | Read: full history |
| Document | Structured workspace | Editable | Read/write: owner or all |

Storage is pluggable: `FileContextProvider` (production) or `MemoryContextProvider` (testing).

### Channel and Inbox Boundary

This is the most critical boundary in the collaboration layer:

```
channel message
  → workspace routing (mention parsing, priority classification)
  → agent inbox

agent output
  → workspace tool (channel_send)
  → channel
```

Channel belongs to workspace. Inbox belongs to agent-worker conceptually (currently implemented at workspace level — see gap note above). They are not the same thing.

### Delivery Semantics

Workspace defines how collaboration messages reach agents:

| Pattern | Trigger | Priority | Effect |
|---------|---------|----------|--------|
| Push | @mention, DM | `immediate` | Wake agent, preempt low-priority work |
| Pull | Channel history | `background` | Readable on demand, no interruption |

This mixed model is deliberate — not all collaboration messages warrant the same treatment.

### Channel Bridge (Implemented)

External platforms connect through the `ChannelBridge` → `ChannelAdapter` pattern:

```
External Platforms              Internal System
─────────────────               ───────────────
Telegram ──┐                    ┌── agent (channel_send)
Slack    ──┼── Adapter ──┐     │
Discord  ──┘              │     │
                          ▼     ▼
                    ChannelBridge
                   ┌─────────────────┐
                   │  subscribe()    │ → push to subscribers
                   │  send()         │ → inject into channel
                   │  EventEmitter   │ → in-process events
                   └────────┬────────┘
                            │
                    ChannelStore (append-only JSONL)
```

Anti-echo: adapters mark messages with `source: "telegram"` — bridge won't push the same message back to the originating adapter.

Identity: `platform:display_name` format (e.g., `telegram:Alice`). No user system, no ACL.

### Instruction Queue & Scheduling (Implemented)

Three priority lanes with cooperative preemption:

```
immediate  ← DM, @mention, urgent signals
normal     ← regular work items
background ← scheduled wakeups, non-directed signals
```

Rules:
- Lanes have strict priority ordering
- Within a lane: FIFO
- Higher priority can preempt at step boundaries (cooperative, not hard kill)
- Preempted work preserves progress and can resume

Preemption boundaries: step end, waiter cancellation, tool call return.

### @mention Routing

```
channel.append("@reviewer check this code")
  │
  ├── Parse @mentions → ["reviewer"]
  ├── Deliver to reviewer's inbox
  └── loop.wake("reviewer")  ← near-real-time response
```

The `wake()` call turns a polling system into a reactive one. No special addressing layer — routing is embedded in natural language.

### Workspace Plugin Architecture (Target)

Workspace also needs its own plugin surface, separate from agent-worker plugins:

```typescript
interface WorkspacePlugin {
  name: string;
  promptSections?(ctx: WorkspacePromptContext): PromptSection[];
  tools?(ctx: WorkspaceToolContext): ToolSpec[];
  onMessageRoute?(ctx: MessageRouteContext): MessageRouteMutation | void;
  onWorkspaceEvent?(ctx: WorkspaceEventContext): void;
}
```

Current workspace capabilities (channel, proposal, bridge, team) would become built-in workspace plugins. The key boundary: agent plugins define personal runtime behavior; workspace plugins define collaboration runtime behavior.

### Proposal & Voting

Structured decision-making for multi-agent coordination:

| Type | Use |
|------|-----|
| `election` | Document owner, coordinator role |
| `decision` | Design choices, approach selection |
| `approval` | Merge sign-off, release gates |
| `assignment` | Task allocation |

Resolution rules: plurality, majority, or unanimous. Binding proposals are system-enforced; advisory proposals rely on agent cooperation.

### Workspace YAML Configuration

```yaml
name: review

agents:
  alice: { ref: alice }                          # Reference existing agent
  reviewer:                                       # Inline agent definition
    model: anthropic/claude-sonnet-4-5
    system_prompt: prompts/reviewer.md
    tools: [bash, read]

context:
  provider: file                                  # or "memory" for testing
  config:
    bind: ./.state/review                        # persistent (vs dir: ephemeral)

params:
  - name: target
    type: string
    required: true

setup:
  - shell: git diff ${{ params.target }}
    as: diff

channels:
  - adapter: telegram
    bot_token: ${{ env.TELEGRAM_BOT_TOKEN }}
    chat_id: ${{ env.TELEGRAM_CHAT_ID }}

kickoff: |
  ${{ diff }}
  @alice Review this change.
```

**Variable model**: `${{ env.VAR }}`, `${{ params.name }}`, `${{ workflow.name }}`, `${{ workflow.tag }}`, `${{ source.dir }}`, `${{ setup_output_name }}`.

**Source support**: local file, `github:owner/repo@ref/path`, `github:owner/repo#shorthand`.

**Agent entries**: ref agents (reuse identity, patch prompt/limits) vs. inline agents (full definition, workflow-local).

### What It Does NOT Include

- Agent identity / personal context — agent-worker
- Backend execution — agent-loop
- CLI commands — umbrella
- Daemon lifecycle — umbrella

---

## Layer 4–5: Runtime Host & Interface Layer (Umbrella)

> **Status: Partial.** Both layers exist functionally in `daemon.ts`, but are not separated. The design target is conceptual clarity first — physical separation later (if/when needed).

Currently implemented together in the umbrella package's `daemon/` module. Conceptually they are two distinct concerns.

### Runtime Host (Layer 4)

**One sentence**: Host/control plane for runtime objects.

**It solves**: "Who owns the agent, workspace, and workflow objects, and manages their lifecycle?"

The daemon currently acts as runtime host:

```typescript
interface DaemonState {
  agents: AgentRegistry;
  defaultWorkspace: Workspace | null;        // lazy-created, shared
  config: ParsedWorkflow | null;
  workflows: Map<string, WorkflowHandle>;    // keyed by "name:tag"
  store: StateStore;
  server: ServerHandle;
}
```

**Core responsibilities**:
- Agent registry (load from config.yml, create ephemeral via API)
- Default workspace (shared by all standalone agents, lazy-created)
- Workflow lifecycle (start → hold → stop, isolated per workflow)
- Background adapters (channel bridges from config)
- Persistence (daemon.json for discovery, events.jsonl for audit)

**State ownership** — five categories that must not be confused:

| Category | Owner | Examples | Persistence |
|----------|-------|----------|-------------|
| Agent-owned | agent-worker | Soul, memory, notes, todos, conversation | Cross-session |
| Workspace-owned | workspace | Channel, documents, proposals | Per-instance (bind = persistent) |
| Workflow-owned | orchestration | Definition, params, kickoff, agent assignment | Definition persistent, instance ephemeral |
| Host-owned | daemon | Registries, handles, server refs | Process-scoped |
| Transport-owned | interface | MCP/HTTP/SSE sessions | Connection-scoped, disposable |

**Critical rules**:
- Personal state doesn't become workspace state just because it's used there
- Transport state is disposable — connection loss ≠ runtime state loss
- Host state is operational, not business — don't expose it as domain model

### Interface Layer (Layer 5)

**One sentence**: Protocol boundary for accessing shared runtime state.

**It solves**: "How do CLI, API, MCP, and future Web UI share the same system state without interfering?"

Current HTTP endpoints (on the daemon):

| Method | Endpoint | Purpose |
|--------|----------|---------|
| GET | `/health` | Status, agents, workflows, uptime |
| POST | `/shutdown` | Graceful shutdown |
| GET/POST/DELETE | `/agents[/:name]` | Agent CRUD |
| POST | `/run` | Send message, SSE streaming response |
| POST | `/serve` | Send message, sync JSON response |
| ALL | `/mcp` | Model Context Protocol sessions |
| GET/POST/DELETE | `/workflows[/:name/:tag]` | Workflow lifecycle |

**Session types** that must be distinguished:

1. **Protocol session** — MCP transport, HTTP stream, SSE connection
2. **Runtime session** — Agent execution, workspace interaction
3. **User interaction session** — CLI invocation, UI request

Conflating these leads to bugs: "connection dropped" ≠ "agent stopped" ≠ "request finished".

**Daemon discovery**: `~/.agent-worker/daemon.json` with `{ pid, host, port, token }`. Clients read this to find the daemon. Auth via per-instance random token.

### Target: RuntimeHost Interface

The design target for a clean runtime host abstraction:

```typescript
interface RuntimeHost {
  readonly agents: AgentRegistryView;
  readonly workspaces: WorkspaceRegistryView;
  readonly workflows: WorkflowRegistryView;

  start(): Promise<void>;
  shutdown(): Promise<void>;

  ensureDefaultWorkspace(): Promise<WorkspaceHandle>;
  createWorkspace(input: CreateWorkspaceInput): Promise<WorkspaceHandle>;
  stopWorkspace(key: WorkspaceKey): Promise<void>;

  loadAgent(input: LoadAgentInput): Promise<AgentHandle>;
  createEphemeralAgent(input: CreateEphemeralAgentInput): Promise<AgentHandle>;
  unloadAgent(name: string): Promise<void>;

  startWorkflow(input: StartWorkflowInput): Promise<WorkflowHandle>;
  stopWorkflow(key: WorkflowKey): Promise<void>;
}
```

This separates ownership (host) from protocol handling (interface layer). Currently both are in `daemon.ts`. The separation may remain conceptual or become physical as complexity grows.

---

## Layer 6: CLI

> **Status: Implemented.** Commands are stable and functional. Some commands (schedule, proposal) are not yet exposed.

**One sentence**: Product surface — exposes stable concepts, not implementation leakage.

**It solves**: "How does a human interact with the system through commands?"

### Command Groups

#### Lifecycle
```bash
agent-worker onboard              # Create config.yml template
agent-worker up [-f] [--port]     # Start daemon (background or foreground)
agent-worker down                 # Stop daemon
agent-worker status [--json]      # Daemon + agents + workflows
```

#### Interaction
```bash
agent-worker ask <agent> <message> [--no-stream]   # Sync request/response
agent-worker send <target> <message>                # Async channel message
agent-worker peek [target] [-n COUNT] [--all]       # Read channel history
```

`ask` and `send` are deliberately separate — sync vs async are different mental models.

#### Agent Management
```bash
agent-worker new <name> [-m model] [-b backend]    # Create ephemeral agent
agent-worker rm <name>                              # Remove ephemeral only
agent-worker ls [--json]                            # List agents
agent-worker stop <name|@workspace[:tag]>           # Stop agent or workflow
```

Config agents are managed via `config.yml`, not `rm`.

#### Workflows
```bash
agent-worker run <file> [--tag] [-- params...]     # One-shot, CLI waits
agent-worker start <file> [--tag] [-- params...]   # Daemon-owned, long-lived
```

`run` = caller-owned lifecycle. `start` = daemon-owned lifecycle. Workflow file is the product boundary — users don't manually create workspaces.

#### Documents & Diagnostics
```bash
agent-worker doc read|write|append <target>
agent-worker providers                              # Provider env status
agent-worker backends                               # Backend availability
```

### Target Addressing

```
alice                    → agent in global workspace
alice@review             → agent in review workspace
alice@review:pr-123      → agent in tagged workspace instance
@review                  → workspace-level target
@review:pr-123           → tagged workspace instance
```

Display rules: omit `@global`, omit empty `:tag`.

### Two Operating Modes

| Mode | Commands | Requires Daemon |
|------|----------|----------------|
| Daemon-backed | up, down, status, new, rm, ls, ask, start, stop | Yes |
| File-backed | send, peek, doc | No — works directly on context files |

File-backed commands working without a daemon is a valuable product feature.

---

## Cross-Cutting Mechanisms

### Features vs Providers

> **Provider model: Implemented** (PersonalContextProvider, ContextProvider, StorageBackend, Backend, StateStore). **Feature composition: Target** — the `AgentFeature` interface is the design target for agent capability composition.

Two distinct extension mechanisms that must not be confused:

```
Features change what the agent can do.
Providers change what the system is built on.
```

**Features** compose agent capabilities — each feature bundles prompt sections, tools, skills, and step hooks into a single opt-in unit. Features are declared at agent creation time, not registered dynamically.

**Providers** replace implementations — swapping file storage for Redis, SDK backend for CLI, local transport for HTTP. They change the substrate.

| Layer | Feature Examples | Provider Examples |
|-------|-----------------|-------------------|
| agent-loop | — | Execution backends, model providers |
| agent-worker | soul, todo, memory, conversation, bash | PersonalContextProvider (file/memory/redis) |
| workspace | workspace (channel + team + proposal tools) | ContextProvider (file/memory), StorageBackend |
| runtime-host | — | StateStore (memory/file) |
| interface-layer | — | Transport (HTTP/MCP/SSE) |

### Unified Timeline

All system events share a compatible append-only model:

- `DaemonEventLog` — daemon-level JSONL (`events.jsonl`)
- `ChannelStore` — workspace channel JSONL (`channel.jsonl`)
- `EventLog` — workspace event log
- `TimelineStore` — unified read interface

Same `Message` format enables cross-layer timeline merge for debugging and audit.

### Factory Composition

Runtime objects are assembled through composable primitives, not monolithic constructors:

```typescript
// Workspace layer provides composable factories
const runtime = await createMinimalRuntime(config);
// → { context, mcpServer, eventLog }

const loop = await createWiredLoop(runtime, agentDef);
// → { backend, workspace, loop }
```

The daemon uses these same primitives — it orchestrates creation and ownership, not construction.

---

## Design Principles

These emerged from building the system, not the other way around:

| Principle | Expression |
|-----------|------------|
| Backends are dumb pipes | Backend only knows `send()`. Orchestration is above. |
| Context answers cognitive questions | Inbox (what's for me), Channel (what happened), Document (what we're building) |
| Agent/Workspace/Workflow are orthogonal | Agent = identity. Workspace = collaboration. Workflow = orchestration. |
| Ack on success only | Inbox acknowledgment after successful run = exactly-once with retry |
| No distinction between 1 and N agents | Single agent = 1-agent workflow under `@global` |
| Files are truth, databases are indexes | Markdown/YAML authoritative; SQLite is acceleration |
| Personal state doesn't move into workspace | "Used there" ≠ "owned by" |
| Transport state is disposable | Connection loss ≠ runtime state loss |

### Three Orthogonal Concepts

```
Agent     = persistent identity + personal context
Workspace = collaboration space (channel, documents, proposals)
Workflow  = orchestration definition (agent assignment, setup, kickoff)
```

A workspace is not a workflow. An agent is not a workspace member. These compose freely:
- An agent can exist without any workspace
- A workspace can host agents from different definitions
- A workflow instantiates a workspace and assigns agents

---

## Import Conventions

| Context | Convention | Example |
|---------|-----------|---------|
| Between packages | Internal package name | `from "@moniro/agent-loop"` |
| Within a package | `@/` path alias | `from "@/context/types.ts"` |
| Same directory | Relative | `from "./types.ts"` |

---

## Appendix: File Layout

### Global Root

```
~/.agent-worker/
├── config.yml              Daemon config (workflow YAML format)
├── daemon.json             Daemon discovery (pid, port, token)
├── events.jsonl            Daemon event log
├── channel.jsonl           Default workspace channel
├── documents/              Default workspace documents
├── _state/                 Default workspace internal state
└── agents/
    ├── alice/              Personal context
    │   ├── memory/
    │   ├── conversations/
    │   ├── notes/
    │   └── todo/
    └── bob/
```

### Named Workspaces

```
~/.agent-worker/workspaces/
├── review/                 No tag
├── review@pr-123/          With tag
└── monitor/
```

Path reveals ownership:
- `channel.jsonl`, `documents/`, `_state/` → shared workspace state
- `agents/{name}/` → personal agent state

---

## Appendix: Current Package Exports

### `@moniro/agent-loop` (packages/agent/)

Core execution: `AgentWorker`, `Backend`, `createBackend`, `createModelAsync`, `createTool`, `SkillImporter`, `AgentDefinition`, `AgentSoul`.

### `@moniro/agent-worker` (packages/worker/)

Personal runtime: `PersonalContextProvider`, `createPersonalContextTools`, `soulSection`, `memorySection`, `todoSection`, `assemblePersonalPrompt`, `ConversationLog`, `ThinThread`, `createBashTools`.

### `@moniro/workspace` (packages/workspace/)

Collaboration: `createMinimalRuntime`, `createWiredLoop`, `runWorkflow`, `parseWorkflowFile`, `createAgentLoop`, `InstructionQueue`, `ChannelBridge`, `ContextProvider`, `createContextMCPServer`, `ProposalManager`, `buildAgentPrompt`.

### `agent-worker` (packages/agent-worker/)

System layer: `startDaemon`, `AgentHandle`, `AgentRegistry`, `DaemonEventLog`, `readDaemonInfo`. Re-exports `AgentWorker`, `createSkillTool` from agent-loop.
