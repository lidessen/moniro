# Architecture: Channel Bridge

**Date**: 2026-03-06
**Status**: Proposed
**Depends on**: Phase 5 (Priority Queue), Channel infrastructure (done)

---

## Problem

Channel 目前是一个封闭的进程内通信系统。agent 之间通过 `channel_send` / `channel_read` 协作，但没有与外部世界的连接。

用户需要将 Telegram、Slack、Discord 等外部沟通渠道接入 channel，实现双向消息流通：

1. **外部 → 内部**：Telegram 消息进入 channel，agent 可以看到并响应
2. **内部 → 外部**：agent 的回复通过 Telegram 发送给用户

当前 `ChannelStore` 的限制：
- **无事件推送** — 只有 poll-based 的 `tail(cursor)`，无法实时通知外部
- **无外部身份** — `from` 字段假设是内部 agent name
- **无出站路由** — 消息写入后没有机制分发到外部

## Decision

在 ChannelStore 之上增加 **ChannelBridge** 层，提供 subscribe/send API。外部平台通过 **ChannelAdapter** 对接 Bridge。

```
External Platforms                  Internal System
─────────────────                   ───────────────

Telegram ──┐                        ┌── agent (channel_send)
Slack    ──┼── ChannelAdapter ──┐   │
Discord  ──┘   (per-platform)   │   │
                                ▼   ▼
                          ChannelBridge
                         ┌─────────────────┐
                         │  subscribe()    │ → push 新消息给所有订阅者
                         │  send()         │ → 外部消息注入 channel
                         │  EventEmitter   │ → 进程内事件驱动
                         │  HTTP webhook   │ → 可选，跨进程场景
                         └────────┬────────┘
                                  │
                          ChannelStore (现有)
                         ┌─────────────────┐
                         │  append()       │
                         │  read()         │
                         │  tail()         │
                         │  channel.jsonl  │
                         └─────────────────┘
```

---

## Design

### 1. ChannelBridge

ChannelBridge 是 ChannelStore 的事件化包装，两个核心能力：

```typescript
interface ChannelBridge {
  /** 订阅新消息。返回取消订阅函数。 */
  subscribe(filter: MessageFilter, handler: (msg: Message) => void): () => void;

  /** 从外部注入消息到 channel */
  send(from: string, content: string, options?: BridgeSendOptions): Promise<Message>;
}

interface MessageFilter {
  /** 只接收特定 kind 的消息（默认 "message"） */
  kinds?: EventKind[];
  /** 只接收来自特定发送者的消息 */
  from?: string[];
  /** 只接收发往特定接收者的消息 */
  to?: string[];
  /** 排除来自特定发送者的消息 */
  excludeFrom?: string[];
}

interface BridgeSendOptions extends SendOptions {
  /** 来源平台标识（用于防止消息回环） */
  source?: string;
}
```

**实现要点**：

1. **事件驱动**：在 `ChannelStore.append()` 后 emit 事件，Bridge 转发给匹配的订阅者
2. **防回环**：Adapter 发送消息时带 `source: "telegram"`，Bridge 不会把该消息推送回同一个 adapter
3. **两层推送**：
   - 进程内：EventEmitter（零延迟）
   - 跨进程：可选 HTTP webhook endpoint（后续需要时加）

### 2. EventEmitter 注入

当前 `DefaultChannelStore.append()` 写完 JSONL 就返回。需要在写入后 emit：

```typescript
class DefaultChannelStore implements ChannelStore {
  private emitter = new EventEmitter();

  async append(from: string, content: string, options?: SendOptions): Promise<Message> {
    // ... 现有逻辑 ...
    await this.storage.append(CHANNEL_KEY, line);

    // 新增：emit 事件
    this.emitter.emit("message", msg);

    return msg;
  }

  /** 监听新消息 */
  on(event: "message", handler: (msg: Message) => void): void {
    this.emitter.on(event, handler);
  }

  off(event: "message", handler: (msg: Message) => void): void {
    this.emitter.off(event, handler);
  }
}
```

### 3. ChannelAdapter

每个外部平台一个 Adapter，职责：

1. **格式转换** — 外部消息 ↔ 内部 Message
2. **身份标识** — 外部用户 → `platform:display_name` 格式
3. **连接管理** — 维护与外部平台的长连接（bot token, webhook 等）

```typescript
interface ChannelAdapter {
  /** 平台标识（用于防回环、日志等） */
  readonly platform: string;

  /** 启动适配器，连接外部平台 */
  start(bridge: ChannelBridge): Promise<void>;

  /** 关闭连接 */
  shutdown(): Promise<void>;
}
```

**Telegram Adapter 示例**：

