# ADR: Three-Layer Restructuring — Agent Loop / Agent Worker / Workspace

**Date**: 2026-03-06
**Status**: Accepted
**Amends**: PACKAGE-SPLIT.md (redefines layer boundaries)
**Context**: Personal agent should run independently at Agent Worker layer, not depend on Workflow for identity

---

## Problem

PACKAGE-SPLIT.md defined three packages, but the layer boundaries don't match the actual cognitive model:

1. **Personal context in the wrong layer** — Prompt assembly (soul/memory/todo injection) and personal context tools live in `@moniro/workflow`. An agent can't "know who it is" without the workflow layer. A personal agent should be able to run standalone.

2. **"Workflow" is a misleading name** — The layer provides collaboration space (channels, inbox, shared context), not sequential workflows. "Workspace" better describes what it does.

3. **Agent layer conflates execution with identity** — PACKAGE-SPLIT.md put personal context toolkit in the agent layer as optional. But personal context (memory, notes, todos) is about making an agent "a person" — that's the agent-worker's job, not the execution loop's.

4. **Guard Agent concept overreach** — Phase 6c proposed a "Guard Agent" as a supervisor within workflows. But if personal agents run independently, the guard should be a workspace-level optimization, not a requirement for personal identity.

5. **依赖方向错误** — 旧设计中 agent-worker 依赖 workflow（为了跑 workflow）。但 workspace 应该是独立运行的服务，自己依赖 agent-worker 来创建 agent；个人 agent 通过标准 MCP 协议接入，agent-worker 完全不知道 workspace 的存在。

## Decision

Redefine the three layers by cognitive role:

```
┌─────────────────────────────────────────────┐
│  Workspace (原 @moniro/workflow)              │
│  "让人们协作"                                 │
│  - 独立运行的协作服务                         │
│  - 依赖 agent-worker 创建 workflow 内的 agent │
│  - 暴露标准 MCP server                       │
│  - 外部个人 agent 通过 MCP client 接入        │
│  - Guard（可选，管理协作上下文预算）            │
└──────────────────┬──────────────────────────┘
                   │ 依赖（创建 agent）
┌──────────────────┴──────────────────────────┐
│  Agent Worker (原 agent-worker)               │
│  "让执行器变成人"                              │
│  - 身份：soul prompt 组装                     │
│  - 记忆：PersonalContextProvider              │
│  - 个人 tools：memory, notes, todos, bash     │
│  - MCP client（接入 workspace 或外部服务）     │
│  - Skills 管理                                │
│  - 调度：schedule, cron                       │
│  - 对话管理：ConversationLog, ThinThread       │
│  - prompt 组装：可组合 sections，对调用者开放   │
│  - daemon + CLI                              │
│  - 不知道 workspace 的存在                    │
└──────────────────┬──────────────────────────┘
                   │ 依赖（执行 loop）
┌──────────────────┴──────────────────────────┐
│  Agent Loop (原 @moniro/agent)                │
│  "执行一次对话循环"                            │
│  - 一次 loop = 多次工具调用                    │
│  - 封装 backend（SDK, Claude CLI, Codex...）  │
│  - tool 注册 + approval flow                  │
│  - MCP 协议支持（基础能力）                    │
│  - Skills 协议支持（加载 + 注册为 tool）       │
│  - 模型管理 + provider 发现                    │
│  - 无状态，不知道"我是谁"                      │
└─────────────────────────────────────────────┘
```

### Dependency Rule（严格单向）

```
@moniro/workspace → agent-worker → @moniro/agent
```

- `@moniro/agent`：零内部依赖
- `agent-worker`：只依赖 `@moniro/agent`，**不依赖 workspace**
- `@moniro/workspace`：依赖 `agent-worker`（用它来创建 workflow 内的 agent）

**个人 agent 接入 workspace 的方式**：workspace 暴露标准 MCP server，个人 agent（由 agent-worker 管理）作为 MCP client 连入。这是运行时协议级别的集成，不是包依赖。

### Layer Responsibilities (Clean Cut)

| Layer | 一句话 | 拥有 | 不该有 |
|-------|--------|------|--------|
| Agent Loop | 执行一次对话 loop | backends, tool loop, MCP/skills 协议, model mgmt | 身份, 记忆, 调度, 协作 |
| Agent Worker | 让执行器变成"人" | soul, context, personal tools, bash, prompt assembly, scheduling, daemon | workspace 概念, shared context |
| Workspace | 让"人"们协作 | channels, inbox, shared docs, guard, MCP server, workflow runner | 单 agent 的个人上下文管理 |

### Key Design Points

**1. Prompt 组装在 Agent Worker 层，对调用者开放自定义**

```typescript
const assembler = new PromptAssembler({
  sections: [soulSection, memorySection, todoSection, ...customSections],
});
// 调用者可替换、插入、删除 section
// 也可完全自定义 buildPrompt 函数
```

**2. 个人上下文用 PersonalContextProvider 接口**

```typescript
// 接口定义在 Agent Worker 层
// 命名为 PersonalContextProvider，避免与 workspace 的 SharedContextProvider 冲突
interface PersonalContextProvider {
  readMemory(): Promise<Record<string, unknown>>;
  writeMemory(key: string, value: unknown): Promise<void>;
  readNotes(limit?: number): Promise<string[]>;
  appendNote(content: string, slug?: string): Promise<string>;
  readTodos(): Promise<string[]>;
  writeTodos(todos: string[]): Promise<void>;
}

// 默认实现：FileContextProvider（从 AgentHandle 提取）
// 未来：RedisContextProvider, SQLiteContextProvider, APIContextProvider
```

