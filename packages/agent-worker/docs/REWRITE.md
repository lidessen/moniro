# Rewrite Design

从已确立的决策出发（三级结构、SQLite、subprocess、结构化消息），重新设计整个系统。不受现有实现约束。

重写顺序：**Daemon → Worker → Interface**。Interface 跟着 Daemon 走。

**Related decisions**:
- [Three-Tier Architecture](../../../.memory/decisions/2026-02-16-three-tier-architecture.md)
- [Technology Choices](../../../.memory/decisions/2026-02-16-technology-choices.md)

---

## Part 0: Product Form（保留什么）

重写改的是实现，不是产品。用户看到的东西要保留。

### CLI 命令

```bash
# Agent 生命周期
agent-worker new <name> [--model] [--backend] [--system]
agent-worker list
agent-worker stop <target>
agent-worker info <name>

# 对话（单 agent）
agent-worker ask <agent> <message>       # SSE streaming
agent-worker serve <agent> <message>     # JSON response

# Workflow（多 agent）
agent-worker run <workflow.yaml> [--tag]
agent-worker start <workflow.yaml> [--tag] [--background]
agent-worker stop <target>

# 消息
agent-worker send <target> <message>
agent-worker peek [target]

# 文档
agent-worker doc read [--file]
agent-worker doc write <content> [--file]

# 调度
agent-worker schedule <target> set <interval>
agent-worker schedule <target> clear
```

### Workflow YAML

```yaml
name: code-review

agents:
  reviewer:
    model: anthropic/claude-sonnet-4-5
    system_prompt: prompts/reviewer.md
    schedule: 30s              # polling interval
    backend: default           # sdk | claude | codex | cursor | mock

  coder:
    model: anthropic/claude-sonnet-4-5
    system_prompt: prompts/coder.md

context:
  provider: sqlite             # default
  documentOwner: reviewer      # optional single-writer

setup:
  - shell: gh pr diff
    as: diff

kickoff: |
  PR diff: ${{ diff }}
  @reviewer please review.
```

### MCP Tools（Daemon MCP，暴露给 worker）

```
Channel:    channel_send, channel_read
Inbox:      my_inbox, my_inbox_ack
Status:     my_status_set
Team:       team_members
Document:   team_doc_read, team_doc_write, team_doc_append, team_doc_create, team_doc_list
Proposal:   team_proposal_create, team_vote, team_proposal_status, team_proposal_cancel
Resource:   resource_create, resource_read
```

### Target 语法

```
alice                → alice@global:main
alice@review         → alice@review:main
alice@review:pr-123  → full specification
@review:pr-123       → workflow:tag scope
```

---

## Part 1: Daemon（内核）

单进程，单 SQLite 文件，所有状态的唯一权威。

### 职责

```
Daemon
├── Database        ── SQLite，所有状态
├── Registry        ── agent/workflow 注册、配置
├── Scheduler       ── 决定 when（poll, cron, wake）
├── Context         ── 决定 what（channel, inbox, document, proposal）
├── ProcessManager  ── 决定 how（spawn, kill, monitor child processes）
├── MCP Server      ── context tools，worker 连接
└── HTTP Server     ── interface API，CLI/Web 连接
```

### SQLite Schema

