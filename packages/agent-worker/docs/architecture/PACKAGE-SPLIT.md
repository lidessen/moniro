# Architecture: Four-Package Split

**Date**: 2026-03-02
**Amended**: 2026-03-06 — Four-package structure (see ADR `2026-03-06-three-layer-restructuring.md`)
**Depends on**: AGENT-TOP-LEVEL phases 0–3c (all done)

---

## Problem

Everything lives in one `packages/agent-worker/` package. This conflates three distinct use cases:

1. **Fire-and-forget agent** — Create an agent, send a message, get a response. No persistence, no workflow, no daemon.
2. **Personal agent** — Persistent agent with identity, memory, tools, scheduling. No multi-agent collaboration needed.
3. **Multi-agent collaboration** — Shared workspace with channels, inbox, documents. Multiple agents coordinating.

A user who wants (1) must install the entire daemon, CLI, and workflow engine. Personal agent identity is tangled with collaboration.

## Decision

Four packages: three internal (`@moniro/*`, not published) + one umbrella (published).

```
packages/
├── agent-loop/      → @moniro/agent-loop      (内部)
├── agent-worker/    → @moniro/agent-worker     (内部)
├── workspace/       → @moniro/workspace        (内部)
└── moniro/          → agent-worker             (umbrella, 发布)
```

Dependency chain (strict one-way):

```
@moniro/workspace → @moniro/agent-worker → @moniro/agent-loop
                                              ↑
agent-worker (umbrella) ──── re-exports all ──┘
```

跟 semajsx 同模式：`@scope/*` 内部包用 `workspace:*` 解析，tsdown 各自构建，umbrella 统一发布。

---

## Package 1: `@moniro/agent-loop` — 纯执行循环

**Use case**: 执行一次对话 loop。给 system prompt + tools + 消息，返回结果。无状态，不知道"我是谁"。

### What it provides

- **AgentWorker** — Stateful ToolLoop: conversation history, model config, tool registry, `send()` / `sendStream()`
- **Backend abstraction** — Unified interface over AI SDK, Claude CLI, Codex CLI, Cursor CLI, OpenCode CLI, mock
- **Model creation** — Provider registry, model maps, `createModelAsync()`
- **Tool infrastructure** — Tool creation helpers, registration interface, approval flow
- **MCP protocol support** — Basic MCP client capabilities (tool discovery, tool invocation)
- **Skills protocol support** — SkillsProvider, skill loading, register skill as tool
- **Types** — `AgentDefinition`, `AgentSoul`, `AgentPromptConfig`, `ScheduleConfig` (pure data types used by all layers)

### File mapping

From current `packages/agent/src/`:

```
@moniro/agent-loop
├── worker.ts                  ← AgentWorker class
├── models.ts                  ← Model resolution, provider discovery
├── types.ts                   ← SessionConfig, AgentMessage, etc.
├── definition.ts              ← AgentDefinition, AgentSoul, AgentContextConfig
├── schedule.ts                ← ScheduleConfig, resolveSchedule
├── cron.ts                    ← Cron parsing
├── logger.ts                  ← Logger interface
│
├── backends/                  ← Provider backends (entire directory)
│   ├── types.ts, index.ts, model-maps.ts
│   ├── sdk.ts, claude-code.ts, codex.ts
│   ├── cursor.ts, opencode.ts, mock.ts
│   ├── idle-timeout.ts, cli-helpers.ts, stream-json.ts
│
├── tools/
│   └── create-tool.ts         ← Tool creation helpers
│
└── skills/                    ← Skill protocol support
    ├── provider.ts, importer.ts, import-spec.ts
```

### Dependencies

External only: `ai`, `@ai-sdk/*`, `execa`, `zod`

### API

```typescript
import { AgentWorker } from '@moniro/agent-loop'

const agent = new AgentWorker({
  model: 'claude-sonnet-4-20250514',
  system: 'You are a code reviewer.',
  tools: myTools,
})
const { content } = await agent.send('Review this diff')
```

### What it does NOT include

- Personal context (memory, notes, todos) — `@moniro/agent-worker`
- Prompt assembly from soul/memory — `@moniro/agent-worker`
- MCP connection management — `@moniro/agent-worker`
- bash, feedback tools — `@moniro/agent-worker`
- Shared context (channel, inbox) — `@moniro/workspace`
- Daemon, CLI — umbrella `agent-worker`

### Open: conversation.ts

`ConversationLog` 和 `ThinThread` 目前在此层。对话持久化可能更适合 `@moniro/agent-worker`（身份层）。待定。

---

## Package 2: `@moniro/agent-worker` — 个人 Agent

**Use case**: 让执行循环变成"人"。有身份、有记忆、有个人工具、有调度。不需要 workspace 就能独立运行。

### What it provides

