# Architecture: Agent as Top-Level Entity

**Date**: 2026-02-24
**Status**: Proposed
**Supersedes**: Inline agent definitions in workflow YAML

> **实施原则：不考虑向后兼容。** 不写兼容遗留代码，不保留 deprecated 接口，不加 shim 或 fallback。
> 每个 phase 直接用新结构替换旧结构。旧接口该删就删，旧路径该断就断。

---

## Problem

The current architecture embeds agents inside workflows:

```yaml
# Current: agents are defined INSIDE workflows
agents:
  reviewer:
    model: anthropic/claude-sonnet-4-5
    system_prompt: You are a code reviewer.
  coder:
    model: anthropic/claude-sonnet-4-5
    system_prompt: You fix issues.
```

This creates several limitations:

1. **No persistent agent identity** — An agent's definition is duplicated across workflows. There's no single source of truth for "who alice is."
2. **No agent-level context** — Agents have no persistent memory, notes, or todo that travels with them. All context is workflow-scoped.
3. **No cross-workflow agents** — If alice participates in both `review` and `deploy` workflows, she's defined twice with no shared state.
4. **Workflow-centric mental model** — Users must think in workflows even when they just want a single persistent agent.

## Decision

**Elevate Agent to a top-level entity with its own persistent context.** Three orthogonal concepts replace the current conflated model:

| Concept | What It Is | Persistence |
|---------|-----------|-------------|
| **Agent** | Identity + own context (prompt, soul, memory, notes, todo) | Persistent across workflows and sessions |
| **Workspace** | Collaboration space (channel, documents) | Per-workflow instance |
| **Workflow** | Orchestration (how agents coordinate) | Definition is persistent, instances are ephemeral |

### Mental Model

```
Project
├── Agents (top-level definitions)
│   ├── alice (prompt, soul, memory, notes, conversations, todo)
│   └── bob (prompt, soul, memory, notes, conversations, todo)
│
└── Workflows (orchestrate agents in workspaces)
    ├── review
    │   ├── workspace (own channel, documents, inbox)
    │   ├── agents: [alice (ref), bob (ref), temp-helper (inline)]
    │   └── kickoff
    └── deploy
        ├── workspace (own channel, documents, inbox)
        └── agents: [alice (ref), deployer (inline)]
```

**No global workspace.** Two data types only:

| Data | Belongs To | Persistence |
|------|-----------|-------------|
| **Personal context** (memory, notes, conversations, todo) | Agent | Persistent, travels with agent |
| **Workspace context** (channel, documents, inbox) | Workflow | Per-workflow instance |

Agent state is determined by workspace attachments, not by a mode switch:

```
Agent (always has personal context, always accepts DMs)
├── workspaces.size === 0  → "idle": personal context only
└── workspaces.size > 0    → "active": personal + attached workspace(s)
```

DMs work regardless of state — an active agent in three workflows still
accepts DMs using personal context only. "Standalone" is not a type — it's
just an agent with no workspace attachments.

When alice participates in the `review` workflow AND the `deploy` workflow:
- She **carries** her personal context (memory, soul, notes) everywhere
- She **communicates through** each workflow's workspace (channel, docs)
- Her personal state persists across all workflows
- Each workflow workspace is isolated
- DMs to alice go to her personal context, independent of any workflow

---

## Agent Definition

An agent is defined in its own YAML file or inline within a project config.

### Agent File

```yaml
# .agents/alice.yaml
name: alice
model: anthropic/claude-sonnet-4-5
backend: sdk           # sdk | claude | cursor | codex | mock

prompt:
  system: |
    You are Alice, a senior code reviewer.
    You value clarity, correctness, and simplicity.
  # OR load from file (mutually exclusive with system):
  # system_file: ./prompts/alice.md

soul:                   # Persistent identity traits (injected into prompt context)
  role: code-reviewer
  expertise: [typescript, architecture, testing]
  style: thorough but constructive
  principles:
    - Explain the why, not just the what
    - Suggest, don't demand

context:                # Agent's own persistent context directory
  dir: .agents/alice/   # Default: .agents/<name>/
  # Subdirectories created automatically:
  #   memory/         — persistent key-value notes
  #   notes/          — freeform reflection/learning
  #   conversations/  — DM history
  #   todo/           — cross-session task tracking

# Optional runtime config
max_tokens: 8000
max_steps: 20
schedule:
  wakeup: 5m
  prompt: Check for pending reviews
  workspace: review          # Wake in any running review workspace
  # workspace: review:pr-123 # Or target a specific tagged instance
  # If omitted → DM context (personal only)
  # If workflow not running → falls back to DM context
```

### Agent Context Directory

```
.agents/alice/
├── memory/           # Structured knowledge (key-value, searchable)
│   ├── preferences.yaml
│   └── learned-patterns.yaml
├── notes/            # Freeform reflections and learnings
│   ├── 2026-02-24-first-review.md
│   └── 2026-02-25-learned-about-auth.md
├── conversations/    # DM history (append-only JSONL logs)
│   └── 2026-02-26.jsonl
└── todo/             # Cross-session task tracking
    └── index.md
```

### Soul

The `soul` field is new. It captures **who the agent is** beyond the system prompt:

- `role` — What this agent does
- `expertise` — Domain knowledge areas
- `style` — Communication and work style
- `principles` — Core values/guidelines

Soul is injected into the agent's context when running, providing consistent identity across workflows. The system prompt says "what to do now"; the soul says "who you are always."

### Agent Context at Runtime

When an agent runs, its context is assembled from persistent identity +
bounded recent history + on-demand tools. See **Prompt Assembly** for the
full breakdown.

---

## Workflow Definition (Updated)

Workflows now **reference** agents rather than defining them inline.

### Workflow File

```yaml
# .workflows/review.yaml
name: review

agents:
  # Reference a global agent (carries its own context)
  alice: { ref: alice }

  # Reference with workflow-specific prompt additions
  bob:
    ref: bob
    prompt:
      append: |
        In this workflow, focus specifically on performance issues.
        When done, notify @alice.

  # Workflow-local agent (temporary, no persistent context)
  helper:
    model: anthropic/claude-haiku-4-5
    prompt:
      system: You help with quick lookups and formatting.

workspace:
  provider: file
  # bind: ./data/review/     # persistent across runs
  # dir: (auto-generated)    # ephemeral (default)

setup:
  - shell: git diff main...HEAD
    as: changes

kickoff: |
  @alice Review these changes:
  ${{ changes }}

  @bob Check for performance regressions.
  @helper Stand by for lookup requests.
```