**注意命名**：个人上下文用 `PersonalContextProvider`，workspace 的共享上下文保持现有的 `ContextProvider`（或改名为 `SharedContextProvider`），避免同名混淆。

**3. MCP/Skills 分层 — 协议在 Loop，管理在 Worker**

Agent Loop 层：知道怎么调 MCP tool（协议实现、tool 发现、tool 调用），知道怎么加载 skill 并注册为 tool。

Agent Worker 层：决定连哪些 MCP server（包括 workspace 的），管理 MCP 连接生命周期，决定装哪些 skills，配置 skill 触发时机。

**4. Guard 保留在 Workspace 层**

Guard 是多 agent 场景下的上下文预算管理，不是个人 agent 的依赖。个人 agent 独立运行时不需要 guard。

**5. Workspace prompt 叠加而非独占**

Workspace 不替换 agent 的 prompt，而是通过 MCP 追加协作相关的 tools 和上下文。实际的协作 sections 是：

```typescript
// 这些是 workspace 层现有的真实 section 名：
activitySection,    // 提示用 channel_read 获取频道动态
inboxSection,       // 显示待处理的 inbox 消息
documentSection,    // 显示共享文档列表
```

**6. bash 等通用 tools 放在 Agent Worker 层**

个人 agent 也需要 bash。`createBashTools()` 从 workflow 层搬到 agent-worker 层，封装 `bash-tool` npm 包。Workspace 的 agent 通过 agent-worker 自然获得 bash 能力。

**7. Workspace 独立运行，不被 agent-worker 调用**

```bash
# Workspace 自己的入口（不通过 agent-worker CLI）
moniro-workspace run review.yaml     # 独立运行 workflow
moniro-workspace serve                # 启动 MCP server，等待 agent 接入

# Agent Worker 的 CLI 只管个人 agent
agent-worker start                    # 启动 daemon
agent-worker new alice --model sonnet # 创建个人 agent
agent-worker send alice "hello"       # 给 agent 发消息
agent-worker connect alice wss://workspace.example/mcp  # alice 接入某个 workspace
```

## What Moves Where

| 现在位置 | 移动到 | 内容 |
|----------|--------|------|
| workflow/loop/prompt.ts (`soulSection`, `memorySection`, `todoSection`) | agent-worker | 个人 prompt sections |
| workflow/context/mcp/personal.ts (6 个 `my_*` tools) | agent-worker | 个人上下文 tools（变成本地 tools） |
| workflow/types.ts (`AgentHandleRef`) | agent-worker（变成 `PersonalContextProvider`） | 存储抽象接口 |
| workflow/tools/bash.ts (`createBashTools`) | agent-worker | 通用 tool，个人 agent 也需要 |
| agent/src/context/（PACKAGE-SPLIT 旧规划） | agent-worker | 个人上下文 toolkit 不放在 loop 层 |

## What Stays in Workspace

| 位置 | 保留 | 理由 |
|------|------|------|
| workflow/context/mcp/server.ts | workspace | 协作 MCP server |
| workflow/loop/ | workspace | 多 agent 协作 loop + orchestration |
| workflow/loop/prompt.ts (`activitySection`, `inboxSection`, `documentSection`) | workspace | 协作 prompt sections |
| workflow/tools/feedback.ts | workspace | workflow 反馈收集 |
| GUARD-AGENT.md 设计 | workspace | 协作场景的上下文优化 |

## What Stays in Agent Loop

| 位置 | 保留 | 理由 |
|------|------|------|
| agent/src/definition.ts (`AgentDefinition`, `AgentSoul`) | agent loop | 纯数据类型，所有层都用 |
| agent/src/conversation.ts (`ConversationLog`, `ThinThread`) | 待定 | 对话持久化可能应属于 agent-worker（身份层），但目前在 agent loop |
| agent/src/worker.ts (`AgentWorker`) | agent loop | 执行循环核心 |
| agent/src/backends/ | agent loop | 后端抽象 |
| agent/src/skills/ | agent loop | skill 协议支持 |

## Consequences

1. **个人 agent 完全独立**：agent-worker 有 prompt assembly + personal tools + bash + scheduling，不需要 workspace
2. **Workspace 是独立服务**：自己运行 workflow，暴露 MCP server，用 agent-worker 创建内部 agent
3. **Agent Loop 保持纯粹**：给我 system prompt + tools + 消息，我执行 loop 返回结果
4. **标准 MCP 集成**：个人 agent 接入 workspace 是运行时 MCP 连接，不是编译时依赖
5. **Phase 6a/6b 代码大部分是搬家**：soulSection/memorySection/todoSection + personal MCP tools 搬到 agent-worker
6. **`agent-worker run` 命令移除**：workflow 运行由 workspace 自己负责

## Open Questions

1. **conversation.ts 归属** — `ConversationLog`/`ThinThread` 目前在 agent loop，但对话持久化更像身份层的职责。是否搬到 agent-worker？
2. **包名** — `@moniro/agent` vs `@moniro/agent-loop`？`@moniro/workflow` → `@moniro/workspace` 何时改？
3. **agent-worker 是否过大** — 同时承担"个人 agent"和"系统服务(daemon+CLI)"。后续是否拆分？
4. **workspace CLI 入口** — workspace 需要自己的 CLI（`moniro-workspace run/serve`），还是复用现有机制？
