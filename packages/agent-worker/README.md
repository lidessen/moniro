# agent-worker

Run AI agents from the terminal. One agent or many, talking to each other.

```bash
npm install -g agent-worker
```

```bash
# Start an agent, send it a task
agent-worker new alice -m anthropic/claude-sonnet-4-5
agent-worker send alice "Refactor the auth module"

# Or define a team in YAML and let them collaborate
agent-worker run review.yaml
```

## Why agent-worker?

Most agent frameworks lock you into a single provider and a single execution model.
agent-worker gives you **one CLI** that works across backends (Claude CLI, Cursor, Codex, or raw SDK)
and scales from a single assistant to a team of agents coordinating via @mentions.

- **Multi-backend** — Same commands whether your agent runs on Claude CLI, Cursor, Codex, or the Vercel AI SDK
- **Single & multi-agent** — Start one agent interactively, or define a team workflow in YAML
- **@mention coordination** — Agents talk to each other naturally: `@reviewer check this`, `@coder fix it`
- **Shared context** — Channel (messages), documents (workspace), resources (large content) — all agents see the same state
- **Instance isolation** — Run the same workflow for different PRs/tasks with `--tag`, fully isolated
- **SDK included** — Use programmatically from TypeScript when the CLI isn't enough

## Quick Start

### Single Agent

```bash
# Create and interact
agent-worker new alice -m anthropic/claude-sonnet-4-5
agent-worker send alice "Analyze this codebase"
agent-worker peek                    # View conversation

# Try without API keys
agent-worker new -b mock
agent-worker send a0 "Hello"
```

### Multi-Agent Workflow

```yaml
# review.yaml
agents:
  reviewer:
    model: anthropic/claude-sonnet-4-5
    system_prompt: |
      You are a code reviewer. When you find issues, @coder to fix them.

  coder:
    model: anthropic/claude-sonnet-4-5
    system_prompt: |
      You are a coder. Fix issues found by the reviewer.
      After fixing, @reviewer to verify.

setup:
  - shell: git diff HEAD~1
    as: diff

kickoff: |
  PR diff:
  ${{ diff }}

  @reviewer please review these changes.
```

```bash
agent-worker run review.yaml
```

That's it. The reviewer reads the diff, finds issues, @mentions the coder. The coder fixes them, @mentions back. They iterate until done.

## CLI Reference

### Agent Lifecycle

```bash
agent-worker new <name> [options]       # Create agent
agent-worker stop <target>              # Stop agent or workflow
agent-worker ls [target]                # List agents (--all for everything)
agent-worker status <target>            # Agent status
```

### Communication

```bash
agent-worker send <target> <message>    # Send message
agent-worker send @review "Status?"     # Broadcast to workflow
agent-worker peek [target]              # View messages
```

### Shared Documents

```bash
agent-worker doc read <target>
agent-worker doc write <target> --content "..."
agent-worker doc append <target> --file notes.txt
```

### Scheduling

```bash
agent-worker schedule <target> set 30s --prompt "Check CI status"
agent-worker schedule <target> get
agent-worker schedule <target> clear
```

### Workflows

```bash
agent-worker run <file> [--tag tag]           # Run once, exit when done
agent-worker start <file> [--tag tag]         # Keep alive after kickoff
agent-worker start <file> --background        # Daemon mode
```

## Target Syntax

Agents live in workflows. Standalone agents go into a default `global` workflow.

```
alice                → alice@global:main     (standalone agent)
alice@review         → alice@review:main     (agent in "review" workflow)
alice@review:pr-123  → alice@review:pr-123   (specific instance)
@review              → review workflow       (broadcast)
@review:pr-123       → specific instance
```

Use `--tag` to run isolated instances of the same workflow:

```bash
agent-worker run review.yaml --tag pr-123
agent-worker run review.yaml --tag pr-456    # Completely independent
```

## Backends

```bash
agent-worker new alice -m anthropic/claude-sonnet-4-5   # Vercel AI SDK (default)
agent-worker new alice -b claude                         # Claude CLI
agent-worker new alice -b cursor                         # Cursor Agent
agent-worker new alice -b codex                          # OpenAI Codex
agent-worker new alice -b mock                           # No API calls (testing)
```

