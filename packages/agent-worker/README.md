# agent-worker

CLI and SDK for creating and managing AI agent sessions with multiple backends.

## Installation

```bash
npm install -g agent-worker
# or
bun add -g agent-worker
```

## Quick Start

### CLI

```bash
# Create a new agent (in main workflow by default)
agent-worker new alice -m anthropic/claude-sonnet-4-5

# Send a message
agent-worker send "@alice Analyze this codebase"

# View messages
agent-worker peek

# Check status
agent-worker status alice
```

#### Working with Workflows

Workflows are isolated namespaces for organizing agents:

```bash
# Create agents in a specific workflow
agent-worker new reviewer -m anthropic/claude-sonnet-4-5 -w code-review
agent-worker new coder -m anthropic/claude-sonnet-4-5 -w code-review

# Send to specific workflow
agent-worker send "@reviewer Check this PR" -w code-review

# View workflow messages
agent-worker peek -w code-review

# Target syntax: agent@workflow
agent-worker status reviewer@code-review
agent-worker stop reviewer@code-review
```

The default workflow is `main`. Without `-w`, agents belong to `main`.

### SDK

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

// Persist state
const state = session.getState()
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

## Multi-Agent Workflow

Two agents collaborating — Alice asks questions, Bob answers:

```yaml
# chat.yaml
agents:
  alice:
    backend: cursor
    model: sonnet-4.5
    system_prompt: You are Alice. Curious and always asking questions.

  bob:
    backend: claude
    system_prompt: You are Bob. Knowledgeable and patient.

kickoff: |
  @alice Ask @bob a question about how AI agents collaborate.
  @bob Answer clearly, then ask @alice a follow-up.
```

```bash
agent-worker run chat.yaml
```

Agents coordinate via `@mentions` in a shared channel — just like a team chat. See [docs/workflow/](./docs/workflow/) for the full design.

## Backends

| Backend | Flag | Best For |
|---------|------|----------|
| SDK (default) | `-m provider/model` | Full control, tools, mocking |
| Claude CLI | `-b claude` | Existing Claude installation |
| Codex | `-b codex` | OpenAI Codex workflows |
| Cursor | `-b cursor` | Cursor Agent integration |

See [docs/backends.md](./docs/backends.md) for feature matrix and CLI details.

## Model Formats

```bash
agent-worker new -m anthropic/claude-sonnet-4-5   # Gateway (recommended)
agent-worker new -m anthropic                      # Provider-only (frontier model)
agent-worker new -m deepseek:deepseek-chat         # Direct format
```

## Requirements

- Node.js 18+ or Bun
- API key for chosen provider (e.g., `ANTHROPIC_API_KEY`)

## Documentation

| Doc | Description |
|-----|-------------|
| [ARCHITECTURE.md](./ARCHITECTURE.md) | System architecture and module structure |
| [docs/backends.md](./docs/backends.md) | Backend feature matrix and CLI reference |
| [docs/workflow/](./docs/workflow/) | Multi-agent workflow system |
| [TEST-ARCHITECTURE.md](./TEST-ARCHITECTURE.md) | Testing strategy and coverage |
| [CHANGELOG.md](./CHANGELOG.md) | Version history |

## License

MIT
