# Agent Worker v2 Design

## Overview

This document defines the design for agent-worker v2, introducing workflow-based orchestration with shared context and @mention-driven collaboration.

### Key Concepts

1. **Unified Agent Naming**: `agent-name` (standalone) or `agent-name@instance` (workflow)
2. **Shared Context**: Channel (communication) + Document (shared workspace)
3. **Kickoff Model**: Natural language workflow initiation with @mention triggers
4. **Two Modes**: `run` (one-shot) and `start` (persistent)

---

## Workflow File Format

### Basic Structure

```yaml
# review.yaml
name: code-review

# Shared context (optional, defaults enabled)
context:

agents:
  reviewer:
    model: anthropic/claude-sonnet-4-5
    system_prompt: prompts/reviewer.md

  coder:
    model: anthropic/claude-sonnet-4-5
    system_prompt: prompts/coder.md

# Optional: shell commands for setup
setup:
  - shell: gh pr diff
    as: diff

# Kickoff message - triggers workflow via @mention
kickoff: |
  PR diff:
  ${{ diff }}

  @reviewer please review these changes.
  When issues found, @coder to fix them.
```

### Context Configuration

Context enables shared communication and workspace between agents.

```yaml
# Minimal - enable all with defaults
context:

# Equivalent to:
context:
  channel:
  document:

# Equivalent to:
context:
  dir: .workflow/${{ instance }}/
  channel:
    file: channel.md
  document:
    file: notes.md

# Selective - only channel
context:
  channel:

# Custom paths
context:
  dir: ./my-context/
  channel:
    file: discussion.md
  document:
    file: workspace.md
```

**Default Values:**

```typescript
const CONTEXT_DEFAULTS = {
  dir: '.workflow/${{ instance }}/',
  channel: {
    file: 'channel.md',
  },
  document: {
    file: 'notes.md',
  },
}
```

### Channel vs Document

| Aspect | Channel | Document |
|--------|---------|----------|
| Purpose | Communication log | Shared workspace |
| Format | Append-only timeline | Editable content |
| @mention | Triggers notifications | No triggers |
| Typical use | Discussions, handoffs | Notes, findings, decisions |

**channel.md** (append-only):
```markdown
### 10:00:00 [system]
Workflow started

### 10:00:05 [reviewer]
@coder found auth validation issue in line 42

### 10:01:00 [coder]
Fixed, @reviewer please verify
```

**notes.md** (editable):
```markdown
# Review Notes

## Issues Found
1. Auth validation missing (line 42)
2. N+1 query in user loader

## Decisions
- Use zod for validation
- Defer performance fix to next sprint
```

---

## Schema Definition

```typescript
interface WorkflowFile {
  /** Workflow name (defaults to filename) */
  name?: string

  /**
   * Shared context configuration
   * - undefined: no context (agents can't communicate)
   * - null/empty: enable with all defaults
   * - object: custom configuration
   */
  context?: ContextConfig | null

  /** Agent definitions */
  agents: Record<string, AgentDefinition>

  /** Setup commands (run before kickoff) */
  setup?: SetupTask[]

  /**
   * Kickoff message - initiates workflow via @mention
   * Optional: if omitted, agents start but wait for external trigger
   */
  kickoff?: string
}

interface ContextConfig {
  /** Context directory (default: .workflow/${{ instance }}/) */
  dir?: string

  /** Channel config (null/empty = defaults, undefined = disabled) */
  channel?: ChannelConfig | null

  /** Document config (null/empty = defaults, undefined = disabled) */
  document?: DocumentConfig | null
}

interface ChannelConfig {
  file?: string  // default: channel.md
}

interface DocumentConfig {
  file?: string  // default: notes.md
}

interface AgentDefinition {
  /** Model identifier */
  model: string

  /** System prompt - inline string or file path */
  system_prompt: string

  /** Tool names to enable */
  tools?: string[]
}

interface SetupTask {
  /** Shell command to execute */
  shell: string

  /** Variable name to store output */
  as?: string
}

/** A single channel entry */
interface ChannelEntry {
  /** ISO timestamp */
  timestamp: string
  /** Author agent name or 'system' */
  from: string
  /** Message content */
  message: string
  /** Extracted @mentions */
  mentions: string[]
}

/** @mention notification */
interface MentionNotification {
  /** Who sent the message */
  from: string
  /** Who was mentioned */
  target: string
  /** The message content */
  message: string
  /** Entry timestamp */
  timestamp: string
}
```

