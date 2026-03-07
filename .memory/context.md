# Project Context

> 快速了解项目状态。详细设计见 `packages/agent-worker/docs/architecture/` 下各文档。

## 当前焦点

**CLI 重新设计** — 对齐对象模型（config.yml 真相源、workspace 统一术语、tag 可空、.agents/ 废弃）。
设计文档：`packages/agent-worker/CLI-DESIGN.md`。分支：`claude/prioritize-personal-agent-QSJgx`。

## 架构概览

四个包：三个内部 `@moniro/*`（不发布）+ 一个 umbrella `agent-worker`（发布）。

```
@moniro/workspace → @moniro/agent-worker → @moniro/agent-loop
                                              ↑
agent-worker (umbrella) ──── re-exports all ──┘
```

```
packages/
├── agent/           → @moniro/agent-loop      纯执行循环
├── worker/          → @moniro/agent-worker     个人 agent（身份, 记忆, tools）
├── workspace/       → @moniro/workspace        协作空间（channel, MCP server）
└── agent-worker/    → agent-worker             umbrella（CLI + daemon + re-exports）
```

各层职责：
- **Agent Loop** (`@moniro/agent-loop`): 执行一次对话 loop。backends, tool loop, MCP/Skills 协议。无状态。
- **Agent Worker** (`@moniro/agent-worker`): 让执行器变成"人"。身份 + 记忆 + 个人 tools + bash + prompt 组装。不知道 workspace。
- **Workspace** (`@moniro/workspace`): 协作空间。依赖 agent-worker 创建 agent。暴露标准 MCP server，外部个人 agent 通过 MCP client 接入。
- **Umbrella** (`agent-worker`): CLI 入口 + daemon + re-export 所有内部包。跟 semajsx 同模式。

### 导入约定

- **包间**: 通过内部包名 (`from "@moniro/agent-loop"`)
- **包内**: 通过 `@/` 路径别名 (`from "@/context/types.ts"`)，同目录用 `./`

## 阶段总览

| 阶段 | 状态 | 内容 | 关键产物 |
|------|------|------|----------|
| Phase 0 | done | 预备清理：类型重命名、config 解耦 | `WorkflowAgentDef`, `DaemonState.loops` |
| Phase 1 | done | Agent 定义 + Context：YAML、Registry、CLI | `.agents/*.yaml`, `AgentHandle`, `AgentRegistry` |
| Phase 2 | done | Workflow Agent References：`ref:` 引用 | `AgentEntry` 联合类型, prompt assembly |
| Phase 3a | done | Event Log 基础设施 | `EventSink`, `DaemonEventLog`, `Logger` |
| Phase 3b | done | Daemon Registry + Workspace | `Workspace`, `WorkspaceRegistry` |
| Phase 3c | done | Conversation Model | `ConversationLog`, `ThinThread` |
| Phase 4 | done | Three-Package Split | `@moniro/agent`, `@moniro/workflow`, `agent-worker` |
| Phase 5 | done | Priority Queue + Cooperative Preemption | `InstructionQueue`, `PreemptionError` |
| Phase 6a | done | Personal Agent Prompt | soulSection + memorySection + todoSection |
| Phase 6b | done | Personal Context Tools | 动态 MCP tools (memory/notes/todos read+write) |
| **Phase 6-restructure** | **done** | **四包重构** | 依赖反转 + 个人 agent 下沉 + 包重命名 + @/ alias |
| Phase 6c | future | Guard Agent（看守者） | Workspace 层的智能上下文管理，可选 |
| Phase 6d | **done** | Channel Bridge + Telegram | ChannelBridge + TelegramAdapter + mention 扩展, 1108 tests |
| Phase 6e | **done** | Daemon Persistence + Bridge Abstraction | loadFromDisk, persist by default, bridge config→workspace, channel_send targeting, 1113 tests |
| Phase 6f | **done** | Agent Wake-up + Auto-start | onMention→wake, bridge inbound→wake, daemon auto-starts persisted agents, 1112 tests |
| Phase 6d+ | future | Channel Bridge HTTP Webhook | SSE/HTTP endpoint for cross-process adapters |
| Phase 7 | deprioritized | CLI + Project Config | `moniro.yaml`, improved CLI |

## 已知风险 & 开放问题

（已全部解决，见 PACKAGE-SPLIT.md Resolved Questions）

## 关键文件

| 文件 | 用途 |
|------|------|
| `packages/agent-worker/docs/architecture/PACKAGE-SPLIT.md` | 四包拆分设计（2026-03-06） |
| `packages/agent-worker/docs/architecture/AGENT-TOP-LEVEL.md` | Agent 顶层实体设计 |
| `packages/agent-worker/docs/architecture/CHANNEL-BRIDGE.md` | Channel 外部集成设计 |
| `.memory/decisions/2026-03-06-three-layer-restructuring.md` | 四包重构 ADR |
| `.memory/decisions/` | ADR 记录 |
| `.memory/todos/index.md` | 活跃任务 |
