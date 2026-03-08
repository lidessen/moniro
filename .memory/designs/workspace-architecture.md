# Workspace — Design Thinking

> 实现细节见 `docs/DESIGN.md` Layer 3。YAML surface 细节见代码中 `schema.ts` 和 `parser.ts`。
> 本文件记录协作层的设计推理。

## 核心问题

```
一个 personal agent 进入协作场之后，
可以看到什么、能做什么、如何与其他 agent 和外部世界协作？
```

## 为什么是 Adapter，不是 Agent 本体

workspace 更像一个 adapter，而不是 agent 的一部分。它做的是：
- 把 channel 消息送进 agent inbox
- 把 agent 输出写回 channel
- 把 proposal/docs/team tools 暴露给 agent
- 注入 workspace-specific prompt

因此它是"personal agent runtime"和"协作环境"之间的桥梁。

如果把协作语义放进 agent-worker：
- agent 的定义膨胀，每增加协作功能都改 agent 核心
- 不参与协作的 agent 仍然背负协作代码
- personal state 和 shared state 混在一起

## 关键设计决策

### Channel 属于 workspace，Inbox 属于 agent

```
channel message → workspace routing → agent inbox
agent output    → workspace tool    → channel
```

不能把 channel 直接等同于 inbox，也不能把 inbox 设计反向污染 workspace。

### Workspace vs Workflow

两者相关但不同：
- **Workspace** = 协作空间（channel、documents、team tools）
- **Workflow** = 编排定义 + 运行实例（YAML、params、setup、kickoff）

一个 Workspace 可以被多个 Workflow 复用。Workflow 是更高一层的 orchestration 概念。

### 投递语义是混合的

不是单一模型：
- `@mention` / DM → push-style delivery，主动唤醒 agent
- 普通 channel 消息 → pull-style visibility，进入可读历史

这条语义不应在 session/plugin 体系里被抹平。

### YAML 只定义协作编排

```
workspace YAML should describe collaboration setup and orchestration,
not redefine personal agent identity.
```

YAML 中的 agent 分两种：
- **Ref agent**: 引用已有 agent，只 patch workflow-local prompt/limits
- **Inline agent**: 局部临时能力，不带 personal context

个人身份（Soul、memory、todos）由 agent-worker 管理，不由 YAML 重新定义。

### Event Source 角色

workspace 为 personal runtime 提供外部事件源：
- channel-based event source
- 协作消息 → agent 可见输入
- 在适当时机通知 agent-worker 的 waiting/inbox system

抽象归属不变：waiting/inbox 在 agent-worker，事件来源在 workspace。

## Workspace Plugin

workspace 也需要独立的扩展面（不混进 personal agent 插件系统）：

- workspace prompt sections
- workspace tools
- message routing hooks
- collaboration events

和 agent plugin 共享 `PromptSection` 输出模型，但 ownership 不同：
- agent plugins = personal runtime behavior
- workspace plugins = collaboration runtime behavior

## 开放问题

1. **Inbox 实现位置**: inbox 逻辑当前在 workspace 包中，概念上属于 agent-worker，待迁移
2. **WorkspacePlugin 接口**: 已设计，待实现
3. **daemon config.yml**: 当前复用 workflow YAML 格式，概念上不应与 workflow file 完全等同
4. **documentOwner**: 已进入类型面，协作约束和产品语义还没完全展开