---

## @Mention System

### How It Works

1. Agent writes to channel with @mention
2. System detects @mention pattern
3. Mentioned agent receives notification
4. Agent can respond via channel

```
reviewer writes: "@coder please fix the auth issue"
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

### Mention Pattern

```typescript
const MENTION_PATTERN = /@([a-zA-Z][a-zA-Z0-9_-]*)/g

function extractMentions(message: string, validAgents: string[]): string[] {
  const mentions: string[] = []
  let match: RegExpExecArray | null

  while ((match = MENTION_PATTERN.exec(message)) !== null) {
    const agent = match[1]
    if (validAgents.includes(agent) && !mentions.includes(agent)) {
      mentions.push(agent)
    }
  }

  return mentions
}
```

---

## Context MCP Server

Context is provided to agents via an MCP server, not direct file access.

### Architecture

```
┌───────────────────────────────────────────────────────────────┐
│                      Workflow Runner                           │
│                                                                │
│  ┌──────────────────────────────────────────────────────────┐ │
│  │           Context MCP Server (Unix Socket)                │ │
│  │                                                           │ │
│  │  Tools:                        Notifications:            │ │
│  │   - channel_send                - mention                │ │
│  │   - channel_read (ack mentions)                          │ │
│  │   - channel_peek (no ack)                                │ │
│  │   - channel_mentions                                     │ │
│  │   - document_read                                        │ │
│  │   - document_write                                       │ │
│  │   - document_append                                      │ │
│  │                                                           │ │
│  │  Provider: FileProvider | MemoryProvider                 │ │
│  └────────────────────────┬─────────────────────────────────┘ │
│                           │                                   │
└───────────────────────────┼───────────────────────────────────┘
                            │ Unix Socket + X-Agent-Id header
              ┌─────────────┼─────────────┐
              │             │             │
              ▼             ▼             ▼
         ┌────────┐   ┌────────┐    ┌────────┐
         │ Agent  │   │ Agent  │    │ Agent  │
         │ (SDK)  │   │(Claude)│    │(Cursor)│
         └────────┘   └────────┘    └────────┘
```

### Implementation

Using official MCP SDK (`@modelcontextprotocol/sdk`):

```typescript
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'

// Context Provider interface (storage abstraction)
interface ContextProvider {
  appendChannel(from: string, message: string): Promise<ChannelEntry>
  readChannel(since?: string, limit?: number): Promise<ChannelEntry[]>
  getUnreadMentions(agent: string): Promise<MentionNotification[]>
  acknowledgeMentions(agent: string, until: string): Promise<void>
  readDocument(): Promise<string>
  writeDocument(content: string): Promise<void>
  appendDocument(content: string): Promise<void>
}

