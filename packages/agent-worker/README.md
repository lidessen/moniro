# agent-worker

CLI and SDK for creating and managing AI agent sessions with multiple backends.

## Installation

```bash
npm install -g agent-worker
# or
bun add -g agent-worker
```

## CLI Usage

### Session Management

```bash
# Create a session (SDK backend, default)
agent-worker session new -m anthropic/claude-sonnet-4-5

# Create with system prompt
agent-worker session new -s "You are a code reviewer."

# Create with system prompt from file
agent-worker session new -f ./prompts/reviewer.txt

# Create named session
agent-worker session new -n my-session

# Create with Claude CLI backend
agent-worker session new -b claude

# List all sessions
agent-worker session list

# Switch default session
agent-worker session use my-session

# Check session status
agent-worker session status

# End session
agent-worker session end

# End specific session
agent-worker session end my-session

# End all sessions
agent-worker session end --all
```

### Sending Messages

```bash
# Send to current session (async by default - returns immediately)
agent-worker send "Analyze this codebase"

# Send to specific session
agent-worker send "Explain recursion" --to my-session

# Send and wait for response (synchronous mode)
agent-worker send "What is 2+2?" --wait

# Send with debug logging (useful for troubleshooting)
agent-worker send "Debug this" --debug

# View conversation messages
agent-worker peek                    # Show last 10 messages (default)
agent-worker peek --last 5           # Show last 5 messages
agent-worker peek --all              # Show all messages
agent-worker peek --find "error"     # Search messages containing "error"

# View token usage
agent-worker stats

# Export transcript
agent-worker export > transcript.json

# Clear messages (keep session)
agent-worker clear
```

**Understanding Message Flow:**

The CLI supports two modes for sending messages:

1. **Asynchronous (default)**: The command returns immediately after sending. The agent processes in the background. Use `peek` to view the response.
   ```bash
   # Send message (returns immediately)
   agent-worker send "Analyze this large codebase"
   # Output: "Message sent. Use 'peek' command to view response."

   # View response later
   agent-worker peek --last 2
   ```

2. **Synchronous (`--wait`)**: The command waits for the agent to fully process the message and return a response. This is best for quick questions when you need immediate results.
   ```bash
   agent-worker send "What is 2+2?" --wait
   # Waits for response, then prints: 4
   ```

**Troubleshooting:**

If `send` appears stuck or times out, use `--debug` to see what's happening:

```bash
agent-worker send "test message" --debug
```

Debug output shows:
- Session lookup and connection status
- Socket communication
- Request/response timing
- Error details

**Backend Limitations:**

The CLI supports two backend types:

1. **SDK Backend (default)**: Full-featured, works in all environments. Requires `ANTHROPIC_API_KEY` environment variable.

2. **Claude CLI Backend (`-b claude`)**: Uses `claude -p` for non-interactive mode.
   - **Known limitation**: May not work properly within Claude Code environment itself due to command interception
   - **Timeout**: Async requests timeout after 60 seconds to prevent indefinite hangs
   - **Recommended use**: Normal terminal environments outside Claude Code
   - **For testing**: Use SDK backend instead when developing within Claude Code

If you see messages stuck in `(processing...)` state for more than 60 seconds, it indicates a backend issue. The message will automatically update to show a timeout error.

### Tool Management (SDK Backend Only)

```bash
# Add a tool
agent-worker tool add get_weather \
  -d "Get weather for a location" \
  -p "location:string:City name"

# Add tool requiring approval
agent-worker tool add delete_file \
  -d "Delete a file" \
  -p "path:string:File path" \
  --needs-approval

# Import tools from file
agent-worker tool import ./my-tools.ts

# Mock tool response (for testing)
agent-worker tool mock get_weather '{"temp": 72, "condition": "sunny"}'

# List registered tools
agent-worker tool list
```

### Approval Workflow

```bash
# Check pending approvals
agent-worker pending

# Approve a tool call
agent-worker approve <approval-id>

# Deny with reason
agent-worker deny <approval-id> -r "Path not allowed"
```

### Agent Skills

