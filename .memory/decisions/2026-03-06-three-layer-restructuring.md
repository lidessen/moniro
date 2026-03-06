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

## Decision

Redefine the three layers by cognitive role:

```
┌─────────────────────────────────────────────┐
│  Workspace (原 @moniro/workflow)              │
│  "让人们协作"                                 │
│  - 协作空间：channel, inbox, shared docs      │
│  - MCP server（暴露协作 tools）               │
│  - Guard（可选，管理协作上下文预算）            │
│  - Agent 通过 MCP client 加入                 │
└──────────────────┬──────────────────────────┘
                   │ 可选加入
┌──────────────────┴──────────────────────────┐
│  Agent Worker (原 agent-worker)               │
│  "让执行器变成人"                              │
│  - 身份：soul prompt 组装                     │
│  - 记忆：ContextProvider（file/redis/...）    │
│  - 个人 tools：memory, notes, todos           │
│  - MCP client + Skills 管理                   │
│  - 调度：schedule, cron                       │
│  - 对话管理：ConversationLog, ThinThread       │
│  - prompt 组装：可组合 sections，对调用者开放   │
│  - daemon + CLI                              │
└──────────────────┬──────────────────────────┘
                   │ 调用
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

### Layer Responsibilities (Clean Cut)

| Layer | 一句话 | 拥有 | 不该有 |
|-------|--------|------|--------|
| Agent Loop | 执行一次对话 loop | backends, tool loop, MCP/skills 协议, model mgmt | 身份, 记忆, 调度, 协作 |
| Agent Worker | 让执行器变成"人" | soul, context, personal tools, prompt assembly, scheduling, daemon | 多 agent 协作, shared context |
| Workspace | 让"人"们协作 | channels, inbox, shared docs, guard, MCP server | 单 agent 的个人上下文管理 |

### Key Design Points

**1. Prompt 组装在 Agent Worker 层，对调用者开放自定义**

```typescript
// Agent Worker 提供可组合的 prompt assembler
const assembler = new PromptAssembler({
  sections: [soulSection, memorySection, todoSection, ...customSections],
});
// 调用者可替换、插入、删除 section
// 也可完全自定义 buildPrompt 函数
```

**2. 个人上下文用文件默认实现，支持多 storage provider**

```typescript
// ContextProvider 接口定义在 Agent Worker 层
interface ContextProvider {
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

**3. MCP/Skills 分层 — 协议在 Loop，管理在 Worker**

Agent Loop 层：知道怎么调 MCP tool（协议实现、tool 发现、tool 调用），知道怎么加载 skill 并注册为 tool。

Agent Worker 层：决定连哪些 MCP server，管理 MCP 连接生命周期，决定装哪些 skills，配置 skill 触发时机。

**4. Guard 保留在 Workspace 层**

Guard 是多 agent 场景下的上下文预算管理，不是个人 agent 的依赖。个人 agent 独立运行时不需要 guard。

**5. Workspace prompt 叠加而非独占**

Workspace 不替换 agent 的 prompt，而是追加协作相关的 sections：

```typescript
const workflowSections = [
  ...agent.promptAssembler.sections,  // agent 自带的个人 sections
  channelContextSection,               // workspace 追加
  teamRulesSection,
];
```

## What Moves Where

| 现在位置 | 移动到 | 内容 |
|----------|--------|------|
| workflow/loop/prompt.ts (soulSection, memorySection, todoSection) | agent-worker | 个人 prompt sections |
| workflow/context/mcp/personal.ts | agent-worker | 个人上下文 tools（变成本地 tools） |
| workflow/types.ts (AgentHandleRef) | agent-worker (变成 ContextProvider) | 存储抽象接口 |
| agent/src/context/ (PACKAGE-SPLIT 规划) | agent-worker | 个人上下文 toolkit 不放在 loop 层 |
| workflow/loop/prompt.ts (channelSection 等) | workspace | 协作 prompt sections 留在 workspace |

## What Stays

| 位置 | 保留 | 理由 |
|------|------|------|
| workflow/context/mcp/server.ts | workspace | 协作 MCP server |
| workflow/loop/ | workspace | 多 agent 协作 loop |
| GUARD-AGENT.md 设计 | workspace | 协作场景的上下文优化 |

## Consequences

1. 个人 agent 可以独立运行：`AgentWorker` layer 有 prompt assembly + personal tools + scheduling，不需要 workspace
2. Workspace 变成可选的协作扩展：agent 通过 MCP client 加入
3. Agent Loop 保持纯粹：给我 system prompt + tools + 消息，我执行 loop 返回结果
4. Phase 6a/6b 已有代码大部分是搬家而非重写
5. `@moniro/workflow` 包名可考虑改为 `@moniro/workspace`

## Open Questions

1. **包名是否改** — `@moniro/agent` → `@moniro/agent-loop`？还是保持包名不变，只在文档中用 "Agent Loop" 概念？
2. **agent-worker 拆分** — 现在 agent-worker 同时是"个人 agent"和"系统服务(daemon+CLI)"。是否需要进一步拆分？
3. **MCP client 实现** — Agent Worker 层的 MCP client 基础设施需要新建，用于连接 workspace 和外部 MCP server