// MCP Server for Context
function createContextMCPServer(
  provider: ContextProvider,
  validAgents: string[]
) {
  const server = new McpServer({
    name: 'workflow-context',
    version: '1.0.0',
  })

  // Track connected agents for notifications
  const agentConnections = new Map<string, McpConnection>()

  // Channel tools
  server.tool('channel_send', {
    message: z.string().describe('Message to send, can include @mentions'),
  }, async ({ message }, extra) => {
    // Agent identity from connection metadata (set during handshake)
    const from = extra.sessionId  // Agent ID from session
    const entry = await provider.appendChannel(from, message)

    // Notify mentioned agents via MCP notifications
    for (const target of entry.mentions) {
      const conn = agentConnections.get(target)
      if (conn) {
        await conn.notify('notifications/mention', {
          from,
          target,
          message,
          timestamp: entry.timestamp,
        })
      }
    }

    return { content: [{ type: 'text', text: 'sent' }] }
  })

  server.tool('channel_read', {
    since: z.string().optional().describe('Read entries after this timestamp'),
    limit: z.number().optional().describe('Max entries to return'),
  }, async ({ since, limit }, extra) => {
    const agent = extra.sessionId
    const entries = await provider.readChannel(since, limit)

    // Acknowledge mentions for this agent up to latest entry
    if (entries.length > 0) {
      const latest = entries[entries.length - 1].timestamp
      await provider.acknowledgeMentions(agent, latest)
    }

    return { content: [{ type: 'text', text: JSON.stringify(entries) }] }
  })

  server.tool('channel_peek', {
    limit: z.number().optional().describe('Max entries to return'),
  }, async ({ limit }) => {
    // Peek doesn't acknowledge mentions
    const entries = await provider.readChannel(undefined, limit)
    return { content: [{ type: 'text', text: JSON.stringify(entries) }] }
  })

  server.tool('channel_mentions', {
    unread_only: z.boolean().optional().describe('Only unread mentions'),
  }, async ({ unread_only }, extra) => {
    const agent = extra.sessionId
    const mentions = unread_only
      ? await provider.getUnreadMentions(agent)
      : [] // TODO: get all mentions
    return { content: [{ type: 'text', text: JSON.stringify(mentions) }] }
  })

  // Document tools
  server.tool('document_read', {}, async () => {
    const content = await provider.readDocument()
    return { content: [{ type: 'text', text: content }] }
  })

  server.tool('document_write', {
    content: z.string().describe('New document content (replaces existing)'),
  }, async ({ content }) => {
    await provider.writeDocument(content)
    return { content: [{ type: 'text', text: 'written' }] }
  })

  server.tool('document_append', {
    content: z.string().describe('Content to append to document'),
  }, async ({ content }) => {
    await provider.appendDocument(content)
    return { content: [{ type: 'text', text: 'appended' }] }
  })

  return { server, agentConnections }
}
```

### Provider Implementations

```typescript
// File-based provider (production)
class FileContextProvider implements ContextProvider {
  private mentionState: Map<string, string> = new Map()  // agent -> last ack timestamp

  constructor(
    private channelPath: string,
    private documentPath: string,
    private mentionStatePath: string,
    private validAgents: string[]
  ) {
    this.loadMentionState()
  }

  async appendChannel(from: string, message: string): Promise<ChannelEntry> {
    const timestamp = new Date().toISOString()
    const mentions = extractMentions(message, this.validAgents)
    const entry: ChannelEntry = { timestamp, from, message, mentions }

    // Append to markdown file
    const markdown = `\n### ${timestamp.slice(11, 19)} [${from}]\n${message}\n`
    await fs.appendFile(this.channelPath, markdown)

    return entry
  }

  async readChannel(since?: string, limit?: number): Promise<ChannelEntry[]> {
    const content = await fs.readFile(this.channelPath, 'utf-8')
    return parseChannelMarkdown(content, this.validAgents, since, limit)
  }

  async getUnreadMentions(agent: string): Promise<MentionNotification[]> {
    const lastAck = this.mentionState.get(agent) || ''
    const entries = await this.readChannel(lastAck)
    return entries
      .filter(e => e.mentions.includes(agent))
      .map(e => ({
        from: e.from,
        target: agent,
        message: e.message,
        timestamp: e.timestamp,
      }))
  }

  async acknowledgeMentions(agent: string, until: string): Promise<void> {
    this.mentionState.set(agent, until)
    await this.saveMentionState()
  }

  async readDocument(): Promise<string> {
    try {
      return await fs.readFile(this.documentPath, 'utf-8')
    } catch {
      return ''
    }
  }

  async writeDocument(content: string): Promise<void> {
    await fs.writeFile(this.documentPath, content)
  }

  async appendDocument(content: string): Promise<void> {
    await fs.appendFile(this.documentPath, content)
  }

  private loadMentionState() {
    try {
      const data = JSON.parse(fs.readFileSync(this.mentionStatePath, 'utf-8'))
      this.mentionState = new Map(Object.entries(data))
    } catch {
      // No state file yet
    }
  }

