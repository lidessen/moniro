---
name: agent-worker
description: Create and manage AI agent sessions with multiple backends (SDK, Claude CLI, Codex, Cursor). Also supports multi-agent workflows with shared context, @mention coordination, and collaborative voting. Use for "start agent session", "create worker", "run agent", "multi-agent workflow", "agent collaboration", "test with tools", or when orchestrating AI conversations programmatically.
---

# Agent Worker

## Who You Are

You build AI-powered workflows. You want programmatic control over AI conversations—single-agent or multi-agent collaboration.

**One model**: Every agent belongs to a **workflow** (namespace). Agents in the same workflow share a channel (for communication) and documents (for shared state). The default workflow is `default`.

- `agent-worker new` creates an agent in the default workflow
- `agent-worker run workflow.yaml` creates agents from YAML in a named workflow
- Both are the same thing: agents in workflows, sharing context

You're here to create agents, send messages, orchestrate workflows—all from the command line.

---

## Quick Start

```bash
# Create an agent (auto-named: a0, a1, ...)
agent-worker new
# → a0

# Create with explicit name
agent-worker new reviewer -m anthropic/claude-sonnet-4-5

# Send a message via channel (@mention to route)
agent-worker send "@a0 What is 2+2?"

# Check the response
agent-worker peek

# Create a second agent — shares channel with a0
agent-worker new coder

# They can now communicate
agent-worker send "@reviewer review the code, then @coder fix issues"

# Stop agents
agent-worker stop --all
```

That's it. Agents share context automatically within a workflow.

---

## Core Concepts

### Workflow = Namespace

Every agent belongs to a workflow. Agents in the same workflow share:
- **Channel**: Communication via @mentions
- **Documents**: Shared workspace

```bash
# Default workflow
agent-worker new reviewer              # → reviewer (in default workflow)
agent-worker new coder                  # → coder (in default workflow, shares channel)

# Named workflow
agent-worker new reviewer -w pr-123
agent-worker new coder -w pr-123

# List agents (grouped by workflow)
agent-worker ls
agent-worker ls -w pr-123
```

### @Mention Routing

All communication goes through the channel. Use `@agent` to route messages:

```bash
agent-worker send "@reviewer please review this code"
agent-worker send "@reviewer @coder collaborate on this"
agent-worker send "status update for everyone"           # broadcast (no @mention)
```

---

## Choosing a Backend

| Backend | Best For | Model Selection |
|---------|----------|-----------------|
| `sdk` (default) | Full control, tool injection, mocking | `-m provider/model` |
| `claude` | Use existing Claude CLI installation | CLI's own model |
| `codex` | OpenAI Codex workflows | CLI's own model |
| `cursor` | Cursor Agent integration | CLI's own model |

```bash
# Check what's available
agent-worker backends

# SDK backend with specific model
agent-worker new -m openai/gpt-5.2

# CLI backends
agent-worker new -b claude
agent-worker new -b codex
agent-worker new -b cursor
```

**Important Notes**:
- Tool management (add, mock, import) only works with SDK backend
- Claude CLI backend may not work properly within Claude Code environment (use SDK backend)

---

## Agent Management

### Creating Agents

```bash
# Auto-name (a0, a1, ..., z9)
agent-worker new

# Named
agent-worker new reviewer

# With custom system prompt
agent-worker new reviewer -s "You are a code reviewer."

# From file
agent-worker new reviewer -f ./prompts/reviewer.txt

# In named workflow
agent-worker new reviewer -w pr-123

# Custom idle timeout (ms, 0 = no timeout)
agent-worker new --idle-timeout 3600000

# With scheduled wakeup
agent-worker new --wakeup 5m
agent-worker new --wakeup "0 */2 * * *"
```

### Lifecycle

```bash
# List all agents
agent-worker ls

# Check status
agent-worker status reviewer

# Set default agent (for stats/export/clear)
agent-worker use reviewer

# Stop
agent-worker stop reviewer
agent-worker stop -w pr-123
agent-worker stop --all
```

---

## Messaging

### Send (Channel-based)

```bash
# Route to specific agent
agent-worker send "@reviewer check this code"

# Route to multiple agents
agent-worker send "@reviewer @coder collaborate on this fix"

# Broadcast (no @mention)
agent-worker send "status update"

# Target different workflow
agent-worker send -w pr-123 "@reviewer check this"
```

### Peek (Read Channel)

```bash
# Last 10 messages (default)
agent-worker peek

# Last 5
agent-worker peek -n 5

# All messages
agent-worker peek --all

# Search
agent-worker peek --find "error"

# Different workflow
agent-worker peek -w pr-123
```

### Agent-level Operations

```bash
# Token/message statistics
agent-worker stats reviewer

# Export full transcript
agent-worker export reviewer > transcript.json

# Clear agent conversation history
agent-worker clear reviewer
```

---

## Tool Management (SDK Backend Only)

### Adding Tools

```bash
# Simple tool
agent-worker tool add get_weather \
  -d "Get weather for a location" \
  -p "location:string:City name"

# With approval requirement
agent-worker tool add delete_file \
  -d "Delete a file" \
  -p "path:string:File path" \
  --needs-approval
```

### Importing Tools from File

```typescript
// my-tools.ts
export default [
  {
    name: 'search_docs',
    description: 'Search documentation',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Search query' }
      },
      required: ['query']
    },
    execute: async (args) => {
      return { results: ['doc1', 'doc2'] }
    }
  }
]
```

```bash
agent-worker tool import ./my-tools.ts
```

### Mocking Tools

```bash
agent-worker tool mock get_weather '{"temp": 72, "condition": "sunny"}'
agent-worker tool list
```

