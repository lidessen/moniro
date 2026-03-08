# Runtime Host — Design Thinking

> 实现细节见 `docs/DESIGN.md` Layer 4-5。本文件记录托管层的设计推理。

## 核心问题

```
谁拥有 agent、workspace、workflow 这些长生命周期对象，
它们何时创建、何时销毁、状态归谁管理？
```

## 为什么需要独立一层

当前 daemon 同时承担两类职责：
1. runtime object ownership（agent registry, workspace registry, workflow handles）
2. protocol handling（HTTP, MCP, SSE）

这导致 daemon.ts 成为系统最大的混合体。拆分为 Runtime Host + Interface Layer 可以让：
- object lifecycle 独立于协议处理
- 不同协议入口共享同一套 runtime state，而不是各自直连底层
- 单独测试 lifecycle 管理

## 关键设计决策

### 五类状态

Runtime Host 视角下需区分状态归属：

| 类别 | 例子 | 拥有者 |
|------|------|--------|
| Agent-owned | Soul, memory, todos, conversations | agent-worker |
| Workspace-owned | channel, documents, proposals | workspace |
| Workflow-owned | definition, params, agent assignment | workflow |
| Host-owned | registries, handles, default workspace | runtime-host |
| Transport-owned | MCP sessions, HTTP streams | interface-layer |

核心原则：**State should live with the layer that gives it meaning and owns its lifecycle.**

两条约束：
- personal state 不会因为被 workspace 使用就变成 workspace state
- transport state 必须保持可丢弃，不反向拥有 runtime object

### Factory 优于 Monolith

Runtime Host 不应自己重新实现 workspace/loop 的创建逻辑，而应使用 composable factory primitives：
- 何时创建
- 创建哪些
- 如何持有
- 何时销毁

构造过程属于下层包，组合决策属于 host。

### 目录即 Ownership

目录结构反映 ownership 和 persistence：

```
~/.agent-worker/
  config.yml                   # host config
  channel.jsonl                # global workspace shared state
  documents/
  agents/
    alice/                     # personal state
      memory/ notes/ todos/
  workspaces/
    review/                    # named workspace
    review@pr-123/             # tagged instance
```

规则：
- 看到路径就能分辨 shared / personal / runtime state
- tag 为空时直接用 workspace 名称
- global workspace 是根目录，不再套多余路径

### Lifecycle 问题

Runtime Host 必须回答：
- agent 何时被加载（从 config.yml，daemon start 时）
- workspace 何时被创建（run/start 命令或 API）
- workflow 何时复用已有 workspace，何时新建
- shutdown 时先停哪个层级
- restart 后哪些状态恢复，哪些丢弃

## 开放问题

1. **Host / Interface 分离**: 当前 daemon 混合两层，待重构
2. **RuntimeHost interface**: 已设计 draft（ownership-oriented handles + lifecycle API），待实现
3. **Unified timeline**: daemon events / workspace events / tool events 应落到兼容的 append-only model，目前只在 workspace 层有 EventLog
