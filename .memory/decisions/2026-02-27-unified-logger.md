# ADR: Unified Event Log

**Date**: 2026-02-27
**Status**: Accepted (implemented in Phase 3a)

## Context

### 现状

Workflow 内部已有完整的事件存储：

```
Logger → ContextProvider.appendChannel() → ChannelStore → channel.jsonl
```

`Message` 结构 + `EventKind` 已覆盖所有事件类型。`ChannelStore` 支持 append-only JSONL、增量 sync、visibility 过滤。

**但 channel 是 per-workspace 的**——它是 agent 间通信的共享空间，绑在 workflow context 目录下。两类事件无处安放：

1. **Daemon 级别**：启动/关闭、registry 操作——不属于任何 workspace，也不属于任何 agent
2. **Agent 级别**：malformed YAML、maxSteps、state 变迁、worker 错误——属于 agent 自身的操作历史，不是 agent 间通信，也不是基础设施

以下事件没有持久化：

| 来源 | 事件 | 归属层级 | 现状 |
|------|------|----------|------|
| daemon | 启动/关闭/端口分配 | daemon | `console.log` → 消失 |
| agent-registry | agent 加载/创建/删除 | daemon | callback / 无 |
| skills/importer | 导入进度/失败 | daemon | `console.log/error` → 消失 |
| agent-handle | malformed YAML 跳过 | **agent** | `console.warn` → 消失 |
| worker | maxSteps 到达 | **agent** | `console.warn` → 消失 |
| worker | state 变迁 idle→running→stopped | **agent** | 无 |
| idle-timeout | callback 执行错误 | **agent** | `console.error` → 消失 |
| worker | backend 调用/重试 | **agent** | 无 |

### 目标

所有日志事件持久化。统一时间线按需过滤显示。

## Decision

### 三层存储，共享格式

```
~/.agent-worker/
├── events.jsonl                              ← daemon event log（新的）
└── workflows/<name>/<tag>/
    └── channel.jsonl                         ← workspace channel（已有）

.agents/<name>/
└── timeline.jsonl                            ← agent timeline（新的）
```

| 层级 | 文件 | 内容 | 谁写 |
|------|------|------|------|
| **Daemon** | `~/.agent-worker/events.jsonl` | 启动/关闭、registry CRUD、importer 进度 | daemon、registry |
| **Agent** | `.agents/<name>/timeline.jsonl` | state 变迁、maxSteps、malformed YAML、worker 错误/重试 | agent-handle、worker、loop |
| **Workspace** | `channel.jsonl` | agent 间通信、tool call、workflow 内部事件 | ContextProvider（已有，不变） |

三者共享 `Message` 格式和 `EventKind` 类型。统一时间线通过**读取时合并**实现（类似 `git log --all`），不是写入时混在一起。

**为什么三层而不是两层？**

Agent timeline 和 workspace channel 职责不同：

- **channel** 是 agent 间通信——"我跟你说了什么"
- **timeline** 是 agent 自身操作记录——"我做了什么"

把 agent 操作事件放进 workspace channel 会污染通信流。放进 daemon event log 则丧失了 agent 归属（daemon 级别不知道是哪个 agent 的 maxSteps 到了）。每个 agent 拥有自己的 timeline 是最自然的归属。

**Agent timeline 跟随 agent 而非 workspace。** Agent 可以参与多个 workspace，但 timeline 始终在 `.agents/<name>/timeline.jsonl`。这与 agent-top-level 设计一致：personal context travels with the agent。

### 1. `EventSink` — 最小写入接口

```typescript
/** Minimal write-only interface for event logging */
export interface EventSink {
  append(from: string, content: string, options?: { kind?: EventKind }): void;
}
```

三个实现都满足：
- `ChannelStore.append()` → workspace channel（已有，Promise 返回值兼容）
- 新的 `DaemonEventLog` → daemon events.jsonl
- 新的 `TimelineStore` → agent timeline.jsonl

### 2. `TimelineStore` — Agent 级别事件存储

