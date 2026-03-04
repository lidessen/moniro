# Todos

跨会话的任务追踪。当前阶段：**Phase 5+ — 后续功能**。

## 活跃任务

| 优先级 | 任务 | 状态 | 备注 |
|--------|------|------|------|
| medium | `send` CLI target 解析（DM / @workspace / agent@workspace） | todo | Phase 3b 遗留，见 ADR |

## 未来任务（Phase 5+）

| 优先级 | 任务 | 阶段 | 备注 |
|--------|------|------|------|
| high | AgentLoop → priority queue（3 lanes） | Phase 5 | 在 System 层实现 |
| high | AgentInstruction 类型 + cooperative preemption | Phase 5 | 在 System 层实现 |
| medium | Personal context tools 实现（memory/notes/todos） | Phase 6 | 在 Agent 层，pluggable storage |
| medium | Agent context in prompt（recall tools, auto-memory） | Phase 6 | |
| low | CLI + Project Config（moniro.yaml） | Phase 7 | |

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
| Three-Package Split 设计 | 2026-03-02 | PACKAGE-SPLIT.md |
| Phase 4: Three-Package Split 实施 | 2026-03-04 | @moniro/agent + @moniro/workflow 提取, 1012 tests |
| CI 更新: 三包构建顺序 | 2026-03-04 | test.yml, agent-workflow.yml, changeset-agent.yml |

## 使用约定

- `todo` → 未开始
- `in-progress` → 当前会话正在做
- `done` → 完成，移入"已完成"表格
- 优先级：high（阻塞后续）、medium（本阶段需要）、low（可延后）