---

## Approval Workflow

For tools marked `needsApproval`:

```bash
agent-worker send "@a0 Delete /tmp/test.txt"
agent-worker pending
agent-worker approve <approval-id>
agent-worker deny <approval-id> -r "Path not allowed"
```

---

## Model Formats

SDK backend supports multiple formats:

```bash
# Gateway format (recommended)
agent-worker new -m openai/gpt-5.2
agent-worker new -m anthropic/claude-sonnet-4-5

# Provider-only (uses provider's frontier model)
agent-worker new -m openai
agent-worker new -m anthropic

# Direct provider format
agent-worker new -m deepseek:deepseek-chat
```

Check available providers:
```bash
agent-worker providers
```

---

## Scheduled Wakeup

| Mode | Format | Behavior |
|------|--------|----------|
| **Interval** | `60000`, `30s`, `5m`, `2h` | Fires after idle. Resets on activity. |
| **Cron** | `0 */2 * * *` | Fixed schedule. NOT reset by activity. |

```bash
# At creation
agent-worker new --wakeup 5m
agent-worker new --wakeup "0 */2 * * *" --wakeup-prompt "Check for new tasks"

# Runtime management
agent-worker schedule set 5m
agent-worker schedule set "0 */2 * * *" -p "Run health check"
agent-worker schedule get
agent-worker schedule clear
```

---

## Multi-Agent Workflows (YAML)

For complex tasks requiring multiple specialized agents:

```yaml
# review.yaml
agents:
  reviewer:
    model: anthropic/claude-sonnet-4-5
    system_prompt: You review code for quality.
  coder:
    model: anthropic/claude-sonnet-4-5
    system_prompt: You fix issues found by reviewers.

setup:
  - shell: gh pr diff
    as: diff

kickoff: |
  ${{ diff }}
  @reviewer please review. When issues found, @coder to fix.
```

```bash
# Run workflow (exits when complete)
agent-worker run review.yaml

# Or keep running
agent-worker start review.yaml

# Named workflow
agent-worker run review.yaml -w pr-123
```

### Shared Context

Agents collaborate through two spaces:

| Space | Purpose | Tools |
|-------|---------|-------|
| **Channel** | Communication (@mentions) | `channel_send`, `channel_read`, `inbox_read` |
| **Document** | Shared workspace | `document_read`, `document_write`, `document_append` |

### Proposal & Voting

For collaborative decisions:

```bash
# In agent's tool calls:
proposal_create  # Create election/decision/approval
vote             # Cast vote on proposal
proposal_status  # Check results
```

Resolution types: `plurality`, `majority`, `unanimous`. Quorum defaults to all agents.

See [reference/workflow.md](reference/workflow.md) for full configuration.

---

## Programmatic Usage

```typescript
import { AgentSession } from 'agent-worker'

const session = new AgentSession({
  model: 'anthropic/claude-sonnet-4-5',
  system: 'You are a helpful assistant.',
  tools: [/* your tools */]
})

const response = await session.send('Hello')
console.log(response.content)
console.log(response.toolCalls)
console.log(response.usage)

for await (const chunk of session.sendStream('Tell me a story')) {
  process.stdout.write(chunk)
}

const state = session.getState()
```

---

## Troubleshooting

| Issue | Solution |
|-------|----------|
| "No active agent" | Run `agent-worker new` first |
| "Agent not found" | Check `agent-worker ls` |
| "Tool management not supported" | Use SDK backend (`-b sdk` or omit `-b`) |
| "Provider not loaded" | Check API key with `agent-worker providers` |
| Agent not responding | Check if process alive: `agent-worker status` |
| No response in peek | Agent may still be processing. Wait and `peek` again. |

---

## Command Reference

```
agent-worker new [name]      Create agent (auto-names if omitted: a0, a1, ...)
  -w, --workflow <name>      Workflow namespace
agent-worker ls              List all agents (grouped by workflow)
  -w, --workflow <name>      Filter by workflow
agent-worker status [target] Check agent status
agent-worker use <target>    Set default agent
agent-worker stop [target]   Stop agent(s)
  --all                      Stop all agents
  -w, --workflow <name>      Stop all in workflow

agent-worker send <message>  Send to channel (@mention to route)
  -w, --workflow <name>      Target workflow
agent-worker peek            View channel (default: last 10)
  -w, --workflow <name>      Target workflow
  --all                      Show all messages
  -n, --last <count>         Show last N messages
  --find <text>              Search messages
agent-worker stats [target]  Show agent statistics
agent-worker export [target] Export transcript
agent-worker clear [target]  Clear agent history

agent-worker tool add        Add tool (SDK only)
agent-worker tool import     Import from file
agent-worker tool mock       Set mock response
agent-worker tool list       List tools

agent-worker pending         List pending approvals
agent-worker approve         Approve tool call
agent-worker deny            Deny tool call

agent-worker schedule set    Set wakeup schedule
agent-worker schedule get    View current schedule
agent-worker schedule clear  Remove wakeup schedule

agent-worker run <file>      Run YAML workflow (exit on complete)
  -w, --workflow <name>      Workflow name
agent-worker start <file>    Start YAML workflow (keep running)
  -w, --workflow <name>      Workflow name

agent-worker providers       Check SDK providers
agent-worker backends        Check available backends
```

---

## Remember

agent-worker is about **programmatic control** over AI conversations.

- **Workflow (`-w`)**: Namespace for agents sharing context
- **Channel**: @mention-based communication
- **Backends**: SDK, Claude, Codex, Cursor
- **YAML or manual**: Same model — agents in workflows, sharing context
