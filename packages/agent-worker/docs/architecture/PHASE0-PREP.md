# Phase 0: Pre-Implementation Cleanup

**Date**: 2026-02-27
**Status**: Complete (all 6 tasks done, 880 tests pass)
**Prerequisite for**: AGENT-TOP-LEVEL Phases 1-3

> **实施原则：不考虑向后兼容。** Phase 1+ 不写兼容遗留代码，不保留 deprecated 接口，直接替换。

---

## Why

AGENT-TOP-LEVEL 定义了 6 个实施阶段。但当前代码有几个结构性问题会阻碍实施：

1. **命名冲突** — 当前 `AgentDefinition` 是 workflow 层的类型（`system_prompt`, `wakeup`），新架构需要一个同名但完全不同的顶层类型（`prompt`, `soul`, `context`）。两者同时存在会造成混乱。
2. **Agent-Workflow 耦合** — `AgentConfig` 有必填的 `workflow` 和 `tag` 字段，每个 agent 创建时就绑定到一个 workflow。新架构要求 agent 独立于 workflow 存在。
3. **Loop 归属权倒置** — `WorkflowHandle.loops` 拥有 agent loops。新架构要求 daemon 拥有 loops，workflow 只引用它们。
4. **`standalone:` hack** — 独立 agent 通过假的 `WorkflowHandle`（key 为 `standalone:{name}`）运行。这是 #3 的症状，消除 #3 后自然消失。
5. **Prompt 建构不可组合** — `buildAgentPrompt` 是单一函数，硬编码 workflow 上下文。新架构需要注入 soul/memory/todo 段落。

这些不是"nice to have"的重构 — 它们是实施 Phase 1-3 的前置条件。

---

## Tasks

### 0.1 Rename `AgentDefinition` → `WorkflowAgentDef`

**Blocks**: Phase 1（需要定义新的 `AgentDefinition`）
**Risk**: Zero — 纯重命名
**Scope**: ~15 files

当前 `AgentDefinition`（workflow/types.ts:76）描述 workflow 内的 agent 配置。重命名为 `WorkflowAgentDef`，释放 `AgentDefinition` 给新的顶层 agent 定义。

同步重命名：
- `ResolvedAgent` → `ResolvedWorkflowAgent`（已有命名冲突：AGENT-TOP-LEVEL.md 也用了这个名字）

### 0.2 Decouple `AgentConfig` from workflow

**Blocks**: Phase 1（agent 需要独立于 workflow 注册）
**Risk**: Low — 向后兼容（保留默认值）
**Scope**: agent/config.ts, daemon.ts, CLI commands

改动：
- `workflow` 和 `tag` 变为 optional（`workflow?: string`, `tag?: string`）
- `POST /agents` 不再要求 workflow，默认 undefined
- `findLoop()` 和 `ensureAgentLoop()` 适配无 workflow 的 agent
- `configToResolvedAgent()` 不依赖 workflow 字段

### 0.3 Add daemon agent lifecycle tests

**Blocks**: 0.4, 0.5（安全网）
**Risk**: Zero — 只加测试
**Scope**: test/unit/

为即将改动的路径增加集成测试：
- Standalone agent lifecycle: create → run → delete
- `ensureAgentLoop` lazy creation
- `findLoop` across workflows
- Agent cleanup on delete（包括 standalone workflow handle）

### 0.4 Extract loop ownership from `WorkflowHandle`

**Blocks**: Phase 3（daemon 需要拥有 agent loops）
**Risk**: Medium — 触及执行路径
**Scope**: daemon.ts, factory.ts

改动：
- `DaemonState` 增加 `loops: Map<string, AgentLoop>`
- `WorkflowHandle.loops` 变为引用（ref）而非拥有（own）
- `ensureAgentLoop()` 在 daemon loops map 中创建
- `findLoop()` 从 daemon loops map 查找
- Workflow shutdown 不再负责 stop agent loops（standalone loops 由 daemon 管理）
- Workflow loops 仍然需要 stop workflow-local 的 inline agents

### 0.5 Remove `standalone:` hack

**Depends**: 0.4
**Blocks**: Phase 3 cleanup
**Risk**: Low（0.4 完成后很自然）
**Scope**: daemon.ts

改动：
- Standalone agent 不再创建假的 `WorkflowHandle`
- `ensureAgentLoop()` 只在 daemon loops map 中创建 loop + runtime
- `DELETE /agents/:name` 直接从 daemon loops map 清理
- `GET /health` 和 `GET /agents` 从 daemon loops map 获取状态

### 0.6 Make `buildAgentPrompt` composable

**Blocks**: Phase 2/5（需要注入新的 prompt 段落）
**Risk**: Low — 纯函数重构
**Scope**: workflow/loop/prompt.ts

改动：
- 提取 `PromptSection` 接口：`(ctx) => string | null`
- 每个当前段落变成独立 section（project, inbox, activity, document, retry, instructions）
- `buildAgentPrompt` 变成组合器：接收 sections 数组，拼接非 null 结果
- 默认 sections 列表保持当前行为
- Phase 5 新增 sections：soul, memory, todo

---

## Skip List

以下不在 Phase 0 范围内（原因见 AGENT-TOP-LEVEL.md）：

| Item | Reason |
|------|--------|
| `FileStateStore` | Phase 3 直接替换为 JSONL ConversationLog + ThinThread，不走中间状态 |
| `ContextProvider` 拆分 | 当前接口映射到 Workspace，不需要改。Personal context 是新模块 |
| Legacy workers 清理 | 第 18 任已统一到 controller 路径。剩余 workers map 是测试桩，不阻塞 |

---

## Verification

每个 task 完成后：
1. `bun test` 全部通过
2. `bun run build` clean
3. 无行为变更（纯结构重构）
