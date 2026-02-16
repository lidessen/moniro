# Agent Worker Workflow Design

Multi-agent orchestration with shared context and @mention-driven collaboration.

**Related**: [REFERENCE.md](./REFERENCE.md) | [TODO.md](./TODO.md)

---

## Overview

Agent Worker enables multiple AI workers to collaborate on tasks through a shared communication channel and workspace. Workers coordinate via @mentions, similar to team chat. The daemon (kernel) manages all scheduling, context, and lifecycle; workers are pure execution units that access context via Daemon MCP tools.

### Key Concepts

| Concept            | Description                                                   |
| ------------------ | ------------------------------------------------------------- |
| **Workflow:Tag**   | `agent@workflow:tag` syntax for multi-instance workflows      |
| **Shared Context** | Channel (communication) + Document (workspace)                |
| **Kickoff Model**  | Natural language workflow initiation via @mentions            |
| **Two Modes**      | `run` (one-shot) and `start` (persistent)                     |

---

## Workflow File Format

```yaml
# review.yaml
name: code-review

agents:
  reviewer:
    model: anthropic/claude-sonnet-4-5
    system_prompt: prompts/reviewer.md

  coder:
    model: anthropic/claude-sonnet-4-5
    system_prompt: prompts/coder.md

setup:
  - shell: gh pr diff
    as: diff

kickoff: |
  PR diff:
  ${{ diff }}

  @reviewer please review these changes.
  When issues found, @coder to fix them.
```

### Context Configuration

Context is **enabled by default** with the SQLite provider.

```yaml
# Default: sqlite provider (no config needed)
agents: ...

# Explicit configuration
context:
  provider: sqlite           # Default
  documentOwner: scribe      # Optional: single-writer for documents
  config:
    db: .workflow/agent-worker.db  # Default location

# Legacy file provider
context:
  provider: file
  config:
    dir: .workflow/${{ workflow.name }}/${{ workflow.tag }}/

# Disable context
context: false
```

---

## The Three Context Layers

Agents interact with three complementary context layers:

```
┌─────────────────────────────────────────────────────────────────┐
│                     Agent Context Model                          │
│                                                                   │
│  ┌──────────────┐   ┌──────────────────┐   ┌─────────────────┐  │
│  │    INBOX     │   │     CHANNEL      │   │    DOCUMENT     │  │
│  │              │   │                  │   │                 │  │
│  │  "What's     │   │  "What happened  │   │  "What are we   │  │
│  │   for me?"   │   │   so far?"       │   │   working on?"  │  │
│  │              │   │                  │   │                 │  │
│  │  - Unread    │   │  - Full history  │   │  - Goals        │  │
│  │    @mentions │   │  - Who said what │   │  - Findings     │  │
│  │  - Priority  │   │  - Timeline      │   │  - Decisions    │  │
│  └──────────────┘   └──────────────────┘   └─────────────────┘  │
│                                                                   │
│                        Agent Work Loop                            │
│              ┌────────────────────────────────┐                  │
│              │  1. Check inbox                │                  │
│              │  2. Read channel (context)     │                  │
│              │  3. Check document (goals)     │                  │
│              │  4. Do work                    │                  │
│              │  5. Update document            │                  │
│              │  6. Send to channel            │                  │
│              └────────────────────────────────┘                  │
└─────────────────────────────────────────────────────────────────┘
```

| Layer        | Purpose                         | Persistence            |
| ------------ | ------------------------------- | ---------------------- |
| **Inbox**    | Unread @mentions for this agent | Transient (read state) |
| **Channel**  | Append-only communication log   | Permanent              |
| **Document** | Structured workspace            | Editable               |

### Why Three Layers?

- **Inbox alone is insufficient**: An agent waking up to 5 unread messages has no context about the project or methodology.
- **Channel alone is overwhelming**: Scrolling through 100 messages to find "what's for me" is inefficient.
- **Document alone is static**: Goals don't change often, but work progresses dynamically.

**Together**:

- Inbox → immediate attention
- Channel → situational awareness
- Document → strategic context

---

## Storage

Two storage subsystems with different concerns. Workers access both only through Daemon MCP tools — never directly.

### System State (SQLite)

Messages, proposals, agents, workflows — internal system state that needs ACID. Lives in a single SQLite database (`bun:sqlite`).

