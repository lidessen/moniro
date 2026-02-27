# ADR: Unified Logger

**Date**: 2026-02-27
**Status**: Proposed

## Context

项目有两条日志路径：

1. **CLI/daemon** — 直接 `console.*`，用户界面输出，合理
2. **Workflow** — `Logger` → `ContextProvider.appendChannel()`，已有抽象

问题出在**库代码**（非 CLI、非 workflow）散落的 `console.*`：

| 文件 | 调用 | 问题 |
|------|------|------|
| `agent-handle.ts:76` | `console.warn(malformed yaml)` | daemon 模式下污染输出 |
| `worker.ts:313` | `console.warn(maxSteps limit)` | 同上 |
| `idle-timeout.ts:100` | `console.error(callback error)` | 同上 |
| `skills/importer.ts:37,45,61` | `console.log/error(import status)` | CLI 上下文合理，但被 daemon 调用时不合理 |

还有一种散落的 callback 模式：

| 文件 | 签名 |
|------|------|
| `yaml-parser.ts` | `log?: (msg: string) => void` |
| `agent-registry.ts` | `log?: (msg: string) => void` |
| `loop/types.ts` | `log / infoLog / errorLog` 三个 callback |

## Decision

### 1. 复用现有 `Logger` 接口

`workflow/logger.ts` 的 `Logger` 接口已经够用（debug/info/warn/error + child）。不引入新抽象。

### 2. 新增 `createConsoleLogger(options?)`

给非 workflow 上下文用。写到 stderr，尊重 debug flag：

```typescript
export interface ConsoleLoggerConfig {
  /** Show debug messages (default: false) */
  debug?: boolean;
  /** Prefix for all messages */
  from?: string;
}

export function createConsoleLogger(config?: ConsoleLoggerConfig): Logger {
  const { debug: showDebug = false, from } = config ?? {};
  const prefix = from ? `[${from}] ` : "";

  return {
    debug: (msg, ...args) => {
      if (showDebug) console.error(`${prefix}${msg}`, ...args);
    },
    info: (msg, ...args) => console.error(`${prefix}${msg}`, ...args),
    warn: (msg, ...args) => console.error(`${prefix}[WARN] ${msg}`, ...args),
    error: (msg, ...args) => console.error(`${prefix}[ERROR] ${msg}`, ...args),
    isDebug: () => showDebug,
    child: (childPrefix) => createConsoleLogger({
      debug: showDebug,
      from: from ? `${from}:${childPrefix}` : childPrefix,
    }),
  };
}
```

关键设计：
- **全部 stderr**：永不污染 stdout（JSON 输出、pipe 安全）
- **debug 默认关**：生产环境安静
- **child() 支持**：与 ChannelLogger 行为一致

### 3. 库代码接收 `Logger` 参数

替换散落的 `console.*` 和 `log?: (msg) => void` callback：

```typescript
// Before
class AgentHandle {
  async readMemory() {
    // ...
    catch { console.warn(`Skipping malformed...`) }
  }
}

// After
class AgentHandle {
  private readonly logger: Logger;
  constructor(def, contextDir, logger?: Logger) {
    this.logger = logger ?? createSilentLogger();
  }
  async readMemory() {
    // ...
    catch (err) { this.logger.warn(`Skipping malformed memory file ${file}:`, err) }
  }
}
```

同理：
- `AgentRegistry` 构造时传 logger，替换 `loadFromDisk(log?)` callback
- `worker.ts` 的 `console.warn(maxSteps)` → `this.logger.warn(...)`
- `idle-timeout.ts` → 接收 logger 参数
- `skills/importer.ts` → 接收 logger 参数

### 4. 统一 callback → Logger

loop 的三个 callback (`log/infoLog/errorLog`) 已通过 `factory.ts` 从 Logger 映射。保持现状，但新代码不再新增 callback 模式，直接传 Logger。

### 5. CLI 入口负责创建 Logger

```
CLI command
  └─ createConsoleLogger({ debug: options.debug })
       └─ 传给 AgentRegistry / AgentHandle / worker ...

Daemon
  └─ createConsoleLogger({ debug, from: "daemon" })
       └─ 传给内部组件

Workflow
  └─ createChannelLogger({ provider })  ← 已有，不变
```

## Migration Order

1. 在 `workflow/logger.ts` 中添加 `createConsoleLogger`
2. `AgentHandle` 构造函数加 `logger?: Logger`，替换 `console.warn`
3. `AgentRegistry` 构造函数加 `logger?: Logger`，替换 `loadFromDisk(log?)`
4. `worker.ts` 接收 logger，替换 `console.warn`
5. `idle-timeout.ts` 接收 logger，替换 `console.error`
6. `skills/importer.ts` 接收 logger，替换 `console.log/error`
7. CLI 入口 (`agent.ts`, `daemon.ts`) 创建并传递 logger

## Consequences

- **库代码零 `console.*`**：所有日志通过 Logger 接口，调用方决定输出方式
- **向后兼容**：logger 参数都是 optional，默认 silent
- **daemon 安静**：不传 logger 就没有输出
- **CLI 可控**：`--debug` 控制 debug 级别
- **不引入外部依赖**：复用已有接口 + 一个 ~20 行的 console 实现