Agent skills provide reusable instructions and methodologies that agents can access on demand. Compatible with the [Agent Skills](https://agentskills.io) ecosystem.

```bash
# Load skills from default directories (.agents/skills, .claude/skills, ~/.agents/skills)
agent-worker session new

# Add a specific skill directory
agent-worker session new --skill ./my-skills/custom-skill

# Scan additional directories for skills
agent-worker session new --skill-dir ./team-skills --skill-dir ~/shared-skills

# Combine multiple options
agent-worker session new \
  --skill ./my-skills/dive \
  --skill-dir ~/company-skills

# Import skills from Git repositories (temporary, session-scoped)
agent-worker session new --import-skill vercel-labs/agent-skills:dive
agent-worker session new --import-skill lidessen/skills:{memory,orientation}
agent-worker session new --import-skill gitlab:myorg/skills@v1.0.0:custom
```

**Import Skill Spec Format:**

The `--import-skill` option supports temporary skill imports from Git repositories. Skills are cloned to a session-specific temp directory and cleaned up when the session ends.

```
[provider:]owner/repo[@ref]:{skill1,skill2,...}
```

Examples:
- `vercel-labs/agent-skills` - Import all skills from GitHub main branch
- `vercel-labs/agent-skills:dive` - Import single skill
- `vercel-labs/agent-skills:{dive,memory}` - Import multiple skills (brace expansion)
- `vercel-labs/agent-skills@v1.0.0:dive` - Import from specific tag/branch
- `gitlab:myorg/skills:custom` - Import from GitLab
- `gitee:org/repo@dev:{a,b}` - Import from Gitee dev branch

Supported providers: `github` (default), `gitlab`, `gitee`

**Skills Support by Backend:**

| Backend | Skills Support | How It Works | `--import-skill` |
|---------|----------------|--------------|------------------|
| **SDK** (default) | ✅ Full | Skills loaded as a tool that agents can call | ✅ Supported |
| **Claude CLI** | ✅ Full | Loads from `.claude/skills/` and `~/.claude/skills/` | ⚠️ Manual install required |
| **Codex CLI** | ✅ Full | Loads from `.agents/skills/`, `~/.codex/skills/`, `~/.agents/skills/` | ⚠️ Manual install required |
| **Cursor CLI** | ✅ Full | Loads from `.agents/skills/` and `~/.cursor/skills/` | ⚠️ Manual install required |

**Notes:**
- **SDK Backend**: Skills work through the Skills tool, allowing dynamic file reading. `--import-skill` is fully supported.
- **CLI Backends** (claude, codex, cursor): Skills are loaded from filesystem locations by the CLI tool itself. To use `--import-skill` with these backends, install skills manually using `npx skills add <repo> --global`.
- If you specify `--import-skill` with a CLI backend, agent-worker will show a warning and suggest using SDK backend or manual installation.

**Default Skill Directories:**
- `.agents/skills/` - Project-level skills (all backends)
- `.claude/skills/` - Claude Code project skills
- `.cursor/skills/` - Cursor project skills
- `~/.agents/skills/` - User-level global skills (all backends)
- `~/.claude/skills/` - User-level Claude skills
- `~/.codex/skills/` - User-level Codex skills

**Using Skills in Sessions:**

Once loaded, agents can interact with skills via the `Skills` tool:

```typescript
// List available skills
Skills({ operation: 'list' })

// View a skill's complete instructions
Skills({ operation: 'view', skillName: 'dive' })

// Read skill reference files
Skills({
  operation: 'readFile',
  skillName: 'dive',
  filePath: 'references/search-strategies.md'
})
```

**Installing Skills:**

Use the [skills CLI](https://github.com/vercel-labs/skills) to install skills:

```bash
# Install from GitHub
npx skills add vercel-labs/agent-skills

# Or use the official skills tool
npm install -g @agentskills/cli
skills add vercel-labs/agent-skills
```

### Backends

```bash
# Check available backends
agent-worker backends

# Check SDK providers
agent-worker providers
```

| Backend | Command | Best For |
|---------|---------|----------|
| SDK (default) | `session new -m provider/model` | Full control, tool injection, mocking |
| Claude CLI | `session new -b claude` | Use existing Claude installation |
| Codex | `session new -b codex` | OpenAI Codex workflows |
| Cursor | `session new -b cursor` | Cursor Agent integration |

> **⚠️ Important:** Different backends have different capabilities. CLI backends (claude, codex, cursor) don't support:
> - Dynamic tool management (`tool_add`, `tool_mock`, `tool_import`)
> - Approval system (`approve`, `deny`)
> - `--import-skill` (use `npx skills add --global` instead)
>
> See [BACKEND_COMPATIBILITY.md](./BACKEND_COMPATIBILITY.md) for a complete feature comparison.

### Model Formats (SDK Backend)

```bash
# Gateway format (recommended)
agent-worker session new -m anthropic/claude-sonnet-4-5
agent-worker session new -m openai/gpt-5.2

# Provider-only (uses frontier model)
agent-worker session new -m anthropic
agent-worker session new -m openai

# Direct provider format
agent-worker session new -m deepseek:deepseek-chat
```

## SDK Usage

### Basic Session

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

// Get state for persistence
const state = session.getState()
```

### With Skills

```typescript
import {
  AgentSession,
  SkillsProvider,
  createSkillsTool
} from 'agent-worker'

// Setup skills
const skillsProvider = new SkillsProvider()
await skillsProvider.scanDirectory('.agents/skills')
await skillsProvider.scanDirectory('~/my-skills')

// Or add individual skills
await skillsProvider.addSkill('./custom-skills/my-skill')

// Create session with Skills tool
const session = new AgentSession({
  model: 'anthropic/claude-sonnet-4-5',
  system: 'You are a helpful assistant.',
  tools: [
    createSkillsTool(skillsProvider),
    // ... other tools
  ]
})

// Agent can now access skills
const response = await session.send(
  'What skills are available? Use the dive skill to analyze this codebase.'
)
```

### With Imported Skills

```typescript
import {
  AgentSession,
  SkillsProvider,
  SkillImporter,
  createSkillsTool
} from 'agent-worker'

// Setup skills provider
const skillsProvider = new SkillsProvider()

// Import skills from Git repositories
const sessionId = 'my-session-123'
const importer = new SkillImporter(sessionId)

// Import from GitHub
await importer.import('vercel-labs/agent-skills:dive')
await importer.import('lidessen/skills:{memory,orientation}')

// Or import multiple specs at once
await importer.importMultiple([
  'vercel-labs/agent-skills:{dive,react}',
  'gitlab:myorg/skills@v1.0.0:custom'
])

// Add imported skills to provider
await skillsProvider.addImportedSkills(importer)

// Create session
const session = new AgentSession({
  model: 'anthropic/claude-sonnet-4-5',
  system: 'You are a helpful assistant.',
  tools: [createSkillsTool(skillsProvider)]
})

// Don't forget cleanup when done
process.on('exit', async () => {
  await importer.cleanup()
})
```

## Common Patterns

### Prompt Testing

```bash
agent-worker session new -f ./my-prompt.txt -n test
agent-worker send "Test case 1: ..." --to test
agent-worker send "Test case 2: ..." --to test
agent-worker peek --to test
agent-worker session end test
```

### Tool Development with Mocks

```bash
agent-worker session new -n dev
agent-worker tool add my_api -d "Call my API" -p "endpoint:string"
agent-worker tool mock my_api '{"status": "ok"}'
agent-worker send "Call my API at /users"
# Update mock, test error handling
agent-worker tool mock my_api '{"status": "error", "code": 500}'
agent-worker send "Call my API at /users"
```

### Multi-Model Comparison

```bash
agent-worker session new -m anthropic/claude-sonnet-4-5 -n claude
agent-worker session new -m openai/gpt-5.2 -n gpt
agent-worker send "Explain recursion" --to claude
agent-worker send "Explain recursion" --to gpt
```

## Requirements

- Node.js 18+ or Bun
- API key for chosen provider (e.g., `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`)

## License

MIT