### Agent Reference Types

```yaml
agents:
  # 1. Reference only — use global agent as-is
  alice: { ref: alice }

  # 2. Reference with overrides — augment for this workflow
  bob:
    ref: bob
    prompt:
      append: "Focus on security in this workflow."
    max_tokens: 16000     # Override for this workflow

  # 3. Inline definition — workflow-local, temporary
  helper:
    model: anthropic/claude-haiku-4-5
    prompt:
      system: You help with quick lookups.

  # 4. Inline with soul — workflow-local but with identity
  specialist:
    model: anthropic/claude-sonnet-4-5
    prompt:
      system: You specialize in database optimization.
    soul:
      role: db-specialist
      expertise: [postgresql, query-optimization]
    # No persistent context (no ref, no context.dir)
```

### Schema Definitions (Zod)

```typescript
import { z } from 'zod';

// ── Shared ──────────────────────────────────────────────────

const AgentSoul = z.object({
  role: z.string().optional(),
  expertise: z.array(z.string()).optional(),
  style: z.string().optional(),
  principles: z.array(z.string()).optional(),
}).passthrough();                            // Extensible

const ScheduleConfig = z.object({
  /** Wakeup interval (e.g., "5m", "1h") */
  wakeup: z.string().optional(),
  /** Prompt to use when waking up */
  prompt: z.string().optional(),
  /** Workspace context — "workflow" or "workflow:tag" (omit = DM / personal only) */
  workspace: z.string().optional(),
});

/** system XOR system_file — never both */
const SystemPrompt = z.union([
  z.object({ system: z.string(), system_file: z.never().optional() }),
  z.object({ system_file: z.string(), system: z.never().optional() }),
]);

const RuntimeOverrides = z.object({
  model: z.string().optional(),
  backend: z.enum(['sdk', 'claude', 'cursor', 'codex', 'mock']).optional(),
  max_tokens: z.number().optional(),
  max_steps: z.number().optional(),
  schedule: ScheduleConfig.optional(),
});

// ── Top-level Agent Definition (.agents/*.yaml) ─────────────

const AgentDefinition = RuntimeOverrides.extend({
  name: z.string(),
  model: z.string(),                        // Required at top level
  provider: z.union([z.string(), z.object({}).passthrough()]).optional(),
  prompt: SystemPrompt,
  soul: AgentSoul.optional(),
  context: z.object({
    dir: z.string().optional(),             // Default: .agents/<name>/
    thin_thread: z.number().optional(),     // Default: 10 (recent messages in prompt)
  }).optional(),
});

// ── Workflow Agent Entry ────────────────────────────────────
//
// Discriminated by presence of `ref`:
//   ref agent  → prompt.append only (extend base agent's prompt)
//   inline     → prompt.system / system_file only (define from scratch)

/** ref agent: reference a global agent, optionally extend its prompt */
const RefAgentEntry = RuntimeOverrides.extend({
  ref: z.string(),
  prompt: z.object({
    append: z.string(),
  }).optional(),
  // No soul — inherits from global definition
});

/** inline agent: workflow-local, define everything here */
const InlineAgentEntry = RuntimeOverrides.extend({
  model: z.string(),
  prompt: SystemPrompt,
  soul: AgentSoul.optional(),               // Optional identity (no persistence)
});

/** Shorthand: { ref: name } */
const RefShorthand = z.object({ ref: z.string() });

const AgentEntry = z.union([RefShorthand, RefAgentEntry, InlineAgentEntry]);

// ── Workflow File ───────────────────────────────────────────

const WorkflowFile = z.object({
  name: z.string().optional(),
  agents: z.record(AgentEntry),
  workspace: z.object({}).passthrough().optional(),   // WorkspaceConfig
  setup: z.array(z.object({}).passthrough()).optional(),
  kickoff: z.string().optional(),
});
```

**Validation rules enforced by schema**:

| Rule | How |
|------|-----|
| `system` XOR `system_file`, never both | `SystemPrompt` union type |
| ref agent → only `prompt.append` allowed | `RefAgentEntry` has no `system`/`system_file` |
| inline agent → only `prompt.system`/`system_file` | `InlineAgentEntry` uses `SystemPrompt` |
| ref agent cannot define `soul` | `RefAgentEntry` has no `soul` field |
| `AgentEntry` discriminated by `ref` presence | `z.union` tries ref first, falls back to inline |

---

## Project Configuration

An optional project-level config registers agents and workflows.

```yaml
# moniro.yaml (or .agents.yaml)
agents:
  # File references (recommended for complex agents)
  - .agents/alice.yaml
  - .agents/bob.yaml

  # Inline definitions (for simple agents)
  - name: helper
    model: anthropic/claude-haiku-4-5
    prompt:
      system: General-purpose helper.

workflows:
  review: .workflows/review.yaml
  deploy: .workflows/deploy.yaml

workspace:
  provider: file
  base: .workspace/
```

Without a project config, the system auto-discovers:
- Agent files in `.agents/*.yaml`
- Workflow files in `.workflows/*.yaml`

---

## Directory Structure

```
project/
├── .agents/                    # Agent definitions + personal context
│   ├── alice.yaml              # Agent definition
│   ├── alice/                  # Agent's persistent personal context
│   │   ├── memory/
│   │   ├── notes/
│   │   ├── conversations/      # DM history
│   │   └── todo/
│   ├── bob.yaml
│   └── bob/
│       ├── memory/
│       ├── notes/
│       ├── conversations/
│       └── todo/
│
├── .workflows/                 # Workflow definitions
│   ├── review.yaml
│   └── deploy.yaml
│
├── .workspace/                 # Runtime workspaces (auto-managed, no global/)
│   ├── review/main/            # Review workflow workspace
│   │   ├── channel.jsonl
│   │   ├── documents/
│   │   ├── history/            # Per-agent conversation logs
│   │   │   └── alice.jsonl
│   │   └── inbox/
│   └── review/pr-123/          # Tagged instance
│       ├── channel.jsonl
│       ├── documents/
│       ├── history/
│       └── inbox/
│
└── moniro.yaml                 # Optional project config
```

