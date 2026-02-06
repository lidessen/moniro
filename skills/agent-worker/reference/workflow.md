# Workflow Configuration Reference

## Table of Contents

- [Workflow Schema](#workflow-schema)
- [Agent Configuration](#agent-configuration)
- [Context Configuration](#context-configuration)
- [Setup Phase](#setup-phase)
- [Variable Interpolation](#variable-interpolation)
- [Execution Modes](#execution-modes)
- [MCP Tools](#mcp-tools)
- [Proposal & Voting](#proposal--voting)

---

## Workflow Schema

```yaml
# Required
agents:
  agent_name:
    model: provider/model           # Required
    system_prompt: string | path    # Required

# Optional
context:
  provider: file | memory           # Default: file
  config:
    dir: ./path/                    # Default: .workflow/{instance}/
    channel: channel.md             # Default
    document: document.md           # Default

setup:
  - shell: command
    as: variable_name

kickoff: |
  Message with ${{ variables }}
  @agent to trigger
```

---

## Agent Configuration

```yaml
agents:
  reviewer:
    model: anthropic/claude-sonnet-4-5
    system_prompt: You review code for quality and security.

  coder:
    model: openai/gpt-5.2
    system_prompt: prompts/coder.md   # Load from file
```

**Model formats**:
- Gateway: `provider/model` (recommended)
- Provider-only: `anthropic` (uses frontier model)
- Direct: `provider:model`

---

## Context Configuration

### File Provider (default)

```yaml
context:
  provider: file
  config:
    dir: .workflow/my-instance/
    channel: discussion.md
    document: workspace.md
```

Persistent across restarts. Files created at `{dir}/{channel}` and `{dir}/{document}`.

### Memory Provider

```yaml
context:
  provider: memory
```

Ephemeral. Useful for testing.

### Disable Context

```yaml
context: false
```

---

## Setup Phase

Runs **before** agents start. Captures output as variables.

```yaml
setup:
  - shell: gh pr diff
    as: diff

  - shell: date +%Y-%m-%d
    as: today

  - shell: cat config.json
    as: config
```

All commands run in parallel by default.

---

## Variable Interpolation

```yaml
kickoff: |
  Date: ${{ today }}
  Config: ${{ config }}

  Environment: ${{ env.NODE_ENV }}
  Workflow: ${{ workflow.name }}
  Instance: ${{ workflow.instance }}
```

**Reserved variables**:
- `${{ env.VAR }}` - Environment variables
- `${{ workflow.name }}` - Workflow file name
- `${{ workflow.instance }}` - Instance ID

---

## Execution Modes

### Run Mode

```bash
agent-worker run workflow.yaml
agent-worker run workflow.yaml --instance pr-123
```

- Executes kickoff message
- Monitors until idle (no pending work)
- Exits automatically

### Start Mode

```bash
agent-worker start workflow.yaml
agent-worker start workflow.yaml --background
```

- Executes kickoff message
- Keeps running until `Ctrl+C` or `agent-worker stop`
- `--background` detaches from terminal

### Stopping

```bash
agent-worker stop workflow.yaml
agent-worker stop --all
```

---

## MCP Tools

Agents receive these tools via MCP:

### Channel Tools

| Tool | Description |
|------|-------------|
| `channel_send` | Post message to channel (supports @mentions) |
| `channel_read` | Read channel history |
| `inbox_read` | Read messages directed to this agent |
| `inbox_ack` | Acknowledge processed messages |

### Document Tools

| Tool | Description |
|------|-------------|
| `document_read` | Read document content |
| `document_write` | Replace document content |
| `document_append` | Append to document |
| `document_list` | List document files |
| `document_create` | Create new document file |

### Workflow Tools

| Tool | Description |
|------|-------------|
| `workflow_agents` | List all agents in workflow |

---

## Proposal & Voting

For collaborative decision-making between agents.

### Creating Proposals

```typescript
// Via MCP tool call
proposal_create({
  type: 'decision',        // election | decision | approval | assignment
  title: 'Choose database',
  options: [
    { id: 'postgres', label: 'PostgreSQL' },
    { id: 'mysql', label: 'MySQL' }
  ],
  resolution: {
    type: 'plurality',     // plurality | majority | unanimous
    quorum: 2,             // Optional, defaults to all agents
    tieBreaker: 'first'    // first | random | creator-decides
  }
})
```

### Voting

```typescript
vote({
  proposal: 'prop-1',
  choice: 'postgres',
  reason: 'Better JSON support'  // Optional
})
```

### Checking Status

```typescript
proposal_status({ proposal: 'prop-1' })
// or
proposal_status({})  // All active proposals
```

### Resolution Types

| Type | Requirement |
|------|-------------|
| `plurality` | Most votes wins (quorum required) |
| `majority` | >50% of votes cast |
| `unanimous` | All votes same option |

### Lifecycle

```
active → resolved (quorum met)
       → expired (timeout, still picks winner if votes exist)
       → cancelled (creator cancelled)
```

---

## Use Cases

### Code Review

```yaml
agents:
  security:
    model: anthropic/claude-sonnet-4-5
    system_prompt: Focus on security vulnerabilities
  performance:
    model: anthropic/claude-sonnet-4-5
    system_prompt: Focus on performance bottlenecks
  synthesizer:
    model: anthropic/claude-sonnet-4-5
    system_prompt: Combine findings into report

kickoff: |
  @security @performance review the PR
  When done, @synthesizer create final report
```

### Design Decision

```yaml
agents:
  alice:
    model: anthropic/claude-sonnet-4-5
    system_prompt: You advocate for TypeScript
  bob:
    model: anthropic/claude-sonnet-4-5
    system_prompt: You advocate for Rust
  moderator:
    model: anthropic/claude-sonnet-4-5
    system_prompt: You facilitate decisions via voting

kickoff: |
  Topic: Which language for the new service?
  @alice @bob present your cases
  @moderator create a proposal when ready
```

### Parallel Investigation

```yaml
agents:
  hypothesis_a:
    model: anthropic/claude-sonnet-4-5
    system_prompt: Investigate memory leaks
  hypothesis_b:
    model: anthropic/claude-sonnet-4-5
    system_prompt: Investigate race conditions

kickoff: |
  Bug: App crashes after 24h
  @hypothesis_a @hypothesis_b investigate
  Share findings in channel
```
