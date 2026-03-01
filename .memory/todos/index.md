# Todos

跨会话的任务追踪。当前阶段：**Phase 3d — Priority Queue + Preemption**。

## 活跃任务

| 优先级 | 任务 | 状态 | 备注 |
|--------|------|------|------|
| medium | `send` CLI target 解析（DM / @workspace / agent@workspace） | todo | Phase 3b 遗留，见 ADR |
| high | AgentLoop → priority queue（3 lanes） | todo | Phase 3d |
| high | AgentInstruction 类型 + cooperative preemption | todo | Phase 3d |

## 已完成

| 任务 | 完成日期 | 备注 |
|------|----------|------|
| Phase 0: 预备清理 | 2026-02-27 | 880 tests pass |
| Phase 1: Agent Definition + Context | 2026-02-27 | AgentHandle, AgentRegistry, CLI |
| Phase 2: Workflow Agent References | 2026-02-27 | ref: 引用, prompt assembly |
| Phase 3a: Event Log Infrastructure | 2026-02-27 | EventSink, Logger, 954 tests |
| Phase 3a 审计 + review 修复 | 2026-03-01 | formatArg Error 处理, 993 tests |
| 统一 logger: 库代码零 console.* | 2026-02-27 | [ADR](../decisions/2026-02-27-unified-logger.md) |
| Phase 3b: Daemon Registry + Workspace | 2026-03-01 | AgentRegistry + WorkspaceRegistry, 994 tests |
| Phase 3c: Conversation Model | 2026-03-01 | ConversationLog + ThinThread, 1014 tests |

## 使用约定

- `todo` → 未开始
- `in-progress` → 当前会话正在做
- `done` → 完成，移入"已完成"表格
- 优先级：high（阻塞后续）、medium（本阶段需要）、low（可延后）
