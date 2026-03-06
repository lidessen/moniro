# Todos

跨会话的任务追踪。当前阶段：**Personal Agent 优先**。

## 活跃任务

| 优先级 | 任务 | 状态 | 备注 |
|--------|------|------|------|
| **highest** | Phase 5 PR 合并 (#110) | in-progress | 合并后立即进入 Phase 6a |
| **highest** | Phase 6a: Personal Agent Prompt | todo | soulSection + memorySection + todoSection → prompt.ts |
| **high** | Phase 6b: Context Tools + Auto-Memory | todo | 动态 MCP tools + recall + 自动记忆提取 |
| medium | Phase 6c: Guard Agent（看守者） | todo | 智能上下文组装，设计已完成 |
| low | `send` CLI target 解析 | todo | Phase 3b 遗留，降低优先级 |
| low | CLI + Project Config（moniro.yaml） | todo | 降级，个人 Agent 完成后再做 |

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
| Phase 5: Priority Queue + Cooperative Preemption | 2026-03-04 | PR #110, 1047 tests |

## 使用约定

- `todo` → 未开始
- `in-progress` → 当前会话正在做
- `done` → 完成，移入"已完成"表格
- 优先级：high（阻塞后续）、medium（本阶段需要）、low（可延后）
