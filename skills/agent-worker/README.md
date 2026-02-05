# agent-worker

CLI tool for creating and managing AI agent sessions with multiple backends.

## Features

- **Multiple backends**: SDK (Anthropic, OpenAI), Claude CLI, Codex, Cursor
- **Persistent sessions**: State maintained across commands
- **Tool injection**: Add, import, and mock tools (SDK backend)
- **Approval workflow**: Human-in-the-loop for sensitive operations

## Quick Start

```bash
# Create a session
agent-worker session new -m anthropic/claude-sonnet-4-5

# Send a message
agent-worker send "What is 2+2?"

# End session
agent-worker session end
```

## Backends

| Backend | Command | Best For |
|---------|---------|----------|
| SDK | `agent-worker session new` | Full control, tool injection |
| Claude CLI | `agent-worker session new -b claude` | Use existing Claude installation |
| Codex | `agent-worker session new -b codex` | OpenAI Codex workflows |
| Cursor | `agent-worker session new -b cursor` | Cursor Agent integration |

## Common Commands

```bash
agent-worker session new       # Create session
agent-worker session list      # List sessions
agent-worker send "message"    # Send message
agent-worker tool add <name>   # Add tool (SDK only)
agent-worker tool mock <name>  # Mock tool response
agent-worker history           # Show conversation
agent-worker session end       # End session
```

## Documentation

See [SKILL.md](./SKILL.md) for complete documentation including:
- Session management
- Tool management
- Approval workflow
- Model formats
- Programmatic usage
- Troubleshooting

## Use Cases

- **Prompt testing**: Test system prompts with multiple test cases
- **Tool development**: Mock API responses during development
- **Backend comparison**: Compare outputs across different models
- **CI/CD integration**: Automate AI-powered workflows

## License

MIT