  private async saveMentionState() {
    const data = Object.fromEntries(this.mentionState)
    await fs.writeFile(this.mentionStatePath, JSON.stringify(data))
  }
}

// Memory provider (testing)
class MemoryContextProvider implements ContextProvider {
  private channel: ChannelEntry[] = []
  private document: string = ''
  private mentionState: Map<string, string> = new Map()

  constructor(private validAgents: string[]) {}

  async appendChannel(from: string, message: string): Promise<ChannelEntry> {
    const entry: ChannelEntry = {
      timestamp: new Date().toISOString(),
      from,
      message,
      mentions: extractMentions(message, this.validAgents),
    }
    this.channel.push(entry)
    return entry
  }

  async readChannel(since?: string, limit?: number): Promise<ChannelEntry[]> {
    let entries = this.channel
    if (since) entries = entries.filter(e => e.timestamp > since)
    if (limit) entries = entries.slice(-limit)
    return entries
  }

  async getUnreadMentions(agent: string): Promise<MentionNotification[]> {
    const lastAck = this.mentionState.get(agent) || ''
    return this.channel
      .filter(e => e.timestamp > lastAck && e.mentions.includes(agent))
      .map(e => ({ from: e.from, target: agent, message: e.message, timestamp: e.timestamp }))
  }

  async acknowledgeMentions(agent: string, until: string): Promise<void> {
    this.mentionState.set(agent, until)
  }

  async readDocument(): Promise<string> { return this.document }
  async writeDocument(content: string): Promise<void> { this.document = content }
  async appendDocument(content: string): Promise<void> { this.document += content }
}
```

### Transport Options

**For multi-agent workflows, use Unix socket** (recommended):

```typescript
import { createServer } from 'node:net'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'

// Unix socket avoids port conflicts and provides better isolation
const socketPath = `.workflow/${instance}/context.sock`

const transport = new StreamableHTTPServerTransport({
  sessionIdGenerator: (req) => req.headers.get('x-agent-id') || 'anonymous',
})

const unixServer = createServer((socket) => {
  // Handle HTTP-over-Unix-socket
})
unixServer.listen(socketPath)

await server.connect(transport)
```

**Alternative: HTTP transport** (when Unix socket not suitable):

```typescript
import { Hono } from 'hono'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'

const app = new Hono()
const transport = new StreamableHTTPServerTransport({
  sessionIdGenerator: (req) => req.headers.get('x-agent-id') || 'anonymous',
})

app.all('/mcp/*', async (c) => {
  return transport.handleRequest(c.req.raw)
})

await server.connect(transport)

// Use dynamic port to avoid conflicts
const port = await findAvailablePort(3100, 3200)
export default { port, fetch: app.fetch }
```

**For single-agent or testing, stdio works**:

```typescript
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'

// stdio is 1:1 - only one agent can connect
const transport = new StdioServerTransport()
await server.connect(transport)
```

### Agent Identity

Each agent identifies itself when connecting:

```typescript
// Via X-Agent-Id header (both Unix socket and HTTP)
const response = await fetch('unix://.workflow/pr-123/context.sock:/mcp', {
  headers: { 'X-Agent-Id': 'reviewer@pr-123' },
  // ... MCP request
})

// The sessionIdGenerator extracts this as the session ID
// All tool calls from this connection use this identity
```

### Agent Connection

Workflow runner passes MCP socket/URL to agents:

```typescript
// For SDK backend - MCP client with identity
import { McpClient } from '@modelcontextprotocol/sdk/client/mcp.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'

// Unix socket connection (preferred)
const socketPath = '.workflow/pr-123/context.sock'
const transport = new StreamableHTTPClientTransport({
  socketPath,
  headers: { 'X-Agent-Id': agentId },
})
const client = new McpClient()
await client.connect(transport)

// For CLI backends - via MCP configuration (see below)

