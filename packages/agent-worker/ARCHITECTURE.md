# agent-worker Architecture

## Four Primitives

```
Message    — 数据
Proposal   — 逻辑（schema + function，状态转移）
Agent      — 执行者（ToolLoop）
System     — 运行时（提供 tools，驱动求值循环）
```

Tool 是 System 暴露给 Agent 的接口。Agent 被沙箱化——它能做什么完全取决于 System 给了它什么 tools。

```
                    ┌─── System ──────────────────────┐
                    │                                  │
  REST ────────────►│   Message ──► Proposal ──┐       │
                    │                          │       │
  MCP ─────────────►│              ┌───────────┘       │
                    │              ▼                    │
  WebSocket ───────►│   ┌─── Agent (ToolLoop) ───┐     │
                    │   │                        │     │
                    │   │   tool ──► System       │     │
                    │   │   tool ──► World        │     │
                    │   │                        │     │
                    │   └────────────┬───────────┘     │
                    │                │                  │
                    │                ▼                  │
                    │           new Message             │
                    │                │                  │
                    │                ▼                  │
                    │           Proposal ...            │
                    └──────────────────────────────────┘
```

## Core Rule

系统的数学核心只有一条规则：

```
message + proposal → message | task
task = agent.execute(prompt, tools, message) → message
```

Message 进入，Proposal（状态转移函数）求值，产出新的 Message 或 Task。Task 是 Agent 的一次执行，执行完产出 Message，回到循环。

### Message

数据。系统中流动的一切信息。

用户输入、agent 回复、@mention、cron 触发、webhook、task 完成通知——都是 Message。Message 是不可变的事实，append-only。

### Proposal

逻辑。Schema + Function。

Proposal 是状态转移函数：接收 Message（符合 schema 定义），执行 function，产出新的 Message 或 Task。

```typescript
interface Proposal<T> {
  schema: Schema<T>;
  execute(data: T, ctx: SystemContext): void;
}
```

Proposal 可组合——function 内部可以调用子 Proposal。YAML、JSON 只是 schema data 的序列化形式，数据进来经 schema 校验后由 function 处理。

**以 Workflow 为例**：

```typescript
const WorkflowProposal = defineProposal({
  schema: WorkflowSchema,     // YAML 结构的类型定义
  execute(data, ctx) {
    for (const agent of data.agents) {
      ctx.propose(CreateAgentProposal, agent)
    }
    for (const trigger of data.triggers) {
      ctx.propose(RegisterTriggerProposal, trigger)
    }
  }
})

const CreateAgentProposal = defineProposal({
  schema: AgentSchema,
  execute(config, ctx) {
    const agent = createToolLoop(config)
    ctx.register(agent)
  }
})

const RegisterTriggerProposal = defineProposal({
  schema: TriggerSchema,
  execute(config, ctx) {
    ctx.on(config.when, (message) => {
      ctx.propose(CreateTaskProposal, {
        agent: config.assign,
        message
      })
    })
  }
})

const CreateTaskProposal = defineProposal({
  schema: TaskSchema,
  execute(config, ctx) {
    const agent = ctx.getAgent(config.agent)
    const result = await agent.execute(config.message)
    ctx.emit(result)   // result → new message → cycle continues
  }
})
```

一次 workflow 执行就是 Proposal 的递归调用链：WorkflowProposal → CreateAgentProposal × N → RegisterTriggerProposal × N → (message arrives) → CreateTaskProposal → Agent executes → new Message → ...

### Agent

执行者。ToolLoop。

Agent 接收 (prompt, tools, message)，跑 LLM tool loop 到完成，返回 result。Agent 不知道自己为什么被调用、属于什么 workflow、有什么历史。它是封闭的——唯一能做的事就是调 tool。

```typescript
interface Agent {
  execute(config: {
    systemPrompt: string;
    tools: Tool[];
    message: string;
  }): AsyncGenerator<Chunk, Result>;
}
```

这个接口对任何 backend 成立：AI SDK tool loop、Claude Code CLI、Codex CLI、人类读消息然后操作。

### System

运行时。

System 驱动 Message + Proposal 的求值循环，管理 Agent 生命周期，持有状态（Messages、Documents、Resources），通过 Tools 暴露接口给 Agent。

System 提供的 Tools 分四类：

| Tool 类别 | 作用 | 示例 |
|-----------|------|------|
| `channel.*` | 消息读写 | `channel.send`, `channel.read` |
| `space.*` | 空间/工作流管理 | `space.create`, `space.members` |
| `proposal.*` | 提案操作 | `proposal.define`, `proposal.invoke` |
| `auth.*` | 授权操作 | `auth.grant`, `auth.revoke` |

给 Agent 什么 tools = 授权它做什么。不给 bash tool = 没有执行命令的权限。Tool 本身就是授权机制。

## Emergent Concepts

以下概念不是独立原语，而是四个原语的组合模式：

```
Agent + Message
  → + Proposal               = 路由
    → + Proposal chain        = 工作流（一组 Proposal，when 互相引用，时序涌现）
    → + Proposal gate         = 权限/审批（Proposal 等待授权 Message）
  → + Message accumulation    = Channel（Space 里 Message 的自然沉淀）
  → + filter Proposal         = Inbox（Proposal 过滤 @mention 的 Message）
  → + Proposal + Agent binding = 组织（固定规则 + 固定成员）
```

