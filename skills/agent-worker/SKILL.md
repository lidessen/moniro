---
name: agent-worker
description: Create and manage AI agent sessions with multiple backends (SDK, Claude CLI, Codex, Cursor). Use for "start agent session", "create worker", "run agent", "test with tools", or when orchestrating AI conversations programmatically.
---

# Agent Worker

## Who You Are

You build AI-powered workflows. You've felt the pain of testing prompts manually, mocking tool calls, switching between providers. You want programmatic control.

agent-worker gives you that control: persistent sessions, multiple backends, tool injection, approval workflows.

You're here to create sessions, send messages, manage tools—all from the command line.

---

## Quick Start

```bash
# Create a session (SDK backend, default)
agent-worker session new -m anthropic/claude-sonnet-4-5

# Create with Claude CLI backend
agent-worker session new -b claude

# Send a message
agent-worker send "What is 2+2?"

# End session
agent-worker session end
```

That's it. Session persists across commands. State maintained until you end it.

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
agent-worker session new -m openai/gpt-5.2

# CLI backends
agent-worker session new -b claude
agent-worker session new -b codex
agent-worker session new -b cursor
```

**Note**: Tool management (add, mock, import) only works with SDK backend.

---

## Session Management

### Creating Sessions

```bash
# Basic session
agent-worker session new

# With custom system prompt
agent-worker session new -s "You are a code reviewer."

# From file
agent-worker session new -f ./prompts/reviewer.txt

# Named session (easier reference)
agent-worker session new -n my-session

# Custom idle timeout (ms, 0 = no timeout)
agent-worker session new --idle-timeout 3600000
```

### Multiple Sessions

```bash
# List all
agent-worker session list

# Switch default
agent-worker session use my-session

# Target specific session
agent-worker send "Hello" --to my-session

# End specific
agent-worker session end my-session

# End all
agent-worker session end --all
```

### Session Info

```bash
# Status
agent-worker session status

# Statistics (tokens, messages)
agent-worker stats

# Conversation history
agent-worker history
agent-worker history --last 5

# Export full transcript
agent-worker export > transcript.json

# Clear history (keep session)
agent-worker clear
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
      // Real implementation
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
# Set static mock response
agent-worker tool mock get_weather '{"temp": 72, "condition": "sunny"}'

# List tools
agent-worker tool list
```

---

## Approval Workflow

For tools marked `needsApproval`:

```bash
# Send message that triggers tool
agent-worker send "Delete /tmp/test.txt"

# Check pending approvals
agent-worker pending

# Approve
agent-worker approve <approval-id>

# Deny with reason
agent-worker deny <approval-id> -r "Path not allowed"
```

---

## Model Formats

SDK backend supports multiple formats:

```bash
# Gateway format (recommended)
agent-worker session new -m openai/gpt-5.2
agent-worker session new -m anthropic/claude-sonnet-4-5

# Provider-only (uses provider's frontier model)
agent-worker session new -m openai
agent-worker session new -m anthropic

# Direct provider format
agent-worker session new -m deepseek:deepseek-chat
```

Check available providers:
```bash
agent-worker providers
```

---

## Common Patterns

### Testing a Prompt

```bash
# Create session with your system prompt
agent-worker session new -f ./my-prompt.txt -n test

# Run test cases
agent-worker send "Test case 1: ..." --to test
agent-worker send "Test case 2: ..." --to test

# Check history
agent-worker history --to test

# Clean up
agent-worker session end test
```

### Tool Development

```bash
# Start session
agent-worker session new -n dev

# Add tool with mock
agent-worker tool add my_api -d "Call my API" -p "endpoint:string"
agent-worker tool mock my_api '{"status": "ok"}'

# Test
agent-worker send "Call my API at /users"

# Update mock, test again
agent-worker tool mock my_api '{"status": "error", "code": 500}'
agent-worker send "Call my API at /users"
```

### Multi-Backend Comparison

```bash
# Same prompt, different backends
agent-worker session new -m anthropic/claude-sonnet-4-5 -n anthropic
agent-worker session new -b claude -n claude-cli

agent-worker send "Explain recursion" --to anthropic
agent-worker send "Explain recursion" --to claude-cli

# Compare
agent-worker history --to anthropic
agent-worker history --to claude-cli
```

---

## Programmatic Usage

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

// Stream
for await (const chunk of session.sendStream('Tell me a story')) {
  process.stdout.write(chunk)
}

// Get state for persistence
const state = session.getState()
```

---

## Troubleshooting

| Issue | Solution |
|-------|----------|
| "No active session" | Run `agent-worker session new` first |
| "Session not found" | Check `agent-worker session list` |
| "Tool management not supported" | Use SDK backend (`-b sdk` or omit `-b`) |
| "Provider not loaded" | Check API key with `agent-worker providers` |
| Session not responding | Check if process alive: `agent-worker session status` |

---

## Command Reference

```
agent-worker session new     Create session
agent-worker session list    List sessions
agent-worker session status  Check session
agent-worker session use     Set default
agent-worker session end     End session

agent-worker send            Send message
agent-worker history         Show history
agent-worker stats           Show statistics
agent-worker export          Export transcript
agent-worker clear           Clear history

agent-worker tool add        Add tool
agent-worker tool import     Import from file
agent-worker tool mock       Set mock response
agent-worker tool list       List tools

agent-worker pending         List pending approvals
agent-worker approve         Approve tool call
agent-worker deny            Deny tool call

agent-worker providers       Check SDK providers
agent-worker backends        Check available backends
```

---

## Remember

agent-worker is about **programmatic control** over AI conversations.

- Sessions persist state
- Tools inject capabilities
- Backends give you choice
- Mocks enable testing

不是手动对话，而是工程化的 AI 交互。
