# ADR: Four-Package Restructuring — Agent Loop / Agent Worker / Workspace + Umbrella

**Date**: 2026-03-06
**Status**: Accepted
**Amends**: PACKAGE-SPLIT.md (redefines layer boundaries and package structure)
**Context**: Personal agent should run independently; @moniro/* are internal packages, agent-worker is the published umbrella

---

## Problem

PACKAGE-SPLIT.md defined three packages, but the layer boundaries don't match the actual cognitive model:

1. **Personal context in the wrong layer** — Prompt assembly (soul/memory/todo injection) and personal context tools live in `@moniro/workflow`. An agent can't "know who it is" without the workflow layer.

2. **"Workflow" is a misleading name** — The layer provides collaboration space (channels, inbox, shared context), not sequential workflows.

3. **Agent layer conflates execution with identity** — Personal context (memory, notes, todos) is about making an agent "a person" — that's the agent-worker's job, not the execution loop's.

4. **依赖方向错误** — 旧设计中 agent-worker 依赖 workflow。但 workspace 应该依赖 agent-worker 来创建 agent；个人 agent 通过标准 MCP 协议接入，agent-worker 完全不知道 workspace 的存在。

5. **三包不够** — agent-worker 同时是"个人 agent 层"和"发布入口（CLI + daemon）"，职责混淆。

## Decision

四个包，三个内部 + 一个 umbrella：

```
packages/
├── agent/           → @moniro/agent-loop      (内部，不发布)
├── worker/          → @moniro/agent-worker     (内部，不发布)
├── workspace/       → @moniro/workspace        (内部，不发布)
└── agent-worker/    → agent-worker             (umbrella，发布，CLI + re-exports)
```

### 层级关系

```
┌─────────────────────────────────────────────┐
│  agent-worker (umbrella，发布包)              │
│  - CLI 入口：agent-worker start/new/send     │
│  - re-export 所有内部包的 public API          │
│  - 不含业务逻辑，纯粹是入口 + 胶水            │
└──────┬──────────┬──────────┬────────────────┘
       │          │          │ re-exports
       ▼          ▼          ▼
┌──────────┐ ┌──────────┐ ┌──────────────────┐
│@moniro/  │ │@moniro/  │ │@moniro/          │
│workspace │ │agent-    │ │agent-loop        │
│          │ │worker    │ │                  │
│ 协作空间  │ │ 个人agent │ │ 纯执行循环        │
└────┬─────┘ └────┬─────┘ └──────────────────┘
     │            │                ▲
     │            └────────────────┘ 依赖
     │                             ▲
     └─────────────────────────────┘ 依赖（通过 agent-worker）
```

### Dependency Rule（严格单向）

```
@moniro/workspace → @moniro/agent-worker → @moniro/agent-loop
```

- `@moniro/agent-loop`：零内部依赖
- `@moniro/agent-worker`：只依赖 `@moniro/agent-loop`
- `@moniro/workspace`：依赖 `@moniro/agent-worker`（间接依赖 agent-loop）
- `agent-worker` (umbrella)：依赖以上三个，re-export + CLI

**所有 `@moniro/*` 包都是内部包，不发布到 npm。** 跟 semajsx 项目同一模式：`workspace:*` 解析，tsdown 各自构建，umbrella 包统一发布。

**个人 agent 接入 workspace**：workspace 暴露标准 MCP server，个人 agent 作为 MCP client 连入。运行时协议集成，不是包依赖。

### Layer Responsibilities

| Layer | 包名 | 一句话 | 拥有 | 不该有 |
|-------|------|--------|------|--------|
| Agent Loop | `@moniro/agent-loop` | 执行一次对话 loop | backends, tool loop, MCP/skills 协议, model mgmt | 身份, 记忆, 调度, 协作 |
| Agent Worker | `@moniro/agent-worker` | 让执行器变成"人" | soul, context, personal tools, bash, prompt assembly, scheduling, daemon | workspace 概念, shared context |
| Workspace | `@moniro/workspace` | 让"人"们协作 | channels, inbox, shared docs, guard, MCP server, workflow runner | 单 agent 的个人上下文管理 |
| Umbrella | `agent-worker` | 发布入口 | CLI, re-exports | 业务逻辑 |

### Key Design Points

**1. Prompt 组装在 @moniro/agent-worker，对调用者开放自定义**

```typescript
const assembler = new PromptAssembler({
  sections: [soulSection, memorySection, todoSection, ...customSections],
});
```

**2. PersonalContextProvider 接口**

```typescript
// 定义在 @moniro/agent-worker
// 命名为 PersonalContextProvider，避免与 workspace 的 ContextProvider 冲突
interface PersonalContextProvider {
  readMemory(): Promise<Record<string, unknown>>;
  writeMemory(key: string, value: unknown): Promise<void>;
  readNotes(limit?: number): Promise<string[]>;
  appendNote(content: string, slug?: string): Promise<string>;
  readTodos(): Promise<string[]>;
  writeTodos(todos: string[]): Promise<void>;
}
// 默认实现：FileContextProvider（从 AgentHandle 提取）
```

**3. MCP/Skills 分层 — 协议在 Loop，管理在 Worker**

- Agent Loop：知道怎么调 MCP tool、怎么加载 skill 并注册为 tool
- Agent Worker：决定连哪些 MCP server，管理连接生命周期，配置 skills

**4. Guard 保留在 Workspace 层（可选）**

**5. Workspace 通过 MCP 提供协作能力，不替换 agent prompt**

实际的协作 sections（现有代码中的真实名称）：
- `activitySection` — 提示用 `channel_read` 获取频道动态
- `inboxSection` — 显示待处理的 inbox 消息
- `documentSection` — 显示共享文档列表

**6. bash 等通用 tools 放在 @moniro/agent-worker**

个人 agent 也需要 bash。`createBashTools()` 搬到 agent-worker 层。

**7. Workspace 独立运行**

```bash
# Workspace — 通过 umbrella CLI 或独立运行
agent-worker run review.yaml          # umbrella 转发给 workspace
agent-worker workspace serve          # 启动 MCP server

# 个人 agent — agent-worker daemon
agent-worker start
agent-worker new alice --model sonnet
agent-worker send alice "hello"
agent-worker connect alice wss://workspace.example/mcp
```

## What Moves Where

| 现在位置 | 移动到 | 内容 |
|----------|--------|------|
| workflow/loop/prompt.ts (`soulSection`, `memorySection`, `todoSection`) | @moniro/agent-worker | 个人 prompt sections |
| workflow/context/mcp/personal.ts (6 个 `my_*` tools) | @moniro/agent-worker | 个人上下文 tools（变本地 tools） |
| workflow/types.ts (`AgentHandleRef`) | @moniro/agent-worker（→ `PersonalContextProvider`） | 存储抽象接口 |
| workflow/tools/bash.ts (`createBashTools`) | @moniro/agent-worker | 通用 tool |

## What Stays

**@moniro/workspace 保留**：
- `context/mcp/server.ts` — 协作 MCP server
- `loop/` — 多 agent 协作 loop + orchestration
- `loop/prompt.ts` 中的 `activitySection`, `inboxSection`, `documentSection`
- `tools/feedback.ts` — workflow 反馈收集
- GUARD-AGENT.md 设计

**@moniro/agent-loop 保留**：
- `definition.ts` (`AgentDefinition`, `AgentSoul`) — 纯数据类型，所有层都用
- `worker.ts` (`AgentWorker`) — 执行循环核心
- `backends/` — 后端抽象
- `skills/` — skill 协议支持
- `conversation.ts` (`ConversationLog`, `ThinThread`) — **待定**，可能应搬到 agent-worker

## Package Configuration

```jsonc
// packages/agent-loop/package.json
{ "name": "@moniro/agent-loop", "private": true }

// packages/agent-worker/package.json（内部包，不是 umbrella）
{ "name": "@moniro/agent-worker", "private": true,
  "dependencies": { "@moniro/agent-loop": "workspace:*" } }

// packages/workspace/package.json
{ "name": "@moniro/workspace", "private": true,
  "dependencies": { "@moniro/agent-worker": "workspace:*" } }

// packages/moniro/package.json（umbrella，发布）
{ "name": "agent-worker",
  "dependencies": {
    "@moniro/agent-loop": "workspace:*",
    "@moniro/agent-worker": "workspace:*",
    "@moniro/workspace": "workspace:*"
  },
  "bin": { "agent-worker": "./dist/cli/index.mjs" } }
```

tsdown 各包独立构建，跟现有模式一致。

## Consequences

1. **个人 agent 完全独立**：`@moniro/agent-worker` 有 prompt assembly + personal tools + bash + scheduling
2. **Workspace 是独立服务**：依赖 `@moniro/agent-worker` 创建内部 agent，暴露 MCP 让外部 agent 接入
3. **Agent Loop 保持纯粹**：system prompt + tools + 消息 → loop → 结果
4. **标准 MCP 集成**：个人 agent 接入 workspace 是运行时 MCP 连接，不是包依赖
5. **umbrella 纯入口**：CLI + re-exports，不含业务逻辑
6. **跟 semajsx 同模式**：内部 `@scope/*` + 发布 umbrella

## Resolved Questions

1. **conversation.ts 归属** — ✅ 已移至 `@moniro/agent-worker`（packages/worker/src/conversation.ts）。对话持久化属于身份层。
2. **umbrella 包名** — ✅ 目录 `packages/agent-worker/`，包名 `agent-worker`。内部包 `@moniro/agent-worker` 目录为 `packages/worker/`。
3. **workspace CLI** — ✅ 通过 umbrella CLI 子命令暴露，后续按需规划独立 CLI。
4. **agent-loop 目录名** — ✅ `packages/agent/`，包名保持 `@moniro/agent-loop`。
