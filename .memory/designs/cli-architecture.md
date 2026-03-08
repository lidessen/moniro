# CLI — Design Thinking

> 实现细节见 `docs/DESIGN.md` Layer 6。命令清单见 DESIGN.md CLI Surface 节。
> 本文件记录 CLI 产品面的设计推理。

## 核心问题

```
用户通过命令行看到哪些对象，执行哪些动作，
这些动作如何映射到底层 runtime？
```

## CLI 的定位

CLI 是 product surface，不是架构层。它建立在整个 runtime 之上，负责把底层能力组织成可理解、可操作的用户入口，但不拥有底层架构语义。

## 关键设计决策

### 暴露稳定概念，不泄漏实现

CLI 最容易犯的错误是把底层实现泄漏成产品概念：
- 因为底层有 loop，就把 loop 暴露给用户
- 因为底层有 session，就要求用户理解 session 内部细节
- 因为底层有 channel/inbox 差异，就把内部路由机制变成用户负担

CLI 应该做相反的事：暴露稳定对象，把必要复杂度吸收掉。

### 两种工作模式

CLI 实际上有两种模式，这是一个有价值的产品特性：

| 模式 | 命令 | 依赖 |
|------|------|------|
| daemon-backed | up/down/status/new/rm/ls/ask/start/stop | 需要 daemon |
| file-backed | send/peek/doc | 直接操作本地 context |

file-backed 模式意味着即使 daemon 不在，用户也能读写 context。不应被未来设计抹掉。

### Workspace-first，不是 Session-first

CLI 不暴露 session、loop、inbox cursor 等内部概念。用户可见对象是：
- agent
- workspace
- workflow file
- document

### Workflow File 是产品入口

`run/start` 以 workflow YAML 为入口对象，而不是要求用户先显式创建 workspace 再手动组装。

```
workflow file = orchestration definition
run/start     = instantiate into a workspace instance
```

### Target 语法

```
alice              → global workspace 中的 agent
alice@review       → 指定 workspace 中的 agent
alice@review:pr-123 → 指定 workspace tagged instance 中的 agent
@review            → workspace 级目标
@review:pr-123     → workspace tagged instance
```

Display 规则：省略 `@global`，无 tag 时省略 `:tag`。

## 不应暴露的概念

CLI 当前不应承诺这些尚未稳定的产品面：
- schedule 子命令体系
- proposal 独立命令组
- inbox/todo 独立命令组
- session/debug internals 直接暴露
