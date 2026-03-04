# Project Context

> 快速了解项目状态。详细设计见 `packages/agent-worker/docs/architecture/` 下各文档。

## 当前焦点

**Phase 5 PR 待合并** — Priority Queue + Cooperative Preemption（PR #110）。三包架构已完成（Phase 4），代码库稳定。

## 架构概览

```
@moniro/agent        ← Worker: 用完即丢的 agent 执行
    ▲       ▲          worker + backends + tool infra + skills + personal context
    │       │
@moniro/workflow     │  ← Workflow: 一次性跑工作流
    ▲       │          loop + shared context + MCP + bash/feedback
    │       │
agent-worker ────────┘  ← System: 持久化 daemon 服务
                         daemon + AgentHandle + CLI + conversation
```

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
| Phase 6 | future | Agent Context in Prompt + Personal Context Tools | recall tools, auto-memory |
| Phase 7 | future | CLI + Project Config | `moniro.yaml`, improved CLI |

## Phase 5 要点

- 三 lane 优先级队列：`immediate > normal > background`
- 协作式抢占：LLM step 间检查 `shouldYield()`，高优先级到达时 yield
- `PreemptionError` throw-to-exit，loop 重新入队 + `InstructionProgress` 恢复上下文
- `AgentHandle.send()`/`sendMessage()` — 类型化指令路由
- Scheduled wakeup 直接入队为 `background`，不再写 synthetic channel message
- 1047 tests pass

## 已知风险 & 开放问题

- `send` CLI target 解析（DM / @workspace / agent@workspace）— Phase 3b 遗留
- Personal context schema 是否过于 opinionated（当前判断：作为默认实现 ship，storage 接口允许替代）

## 关键文件

| 文件 | 用途 |
|------|------|
| `packages/agent-worker/docs/architecture/PACKAGE-SPLIT.md` | 三包拆分设计 |
| `packages/agent-worker/docs/architecture/AGENT-TOP-LEVEL.md` | Agent 顶层实体设计 |
| `packages/workflow/src/loop/priority-queue.ts` | 优先级队列实现 |
| `packages/workflow/src/loop/sdk-runner.ts` | SDK runner + PreemptionError |
| `.memory/decisions/` | ADR 记录 |
| `.memory/todos/index.md` | 活跃任务 |