```
agent-worker.db
├── messages        # Channel + inbox (structured, @mention pre-parsed)
│   ├── id, sender, recipients[], content, timestamp
│   └── workflow, tag
│
├── inbox_ack       # Per-agent read cursor (separate from messages)
│   └── agent, workflow, tag, cursor
│
├── proposals       # Proposal + voting state
│   ├── id, type, status, creator
│   ├── options[], votes[], quorum
│   └── resolved_at, result
│
├── resources       # Content-addressed large content
│   └── id, workflow, tag, content, type, created_by
│
├── agents          # Registry
│   ├── name, model, backend, system_prompt
│   └── workflow, tag, state
│
├── workflows       # Workflow configs + runtime state
│   └── name, tag, config_yaml, state, created_at
│
└── daemon_state    # Daemon self-state
    └── pid, host, port, started_at, uptime
```

### Documents (Pluggable Provider)

Documents are user-facing workspace content (findings, goals, decisions). They have a separate `DocumentProvider` interface, independent from SQLite:

| Provider | Storage | Default |
|----------|---------|---------|
| **FileDocumentProvider** | `.workflow/<wf>/<tag>/documents/` | Yes — human-readable, editable by IDE, git-friendly |
| **SqliteDocumentProvider** | `documents` table in SQLite | No — optional, for ephemeral workflows |

```yaml
# Default: documents on filesystem (no config needed)
context:
  documents: file

# All-in-one: documents in SQLite
context:
  documents: sqlite
```

**Why separate?** Messages need ACID guarantees for concurrent writes. Documents need to be inspectable and editable by humans and tools outside the system. Different concerns, different storage.

### Why SQLite for System State?

- **ACID** — Two workers calling `channel_send` simultaneously is safe (WAL mode)
- **Indexed inbox** — `SELECT ... WHERE recipients LIKE '%"reviewer"%' AND cursor > ...` instead of full-text scan
- **Single file** — Easy backup/restore, crash-recovery
- **No external deps** — `bun:sqlite` is built-in

### Legacy File Layout

The previous file-based layout is retained for reference and as fallback:

```
.workflow/<workflow>/<tag>/
├── _state/                 # Internal state (system-managed)
│   ├── inbox-state.json
│   └── proposals.json
├── channel.md              # Channel: communication log
└── documents/              # Document: user workspace
```

---

## Document Ownership

Optional single-writer model for multi-agent workflows.

| Scenario              | Owner            | Behavior                   |
| --------------------- | ---------------- | -------------------------- |
| Single agent          | Self             | Ownership disabled         |
| Multiple, specified   | Configured agent | Only owner can write       |
| Multiple, unspecified | Elected via vote | Agents vote before kickoff |

Non-owners use `document_suggest` to propose changes; owner reviews and applies.

---

## Proposal & Voting System

Generic collaborative decision-making for elections, design decisions, and task assignment.

```
┌─────────────────────────────────────────────────────────────────┐
│                      Proposal Flow                               │
│                                                                  │
│  proposal_create ──► [PROPOSAL] in channel ──► Agents vote      │
│                                                      │           │
│                                               ┌──────┴──────┐   │
│                                               ▼             ▼   │
│                                           Quorum met    Timeout │
│                                               │             │   │
│                                               ▼             ▼   │
│                                         [RESOLVED]    [EXPIRED] │
│                                               │             │   │
│                                               ▼             ▼   │
│                                      Archive to       Fallback  │
│                                      decisions.md     behavior  │
└─────────────────────────────────────────────────────────────────┘
```

| Proposal Type | Use Case                           |
| ------------- | ---------------------------------- |
| `election`    | Document owner, coordinator role   |
| `decision`    | Design choices, approach selection |
| `approval`    | Merge approval, release sign-off   |
| `assignment`  | Task allocation                    |

| Resolution  | Rule            |
| ----------- | --------------- |
| `plurality` | Most votes wins |
| `majority`  | >50% required   |
| `unanimous` | All must agree  |

Binding proposals are enforced by the system. Advisory proposals rely on agent cooperation.

---

## Execution Flow

### Run Mode

```
┌─────────────────────────────────────────────────────┐
│                    run command                       │
└─────────────────────────┬───────────────────────────┘
                          │
                          ▼
┌─────────────────────────────────────────────────────┐
│   1. Execute setup (shell commands)                  │
│   2. Document owner election (if needed)            │
│   3. Send kickoff to channel                        │
│   4. Agents collaborate via @mentions               │
│   5. Exit when all idle                             │
└─────────────────────────────────────────────────────┘
```

**Idle condition**: All schedulers idle + no unread inbox + no active proposals + debounce elapsed.

