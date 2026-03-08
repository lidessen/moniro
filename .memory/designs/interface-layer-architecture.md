# Interface Layer — Design Thinking

> 实现细节见 `docs/DESIGN.md` Layer 4-5。本文件记录接口层的设计推理。

## 核心问题

```
API / MCP / CLI / Web / SSE 这些入口，
如何共享同一个 system state，同时避免互相干扰？
```

## 为什么需要独立一层

CLI、API、MCP、Web 看起来只是"不同客户端"，但它们真正带来的问题是：
- 是否共享同一套 runtime state
- session 是否隔离
- streaming 生命周期如何管理
- 一个入口上的操作会不会破坏另一个入口上的交互

如果不单独抽这一层，这些问题散落在 daemon、CLI、workspace、MCP transport 之间。

## 关键设计决策

### 三种 Session 必须区分

| 类型 | 例子 | 生命周期 |
|------|------|----------|
| Protocol session | MCP transport, HTTP stream, WebSocket | 连接断开即结束 |
| Runtime session | agent session, workspace context | 独立于连接 |
| User interaction session | CLI invocation, UI tab | 请求级别 |

如果不区分，"连接断开""请求结束""agent 停止等待"会被混成同一件事。

### Interface Layer 不拥有 State

```
Runtime Host owns state.
Interface Layer exposes and routes access to that state.
```

Interface Layer 负责路由和协议映射，不持有 runtime object 本体。Transport state（MCP sessions, HTTP streams）必须保持可丢弃。

### 干扰隔离

至少要回答：
- CLI 发起的请求是否复用已有 agent/workspace runtime
- MCP tool session 和 Web session 是否共享 agent state
- 一个入口触发 shutdown/stop/wake 会影响哪些其他入口
- 多个入口同时操作同一 workspace 时以谁为准

## 与 CLI 的关系

CLI 是 Interface Layer 的一个产品面。CLI 负责命令和用户体验；Interface Layer 负责更一般的协议入口与隔离语义。

## 开放问题

1. **当前混合**: daemon 同时承担 Runtime Host + Interface Layer，待分离
2. **MCP session lifecycle**: MCP 不只是工具协议，是外部 agent 接入系统的协议边界，session 管理待明确
3. **多入口干扰**: 当前没有显式的入口隔离机制