// For unsupported backends - CLI wrapper
agent-worker context send "message" --agent reviewer@pr-123
agent-worker context read --agent reviewer@pr-123
```

### CLI Backend MCP Configuration

All major CLI backends support MCP at runtime via config flags - no permanent configuration changes needed.

**MCP Config File Format** (generated per workflow instance):
```json
// .workflow/pr-123/mcp.json
{
  "mcpServers": {
    "workflow-context": {
      "type": "stdio",
      "command": "node",
      "args": [".workflow/pr-123/context-server.js"]
    }
  }
}
```

**Claude CLI** (runtime flags):
```bash
# Pass MCP config at runtime (temporary, no permanent changes)
claude -p --mcp-config .workflow/pr-123/mcp.json "your prompt"

# Use --strict-mcp-config to ONLY use this config, ignore user's other MCP servers
claude -p --strict-mcp-config --mcp-config .workflow/pr-123/mcp.json "your prompt"

# Can also pass JSON string directly
claude -p --mcp-config '{"mcpServers":{"context":{"type":"stdio","command":"node","args":["server.js"]}}}' "prompt"
```

**Codex CLI**:
```bash
# Similar runtime config approach
codex --mcp-config .workflow/pr-123/mcp.json "your prompt"
```

**Cursor Agent**:
```bash
# Uses project-level .cursor/mcp.json (created/cleaned per workflow)
cursor-agent --config .workflow/pr-123/.cursor/mcp.json "your prompt"
```

### CLI Backend Tool Support via MCP

With MCP support, CLI backends can now use custom tools that were previously only available to SDK backends:

| Feature | Before MCP | With MCP |
|---------|------------|----------|
| Custom tools | SDK only | All backends |
| Channel access | Wrapper CLI | Native tools |
| @mention notifications | Not possible | MCP notifications |
| Document read/write | Wrapper CLI | Native tools |

**Workflow runner passes MCP config at runtime**:
```typescript
// When starting a Claude CLI agent in workflow
async function startClaudeAgent(
  agentId: string,
  mcpConfigPath: string,
  systemPrompt: string
) {
  // No permanent config changes - pass at runtime
  await exec(`claude -p \
    --strict-mcp-config \
    --mcp-config ${mcpConfigPath} \
    --system-prompt "${systemPrompt}" \
    "You are ${agentId}. Check channel_mentions for your tasks."
  `)
}
```

**Key benefit**: Runtime config means:
- No pollution of user's global MCP settings
- Each workflow instance has isolated MCP context
- Automatic cleanup (just delete the workflow directory)

### Workflow Startup Flow

```
1. Parse workflow file
2. Create ContextProvider (file or memory)
3. Start Context MCP Server
4. For each agent:
   a. Start agent process
   b. Connect agent to MCP server
5. Send kickoff message to channel
6. Agents collaborate via MCP tools
7. On completion/stop: cleanup
```

---

## CLI Commands

### Unified Agent Namespace

All agents (standalone or workflow) share the same namespace:

```
agent-name           # Standalone agent
agent-name@instance  # Workflow agent
@instance            # Instance group (for batch ops)
```

### Command Reference

```bash
# One-shot execution (exits when no agents working)
agent-worker run <file> [options]

# Persistent mode (keeps running until stopped)
agent-worker start <file> [options]

# Stop agents
agent-worker stop [target]

# List agents
agent-worker list
agent-worker ls              # alias

# Standalone agent management
agent-worker new <name>
agent-worker send <message>
agent-worker peek
```

### Command Details

#### `agent-worker run <file>`

Execute workflow and exit when complete.

```bash
agent-worker run review.yaml
agent-worker run review.yaml --instance pr-123
agent-worker run review.yaml --verbose
agent-worker run review.yaml --json
```

**Completion**: Exits when no agents are actively working.

**Behavior**:
1. Parse workflow file
2. Execute setup tasks
3. Send kickoff to channel (triggers @mentioned agents)
4. Agents collaborate via channel/@mention
5. Wait until all agents idle
6. Output results and exit

#### `agent-worker start <file>`

Start workflow in persistent mode.

```bash
agent-worker start review.yaml
agent-worker start review.yaml --instance pr-123
agent-worker start review.yaml --background
```

**Behavior**:
1. Parse workflow file
2. Execute setup tasks
3. Send kickoff to channel
4. Keep running until manually stopped
5. Agents can continue collaborating indefinitely

#### `agent-worker stop [target]`

Stop running agents.

```bash
agent-worker stop reviewer           # Stop standalone agent
agent-worker stop reviewer@pr-123    # Stop specific workflow agent
agent-worker stop @pr-123            # Stop all agents in instance
agent-worker stop --all              # Stop everything
```

#### `agent-worker list`

List all running agents.

```bash
$ agent-worker list