**Personal Agent:**
- **PersonalContextProvider interface** — 可插拔存储抽象 (memory/notes/todos)
- **FileContextProvider** — 默认文件实现（从 AgentHandle 提取）
- **Personal context tools** — `my_memory_read/write`, `my_notes_read/write`, `my_todos_read/write` (本地 tools)
- **PromptAssembler** — 可组合 prompt sections (soul, memory, todo)，对调用者开放自定义
- **AgentHandle** — Agent definition + PersonalContextProvider + state management
- **AgentRegistry** — Agent discovery from `.agents/*.yaml` + ephemeral registration

**Tools:**
- **createBashTools()** — 封装 `bash-tool` npm 包，个人 agent 也需要 bash

**MCP & Skills Management:**
- **MCP client management** — 决定连哪些 MCP server，管理连接生命周期
- **Skills management** — 决定装哪些 skills，配置触发时机

**Scheduling:**
- **Cron execution** — scheduled wakeups, periodic tasks

**Daemon:**
- **Daemon** — HTTP server, process lifecycle, signal handling
- **Priority Queue** — Three-lane instruction queue with cooperative preemption

### File mapping

```
@moniro/agent-worker
├── context/                   ← NEW: personal context system
│   ├── types.ts               ← PersonalContextProvider interface
│   ├── file-provider.ts       ← FileContextProvider (from AgentHandle)
│   ├── memory-provider.ts     ← In-memory (ephemeral)
│   └── tools.ts               ← createPersonalContextTools(provider)
│
├── prompt/                    ← MOVED from workflow/loop/prompt.ts
│   ├── assembler.ts           ← PromptAssembler (composable sections)
│   ├── sections.ts            ← soulSection, memorySection, todoSection
│   └── types.ts               ← PromptSection, PromptContext
│
├── tools/
│   └── bash.ts                ← MOVED from workflow/tools/bash.ts
│
├── agent/                     ← Persistence + identity
│   ├── agent-handle.ts        ← Refactored: delegates to PersonalContextProvider
│   ├── agent-registry.ts
│   ├── config.ts
│   ├── handle.ts
│   ├── store.ts
│   └── yaml-parser.ts
│
└── daemon/                    ← System service
    ├── daemon.ts
    ├── serve.ts
    ├── server.ts
    ├── registry.ts
    ├── workspace-registry.ts
    ├── event-log.ts
    └── cron.ts
```

### Dependencies

- `@moniro/agent-loop`: `workspace:*`
- `bash-tool`, `nanoid`

### API

```typescript
import { AgentHandle, FileContextProvider, PromptAssembler } from '@moniro/agent-worker'
import { DEFAULT_PERSONAL_SECTIONS } from '@moniro/agent-worker/prompt'
import { AgentWorker } from '@moniro/agent-loop'

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

const worker = new AgentWorker({
  model: definition.model,
  system: systemPrompt,
  tools: {
    ...createPersonalContextTools(context),
    ...createBashTools(),
  },
})
```

### What it does NOT include

- Multi-agent collaboration — `@moniro/workspace`
- Shared context (channel, inbox, documents) — `@moniro/workspace`
- Guard Agent — `@moniro/workspace` (optional)
- CLI entry point — umbrella `agent-worker`

---

## Package 3: `@moniro/workspace` — 协作空间

**Use case**: 多 agent 协作。提供共享上下文、MCP server、workflow orchestration。个人 agent 通过标准 MCP 接入。

### What it provides

- **Workflow parser** — YAML → typed config
- **Factory** — `createMinimalRuntime()`, `createWiredLoop()`
- **Runner** — `runWorkflow()`, `runWorkflowWithLoops()`
- **AgentLoop** — Lifecycle: poll → run → ack → retry, state machine
- **Shared context** — ContextProvider (channel, inbox, documents, resources, proposals)
- **MCP context server** — 暴露标准 MCP server，让 agent 通过 MCP client 接入
- **Collaboration prompt sections** — `activitySection`, `inboxSection`, `documentSection` (叠加到 agent 自带 prompt)
- **Guard Agent** (optional, future) — 协作场景的上下文预算管理
- **Feedback tool** — workflow 反馈收集
- **Display** — Channel watcher, pretty printing
- **Logger** — Logger interface + channelLogger

### File mapping

```
@moniro/workspace
├── factory.ts
├── runner.ts
├── parser.ts
├── interpolate.ts
├── types.ts                   ← AgentHandleRef 移除，用 @moniro/agent-worker 的类型
├── layout.ts
├── display.ts
├── display-pretty.ts
├── logger.ts
│
├── loop/
│   ├── loop.ts                ← readPersonalContext 移除，agent 自带 prompt
│   ├── prompt.ts              ← 只保留协作 sections: activitySection, inboxSection, documentSection
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
│   │   ├── server.ts          ← 移除 personal tools，只保留 shared context tools
│   │   ├── channel.ts, inbox.ts, resource.ts
│   │   ├── team.ts, proposal.ts, feedback.ts
│   │   └── helpers.ts, types.ts
│   ├── http-transport.ts
│   ├── proposals.ts
│   ├── event-log.ts
│   └── stores/
│
└── tools/
    └── feedback.ts
```

### Dependencies

