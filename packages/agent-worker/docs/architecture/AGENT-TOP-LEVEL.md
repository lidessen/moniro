# Architecture: Agent as Top-Level Entity

**Date**: 2026-02-24
**Status**: Proposed
**Supersedes**: Inline agent definitions in workflow YAML

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
├── conversations/    # DM history (direct messages, no workspace)
│   └── 2026-02-26.md
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

When an agent runs (in any workflow or standalone), its context is loaded and available:

```
┌──────────────────────────────────────────────────┐
│              Agent Runtime Context                │
│                                                   │
│  ┌─────────────┐  ┌────────────┐  ┌───────────┐ │
│  │ Soul        │  │ Memory     │  │ Todo      │ │
│  │ (identity)  │  │ (learned)  │  │ (pending) │ │
│  └─────────────┘  └────────────┘  └───────────┘ │
│         │                │              │         │
│         ▼                ▼              ▼         │
│  ┌──────────────────────────────────────────────┐│
│  │        System Prompt (assembled)             ││
│  │  = agent.prompt.system                       ││
│  │  + soul summary                              ││
│  │  + relevant memory                           ││
│  │  + active todos                              ││
│  │  + workflow-specific context (if in workflow) ││
│  └──────────────────────────────────────────────┘│
└──────────────────────────────────────────────────┘
```

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
│   │   ├── channel.md
│   │   ├── documents/
│   │   └── inbox/
│   └── review/pr-123/          # Tagged instance
│       ├── channel.md
│       ├── documents/
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
    └── review:pr-123: WorkflowHandle
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
  `channel.md`. Agents see it when they next process an instruction in that
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
- **Progress is preserved**: the instruction carries its conversation history
  (steps 1..N already completed). On resume, the agent continues from step N+1
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
}

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
}

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
│  1. Base system prompt (from agent definition)          │
│  2. Soul injection (role, expertise, principles)        │
│  3. Agent memory summary (relevant entries)             │
│  4. Active todos (from agent's todo/)                   │
│  5. Workflow-specific append (from workflow entry)       │
│  6. Workspace context (inbox, channel, document)        │
│                                                          │
│  Result: Complete prompt with persistent identity        │
│          + workflow-specific instructions                │
│          + current collaboration context                 │
└─────────────────────────────────────────────────────────┘
```

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

### Phase 1: Agent Definition + Context

**Goal**: Agents exist as files with their own context directories.

- [ ] `AgentDefinition` type with soul, prompt, context fields
- [ ] Agent YAML parser (load `.agents/*.yaml`)
- [ ] `AgentHandle` with context read/write operations
- [ ] `AgentRegistry` — loads and manages agent definitions
- [ ] CLI: `agent create`, `agent list`, `agent info`, `agent delete`
- [ ] Agent context directory auto-creation (memory/, notes/, todo/)

### Phase 2: Workflow Agent References

**Goal**: Workflows reference global agents instead of defining them inline.

- [ ] `AgentEntry` type with `ref` field
- [ ] Agent resolution: ref → load from registry + apply overrides
- [ ] Prompt assembly: base + soul + memory + todos + workflow append
- [ ] Updated workflow parser (handle both ref and inline)
- [ ] Updated `WorkflowFile` type
- [ ] Backward compat: inline definitions still work (treated as workflow-local)

### Phase 3: Single Agent Loop + Workspace Attachment

**Goal**: Each agent has one loop. Workspaces attach/detach as context, not as separate execution paths.

- [ ] `AgentLoop` as priority queue per agent (lazy creation, 3 lanes: immediate/normal/background)
- [ ] `AgentInstruction` type with workspace context (null = DM) and priority
- [ ] Cooperative preemption: yield between steps, re-queue with progress marker
- [ ] Workspace attach/detach when workflows start/stop
- [ ] `Workspace` type separated from `WorkflowRuntimeHandle`
- [ ] `WorkspaceRegistry` for managing active workspaces (no global workspace)
- [ ] Conversation storage in `.agents/<name>/conversations/`
- [ ] Updated daemon: agents registry + workspaces registry + workflows registry
- [ ] Remove `standalone:{name}` workflow key hack

### Phase 4: Agent Context in Prompt

**Goal**: Agent's persistent context (soul, memory, notes, todo) enriches its prompt.

- [ ] Soul injection in prompt builder
- [ ] Memory loading and summarization for prompt
- [ ] Active todo injection in prompt
- [ ] Agent note access via MCP tools
- [ ] Agent memory read/write via MCP tools

### Phase 5: CLI + Project Config

**Goal**: Full CLI for agent management, optional project-level config.

- [ ] `moniro.yaml` project config parser
- [ ] Auto-discovery of `.agents/` and `.workflows/`
- [ ] CLI agent memory/notes/todo subcommands
- [ ] Agent context in `agent info` output

---

## Migration

### From Current to New

| Current | New | Notes |
|---------|-----|-------|
| `WorkflowFile.agents` (inline) | Still works | Treated as workflow-local agents |
| `AgentConfig` (daemon) | `AgentHandle` | Richer, with context access |
| `AgentDefinition` (model, system_prompt) | `AgentDefinition` (prompt, soul, context) | Extended, not replaced |
| `agent-worker new` | Still works | Creates ephemeral agent (daemon memory only, lost on restart) |
| Workflow-only context | Agent context + Workspace | Two levels of context |

### Breaking Changes

None planned. The new architecture extends the current one:
- Inline agent definitions in workflows remain valid (workflow-local)
- `agent-worker new` continues to create standalone agents
- Existing workflow YAML files work without modification

New features are opt-in:
- Define `.agents/*.yaml` files to get persistent agents
- Use `ref:` in workflows to reference them
- Agent context directories are created on demand

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

1. **Agent context size management** — As memory/notes grow, how do we select what's relevant for each prompt? RAG-style retrieval? Recency? Manual curation?

2. **Agent context format** — Should memory be YAML, JSON, or freeform markdown? Different formats suit different use cases. Proposal: memory/ is YAML (structured, searchable), notes/ is markdown (freeform).

3. **Soul mutability** — Can a soul evolve over time (agent learns and updates its own soul), or is it fixed by the definition? Proposal: soul in YAML is the baseline; agents can propose soul updates that the user approves.

4. **Cross-project agents** — Should agents be portable across projects? (e.g., `~/.agents/alice.yaml` shared globally). Proposal: start project-scoped, add global scope later.

5. **Agent-to-agent memory** — When alice references something bob told her in another workflow, how does that work? Through shared notes? Direct memory access? Proposal: agent memory is private by default; shared knowledge goes through workspace documents.

6. **DM conversation management** — How long do DM conversations persist? Per-session? Per-day? Until explicitly cleared? How does an agent's DM conversation history relate to its memory (auto-summarize old conversations into memory?).
