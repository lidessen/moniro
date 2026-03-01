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
| Phase 3b | done | Daemon Registry + Workspace | `Workspace`, `WorkspaceRegistry`, `AgentHandle.loop` |
| **Phase 3c** | **next** | **Conversation Model：ThinThread + ConversationLog** | 见下方 |
| Phase 3d | blocked by 3c | Priority Queue + Preemption | |
| Phase 4 | future | Recall Tools + Auto-Memory + Failure Handling | |
| Phase 5 | future | Agent Context in Prompt | |
| Phase 6 | future | CLI + Project Config | |

## Phase 3c: Conversation Model

**目标**: ThinThread 有界上下文 + ConversationLog 完整历史。Agent 拥有对话连续性。

核心任务：
- [ ] `ThinThread` 类型：有界内存消息（per context）
- [ ] `ConversationLog` 类型：JSONL append-only 存储 + search/time-range read
- [ ] 日志持久化（personal → `.agents/<name>/conversations/`，workspace → `.workspace/`）
- [ ] `thin_thread` 配置在 agent definition（default: 10 messages）
- [ ] ThinThread 集成到 prompt assembly

**依赖**: Phase 3b（done）。Agent 必须在 daemon 运行时中存在才能拥有对话。

**遗留**: `send` CLI target 解析（Phase 3b 遗留，不阻塞 3c）。

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
