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
| **Phase 6a** | **next** | **Personal Agent Prompt** | soulSection + memorySection + todoSection 注入 prompt |
| **Phase 6b** | next | **Personal Context Tools + Auto-Memory** | 动态 MCP tools + recall + auto-memory |
| **Phase 6c** | future | **Guard Agent（看守者）** | 智能上下文选择, 隐私控制, 记忆调解 |
| Phase 7 | deprioritized | CLI + Project Config | `moniro.yaml`, improved CLI |

## Phase 6: Personal Agent 路线图

> **核心思路**：独立 agent 已具备个人 agent 的基础设施（AgentHandle、context dir、soul schema、ThinThread）。主要工作是 **prompt 注入**，tools 可动态挂载，不需要独立阶段。

### Phase 6a: Personal Agent Prompt（最高优先级）
**目标**：让 agent 在对话中"知道自己是谁"——有身份、有记忆、有任务。

**注入点**：`packages/workflow/src/loop/prompt.ts` 的 `DEFAULT_SECTIONS`

新增 PromptSection：
- `soulSection` — 从 `agent.soul` 注入 role/expertise/style/principles
- `memorySection` — 从 `.agents/<name>/memory/` 读取关键条目（bounded）
- `todoSection` — 从 `.agents/<name>/todo/` 注入活跃任务

**已有基础**：
- `AgentSoul` 类型已定义（`definition.ts:25-36`），只差注入
- `AgentHandle` 的 context dir 已有 memory/notes/todo 子目录
- `PromptSection` 模式已成熟，新增 section 即可
- `ThinThread` 对话历史已有（但 `processInstruction()` 缺少传递，需修复）

**关键设计决策**：
- soul 注入到 system prompt 还是 user prompt？（倾向 system prompt，更稳定）
- memory 注入策略：全量 vs 按相关性选取（初版全量 bounded，后续 Guard 优化）
- AgentRunContext 需要扩展，携带 soul/memory/todo 数据

### Phase 6b: Personal Context Tools + Auto-Memory
**目标**：让 agent 运行时可以读写记忆 + 自动学习。

- `memory_read/write`, `note_read/write`, `todo_read/write` — 动态注册为 MCP tools
- `history_search/read` — 搜索/读取历史对话
- 自动记忆提取：指令完成后 LLM 判断是否有值得记住的内容
- **tools 动态挂载**：基于 AgentHandle 是否有 context dir 决定是否注册

### Phase 6c: Guard Agent（看守者）
**目标**：智能上下文组装，防止信息过载，维护隐私边界。

- 设计文档已完成：`GUARD-AGENT.md`（791 行）
- 取代 Phase 6a 的简单全量注入，改为智能选择
- **依赖**：Phase 6a-6b 完成后再考虑

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
