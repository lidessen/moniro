# ADR: Unified Event Log

**Date**: 2026-02-27
**Status**: Proposed

## Context

### 现状

Workflow 内部已有完整的事件存储：

```
Logger → ContextProvider.appendChannel() → ChannelStore → channel.jsonl
```

`Message` 结构 + `EventKind` 已覆盖所有事件类型。`ChannelStore` 支持 append-only JSONL、增量 sync、visibility 过滤。

**但 channel 是 per-workspace 的**——它是 agent 间通信的共享空间，绑在 workflow context 目录下。daemon 级别的事件（启动、registry 操作）不属于任何 workspace。

以下事件没有持久化：

| 来源 | 事件 | 现状 |
|------|------|------|
| daemon | 启动/关闭/端口分配 | `console.log` → 消失 |
| agent-handle | malformed YAML 跳过 | `console.warn` → 消失 |
| agent-registry | agent 加载/创建/删除 | callback / 无 |
| worker | maxSteps 到达 | `console.warn` → 消失 |
| idle-timeout | callback 执行错误 | `console.error` → 消失 |
| skills/importer | 导入进度/失败 | `console.log/error` → 消失 |

### 目标

所有日志事件持久化。统一时间线按需过滤显示。

## Decision

### 两层存储，共享格式

```
~/.agent-worker/
├── events.jsonl                          ← daemon event log（新的）
└── workflows/<name>/<tag>/
    └── channel.jsonl                     ← workspace channel（已有）
```

| 层级 | 文件 | 内容 | 谁写 |
|------|------|------|------|
| **Daemon event log** | `events.jsonl` | 启动/关闭、registry CRUD、跨 workspace 事件 | daemon、registry、agent-handle |
| **Workspace channel** | `channel.jsonl` | agent 通信、tool call、workflow 内部事件 | ContextProvider（已有，不变） |

两者共享 `Message` 格式和 `EventKind` 类型。统一时间线通过**读取时合并**实现（类似 `git log --all`），不是写入时混在一起。

### 1. `EventSink` — 最小写入接口

```typescript
/** Minimal write-only interface for event logging */
export interface EventSink {
  append(from: string, content: string, options?: { kind?: EventKind }): void;
}
```

两个实现都满足：
- `ChannelStore.append()` → workspace channel（已有，Promise 返回值兼容）
- 新的 `DaemonEventLog` → daemon events.jsonl

### 2. `createEventLogger(sink, from)` — Logger → EventSink

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

### 3. Daemon 拥有 event log

```typescript
// daemon.ts startup
const eventLog = new DaemonEventLog(daemonDir); // → events.jsonl
const logger = createEventLogger(eventLog, "daemon");

const registry = new AgentRegistry(projectDir, logger.child("registry"));
```

### 4. Workspace channel 不变

`createChannelLogger({ provider })` 保持原样。Workflow 内部仍写入 workspace-scoped channel.jsonl。

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
agent-worker logs                          # tail daemon events.jsonl
agent-worker logs --workspace <name>       # tail workspace channel.jsonl
agent-worker logs --all                    # 合并两者，按 timestamp 排序
agent-worker logs --debug                  # 含 debug kind
agent-worker logs --from=registry          # 按 from 过滤
```

## Migration Order

1. 定义 `EventSink` 接口
2. 实现 `DaemonEventLog`（append-only JSONL，复用 `Message` 格式）
3. 实现 `createEventLogger(sink, from)` + `createConsoleSink()`
4. Daemon 启动时创建 event log + logger
5. 库代码（AgentHandle / Registry / worker / idle-timeout / importer）接收 Logger
6. 清除所有库代码 `console.*`
7. CLI 入口注入 logger（daemon → EventSink，直接 → ConsoleSink）
8. 可选：`agent-worker logs` 命令

## Consequences

- **两层分离**：workspace channel 是 agent 通信，daemon event log 是运维事件，职责清晰
- **统一格式**：共享 Message + EventKind，合并读取时无需转换
- **显示与存储分离**：存全部，显示按需过滤
- **零外部依赖**：EventSink ~5 行，DaemonEventLog ~30 行
- **向后兼容**：workspace channel 完全不变
- **降级优雅**：无 daemon 时 ConsoleSink → stderr
