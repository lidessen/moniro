# ADR: Unified Event Log

**Date**: 2026-02-27
**Status**: Proposed

## Context

### 现状

Workflow 内部已有完整的事件存储：

```
Logger → ContextProvider.appendChannel() → ChannelStore → channel.jsonl
```

`Message` 结构（timestamp, from, content, kind, toolCall）+ `EventKind`（message, tool_call, system, output, debug）已覆盖所有事件类型。`ChannelStore` 支持 append-only JSONL、增量 sync、visibility 过滤。

**问题**：这套系统绑死在 workflow scope 的 `ContextProvider` 上。以下事件发生在 workflow 之外，没有持久化：

| 来源 | 事件 | 现状 |
|------|------|------|
| daemon | 启动/关闭/端口分配 | `console.log` → 消失 |
| agent-handle | malformed YAML 跳过 | `console.warn` → 消失 |
| agent-registry | agent 加载/创建/删除 | callback / 无 |
| worker | maxSteps 到达 | `console.warn` → 消失 |
| idle-timeout | callback 执行错误 | `console.error` → 消失 |
| skills/importer | 导入进度/失败 | `console.log/error` → 消失 |

### 目标

**所有日志事件进同一个持久化时间线**。显示是过滤视图，不是日志本身。

## Decision

### 核心：把 ChannelStore 从 workflow 提升到 daemon 级

```
Daemon (process)
  └─ daemon-level ChannelStore (channel.jsonl)
       ├─ daemon lifecycle events (kind: "system")
       ├─ agent registry events (kind: "system")
       ├─ agent handle warnings (kind: "debug")
       └─ per-workflow events (已有，不变，写同一个 store 或 nested)

Display layer (CLI / TUI / web)
  └─ tail(cursor) + filter by kind/from/time
```

### 1. 新增 `EventSink` — 最小写入接口

不复用 `ContextProvider`（太重，绑 document/inbox/resource）。抽一个只做写入的接口：

```typescript
/** Minimal write-only interface for event logging */
export interface EventSink {
  append(from: string, content: string, options?: { kind?: EventKind }): void;
}
```

`ChannelStore` 天然满足这个接口（它的 `append` 是 Promise，EventSink 可以 fire-and-forget）。

### 2. Logger 写入 EventSink 而非 console

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

### 3. Daemon 拥有根 EventSink

```typescript
// daemon.ts startup
const storage = new FileStorageBackend(daemonDir);
const channelStore = new DefaultChannelStore(storage, []);
const logger = createEventLogger(channelStore, "daemon");

// 传递给子系统
const registry = new AgentRegistry(projectDir, logger.child("registry"));
// workflow runner 创建时也从 daemon 拿 sink
```

### 4. CLI 直接运行（无 daemon）的降级

CLI 直接跑 agent（不经过 daemon）时，没有持久化存储。用 console 降级：

```typescript
/** Fallback: logs to stderr, no persistence */
export function createConsoleSink(): EventSink {
  return {
    append(from, content, options) {
      if (options?.kind === "debug") return; // 默认静默 debug
      console.error(`[${from}] ${content}`);
    },
  };
}
```

### 5. 显示层：tail + filter

已有 `ChannelStore.tail(cursor)` 和 `read({ agent, since, limit })`。CLI 的 `agent-worker status` 已经用了。新增：

```bash
# 现有
agent-worker status          # 读 channel 显示状态

# 可扩展
agent-worker logs             # tail -f daemon channel.jsonl
agent-worker logs --debug     # 含 debug kind
agent-worker logs --from=registry  # 按 from 过滤
```

### 6. 已有 ChannelLogger 怎么办

`createChannelLogger({ provider })` 保持不变。Workflow 内部仍然写入 workflow-scoped provider。两层不冲突：

```
daemon channel.jsonl     ← daemon/registry/agent-handle 事件
workflow channel.jsonl   ← workflow 内部 agent 通信 + tool call + output
```

Workflow 也可以选择同时写入 daemon sink（用于全局时间线），但这是增量改进，不是 V1 必须。

## Migration Order

1. 定义 `EventSink` 接口（在 `workflow/context/types.ts` 或新文件）
2. 实现 `createEventLogger(sink, from)` — Logger → EventSink
3. 实现 `createConsoleSink()` — 降级方案
4. Daemon 启动时创建 `ChannelStore` → `EventSink` → `Logger`
5. `AgentHandle` / `AgentRegistry` / `worker` / `idle-timeout` / `importer` 接收 Logger
6. 清除所有库代码 `console.*`
7. CLI 入口注入 logger（daemon 模式 → EventSink，直接模式 → ConsoleSink）

## Consequences

- **统一时间线**：所有事件进 channel.jsonl，可追溯、可过滤、可回放
- **复用已有基础设施**：Message 结构、ChannelStore、EventKind 全部复用
- **显示与存储分离**：存全部，显示按需过滤
- **零外部依赖**：EventSink ~5 行接口，createEventLogger ~15 行
- **向后兼容**：workflow 内部 ContextProvider 不变
- **降级优雅**：无 daemon 时 ConsoleSink 保持可用