NAME                 SOURCE          STATUS
reviewer             (standalone)    running
coder                (standalone)    idle
reviewer@pr-123      review.yaml     running
coder@pr-123         review.yaml     running
helper@pr-456        review.yaml     idle
```

#### `agent-worker send <message>`

Send message to agent.

```bash
agent-worker send "hello"                    # To default/active agent
agent-worker send "hello" --to reviewer      # To standalone
agent-worker send "hello" --to coder@pr-123  # To workflow agent
```

### Options Reference

| Option | Commands | Description |
|--------|----------|-------------|
| `--instance <name>` | run, start, new | Instance name (default: `default`) |
| `--to <target>` | send, peek | Target agent |
| `--background` | start | Run in background |
| `--verbose` | run, start | Show detailed progress |
| `--json` | run, list, send | JSON output |
| `--all` | stop | Stop all agents |

---

## Variable Interpolation

Variables use `${{ name }}` syntax:

```yaml
setup:
  - shell: gh pr diff
    as: diff

kickoff: |
  Review this PR:
  ${{ diff }}

  @reviewer please analyze
```

**Reserved variables:**
- `${{ env.VAR_NAME }}` - Environment variables
- `${{ workflow.name }}` - Workflow name
- `${{ workflow.instance }}` - Instance name
- `${{ context.channel }}` - Channel file path
- `${{ context.document }}` - Document file path

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
│              Execute setup tasks                     │
│         (shell commands, variable capture)           │
└─────────────────────────┬───────────────────────────┘
                          │
                          ▼
┌─────────────────────────────────────────────────────┐
│            Send kickoff to channel                   │
│         (@mentioned agents get triggered)            │
└─────────────────────────┬───────────────────────────┘
                          │
                          ▼
┌─────────────────────────────────────────────────────┐
│           Agents collaborate via channel             │
│      (read, write, @mention each other)              │
└─────────────────────────┬───────────────────────────┘
                          │
                          ▼
┌─────────────────────────────────────────────────────┐
│            All agents idle? ──────────────────┐     │
│                    │                          │     │
│                   Yes                         No    │
│                    │                          │     │
│                    ▼                          │     │
│               Exit with results      (continue)     │
└─────────────────────────────────────────────────────┘
```

### Start Mode

```
┌─────────────────────────────────────────────────────┐
│                   start command                      │
└─────────────────────────┬───────────────────────────┘
                          │
                          ▼
┌─────────────────────────────────────────────────────┐
│     Execute setup + Send kickoff (same as run)      │
└─────────────────────────┬───────────────────────────┘
                          │
                          ▼
┌─────────────────────────────────────────────────────┐
│              Keep running indefinitely               │
│                                                      │
│   - Agents collaborate via channel                  │
│   - External messages can be sent via CLI           │
│   - New @mentions trigger agents                    │
│                                                      │
│               (until `stop` command)                 │
└─────────────────────────────────────────────────────┘
```

---

## Examples

### Simple Review Workflow

```yaml
name: review
context:

agents:
  reviewer:
    model: anthropic/claude-sonnet-4-5
    system_prompt: |
      You review code for quality and issues.
      Use the channel tool to communicate.
      Use the document tool to record findings.

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
context:

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

setup:
  - shell: gh pr view --json title,body,files
    as: pr_info

kickoff: |
  New PR to review:
  ${{ pr_info }}

  @coordinator please orchestrate the review.
  - Use @reviewer for code review
  - Use @coder for any fixes needed
```

### Standalone Agent + Channel

```bash
# Create standalone agent with context access
agent-worker new helper --context

# It can now use channel/document tools
agent-worker send "Check the notes in the document"
```