Note: No `.workspace/global/` directory. Idle agents use personal context
only. Workspaces are created per-workflow.

---

## Runtime Architecture

### Current: Workflow-Centric

```
Daemon
├── configs: Map<name, AgentConfig>         # Flat config registry
└── workflows: Map<key, WorkflowHandle>     # Running instances
    └── loops: Map<name, AgentLoop>  # One per agent in workflow
```

### Proposed: Agent-Centric

```
Daemon
├── agents: AgentRegistry                   # Top-level agent definitions + context
│   ├── alice: AgentHandle                  # Loaded definition + personal context
│   │   └── loop: AgentLoop                # ONE loop per agent — single instruction queue
│   └── bob: AgentHandle
│       └── loop: AgentLoop
│
├── workspaces: WorkspaceRegistry           # Active workspaces (no global workspace)
│   └── review:pr-123: Workspace           # Workflow workspace
│
└── workflows: WorkflowRegistry            # Running workflow instances
    └── review:pr-123: WorkflowInstance
        ├── workspace: Workspace (ref)
        └── agents: [alice (ref), bob (ref), helper (inline)]
```

**One loop per agent.** DM and workspace messages are both instructions delivered to the same queue. The difference is what context accompanies the instruction:

| Instruction Source | Context Available | Example |
|--------------------|-------------------|---------|
| DM | Personal only (memory, notes, todo) | `send alice "hi"` |
| Workspace | Personal + workspace (channel, docs, inbox) | `send alice@review "task"` |
| Channel broadcast | Personal + workspace (channel, docs, inbox) | `send @review "@alice check this"` |

Context is always **personal + instruction source**. The difference between
sources is delivery mechanism, not available context — personal context is
always present.

**Channel broadcast delivery** works like group chat notifications:

- **@mention** → **push** (high priority): daemon immediately enqueues an
  instruction to the mentioned agent's loop. Real-time delivery.
- **Non-@ message** → **pull** (low priority): message is written to
  `channel.jsonl`. Agents see it when they next process an instruction in that
  workspace, or on scheduled wakeup. No immediate interruption.

**Instruction scheduling** follows a priority lane model (similar to React
Fiber). Each agent's loop is a priority queue, not a simple FIFO:

| Priority | Sources | Behavior |
|----------|---------|----------|
| `immediate` | DM, @mention | Inserted at front of queue, processed next |
| `normal` | Workspace direct send | FIFO within this lane |
| `background` | Non-@ channel, scheduled wakeup | Yields to higher priority instructions |

**Cooperative preemption** (modeled after React Fiber's interruptible
rendering):

```
Agent Loop (single thread, priority queue)
│
├─ Pop highest-priority instruction
├─ Assemble prompt (personal + workspace context)
├─ Execute step 1
│     ├─ Step complete → check queue for higher priority
│     │     ├─ Nothing higher → continue to step 2
│     │     └─ Higher found → YIELD
│     │           ├─ Current instruction re-queued at its original priority
│     │           │   with progress marker (resume from step N+1)
│     │           └─ Higher-priority instruction starts
│     └─ (mid-step: never interrupted — atomic unit is one LLM call)
├─ Execute step 2 ...
└─ Instruction complete → pop next
```

Key behaviors:
- **Yield point** = between steps (between LLM calls), never mid-call
- **Yielded instruction is re-queued**, not abandoned — it resumes from where
  it left off once all higher-priority work drains
- **Progress is preserved**: the instruction carries its step history
  (LLM calls 1..N already completed). On resume, prompt is reassembled from
  live thin thread + saved step history, and the agent continues from step N+1
- **No starvation**: a `background` instruction that keeps getting preempted
  will eventually run — `immediate` instructions are rare (DM, @mention)
- **Single writer**: one instruction processes at a time, no concurrent writes
  to personal context, no locking needed

When a workflow starts, it doesn't create new loops for ref agents — it **attaches workspace context** to existing agent loops. When a workflow stops, it detaches the workspace. Inline (workflow-local) agents get a temporary loop that's destroyed with the workflow.

### Key Types

