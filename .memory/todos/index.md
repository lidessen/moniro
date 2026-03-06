# Todos

跨会话的任务追踪。当前阶段：**四包重构 + Personal Agent**。

## 活跃任务

| 优先级 | 任务 | 状态 | 备注 |
|--------|------|------|------|
| **highest** | Phase 5 PR 合并 (#110) | in-progress | 合并后开始重构 |
| **highest** | Phase 6-restructure: 四包重构 | todo | 见下方分解 |
| medium | Phase 6c: Guard Agent | todo | Workspace 层可选优化，不阻塞个人 agent |
| medium | Phase 6d: Channel Bridge | todo | 可独立推进 |
| low | `send` CLI target 解析 | todo | Phase 3b 遗留 |
| low | CLI + Project Config（moniro.yaml） | todo | 降级 |

### Phase 6-restructure 分解

依赖顺序，每步保持 green build：

| 步骤 | 内容 | 状态 | 备注 |
|------|------|------|------|
| 1 | 创建 `@moniro/agent-worker` 包（临时目录 `packages/agent-worker-core/`） | todo | 提取 PersonalContextProvider + FileContextProvider + PromptAssembler |
| 2 | 搬迁个人 prompt sections（soul/memory/todo）到 @moniro/agent-worker | todo | 从 workflow/loop/prompt.ts 搬 |
| 3 | 搬迁 personal context tools 到 @moniro/agent-worker（变本地 tools） | todo | 从 workflow/context/mcp/personal.ts 搬 |
| 4 | 搬迁 bash tools 到 @moniro/agent-worker | todo | 从 workflow/tools/bash.ts 搬 |
| 5 | 搬迁 daemon + agent handle/registry 到 @moniro/agent-worker | todo | 从现 agent-worker 搬 |
| 6 | 清理 workspace 层：移除 personal context 代码 | todo | AgentHandleRef, PersonalContext, personal MCP tools |
| 7 | 反转依赖：workspace → agent-worker（不再反向） | todo | workspace 的 package.json 改依赖 |
| 8 | 包重命名：agent → agent-loop, workflow → workspace | todo | 更新所有引用 |
| 9 | 创建 umbrella 包 `packages/moniro/`（CLI + re-exports） | todo | `agent-worker` 发布名 |
| 10 | 全量测试 + CI 更新 | todo | 确保 build 顺序正确 |

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

## 使用约定

- `todo` → 未开始
- `in-progress` → 当前会话正在做
- `done` → 完成，移入"已完成"表格
- 优先级：highest（阻塞一切）、high（阻塞后续）、medium（本阶段需要）、low（可延后）
