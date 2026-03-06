# Todos

跨会话的任务追踪。当前阶段：**四包结构已完成，进入功能开发**。

## 活跃任务

| 优先级 | 任务 | 状态 | 备注 |
|--------|------|------|------|
| medium | Phase 6c: Guard Agent | todo | Workspace 层可选优化，不阻塞个人 agent |
| medium | Phase 6d: Channel Bridge — HTTP Webhook | todo | 跨进程场景，按需 |
| low | `send` CLI target 解析 | todo | Phase 3b 遗留 |
| low | CLI + Project Config（moniro.yaml） | todo | 降级 |

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
| Phase 6a: Personal Agent Prompt | 2026-03-05 | soulSection + memorySection + todoSection |
| Phase 6b: Personal Context Tools | 2026-03-05 | 6 个 my_* MCP tools |
| 四包重构设计 | 2026-03-06 | ADR + PACKAGE-SPLIT 更新 |
| Phase 6-restructure: 四包重构 | 2026-03-06 | 1085 tests, 见下方详情 |
| Phase 6d: Channel Bridge + Telegram | 2026-03-06 | ChannelBridge + TelegramAdapter + mention 扩展, 1108 tests |
| Phase 6e: Daemon Persistence + Bridge Abstraction | 2026-03-06 | loadFromDisk, persist by default, bridge config→workspace, channel_send targeting, 1113 tests |
| Phase 6f: Agent Wake-up + Auto-start | 2026-03-06 | onMention→wake, bridge inbound→wake, auto-start persisted agents, removed dead WorkspaceRegistry, 1112 tests |

### Phase 6-restructure 完成详情

| 步骤 | 内容 | 状态 | 备注 |
|------|------|------|------|
| 1-4 | 创建 `@moniro/agent-worker` 包 (packages/worker/) | done | PersonalContextProvider, prompt sections, context tools, bash tools |
| 5 | AgentHandle implements PersonalContextProvider | done | daemon 留在 umbrella |
| 6-7 | 清理 workspace + 依赖方向 | done | workspace → agent-worker → agent-loop |
| 8 | 包重命名 | done | agent→agent-loop, workflow→workspace |
| — | @ path alias | done | 包内 @/ 引用，包间用包名 |
| 10 | 全量测试 | done | 1085 pass, 0 fail |

## 使用约定

- `todo` → 未开始
- `in-progress` → 当前会话正在做
- `done` → 完成，移入"已完成"表格
- 优先级：highest（阻塞一切）、high（阻塞后续）、medium（本阶段需要）、low（可延后）