```typescript
export class DefaultTimelineStore implements EventSink {
  constructor(private storage: StorageBackend) {}

  append(from: string, content: string, options?: { kind?: EventKind }): void {
    const event: Message = {
      id: nanoid(),
      timestamp: new Date().toISOString(),
      from,
      content,
      mentions: [],
      kind: options?.kind ?? "system",
    };
    const line = JSON.stringify(event) + "\n";
    // fire-and-forget, same pattern as DaemonEventLog
    void this.storage.append("timeline.jsonl", line);
  }

  async read(offset?: number): Promise<{ events: Message[]; offset: number }> {
    // Same incremental sync pattern as ChannelStore
    const { content, offset: newOffset } = await this.storage.readFrom("timeline.jsonl", offset ?? 0);
    const events = content.split("\n").filter(Boolean).map((l) => JSON.parse(l));
    return { events, offset: newOffset };
  }
}
```

`TimelineStore` 用同样的 `StorageBackend` 接口。`FileStorage` → 文件，`MemoryStorage` → 测试。换存储后端不影响任何逻辑。

### 3. `createEventLogger(sink, from)` — Logger → EventSink

```typescript
export function createEventLogger(sink: EventSink, from?: string): Logger {
  const prefix = from ?? "system";
  return {
    debug: (msg) => sink.append(prefix, msg, { kind: "debug" }),
    info: (msg) => sink.append(prefix, msg, { kind: "system" }),
    warn: (msg) => sink.append(prefix, `[WARN] ${msg}`, { kind: "system" }),
    error: (msg) => sink.append(prefix, `[ERROR] ${msg}`, { kind: "system" }),
    isDebug: () => true,  // 全部写入存储，显示层决定过滤
    child: (childPrefix) => createEventLogger(sink, `${prefix}:${childPrefix}`),
  };
}
```

### 4. 各层拥有各自的 event log

```typescript
// Daemon level
const daemonLog = new DaemonEventLog(daemonDir);           // → events.jsonl
const daemonLogger = createEventLogger(daemonLog, "daemon");
const registry = new AgentRegistry(projectDir, daemonLogger.child("registry"));

// Agent level — per agent
const agentStorage = new FileStorage(agentContextDir);      // → .agents/<name>/
const timeline = new DefaultTimelineStore(agentStorage);
const agentLogger = createEventLogger(timeline, agentName);
// worker、loop、agent-handle 使用 agentLogger

// Workspace level — unchanged
// createChannelLogger({ provider }) 保持原样
```

### 5. CLI 无 daemon 时降级

```typescript
/** Fallback: logs to stderr, no persistence */
export function createConsoleSink(): EventSink {
  return {
    append(from, content, options) {
      if (options?.kind === "debug") return;
      console.error(`[${from}] ${content}`);
    },
  };
}
```

### 6. 统一时间线 = 合并读取

```bash
agent-worker logs                              # tail daemon events.jsonl
agent-worker logs --agent alice                # tail alice's timeline.jsonl
agent-worker logs --workspace review           # tail workspace channel.jsonl
agent-worker logs --all                        # 合并三层，按 timestamp 排序
agent-worker logs --debug                      # 含 debug kind
agent-worker logs --from=worker                # 按 from 过滤
```

## Migration Order

1. 定义 `EventSink` 接口
2. 实现 `DaemonEventLog`（append-only JSONL，复用 `Message` 格式）
3. 实现 `DefaultTimelineStore`（同样的 append-only JSONL，用 `StorageBackend`）
4. 实现 `createEventLogger(sink, from)` + `createConsoleSink()`
5. Daemon 启动时创建 daemon event log + logger
6. Agent 创建时创建 timeline store + logger
7. 库代码接收 Logger：
   - daemon 级别（Registry / importer）→ daemon logger
   - agent 级别（AgentHandle / worker / loop / idle-timeout）→ agent logger
8. 清除所有库代码 `console.*`
9. CLI 入口注入 logger（daemon → EventSink，agent → TimelineStore，直接 → ConsoleSink）
10. 可选：`agent-worker logs` 命令

## Consequences

- **三层分离**：daemon event log 是基础设施，agent timeline 是个人操作历史，workspace channel 是 agent 间通信——各归各位
- **统一格式**：三层共享 `Message` + `EventKind`，合并读取时无需转换
- **provider 可替换**：`TimelineStore` 通过 `StorageBackend` 注入，`FileStorage`/`MemoryStorage`/任何自定义实现均可
- **显示与存储分离**：存全部，显示按需过滤
- **零外部依赖**：`EventSink` ~5 行，`DaemonEventLog` ~30 行，`TimelineStore` ~30 行
- **向后兼容**：workspace channel 完全不变
- **降级优雅**：无 daemon 时 ConsoleSink → stderr
- **与 agent-top-level 一致**：timeline 跟随 agent personal context，跨 workspace 携带
