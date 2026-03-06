# Project Context

> 快速了解项目状态。详细设计见 `packages/agent-worker/docs/architecture/` 下各文档。

## 当前焦点

**四包重构 + Personal Agent 优先** — 重新定义包边界，让个人 agent 独立于 workspace 运行。

## 架构概览

四个包：三个内部 `@moniro/*`（不发布）+ 一个 umbrella `agent-worker`（发布）。

```
@moniro/workspace → @moniro/agent-worker → @moniro/agent-loop
                                              ↑
agent-worker (umbrella) ──── re-exports all ──┘
```

```
packages/
├── agent-loop/      → @moniro/agent-loop      纯执行循环
├── agent-worker/    → @moniro/agent-worker     个人 agent（身份, 记忆, tools）
├── workspace/       → @moniro/workspace        协作空间（channel, MCP server）
└── moniro/          → agent-worker             umbrella（CLI + re-exports）
```

各层职责：
- **Agent Loop** (`@moniro/agent-loop`): 执行一次对话 loop。backends, tool loop, MCP/Skills 协议。无状态。
- **Agent Worker** (`@moniro/agent-worker`): 让执行器变成"人"。身份 + 记忆 + 个人 tools + bash + prompt 组装 + daemon。不知道 workspace。
- **Workspace** (`@moniro/workspace`): 协作空间。依赖 agent-worker 创建 agent。暴露标准 MCP server，外部个人 agent 通过 MCP client 接入。
- **Umbrella** (`agent-worker`): CLI 入口 + re-export 所有内部包。跟 semajsx 同模式。

## 阶段总览

| 阶段 | 状态 | 内容 | 关键产物 |
|------|------|------|----------|
| Phase 0 | done | 预备清理：类型重命名、config 解耦 | `WorkflowAgentDef`, `DaemonState.loops` |
| Phase 1 | done | Agent 定义 + Context：YAML、Registry、CLI | `.agents/*.yaml`, `AgentHandle`, `AgentRegistry` |
| Phase 2 | done | Workflow Agent References：`ref:` 引用 | `AgentEntry` 联合类型, prompt assembly |
| Phase 3a | done | Event Log 基础设施 | `EventSink`, `DaemonEventLog`, `Logger` |
| Phase 3b | done | Daemon Registry + Workspace | `Workspace`, `WorkspaceRegistry` |
| Phase 3c | done | Conversation Model | `ConversationLog`, `ThinThread` |
| Phase 4 | done | Three-Package Split | `@moniro/agent`, `@moniro/workflow`, `agent-worker` |
| **Phase 5** | **PR #110** | **Priority Queue + Cooperative Preemption** | `InstructionQueue`, `PreemptionError` |
| **Phase 6a** | **done** | **Personal Agent Prompt** | soulSection + memorySection + todoSection 注入 prompt |
| **Phase 6b** | **done** | **Personal Context Tools** | 动态 MCP tools (memory/notes/todos read+write) |
| **Phase 6-restructure** | **active** | **四包重构** | 依赖反转 + 个人 agent 下沉 + workspace 独立 |
| **Phase 6c** | future | **Guard Agent（看守者）** | Workspace 层的智能上下文管理，可选 |
| **Phase 6d** | future | **Channel Bridge（外部集成）** | ChannelBridge + ChannelAdapter + Telegram |
| Phase 7 | deprioritized | CLI + Project Config | `moniro.yaml`, improved CLI |

## Phase 6: 四包重构 + Personal Agent

> **核心转变**：个人 agent 不应依赖 workflow 层。四包结构：`@moniro/agent-loop`（执行）→ `@moniro/agent-worker`（个人 agent）→ `@moniro/workspace`（协作）+ `agent-worker`（umbrella）。依赖方向：workspace → agent-worker → agent-loop。详见 ADR `2026-03-06-three-layer-restructuring.md`。

### Phase 6a/6b: 已完成（需搬迁）
- soul/memory/todo prompt injection 和 personal context MCP tools 已实现
- 当前在 workflow 层，需搬到 `@moniro/agent-worker`
- 代码大部分是搬家而非重写

### Phase 6-restructure: 四包重构（当前焦点）

**目标**：重新定义包边界和依赖方向，让个人 agent 独立运行。

**搬迁**（从 workflow → @moniro/agent-worker）：
- `workflow/loop/prompt.ts` 的 `soulSection`/`memorySection`/`todoSection`
- `workflow/context/mcp/personal.ts` 的 6 个 `my_*` tools → 变本地 tools
- `workflow/types.ts` 的 `AgentHandleRef` → `PersonalContextProvider` 接口
- `workflow/tools/bash.ts` 的 `createBashTools()`

**新建**：
- `PersonalContextProvider` 接口 — 文件默认实现，可插拔
- `PromptAssembler` — 可组合 sections
- MCP client 管理 — 连 workspace 和外部 MCP server

**清理** workspace 层：
- 移除 personal context 代码
- `prompt.ts` 只保留 `activitySection`/`inboxSection`/`documentSection`
- MCP server 只暴露 shared context tools

**包重命名 + umbrella 抽取**：
- `@moniro/agent` → `@moniro/agent-loop`
- `@moniro/workflow` → `@moniro/workspace`（依赖反转：workspace → agent-worker）
- 新建 umbrella `packages/moniro/` → `agent-worker`

### Phase 6c: Guard Agent（Workspace 层，可选）
- 设计文档已有：`GUARD-AGENT.md`
- 协作场景的上下文预算管理，不是个人 agent 依赖

### Phase 6d: Channel Bridge（外部集成）
- 设计文档：`CHANNEL-BRIDGE.md`
- 可独立推进

## Phase 5 要点（待合并）

- 三 lane 优先级队列：`immediate > normal > background`
- 协作式抢占：LLM step 间检查 `shouldYield()`
- `PreemptionError` throw-to-exit，loop 重新入队
- 1047 tests pass

## 已知风险 & 开放问题

- `conversation.ts` 归属 — `ConversationLog`/`ThinThread` 在 agent-loop，可能应在 agent-worker
- umbrella 目录名 — `packages/moniro/` vs 避免与 `@moniro/agent-worker` 冲突
- workspace CLI — 通过 umbrella 子命令还是独立 CLI

## 关键文件

| 文件 | 用途 |
|------|------|
| `packages/agent-worker/docs/architecture/PACKAGE-SPLIT.md` | 四包拆分设计（2026-03-06） |
| `packages/agent-worker/docs/architecture/AGENT-TOP-LEVEL.md` | Agent 顶层实体设计 |
| `packages/agent-worker/docs/architecture/CHANNEL-BRIDGE.md` | Channel 外部集成设计 |
| `.memory/decisions/2026-03-06-three-layer-restructuring.md` | 四包重构 ADR |
| `.memory/decisions/` | ADR 记录 |
| `.memory/todos/index.md` | 活跃任务 |