```typescript
/** Agent handle in the daemon — a loaded agent with its single loop */
interface AgentHandle {
  /** Agent definition (from YAML) */
  definition: AgentDefinition;
  /** Path to agent's persistent context directory */
  contextDir: string;
  /** The agent's single instruction loop (lazy — created on first message) */
  loop: AgentLoop | null;
  /** Active workspace attachments (workflow:tag → workspace, e.g. "review:pr-123") */
  workspaces: Map<string, Workspace>;
  /** Thin threads — last N messages per context ("personal" | "review:pr-123") */
  threads: Map<string, ThinThread>;
  /** Current agent state */
  state: 'idle' | 'running' | 'stopped' | 'error';
  /** Read agent's memory */
  readMemory(): Promise<Record<string, unknown>>;
  /** Read agent's active todos */
  readTodos(): Promise<string[]>;
  /** Read agent's recent notes */
  readNotes(limit?: number): Promise<string[]>;
  /** Write to agent's memory */
  writeMemory(key: string, value: unknown): Promise<void>;
  /** Append to agent's notes */
  appendNote(content: string): Promise<void>;
  /** Send an instruction to this agent's loop */
  send(instruction: AgentInstruction): Promise<void>;
  /** Get or create thin thread for a context */
  getThread(contextKey: string): ThinThread;
}

/** Thin thread — last N messages for conversational continuity */
interface ThinThread {
  /** Context key: "personal" for DMs, "workflow:tag" for workspaces */
  contextKey: string;
  /** Recent messages (bounded, last N — oldest evicted on append) */
  messages: ThreadMessage[];
  /** Max messages to keep in memory (from agent config, default 10) */
  maxMessages: number;
  /** Append message to thread + full history log on disk */
  append(message: ThreadMessage): Promise<void>;
  /** Restore from tail of on-disk history log */
  restore(): Promise<void>;
}

/** Full conversation history — append-only log on disk, queried via recall tools */
interface ConversationLog {
  /** Path to JSONL file */
  path: string;
  /** Append a message */
  append(message: ThreadMessage): Promise<void>;
  /** Search messages by keyword */
  search(query: string, limit?: number): Promise<ThreadMessage[]>;
  /** Read messages by time range */
  read(options?: { since?: string; until?: string; limit?: number }): Promise<ThreadMessage[]>;
}

interface ThreadMessage {
  role: 'user' | 'assistant' | 'system' | 'tool';
  content: string;
  timestamp: string;
}

/** LLM-level message (richer than ThreadMessage — includes tool calls/results) */
type ModelMessage = {
  role: 'user' | 'assistant' | 'tool';
  content: string | ContentBlock[];
  tool_calls?: ToolCall[];       // Assistant messages with tool use
  tool_call_id?: string;         // Tool result messages
};

/** Instruction priority — modeled after React Fiber lanes */
type InstructionPriority =
  | 'immediate'    // DM, @mention — process next (preempts queue)
  | 'normal'       // workspace direct send — FIFO order
  | 'background';  // non-@ channel message, scheduled wakeup — yield to higher priority

/** Instruction delivered to an agent's loop */
interface AgentInstruction {
  /** The message content */
  message: string;
  /** Which workspace context to use (null = DM, personal context only) */
  workspace: Workspace | null;
  /** Source of the instruction */
  source: 'dm' | 'workspace' | 'channel' | 'schedule';
  /** Processing priority (derived from source, can be overridden) */
  priority: InstructionPriority;
  /** Progress marker for resumed instructions (after preemption yield) */
  progress?: InstructionProgress;
}

/** Saved progress for a yielded instruction */
interface InstructionProgress {
  /** Step number to resume from */
  resumeFromStep: number;
  /** LLM conversation within this instruction (steps 1..N, tool calls + results) */
  stepHistory: ModelMessage[];
  /** How many times this instruction has been preempted */
  preemptCount: number;
  /** When this instruction was first queued */
  queuedAt: string;
  // Note: thin thread is NOT snapshotted — it's shared and mutable.
  // On resume, prompt is assembled from live thin thread + saved stepHistory.
}

/** Error classification for failure model */
type ErrorClass = 'transient' | 'permanent' | 'resource' | 'crash';

/** Workspace — the collaboration space */
interface Workspace {
  /** Context provider (channel, inbox, documents) */
  provider: ContextProvider;
  /** Workspace directory */
  dir: string;
  /** Whether workspace persists across runs */
  persistent: boolean;
}

/** Running workflow instance */
interface WorkflowInstance {
  name: string;
  tag: string;
  workspace: Workspace;
  /** Agent handles (refs resolved, locals created) */
  agents: Map<string, ResolvedWorkflowAgent>;
  /** Inline-only loops (workflow-local agents that don't exist in AgentRegistry) */
  inlineLoops: Map<string, AgentLoop>;
  shutdown(): Promise<void>;
}

/** Resolved agent within a workflow */
interface ResolvedWorkflowAgent {
  /** The agent's base handle (null for workflow-local agents) */
  handle: AgentHandle | null;
  /** Effective definition (base + workflow overrides merged) */
  effective: AgentDefinition;
  /** Whether this is a reference to a global agent */
  isRef: boolean;
}
```

### Agent Resolution Flow

When a workflow starts, each agent entry is resolved:

```
Agent Entry in Workflow YAML
         │
         ├─ has ref? ─── YES ──► Load from AgentRegistry
         │                              │
         │                    Apply workflow overrides (prompt.append, etc.)
         │                              │
         │                    Agent carries its context (memory, notes, todo)
         │                              │
         │                              ▼
         │                    ResolvedWorkflowAgent { handle, effective, isRef: true }
         │
         └─ no ref ───► Create inline AgentDefinition
                              │
                    No persistent context (workflow-local)
                              │
                              ▼
                    ResolvedWorkflowAgent { handle: null, effective, isRef: false }
```

### Prompt Assembly

When a loop runs an agent, the prompt is assembled from multiple sources:

```
┌─────────────────────────────────────────────────────────┐
│                  Prompt Assembly                         │
│                                                          │
│  System prompt (always loaded):                         │
│    1. Base system prompt (from agent definition)        │
│    2. Soul injection (role, expertise, principles)      │
│    3. Agent memory (relevant entries from memory/)      │
│    4. Active todos (from agent's todo/)                 │
│    5. Workflow-specific append (from workflow entry)     │
│                                                          │
│  Messages (thin thread):                                │
│    6. Last N messages in this context                   │
│    7. Current instruction                               │
│                                                          │
│  Tools available:                                       │
│    8. history_search / history_read (recall on demand)  │
│    9. memory_write (persist learnings)                  │
│   10. Workspace tools (channel_send/read, inbox, etc.)  │
│                                                          │
│  Result: Bounded prompt with identity + continuity      │
│          + on-demand access to full history              │
└─────────────────────────────────────────────────────────┘
```

---

## Conversation Model

### Design Principle

Don't carry all history — carry **knowledge** and **recent context**.

A human doesn't replay all past conversations before answering a question. They
rely on memory (what they know), the last few exchanges (immediate context), and
the ability to look things up (search). The agent model mirrors this:

```
Prompt = system + soul + memory          ← always loaded (who I am, what I know)
       + thin thread (last N messages)   ← conversational continuity
       + [recall tools]                  ← on-demand deep history access
```

### Three Layers of Context

| Layer | What | Loaded | Cost |
|-------|------|--------|------|
| **Memory** (memory/, notes/) | Distilled knowledge, learned patterns, decisions | Always — injected into prompt | Fixed, grows slowly |
| **Thin thread** | Last N messages in this context | Always — appended to prompt | Fixed, bounded by N |
| **Full history** | Complete conversation log (JSONL on disk) | On-demand — agent calls recall tools | Zero unless queried |

```
Agent alice processes an instruction
│
├─ Loaded automatically:
│     ├─ Soul + system prompt
│     ├─ Memory: { "auth-pattern": "JWT", "alice-style": "explicit errors" }
│     ├─ Active todos: ["Review PR #456"]
│     └─ Thin thread: last 10 messages in this context
│
├─ Available tools (agent decides when to use):
│     ├─ history_search "auth" → find past messages about auth
│     ├─ history_read --since 2026-02-20 → read recent history range
│     └─ memory_write "key" "value" → persist a learning
│
└─ Context window: mostly available for the actual task
```

### Thin Thread

A **thin thread** is the last N messages in a specific context, providing
conversational continuity without consuming the full context window.

