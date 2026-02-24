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
│   ├── alice (prompt, soul, memory, notes, todo)
│   └── bob (prompt, soul, memory, notes, todo)
│
├── Global Workspace (for standalone use, no workflow needed)
│   ├── channel
│   └── documents
│
└── Workflows (orchestrate agents in workspaces)
    ├── review
    │   ├── workspace (own channel, documents)
    │   ├── agents: [alice (ref), bob (ref), temp-helper (local)]
    │   └── kickoff
    └── deploy
        ├── workspace (own channel, documents)
        └── agents: [alice (ref), deployer (local)]
```

When alice participates in the `review` workflow AND the `deploy` workflow:
- She **carries** her own context (memory, soul, notes) everywhere
- She **communicates through** the workflow's workspace (channel, docs)
- Her agent-level state persists across all workflows
- Each workflow workspace is isolated

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
  # OR from file:
  system_file: ./prompts/alice.md

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
  #   memory/   — persistent key-value notes
  #   notes/    — freeform reflection/learning
  #   todo/     — cross-session task tracking

# Optional runtime config
max_tokens: 8000
max_steps: 20
schedule:
  wakeup: 5m
  prompt: Check for pending reviews
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

### Type Definitions

```typescript
/** Agent reference in a workflow */
interface AgentEntry {
  /** Reference to a global agent by name */
  ref?: string;
  /** Workflow-specific prompt modifications */
  prompt?: {
    /** Append to the agent's base system prompt */
    append?: string;
    /** Replace the system prompt entirely (only for inline agents) */
    system?: string;
    /** Load system prompt from file */
    system_file?: string;
  };
  /** Override runtime config for this workflow */
  model?: string;
  backend?: BackendType;
  max_tokens?: number;
  max_steps?: number;
  schedule?: ScheduleConfig;
  /** Inline soul (for workflow-local agents without ref) */
  soul?: AgentSoul;
}

/** Top-level agent definition */
interface AgentDefinition {
  name: string;
  model: string;
  backend?: BackendType;
  provider?: string | ProviderConfig;
  prompt: {
    system?: string;
    system_file?: string;
  };
  soul?: AgentSoul;
  context?: {
    dir?: string;           // Default: .agents/<name>/
  };
  max_tokens?: number;
  max_steps?: number;
  schedule?: ScheduleConfig;
}

/** Agent identity traits */
interface AgentSoul {
  role?: string;
  expertise?: string[];
  style?: string;
  principles?: string[];
  [key: string]: unknown;  // Extensible
}

/** Updated workflow file */
interface WorkflowFile {
  name?: string;
  agents: Record<string, AgentEntry | { ref: string }>;
  workspace?: WorkspaceConfig;
  setup?: SetupTask[];
  kickoff?: string;
}
```

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
├── .agents/                    # Agent definitions + context
│   ├── alice.yaml              # Agent definition
│   ├── alice/                  # Agent's persistent context
│   │   ├── memory/
│   │   ├── notes/
│   │   └── todo/
│   ├── bob.yaml
│   └── bob/
│       ├── memory/
│       ├── notes/
│       └── todo/
│
├── .workflows/                 # Workflow definitions
│   ├── review.yaml
│   └── deploy.yaml
│
├── .workspace/                 # Runtime workspaces (auto-managed)
│   ├── global/main/            # Global workspace
│   │   ├── channel.md
│   │   └── documents/
│   ├── review/main/            # Review workflow workspace
│   │   ├── channel.md
│   │   └── documents/
│   └── review/pr-123/          # Tagged instance
│       ├── channel.md
│       └── documents/
│
└── moniro.yaml                 # Optional project config
```

---

## Runtime Architecture

### Current: Workflow-Centric

```
Daemon
├── configs: Map<name, AgentConfig>         # Flat config registry
└── workflows: Map<key, WorkflowHandle>     # Running instances
    └── controllers: Map<name, Controller>  # One per agent in workflow
```

### Proposed: Agent-Centric

```
Daemon
├── agents: AgentRegistry                   # Top-level agent definitions + context
│   ├── alice: AgentHandle                  # Loaded definition + context accessor
│   └── bob: AgentHandle
│
├── workspaces: WorkspaceRegistry           # Active workspaces
│   ├── global:main: Workspace             # Global workspace
│   └── review:pr-123: Workspace           # Workflow workspace
│
└── workflows: WorkflowRegistry            # Running workflow instances
    └── review:pr-123: WorkflowHandle
        ├── workspace: Workspace (ref)
        ├── agents: [alice (ref), bob (ref), helper (local)]
        └── controllers: Map<name, Controller>
```

### Key Types

```typescript
/** Agent handle in the daemon — a loaded agent with context access */
interface AgentHandle {
  /** Agent definition (from YAML) */
  definition: AgentDefinition;
  /** Path to agent's persistent context directory */
  contextDir: string;
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
  /** Controllers for all agents in this workflow */
  controllers: Map<string, AgentController>;
  /** Agent handles (refs resolved, locals created) */
  agents: Map<string, ResolvedWorkflowAgent>;
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

When a controller runs an agent, the prompt is assembled from multiple sources:

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
# Run workflow (agents resolved from refs + inline)
agent-worker run review.yaml --tag pr-123

# Start persistent workflow
agent-worker start review.yaml --tag pr-123

# Standalone: send to agent in global workspace (no workflow needed)
agent-worker send alice "Review this code"

# Workflow: send to agent in workflow workspace
agent-worker send alice@review:pr-123 "Focus on auth module"
```

### Backward Compatibility

The existing `agent-worker new` command continues to work by creating a lightweight inline agent (equivalent to workflow-local). The new `agent-worker agent create` is for persistent top-level agents.

```bash
# Old way (still works — creates temporary standalone agent)
agent-worker new -m anthropic/claude-sonnet-4-5

# New way (creates persistent agent with context)
agent-worker agent create alice --model anthropic/claude-sonnet-4-5
```

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

### Phase 3: Workspace Separation

**Goal**: Workspace is a standalone concept, not conflated with context.

- [ ] `Workspace` type separated from `WorkflowRuntimeHandle`
- [ ] `WorkspaceRegistry` for managing active workspaces
- [ ] Global workspace (agents can use it without a workflow)
- [ ] Workflow workspace creation/teardown
- [ ] Updated daemon: agents registry + workspaces registry + workflows registry

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
| `agent-worker new` | Still works | Creates lightweight standalone agent |
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

# Use directly (global workspace)
agent-worker send alice "Help me refactor this function"

# Alice remembers across sessions (memory, notes persist)
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

# Or just talk to an agent directly
agent-worker send architect "How should we restructure the auth module?"

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
