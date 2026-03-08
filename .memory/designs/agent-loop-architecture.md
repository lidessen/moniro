# Agent Loop — Design Thinking

> 实现细节见 `docs/DESIGN.md` Layer 1。本文件记录执行层的边界推理。

## 核心问题

```
给你一个模型、一些工具和一个 backend，
怎么把一次 agent 执行稳定地跑起来？
```

## 为什么需要独立一层

这一层只解决"怎么跑"，不解决"这个 agent 是谁"或"它在和谁协作"。

如果把 personal context、inbox、channel 混进执行层：
- 每增加一个上层概念，执行循环就要改
- 不同 backend 的能力差异被业务语义掩盖
- 测试执行逻辑必须搭建完整的 agent 环境

## 关键设计决策

### ExecutionSession 是核心对象

agent-loop 的核心不再是 AgentWorker（它混合了执行和对话管理），而是 ExecutionSession：

```ts
interface ExecutionSession {
  readonly id: string;
  readonly capabilities: BackendCapabilities;

  run(input: ExecutionInput): Promise<ExecutionResult>;
  cancel(reason?: string): Promise<void>;
  getState(): ExecutionState;
}
```

ExecutionInput 只包含 resolved 的 system prompt、messages、tools、config。
不包含 inbox、workspace、proposal、todo、workflow。

### Backend Capability-First

不假装所有 backend 一样，显式暴露能力差异：

```ts
interface BackendCapabilities {
  streaming: boolean;
  toolLoop: "native" | "external";
  stepControl: "none" | "step-finish";
  cancellation: "none" | "cooperative" | "abortable";
}
```

上层根据 capability 决定能不能做 step hooks、preemption 等。

### 状态机

```
idle → running
running → waiting | preempted | completed | failed | cancelled
waiting → running | cancelled
preempted → running | cancelled
completed, failed, cancelled → (terminal)
```

### Hook 机制限制在执行边界

```
beforeRun → [beforeStep → LLM call → afterStep]* → afterRun
onStateChange fires on any state transition
```

Hook 不允许直接依赖 workspace/inbox/proposal 类型。
上层要做这些事，自己适配成 generic signal/mutation。

映射到 AI SDK：
- beforeStep → `prepareStep`（构造时注入，可修改 tools/system）
- afterStep → `onStepFinish`
- preemption trigger → `shouldYield()` 在 afterStep 边界检查

### Preemption = Trigger + Decision

trigger 来自外部：高优先级 item 入队、waiter cancel、host signal
decision 在 loop boundary：step finish、tool return、wait return

不把"中断能力"写成 prompt 内自觉检查。

### WorkItem 统一队列

```ts
interface WorkItem {
  id: string;
  priority: "immediate" | "normal" | "background";
  kind: "message" | "wakeup" | "resume" | "system";
  payload: unknown;
  resumable?: boolean;
}
```

Loop 负责取 item、执行 item、返回结果、标记是否可恢复。
不内嵌"处理 inbox 一批消息"的业务语义。

## 边界

属于这一层：ExecutionSession、BackendCapabilities、状态机、hook 机制、WorkItem、prompt 执行（不组装）
不属于这一层：prompt 组装、personal context、Soul、inbox/todo、channel、workspace、AgentSession

## 当前状态

- [x] ExecutionSession interface + 实现
- [x] BackendCapabilities 所有 backend 声明
- [x] ExecutionStateMachine
- [x] ExecutionHooks（beforeRun/beforeStep/afterStep/afterRun/onStateChange）
- [x] WorkItem 类型定义
- [ ] AgentWorker 内部迁移到使用 ExecutionSession（向后兼容）
- [ ] 把 workspace loop 的业务语义上移到 agent-worker/workspace
