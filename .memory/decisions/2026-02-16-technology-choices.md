---
type: decision
status: active
tags: [architecture, agent-worker, sqlite, subprocess, storage, messaging]
created: 2026-02-16
---

# Technology Choices: Storage, Messaging, Process Model

## Context

三级结构（Interface → Daemon → Worker）确定后，需要为几个关键子系统选择具体技术方案。

当前实现：
- **Context 存储**：文件系统（channel.md 追加写入 + inbox-state.json 已读状态 + documents/ 目录）
- **消息 @mention**：读取时正则解析
- **Daemon 状态**：内存中，重启丢失（daemon.json 只存 pid/host/port）
- **Worker 进程模型**：in-process（LocalWorker 在 daemon 进程内执行）

灵感来源：
- **NanoClaw**: "One LLM. One database. One machine." — SQLite 作为唯一存储后端，所有状态一个文件
- **nanobot**: BaseChannel 抽象 + 多存储后端，ContextProvider 接口已在代码中

## Decisions

### 1. Context 存储：SQLite（`bun:sqlite`）

**选择**：用 SQLite 替代文件系统作为 context 的生产存储后端。

**理由**：

| 维度 | File | SQLite |
|------|------|--------|
| 并发安全 | 无保证（两个 worker 同时 channel_send 可能丢消息） | WAL 模式，ACID 保证 |
| Inbox 查询 | 全文扫描 channel.md + 解析 @mention + 比对 inbox-state.json | `SELECT * FROM messages WHERE recipient = ? AND ack = false` |
| Proposal/投票 | JSON 文件 | 关系表，天然适合 |
| 人可读 | channel.md 可直接看 | 需要工具查看 |
| 备份 | 复制目录 | 复制单文件 |

**人可读性的损失可接受**：在三级结构下，worker 通过 Daemon MCP 访问 context，不直接读文件。用户通过 CLI（Interface 层）查看。两者都不依赖文件格式。

**接口不变**：`ContextProvider` 接口保持不变，新增 `SqliteContextProvider` 实现。`MemoryContextProvider` 保留用于测试。`FileContextProvider` 可保留但降为备选。

### 2. 消息 @mention：写入时解析

**选择**：`channel_send` 时由 daemon 解析 @mention，写入结构化数据。

**理由**：

```
当前（读取时解析）：
  channel_send("@reviewer 代码有问题") → 追加到 channel.md
  inbox_check("reviewer") → 读全文 → 正则匹配 @reviewer → 过滤已读

目标（写入时解析）：
  channel_send("@reviewer 代码有问题")
    → daemon 解析出 recipients: ["reviewer"]
    → 写入 messages 表：{ sender, recipients, content, timestamp }
  inbox_check("reviewer")
    → SELECT * FROM messages WHERE "reviewer" IN recipients AND NOT ack
```

**写入时解析意味着**：
- Inbox 查询变成数据库操作，不是文本处理
- 消息结构化，元数据（发送者、时间、接收者）与内容分离
- @mention 规则在一个地方定义（daemon），不是每个读取者各自解析

### 3. Daemon 状态持久化：SQLite

**选择**：Daemon 的所有状态持久化到 SQLite，支持 crash-recovery。

**数据库 schema 方向**：

```
agent-worker.db
├── agents          # Registry（agent configs）
├── workflows       # Workflow configs + state
├── messages        # Channel + inbox（结构化消息）
├── documents       # Document metadata（内容可能仍在文件系统）
├── proposals       # Proposal + voting state
└── daemon_state    # Daemon 自身状态（uptime, etc.）
```

**daemon.json 仍然保留**：用于 CLI 发现 daemon 进程（pid/host/port）。这是 Interface 层的发现机制，不是状态持久化。

**crash-recovery 语义**：daemon 重启后从 SQLite 恢复 agent registry、workflow 状态、未完成的消息。Worker 作为子进程会随 daemon 一起终止，重启后由 daemon 重新调度。

### 4. Worker 进程模型：Child Process（非 Worker Threads）

**选择**：Worker 作为独立子进程运行（`child_process.fork()` / `Bun.spawn()`），不使用 Worker Threads。

**对比**：

```
Worker Threads (Bun.Worker / worker_threads)
├── 共享进程内存空间
├── 一个 worker OOM/crash → 整个进程可能挂
├── 设计目的：CPU 密集型并行计算
└── 不是隔离

Child Process (Bun.spawn / child_process.fork)
├── 独立进程，独立内存空间
├── worker crash → daemon 收到 exit event，无影响
├── 可以 spawn 不同运行时（claude CLI, codex, 任意可执行文件）
└── 真正的进程隔离
```

**通信模型（两条路）**：

```
控制通道（daemon → worker）：
  IPC / stdio — 启动参数、停止信号、心跳
  daemon 单向控制 worker 生命周期

数据通道（worker → daemon）：
  MCP over HTTP — worker 调用 channel_send、inbox_check 等
  worker 主动连接 daemon 的 MCP server
  接口与 in-process 完全一致，只是传输层变了
```

**Worker 不需要知道自己的进程模型**：它只知道"我有一个 MCP server URL 可以访问 context"。`WorkerBackend` 接口不变，新增 `SubprocessWorkerBackend` 实现。`LocalWorker`（in-process）保留用于开发/测试。

## Consequences

1. **新增 `SqliteContextProvider`**：实现 `ContextProvider` 接口，用 `bun:sqlite`。这是最大的实现工作量。
2. **消息模型变更**：`ChannelMessage` 从 markdown 字符串变为结构化对象（sender, recipients, content, timestamp, ack）。影响 context 的 type 定义和 MCP tool handlers。
3. **新增 `SubprocessWorkerBackend`**：`fork()` 子进程 + IPC 通信。需要 worker-entry.ts 入口文件。
4. **Schema migration**：未来 schema 变更需要迁移策略。SQLite 初始版本需要设计好表结构。
5. **测试策略**：`MemoryContextProvider` 继续用于单元测试。集成测试用 `SqliteContextProvider` + 临时数据库。

## Related

- [Three-Tier Architecture](./2026-02-16-three-tier-architecture.md) — 架构决策（前置）
- [ARCHITECTURE.md](../../packages/agent-worker/ARCHITECTURE.md) — 主架构文档
- [workflow/DESIGN.md](../../packages/agent-worker/docs/workflow/DESIGN.md) — 工作流设计
