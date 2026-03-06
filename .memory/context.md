# Project Context

> 快速了解项目状态。详细设计见 `packages/agent-worker/docs/architecture/` 下各文档。

## 当前焦点

**Personal Agent 优先** — 个人 Agent 支持提升为最高优先级。Phase 5（PR #110）待合并后，立即进入 Phase 6 个人 Agent 系列。CLI/Config 降级。

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
| **Phase 6a** | **next** | **Soul + Context Prompt 注入** | soul section, memory/todo injection, prompt assembly |
| **Phase 6b** | next | **Personal Context MCP Tools** | `memory_read/write`, `note_read/write`, `todo_read/write` |
| **Phase 6c** | next | **Auto-Memory + Recall** | 指令完成后自动提取记忆, `history_search` |
| **Phase 6d** | future | **Guard Agent（看守者）** | 智能上下文选择, 隐私控制, 记忆调解 |
| Phase 7 | deprioritized | CLI + Project Config | `moniro.yaml`, improved CLI |

## Phase 6: Personal Agent 路线图

### Phase 6a: Soul + Context Prompt 注入（最高优先级）
**目标**：让 agent 在对话中"知道自己是谁"，拥有持久记忆和身份。

- 将 `soul` 字段注入 system prompt（role, expertise, style, principles）
- 将 agent 的 `memory/` 关键条目注入 prompt（bounded，按相关性选取）
- 将 agent 的 `todo/` 活跃任务注入 prompt
- ThinThread 已有（Phase 3c），整合到 prompt assembly pipeline
- **依赖**：`@moniro/agent` 的 `definition.ts`（soul schema 已有）、`AgentHandle`（context dir 已有）

### Phase 6b: Personal Context MCP Tools
**目标**：让 agent 在运行时可以读写自己的记忆、笔记、任务。

- `memory_read(key?)` / `memory_write(key, value)` — YAML key-value
- `note_read(slug?)` / `note_write(content, slug?)` — Markdown 笔记
- `todo_read()` / `todo_write(todos)` — 任务管理
- 注册为 MCP tools，通过 `AgentHandle` 操作对应 context dir
- **依赖**：Phase 6a prompt 注入（tools 需要知道 context dir 位置）

### Phase 6c: Auto-Memory + Recall
**目标**：agent 自动从对话中学习，支持历史搜索。

- 指令完成后自动提取关键记忆（LLM 判断 + 结构化存储）
- `history_search(query)` — 搜索历史对话
- `history_read(conversation_id, range?)` — 读取特定对话
- **依赖**：Phase 6b tools 基础设施

### Phase 6d: Guard Agent（看守者）
**目标**：智能上下文组装，防止信息过载，维护隐私边界。

- 设计文档已完成：`GUARD-AGENT.md`（791 行）
- 功能：context assembly, memory mediation, identity governance
- Hybrid 实现：deterministic（搜索/过滤/存储）+ LLM（判断记什么）
- **依赖**：Phase 6a-6c 全部完成

## Phase 5 要点（待合并）

- 三 lane 优先级队列：`immediate > normal > background`
- 协作式抢占：LLM step 间检查 `shouldYield()`，高优先级到达时 yield
- `PreemptionError` throw-to-exit，loop 重新入队 + `InstructionProgress` 恢复上下文
- `AgentHandle.send()`/`sendMessage()` — 类型化指令路由
- Scheduled wakeup 直接入队为 `background`，不再写 synthetic channel message
- 1047 tests pass

## 已知风险 & 开放问题

- `send` CLI target 解析（DM / @workspace / agent@workspace）— Phase 3b 遗留，降低优先级
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
