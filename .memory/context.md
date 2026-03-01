# Project Context

> 快速了解项目状态。详细设计见 `packages/agent-worker/docs/architecture/AGENT-TOP-LEVEL.md`。

## 当前焦点

**Agent 架构重构** — 将 Agent 从 Workflow 内嵌定义提升为顶层实体，拥有独立的持久化上下文（prompt、soul、memory、notes、conversations、todo）。

## 阶段总览

| 阶段 | 状态 | 内容 | 关键产物 |
|------|------|------|----------|
| Phase 0 | done | 预备清理：类型重命名、config 解耦、生命周期测试 | `WorkflowAgentDef`, `DaemonState.loops` |
| Phase 1 | done | Agent 定义 + Context：YAML、Registry、CLI | `.agents/*.yaml`, `AgentHandle`, `AgentRegistry` |
| Phase 2 | done | Workflow Agent References：`ref:` 引用 | `AgentEntry` 联合类型, prompt assembly |
| Phase 3a | done | Event Log 基础设施：结构化日志替代 console.* | `EventSink`, `DaemonEventLog`, `Logger` |
| **Phase 3b** | **next** | **Daemon Registry + Workspace** | 见下方 |
| Phase 3c | blocked by 3b | Conversation Model：ThinThread + ConversationLog | |
| Phase 3d | blocked by 3c | Priority Queue + Preemption | |
| Phase 4 | future | Recall Tools + Auto-Memory + Failure Handling | |
| Phase 5 | future | Agent Context in Prompt | |
| Phase 6 | future | CLI + Project Config | |

## Phase 3b: Daemon Registry + Workspace

**目标**: Daemon 通过 AgentRegistry 管理 agent handle。Workspace 替代 standalone WorkflowHandle hack。

核心任务：
- [ ] AgentRegistry 集成到 daemon（替代 `configs: Map<string, AgentConfig>`）
- [ ] `Workspace` 类型从 `WorkflowRuntimeHandle` 分离
- [ ] `WorkspaceRegistry` 管理活跃 workspace
- [ ] Workspace attach/detach（workflow start/stop 时）
- [ ] 移除 `standalone:{name}` workflow key hack
- [ ] `send` CLI 命令 target 解析（DM / @workspace / agent@workspace）

**依赖**: Phase 3a（done）。无其他阻塞。

## 已知风险 & 开放问题

- Agent context 格式未定（memory YAML vs JSON vs markdown）
- Soul 可变性未定（固定 vs 可进化）
- 跨项目 Agent 暂不考虑（先 project-scoped）
- Auto-memory 提取策略未定（agent 主动 vs 系统后处理 vs 两者）

## 关键文件

| 文件 | 用途 |
|------|------|
| `packages/agent-worker/docs/architecture/AGENT-TOP-LEVEL.md` | 架构设计（权威） |
| `.memory/decisions/` | ADR 记录 |
| `.memory/todos/index.md` | 活跃任务 |
| `.memory/notes/` | Session 反思与发现 |