```
Agent alice
├── personal thin thread        ← last N DM messages
├── review:pr-123 thin thread   ← last N messages in this workspace
└── deploy:main thin thread     ← last N messages in this workspace
```

**Configuration**:

```yaml
# .agents/alice.yaml
context:
  thin_thread: 10     # Number of recent messages to keep in prompt (default: 10)
```

Thin threads are **continuous across instructions** — when alice receives a
second DM, she sees the last N messages including her previous response. This
provides the "as I mentioned earlier" capability without growing unbounded.

### Recall Tools

When the thin thread isn't enough, agents use **recall tools** to search
their own conversation history:

| Tool | Purpose | Example |
|------|---------|---------|
| `history_search` | Search past messages by keyword/topic | `history_search "auth module"` |
| `history_read` | Read messages by time range or count | `history_read --since 2026-02-20 --limit 20` |

These operate on the **full history** stored on disk. No information loss —
the complete log is always available, just not loaded by default.

For workspace agents, the existing `channel_read` tool already provides this
capability. `history_search` and `history_read` extend it to personal (DM)
conversations.

### Auto-Memory Extraction

After each instruction completes, key learnings are extracted into structured
memory — not raw transcript summarization, but **semantic extraction**:

```
Instruction completes
│
├─ Agent writes to memory during execution (explicit, via tool):
│     ├─ memory_write "auth-pattern" "JWT with refresh tokens"
│     └─ memory_write "pr-456-status" "approved, needs rebase"
│
└─ System extracts automatically (implicit, post-instruction):
      ├─ Decisions made → memory/decisions.yaml
      ├─ Patterns learned → memory/patterns.yaml
      └─ Task outcomes → memory/work-log.yaml
```

This is how the `.memory/` system in this project works — agents leave distilled
knowledge (notes, decisions, patterns), not raw conversation dumps.

**Auto-extraction is optional and lightweight**: a fast model scans the
instruction's messages for extractable knowledge. If nothing notable happened
(e.g., a simple "LGTM" review), nothing is extracted.

### Thread Lifecycle

| Event | Effect |
|-------|--------|
| First DM to agent | Personal thin thread created, full history log started |
| Workflow starts (agent attached) | Workspace thin thread created |
| Instruction processed | Thin thread updated, full history appended, auto-memory runs |
| Workflow stops (agent detached) | Workspace history archived (if `bind:`) or discarded |
| Daemon restart | Thin threads restored from most recent N messages on disk |

### Persistence

| Data | Storage | Growth |
|------|---------|--------|
| Full history (personal) | `.agents/<name>/conversations/<date>.jsonl` | Unbounded (append-only log) |
| Full history (workspace) | `.workspace/<workflow>/<tag>/history/<agent>.jsonl` | Unbounded |
| Thin thread | In-memory, restored from tail of history on restart | Fixed (last N messages) |
| Memory | `.agents/<name>/memory/*.yaml` | Slow (distilled knowledge) |

On cooperative preemption yield: thin thread is NOT snapshotted — it's shared
and mutable. The re-queued instruction carries only its `stepHistory` (LLM calls
1..N). On resume, prompt is reassembled from live thin thread + saved stepHistory.

### Relationship to Current Implementation

| Current | New | Change |
|---------|-----|--------|
| SDK agent: in-memory `messages[]` (full history) | Thin thread + recall tools | Bounded prompt, on-demand deep access |
| Workflow agent: channel + inbox (no history) | Thin thread + `channel_read` | Adds conversational continuity |
| Workflow agent: `channel_read` MCP tool | `history_search` / `history_read` | Extends pattern to DMs |
| No persistent memory | Auto-memory extraction | Distilled knowledge survives across sessions |
| `MemoryStateStore` (volatile) | File-based JSONL + memory/ | Required for persistence |

**Key insight**: Current workflow agents already have the right pattern
(`channel_read` for on-demand history). What they lack is the thin thread for
continuity. SDK agents have the opposite problem — full history but no
bounded approach. The new model gives both: thin thread (bounded continuity) +
recall tools (on-demand depth).

---

## Agent-to-Agent Communication

### Within a Workflow (Workspace Channel)

Agents communicate through the **workspace channel** using MCP tools. This is
the current proven pattern, preserved:

| Tool | Purpose | Delivery |
|------|---------|----------|
| `channel_send` | Post to channel, optionally @mention or DM | @mention → push (wake), non-@ → pull |
| `channel_read` | Read channel history | On-demand |
| `my_inbox` | Check unread @mentions/DMs | Per-instruction |
| `my_inbox_ack` | Acknowledge processed messages | After handling |
| `team_members` | Discover other agents | On-demand |
| `team_doc_*` | Shared documents | Read/write |
| `team_proposal_*` | Group decisions/voting | Structured coordination |

Flow:
```
alice (in review workspace)
│
├─ channel_send "@bob check line 42"
│     │
│     └─ daemon extracts @bob
│           │
│           ├─ Message written to channel.jsonl
│           └─ bob.loop.wake() called (immediate priority)
│
└─ bob wakes, sees message in inbox, responds via channel_send
```

### Cross-Workflow Communication

**Not supported directly.** Agents in different workflows don't share a channel.

Knowledge transfer across workflows happens through **agent personal context**:

```
alice learns something in review workflow
│
├─ Writes to personal memory (via tool or auto-memory extraction)
│
└─ Later, in deploy workflow:
   └─ alice's memory is loaded into prompt
      └─ Knowledge available without explicit cross-workflow messaging
```

This is intentional: workflows are isolated collaboration spaces.
Cross-pollination happens through the agent's persistent identity, not through
direct messaging.

### DMs: User → Agent Only

Direct messages are **user-to-agent** only. Agent-to-agent DMs are not supported:

- `send alice "review this"` → user to alice (immediate priority)
- Agent-to-agent → must go through a workspace channel

**Rationale**: Agent-to-agent DMs would be an unobservable side channel — hard
to debug, hard to audit, and prone to message loops. If two agents need to
communicate, they belong in the same workflow. The workspace channel provides
scope, observability, and natural coordination. Cross-workflow knowledge sharing
happens through agent personal context (memory/notes that travel with the agent),
not through direct messaging.

---

## Failure Model

### Error Classification

