# Agent Worker — Design Thinking

> 实现细节见 `docs/DESIGN.md` Layer 2。本文件记录个人 runtime 的设计推理。

## 核心问题

```
这个 agent 作为一个持续存在的个体，
如何记住、如何等待、如何处理输入、如何带着自己的身份工作？
```

## 为什么需要独立一层

从这一层开始，agent 不再只是"会调用模型的循环"，而是一个 personal runtime。

如果把 personal context 放在 workspace 层：
- agent 的身份依赖于它参与的协作环境
- 离开 workspace 后 agent 失去记忆和身份
- 个人 inbox/todo 与协作 channel 混在一起

如果把 personal context 放在 agent-loop 层：
- 执行层被个人语义污染
- 无法独立测试执行能力

## 关键设计决策

### Feature 组合模型

agent-loop 只是裸执行（model + tools + loop）。agent 的所有能力都来自显式声明的 features。没有硬编码的 "base"。

```ts
interface AgentFeature {
  name: string;

  // prompt
  sections?: PromptSection[];

  // tools
  mcpTools?: McpToolDef[];
  tools?: ToolSpec[];
  skills?: SkillSpec[];

  // execution
  beforeStep?: (ctx: StepContext) => StepMutation | void;
  afterStep?: (ctx: StepContext) => void;
}
```

每个 feature 同时贡献多个维度（prompt sections + MCP tools + AI SDK tools + step hooks）。

Features 分两类：

**内置 feature** — 默认启用，开放自定义点：
```ts
soul(definition)                        // 自定义：prompt 模板、渲染方式
soul(definition, { render: customFn })

todo(handle)                            // 自定义：存储实现
todo(handle, { store: inMemoryStore })

inbox(source)                           // 异步交互：inbox_wait, inbox_ack 等 tools
                                        // 自定义：消息源、过滤规则
```

**可选 feature** — 显式 opt-in：
```ts
memory(handle)           // 持久记忆
conversation(log)        // 对话连续性
workspace(provider)      // 协作环境
bash({ cwd })            // Shell 执行
```

Feature 和 Provider 的交汇：feature 决定有什么能力，feature 内部的 provider/config 决定怎么实现。

agent 创建时组合：

```ts
const loop = createAgentLoop({
  ...config,
  // 内置 features（soul, todo）自动包含，可通过 config 自定义
  // 可选 features 显式声明
  features: [
    memory(handle),
    conversation(log),
    workspace(provider),
    bash({ cwd: projectDir }),
  ],
});
```

**不是 plugin 系统**：没有 registry、没有动态加载、没有 session lifecycle。只是静态组合。等 AgentSession 落地后，feature 自然可以扩展出 session hooks。

### Inbox 属于 agent，不属于 channel

inbox 表达的是 agent 的输入视图：
- 哪些输入进入了这个 agent
- 哪些是当前轮次前就存在的
- 哪些是运行过程中新增的

Workspace 把协作消息映射到 inbox，但 inbox 抽象归属在 agent-worker。

**当前差距**：inbox 实现仍在 workspace 包中（`DefaultInboxStore`）。这是已知的待迁移项。

### AgentSession 属于这一层

AgentSession 表达的是 agent 当前轮次的运行状态：
- 在处理什么
- 带着哪些 personal context
- 是否在等待新输入
- 运行中是否收到新 signal

这些都是 personal runtime 语义。workspace 只是把协作环境注入进来，runtime-host 只是托管，interface-layer 只是暴露入口。

### Prompt 是结构化的，不是字符串拼接

```ts
type PromptSection = { tag: string; prompt: string }
```

section 先成为有 tag 的节点，再由 renderer 统一渲染。这样：
- 章节来源和职责清楚
- features 产出 section，而不是直接改最终 prompt
- 最终 prompt 是所有 enabled features 的 sections 的组合

### 异步非对称对话

agent 不是简单同步问答。它可以：
- 先处理，再回复
- 显式等待下一条消息
- 在工作中被提醒有新输入
- 内部执行节奏不必与外部消息节奏同步

这是 AgentSession + WaiterRegistry 的存在依据。

## Provider 不变

Provider 替换底层实现（memory storage、conversation state、context persistence），和 feature 组合是独立的机制。Feature 决定 agent 有什么能力，Provider 决定这些能力建立在什么之上。

## 开放问题

1. **Inbox 迁移**: inbox 抽象应下沉到 agent-worker，当前实现在 workspace
2. **AgentSession 实现**: 设计已完成，9 phases 待实施（见 `.memory/todos/index.md`）
3. **DM 独立性**: agent 即使附着多个 workspace，仍应保留独立 personal interaction 通道
