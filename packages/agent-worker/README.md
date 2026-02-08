# agent-worker

CLI and SDK for running AI agents — from standalone instances to collaborative workflows.

## Installation

```bash
npm install -g agent-worker
# or
bun add -g agent-worker
```

## Two Modes of Operation

agent-worker supports two distinct usage patterns:

| Mode | Use Case | Entry Point | Coordination |
|------|----------|-------------|--------------|
| **Agent** | Single AI assistant | CLI commands | Direct interaction |
| **Workflow** | Multi-agent collaboration | YAML workflow file | @mention-based |

---

## 🤖 Agent Mode

**Run individual AI agents as standalone instances.**

Perfect for: testing, prototyping, interactive Q&A, code assistance.

### Quick Start

```bash
# Start an agent
agent-worker new alice -m anthropic/claude-sonnet-4-5

# Send a message
agent-worker send alice "Analyze this codebase"

# View conversation
agent-worker peek

# Check status
agent-worker status alice
```

### Organizing Agents

Agents can be grouped into **workflows** without defining coordination:

```bash
# Create agents in the same workflow namespace
agent-worker new reviewer -m anthropic/claude-sonnet-4-5 -w review
agent-worker new coder -m anthropic/claude-sonnet-4-5 -w review

# Send to specific agent
agent-worker send reviewer@review "Check this code"
```

### Multiple Instances (workflow:tag)

Run multiple isolated instances of the same workflow using **tags**:

```bash
# Different PRs, isolated contexts
agent-worker new reviewer -w review:pr-123
agent-worker new reviewer -w review:pr-456

# Each has its own conversation history
agent-worker send reviewer@review:pr-123 "LGTM"
agent-worker peek @review:pr-123  # Only sees pr-123 messages
```

**Tag syntax**:
- `alice` → standalone agent (global space)
- `alice -w review` → `alice@review:main` (default tag: main)
- `alice -w review:pr-123` → full specification

### Agent Commands

```bash
# Lifecycle
agent-worker new <name> [options]        # Create agent
agent-worker stop <target>               # Stop agent
agent-worker ls [-w workflow]            # List agents
agent-worker status <target>             # Check agent status

# Interaction
agent-worker send <target> <message>     # Send to agent or workflow
agent-worker peek [target] [options]     # View messages (default: @global)

# Scheduling (periodic wakeup when idle)
agent-worker schedule <target> set <interval> [--prompt "Task"]
agent-worker schedule <target> get
agent-worker schedule <target> clear

# Shared documents
agent-worker doc read <target>
agent-worker doc write <target> --content "..."
agent-worker doc append <target> --file notes.txt

# Tools (for testing/mocking)
agent-worker tool mock <tool-name> <response-json>
agent-worker tool list
```

### Backend Options

```bash
agent-worker new alice -m anthropic/claude-sonnet-4-5  # SDK (default)
agent-worker new alice -b claude                       # Claude CLI
agent-worker new alice -b cursor                       # Cursor Agent
agent-worker new alice -b mock                         # Testing (no API)
```

### Examples

**Quick testing without API keys:**
```bash
agent-worker new -b mock
agent-worker send a0 "Hello"
```

**Scheduled agent (runs every 30s when idle):**
```bash
agent-worker new monitor -w ci --wakeup 30s --prompt "Check CI status"
```

**Send to workflow (broadcast or @mention):**
```bash
# Broadcast to entire workflow
agent-worker send @review "Status update"

# @mention specific agents in workflow
agent-worker send @review "@alice @bob discuss this"
```

**Feedback-enabled agent (reports observations):**
```bash
agent-worker new -m anthropic/claude-sonnet-4-5 --feedback
```

---

## 📋 Workflow Mode

**Define multi-agent collaboration through YAML workflows.**

Perfect for: structured tasks, agent orchestration, reproducible pipelines.

### Quick Start

```yaml
# review.yaml
agents:
  reviewer:
    backend: claude
    system_prompt: You are a code reviewer. Provide constructive feedback.

  coder:
    backend: cursor
    model: sonnet-4.5
    system_prompt: You implement code changes based on feedback.

kickoff: |
  @reviewer Review the recent changes and provide feedback.
  @coder Implement the suggested improvements.
```

```bash
# Run once and exit
agent-worker run review.yaml

# Run and keep agents alive
agent-worker start review.yaml

# Run in background
agent-worker start review.yaml --background
```

### Workflow Instances (Tags)

Run the same workflow definition with different contexts:

```bash
# Each PR gets its own isolated instance
agent-worker run review.yaml -w review:pr-123
agent-worker run review.yaml -w review:pr-456

# Context isolation
├── .workflow/
│   └── review/
│       ├── pr-123/    # Independent channel + documents
│       └── pr-456/    # Independent channel + documents
```

### Workflow Structure

```yaml
# Full workflow structure
name: code-review  # Optional, defaults to filename

agents:
  alice:
    backend: sdk | claude | cursor | codex | mock
    model: anthropic/claude-sonnet-4-5  # Required for SDK
    system_prompt: |
      You are Alice, a senior code reviewer.
    tools: [bash, read, write]  # CLI backend tool names
    max_tokens: 8000
    max_steps: 20

  bob:
    backend: claude
    system_prompt_file: ./prompts/bob.txt  # Load from file

# Context configuration (shared channel + documents)
context:
  provider: file
  config:
    dir: ./.workflow/${{ workflow.name }}/${{ workflow.tag }}/  # Ephemeral
    # OR
    bind: ./data/${{ workflow.tag }}/  # Persistent (survives shutdown)

# Setup commands (run before kickoff)
setup:
  - shell: git log --oneline -10
    as: recent_commits  # Store output as variable

  - shell: git diff main...HEAD
    as: changes

# Kickoff message (starts the workflow)
kickoff: |
  @alice Review these changes:

  Recent commits:
  ${{ recent_commits }}

  Diff:
  ${{ changes }}

  @bob Stand by for implementation tasks.
```