```typescript
type ErrorClass =
  | 'transient'   // Network timeout, rate limit (429), 5xx — retry helps
  | 'permanent'   // Auth failure, invalid request, 4xx (not 429) — retry won't help
  | 'resource'    // max_steps, context overflow — structural limit reached
  | 'crash';      // Process exit, unhandled exception — needs recovery
```

**Classification heuristic** (applied at loop level, not backend):

| Signal | Class |
|--------|-------|
| HTTP 429, 503, ECONNRESET, ETIMEDOUT | `transient` |
| HTTP 401, 403, 400 | `permanent` |
| `IdleTimeoutError` with no output | `permanent` (backend not responding) |
| `IdleTimeoutError` with partial output | `transient` (might have stalled) |
| `max_steps` reached with pending tool calls | `resource` |
| Process exit code > 0 | `crash` |
| Unhandled exception in loop | `crash` |

### Retry Strategy (Per Instruction)

```
Instruction fails
│
├─ Classify error
│     ├─ transient → retry with exponential backoff
│     ├─ permanent → fail immediately, no retry
│     ├─ resource → fail with diagnostic, no retry
│     └─ crash → retry once (process might be flaky), then fail
│
├─ Retry (if transient)
│     ├─ Attempt 1: immediate
│     ├─ Attempt 2: wait 1s
│     ├─ Attempt 3: wait 2s
│     └─ (configurable via RetryConfig, current defaults preserved)
│
└─ All retries exhausted
      ├─ Mark instruction as failed
      ├─ Write failure to conversation thread (agent sees it on next turn)
      ├─ Notify via channel (workspace) or DM response (personal)
      └─ Acknowledge inbox (prevent infinite loop — current behavior preserved)
```

**Improvement over current**: Current retry is blind (all errors get 3 retries).
New model skips retry for `permanent` errors and limits `crash` to 1 retry,
reducing wasted time on unrecoverable failures.

### Instruction Failure Notification

| Context | Notification |
|---------|-------------|
| DM | Error returned as assistant message in personal thread |
| Workspace | Error written to channel as system message |
| Scheduled wakeup | Error logged, next wakeup proceeds normally |

### Preemption Starvation Protection

Background instructions that keep getting preempted:

```
background instruction queued at T₀
│
├─ preempted 1..2 times → re-queue at background (normal behavior)
├─ preempted 3+ times → promote to normal priority
└─ starvation timeout (default 5min from T₀, configurable)
   └─ if instruction hasn't completed → promote to immediate
```

This mirrors OS scheduler anti-starvation: priority aging ensures every
instruction eventually completes, even under heavy immediate traffic.

### max_steps Exhaustion

```
Agent reaches max_steps with pending tool calls
│
├─ Log warning to channel/thread
├─ Save conversation state (thread preserved)
├─ Mark instruction as incomplete (distinct from failed)
└─ User can:
     ├─ send "continue" → new instruction picks up from saved thread
     └─ increase max_steps in agent definition → re-run
```

**Improvement over current**: Current implementation warns and ends. New model
saves conversation state so the work isn't lost — user can continue without
the agent starting over.

### Loop Crash Recovery

```
AgentLoop crashes (unhandled exception)
│
├─ Catch at loop boundary (current: runLoop().catch)
├─ Set agent state → "error" (new state, visible in agent info)
├─ Current instruction → re-queue at original priority
│     (with progress marker if mid-execution)
├─ Auto-restart loop with backoff (1s, 2s, 4s, 8s, max 30s)
│     └─ max 5 restarts, then stay in "error" state
└─ "error" state visible via: agent info, team_members, daemon status
```

**Improvement over current**: Current crash → "stopped" state, manual restart
required. New model auto-restarts with backoff and distinguishes "stopped"
(intentional) from "error" (crash), so users and other agents can react
appropriately.

---

## CLI Changes

### Agent Management (New)

```bash
# Define a new agent (creates .agents/<name>.yaml)
agent-worker agent create alice \
  --model anthropic/claude-sonnet-4-5 \
  --system "You are a senior code reviewer." \
  --role code-reviewer \
  --expertise typescript,architecture

# List defined agents
agent-worker agent list

# Show agent details (definition + context summary)
agent-worker agent info alice

# Edit agent definition
agent-worker agent edit alice

# Delete agent (definition + context)
agent-worker agent delete alice

# Agent memory operations
agent-worker agent memory alice                 # Show memory
agent-worker agent memory alice set key value   # Set memory entry
agent-worker agent memory alice get key         # Get memory entry

# Agent notes
agent-worker agent notes alice                  # List notes
agent-worker agent notes alice add "Learned X"  # Add note

# Agent todos
agent-worker agent todo alice                   # List todos
agent-worker agent todo alice add "Review PR"   # Add todo
agent-worker agent todo alice done 1            # Complete todo
```

### Updated Workflow Commands

```bash
# Run workflow in foreground (blocks until complete or Ctrl-C)
agent-worker run review.yaml --tag pr-123

# Start workflow in background (returns immediately, daemon manages lifecycle)
agent-worker start review.yaml --tag pr-123

# DM: send directly to agent (personal context, no workspace)
agent-worker send alice "Review this code"

# Workspace channel: post to workspace (@mentions are part of the message)
agent-worker send @review "@alice Focus on auth module"

# Agent in workspace: send to agent within a specific workspace
agent-worker send alice@review "Focus on auth module"
```

#### Send Target Semantics

The target is always **one thing**. @mentions inside the message are just text, parsed by the receiving agent, not by the CLI.

| Command | Target | Context Available | Delivery |
|---------|--------|-------------------|----------|
| `send alice "hi"` | DM to alice | Personal context only | Immediate (push) |
| `send @review "msg"` | review workspace channel | Workspace context | Written to channel (pull — agents see on next cycle) |
| `send @review "@alice check"` | review workspace channel | Workspace context | @alice pushed immediately; message also in channel |
| `send alice@review "task"` | alice in review workspace | Personal + workspace context | Immediate (push to alice) |

Target parsing:
- No `@` prefix → DM to agent (personal context only)
- `@workflow` or `@workflow:tag` → workspace channel (broadcast)
- `agent@workflow` or `agent@workflow:tag` → specific agent in workspace

### Backward Compatibility