### Authorization

授权 = Agent 发出的一种特殊 Message。

```
Agent 发送: Message { type: "authorize", scope: "bash", from: "human" }
Proposal 检查: 需要的 authorize Message 够了吗？
```

| 场景 | 实现 |
|------|------|
| 工具审批 | Proposal 等待 human 的 authorize Message |
| 投票 | Proposal 等待 n/m 个 authorize Messages |
| 权限 | System 预发 authorize Message 给 Agent |
| 委托 | Agent A 发 authorize Message 指定 Agent B |

### Space

Space = Proposals + Agents + Messages 的作用域绑定。

`@global` 是零 Proposal、开放成员的退化 Space。加上 Proposals + 固定成员 = 组织。

### Workflow

Workflow = 一组 Proposal。YAML 是 WorkflowProposal 的 schema data 的序列化形式。

### Task

Task = CreateTaskProposal 的一次执行。是 Proposal → Agent 的调用。

## Current Implementation

现有系统是这个模型的退化态：

| 原语 | 当前实现 | 位置 |
|------|---------|------|
| **Message** | `ChannelMessage` | `context/types.ts` |
| **Proposal** | 隐式，硬编码在三处 | controller.ts, approval, workflow YAML |
| **Agent** | `AgentSession` (ToolLoop) | `agent/session.ts` |
| **System** | `Daemon` | `daemon/daemon.ts` |

Proposal 的三处隐式实现：

```
1. controller.ts 的 inbox 轮询
   → 隐式 Proposal: when=mention(@agent), auto → createTask

2. approval 机制
   → 隐式 Proposal: when=tool_call(bash), requires=authorize(human)

3. workflow YAML + parser
   → 最接近显式 Proposal: schema(YAML) + function(parse → create agents → register triggers)
```

演进方向：把隐式的 Proposal 变成显式的 schema + function。

### Module Structure

```
src/
├── daemon/                     # System 的实现
│   ├── daemon.ts               # 进程生命周期，HTTP server
│   ├── handler.ts              # 请求处理（→ 吸收进 service）
│   └── discovery.ts            # daemon.json 发现
│
├── workflow/                   # Workflow Proposal 的当前实现
│   ├── manager.ts              # Workflow 实例管理
│   ├── runner.ts               # 单 workflow 执行
│   ├── controller/             # Agent 生命周期（隐式 Proposal）
│   │   └── controller.ts       # poll → run → ack → retry
│   ├── parser.ts               # YAML → data（schema 校验）
│   ├── interpolate.ts          # ${{ }} 变量插值
│   └── prompt.ts               # Prompt 构建
│
├── agent/                      # Agent 的实现
│   ├── session.ts              # ToolLoop: LLM + tools → result
│   ├── models.ts               # Model 创建
│   ├── types.ts                # 核心类型
│   ├── tools/                  # Tool 工厂
│   └── skills/                 # Skill 加载
│
├── context/                    # 状态存储（Message + Documents + Resources）
│   ├── provider.ts             # ContextProvider 接口
│   ├── file-provider.ts        # 文件存储
│   ├── memory-provider.ts      # 内存存储（测试）
│   ├── mcp-tools.ts            # Context tools 定义
│   ├── proposals.ts            # 投票（→ Authorization Proposal）
│   └── types.ts                # Channel, Message 类型
│
├── backends/                   # Agent backend 适配
│   ├── sdk.ts                  # Vercel AI SDK
│   ├── claude-code.ts          # Claude Code CLI
│   ├── codex.ts                # Codex CLI
│   ├── cursor.ts               # Cursor CLI
│   └── mock.ts                 # Mock（测试）
│
└── cli/                        # 客户端（独立进程，HTTP → System）
    ├── client.ts               # HTTP client
    └── commands/               # 命令组
```

### Dependency Graph

```
cli/ ──── HTTP ────► daemon/ (System)
                       │
                       ├──► workflow/   (Workflow Proposal)
                       │       │
                       │       ├──► agent/     (Agent / ToolLoop)
                       │       └──► context/   (Message + State)
                       │
                       ├──► context/   (Tools 定义)
                       └──► backends/  (Agent backend 适配)
```

## Evolution Path

### Phase 1: Current (Done)

System = daemon (Hono + Bun.serve)。Proposal 硬编码在 controller 里。Agent = AgentSession。单进程，文件存储。

### Phase 2: Explicit Proposal

核心变更：把隐式 Proposal 变成显式的 schema + function。

- 定义 `Proposal<T>` 接口（schema + execute）
- 把 controller 的 inbox 轮询重构为 Proposal
- 把 approval 机制重构为 Proposal
- Workflow YAML parser 已经接近 Proposal 形态，对齐接口即可

### Phase 3: Composable Proposals

- Proposal 可组合（execute 内调子 Proposal）
- Agent 可通过 `proposal.*` tools 定义新 Proposal
- 热加载：运行时添加/修改 Proposal

### Phase 4: Authorization + Space

- Authorization 作为特殊 Message 类型
- Space 作为 Proposal + Agent + Message 的作用域
- `@global` 作为默认 Space
- 命名 Space 支持