---

## Implementation Phases

### Phase 1: Context Provider
- [ ] Define `ContextProvider` interface
- [ ] Implement `FileContextProvider` (markdown storage)
- [ ] Implement `MemoryContextProvider` (testing)
- [ ] Channel: append-only with @mention extraction
- [ ] Document: read/write workspace

### Phase 2: Context MCP Server
- [ ] Add `@modelcontextprotocol/sdk` dependency
- [ ] Create `createContextMCPServer()` function
- [ ] Implement tools: `channel_send`, `channel_read`, `channel_peek`
- [ ] Implement tools: `document_read`, `document_write`, `document_append`
- [ ] Implement `notifications/mention` for @mention push
- [ ] Unix socket transport (primary)
- [ ] HTTP transport (fallback, with dynamic port allocation)
- [ ] stdio transport (testing)

### Phase 3: Kickoff Model
- [ ] Update workflow schema: `setup` + `kickoff` (replace `tasks`)
- [ ] Parse and validate new schema
- [ ] Send kickoff to channel on workflow start
- [ ] Trigger agents on @mention via MCP notification

### Phase 4: CLI Updates
- [ ] Rename `up` → `start`
- [ ] Rename `down` → `stop`
- [ ] Rename `ps` → `list`
- [ ] Unify standalone and workflow agent listing
- [ ] Add `context` subcommand for CLI fallback

### Phase 5: Run/Start Modes
- [ ] Run mode: exit when all agents idle
- [ ] Start mode: persistent until stop
- [ ] Background mode for start
- [ ] Integrate MCP server lifecycle with workflow

### Phase 6: Agent MCP Integration
- [ ] SDK backend: inject MCP client with Unix socket
- [ ] Generate per-instance mcp.json config file
- [ ] Claude CLI: pass `--mcp-config` and `--strict-mcp-config` at runtime
- [ ] Codex CLI: pass `--mcp-config` at runtime
- [ ] Cursor Agent: generate `.cursor/mcp.json` per workflow
- [ ] Fallback: `agent-worker context` CLI wrapper

---

## Migration from v1

### CLI Changes

```bash
# Before (v1)
agent-worker up workflow.yaml
agent-worker down
agent-worker ps

# After (v2)
agent-worker start workflow.yaml
agent-worker stop
agent-worker list
```

### Workflow Changes

```yaml
# Before (v1) - tasks-based
tasks:
  - shell: gh pr diff
    as: diff
  - send: "Review: ${{ diff }}"
    to: reviewer
    as: review
  - send: "Fix issues: ${{ review }}"
    to: coder

# After (v2) - kickoff-based
setup:
  - shell: gh pr diff
    as: diff

kickoff: |
  PR diff:
  ${{ diff }}

  @reviewer please review.
  When done, @coder for fixes.
```

---

## Design Decisions

### 1. Why Kickoff Instead of Tasks?

**Tasks** (v1) were procedural - explicit sequence of steps:
- Rigid execution order
- Manual `wait_mention` for coordination
- Poor fit for autonomous agent collaboration

**Kickoff** (v2) is declarative - describe goal, let agents coordinate:
- Natural language work description
- @mention for automatic coordination
- Agents decide their own actions

### 2. Why Separate Channel and Document?

- **Channel** = communication (who said what, when)
- **Document** = workspace (current state, findings)

Combining them would mix transient messages with persistent content.

### 3. Why Default Context Enabled?

Most workflows benefit from shared context. The minimal config:

```yaml
context:
```

Enables both channel and document with sensible defaults. Explicit opt-out:

```yaml
# No context - agents can't communicate
# (omit context field entirely)
```

### 4. Run vs Start Completion

- **Run**: Complete when no agents actively working (auto-detect idle)
- **Start**: Never complete until manual `stop`

No need for explicit `completion:` config - the command choice determines behavior.

---

## References

- [Docker Compose](https://docs.docker.com/compose/) - Service orchestration inspiration
- [Slack API](https://api.slack.com/) - Channel/mention model
- [GitHub Actions](https://docs.github.com/en/actions) - Variable syntax
