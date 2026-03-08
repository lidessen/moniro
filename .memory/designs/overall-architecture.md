# Overall Architecture — Design Thinking

> 实现细节见 `docs/DESIGN.md`。本文件记录分层决策的推理过程。

## 核心问题

系统最初的问题不是能力缺失，而是分层不清：

- backend 执行抽象和业务语义混在一起
- personal agent 语义和 workspace 协作语义混在一起
- loop 一边调度，一边负责 prompt / inbox / context 的具体组织

结果是每个新功能都牵连多个模块，无法独立演进。

## 分层原则

六层架构的核心推理：

```
agent-loop        怎么跑         execution primitive
agent-worker      这是谁         personal runtime
workspace         和谁协作       collaboration adapter
runtime-host      谁托管         object ownership
interface-layer   怎么接入       protocol boundary
CLI               怎么用         product surface
```

**为什么是六层而不是更少？**

- 前三层对应三个独立演进的关注点：执行能力、个人身份、协作环境。合并任意两个都会导致职责耦合。
- 后三层对应三个独立的系统问题：生命周期管理、多协议接入、用户体验。合并会导致 daemon 代码承担过多角色（当前现状）。

**为什么是六层而不是更多？**

- 每层解决一个明确问题。没有发现需要额外拆分的独立关注点。

## 三个正交概念

```
Agent     = 持续身份 + 个人上下文
Workspace = 协作空间 + 共享状态
Workflow  = 编排定义 + 运行实例
```

这三者不能合并成同一个对象，因为：

- 一个 Agent 可以参与多个 Workspace
- 一个 Workspace 可以被多个 Workflow 复用
- Workflow 是 orchestration，不是 identity 也不是 environment

## 依赖方向

单向依赖，不可反转：

```
agent-loop → 不依赖任何上层
agent-worker → agent-loop
workspace → agent-worker → agent-loop
runtime-host → workspace, agent-worker, agent-loop
interface-layer → runtime-host
CLI → interface-layer
```

关键约束：
- `agent-loop` 不知道 inbox / channel / workspace
- `agent-worker` 不知道 proposal / channel 协作工具
- `workspace` 不知道 CLI 命令文案
- `runtime-host` 不定义协议面
- `interface-layer` 不拥有 runtime state 本体

## 两类横切机制

### Plugin vs Provider

```
Plugin   = 扩展行为     → agent 怎么表现 / workspace 怎么协作
Provider = 替换实现     → 状态存在哪 / 用什么 backend / 走什么 transport
```

两者有自然归属：
- `agent-loop`: execution providers (backend, model)
- `agent-worker`: personal context providers (memory, storage)
- `workspace`: collaboration providers (storage, bridge adapters)
- `runtime-host`: host state store providers
- `interface-layer`: transport providers

## 调度模型

为什么需要调度：异步系统不是只有 session 就够了，还需要优先级。否则长任务阻塞紧急消息，不同入口争抢执行权。

三条 lane：
- `immediate`: DM、@mention — 可触发 wake、可抢占
- `normal`: 常规工作项 — FIFO
- `background`: schedule wakeup、非定向 channel — 可延后

配套的投递语义：
- push-style: @mention / DM → 高优先级 lane + wake
- pull-style: channel history → 可读可轮询，不打断当前工作

Cooperative preemption：高优先级到来时，低优先级在 step 边界让出，保留 progress，可恢复。

## 阅读顺序

1. 本文件 — 分层推理
2. `agent-loop-architecture.md` — 执行层边界
3. `agent-worker-architecture.md` — 个人 runtime 推理
4. `workspace-architecture.md` — 协作层推理
5. `runtime-host-architecture.md` — 托管层推理
6. `interface-layer-architecture.md` — 接口层推理
7. `cli-architecture.md` — 产品面推理