- `@moniro/agent-worker`: `workspace:*` (间接包含 `@moniro/agent-loop`)
- `@modelcontextprotocol/sdk`, `hono`, `@hono/node-server`
- `yaml`

### How agents join a workspace

```typescript
// Workspace 暴露标准 MCP server
const workspace = await createWorkspace('review.yaml')
const mcpEndpoint = workspace.getMCPEndpoint()

// 个人 agent 通过 MCP client 接入（运行时，不是编译时依赖）
// agent-worker 完全不知道 workspace 的存在
agent.connectMCP(mcpEndpoint)  // 获得 channel_read, inbox_read 等协作 tools
```

### What it does NOT include

- Agent identity / personal context — `@moniro/agent-worker`
- Backend execution — `@moniro/agent-loop`
- CLI — umbrella `agent-worker`

---

## Package 4: `agent-worker` — Umbrella（发布包）

**Use case**: 统一入口。Re-export 所有内部包的 public API + 提供 CLI。

### What it provides

- **CLI** — `agent-worker start/new/send/run/connect` commands
- **Re-exports** — 所有 `@moniro/*` 包的 public API

### File mapping

```
agent-worker (umbrella)
├── src/
│   ├── index.ts               ← Re-exports from all @moniro/* packages
│   └── cli/
│       ├── index.ts            ← CLI entry point
│       ├── client.ts
│       ├── instance.ts
│       ├── output.ts
│       ├── target.ts
│       └── commands/
│
├── package.json               ← "name": "agent-worker", bin field
└── tsdown.config.ts           ← entry: ["src/index.ts", "src/cli/index.ts"]
```

### Dependencies

- `@moniro/agent-loop`: `workspace:*`
- `@moniro/agent-worker`: `workspace:*`
- `@moniro/workspace`: `workspace:*`
- `commander`, `chalk`, `@clack/prompts`, `picocolors`, `string-width`, `wrap-ansi`

### API

```typescript
// 用户只需安装 agent-worker，通过 re-exports 使用所有功能
import { AgentWorker } from 'agent-worker'                    // from @moniro/agent-loop
import { AgentHandle, PromptAssembler } from 'agent-worker'   // from @moniro/agent-worker
import { runWorkflow } from 'agent-worker'                    // from @moniro/workspace
```

```bash
agent-worker start                    # 启动 daemon
agent-worker new alice --model sonnet # 创建个人 agent
agent-worker send alice "hello"       # 发消息
agent-worker run review.yaml          # 运行 workflow（转发给 workspace）
agent-worker connect alice wss://...  # 个人 agent 接入 workspace
```

---

## Context Split: Personal vs Shared

| Context type | 属于 | 包 | 接口 | Storage |
|---|---|---|---|---|
| **Personal** (memory, notes, todos, soul) | Agent | `@moniro/agent-worker` | `PersonalContextProvider` | FileContextProvider / RedisContextProvider / ... |
| **Shared** (channel, inbox, documents, resources, proposals) | Workspace | `@moniro/workspace` | `ContextProvider` | FileProvider / MemoryProvider |

命名不冲突：`PersonalContextProvider` vs `ContextProvider`。

---

## Migration Path

### Step 1: Create @moniro/agent-worker package

- Create `packages/agent-worker-core/` (临时目录名，避免冲突)
- Extract `PersonalContextProvider` interface + `FileContextProvider` from `AgentHandle`
- Move `soulSection`, `memorySection`, `todoSection` from `workflow/loop/prompt.ts`
- Move personal MCP tools from `workflow/context/mcp/personal.ts` → local tools
- Move `createBashTools()` from `workflow/tools/bash.ts`
- Move agent handle, registry, daemon code
- Run tests

### Step 2: Clean up @moniro/workspace

- Remove `AgentHandleRef` from workflow types
- Remove `readPersonalContext()` from workflow loop
- Remove personal tools from MCP server
- Remove `PersonalContext` type from loop/types.ts
- Keep only `activitySection`, `inboxSection`, `documentSection` in prompt.ts
- Reverse dependency: workspace depends on agent-worker (not the other way)
- Run tests

### Step 3: Rename packages

- `packages/agent/` → `packages/agent-loop/`, name → `@moniro/agent-loop`
- `packages/workflow/` → `packages/workspace/`, name → `@moniro/workspace`
- `packages/agent-worker-core/` → `packages/agent-worker/`, name → `@moniro/agent-worker`
- Create `packages/moniro/` as umbrella with CLI + re-exports
- Update all workspace:* references
- Run full test suite

---

## Open Questions

1. **conversation.ts 归属** — `ConversationLog`/`ThinThread` 目前在 agent-loop，但对话持久化更像身份层的职责。搬到 `@moniro/agent-worker`？
2. **umbrella 目录名** — `packages/moniro/` 还是保持路径但改 name？需要避免跟 `@moniro/agent-worker` 目录名冲突
3. **workspace CLI** — workspace 功能通过 umbrella CLI 子命令暴露，还是独立 CLI？