### Start Mode

Same as run, but keeps running until `stop` command. Agents can continue collaborating indefinitely.

---

## CLI Commands

```bash
# One-shot execution
agent-worker run review.yaml --tag pr-123

# Persistent mode
agent-worker start review.yaml --tag pr-123 --background

# Stop agents
agent-worker stop @review:pr-123          # All agents in workflow:tag
agent-worker stop reviewer@review:pr-123  # Specific agent

# List running agents
agent-worker ls                  # Global workflow (default)
agent-worker ls @review:pr-123   # Specific workflow:tag

# Send messages
agent-worker send coder@review:pr-123 "fix the bug"
agent-worker send @review:pr-123 "@all sync up"

# Schedule commands
agent-worker schedule alice set 30s                   # alice@global:main
agent-worker schedule reviewer@review set 5m          # reviewer@review:main
agent-worker schedule reviewer@review:pr-123 set 30s  # Full specification
agent-worker schedule @review:pr-123 set 1h           # Workflow-level default
```

### Target Syntax

Full syntax: `agent@workflow:tag`

| Pattern                | Internal              | Display               | Meaning                          |
| ---------------------- | --------------------- | --------------------- | -------------------------------- |
| `alice`                | `alice@global:main`   | `alice`               | Standalone agent (global space)  |
| `alice@review`         | `alice@review:main`   | `alice@review`        | Agent in review workflow         |
| `alice@review:pr-123`  | `alice@review:pr-123` | `alice@review:pr-123` | Full specification               |
| `@review`              | `@review:main`        | `@review`             | Workflow (default tag)           |
| `@review:pr-123`       | `@review:pr-123`      | `@review:pr-123`      | Workflow:tag (full specification)|

**Display rules**:
- Omit `@global` for standalone agents (show `alice`, not `alice@global`)
- Omit `:main` tag when it's the default (show `alice@review`, not `alice@review:main`)

---

## Examples

### Simple Review

```yaml
name: review

agents:
  reviewer:
    model: anthropic/claude-sonnet-4-5
    system_prompt: prompts/reviewer.md

setup:
  - shell: gh pr diff
    as: diff

kickoff: |
  Please review this PR:
  ${{ diff }}
  @reviewer
```

### Multi-Agent Collaboration

```yaml
name: code-review

agents:
  coordinator:
    model: anthropic/claude-sonnet-4-5
    system_prompt: prompts/coordinator.md

  reviewer:
    model: anthropic/claude-sonnet-4-5
    system_prompt: prompts/reviewer.md

  coder:
    model: anthropic/claude-sonnet-4-5
    system_prompt: prompts/coder.md

context:
  documentOwner: coordinator

setup:
  - shell: gh pr view --json title,body,files
    as: pr_info

kickoff: |
  New PR to review:
  ${{ pr_info }}

  @coordinator please orchestrate.
```

---

## Design Decisions

### 1. Why Kickoff Model?

Declarative, not procedural. Describe the goal and let agents coordinate autonomously.

**Alternative considered**: Task sequences (`tasks: [task1, task2]`)
**Why rejected**: Rigid execution order prevents autonomous collaboration.

### 2. Why Separate Channel and Document?

- **Channel** = communication (who said what, when)
- **Document** = workspace (current state, findings)

Combining them would mix transient messages with persistent content.

### 3. Why Default Context Enabled?

Most workflows benefit from shared context. The minimal useful config is just `agents:`.

### 4. Why @mention for Coordination?

Familiar pattern from team chat. Natural language, no special syntax beyond `@name`.

### 5. Why Run vs Start?

- **Run**: CI/CD, one-off tasks, scripts
- **Start**: Long-running services, interactive work

No need for explicit completion config—the command choice determines behavior.

### 6. Why Inbox Explicit Acknowledgment?

The daemon scheduler acknowledges inbox **only on successful worker execution**. This enables:

- Retry on failure (messages redelivered)
- Exactly-once processing guarantee

### 7. Why Document Ownership?

Prevents concurrent write conflicts in multi-agent workflows. Single-writer model with suggestions from non-owners.

**When to use**: 3+ agents, document consistency matters.
**When NOT to use**: Simple workflows, speed over consistency.

### 8. Why SQLite Over Files?

File-based storage (channel.md + inbox-state.json) worked for prototyping. For a kernel managing concurrent workers:

