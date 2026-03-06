# Project Context

> 快速了解项目状态。详细设计见 `packages/agent-worker/docs/architecture/` 下各文档。

## 当前焦点

**Personal Agent 优先** — 个人 Agent 支持提升为最高优先级。Phase 5（PR #110）待合并后，立即进入 Phase 6 个人 Agent 系列。CLI/Config 降级。

## 架构概览

```
@moniro/workspace          ← 协作空间：channel, inbox, shared docs, guard
    ▲                        agents join via MCP
    │
agent-worker ────────┐     ← 个人 agent：身份, 记忆, personal tools, prompt 组装
    │                │       scheduling, daemon, CLI
    ▼                │
@moniro/agent ───────┘     ← 纯执行循环：backends, tool loop, MCP/skills 协议
```

各层职责：
- **Agent Loop** (`@moniro/agent`): 执行一次对话 loop。无状态，不知道"我是谁"。MCP/Skills 协议支持在此层。
- **Agent Worker** (`agent-worker`): 让执行器变成"人"。身份 + 记忆 + 个人 tools + prompt 组装 + MCP/Skills 管理。
- **Workspace** (`@moniro/workspace`，原 workflow): 创造协作空间。Agent 通过 MCP client 加入。

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
| **Phase 6-restructure** | **active** | **三层重构** | 个人 agent 下沉到 Agent Worker 层，Workspace 独立 |
| **Phase 6c** | future | **Guard Agent（看守者）** | Workspace 层的智能上下文管理，可选 |
| **Phase 6d** | future | **Channel Bridge（外部集成）** | ChannelBridge + ChannelAdapter + Telegram |
| Phase 7 | deprioritized | CLI + Project Config | `moniro.yaml`, improved CLI |

## Phase 6: 三层重构 + Personal Agent

> **核心转变**：个人 agent 不应依赖 workflow 层才能"知道自己是谁"。三层重新定义为 Agent Loop（纯执行）→ Agent Worker（个人 agent）→ Workspace（协作空间）。详见 ADR `2026-03-06-three-layer-restructuring.md`。

### Phase 6a/6b: 已完成（需搬迁）
- soul/memory/todo prompt injection 和 personal context MCP tools 已实现
- 当前在 workflow 层，需搬迁到 agent-worker 层
- 代码大部分是搬家而非重写

### Phase 6-restructure: 三层重构（当前焦点）

**目标**：重新定义层边界，让个人 agent 可以独立运行。

**要搬的**：
- `workflow/loop/prompt.ts` 的 soulSection/memorySection/todoSection → agent-worker/prompt/
- `workflow/context/mcp/personal.ts` 的 6 个 tools → agent-worker/context/tools.ts（变本地 tools）
- `workflow/types.ts` 的 AgentHandleRef → agent-worker 的 ContextProvider 接口

**要新建的**：
- `ContextProvider` 接口 — 文件默认实现，支持多 storage provider
- `PromptAssembler` — 可组合 sections，对调用者开放自定义
- MCP client 管理 — Agent Worker 连接 workspace 和外部 MCP server

**要清理的**：
- workspace 层移除 personal context 相关代码
- workspace prompt.ts 只保留协作 sections
- workspace MCP server 只暴露 shared context tools

### Phase 6c: Guard Agent（Workspace 层，可选）
- 设计文档已有：`GUARD-AGENT.md`
- 重新定位：不是个人 agent 的依赖，是 workspace 的上下文优化
- 管理多 agent 协作场景的上下文预算

### Phase 6d: Channel Bridge（外部集成）
- 设计文档：`CHANNEL-BRIDGE.md`
- 可独立于重构推进

## Phase 5 要点（待合并）

- 三 lane 优先级队列：`immediate > normal > background`
- 协作式抢占：LLM step 间检查 `shouldYield()`，高优先级到达时 yield
- `PreemptionError` throw-to-exit，loop 重新入队 + `InstructionProgress` 恢复上下文
- `AgentHandle.send()`/`sendMessage()` — 类型化指令路由
- Scheduled wakeup 直接入队为 `background`，不再写 synthetic channel message
- 1047 tests pass

## 已知风险 & 开放问题

- `send` CLI target 解析（DM / @workspace / agent@workspace）— Phase 3b 遗留，降低优先级
- Personal context schema 是否过于 opinionated（当前判断：作为默认实现 ship，ContextProvider 接口允许替代）
- 包名是否改：`@moniro/agent` vs `@moniro/agent-loop`，`@moniro/workflow` → `@moniro/workspace`
- Agent Worker 同时承担"个人 agent"和"系统服务"两个职责，是否需要进一步拆分

## 关键文件

| 文件 | 用途 |
|------|------|
| `packages/agent-worker/docs/architecture/PACKAGE-SPLIT.md` | 三包拆分设计（2026-03-06 更新层边界） |
| `packages/agent-worker/docs/architecture/AGENT-TOP-LEVEL.md` | Agent 顶层实体设计 |
| `packages/agent-worker/docs/architecture/CHANNEL-BRIDGE.md` | Channel 外部集成设计 |
| `packages/workflow/src/loop/priority-queue.ts` | 优先级队列实现 |
| `packages/workflow/src/loop/sdk-runner.ts` | SDK runner + PreemptionError |
| `.memory/decisions/` | ADR 记录 |
| `.memory/todos/index.md` | 活跃任务 |
