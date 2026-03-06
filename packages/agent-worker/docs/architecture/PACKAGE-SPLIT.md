# Architecture: Three-Package Split

**Date**: 2026-03-02
**Status**: Accepted
**Amended**: 2026-03-06 — Layer boundaries redefined (see ADR `2026-03-06-three-layer-restructuring.md`)
**Depends on**: AGENT-TOP-LEVEL phases 0–3c (all done)

---

## Problem

Everything lives in one `packages/agent-worker/` package. This conflates three distinct use cases:

1. **Fire-and-forget agent** — Create an agent, send a message, get a response. Like `agent-browser`. No persistence, no workflow, no daemon.
2. **One-shot workflow** — Parse a YAML workflow, run multiple agents with shared context, collect results. No daemon needed.
3. **Persistent service** — Long-running daemon with agent lifecycles, conversation history, priority queues, CLI.

A user who wants (1) must install the entire daemon, CLI, and workflow engine. The dependency graph is flat when it should be layered.

## Decision

Split into three packages with strict downward-only dependencies:

```
@moniro/workspace        ← 协作空间（channel, inbox, shared docs, guard）
    ▲
    │
agent-worker ────────┐   ← 个人 agent（身份, 记忆, 调度, daemon, CLI）
    │                │
    ▼                │
@moniro/agent ───────┘   ← 纯执行循环（backends, tool loop, MCP/skills 协议）
```

Each layer has a clear cognitive role:

| Layer | Concept | Role |
|-------|---------|------|
| **Agent Loop** (`@moniro/agent`) | 执行一次对话循环 | backends, tool loop, MCP/skills 协议支持, model mgmt |
| **Agent Worker** (`agent-worker`) | 让执行器变成"人" | 身份, 记忆, personal tools, prompt 组装, scheduling, daemon, CLI |
| **Workspace** (`@moniro/workspace`) | 让"人"们协作 | channels, inbox, shared docs, guard, MCP server |

### Dependency Rule

- Agent Loop: zero project-internal deps
- Agent Worker: depends on Agent Loop
- Workspace: depends on Agent Loop (for execution); Agent Worker provides agents to workspace via MCP

---

## Package 1: `@moniro/agent` — Agent Loop

**Use case**: Execute a single conversation loop. Give it a system prompt, tools, and a message; get a response. No identity, no memory, no scheduling.

### What it provides

- **AgentWorker** — Stateful ToolLoop: conversation history, model config, tool registry, `send()` / `sendStream()`
- **Backend abstraction** — Unified interface over AI SDK, Claude CLI, Codex CLI, Cursor CLI, mock
- **Model creation** — Provider registry, model maps, `createModelAsync()`
- **Tool infrastructure** — Tool creation helpers, registration interface, approval flow
- **MCP protocol support** — Basic MCP client capabilities (tool discovery, tool invocation)
- **Skills protocol support** — SkillsProvider, skill loading, register skill as tool

### File mapping

From current `src/`:

```
@moniro/agent (Agent Loop)
├── worker.ts                  ← src/agent/worker.ts
├── models.ts                  ← src/agent/models.ts
├── types.ts                   ← src/agent/types.ts
├── definition.ts              ← src/agent/definition.ts (AgentDefinition, AgentSoul types)
├── schedule.ts                ← src/agent/schedule.ts (types + parsing only)
├── cron.ts                    ← src/agent/cron.ts (types + parsing only)
│
├── backends/                  ← src/backends/ (entire directory)
│   ├── types.ts
│   ├── index.ts
│   ├── model-maps.ts
│   ├── sdk.ts
│   ├── claude-code.ts
│   ├── codex.ts
│   ├── cursor.ts
│   ├── opencode.ts
│   ├── mock.ts
│   ├── idle-timeout.ts
│   ├── cli-helpers.ts
│   └── stream-json.ts
│
├── tools/
│   └── create-tool.ts         ← src/agent/tools/create-tool.ts
│
└── skills/                    ← src/agent/skills/ (entire directory)
    ├── provider.ts
    ├── importer.ts
    └── import-spec.ts
```

### Dependencies

External only: `ai`, `@ai-sdk/*`, `execa`, `zod`

### API

```typescript
import { AgentWorker } from '@moniro/agent'

// Pure fire-and-forget — no identity, no memory
const agent = new AgentWorker({
  model: 'claude-sonnet-4-20250514',
  system: 'You are a code reviewer.',
  tools: myTools,
})
const { content } = await agent.send('Review this diff')
```

### What it does NOT include

- Personal context (memory, notes, todos) — that's Agent Worker
- Prompt assembly from soul/memory — that's Agent Worker
- MCP connection management — that's Agent Worker
- Skills configuration and trigger logic — that's Agent Worker
- Shared context (channel, inbox) — that's Workspace
- Daemon, CLI, scheduling — that's Agent Worker

---

## Package 2: `agent-worker` — Agent Worker

**Use case**: Personal agent. Makes an execution loop into a "person" with identity, memory, tools, and scheduling. Also provides daemon service and CLI.