```sql
-- Daemon 自身
CREATE TABLE daemon_state (
  key   TEXT PRIMARY KEY,
  value TEXT
);

-- Agent 注册
CREATE TABLE agents (
  name        TEXT PRIMARY KEY,
  model       TEXT NOT NULL,
  backend     TEXT NOT NULL DEFAULT 'default',
  system      TEXT,              -- system prompt content
  workflow    TEXT NOT NULL DEFAULT 'global',
  tag         TEXT NOT NULL DEFAULT 'main',
  schedule    TEXT,              -- '30s', '5m', cron expression
  config_json TEXT,              -- extra config (mcp servers, tools, etc.)
  state       TEXT NOT NULL DEFAULT 'idle',  -- idle | running | stopped
  created_at  INTEGER NOT NULL
);

-- Workflow 配置
CREATE TABLE workflows (
  name        TEXT NOT NULL,
  tag         TEXT NOT NULL,
  config_yaml TEXT,              -- original YAML (null for @global)
  state       TEXT NOT NULL DEFAULT 'running',  -- running | stopped
  created_at  INTEGER NOT NULL,
  PRIMARY KEY (name, tag)
);

-- 消息（Channel + Inbox 统一存储）
CREATE TABLE messages (
  id          TEXT PRIMARY KEY,
  workflow    TEXT NOT NULL,
  tag         TEXT NOT NULL,
  sender      TEXT NOT NULL,     -- agent name or 'system'
  content     TEXT NOT NULL,
  recipients  TEXT,              -- JSON array, @mention 写入时解析
  kind        TEXT NOT NULL DEFAULT 'message',  -- message | system | tool_call
  metadata    TEXT,              -- JSON, tool_call data etc.
  created_at  INTEGER NOT NULL
);
CREATE INDEX idx_messages_workflow ON messages(workflow, tag, created_at);

-- Inbox 确认状态（per agent per workflow）
CREATE TABLE inbox_ack (
  agent     TEXT NOT NULL,
  workflow  TEXT NOT NULL,
  tag       TEXT NOT NULL,
  cursor    TEXT NOT NULL,       -- last acked message id
  PRIMARY KEY (agent, workflow, tag)
);

-- 文档
CREATE TABLE documents (
  workflow  TEXT NOT NULL,
  tag       TEXT NOT NULL,
  path      TEXT NOT NULL,       -- 'notes.md', 'findings/auth.md'
  content   TEXT NOT NULL,
  owner     TEXT,                -- single-writer enforcement
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (workflow, tag, path)
);

-- 资源（大内容）
CREATE TABLE resources (
  id          TEXT PRIMARY KEY,
  workflow    TEXT NOT NULL,
  tag         TEXT NOT NULL,
  content     TEXT NOT NULL,
  type        TEXT NOT NULL DEFAULT 'text',  -- markdown | json | text | diff
  created_by  TEXT NOT NULL,
  created_at  INTEGER NOT NULL
);

-- 提案
CREATE TABLE proposals (
  id          TEXT PRIMARY KEY,
  workflow    TEXT NOT NULL,
  tag         TEXT NOT NULL,
  type        TEXT NOT NULL,     -- election | decision | approval | assignment
  title       TEXT NOT NULL,
  options     TEXT NOT NULL,     -- JSON array
  resolution  TEXT NOT NULL DEFAULT 'plurality',
  binding     INTEGER NOT NULL DEFAULT 1,
  status      TEXT NOT NULL DEFAULT 'active',  -- active | resolved | expired | cancelled
  creator     TEXT NOT NULL,
  result      TEXT,              -- winning option
  created_at  INTEGER NOT NULL,
  resolved_at INTEGER
);

CREATE TABLE votes (
  proposal_id TEXT NOT NULL,
  agent       TEXT NOT NULL,
  choice      TEXT NOT NULL,
  reason      TEXT,
  created_at  INTEGER NOT NULL,
  PRIMARY KEY (proposal_id, agent),
  FOREIGN KEY (proposal_id) REFERENCES proposals(id)
);

-- Worker 进程状态
CREATE TABLE workers (
  agent       TEXT NOT NULL,
  workflow    TEXT NOT NULL,
  tag         TEXT NOT NULL,
  pid         INTEGER,           -- OS process ID
  state       TEXT NOT NULL DEFAULT 'idle',  -- idle | running | dead
  started_at  INTEGER,
  last_heartbeat INTEGER,
  PRIMARY KEY (agent, workflow, tag)
);

-- 会话历史（可选，用于 agent 续接对话）
CREATE TABLE sessions (
  agent       TEXT NOT NULL,
  workflow    TEXT NOT NULL,
  tag         TEXT NOT NULL,
  messages    TEXT NOT NULL,     -- JSON array of conversation messages
  usage       TEXT,              -- JSON token usage
  updated_at  INTEGER NOT NULL,
  PRIMARY KEY (agent, workflow, tag)
);
```

### Daemon 启动流程

```
daemon start
  │
  ├── 打开/创建 SQLite (WAL mode)
  ├── 执行 schema migration（如果新库）
  ├── 从 DB 恢复 agents + workflows
  ├── 启动 HTTP server
  ├── 启动 MCP server
  ├── 写 daemon.json（pid, host, port）── Interface 用于发现
  │
  ├── 恢复 running workflows：
  │   for each workflow where state = 'running':
  │     for each agent in workflow:
  │       scheduler.resume(agent)  ── 恢复调度
  │
  └── ready
```

### Daemon 关闭流程