```typescript
class TelegramAdapter implements ChannelAdapter {
  readonly platform = "telegram";

  constructor(private config: { botToken: string; chatId: string }) {}

  async start(bridge: ChannelBridge): Promise<void> {
    // 1. 订阅 channel → 转发到 Telegram
    bridge.subscribe(
      { kinds: ["message"], excludeFrom: [`telegram:*`] },
      (msg) => this.sendToTelegram(msg),
    );

    // 2. 监听 Telegram → 注入 channel
    this.bot.on("message", (tgMsg) => {
      bridge.send(
        `telegram:${tgMsg.from.first_name}`,  // 外部身份
        tgMsg.text,
        { source: "telegram" },                // 防回环
      );
    });
  }

  private sendToTelegram(msg: Message): void {
    this.bot.sendMessage(this.config.chatId, `${msg.from}: ${msg.content}`);
  }
}
```

### 4. 身份标识

不引入用户系统。身份只是防撞的字符串标识：

| 来源 | `from` 格式 | 示例 |
|------|-------------|------|
| 内部 agent | 原名 | `alice`, `bob` |
| Telegram | `telegram:<display_name>` | `telegram:TIANYANG Zhou` |
| Slack | `slack:<display_name>` | `slack:tianyang` |
| CLI/终端 | `user` 或自定义 | `user` |

**规则**：
- 含 `:` 的 from 表示外部来源，`platform:name` 格式
- 不含 `:` 的 from 是内部 agent
- 没有注册/登录，没有 ACL，没有用户数据库
- `@` 提及语法：`@alice`（内部），`@telegram:TIANYANG Zhou`（外部，需要扩展 mention 解析）

**Mention 解析扩展**：

当前 MENTION_PATTERN 是 `/@([a-zA-Z][a-zA-Z0-9_-]*)/g`，只匹配简单 ASCII name。外部身份含 `:` 和空格，需要扩展：

```typescript
// 方案：引号包裹含特殊字符的 mention
// @alice                        → 内部 agent
// @"telegram:TIANYANG Zhou"     → 外部身份（引号包裹）
// @telegram:simple_name         → 外部身份（无空格可省引号）

const MENTION_PATTERN = /@(?:"([^"]+)"|([a-zA-Z][a-zA-Z0-9_:-]*))/g;
```

### 5. 配置

Adapter 在 agent 或 workspace 层面配置：

```yaml
# workspace 级别：整个 workspace 的 channel 接入 Telegram
workspace:
  bridges:
    - adapter: telegram
      bot_token: ${{ env.TELEGRAM_BOT_TOKEN }}
      chat_id: ${{ env.TELEGRAM_CHAT_ID }}

# 或 agent 级别：agent 的 DM 接入 Telegram
# .agents/alice.yaml
bridges:
  - adapter: telegram
    bot_token: ${{ env.TELEGRAM_BOT_TOKEN }}
    chat_id: ${{ env.TELEGRAM_CHAT_ID }}
```

### 6. HTTP Webhook（跨进程，可选）

进程内 EventEmitter 够用时不需要。当 adapter 运行在独立进程时，Bridge 可暴露 HTTP endpoint：

```
POST /channel/send          → 注入消息
GET  /channel/subscribe     → SSE 流（Server-Sent Events）
```

这复用现有的 `HttpMCPServer` 基础设施，在同一端口上加路由。

---

## Message Flow

### 外部 → 内部

```
Telegram user sends "看看 PR #42"
    ↓
TelegramAdapter.onMessage()
    ↓
bridge.send("telegram:TIANYANG Zhou", "看看 PR #42", { source: "telegram" })
    ↓
ChannelStore.append() → channel.jsonl
    ↓
EventEmitter emit("message", msg)
    ↓
InboxStore 检测到 @mention → agent inbox
    ↓
Agent 处理指令，回复到 channel
    ↓
Bridge 推送给 TelegramAdapter（source ≠ "telegram"，不回环）
    ↓
TelegramAdapter.sendToTelegram() → 用户收到回复
```

### 内部 → 外部

```
Agent alice: channel_send("@telegram:TIANYANG Zhou 已完成 review")
    ↓
ChannelStore.append()
    ↓
EventEmitter emit("message", msg)
    ↓
Bridge 匹配 TelegramAdapter 的订阅 filter
    ↓
TelegramAdapter 发送到 Telegram chat
```

---

## Implementation Plan

### Phase 1: EventEmitter（最小可行）
- `DefaultChannelStore` 加 `on("message")` 事件
- 零破坏性变更，现有逻辑不受影响

### Phase 2: ChannelBridge
- 实现 `subscribe()` / `send()` API
- 防回环逻辑（`source` 字段）
- 集成到 Workspace 创建流程

### Phase 3: 首个 Adapter（Telegram）
- TelegramAdapter 实现
- Mention 解析扩展（支持 `platform:name`）
- 配置加载（`bridges` 字段）

### Phase 4: HTTP Webhook（按需）
- SSE endpoint for cross-process subscription
- HTTP POST for external message injection

---

## Open Questions

1. **Adapter 生态** — Adapter 是内置还是插件？倾向插件化（npm 包），但初版可内置 Telegram。
2. **消息格式转换** — 富文本（Markdown ↔ Telegram HTML）、图片、文件附件？初版只支持纯文本。
3. **速率限制** — 外部平台有 rate limit，adapter 需要自行处理？还是 Bridge 层统一？
4. **认证** — Webhook endpoint 需要认证吗？初版可用 bearer token。
