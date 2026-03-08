# ADR: Agent Loop 内部命名重整

**Date**: 2026-03-08
**Status**: Accepted
**Amends**: 2026-03-06-three-layer-restructuring.md (细化 agent-loop 内部概念命名)

---

## Problem

`@moniro/agent-loop` 内部命名存在几个问题：

1. **Backend 不准确** — "Backend" 暗示"后端服务器"，实际是执行环境（Claude CLI / AI SDK / Codex CLI）。应该叫 Runtime。

2. **ExecutionSession 跟 AgentSession 撞概念** — Worker 层有 `AgentSession`（会话管理），Loop 层又有 `ExecutionSession`（执行引擎）。"Session" 暗示持久化和长生命周期，但 `ExecutionSession` 其实就是"执行一次 tool loop"。

3. **createModel 不是通用概念** — `createModel` / `createModelAsync` 只在 SDK runtime 里用。其他 runtime（claude-code, codex, cursor, opencode）都是调 CLI 子进程，根本不需要 AI SDK 的 `LanguageModel` 对象。不应该作为 agent-loop 的公共 API 导出。

## Decision

### 重命名

| 旧名 | 新名 | 理由 |
|------|------|------|
| `Backend` | `Runtime` | 更准确：执行环境，不是后端服务器 |
| `createBackend()` | `createRuntime()` | 跟随类型重命名 |
| `ExecutionSession` | `Executor` | 短、清晰、不跟 AgentSession 冲突 |
| `createExecutionSession()` | `createExecutor()` | 跟随类型重命名 |
| `ExecutionSessionConfig` | `ExecutorConfig` | 跟随类型重命名 |
| `StreamEvent` / `BackendResponse` | `RuntimeEvent` | 统一事件命名 |

### createModel 下沉

`createModel` / `createModelAsync` / `createModelWithProvider`：

- **不再从包顶层导出**
- 保留在 `models.ts` 作为内部模块
- 只被 `backends/sdk.ts`（→ `runtimes/sdk.ts`）内部 import
- 对外 API 只接受 `model: string`（模型 ID 字符串），由 SDK runtime 内部解析

### 重整后的 agent-loop 公共 API

```typescript
// @moniro/agent-loop 公共 API
export { createRuntime } from "./runtimes";
export { createExecutor } from "./executor";
export type { Runtime, RuntimeEvent, Executor, ExecutorConfig } from "./types";

// 不再导出:
// - createModel, createModelAsync, createModelWithProvider
// - LanguageModel (AI SDK 类型)
// - FRONTIER_MODELS, SUPPORTED_PROVIDERS (内部实现细节)
```

### 使用方式

```typescript
// 之前
const backend = createBackend("claude");
const session = createExecutionSession({ backend, model: createModel("anthropic") });

// 之后
const runtime = createRuntime({ kind: "claude" });
const executor = createExecutor({ runtime, model: "anthropic/claude-sonnet-4-5" });
const result = await executor.run({ system, messages, tools });
```

### 层级一览

```
@moniro/agent-loop
├── Runtime          — 执行环境 (SDK / Claude CLI / Codex / ...)
├── Executor         — 执行引擎 (tool loop, 状态机, 取消/抢占)
├── RuntimeEvent     — 事件流
└── runtimes/
     ├── sdk.ts      — 内部用 createModel（不导出）
     ├── claude-code.ts
     ├── codex.ts
     └── ...
```

## Consequences

1. **API 更清晰** — Runtime（环境）+ Executor（引擎）职责分明，命名不冲突
2. **实现细节内聚** — AI SDK 的 model 概念封装在 SDK runtime 内部，不泄漏到公共 API
3. **对外接口更简单** — 用户只需传 model ID 字符串，不需要理解 `LanguageModel` 对象
4. **现有测试需更新** — `session.test.ts` 中大量 `createModel` 测试需移到 SDK runtime 内部测试