```
daemon shutdown (SIGINT/SIGTERM)
  │
  ├── 停止所有 schedulers
  ├── 通知所有 worker 子进程退出（SIGTERM → wait → SIGKILL）
  ├── 更新 workers 表（state = 'dead'）
  ├── 关闭 HTTP server
  ├── 关闭 MCP server
  ├── 关闭 SQLite
  └── 删除 daemon.json
```

### Scheduler

每个 agent 一个调度实例。Scheduler 决定 **when**，ProcessManager 执行 **how**。

```
Scheduler(agent)
  │
  state: idle | waiting | triggered
  │
  ├── triggers:
  │   ├── inbox_poll    ── 定期检查 inbox（默认 5s）
  │   ├── cron          ── cron 表达式
  │   ├── interval      ── 固定间隔
  │   └── wake          ── 外部信号（@mention 写入时触发）
  │
  └── on trigger:
        │
        ├── 查询 inbox：
        │   SELECT * FROM messages m
        │   LEFT JOIN inbox_ack a ON ...
        │   WHERE recipients LIKE '%"agent"%'
        │     AND (a.cursor IS NULL OR m.id > a.cursor)
        │
        ├── 如果有消息 OR 是 cron/interval 触发：
        │   processManager.run(agent, context)
        │
        └── 如果无消息且是 poll 触发：
            sleep → 下一次 poll
```

### ProcessManager

管理 worker 子进程的生命周期。

```
processManager.run(agent)
  │
  ├── 准备 worker 配置（只传身份和连接信息，不传 context 数据）：
  │   {
  │     agent: { name, model, backend, system },
  │     daemon_mcp_url: "http://localhost:<port>/mcp?agent=<name>",
  │     worker_mcp_configs: [...],   ── agent 自持的 MCP server 配置
  │   }
  │
  │   ❌ 不传 inbox, channel, document
  │   ✅ Worker 启动后通过 Daemon MCP 按需拉取：
  │      my_inbox() → channel_read() → team_doc_read()
  │
  ├── spawn child process：
  │   fork('worker-entry.ts', { env: { WORKER_CONFIG: JSON.stringify(config) } })
  │   或
  │   spawn(['claude', '--mcp-config', ...])   ── CLI backend
  │
  ├── 监听子进程：
  │   on 'message' → IPC 通信（心跳、中间结果）
  │   on 'exit'    → 处理结果
  │
  ├── 超时保护：
  │   setTimeout → 如果超时，SIGTERM → SIGKILL
  │
  └── 完成后：
      ├── 成功 → ack inbox, 写 response 到 channel
      ├── 失败 → retry（exponential backoff, max 3）
      └── 更新 workers 表
```

### @mention 写入时解析

`channel_send` 是消息写入的唯一入口。Daemon 负责解析 @mention。

```typescript
// daemon 内部
function channelSend(sender: string, content: string, workflow: string, tag: string) {
  // 1. 解析 @mentions
  const recipients = parseMentions(content)  // ["reviewer", "all", ...]

  // 2. 展开 @all
  if (recipients.includes('all')) {
    recipients = getAllAgents(workflow, tag)
  }

  // 3. 长消息自动转 resource
  let finalContent = content
  if (content.length > THRESHOLD) {
    const resourceId = createResource(content, sender, workflow, tag)
    finalContent = `[See resource: ${resourceId}]`
  }

  // 4. 写入 messages 表
  const id = nanoid()
  db.run(`INSERT INTO messages (id, workflow, tag, sender, content, recipients, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?)`,
    id, workflow, tag, sender, finalContent, JSON.stringify(recipients), Date.now())

  // 5. 触发 wake（如果有 recipient 的 scheduler 在等）
  for (const r of recipients) {
    scheduler.wake(r)
  }

  return id
}
```

### Inbox 查询

```sql
-- 获取 agent 的未读消息
SELECT m.* FROM messages m
LEFT JOIN inbox_ack a
  ON a.agent = ? AND a.workflow = m.workflow AND a.tag = m.tag
WHERE m.workflow = ? AND m.tag = ?
  AND m.recipients LIKE ?         -- '%"reviewer"%' (JSON contains)
  AND (a.cursor IS NULL OR m.created_at > (
    SELECT m2.created_at FROM messages m2 WHERE m2.id = a.cursor
  ))
ORDER BY m.created_at ASC;

-- Ack: 更新游标
INSERT OR REPLACE INTO inbox_ack (agent, workflow, tag, cursor)
VALUES (?, ?, ?, ?);
```

