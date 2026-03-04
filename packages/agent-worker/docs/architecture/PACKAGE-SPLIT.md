# Architecture: Three-Package Split

**Date**: 2026-03-02
**Status**: Proposed
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
@moniro/agent          ← Zero project-internal deps. Pure execution.
    ▲       ▲
    │       │
@moniro/workflow       │  ← Orchestration + shared context
    ▲       │
    │       │
agent-worker ──────────┘  ← Persistent service (daemon + CLI)
```

Each package maps to one use case. Each can be used independently. System layer may depend on both lower layers directly.

---

## Package 1: `@moniro/agent` — Worker Layer

**Use case**: Fire-and-forget agent execution. Give it a prompt, tools, and a message; get a response.

### What it provides

- **AgentWorker** — Stateful ToolLoop: conversation history, model config, tool registry, `send()` / `sendStream()`
- **Backend abstraction** — Unified interface over AI SDK, Claude CLI, Codex CLI, Cursor CLI, mock
- **Model creation** — Provider registry, model maps, `createModelAsync()`
- **Tool infrastructure** — Tool creation helpers, registration interface
- **Skills** — SkillsProvider, git-based importer, import spec parsing
- **Personal context toolkit** (optional) — Pluggable storage interface + tool factory for memory/notes/todos

### File mapping

From current `src/`:

```
@moniro/agent
├── worker.ts                  ← src/agent/worker.ts
├── models.ts                  ← src/agent/models.ts
├── types.ts                   ← src/agent/types.ts
│
├── backends/                  ← src/backends/ (entire directory)
│   ├── types.ts
│   ├── index.ts
│   ├── model-maps.ts
│   ├── sdk.ts
│   ├── claude-code.ts
│   ├── codex.ts
│   ├── cursor.ts
│   ├── mock.ts
│   ├── idle-timeout.ts
│   └── stream-json.ts
│
├── tools/
│   └── create-tool.ts         ← src/agent/tools/create-tool.ts
│
├── skills/                    ← src/agent/skills/ (entire directory)
│   ├── provider.ts
│   ├── importer.ts
│   └── import-spec.ts
│
└── context/                   ← NEW: personal context toolkit
    ├── types.ts               ← PersonalContextStorage interface
    ├── memory-storage.ts      ← In-memory (ephemeral, default)
    ├── file-storage.ts        ← File-based (generic, not bound to AgentHandle)
    └── tools.ts               ← createPersonalContextTools(storage, options)