### What it provides

**Personal Agent:**
- **ContextProvider interface** — Pluggable storage abstraction for memory/notes/todos
- **FileContextProvider** — Default file-based implementation (extracted from AgentHandle)
- **Personal context tools** — `my_memory_read/write`, `my_notes_read/write`, `my_todos_read/write` as local tools
- **PromptAssembler** — Composable prompt sections (soul, memory, todo), open to caller customization
- **AgentHandle** — Agent definition + ContextProvider + state management
- **AgentRegistry** — Agent discovery from `.agents/*.yaml` + ephemeral registration
- **ConversationLog** — JSONL append-only conversation persistence
- **ThinThread** — Bounded in-memory conversation buffer with restore

**MCP & Skills Management:**
- **MCP client management** — Which MCP servers to connect, lifecycle, reconnection
- **Skills management** — Which skills to install, trigger conditions, personal skill config

**System:**
- **Daemon** — HTTP server, process lifecycle, signal handling
- **WorkspaceRegistry** — Active workspace management
- **Priority Queue** — Three-lane instruction queue with cooperative preemption
- **CLI** — Client commands (new, list, send, run, etc.)
- **Scheduling** — Cron execution, scheduled wakeups

### File mapping

```
agent-worker
├── context/                   ← NEW: personal context system
│   ├── types.ts               ← ContextProvider interface
│   ├── file-provider.ts       ← FileContextProvider (from AgentHandle)
│   ├── memory-provider.ts     ← In-memory (ephemeral)
│   └── tools.ts               ← createPersonalContextTools(provider)
│
├── prompt/                    ← MOVED from workflow/loop/prompt.ts
│   ├── assembler.ts           ← PromptAssembler (composable sections)
│   ├── sections.ts            ← soulSection, memorySection, todoSection
│   └── types.ts               ← PromptSection, PromptContext
│
├── agent/                     ← src/agent/ (persistence)
│   ├── agent-handle.ts        ← Refactored: delegates to ContextProvider
│   ├── agent-registry.ts
│   ├── conversation.ts
│   ├── definition.ts
│   ├── yaml-parser.ts
│   ├── config.ts
│   ├── handle.ts
│   └── store.ts
│
├── daemon/                    ← src/daemon/ (entire directory)
│   ├── daemon.ts
│   ├── serve.ts
│   ├── server.ts
│   ├── registry.ts
│   ├── workspace-registry.ts
│   ├── event-log.ts
│   └── cron.ts
│
└── cli/                       ← src/cli/ (entire directory)
    ├── client.ts
    ├── instance.ts
    ├── output.ts
    ├── target.ts
    └── commands/
```

### Dependencies

- `@moniro/agent` (worker, backends, tool infra, skills protocol)
- `commander`, `chalk`, `@clack/prompts`, `picocolors`, `nanoid`, `string-width`, `wrap-ansi`

### API

```typescript
import { AgentHandle, FileContextProvider, PromptAssembler } from 'agent-worker'
import { DEFAULT_PERSONAL_SECTIONS } from 'agent-worker/prompt'

// Create a personal agent
const context = new FileContextProvider('.agents/alice')
const assembler = new PromptAssembler({
  sections: [...DEFAULT_PERSONAL_SECTIONS, customSection],
})

const handle = new AgentHandle(definition, context)
const systemPrompt = await assembler.build({
  definition: handle.definition,
  context,
})

// AgentWorker (from @moniro/agent) executes the loop
const worker = new AgentWorker({
  model: definition.model,
  system: systemPrompt,
  tools: {
    ...createPersonalContextTools(context),
    ...otherTools,
  },
})
```

```bash
# CLI
agent-worker start                    # Start daemon
agent-worker new alice --model sonnet # Create persistent agent
agent-worker send alice "hello"       # Send message (DM)
agent-worker run review.yaml          # Run workflow
```

### What it does NOT include

- Multi-agent collaboration — that's Workspace
- Shared context (channel, inbox, documents) — that's Workspace
- Guard Agent — that's Workspace (optional)

---

## Package 3: `@moniro/workspace` — Workspace (原 `@moniro/workflow`)

**Use case**: Multi-agent collaboration space. Provides shared context, coordination tools, and optional intelligent context management. Agents join via MCP.

### What it provides

