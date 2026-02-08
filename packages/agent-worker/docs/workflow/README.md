# Agent Worker Workflow

> Multi-agent orchestration with shared context and @mention-driven collaboration.

## What is this?

Agent Worker Workflow enables multiple AI agents to work together on complex tasks. Instead of a single agent handling everything, you define specialized agents that collaborate through a shared communication channel and workspace.

```yaml
# review.yaml
agents:
  reviewer:
    model: anthropic/claude-sonnet-4-5
    system_prompt: You review code for quality and security.

  coder:
    model: anthropic/claude-sonnet-4-5
    system_prompt: You fix issues found by reviewers.

setup:
  - shell: gh pr diff
    as: diff

kickoff: |
  PR diff:
  ${{ diff }}

  @reviewer please review these changes.
  When issues found, @coder to fix them.
```

Run it:

```bash
agent-worker run review.yaml
```

The workflow orchestrates agents autonomously—`@reviewer` analyzes the PR, mentions `@coder` when issues are found, and they collaborate until the work is complete.

## How It Works

### 1. Shared Context

All agents share two spaces:

| Space        | Purpose       | Format                              |
| ------------ | ------------- | ----------------------------------- |
| **Channel**  | Communication | Append-only timeline with @mentions |
| **Document** | Workspace     | Editable shared notes and findings  |

```
┌─────────────────────────────────────────────────────────────┐
│                    Shared Context                           │
│                                                             │
│  Channel (channel.md)          Document (notes.md)          │
│  ┌─────────────────────┐       ┌─────────────────────┐     │
│  │ [10:00] orchestrator│       │ # Review Notes      │     │
│  │ PR diff: ...        │       │                     │     │
│  │ @reviewer please... │       │ ## Issues Found     │     │
│  │                     │       │ 1. Auth validation  │     │
│  │ [10:05] reviewer    │       │ 2. N+1 query        │     │
│  │ Found issues:       │       │                     │     │
│  │ @coder please fix   │       │ ## Decisions        │     │
│  │                     │       │ - Use zod           │     │
│  │ [10:10] coder       │       │                     │     │
│  │ Fixed. @reviewer    │       │                     │     │
│  │ please verify       │       │                     │     │
│  └─────────────────────┘       └─────────────────────┘     │
└─────────────────────────────────────────────────────────────┘
```

### 2. @Mention System

Agents trigger each other through natural `@mentions` in the channel:

```
reviewer writes: "@coder please fix the auth issue in line 42"
                     │
                     ▼
              ┌──────────────┐
              │ System parses │
              │   @coder      │
              └──────┬───────┘
                     │
                     ▼
              ┌──────────────┐
              │ coder gets   │
              │ notification │
              └──────────────┘
```

No explicit task assignment. No rigid workflows. Agents coordinate through conversation, just like human teams.

### 3. MCP-Based Architecture