### Workflow Commands

```bash
# Execution
agent-worker run <file> [-w workflow:tag] [--json]    # Run once
agent-worker start <file> [-w workflow:tag]           # Keep alive
agent-worker start <file> --background                # Daemon mode
agent-worker stop @<workflow:tag>                     # Stop workflow

# Monitoring
agent-worker ls -w <workflow:tag>        # List agents in workflow
agent-worker peek @<workflow:tag>        # View channel messages
agent-worker doc read @<workflow:tag>    # Read shared document

# Debug
agent-worker run <file> --debug          # Show internal logs
agent-worker run <file> --feedback       # Enable observation tool
```

### Variable Interpolation

Templates support `${{ variable }}` syntax:

```yaml
setup:
  - shell: echo "pr-${{ env.PR_NUMBER }}"
    as: branch_name

kickoff: |
  Workflow: ${{ workflow.name }}
  Tag: ${{ workflow.tag }}
  Branch: ${{ branch_name }}
```

Available variables:
- `${{ workflow.name }}` - Workflow name
- `${{ workflow.tag }}` - Instance tag
- `${{ env.VAR }}` - Environment variable
- `${{ task_output }}` - Setup task output (via `as:` field)

### Coordination Patterns

**Sequential handoff:**
```yaml
kickoff: |
  @alice Start the task.
```
Alice's message: "Done! @bob your turn"

**Parallel broadcast:**
```yaml
kickoff: |
  @alice @bob @charlie All review this code.
```

**Document-based:**
```yaml
agents:
  writer:
    system_prompt: Write analysis to the shared document.

  reviewer:
    system_prompt: Read the document and provide feedback.

context:
  provider: file
  config:
    bind: ./results/  # Persistent across runs
```

### Examples

**PR Review Workflow:**
```yaml
# review.yaml
agents:
  reviewer:
    backend: claude
    system_prompt: Review code for bugs, style, performance.

setup:
  - shell: gh pr diff ${{ env.PR_NUMBER }}
    as: diff

kickoff: |
  @reviewer Review this PR:

  ${{ diff }}
```

```bash
PR_NUMBER=123 agent-worker run review.yaml -w review:pr-123
```

**Research & Summarize:**
```yaml
# research.yaml
agents:
  researcher:
    backend: sdk
    model: anthropic/claude-sonnet-4-5
    system_prompt: Research topics and write findings to document.

  summarizer:
    backend: sdk
    model: anthropic/claude-haiku-4-5
    system_prompt: Read document and create concise summary.

context:
  provider: file
  config:
    bind: ./research-output/

kickoff: |
  @researcher Research "${{ env.TOPIC }}" and document findings.
  @summarizer Wait for research to complete, then summarize.
```

---

## 🔧 SDK Usage

For programmatic control (TypeScript/JavaScript):

```typescript
import { AgentSession } from 'agent-worker'

const session = new AgentSession({
  model: 'anthropic/claude-sonnet-4-5',
  system: 'You are a helpful assistant.',
  tools: [/* your tools */]
})

// Send message
const response = await session.send('Hello')
console.log(response.content)
console.log(response.toolCalls)
console.log(response.usage)

// Stream response
for await (const chunk of session.sendStream('Tell me a story')) {
  process.stdout.write(chunk)
}

// State management
const state = session.getState()
// Later: restore from state
```

### With Skills

```typescript
import { AgentSession, SkillsProvider, createSkillsTool } from 'agent-worker'

const skillsProvider = new SkillsProvider()
await skillsProvider.scanDirectory('.agents/skills')

const session = new AgentSession({
  model: 'anthropic/claude-sonnet-4-5',
  system: 'You are a helpful assistant.',
  tools: [createSkillsTool(skillsProvider)]
})
```

---

## 📊 Comparison: Agent vs Workflow

| Feature | Agent Mode | Workflow Mode |
|---------|------------|---------------|
| **Definition** | CLI commands | YAML file |
| **Agents** | One at a time | Multiple (orchestrated) |
| **Coordination** | Manual (via commands) | Automatic (@mentions) |
| **Context** | Shared channel + docs | Shared channel + docs |
| **Isolation** | workflow:tag namespace | workflow:tag namespace |
| **Setup** | Start agents manually | Declarative setup tasks |
| **Best For** | Interactive tasks, testing | Structured workflows, automation |

Both modes share the same underlying context system:
```
.workflow/
├── global/main/        # Standalone agents (default)
├── review/main/        # review workflow, main tag
└── review/pr-123/      # review workflow, pr-123 tag
```

---

## 🎯 Model Formats

```bash
agent-worker new -m anthropic/claude-sonnet-4-5   # Gateway (recommended)
agent-worker new -m anthropic                      # Provider-only (frontier)
agent-worker new -m deepseek:deepseek-chat         # Direct format
```

---

## 📚 Documentation

| Doc | Description |
|-----|-------------|
| [ARCHITECTURE.md](./ARCHITECTURE.md) | System architecture and modules |
| [docs/backends.md](./docs/backends.md) | Backend feature matrix |
| [docs/workflow/](./docs/workflow/) | Workflow system design |
| [TEST-ARCHITECTURE.md](./TEST-ARCHITECTURE.md) | Testing strategy |

---

## Requirements

- Node.js 18+ or Bun
- API key for chosen provider (e.g., `ANTHROPIC_API_KEY`)

---

## License

MIT
