# Agent Worker Workflow Design

Multi-agent orchestration with shared context and @mention-driven collaboration.

**Related documents:**
- [REFERENCE.md](./REFERENCE.md) - Implementation details, interfaces, code examples
- [TODO.md](./TODO.md) - Implementation plan and progress

---

## Overview

Agent Worker enables multiple AI agents to collaborate on tasks through a shared communication channel and workspace. Agents coordinate via @mentions, similar to team chat.

### Key Concepts

| Concept | Description |
|---------|-------------|
| **Unified Naming** | `agent-name` (standalone) or `agent-name@instance` (workflow) |
| **Shared Context** | Channel (communication) + Document (workspace) |
| **Kickoff Model** | Natural language workflow initiation via @mentions |
| **Two Modes** | `run` (one-shot) and `start` (persistent) |

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

Context is **enabled by default** with the file provider.

```yaml
# Default: file provider (no config needed)
agents: ...

# Explicit configuration
context:
  provider: file
  documentOwner: scribe  # Optional: single-writer for documents
  config:
    dir: .workflow/${{ instance }}/

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

| Layer | Purpose | Persistence |
|-------|---------|-------------|
| **Inbox** | Unread @mentions for this agent | Transient (read state) |
| **Channel** | Append-only communication log | Permanent |
| **Document** | Structured workspace | Editable |

### Why Three Layers?

- **Inbox alone is insufficient**: An agent waking up to 5 unread messages has no context about the project or methodology.
- **Channel alone is overwhelming**: Scrolling through 100 messages to find "what's for me" is inefficient.
- **Document alone is static**: Goals don't change often, but work progresses dynamically.

**Together**:
- Inbox → immediate attention
- Channel → situational awareness
- Document → strategic context

---

## File-Based Storage Structure

Channel and Document are two **independent** systems:

```
.workflow/instance/
├── _state/                 # Internal state (system-managed)
│   ├── inbox-state.json
│   └── proposals.json
├── channel.md              # Channel: communication log
└── documents/              # Document: user workspace
    ├── notes.md            # Entry point
    ├── goals.md
    ├── findings/
    │   └── auth-issues.md
    └── decisions.md        # Decision archive
```

---

## Document Ownership

Optional single-writer model for multi-agent workflows.

| Scenario | Owner | Behavior |
|----------|-------|----------|
| Single agent | Self | Ownership disabled |
| Multiple, specified | Configured agent | Only owner can write |
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

| Proposal Type | Use Case |
|---------------|----------|
| `election` | Document owner, coordinator role |
| `decision` | Design choices, approach selection |
| `approval` | Merge approval, release sign-off |
| `assignment` | Task allocation |

| Resolution | Rule |
|------------|------|
| `plurality` | Most votes wins |
| `majority` | >50% required |
| `unanimous` | All must agree |

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

**Idle condition**: All controllers idle + no unread inbox + no active proposals + debounce elapsed.

### Start Mode

Same as run, but keeps running until `stop` command. Agents can continue collaborating indefinitely.

---

## CLI Commands

```bash
# One-shot execution
agent-worker run review.yaml --instance pr-123

# Persistent mode
agent-worker start review.yaml --background

# Stop agents
agent-worker stop @pr-123           # All agents in instance
agent-worker stop reviewer@pr-123   # Specific agent

# List running agents
agent-worker list

# Send messages
agent-worker send "fix the bug" --to coder@pr-123
agent-worker send "@all sync up" --to @pr-123
```

### Send Target Patterns

| Pattern | Target | Effect |
|---------|--------|--------|
| `--to agent` | Standalone | Direct to inbox |
| `--to agent@instance` | Workflow agent | Channel + @mention |
| `--to @instance` | Workflow channel | Broadcast |

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

Controller acknowledges inbox **only on successful agent run**. This enables:
- Retry on failure (messages redelivered)
- Exactly-once processing guarantee

### 7. Why Document Ownership?

Prevents concurrent write conflicts in multi-agent workflows. Single-writer model with suggestions from non-owners.

**When to use**: 3+ agents, document consistency matters.
**When NOT to use**: Simple workflows, speed over consistency.

---

## Agent Controller Design

```
┌─────────────────────────────────────────────────────────────┐
│                    Workflow Runner                           │
│                                                              │
│  For each agent:                                            │
│  ┌─────────────────────────────────────────────────────┐   │
│  │              Agent Controller                        │   │
│  │                                                      │   │
│  │  State: idle | running | stopped                    │   │
│  │                                                      │   │
│  │  ┌────────────────────────────────────────────────┐ │   │
│  │  │                   IDLE                         │ │   │
│  │  │  - Polling inbox every N seconds               │ │   │
│  │  │  - Or: wake() called on @mention               │ │   │
│  │  └─────────────────────┬──────────────────────────┘ │   │
│  │                        │ unread?                     │   │
│  │                        ▼                             │   │
│  │  ┌────────────────────────────────────────────────┐ │   │
│  │  │                  RUNNING                       │ │   │
│  │  │  - Spawn agent (backend-specific)              │ │   │
│  │  │  - Agent uses MCP tools                        │ │   │
│  │  │  - Retry on failure (exponential backoff)      │ │   │
│  │  └─────────────────────┬──────────────────────────┘ │   │
│  │                        │ success → ack inbox         │   │
│  │                        ▼                             │   │
│  │                   back to IDLE                       │   │
│  └─────────────────────────────────────────────────────┘   │
│                                                              │
│  @mention → controller.wake()                               │
└─────────────────────────────────────────────────────────────┘
```

### Backend Support

| Backend | Integration |
|---------|-------------|
| SDK (Anthropic) | Direct API, full MCP client |
| Claude CLI | `--mcp-config` flag |
| Codex CLI | Project-level `.codex/config.toml` |
| Cursor Agent | Project-level `.cursor/mcp.json` |

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

- [REFERENCE.md](./REFERENCE.md) - Interfaces, types, implementation code
- [TODO.md](./TODO.md) - Implementation tasks and progress
- [Docker Compose](https://docs.docker.com/compose/) - Service orchestration inspiration
- [Slack API](https://api.slack.com/) - Channel/mention model