Context is provided to agents via [Model Context Protocol](https://modelcontextprotocol.io/), enabling:

- **Backend-agnostic**: Works with Claude CLI, Codex, Cursor, SDK, or any MCP-compatible agent
- **Standard tools**: `channel_send`, `channel_read`, `document_read`, `document_write`
- **Real-time notifications**: Agents receive @mention alerts instantly

```
┌───────────────────────────────────────────────────────────────┐
│                      Workflow Runner                           │
│                                                                │
│  ┌──────────────────────────────────────────────────────────┐ │
│  │           Context MCP Server (Unix Socket)                │ │
│  └────────────────────────┬─────────────────────────────────┘ │
│                           │                                   │
└───────────────────────────┼───────────────────────────────────┘
                            │ MCP
        ┌───────────────────┼───────────────────┐
        ▼         ▼         ▼         ▼         ▼
   ┌────────┐ ┌────────┐ ┌────────┐ ┌────────┐ ┌────────┐
   │ Agent  │ │ Agent  │ │ Agent  │ │ Agent  │ │ Agent  │
   │ (SDK)  │ │(Claude)│ │(Codex) │ │(Cursor)│ │ (CLI)  │
   └────────┘ └────────┘ └────────┘ └────────┘ └────────┘
```

### 4. Setup + Kickoff Model

Workflows are **declarative**, not procedural:

```yaml
# Setup: prepare variables (runs before agents start)
setup:
  - shell: gh pr view --json title,body,files
    as: pr_info

# Kickoff: describe the goal and let agents coordinate
kickoff: |
  New PR to review:
  ${{ pr_info }}

  @coordinator please orchestrate the review.
```

The kickoff message describes **what** needs to happen. Agents decide **how** to collaborate.

## Key Features

### Context Providers

Pluggable storage backends:

```yaml
# Default: file provider (persistent, survives restarts)
# No config needed - enabled automatically

# Custom file paths
context:
  provider: file
  config:
    dir: ./my-context/
    channel: discussion.md
    document: workspace.md

# Memory provider (ephemeral, for testing)
context:
  provider: memory

# Disable context
context: false
```

### Workflow Isolation

Run multiple workflows in parallel:

```bash
agent-worker run review.yaml -w pr-123
agent-worker run review.yaml -w pr-456
```

Each workflow has isolated context at `.workflow/{workflow-name}/`.

### Two Execution Modes

| Mode      | Command              | Behavior                            |
| --------- | -------------------- | ----------------------------------- |
| **Run**   | `agent-worker run`   | Execute and exit when complete      |
| **Start** | `agent-worker start` | Keep running until manually stopped |

### Variable Interpolation

```yaml
setup:
  - shell: gh pr diff
    as: diff
  - shell: date +%Y-%m-%d
    as: today

kickoff: |
  Date: ${{ today }}
  ${{ diff }}

  @reviewer please analyze
```

Reserved variables: `${{ env.VAR }}`, `${{ workflow.name }}`

## Comparison with Claude Agent Teams

Claude recently released [Agent Teams](https://code.claude.com/docs/en/agent-teams), a similar concept. Here's how they compare:

| Aspect                    | Agent Worker Workflow           | Claude Agent Teams                  |
| ------------------------- | ------------------------------- | ----------------------------------- |
| **Coordination**          | @mention in shared channel      | Mailbox messaging system            |
| **Context**               | Channel + Document (persistent) | Task list only                      |
| **Session resumption**    | ✓ File-based context survives   | ✗ In-process teammates can't resume |
| **Backend support**       | Any MCP-compatible agent        | Claude Code only                    |
| **Terminal requirements** | None                            | tmux/iTerm2 for split panes         |
| **Parallel workflows**    | ✓ Workflow-based isolation      | ✗ One team per session              |
| **Configuration**         | YAML workflow files             | Natural language prompts            |

### Why We Think Our Design is Better

**1. Protocol-based, not product-bound**

Agent Teams only works within Claude Code. Our design uses MCP, an open protocol. Today it works with Claude, Codex, Cursor. Tomorrow it works with any agent that implements MCP. No vendor lock-in.

**2. Persistent shared context**

Agent Teams uses ephemeral mailboxes and task lists. Our Channel + Document model creates a persistent record of collaboration:

- **Channel**: Complete communication history (who said what, when)
- **Document**: Evolving shared workspace (current findings, decisions)

This context survives session restarts. Resume a workflow and agents pick up where they left off.

**3. Natural coordination through @mentions**

Agent Teams requires explicit message routing and task assignment. Our @mention system mirrors how humans collaborate in Slack or GitHub:

```
@reviewer please check the auth changes
@coder the validation is missing, can you fix?
@coordinator we're blocked on the API schema
```

No task management overhead. Agents trigger each other through conversation.

**4. Declarative workflows**

Agent Teams relies on natural language prompts to define team structure. Our YAML workflows are:

- **Reproducible**: Same file, same behavior
- **Version-controlled**: Track changes in git
- **Composable**: Import and extend workflows

**5. Backend flexibility**

Mix different providers based on task requirements:

```yaml
agents:
  architect:
    model: anthropic/claude-opus-4 # Claude for design
    system_prompt: prompts/architect.md

  implementer:
    model: openai/gpt-5.2-codex # Codex for code
    system_prompt: prompts/implementer.md
```

**6. Designed for reliability**

Agent Teams has known limitations: no session resumption, task status lag, slow shutdown, single team per session. Our design addresses these:

- File-based context = session resumption
- MCP notifications = real-time updates
- Instance isolation = parallel workflows
- Graceful shutdown = clean resource cleanup

## Use Cases

### Code Review

```yaml
agents:
  security_reviewer:
    model: anthropic/claude-sonnet-4-5
    system_prompt: Focus on security vulnerabilities
  performance_reviewer:
    model: anthropic/claude-sonnet-4-5
    system_prompt: Focus on performance issues
  synthesizer:
    model: anthropic/claude-sonnet-4-5
    system_prompt: Combine findings into actionable report

kickoff: |
  PR #${{ env.PR_NUMBER }} needs review.

  @security_reviewer check for vulnerabilities
  @performance_reviewer check for bottlenecks

  When both complete, @synthesizer create the final report.
```

### Research & Analysis

```yaml
agents:
  researcher:
    model: anthropic/claude-sonnet-4-5
    system_prompt: Investigate and gather information
  critic:
    model: anthropic/claude-sonnet-4-5
    system_prompt: Challenge assumptions and find flaws
  writer:
    model: anthropic/claude-sonnet-4-5
    system_prompt: Synthesize into clear documentation

kickoff: |
  Topic: ${{ topic }}

  @researcher gather information
  @critic challenge the findings
  @writer synthesize into a report
```

### Debugging

```yaml
agents:
  hypothesis_a:
    model: anthropic/claude-sonnet-4-5
    system_prompt: Investigate memory leaks
  hypothesis_b:
    model: anthropic/claude-sonnet-4-5
    system_prompt: Investigate race conditions
  hypothesis_c:
    model: anthropic/claude-sonnet-4-5
    system_prompt: Investigate external dependencies

kickoff: |
  Bug: Application crashes after 24 hours

  @hypothesis_a @hypothesis_b @hypothesis_c

  Investigate your angle. Share findings in the channel.
  Challenge each other's theories.
```

## Quick Start

```bash
# Install
npm install -g agent-worker

# Create a workflow
cat > review.yaml << 'EOF'
agents:
  reviewer:
    model: anthropic/claude-sonnet-4-5
    system_prompt: You review code for quality.

setup:
  - shell: git diff HEAD~1
    as: diff

kickoff: |
  ${{ diff }}

  @reviewer please review
EOF

# Run
agent-worker run review.yaml
```

## Documentation

- [DESIGN.md](./DESIGN.md) - Design concepts and decisions
- [REFERENCE.md](./REFERENCE.md) - MCP tools, controller loop, prompt structure
- [TODO.md](./TODO.md) - Implementation status
- [../backends.md](../backends.md) - Backend feature matrix and CLI details

## Future Directions

- **Workflow composition**: Import and extend workflows
- **Dynamic agent spawning**: Create agents at runtime based on task
- **Cross-workflow communication**: Agents in different workflows collaborate
- **Persistent agent memory**: Agents remember across workflow runs
- **Visual workflow editor**: Design workflows graphically