### Daemon MCP Server

暴露给 worker 的 context tools。每个 worker 连接时通过 `?agent=<name>` 标识身份。

```
Tool handlers 全部是 thin wrapper over SQLite queries:

channel_send(message, to?)
  → channelSend(agent, message, workflow, tag)
  → 写入时解析 @mention

channel_read(since?, limit?)
  → SELECT FROM messages WHERE workflow = ? AND tag = ? ...

my_inbox()
  → inbox query（上面的 SQL）

my_inbox_ack(until)
  → INSERT OR REPLACE INTO inbox_ack ...

team_doc_read(file?)
  → SELECT content FROM documents WHERE path = ? ...

team_doc_write(content, file?)
  → 检查 ownership → UPDATE documents SET content = ? ...

team_proposal_create(...)
  → INSERT INTO proposals ...

team_vote(proposal, choice, reason?)
  → INSERT INTO votes ...
  → 检查 quorum → 如果达到，resolve proposal
```

### Daemon HTTP API

给 Interface 层用。和 MCP server 是两个入口，同一个数据源。

```
GET  /health                → { pid, uptime, agents, workflows }
POST /shutdown              → graceful shutdown

POST /agents                → register agent
GET  /agents                → list agents
GET  /agents/:name          → agent info
DELETE /agents/:name        → delete agent

POST /run                   → execute agent (SSE stream)
POST /serve                 → execute agent (JSON response)

POST /workflows             → start workflow
GET  /workflows             → list workflows
DELETE /workflows/:key      → stop workflow

POST /send                  → send message to channel
GET  /peek                  → read recent channel

ALL  /mcp                   → Daemon MCP endpoint
```

---

## Part 2: Worker（执行单元）

Child process。接收配置，执行 LLM 对话，返回结果。不知道调度，不知道生命周期。

### Worker 入口

```typescript
// worker-entry.ts — 子进程入口
// 由 daemon processManager fork/spawn

const config = JSON.parse(process.env.WORKER_CONFIG)
// config = { agent: { name, model, backend, system }, daemon_mcp_url, worker_mcp_configs }
// ❌ config 不含 inbox/channel/document — context 全部通过 MCP 按需拉取

// 1. 连接 Daemon MCP（获取 context tools）
const daemonMCP = await connectDaemonMCP(config.daemon_mcp_url)

// 2. 连接 Worker MCP（自持 task tools，如果有）
const workerTools = await connectWorkerMCPs(config.worker_mcp_configs)

// 3. 通过 Daemon MCP 拉取 context，构建 prompt
const inbox    = await daemonMCP.call('my_inbox')
const channel  = await daemonMCP.call('channel_read', { limit: 50 })
const document = await daemonMCP.call('team_doc_read')
const prompt   = buildPrompt({ ...config, inbox, channel, document })

// 4. 执行 LLM 会话（LLM 运行中也可随时调用 MCP tools）
const result = await runSession({
  model: config.agent.model,
  backend: config.agent.backend,
  system: config.agent.system,
  prompt,
  tools: { ...daemonMCP.tools, ...workerTools },
})

// 5. 返回结果（IPC 或 stdout）
process.send?.({ type: 'result', data: result })
process.exit(0)
```

### Backend 适配

Worker 内部根据 backend 类型选择执行方式：

```
backend = 'default' (SDK)
  → Vercel AI SDK generateText() + tool loop
  → 直接用 daemonTools + workerTools

backend = 'claude'
  → spawn claude CLI as sub-subprocess
  → --mcp-config 指向 daemon MCP
  → 本身就是 subprocess 的 subprocess

backend = 'codex' | 'cursor'
  → 类似 claude，spawn 对应 CLI

backend = 'mock'
  → 脚本化响应，用于测试
```

对于 CLI backend（claude/codex/cursor），worker-entry.ts 本身就是一个 thin wrapper：准备好 MCP 配置文件，spawn CLI 进程，等待完成。

### Worker ↔ Daemon 通信