- **Workflow parser** — YAML → typed config
- **Factory** — `createMinimalRuntime()`, `createWiredLoop()`
- **Runner** — `runWorkflow()`, `runWorkflowWithLoops()`
- **AgentLoop** — Lifecycle: poll → run → ack → retry, state machine
- **Shared context** — ContextProvider (channel, inbox, documents, resources, proposals)
- **MCP context server** — Expose shared context as MCP tools for agents to connect
- **Collaboration prompt sections** — channelContextSection, teamRulesSection (additive to agent's own sections)
- **Guard Agent** (optional) — Intelligent context budget management across agents
- **Specific tools** — bash, feedback (environment capabilities for agents in workflows)
- **Display** — Channel watcher, pretty printing
- **Logger** — Logger interface + channelLogger implementation

### File mapping

```
@moniro/workspace (原 @moniro/workflow)
├── factory.ts
├── runner.ts
├── parser.ts
├── interpolate.ts
├── types.ts                   ← AgentHandleRef 移除，改用 agent-worker 的 ContextProvider
├── layout.ts
├── display.ts
├── display-pretty.ts
├── logger.ts
│
├── loop/
│   ├── loop.ts                ← readPersonalContext 移除，agent 自带 prompt
│   ├── prompt.ts              ← 只保留协作 sections（channel, team rules）
│   ├── send.ts
│   ├── sdk-runner.ts
│   ├── mock-runner.ts
│   ├── backend.ts
│   ├── mcp-config.ts
│   └── types.ts               ← PersonalContext 移除
│
├── context/
│   ├── provider.ts            ← 只有 shared context
│   ├── types.ts
│   ├── storage.ts
│   ├── file-provider.ts
│   ├── memory-provider.ts
│   ├── mcp/
│   │   ├── server.ts          ← 移除 personal tools 注册
│   │   └── ...                ← 只保留 shared context tools
│   ├── http-transport.ts
│   ├── proposals.ts
│   ├── event-log.ts
│   └── stores/
│
└── tools/
    ├── bash.ts
    ├── feedback.ts
    └── skills.ts
```

### Dependencies

- `@moniro/agent` (worker, backends, skills, tool infra)
- `@modelcontextprotocol/sdk`, `hono`, `@hono/node-server`
- `yaml`, `bash-tool`, `just-bash`

### How agents join a workspace

```typescript
// Workspace exposes MCP server
const workspace = await createWorkspace('review.yaml')
const mcpServer = workspace.getMCPServer()  // channel_read, channel_write, inbox_read, ...

// Agent Worker connects via MCP client
const agent = createPersonalAgent('alice')
agent.connectMCP(mcpServer.endpoint)  // Now alice has collaboration tools
```

### Prompt composition

Workspace doesn't replace the agent's prompt — it **adds** collaboration sections:

```typescript
const workspaceSections = [
  ...agent.promptAssembler.sections,  // agent's personal sections (soul, memory, todo)
  channelContextSection,               // workspace adds collaboration context
  teamRulesSection,                    // workspace adds team rules
]
```

### What it does NOT include

- Agent identity / personal context — that's Agent Worker
- Daemon, CLI — that's Agent Worker
- Backend execution — that's Agent Loop

---

## Context Split: Personal vs Shared

| Context type | Belongs to | Layer | Storage |
|---|---|---|---|
| **Personal** (memory, notes, todos, soul) | Agent | Agent Worker | ContextProvider (FileContextProvider / RedisContextProvider / ...) |
| **Shared** (channel, inbox, documents, resources, proposals) | Workspace | Workspace | ContextProvider (FileProvider / MemoryProvider) |

**Personal context** lives entirely in Agent Worker. The agent knows who it is, remembers things, and tracks tasks — with or without a workspace.

**Shared context** lives entirely in the Workspace layer. It's the collaboration substrate between agents.

These two never overlap. An agent's personal memory is invisible to other agents. A workspace's channel is visible to all agents in that workspace.

---

## Migration Path

Four steps. Each step produces a green build + passing tests.

### Step 1: Barrel exports (boundary validation)

Create three barrel files within the existing codebase:

```typescript
// packages/agent/src/index.ts     → @moniro/agent public API (already done)
// packages/workflow/src/index.ts   → @moniro/workspace public API (already done, needs cleanup)
// packages/agent-worker/src/index.ts → agent-worker public API (already done)
```

Validate: no circular dependencies across barrels.

### Step 2: Move personal context to Agent Worker

- Create `context/` and `prompt/` directories in `packages/agent-worker/src/`
- Extract `ContextProvider` interface + `FileContextProvider` from `AgentHandle`
- Move `soulSection`, `memorySection`, `todoSection` from `workflow/loop/prompt.ts`
- Move personal MCP tools from `workflow/context/mcp/personal.ts` → local tools in agent-worker
- Refactor `AgentHandle` to delegate to `ContextProvider`
- Run tests

### Step 3: Clean up Workspace layer

- Remove `AgentHandleRef` from workflow types
- Remove `readPersonalContext()` from workflow loop
- Remove personal tools registration from MCP server
- Keep only collaboration prompt sections in `prompt.ts`
- Run tests

### Step 4: Rename + final cleanup

- Consider renaming `@moniro/workflow` → `@moniro/workspace`
- Update all references
- Run full test suite + E2E

---

## Open Questions

1. **Package naming** — `@moniro/agent` (keep) vs `@moniro/agent-loop` (more precise)? `@moniro/workflow` → `@moniro/workspace` (when)?
2. **Agent Worker scope** — It's both "personal agent" and "system service (daemon + CLI)". Further split needed later?
3. **MCP client in Agent Worker** — Need new infrastructure for Agent Worker's MCP client connections to workspace and external MCP servers
4. **Test splitting** — How to split existing tests across packages? Some tests span layers.