| Capability | SDK | Claude CLI | Cursor | Codex | Mock |
|------------|-----|-----------|--------|-------|------|
| Custom tools | Yes | Via MCP | No | No | Yes |
| Streaming | Yes | Yes | Yes | Yes | No |
| Token tracking | Yes | Partial | No | No | Yes |
| Skills import | Yes | Filesystem | Filesystem | Filesystem | Yes |

## Workflow YAML

### Full Structure

```yaml
name: my-workflow                           # Optional, defaults to filename

agents:
  alice:
    backend: sdk                            # sdk | claude | cursor | codex | mock
    model: anthropic/claude-sonnet-4-5      # Required for SDK backend
    system_prompt: You are Alice.
    system_prompt_file: ./prompts/alice.txt  # Or load from file
    tools: [bash, read, write]              # CLI backend tool names
    max_tokens: 8000
    max_steps: 20

context:
  provider: file
  config:
    dir: ./.workflow/${{ workflow.name }}/${{ workflow.tag }}/  # Ephemeral
    bind: ./data/                                              # Persistent

setup:
  - shell: git diff main...HEAD
    as: changes                             # Store output as variable
  - shell: echo "$PR_NUMBER"
    as: pr_num

kickoff: |
  ${{ changes }}
  @alice Review this. @bob Stand by.
```

### Variables

- `${{ workflow.name }}` — Workflow name
- `${{ workflow.tag }}` — Instance tag
- `${{ env.VAR }}` — Environment variable
- `${{ task_output }}` — Setup task output (via `as:` field)

### Coordination Patterns

**Sequential** — One agent finishes, @mentions the next:
```yaml
kickoff: "@alice Start the analysis."
# Alice: "Done! @bob your turn to implement."
```

**Parallel** — Multiple agents work simultaneously:
```yaml
kickoff: "@alice @bob @charlie All review this code."
```

**Document-based** — Agents collaborate through shared documents:
```yaml
context:
  provider: file
  config:
    bind: ./results/                        # Persistent across runs
```

## SDK Usage

```typescript
import { AgentWorker } from 'agent-worker'

const agent = new AgentWorker({
  model: 'anthropic/claude-sonnet-4-5',
  system: 'You are a helpful assistant.',
  tools: [/* your tools */],
})

// Request-response
const response = await agent.send('Hello')
console.log(response.content)

// Streaming
for await (const chunk of agent.sendStream('Tell me a story')) {
  process.stdout.write(chunk)
}
```

### With Skills

```typescript
import { AgentWorker, SkillsProvider, createSkillsTool } from 'agent-worker'

const skills = new SkillsProvider()
await skills.scanDirectory('.agents/skills')

const agent = new AgentWorker({
  model: 'anthropic/claude-sonnet-4-5',
  system: 'You are a helpful assistant.',
  tools: [createSkillsTool(skills)],
})
```

### Programmatic Workflows

```typescript
import { parseWorkflowFile, runWorkflowWithControllers } from 'agent-worker'

const workflow = await parseWorkflowFile('review.yaml', { tag: 'pr-123' })
const result = await runWorkflowWithControllers({
  workflow,
  workflowName: 'review',
  tag: 'pr-123',
  mode: 'run',
})

console.log(result.success, result.duration)
```

## Model Formats

```bash
agent-worker new -m anthropic/claude-sonnet-4-5    # Gateway format (recommended)
agent-worker new -m anthropic                       # Provider shorthand (uses frontier)
agent-worker new -m deepseek:deepseek-chat          # Direct provider format
```

## Requirements

- Node.js 18+ or Bun
- API key for your chosen provider (e.g., `ANTHROPIC_API_KEY`)

## Documentation

- [ARCHITECTURE.md](./ARCHITECTURE.md) — System architecture
- [docs/backends.md](./docs/backends.md) — Backend comparison
- [docs/workflow/](./docs/workflow/) — Workflow system design
- [TEST-ARCHITECTURE.md](./TEST-ARCHITECTURE.md) — Testing strategy
- [examples/](./examples/) — Example workflows

## License

MIT