```
                     ┌──────────────────────────┐
                     │        Daemon             │
                     │                           │
           IPC ◄─────┤  ProcessManager           │
         (控制)       │      │                    │
                     │      │                    │
           HTTP ─────┤  MCP Server               │
         (数据)       │                           │
                     └──────────────────────────┘
                              ▲
                              │
                     ┌────────┴─────────────────┐
                     │        Worker             │
                     │                           │
                     │  IPC: heartbeat, result   │
                     │  MCP: channel_send, etc.  │
                     └──────────────────────────┘

控制通道（IPC / stdio）：
  daemon → worker: start config
  worker → daemon: heartbeat, result, error
  daemon → worker: stop signal (SIGTERM)

数据通道（MCP over HTTP）：
  worker → daemon: channel_send, my_inbox, team_doc_read, ...
  标准 MCP 协议，和 in-process 时接口完全一致
```

### Prompt 构建

Worker 启动后通过 Daemon MCP 拉取 context，然后本地构建 prompt。Daemon 不碰 prompt。

```
Worker 启动流程：
  1. connectDaemonMCP(url)     ── 建立连接
  2. my_inbox()                ── 拉取未读消息
  3. channel_read(limit: 50)   ── 拉取最近消息
  4. team_doc_read()           ── 拉取文档
  5. buildPrompt(...)          ── 本地组装

Prompt 结构：

## Your Identity
{system_prompt}

## Inbox ({count} messages for you)
{inbox messages, formatted}

## Recent Activity
{recent channel messages}

## Current Workspace
{document content, if any}

## Instructions
Process your inbox messages. Use MCP tools to collaborate with your team.
```

Prompt 构建是 worker 的职责——daemon 只提供原始数据（inbox, channel, document），worker 决定如何呈现给 LLM。

---

## Part 3: Interface（接口层）

无状态。纯协议转换。跟着 Daemon HTTP API 走。

### CLI 实现

```
CLI
├── 发现 daemon（读 daemon.json → 检查 pid 存活 → 获取 host:port）
├── 如果 daemon 不在 → 自动启动
├── 发送 HTTP 请求 → 收到响应 → 格式化输出
└── 不持有任何状态
```

每个命令 = 一个 HTTP 调用：

```typescript
// 所有命令都是 thin HTTP wrappers
const commands = {
  'new':      (args) => POST('/agents', { name, model, ... }),
  'list':     ()     => GET('/agents'),
  'ask':      (args) => POST('/run', { agent, message }),  // SSE
  'send':     (args) => POST('/send', { target, message }),
  'run':      (args) => POST('/workflows', { workflow, tag }),
  'stop':     (args) => DELETE(`/workflows/${key}`),
  // ...
}
```

SSE 流式输出：

```
POST /run → SSE stream
  event: chunk   data: "thinking..."
  event: chunk   data: "Here's my analysis:"
  event: tool    data: {"name": "channel_send", "args": {...}}
  event: done    data: {"usage": {...}}
```

### Interface 不做什么

- 不解析 workflow YAML（daemon 做）
- 不管 agent 状态（daemon 管）
- 不构建 prompt（worker 做）
- 不缓存任何东西

---

## Part 4: Module Structure

```
src/
├── daemon/                        # The kernel
│   ├── index.ts                   # Entry, lifecycle (start/shutdown)
│   ├── db.ts                      # SQLite schema, migrations, query helpers
│   ├── registry.ts                # Agent + workflow CRUD
│   ├── scheduler.ts               # Poll / cron / wake logic
│   ├── process-manager.ts         # Spawn / kill / monitor child processes
│   ├── http.ts                    # HTTP API (Hono)
│   ├── mcp.ts                     # Daemon MCP server (context tools)
│   └── context.ts                 # Channel, inbox, document, proposal operations
│
├── worker/                        # The execution unit
│   ├── entry.ts                   # Subprocess entry point (main)
│   ├── session.ts                 # LLM conversation + tool loop
│   ├── prompt.ts                  # Prompt building from raw data
│   ├── mcp-client.ts             # Connect to Daemon MCP
│   └── backends/                  # LLM communication adapters
│       ├── types.ts               # Backend interface
│       ├── sdk.ts                 # Vercel AI SDK
│       ├── claude-cli.ts          # Claude Code CLI
│       ├── codex-cli.ts           # Codex CLI
│       ├── cursor-cli.ts          # Cursor CLI
│       └── mock.ts                # Testing
│
├── interface/                     # The shell
│   ├── cli.ts                     # CLI entry, arg parsing
│   ├── client.ts                  # HTTP client to daemon
│   ├── discovery.ts               # Find running daemon (daemon.json)
│   ├── output.ts                  # Output formatting
│   └── commands/                  # One file per command group
│       ├── agent.ts               # new, list, stop, info
│       ├── workflow.ts            # run, start, stop, list
│       ├── send.ts                # send, peek
│       ├── doc.ts                 # doc read, write, append
│       ├── schedule.ts            # schedule set, clear
│       └── info.ts                # providers, backends
│
├── workflow/                      # Workflow YAML handling (daemon uses this)
│   ├── parser.ts                  # YAML → typed config
│   ├── interpolate.ts             # Variable ${{ }} resolution
│   └── types.ts                   # Workflow config types
│
└── shared/                        # Cross-layer types
    ├── types.ts                   # Message, Agent, Proposal, etc.
    ├── protocol.ts                # IPC message types (daemon ↔ worker)
    └── constants.ts               # Tool names, defaults
```

