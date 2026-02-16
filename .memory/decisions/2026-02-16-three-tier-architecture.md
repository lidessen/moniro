---
type: decision
status: active
tags: [architecture, agent-worker, three-tier, daemon, worker]
created: 2026-02-16
---

# Three-Tier Architecture: Interface → Daemon → Worker

## Context

agent-worker 的目标是打造多 agent 协作系统。之前的架构隐含了三层分离（CLI / daemon / agent+controller），但没有显式定义每层的契约和边界。

灵感来源：
- **NanoClaw**: 极简管道 WhatsApp → SQLite → Polling → Container → Response，container-runner 作为纯执行单元
- **nanobot (HKUDS)**: Agent Kernel 愿景，最小稳定内核 + 插件接口（BaseChannel, BaseTool, LLMProvider）
- **OpenClaw**: 反面教材——52 模块、45 依赖的膨胀，提醒 daemon 要保持内核简洁

## Decision

确立三级结构：

```
Interface（接口层）→ Daemon（内核层）→ Worker（工人层）
```

### Interface — 接口层

- 无状态，纯协议转换
- CLI, Web UI, External MCP clients 地位平等
- 不持有任何状态，不做任何调度决策

### Daemon — 内核层

- 单进程，所有状态的唯一权威
- 拥有：Registry, Scheduler, Context, StateStore, Lifecycle
- 决定：谁在什么时候用什么上下文执行
- 持有 Daemon MCP：暴露 context tools 给 worker（类比 syscall interface）

### Worker — 工人层

- 纯执行：`f(prompt, tools) → result`
- 通过 Daemon MCP 获取协作能力（channel, document, proposal）
- 自持 Worker MCP 获取执行能力（bash, file ops, custom tools）
- 不知道调度、不管重试、不持有生命周期状态

### 两种 MCP

| 类型 | 持有者 | 用途 | 类比 |
|------|--------|------|------|
| Daemon MCP | Daemon | Context tools（channel_send, inbox_read, document_write...） | syscall interface |
| Worker MCP | Worker | 任务工具（bash, file, custom MCP servers） | process libraries |

### Context 通过 MCP 暴露

```
✗  Daemon 组装 context → 塞进 prompt → 传给 worker
✓  Daemon 开 MCP server → worker 连接 → 按需调用 context tools
```

Worker 只能通过 Daemon MCP tools 访问 context，不能直接读写 context 存储。这是沙箱化的保证。

## Consequences

1. **AgentController 的职责需要拆分**：调度/重试/轮询归 daemon scheduler，执行归 worker。Controller 作为独立概念将消解。
2. **Interface 层需要独立抽象**：当前 MCP endpoint 在 daemon 内部，需要区分 Daemon MCP（对 worker）和 Interface MCP（对外部客户端）。
3. **Worker 更纯粹**：移除 worker 对调度的感知，使其可被任意编排器调用。
4. **统一术语**：execution unit 统一叫 "worker"（工人），不再混用 runner/agent/session。

## Related

- [Technology Choices](./2026-02-16-technology-choices.md) — 后续技术选型（SQLite, subprocess, 消息模型）
- [ARCHITECTURE.md](../../packages/agent-worker/ARCHITECTURE.md) — 主架构文档（已更新）
- [workflow/DESIGN.md](../../packages/agent-worker/docs/workflow/DESIGN.md) — 工作流设计（已更新）
- [2026-02-08 CLI Unified Terminology](./2026-02-08-cli-design-unified-terminology.md) — 之前的术语统一决策
- [2026-02-06 Arch Refactor Notes](../.memory/notes/2026-02-06-agent-worker-arch-refactor.md) — Phase 3/4 重构记录
