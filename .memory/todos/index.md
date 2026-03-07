# Todos

跨会话的任务追踪。当前阶段：**CLI 重新设计，对齐对象模型**。

设计文档：`packages/agent-worker/CLI-DESIGN.md`

## 活跃任务

### Phase 7a: 路径基础设施 ✅

全部完成，1110 tests pass。详见已完成区。

### Phase 7b: AgentRegistry + .agents/ 废弃 + daemon API 契约 ✅

全部完成，1094 tests pass。详见已完成区。

### Phase 7c: CLI 命令重构 ✅

全部完成，1095 tests pass。详见已完成区。

### Phase 7d: 术语迁移 + 测试 ✅

全部完成，1095 tests pass。详见已完成区。

### 其他（不阻塞 CLI 重构）

| 优先级 | 任务 | 状态 | 备注 |
|--------|------|------|------|
| medium | Phase 6c: Guard Agent | todo | Workspace 层可选优化 |
| medium | Phase 6d: Channel Bridge — HTTP Webhook | todo | 跨进程场景，按需 |

## 已完成

> **注意**: Phase 6e/6f 中的 `.agents/` 持久化行为（loadFromDisk, persist by default, auto-start persisted agents）将被 Phase 7 主动取代。Phase 7 将 config.yml 定为唯一真相源，.agents/ 全废弃。这些 Phase 6 工作不再是需要维护的目标。

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
| Phase 6e: Daemon Persistence + Bridge Abstraction | 2026-03-06 | **⚠ superseded by Phase 7**: loadFromDisk, persist by default → 废弃 |
| Phase 6f: Agent Wake-up + Auto-start | 2026-03-06 | **⚠ partially superseded**: auto-start 改为从 config.yml 加载，不再从 .agents/ |
| Phase 7a: 路径基础设施 | 2026-03-07 | global=`~/.agent-worker/`, workspaces=`workspaces/<name>[@<tag>]/`, tag nullable, per-agent=`agents/<name>/`, 1110 tests |
| Phase 7b: .agents/ 废弃 + daemon API | 2026-03-07 | AgentRegistry 纯内存化, yaml-parser.ts 删除, `agent *` 子命令删除, POST /agents 永远 ephemeral, 1094 tests |
| Phase 7c: CLI 命令重构 | 2026-03-07 | `daemon`→`up`/`down`, `serve`→`ask --no-stream`, 新增 `rm`/`onboard`, `stop` 不再有 `--all`, 1095 tests |
| Phase 7d: 术语迁移 | 2026-03-07 | CLI help/描述/错误消息 workflow→workspace, display-pretty 修复, .agents/ 测试已清理 |

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