```

### Dependencies

External only: `ai`, `@ai-sdk/*`, `execa`, `zod`

### API

```typescript
import { AgentWorker } from '@moniro/agent'

// ① Pure fire-and-forget
const agent = new AgentWorker({
  model: 'claude-sonnet-4-20250514',
  system: 'You are a code reviewer.',
  tools: myTools,
})
const { content } = await agent.send('Review this diff')

// ② With session-scoped personal context (in-memory, lost on GC)
import { createPersonalContextTools, MemoryStorage } from '@moniro/agent/context'

const agent = new AgentWorker({
  model: 'claude-sonnet-4-20250514',
  system: 'You are a researcher.',
  tools: {
    ...createPersonalContextTools(new MemoryStorage()),
    ...otherTools,
  },
})

// ③ With file-backed personal context (persists to disk)
import { FileStorage } from '@moniro/agent/context'

const agent = new AgentWorker({
  model: 'claude-sonnet-4-20250514',
  system: 'You are Alice.',
  tools: {
    ...createPersonalContextTools(new FileStorage('/agents/alice/context'), {
      memory: true,
      notes: true,
      todos: false,
    }),
    bash,
  },
})
```

### What it does NOT include

- Workflow parsing/running
- Shared context (channel, inbox, documents, proposals)
- AgentLoop (lifecycle management)
- MCP context server
- Daemon, CLI, persistence wiring
- Specific tool implementations (bash, feedback)

---

## Package 2: `@moniro/workflow` — Workflow Layer

**Use case**: One-shot multi-agent orchestration. Parse a workflow YAML, run agents with shared context, collect results. No daemon needed.

### What it provides

- **Workflow parser** — YAML → typed config
- **Factory** — `createMinimalRuntime()`, `createWiredLoop()`
- **Runner** — `runWorkflow()`, `runWorkflowWithLoops()`
- **AgentLoop** — Lifecycle: poll → run → ack → retry, state machine
- **Shared context** — ContextProvider (channel, inbox, documents, resources, proposals)
- **MCP context server** — Expose shared context as MCP tools
- **Specific tools** — bash, feedback (environment capabilities for agents in workflows)
- **Display** — Channel watcher, pretty printing
- **Logger** — Logger interface + channelLogger implementation

### File mapping

From current `src/`:

```
@moniro/workflow
├── factory.ts                 ← src/workflow/factory.ts
├── runner.ts                  ← src/workflow/runner.ts
├── parser.ts                  ← src/workflow/parser.ts
├── interpolate.ts             ← src/workflow/interpolate.ts
├── types.ts                   ← src/workflow/types.ts
├── layout.ts                  ← src/workflow/layout.ts
├── display.ts                 ← src/workflow/display.ts
├── display-pretty.ts          ← src/workflow/display-pretty.ts
├── logger.ts                  ← src/workflow/logger.ts
│
├── loop/                      ← src/workflow/loop/ (entire directory)
│   ├── loop.ts
│   ├── prompt.ts
│   ├── send.ts
│   ├── sdk-runner.ts
│   ├── mock-runner.ts
│   ├── backend.ts
│   ├── mcp-config.ts
│   └── types.ts
│
├── context/                   ← src/workflow/context/ (entire directory)
│   ├── provider.ts
│   ├── types.ts
│   ├── storage.ts
│   ├── file-provider.ts
│   ├── memory-provider.ts
│   ├── mcp/
│   ├── http-transport.ts
│   ├── proposals.ts
│   ├── event-log.ts
│   └── stores/
│
└── tools/                     ← src/agent/tools/ (minus create-tool.ts)
    ├── bash.ts
    ├── feedback.ts
    └── skills.ts              ← skill tool wrapper (uses @moniro/agent/skills)
```

### Dependencies

- `@moniro/agent` (worker, backends, skills, tool infra)
- `@modelcontextprotocol/sdk`, `hono`, `@hono/node-server`
- `yaml`, `bash-tool`, `just-bash`

### API

```typescript
import { runWorkflowWithLoops, parseWorkflowFile } from '@moniro/workflow'

const workflow = await parseWorkflowFile('review.yaml')
const result = await runWorkflowWithLoops({ workflow, mode: 'run' })
// result.success, result.duration, result.feedback
```

### What it does NOT include

- Daemon (HTTP server, process lifecycle)
- AgentHandle (persistent agent identity)
- AgentRegistry (YAML agent discovery)
- ConversationLog, ThinThread (conversation persistence)
- CLI
- Priority queue, preemption

---

## Package 3: `agent-worker` — System Layer

**Use case**: Persistent daemon service. Long-running agents with identity, memory, conversation history, scheduled wakeups, priority queues.

### What it provides

- **Daemon** — HTTP server, process lifecycle, signal handling
- **AgentHandle** — Persistent agent wrapper (contextDir, memory, notes, todos, conversation)
- **AgentRegistry** — Agent discovery from `.agents/*.yaml` + ephemeral registration
- **WorkspaceRegistry** — Active workspace management
- **ConversationLog** — JSONL append-only conversation persistence
- **ThinThread** — Bounded in-memory conversation buffer with restore
- **Priority Queue** — Three-lane instruction queue with cooperative preemption (future)
- **CLI** — Client commands (new, list, send, run, etc.)

### File mapping

From current `src/`:

```
agent-worker (System)
├── daemon/                    ← src/daemon/ (entire directory)
│   ├── daemon.ts
│   ├── serve.ts
│   ├── server.ts
│   ├── registry.ts
│   ├── workspace-registry.ts
│   ├── event-log.ts
│   └── cron.ts
│
├── agent/                     ← src/agent/ (persistence subset)
│   ├── agent-handle.ts
│   ├── agent-registry.ts
│   ├── conversation.ts
│   ├── definition.ts
│   ├── yaml-parser.ts
│   ├── config.ts
│   ├── handle.ts
│   └── store.ts
│
└── cli/                       ← src/cli/ (entire directory)
    ├── client.ts
    ├── instance.ts
    ├── output.ts
    ├── target.ts
    └── commands/
```

### Dependencies

- `@moniro/agent` (worker, backends, personal context)
- `@moniro/workflow` (loop, shared context, factory, runner)
- `commander`, `chalk`, `@clack/prompts`, `picocolors`, `nanoid`, `string-width`, `wrap-ansi`

### API

```bash
# CLI
agent-worker start                    # Start daemon
agent-worker new alice --model sonnet # Create persistent agent
agent-worker send alice "hello"       # Send message (DM)
agent-worker run review.yaml          # Run workflow

# Programmatic
import { Daemon } from 'agent-worker'
const daemon = new Daemon()
await daemon.start()
```

---

## Context Split: Personal vs Shared

A key architectural boundary:

| Context type | Belongs to | Layer | Storage |
|---|---|---|---|
| **Personal** (memory, notes, todos) | Agent | Agent layer (toolkit) + System layer (wiring) | Pluggable: MemoryStorage (ephemeral) or FileStorage (persistent) |
| **Shared** (channel, inbox, documents, resources, proposals) | Workflow/Workspace | Workflow layer | ContextProvider (FileProvider / MemoryProvider) |

**Personal context** is an optional Agent-layer capability. The Agent layer provides the storage interface and tool factory. The System layer wires it to persistent paths (`.agents/<name>/context/`). Standalone agents can use in-memory storage.

**Shared context** lives entirely in the Workflow layer. It's the collaboration substrate between agents in a workspace.

These two never overlap. An agent's personal memory is invisible to other agents. A workspace's channel is visible to all agents in that workspace.

---

## Migration Path

Four steps. Each step produces a green build + passing tests.

### Step 1: Barrel exports (boundary validation)

Create three barrel files within the existing `packages/agent-worker/`:

```typescript
// src/agent-lib/index.ts  → future @moniro/agent public API
// src/workflow-lib/index.ts → future @moniro/workflow public API
// src/system-lib/index.ts  → future agent-worker public API
```

Validate: every consumer can import from the barrel. No deep imports needed. No circular dependencies across barrels.

### Step 2: Extract `@moniro/agent`

- Create `packages/agent/` with its own `package.json`, `tsconfig.json`, `tsdown.config.ts`
- Move worker + models + types + backends + tools/create-tool + skills
- Create personal context toolkit (new code: types, MemoryStorage, FileStorage, tools)
- Update imports in `packages/agent-worker/` to use `@moniro/agent`
- Run tests

### Step 3: Extract `@moniro/workflow`

- Create `packages/workflow/` with its own package config
- Move workflow/ + tools/bash + tools/feedback + tools/skills
- Update imports in `packages/agent-worker/` to use `@moniro/workflow`
- Run tests

### Step 4: Clean up `agent-worker`

- Only daemon/ + persistent agent/ + cli/ remain
- Update `package.json` dependencies (remove what moved to lower packages)
- Run full test suite + E2E

---

## Open Questions

1. **Test splitting** — How to split the existing 1014 tests across three packages? Some tests (daemon integration) span all layers.
2. **tsdown config** — One build per package or monorepo-level build? Current setup uses single tsdown.
3. **Personal context schema** — Memory is YAML key-value, notes are dated markdown, todos are checkbox lists. Is this too opinionated for the Agent layer? (Current answer: ship it as default, storage interface allows alternatives.)
4. **Skills tool in Workflow** — `tools/skills.ts` wraps `SkillsProvider` (Agent layer). Should it stay in Workflow or move to Agent as a built-in tool? (Current answer: Workflow, because skill invocation in a workflow context may need workspace awareness.)