`agent-worker new` creates an **ephemeral agent** — exists only in daemon memory, no `.agents/` file, no persistent context. DM conversations are in-memory only, lost on daemon restart. This is for quick experimentation; use `agent create` for persistence.

```bash
# Ephemeral agent (daemon memory only, lost on restart)
agent-worker new --model anthropic/claude-sonnet-4-5     # -m is shorthand

# Persistent agent (creates .agents/<name>.yaml + context directory)
agent-worker agent create alice --model anthropic/claude-sonnet-4-5

# Promote: if an ephemeral agent proves useful, persist it
# (uses ephemeral agent's name assigned at creation, e.g. "agent-1")
agent-worker agent create alice --from agent-1
```

#### Send to Unregistered Workspace

`send alice@review "task"` requires alice to already be a participant in the
`review` workflow (via `ref:` in workflow YAML). Two possible errors:

```
Error: workflow "review" is not running.
Start it with: agent-worker start review.yaml
```

```
Error: alice is not a participant in workflow "review".
Add alice to .workflows/review.yaml first.
```

No dynamic joining — if the agent isn't in the workflow definition, add it
there. This keeps the workflow YAML as the single source of truth for
participation.

---

## Implementation Phases

### Phase 1: Agent Definition + Context ✅

**Goal**: Agents exist as files with their own context directories.

- [x] `AgentDefinition` type with soul, prompt, context fields
- [x] Agent YAML parser (load `.agents/*.yaml`)
- [x] `AgentHandle` with context read/write operations
- [x] `AgentRegistry` — loads and manages agent definitions
- [x] CLI: `agent create`, `agent list`, `agent info`, `agent delete`
- [x] Agent context directory auto-creation (memory/, notes/, conversations/, todo/)

### Phase 2: Workflow Agent References

**Goal**: Workflows reference global agents instead of defining them inline.

- [x] `AgentEntry` discriminated union: `RefAgentEntry | InlineAgentEntry`
- [x] Agent resolution: ref → load from registry + apply overrides
- [x] Prompt assembly: base system prompt + workflow append (soul/memory/todo injection deferred to Phase 5)
- [x] Updated workflow parser (handle both ref and inline)
- [x] Updated `WorkflowFile` type
- [x] Inline definitions are a formal type (`InlineAgentEntry`), not a compat shim

### Phase 3: Daemon Agent Registry + Workspace

**Goal**: Daemon owns agent handles via registry. Workspaces replace standalone WorkflowHandle hack.

> **Why split**: Original Phase 3 had 13 tasks mixing two concerns — workspace/state management and
> loop scheduling/preemption. These are independent. Doing workspace first unblocks Phase 4-5.
> Priority queue + preemption is deferred to Phase 3b (not blocking for agent context features).

- [ ] `AgentRegistry` integration into daemon (replace `configs: Map<string, AgentConfig>`)
- [ ] `Workspace` type separated from `WorkflowRuntimeHandle`
- [ ] `WorkspaceRegistry` for managing active workspaces
- [ ] Workspace attach/detach when workflows start/stop
- [ ] Remove `standalone:{name}` workflow key hack (Workspace takes over resource management)
- [ ] `ThinThread` type with bounded in-memory messages per context
- [ ] `ConversationLog` type with JSONL append-only storage and search/time-range read
- [ ] Log persistence (personal → `.agents/<name>/conversations/`, workspace → `.workspace/`)
- [ ] `thin_thread` config in agent definition (default: 10 messages)
- [ ] Thin thread integration in prompt assembly

### Phase 3b: Priority Queue + Preemption

**Goal**: Each agent has one loop with priority lanes and cooperative preemption.

- [ ] `AgentLoop` as priority queue (3 lanes: immediate/normal/background)
- [ ] `AgentInstruction` type with workspace context (null = DM) and priority
- [ ] Cooperative preemption: yield between steps, re-queue with progress marker
- [ ] `InstructionProgress` for yielded instruction resume

### Phase 4: Recall Tools + Auto-Memory + Failure Handling

**Goal**: Recall tools for depth, auto-memory for learning. Classified error handling with recovery.

- [ ] `history_search` / `history_read` recall tools (MCP)
- [ ] `memory_write` tool for agent self-learning
- [ ] Auto-memory extraction post-instruction (fast model, optional)
- [ ] Error classification: transient / permanent / resource / crash
- [ ] Differentiated retry: skip retry for permanent, limit crash to 1 retry
- [ ] Loop crash auto-restart with backoff (1s..30s, max 5 attempts)
- [ ] `error` agent state (distinct from `stopped`)

### Phase 5: Agent Context in Prompt

**Goal**: Agent's persistent context (soul, memory, notes, todo) enriches its prompt.

- [ ] Soul injection in prompt builder
- [ ] Memory loading, selection, and injection for prompt
- [ ] Active todo injection in prompt
- [ ] `memory_read` / `note_read` / `note_write` MCP tools (Phase 4 owns `memory_write`)

### Phase 6: CLI + Project Config

**Goal**: Full CLI for agent management, optional project-level config.

- [ ] `moniro.yaml` project config parser
- [ ] Auto-discovery of `.agents/` and `.workflows/`
- [ ] CLI agent memory/notes/todo subcommands
- [ ] Agent context in `agent info` output

---

## 当前状态与迁移说明

> Phase 0 + Phase 1 已完成。以下说明对现有用法的影响。

### 不受影响的功能（无需任何修改）

| 功能 | 状态 | 说明 |
|------|------|------|
| **Workflow YAML 格式** | 不变 | `agents:`, `context:`, `setup:`, `kickoff:`, `params:` 全部不变 |
| **`agent-worker run <file>`** | 不变 | 运行 workflow 并在完成后退出 |
| **`agent-worker start <file>`** | 不变 | 通过 daemon 启动 workflow 持续运行 |
| **`agent-worker new <name>`** | 不变 | 创建 daemon 内存 agent（无持久化） |
| **`agent-worker ls`** | 不变 | 列出 daemon 中的 agent |
| **`agent-worker stop`** | 不变 | 停止 agent / workflow / daemon |
| **`agent-worker ask/serve`** | 不变 | 与 agent 交互 |
| **Workflow 参数传递** | 不变 | `--` 后的 params 正常工作 |
| **Remote workflow** | 不变 | `github:owner/repo@ref/path` 正常工作 |
| **Agent @mention 和通信** | 不变 | channel_send, inbox, team_members 等 MCP tools |

