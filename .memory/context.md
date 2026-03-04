# Project Context

> 快速了解项目状态。详细设计见 `packages/agent-worker/docs/architecture/` 下各文档。

## 当前焦点

**Three-Package Split** — 将 `packages/agent-worker/` 拆分为三个独立包：`@moniro/agent`（Worker）、`@moniro/workflow`（Orchestration）、`agent-worker`（System）。设计已完成，待实施。

详细设计：`packages/agent-worker/docs/architecture/PACKAGE-SPLIT.md`

## 阶段总览

| 阶段 | 状态 | 内容 | 关键产物 |
|------|------|------|----------|
| Phase 0 | done | 预备清理：类型重命名、config 解耦、生命周期测试 | `WorkflowAgentDef`, `DaemonState.loops` |
| Phase 1 | done | Agent 定义 + Context：YAML、Registry、CLI | `.agents/*.yaml`, `AgentHandle`, `AgentRegistry` |
| Phase 2 | done | Workflow Agent References：`ref:` 引用 | `AgentEntry` 联合类型, prompt assembly |
| Phase 3a | done | Event Log 基础设施：结构化日志替代 console.* | `EventSink`, `DaemonEventLog`, `Logger` |
| Phase 3b | done | Daemon Registry + Workspace | `Workspace`, `WorkspaceRegistry`, `AgentHandle.loop` |
| Phase 3c | done | Conversation Model：ThinThread + ConversationLog | `ConversationLog`, `ThinThread`, `thinThreadSection` |
| **Phase 4** | **next** | **Three-Package Split** | `@moniro/agent`, `@moniro/workflow`, `agent-worker` |
| Phase 5 | future | Priority Queue + Preemption | AgentLoop → 3-lane queue, cooperative yield |
| Phase 6 | future | Agent Context in Prompt + Personal Context Tools | recall tools, auto-memory |
| Phase 7 | future | CLI + Project Config | `moniro.yaml`, improved CLI |

## Phase 4: Three-Package Split

**目标**: 三个包，三种用途，严格向下依赖。

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

实施步骤：
- [ ] Step 1: Barrel exports — 在现有包内验证三层边界
- [ ] Step 2: Extract `@moniro/agent` — worker + backends + skills + personal context
- [ ] Step 3: Extract `@moniro/workflow` — loop + context + tools
- [ ] Step 4: Clean up `agent-worker` — 只留 daemon + persistence + CLI

关键设计决策：
- **Personal context 在 Agent 层**（可选 toolkit），System 层只负责 wiring 到持久化路径
- **Shared context 在 Workflow 层**，personal context 和 shared context 永不重叠
- **Tool infra + skills 在 Agent 层**，具体 tool 实现（bash、feedback）在 Workflow 层
- System 层可以同时直接依赖 Agent 和 Workflow

**依赖**: Phase 3c（done）。

## 已知风险 & 开放问题

- Test splitting: 1014 tests 如何分配到三个包
- Personal context schema 是否过于 opinionated（当前判断：作为默认实现 ship，storage 接口允许替代）
- Skills tool 放 Workflow 还是 Agent（当前判断：Workflow，因为 skill 调用可能需要 workspace 感知）

## 关键文件

| 文件 | 用途 |
|------|------|
| `packages/agent-worker/docs/architecture/PACKAGE-SPLIT.md` | 三包拆分设计（权威） |
| `packages/agent-worker/docs/architecture/AGENT-TOP-LEVEL.md` | Agent 顶层实体设计 |
| `packages/agent-worker/ARCHITECTURE.md` | 模块结构参考 |
| `.memory/decisions/` | ADR 记录 |
| `.memory/todos/index.md` | 活跃任务 |
| `.memory/notes/` | Session 反思与发现 |