### 依赖规则

```
interface/ ── HTTP ──► daemon/
                         │
                         ├──► worker/entry.ts  (fork)
                         │       │
                         │       └──► worker/backends/
                         │
                         ├──► workflow/  (YAML parsing)
                         │
                         └──► shared/

worker/ ── MCP/HTTP ──► daemon/mcp
worker/ imports shared/ only
daemon/ imports shared/ + workflow/
interface/ imports shared/ only (+ HTTP client)

禁止：
  interface/ ──✗──► daemon/ (direct import)
  worker/ ──✗──► daemon/ (direct import)
  daemon/ ──✗──► interface/
```

---

## Part 5: Rewrite Execution Order

### Step 1: Daemon Core

先把内核跑起来。能启动、能关闭、能存数据。

```
daemon/db.ts          ── SQLite schema + migration
daemon/index.ts       ── start/shutdown lifecycle
daemon/registry.ts    ── agent/workflow CRUD (DB operations)
daemon/http.ts        ── 最小 HTTP API（/health, /agents CRUD）
shared/types.ts       ── core types
```

验证：daemon 启动 → SQLite 创建 → HTTP 可用 → 注册 agent → 关闭 → 重启 → agent 还在。

### Step 2: Context（Channel + Inbox）

消息系统。结构化写入，索引查询。

```
daemon/context.ts     ── channelSend, channelRead, inboxQuery, inboxAck
daemon/mcp.ts         ── channel_send, channel_read, my_inbox, my_inbox_ack tools
```

验证：通过 MCP tool 发消息 → @mention 自动解析 → inbox 查询返回未读 → ack 后消失。

### Step 3: Worker Subprocess

能 spawn worker，能跑 LLM 对话，能连回 daemon MCP。

```
worker/entry.ts       ── subprocess 入口
worker/session.ts     ── LLM 工具循环
worker/mcp-client.ts  ── 连接 daemon MCP
worker/backends/sdk.ts ── AI SDK backend
worker/prompt.ts      ── prompt 构建
daemon/process-manager.ts  ── spawn/kill/monitor
```

验证：daemon spawn worker → worker 连接 daemon MCP → 调用 channel_send → daemon 收到消息 → worker 退出。

### Step 4: Scheduler

把 step 2 + step 3 串起来。Inbox 有消息 → 触发 worker → worker 处理 → ack。

```
daemon/scheduler.ts   ── poll/cron/wake
```

验证：发消息 @mention agent → scheduler 检测到 → spawn worker → worker 响应 → channel 有回复。

### Step 5: Interface CLI

用户能用了。

```
interface/            ── 全部
workflow/             ── YAML 解析
```

验证：完整 workflow 从 CLI 启动到完成。

### Step 6: 补全

```
daemon/context.ts     ── document, proposal, resource 操作
daemon/mcp.ts         ── 对应的 MCP tools
worker/backends/      ── claude-cli, codex-cli, cursor-cli, mock
```

---

## Design Principles（重写时的指导）

1. **SQLite 是 single source of truth**。不要在内存中维护第二份状态。需要数据就查 DB。
2. **Worker 是短命的**。每次调用 spawn → 执行 → 退出。不要让 worker 常驻（除非未来有明确需求）。
3. **Daemon 不碰 prompt**。它提供原始数据（inbox, channel, document），worker 决定如何呈现给 LLM。
4. **接口层是 1:1 映射**。每个 CLI 命令 = 一个 HTTP 调用。不要在 interface 层加逻辑。
5. **先跑通最小回路，再加功能**。Step 1-4 完成后应该能跑完一个完整的消息-响应循环。
6. **保持表结构稳定**。schema 一旦定，加列可以，改列语义不行。设计好了再建表。