### Phase 0 内部变更（对用户透明）

| 变更 | 影响 |
|------|------|
| `AgentDefinition` → `WorkflowAgentDef` | 仅类型重命名，YAML schema 不变 |
| `AgentConfig.workflow/tag` 变为 optional | `new` 命令不再要求 workflow，standalone agent 更自然 |
| `DaemonState.loops` map | 内部 loop 管理优化，API 行为不变 |
| `buildAgentPrompt` 可组合化 | 输出内容完全相同，仅内部结构改变 |

### Phase 1 新增功能

新增 `agent` 子命令组（文件系统级，不依赖 daemon）：

```bash
# 创建持久化 agent 定义（写入 .agents/alice.yaml + 创建 context 目录）
agent-worker agent create alice -m anthropic/claude-sonnet-4-5 \
  -s "You are a code reviewer." --role reviewer

# 列出项目中的 agent 定义
agent-worker agent list

# 查看 agent 详情
agent-worker agent info alice

# 删除 agent（YAML + context 目录）
agent-worker agent delete alice
```

### 两套 agent 命令的关系

| 命令 | 存储位置 | 持久化 | 用途 |
|------|----------|--------|------|
| `agent-worker new` | daemon 内存 | 否（daemon 停止后丢失） | 临时 agent，快速测试 |
| `agent-worker agent create` | `.agents/*.yaml` + context 目录 | 是（文件系统） | 持久 agent identity |

Phase 2 之后，workflow YAML 将支持 `ref:` 引用持久 agent：

```yaml
# 未来的 workflow 格式（Phase 2）
agents:
  alice: { ref: alice }        # 引用 .agents/alice.yaml
  helper:                       # 仍然支持 inline 定义
    model: anthropic/claude-haiku-4-5
    prompt:
      system: You help with lookups.
```

### 文件结构预览

Phase 1 后项目中可能出现的新文件：

```
project/
├── .agents/                    # Phase 1 新增
│   ├── alice.yaml              # agent 定义
│   └── alice/                  # agent context 目录
│       ├── memory/             # 结构化知识（YAML key-value）
│       ├── notes/              # 自由格式笔记（markdown）
│       ├── conversations/      # DM 历史（Phase 3 启用）
│       └── todo/               # 跨 session 任务追踪
│
├── review.yaml                 # 现有 workflow（格式不变）
└── ...
```

---

## Examples

### Minimal: Single Agent, No Workflow

```bash
# Create persistent agent
agent-worker agent create alice \
  --model anthropic/claude-sonnet-4-5 \
  --system "You are a helpful coding assistant."

# DM directly (no workspace needed, uses personal context)
agent-worker send alice "Help me refactor this function"

# Alice remembers across sessions (memory, notes, conversations persist)
```

### Cross-Workflow Agent

```yaml
# .agents/alice.yaml
name: alice
model: anthropic/claude-sonnet-4-5
prompt:
  system_file: ./prompts/alice.md
soul:
  role: code-reviewer
  expertise: [typescript, testing]
context:
  dir: .agents/alice/
```

```yaml
# .workflows/review.yaml
agents:
  alice: { ref: alice }
  coder:
    model: anthropic/claude-sonnet-4-5
    prompt:
      system: You implement fixes.
kickoff: "@alice Review. @coder Fix."
```

```yaml
# .workflows/deploy.yaml
agents:
  alice:
    ref: alice
    prompt:
      append: In this workflow, verify deployment readiness.
  deployer:
    model: anthropic/claude-haiku-4-5
    prompt:
      system: You handle deployments.
kickoff: "@alice Verify. @deployer Deploy."
```

Alice's memory/notes persist across both workflows. She can remember
what she learned in `review` when she works in `deploy`.

### Replacing openclaw

```yaml
# moniro.yaml — Project-level agent configuration
agents:
  - .agents/reviewer.yaml
  - .agents/coder.yaml
  - .agents/architect.yaml

workflows:
  review: .workflows/review.yaml
  implement: .workflows/implement.yaml
  refactor: .workflows/refactor.yaml
```

```bash
# Run a specific workflow
agent-worker run review --tag pr-456

# DM an agent directly (personal context, no workspace)
agent-worker send architect "How should we restructure the auth module?"

# Post to a workflow workspace channel (@mention is part of the message)
agent-worker send @review "@architect Review the auth changes"

# Agents accumulate knowledge over time
agent-worker agent notes architect  # See what architect has learned
```

---

## Open Questions

### Resolved

1. ~~**Agent context size management**~~ → **Conversation Model**: No summarization. Thin thread (bounded, last N messages) + recall tools (on-demand full history) + auto-memory extraction (distilled knowledge). Context window stays bounded without lossy compression.

2. ~~**Agent-to-agent memory**~~ → **Agent-to-Agent Communication § Cross-Workflow**: Agent memory is private. Cross-workflow knowledge transfers through personal context (memory/notes that travel with the agent), not direct memory access.

3. ~~**DM conversation management**~~ → **Conversation Model § Thread Lifecycle**: DM conversations use thin thread (last N messages in prompt) + full history on disk (queryable via recall tools). Knowledge persisted via auto-memory extraction.

4. ~~**Agent-to-agent DMs**~~ → **Agent-to-Agent Communication § DMs**: Not supported. Agent communication must go through workspace channels (observable, scoped, debuggable). Cross-workflow knowledge sharing uses personal context.

### Open

5. **Agent context format** — Should memory be YAML, JSON, or freeform markdown? Different formats suit different use cases. Proposal: memory/ is YAML (structured, searchable), notes/ is markdown (freeform).

6. **Soul mutability** — Can a soul evolve over time (agent learns and updates its own soul), or is it fixed by the definition? Proposal: soul in YAML is the baseline; agents can propose soul updates that the user approves.

7. **Cross-project agents** — Should agents be portable across projects? (e.g., `~/.agents/alice.yaml` shared globally). Proposal: start project-scoped, add global scope later.

8. **Auto-memory extraction strategy** — What should be extracted automatically vs. left to the agent? Options: (a) only explicit `memory_write` calls (agent decides), (b) fast model post-scan for decisions/patterns (system decides), (c) both. Proposal: both — agent writes explicitly during execution, system extracts missed patterns post-instruction.