- Concurrent `channel_send` from two workers → file corruption risk. SQLite WAL mode → safe.
- Inbox check = scan entire channel.md + regex parse @mentions + compare JSON state. SQLite → indexed query.
- State scattered across markdown, JSON, directories. SQLite → single file, ACID, crash-recovery.

Human readability loss is acceptable — workers access context via Daemon MCP, users via CLI. Neither depends on file format.

### 9. Why Parse @mentions at Write Time?

Read-time parsing means every inbox check re-parses the full message history. Write-time parsing: done once by daemon, stored as structured data. One source of truth for @mention rules, not N readers each parsing differently.

### 10. Why Subprocess Workers?

In-process workers (current `LocalWorker`) share daemon memory. Worker OOM can kill daemon. Child processes provide:

- **Isolation**: crash → daemon receives exit event, reschedules
- **Heterogeneity**: spawn Claude CLI, Codex, any executable — not limited to daemon's runtime
- **Same interface**: worker only knows "I have an MCP server URL". `WorkerBackend` interface unchanged.

---

## Daemon Scheduling (Controller)

The daemon owns all scheduling decisions. For each agent in a workflow, the daemon runs a scheduling loop (currently implemented as `AgentController`) that decides **when** to invoke the worker and **what to do** with the results.

This is a daemon concern, not a worker concern. The worker is a pure execution unit — `f(prompt, tools) → result` — and knows nothing about polling, retry, or inbox.

```
┌─────────────────────────────────────────────────────────────┐
│                    Daemon Workflow                            │
│                                                              │
│  For each agent:                                            │
│  ┌─────────────────────────────────────────────────────┐   │
│  │         Scheduler (daemon concern)                   │   │
│  │                                                      │   │
│  │  State: idle | running | stopped                    │   │
│  │                                                      │   │
│  │  ┌────────────────────────────────────────────────┐ │   │
│  │  │                   IDLE                         │ │   │
│  │  │  - Polling inbox every N seconds               │ │   │
│  │  │  - Or: wake() called on @mention               │ │   │
│  │  │  - Or: cron/interval schedule fires            │ │   │
│  │  └─────────────────────┬──────────────────────────┘ │   │
│  │                        │ trigger?                    │   │
│  │                        ▼                             │   │
│  │  ┌────────────────────────────────────────────────┐ │   │
│  │  │                  RUNNING                       │ │   │
│  │  │  - Invoke worker (backend-specific)            │ │   │
│  │  │  - Worker connects to Daemon MCP for context   │ │   │
│  │  │  - Worker uses own MCP for task tools          │ │   │
│  │  │  - Retry on failure (exponential backoff)      │ │   │
│  │  └─────────────────────┬──────────────────────────┘ │   │
│  │                        │ success → ack inbox         │   │
│  │                        ▼                             │   │
│  │                   back to IDLE                       │   │
│  └─────────────────────────────────────────────────────┘   │
│                                                              │
│  @mention → scheduler.wake()                                │
└─────────────────────────────────────────────────────────────┘
```

### Context Access via Daemon MCP

Workers access context (channel, inbox, documents) through MCP tools provided by the daemon. The daemon starts an MCP server per workflow; workers connect to it.

```
✗  Daemon assembles context → injects into prompt → passes to worker
✓  Daemon starts MCP server → worker connects → calls tools on demand
```

This enforces sandboxing: a worker can only do what its tools allow.

### Two Kinds of MCP

| MCP | Held by | Purpose | Analogy |
|-----|---------|---------|---------|
| **Daemon MCP** | Daemon | Context tools (channel_send, inbox_read, document_write, ...) | syscall interface |
| **Worker MCP** | Worker | Task tools (bash, file ops, custom MCP servers) | process libraries |

### Backend Support

| Backend         | Integration                        |
| --------------- | ---------------------------------- |
| SDK (Anthropic) | Direct API, full MCP client        |
| Claude CLI      | `--mcp-config` flag                |
| Codex CLI       | Project-level `.codex/config.toml` |
| Cursor Agent    | Project-level `.cursor/mcp.json`   |

---

## Variable Interpolation

```yaml
setup:
  - shell: gh pr diff
    as: diff

kickoff: |
  ${{ diff }}           # Setup output
  ${{ env.API_KEY }}    # Environment variable
  ${{ workflow.name }}  # Workflow metadata
```

---

## References

- [REFERENCE.md](./REFERENCE.md) - MCP tools, controller loop, prompt structure
- [TODO.md](./TODO.md) - Implementation progress
- [../backends.md](../backends.md) - Backend feature matrix and CLI details
