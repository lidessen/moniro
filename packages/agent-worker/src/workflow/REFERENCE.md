# Agent Worker Technical Reference

Implementation reference for the Agent Worker workflow system. For design concepts and decisions, see [DESIGN.md](./DESIGN.md).

---

## Table of Contents

1. [Schema Definition](#schema-definition)
2. [Context Provider](#context-provider)
3. [MCP Server](#mcp-server)
4. [Agent Controller](#agent-controller)
5. [Backend Abstraction](#backend-abstraction)
6. [CLI Commands](#cli-commands)
7. [Variable Interpolation](#variable-interpolation)

---

## Schema Definition

### Workflow Schema

```typescript
interface WorkflowSchema {
  /** Workflow name (used for identification) */
  name: string;

  /** Context configuration */
  context?: ContextConfig;

  /** Agent definitions */
  agents: Record<string, AgentConfig>;

  /** Setup tasks (shell commands, variable capture) */
  setup?: SetupTask[];

  /** Kickoff message (triggers workflow) */
  kickoff: string;
}

interface AgentConfig {
  /** Model identifier (e.g., 'anthropic/claude-sonnet-4-5') */
  model: string;

  /** System prompt (inline or file path) */
  system_prompt: string;

  /** Optional tools configuration */
  tools?: ToolConfig[];
}

interface SetupTask {
  /** Shell command to execute */
  shell: string;

  /** Variable name to capture output */
  as?: string;

  /** Working directory */
  cwd?: string;
}
```

### Context Configuration

```typescript
/** Context configuration: false to disable, or provider config */
type ContextConfig = false | FileContextConfig | MemoryContextConfig;

interface FileContextConfig {
  provider: "file";
  /** Document owner (cross-provider config) */
  documentOwner?: string;
  config?: {
    dir?: string; // default: .workflow/${{ instance }}/
    channel?: string; // default: channel.md (in dir)
    documentDir?: string; // default: documents/ (in dir)
    document?: string; // default: notes.md (in documentDir)
  };
}

interface MemoryContextConfig {
  provider: "memory";
  /** Document owner (cross-provider config) */
  documentOwner?: string;
}

const CONTEXT_DEFAULTS = {
  dir: ".workflow/${{ instance }}/",
  channel: "channel.md",
  documentDir: "documents/",
  document: "notes.md",
};
```

### Model Parsing

```typescript
/** Parse model string to provider and version */
function parseModel(model: string): { provider: string; model: string } {
  // Format: provider/model-name or just model-name
  const parts = model.split("/");
  if (parts.length === 2) {
    return { provider: parts[0], model: resolveModelVersion(parts[1]) };
  }
  return { provider: "anthropic", model: resolveModelVersion(model) };
}

/** Resolve model aliases to specific versions */
function resolveModelVersion(model: string): string {
  const aliases: Record<string, string> = {
    "claude-sonnet-4-5": "claude-sonnet-4-5-20250514",
    "claude-opus-4": "claude-opus-4-20250514",
    "claude-haiku-3-5": "claude-haiku-3-5-20250514",
  };
  return aliases[model] || model;
}
```

---

## Context Provider

### Interface

```typescript
interface ContextProvider {
  /** Append message to channel */
  appendChannel(from: string, message: string): Promise<ChannelEntry>;

  /** Read channel entries */
  readChannel(since?: string, limit?: number): Promise<ChannelEntry[]>;

  /** Get unread inbox messages for agent */
  getInbox(agent: string): Promise<InboxMessage[]>;

  /** Acknowledge inbox messages up to timestamp */
  ackInbox(agent: string, until: string): Promise<void>;

  /** Read document content */
  readDocument(file?: string): Promise<string>;

  /** Write document content */
  writeDocument(content: string, file?: string): Promise<void>;

  /** Append to document */
  appendDocument(content: string, file?: string): Promise<void>;

  /** List document files */
  listDocuments(): Promise<string[]>;

  /** Create new document */
  createDocument(file: string, content: string): Promise<void>;
}
```

### Types

```typescript
interface ChannelEntry {
  /** Sender identifier */
  from: string;
  /** Message content */
  message: string;
  /** ISO timestamp */
  timestamp: string;
  /** Extracted @mentions */
  mentions: string[];
}

interface InboxMessage {
  /** Original channel entry */
  entry: ChannelEntry;
  /** Is this message unread? */
  unread: boolean;
  /** Priority level */
  priority: "normal" | "high";
}

interface InboxState {
  /** Per-agent read cursor (timestamp of last read message) */
  readCursors: Map<string, string>;
}
```

### Priority Detection

```typescript
function calculatePriority(entry: ChannelEntry): "normal" | "high" {
  // Multiple mentions = coordination needed
  if (entry.mentions.length > 1) return "high";

  // Urgent keywords
  const urgentPatterns = /\b(urgent|asap|blocked|critical)\b/i;
  if (urgentPatterns.test(entry.message)) return "high";

  return "normal";
}
```

### File Provider Implementation

```typescript
class FileContextProvider implements ContextProvider {
  private channelPath: string;
  private documentDir: string;
  private mentionState: Map<string, string> = new Map();

  constructor(
    config: FileContextConfig,
    private validAgents: string[],
  ) {
    const dir = config.config?.dir || CONTEXT_DEFAULTS.dir;
    this.channelPath = join(dir, config.config?.channel || CONTEXT_DEFAULTS.channel);
    this.documentDir = join(dir, config.config?.documentDir || CONTEXT_DEFAULTS.documentDir);
  }

  async appendChannel(from: string, message: string): Promise<ChannelEntry> {
    const timestamp = new Date().toISOString();
    const mentions = extractMentions(message, this.validAgents);
    const entry = { from, message, timestamp, mentions };

    const markdown = `\n### ${timestamp.slice(11, 19)} [${from}]\n${message}\n`;
    await fs.appendFile(this.channelPath, markdown);

    return entry;
  }

  async readChannel(since?: string, limit?: number): Promise<ChannelEntry[]> {
    const content = await fs.readFile(this.channelPath, "utf-8");
    return parseChannelMarkdown(content, this.validAgents, since, limit);
  }

  async getInbox(agent: string): Promise<InboxMessage[]> {
    const lastAck = this.mentionState.get(agent) || "";
    const entries = await this.readChannel(lastAck);
    return entries
      .filter((e) => e.mentions.includes(agent))
      .map((e) => ({
        entry: e,
        unread: true,
        priority: calculatePriority(e),
      }));
  }

  async ackInbox(agent: string, until: string): Promise<void> {
    this.mentionState.set(agent, until);
    await this.saveMentionState();
  }

  async readDocument(file?: string): Promise<string> {
    const path = file
      ? join(this.documentDir, file)
      : join(this.documentDir, CONTEXT_DEFAULTS.document);
    try {
      return await fs.readFile(path, "utf-8");
    } catch {
      return "";
    }
  }

  async writeDocument(content: string, file?: string): Promise<void> {
    const path = file
      ? join(this.documentDir, file)
      : join(this.documentDir, CONTEXT_DEFAULTS.document);
    await fs.mkdir(dirname(path), { recursive: true });
    await fs.writeFile(path, content);
  }

  async appendDocument(content: string, file?: string): Promise<void> {
    const existing = await this.readDocument(file);
    await this.writeDocument(existing + content, file);
  }

  async listDocuments(): Promise<string[]> {
    return await glob("**/*.md", { cwd: this.documentDir });
  }

  async createDocument(file: string, content: string): Promise<void> {
    const path = join(this.documentDir, file);
    if (
      await fs
        .access(path)
        .then(() => true)
        .catch(() => false)
    ) {
      throw new Error(`Document already exists: ${file}`);
    }
    await this.writeDocument(content, file);
  }
}
```

### Memory Provider Implementation

```typescript
class MemoryContextProvider implements ContextProvider {
  private channel: ChannelEntry[] = [];
  private document: string = "";
  private documents: Map<string, string> = new Map();
  private mentionState: Map<string, string> = new Map();

  constructor(private validAgents: string[]) {}

  async appendChannel(from: string, message: string): Promise<ChannelEntry> {
    const entry = {
      from,
      message,
      timestamp: new Date().toISOString(),
      mentions: extractMentions(message, this.validAgents),
    };
    this.channel.push(entry);
    return entry;
  }

  async readChannel(since?: string, limit?: number): Promise<ChannelEntry[]> {
    let entries = since ? this.channel.filter((e) => e.timestamp > since) : this.channel;
    if (limit) entries = entries.slice(-limit);
    return entries;
  }

  async getInbox(agent: string): Promise<InboxMessage[]> {
    const lastAck = this.mentionState.get(agent) || "";
    return this.channel
      .filter((e) => e.timestamp > lastAck && e.mentions.includes(agent))
      .map((e) => ({ entry: e, unread: true, priority: calculatePriority(e) }));
  }

  async ackInbox(agent: string, until: string): Promise<void> {
    this.mentionState.set(agent, until);
  }

  async readDocument(file?: string): Promise<string> {
    return file ? this.documents.get(file) || "" : this.document;
  }

  async writeDocument(content: string, file?: string): Promise<void> {
    if (file) {
      this.documents.set(file, content);
    } else {
      this.document = content;
    }
  }

  async appendDocument(content: string, file?: string): Promise<void> {
    const existing = await this.readDocument(file);
    await this.writeDocument(existing + content, file);
  }

  async listDocuments(): Promise<string[]> {
    return [...this.documents.keys()];
  }

  async createDocument(file: string, content: string): Promise<void> {
    if (this.documents.has(file)) {
      throw new Error(`Document already exists: ${file}`);
    }
    this.documents.set(file, content);
  }
}
```

### Mention Extraction

```typescript
function extractMentions(message: string, validAgents: string[]): string[] {
  const mentionPattern = /@(\w+)/g;
  const matches = [...message.matchAll(mentionPattern)];
  return matches.map((m) => m[1]).filter((name) => validAgents.includes(name));
}
```

---

## MCP Server

### Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                    MCP Server Architecture                       │
│                                                                  │
│  ┌──────────────┐     ┌──────────────────┐     ┌─────────────┐ │
│  │   Agent 1    │     │    MCP Server    │     │   Context   │ │
│  │  (Claude)    │────▶│                  │────▶│  Provider   │ │
│  └──────────────┘     │  - channel_send  │     │             │ │
│                       │  - channel_read  │     │  - Channel  │ │
│  ┌──────────────┐     │  - inbox_check   │     │  - Document │ │
│  │   Agent 2    │────▶│  - inbox_ack     │     │  - Inbox    │ │
│  │  (Codex)     │     │  - document_*    │     │             │ │
│  └──────────────┘     │  - proposal_*    │     └─────────────┘ │
│                       └──────────────────┘                      │
└─────────────────────────────────────────────────────────────────┘
```

### Server Creation

```typescript
interface MCPServerOptions {
  provider: ContextProvider;
  validAgents: string[];
  documentOwner?: string;
  onMention?: (from: string, target: string, entry: ChannelEntry) => void;
}

function createContextMCPServer(options: MCPServerOptions) {
  const { provider, validAgents, documentOwner, onMention } = options;
  const server = new McpServer({ name: "workflow-context", version: "1.0.0" });

  // Channel tools
  server.tool(
    "channel_send",
    {
      message: z.string().describe("Message to send"),
    },
    async ({ message }, extra) => {
      const from = extra.sessionId;
      const entry = await provider.appendChannel(from, message);

      // Notify mentioned agents
      if (onMention) {
        for (const target of entry.mentions) {
          onMention(from, target, entry);
        }
      }

      return { content: [{ type: "text", text: `Sent to channel` }] };
    },
  );

  server.tool(
    "channel_read",
    {
      since: z.string().optional(),
      limit: z.number().optional().default(50),
    },
    async ({ since, limit }) => {
      const entries = await provider.readChannel(since, limit);
      return { content: [{ type: "text", text: formatChannel(entries) }] };
    },
  );

  // Inbox tools
  server.tool("inbox_check", {}, async (_, extra) => {
    const agent = extra.sessionId;
    const messages = await provider.getInbox(agent);
    return { content: [{ type: "text", text: formatInbox(messages) }] };
  });

  server.tool(
    "inbox_ack",
    {
      until: z.string().describe("Acknowledge messages up to this timestamp"),
    },
    async ({ until }, extra) => {
      await provider.ackInbox(extra.sessionId, until);
      return { content: [{ type: "text", text: "Acknowledged" }] };
    },
  );

  // Document tools
  server.tool(
    "document_read",
    {
      file: z.string().optional(),
    },
    async ({ file }) => {
      const content = await provider.readDocument(file);
      return { content: [{ type: "text", text: content || "(empty)" }] };
    },
  );

  server.tool(
    "document_write",
    {
      content: z.string(),
      file: z.string().optional(),
    },
    async ({ content, file }, extra) => {
      // Ownership check
      if (documentOwner && extra.sessionId !== documentOwner) {
        return {
          content: [
            {
              type: "text",
              text: `Error: Only @${documentOwner} can write documents. Use document_suggest instead.`,
            },
          ],
        };
      }
      await provider.writeDocument(content, file);
      return { content: [{ type: "text", text: "Written" }] };
    },
  );

  server.tool(
    "document_append",
    {
      content: z.string(),
      file: z.string().optional(),
    },
    async ({ content, file }, extra) => {
      // Ownership check
      if (documentOwner && extra.sessionId !== documentOwner) {
        return {
          content: [
            {
              type: "text",
              text: `Error: Only @${documentOwner} can append to documents. Use document_suggest instead.`,
            },
          ],
        };
      }
      await provider.appendDocument(content, file);
      return { content: [{ type: "text", text: "Appended" }] };
    },
  );

  server.tool("document_list", {}, async () => {
    const files = await provider.listDocuments();
    return { content: [{ type: "text", text: files.join("\n") || "(no documents)" }] };
  });

  server.tool(
    "document_create",
    {
      file: z.string().describe("File path relative to documents/"),
      content: z.string().describe("Initial content"),
    },
    async ({ file, content }, extra) => {
      // Ownership check
      if (documentOwner && extra.sessionId !== documentOwner) {
        return {
          content: [
            {
              type: "text",
              text: `Error: Only @${documentOwner} can create documents. Use document_suggest instead.`,
            },
          ],
        };
      }
      await provider.createDocument(file, content);
      return { content: [{ type: "text", text: `Created ${file}` }] };
    },
  );

  server.tool(
    "document_suggest",
    {
      suggestion: z.string(),
      file: z.string().optional(),
    },
    async ({ suggestion, file }, extra) => {
      if (!documentOwner) {
        return { content: [{ type: "text", text: "No document owner set" }] };
      }
      const target = file ? `to ${file}` : "";
      await provider.appendChannel(
        extra.sessionId,
        `@${documentOwner} Document suggestion${target}:\n${suggestion}`,
      );
      return { content: [{ type: "text", text: `Suggestion sent to @${documentOwner}` }] };
    },
  );

  // Agent discovery
  server.tool("workflow_agents", {}, async () => {
    return { content: [{ type: "text", text: validAgents.join(", ") }] };
  });

  // Proposal tools (see Proposal & Voting System section for types)
  server.tool(
    "proposal_create",
    {
      type: z.enum(["election", "decision", "approval", "assignment"]),
      title: z.string(),
      description: z.string().optional(),
      options: z.array(z.object({ id: z.string(), label: z.string() })).optional(),
      resolution: z
        .object({
          type: z.enum(["plurality", "majority", "unanimous"]),
          quorum: z.number().optional(),
          tieBreaker: z.enum(["first", "random", "creator-decides"]).optional(),
        })
        .optional(),
      binding: z.boolean().optional(),
      timeoutSeconds: z.number().optional(),
    },
    async (params, extra) => {
      // Implementation in Proposal & Voting System section
    },
  );

  server.tool(
    "vote",
    {
      proposal: z.string().describe("Proposal ID"),
      choice: z.string().describe("Option ID to vote for"),
      reason: z.string().optional(),
    },
    async ({ proposal, choice, reason }, extra) => {
      // Implementation in Proposal & Voting System section
    },
  );

  server.tool(
    "proposal_status",
    {
      proposal: z.string().optional().describe("Proposal ID (omit for all active)"),
    },
    async ({ proposal }) => {
      // Implementation in Proposal & Voting System section
    },
  );

  server.tool(
    "proposal_cancel",
    {
      proposal: z.string().describe("Proposal ID"),
    },
    async ({ proposal }, extra) => {
      // Implementation in Proposal & Voting System section
    },
  );

  return { server };
}
```

### Transport Options

```typescript
// Unix socket (primary - used by workflow runner)
const transport = new StdioServerTransport();
await server.connect(transport);

// For CLI backends, generate MCP config file:
const mcpConfig = {
  mcpServers: {
    "workflow-context": {
      type: "stdio",
      command: "node",
      args: [".workflow/instance/context-server.js"],
    },
  },
};
```

---

## Agent Controller

### Interface

```typescript
interface AgentController {
  /** Agent name */
  name: string;

  /** Current state */
  state: "idle" | "running" | "stopped";

  /** Start the controller (begin polling loop) */
  start(): Promise<void>;

  /** Stop the controller */
  stop(): Promise<void>;

  /** Interrupt: immediately check inbox (skip poll wait) */
  wake(): void;
}

interface AgentControllerConfig {
  name: string;
  agent: ResolvedAgent;
  contextProvider: ContextProvider;
  mcpSocketPath: string;
  pollInterval?: number; // default: 5000
  retry?: RetryConfig;
  runAgent: (context: AgentRunContext) => Promise<AgentRunResult>;
}

interface RetryConfig {
  maxAttempts?: number; // default: 3
  backoffMs?: number; // default: 1000
  backoffMultiplier?: number; // default: 2
}
```

### Agent Run Context

```typescript
interface AgentRunContext {
  /** Agent name */
  name: string;

  /** Agent config */
  agent: ResolvedAgent;

  /** Unread inbox messages */
  inbox: InboxMessage[];

  /** Recent channel entries (for context) */
  recentChannel: ChannelEntry[];

  /** Current document content (entry point) */
  documentContent: string;

  /** MCP socket path */
  mcpSocketPath: string;

  /** Retry attempt number (1 = first try, 2+ = retry) */
  retryAttempt: number;
}

interface AgentRunResult {
  success: boolean;
  error?: string;
  duration: number;
}
```

### Controller Implementation

```typescript
async function controllerLoop(config: AgentControllerConfig) {
  const provider = config.contextProvider;

  while (state !== "stopped") {
    await waitForWakeOrPoll();

    const inbox = await provider.getInbox(config.name);
    if (inbox.length === 0) continue;

    const latestTimestamp = inbox[inbox.length - 1].entry.timestamp;

    let attempt = 0;
    const maxAttempts = config.retry?.maxAttempts ?? 3;

    while (attempt < maxAttempts) {
      attempt++;
      state = "running";

      const result = await config.runAgent({
        name: config.name,
        agent: config.agent,
        inbox,
        recentChannel: await provider.readChannel(undefined, 50),
        documentContent: await provider.readDocument(),
        mcpSocketPath: config.mcpSocketPath,
        retryAttempt: attempt,
      });

      if (result.success) {
        // Acknowledge inbox ONLY on success
        await provider.ackInbox(config.name, latestTimestamp);
        break;
      }

      // Retry with backoff
      if (attempt < maxAttempts) {
        const delay =
          (config.retry?.backoffMs ?? 1000) *
          Math.pow(config.retry?.backoffMultiplier ?? 2, attempt - 1);
        await sleep(delay);
      }
    }

    state = "idle";
  }
}
```

### Idle Detection

```typescript
interface WorkflowIdleState {
  allControllersIdle: boolean;
  noUnreadMessages: boolean;
  noActivePendingProposals: boolean;
  idleDebounceElapsed: boolean;
}

function isWorkflowComplete(state: WorkflowIdleState): boolean {
  return (
    state.allControllersIdle &&
    state.noUnreadMessages &&
    state.noActivePendingProposals &&
    state.idleDebounceElapsed
  );
}

async function checkWorkflowIdle(
  controllers: Map<string, AgentController>,
  provider: ContextProvider,
  proposals: Map<string, Proposal>,
  debounceMs: number = 2000,
): Promise<boolean> {
  const allIdle = [...controllers.values()].every((c) => c.state === "idle");
  if (!allIdle) return false;

  for (const [name] of controllers) {
    const inbox = await provider.getInbox(name);
    if (inbox.length > 0) return false;
  }

  const activeProposals = [...proposals.values()].filter((p) => p.status === "active");
  if (activeProposals.length > 0) return false;

  await sleep(debounceMs);
  return [...controllers.values()].every((c) => c.state === "idle");
}
```

---

## Backend Abstraction

### Interface

```typescript
interface AgentBackend {
  name: string;
  run(ctx: AgentRunContext): Promise<AgentRunResult>;
}
```

### SDK Backend

```typescript
class SDKBackend implements AgentBackend {
  name = "sdk";

  constructor(private client: Anthropic) {}

  async run(ctx: AgentRunContext): Promise<AgentRunResult> {
    const startTime = Date.now();
    const messages: Message[] = [{ role: "user", content: buildAgentPrompt(ctx) }];

    try {
      const tools = await getMCPTools(ctx.mcpSocketPath);

      while (true) {
        const response = await this.client.messages.create({
          model: parseModel(ctx.agent.model).model,
          system: ctx.agent.resolvedSystemPrompt,
          messages,
          tools,
          max_tokens: 4096,
        });

        if (response.stop_reason === "end_turn") break;

        const toolResults = await handleToolCalls(response, ctx.mcpSocketPath);
        messages.push({ role: "assistant", content: response.content });
        messages.push({ role: "user", content: toolResults });
      }

      return { success: true, duration: Date.now() - startTime };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
        duration: Date.now() - startTime,
      };
    }
  }
}
```

### CLI Backend

```typescript
class CLIBackend implements AgentBackend {
  constructor(
    public name: string,
    private command: string,
    private buildArgs: (ctx: AgentRunContext, mcpConfigPath: string) => string[],
  ) {}

  async run(ctx: AgentRunContext): Promise<AgentRunResult> {
    const startTime = Date.now();

    try {
      const mcpConfigPath = `/tmp/agent-${ctx.name}-mcp.json`;
      writeFileSync(mcpConfigPath, JSON.stringify(generateMCPConfig(ctx.mcpSocketPath)));

      const args = this.buildArgs(ctx, mcpConfigPath);
      const { stdout, stderr } = await exec(`${this.command} ${args.join(" ")}`);

      const error = detectCLIError(stdout, stderr, 0);
      if (error) {
        return { success: false, error, duration: Date.now() - startTime };
      }

      return { success: true, duration: Date.now() - startTime };
    } catch (error: any) {
      return {
        success: false,
        error: error.message || String(error),
        duration: Date.now() - startTime,
      };
    }
  }
}

const CLI_ERROR_PATTERNS = [
  /\bError:/i,
  /\bFailed to\b/i,
  /\bException:/i,
  /rate limit/i,
  /API error/i,
  /connection refused/i,
];

function detectCLIError(stdout: string, stderr: string, exitCode: number): string | undefined {
  if (exitCode !== 0) {
    return `Process exited with code ${exitCode}`;
  }

  for (const pattern of CLI_ERROR_PATTERNS) {
    const match = stderr.match(pattern) || stdout.match(pattern);
    if (match) {
      return `Error detected: ${match[0]}`;
    }
  }

  return undefined;
}
```

### Backend Selection

```typescript
function getBackendForModel(model: string): AgentBackend {
  const { provider } = parseModel(model);

  switch (provider) {
    case "anthropic":
      return new SDKBackend(new Anthropic());
    case "claude":
      return new CLIBackend("claude", "claude", (ctx, mcp) => [
        "-p",
        "--mcp-config",
        mcp,
        "--system-prompt",
        ctx.agent.resolvedSystemPrompt,
        buildAgentPrompt(ctx),
      ]);
    case "codex":
      return new CLIBackend("codex", "codex", (ctx, mcp) => [buildAgentPrompt(ctx)]);
    default:
      throw new Error(`Unknown provider: ${provider}`);
  }
}
```

---

## CLI Commands

### Command Reference

| Command                       | Description        |
| ----------------------------- | ------------------ |
| `agent-worker run <file>`     | One-shot execution |
| `agent-worker start <file>`   | Persistent mode    |
| `agent-worker stop [target]`  | Stop agents        |
| `agent-worker list`           | List agents        |
| `agent-worker send <message>` | Send message       |
| `agent-worker new <name>`     | Create standalone  |
| `agent-worker peek`           | Check inbox        |

### Options

| Option              | Commands        | Description       |
| ------------------- | --------------- | ----------------- |
| `--instance <name>` | run, start, new | Instance name     |
| `--to <target>`     | send, peek      | Target pattern    |
| `--background`      | start           | Run in background |
| `--verbose`         | run, start      | Detailed output   |
| `--json`            | run, list, send | JSON output       |
| `--all`             | stop            | Stop all agents   |

### Send Target Patterns

```typescript
async function handleSend(message: string, to?: string) {
  if (!to) {
    // Default standalone agent
    return sendToStandalone(getDefaultAgent(), message);
  }

  if (to.startsWith("@")) {
    // @instance → broadcast to channel
    const instance = to.slice(1);
    return sendToChannel(instance, "user", message);
  }

  if (to.includes("@")) {
    // agent@instance → channel with @mention
    const [agent, instance] = to.split("@");
    return sendToChannel(instance, "user", `@${agent} ${message}`);
  }

  // Standalone agent
  return sendToStandalone(to, message);
}
```

| Pattern               | Target           | Effect             |
| --------------------- | ---------------- | ------------------ |
| `--to agent`          | Standalone agent | Direct to inbox    |
| `--to agent@instance` | Workflow agent   | Channel + @mention |
| `--to @instance`      | Workflow channel | Broadcast          |

---

## Variable Interpolation

### Syntax

Variables use `${{ name }}` syntax in workflow files:

```yaml
setup:
  - shell: gh pr diff
    as: diff

kickoff: |
  Review this PR:
  ${{ diff }}
```

### Reserved Variables

| Variable                   | Description          |
| -------------------------- | -------------------- |
| `${{ env.VAR_NAME }}`      | Environment variable |
| `${{ workflow.name }}`     | Workflow name        |
| `${{ workflow.instance }}` | Instance name        |
| `${{ context.channel }}`   | Channel file path    |
| `${{ context.document }}`  | Document file path   |

### Implementation

```typescript
function interpolate(template: string, variables: Record<string, string>): string {
  return template.replace(/\$\{\{\s*(\w+(?:\.\w+)?)\s*\}\}/g, (match, key) => {
    const value = getVariable(key, variables);
    return value !== undefined ? value : match;
  });
}

function getVariable(key: string, variables: Record<string, string>): string | undefined {
  if (key.startsWith("env.")) {
    return process.env[key.slice(4)];
  }
  return variables[key];
}
```

---

## Proposal & Voting System

### Types

```typescript
interface Proposal {
  id: string;
  type: "election" | "decision" | "approval" | "assignment";
  title: string;
  description?: string;
  options: ProposalOption[];
  createdBy: string;
  createdAt: string;
  expiresAt?: string;
  resolution: ResolutionRule;
  binding: boolean;
  status: "active" | "resolved" | "expired" | "cancelled";
  result?: ProposalResult;
}

interface ProposalOption {
  id: string;
  label: string;
  metadata?: Record<string, unknown>;
}

interface ResolutionRule {
  type: "plurality" | "majority" | "unanimous";
  quorum?: number;
  tieBreaker?: "first" | "random" | "creator-decides";
}

interface ProposalResult {
  winner?: string;
  votes: Map<string, string>;
  counts: Map<string, number>;
  resolvedAt?: string;
  resolvedBy: "quorum" | "timeout" | "cancelled";
}
```

### Persistence

```typescript
interface ProposalsState {
  proposals: Record<string, Proposal>;
  version: number;
}

async function loadProposals(contextDir: string): Promise<Map<string, Proposal>> {
  const path = join(contextDir, "_state", "proposals.json");
  try {
    const data = JSON.parse(await fs.readFile(path, "utf-8"));
    return new Map(Object.entries(data.proposals));
  } catch {
    return new Map();
  }
}

async function saveProposals(contextDir: string, proposals: Map<string, Proposal>): Promise<void> {
  const activeOnly = [...proposals.entries()].filter(([_, p]) => p.status === "active");
  const data: ProposalsState = {
    proposals: Object.fromEntries(activeOnly),
    version: Date.now(),
  };
  await fs.writeFile(join(contextDir, "_state", "proposals.json"), JSON.stringify(data, null, 2));
}
```

### Resolution Logic

```typescript
async function resolveProposal(proposal: Proposal): Promise<void> {
  const counts = new Map<string, number>();
  for (const choice of proposal.result!.votes.values()) {
    counts.set(choice, (counts.get(choice) || 0) + 1);
  }
  proposal.result!.counts = counts;

  // Find winner based on resolution type
  const sorted = [...counts.entries()].sort((a, b) => b[1] - a[1]);

  switch (proposal.resolution.type) {
    case "plurality":
      proposal.result!.winner = sorted[0]?.[0];
      break;
    case "majority":
      const total = [...counts.values()].reduce((a, b) => a + b, 0);
      if (sorted[0]?.[1] > total / 2) {
        proposal.result!.winner = sorted[0][0];
      }
      break;
    case "unanimous":
      if (sorted.length === 1) {
        proposal.result!.winner = sorted[0][0];
      }
      break;
  }

  // Handle tie
  if (!proposal.result!.winner && sorted.length >= 2 && sorted[0][1] === sorted[1][1]) {
    switch (proposal.resolution.tieBreaker) {
      case "first":
        proposal.result!.winner = sorted[0][0];
        break;
      case "random":
        proposal.result!.winner = sorted[Math.floor(Math.random() * 2)][0];
        break;
    }
  }

  proposal.status = "resolved";
  proposal.result!.resolvedAt = new Date().toISOString();
  proposal.result!.resolvedBy = "quorum";
}
```

---

## Prompt Building

```typescript
function buildAgentPrompt(ctx: AgentRunContext): string {
  return `
## Inbox (${ctx.inbox.length} messages for you)
${formatInbox(ctx.inbox)}

## Recent Activity
${formatChannel(ctx.recentChannel)}

## Current Workspace
${ctx.documentContent}

## Instructions
Process your inbox messages. Use MCP tools to collaborate.
When done handling all messages, exit.
`;
}

function formatInbox(inbox: InboxMessage[]): string {
  if (inbox.length === 0) return "(no messages)";

  return inbox
    .map((m) => {
      const priority = m.priority === "high" ? " [HIGH]" : "";
      return `- From @${m.entry.from}${priority}: ${m.entry.message}`;
    })
    .join("\n");
}

function formatChannel(entries: ChannelEntry[]): string {
  return entries.map((e) => `[${e.timestamp.slice(11, 19)}] @${e.from}: ${e.message}`).join("\n");
}
```
