# Agent Worker v2 Design

## Overview

This document defines the design for agent-worker v2, introducing workflow-based orchestration and renaming `session` to `agent` throughout.

### Key Changes

1. **session → agent**: All CLI commands and APIs rename `session` to `agent`
2. **Workflow files**: YAML-based definition of multiple agents and tasks
3. **Instance support**: Run multiple instances of the same workflow (`agent@instance`)
4. **run/up modes**: One-shot execution vs persistent agents

---

## Workflow File Format

### Basic Structure

```yaml
# review.yml
name: review  # Optional, defaults to filename without extension

agents:
  reviewer:
    model: anthropic/claude-sonnet-4-5
    system_prompt: ./prompts/reviewer.txt  # String or file path
    tools:
      - read_file
      - search_code
    max_tokens: 4096        # Optional
    max_steps: 10           # Optional

  generator:
    model: anthropic/claude-sonnet-4-5
    system_prompt: |
      You generate changesets in the standard format.
      Be concise and accurate.

tasks:
  - shell: git diff --cached
    as: diff

  - send: |
      Review these changes:
      ${{ diff }}
    to: reviewer
    as: review

  - send: |
      Generate changeset based on:
      ${{ review }}
    to: generator
    as: changeset

  - shell: |
      mkdir -p .changeset
      echo "${{ changeset }}" > .changeset/auto-$(date +%s).md
```

### Schema Definition

```typescript
interface WorkflowFile {
  /** Workflow name (defaults to filename) */
  name?: string

  /** Agent definitions */
  agents: Record<string, AgentDefinition>

  /** Task sequence (optional) */
  tasks?: Task[]
}

interface AgentDefinition {
  /** Model identifier (e.g., 'anthropic/claude-sonnet-4-5') */
  model: string

  /** System prompt - inline string or file path */
  system_prompt: string

  /** Tool names to enable */
  tools?: string[]

  /** Maximum tokens for response */
  max_tokens?: number

  /** Maximum tool call steps per turn */
  max_steps?: number
}

type Task = ShellTask | SendTask | ConditionalTask | ParallelTask

interface ShellTask {
  /** Shell command to execute */
  shell: string

  /** Variable name to store output */
  as?: string
}

interface SendTask {
  /** Message to send */
  send: string

  /** Target agent name */
  to: string

  /** Output variable - string or object with prompt */
  as?: string | {
    name: string
    prompt: string  // Summary/extraction instruction
  }
}

interface ConditionalTask {
  /** Condition expression */
  if: string

  /** Task to execute if condition is true */
  send?: string
  shell?: string
  to?: string
  as?: string | { name: string; prompt: string }
}

interface ParallelTask {
  /** Tasks to execute in parallel */
  parallel: Task[]
}
```

### Variable Syntax

Variables use `${{ name }}` syntax (GitHub Actions style):

```yaml
tasks:
  - shell: git diff
    as: diff

  - send: "Review: ${{ diff }}"
    to: reviewer
    as: review

  - send: "Based on ${{ review }}, generate changeset"
    to: generator
```

**Variable scope**: All variables are global within a workflow execution.

**Reserved variables**:
- `${{ env.VAR_NAME }}` - Environment variables
- `${{ workflow.name }}` - Workflow name
- `${{ workflow.instance }}` - Instance name

---

## CLI API Design

### Command Renaming (session → agent)

| Old Command | New Command |
|-------------|-------------|
| `session new` | `new` (shorthand) or `agent new` |
| `session list` | `agent list` or `ls` |
| `session status` | `agent status` |
| `session use` | `agent use` |
| `session end` | `agent end` |

### New Commands

```bash
# Workflow execution
agent-worker run <file>              # Execute tasks, exit when done
agent-worker up <file>               # Execute tasks, keep agents alive
agent-worker down [target]           # Stop agents
agent-worker ps                      # List running agents

# Single agent (existing, renamed)
agent-worker new <name>              # Create agent
agent-worker send <message>          # Send message
agent-worker peek                    # View messages
```

### Command Details

#### `agent-worker run <file>`

Execute workflow tasks and exit.

```bash
agent-worker run ./review.yml
agent-worker run ./review.yml --lazy          # Lazy agent startup
agent-worker run ./review.yml --instance pr-123
agent-worker run ./review.yml --json          # JSON output
agent-worker run ./review.yml --verbose       # Show task progress
```

**Behavior**:
1. Parse workflow file
2. Start all agents (eager by default)
3. Execute tasks sequentially
4. Print final task output
5. Shutdown all agents
6. Exit

#### `agent-worker up <file>`

Execute workflow tasks and keep agents alive for interaction.

```bash
agent-worker up ./review.yml
agent-worker up ./review.yml --instance pr-123
agent-worker up ./review.yml --lazy
```

**Behavior**:
1. Parse workflow file
2. Start all agents
3. Execute tasks (if any)
4. Keep agents running in background
5. Print agent status

#### `agent-worker down [target]`

Stop running agents.

```bash
agent-worker down                    # Stop default instance
agent-worker down pr-123             # Stop specific instance
agent-worker down --all              # Stop all instances
agent-worker down reviewer@pr-123    # Stop specific agent in instance
```

#### `agent-worker ps`

List running agents.

```bash
agent-worker ps
```

Output:
```
WORKFLOW    INSTANCE    AGENT       STATUS    MESSAGES
review      default     reviewer    running   5
review      default     generator   running   3
review      pr-123      reviewer    running   12
```

#### `agent-worker new <name>`

Create a single agent (existing functionality, renamed from `session new`).

```bash
agent-worker new reviewer -m anthropic/claude-sonnet-4-5
agent-worker new reviewer -m anthropic/claude-sonnet-4-5 --instance pr-123
agent-worker new reviewer -f ./prompts/reviewer.txt
```

#### `agent-worker send <message>`

Send message to an agent.

```bash
agent-worker send "Review this code"
agent-worker send "Review this code" --to reviewer
agent-worker send "Review this code" --to reviewer@pr-123
agent-worker send "Review this code" --wait      # Synchronous
```

### Instance Naming Convention

Format: `agent@instance`

```bash
# Default instance (when --instance not specified)
reviewer          # Same as reviewer@default

# Named instance
reviewer@pr-123
generator@pr-123

# Workflow context
# When using `up ./review.yml --instance pr-123`:
# - reviewer@pr-123
# - generator@pr-123
```

**Rules**:
- Instance names: alphanumeric, hyphen, underscore (`[a-zA-Z0-9_-]+`)
- Default instance name: `default`
- `@` is the separator (email style)

### Flag Reference

| Flag | Commands | Description |
|------|----------|-------------|
| `--to <target>` | send, peek, stats | Target agent (`name` or `name@instance`) |
| `--instance <name>` | run, up, new | Instance name |
| `--lazy` | run, up | Lazy agent startup |
| `--wait` | send | Wait for response (sync mode) |
| `--json` | run, send, peek, ps | JSON output |
| `--verbose` | run, up | Show detailed progress |
| `--all` | down | Stop all instances |

---

## TypeScript API Design

### Core Interfaces

```typescript
// Workflow execution
interface WorkflowConfig {
  file: string
  instance?: string
  lazy?: boolean
  verbose?: boolean
}

interface WorkflowRunner {
  run(config: WorkflowConfig): Promise<WorkflowResult>
  up(config: WorkflowConfig): Promise<WorkflowHandle>
}

interface WorkflowResult {
  /** Final output (last task result) */
  output: string
  /** All task results */
  results: Record<string, string>
  /** Execution time in ms */
  duration: number
}

interface WorkflowHandle {
  /** Workflow name */
  name: string
  /** Instance name */
  instance: string
  /** Running agents */
  agents: Map<string, AgentHandle>
  /** Stop all agents */
  down(): Promise<void>
}

// Agent management
interface AgentHandle {
  /** Agent name */
  name: string
  /** Full identifier (name@instance) */
  id: string
  /** Send message */
  send(message: string): Promise<AgentResponse>
  /** Send message (async) */
  sendAsync(message: string): Promise<void>
  /** Get messages */
  getMessages(): AgentMessage[]
  /** Stop agent */
  stop(): Promise<void>
}
```

### File Parsing

```typescript
interface WorkflowParser {
  parse(filePath: string): Promise<ParsedWorkflow>
  validate(workflow: ParsedWorkflow): ValidationResult
}

interface ParsedWorkflow {
  name: string
  agents: Record<string, AgentDefinition>
  tasks: Task[]
}

interface ValidationResult {
  valid: boolean
  errors: ValidationError[]
}
```

### Variable Interpolation

```typescript
interface VariableContext {
  /** Task output variables */
  [key: string]: string
  /** Environment variables */
  env: Record<string, string>
  /** Workflow metadata */
  workflow: {
    name: string
    instance: string
  }
}

function interpolate(template: string, context: VariableContext): string
```

---

## Internal Architecture

### Component Diagram

```
┌─────────────────────────────────────────────────────────┐
│                        CLI Layer                         │
│  ┌─────┐ ┌────┐ ┌──────┐ ┌────┐ ┌──────┐ ┌────────┐   │
│  │ run │ │ up │ │ down │ │ ps │ │ send │ │ new... │   │
│  └──┬──┘ └─┬──┘ └──┬───┘ └─┬──┘ └──┬───┘ └───┬────┘   │
└─────┼──────┼───────┼───────┼───────┼─────────┼────────┘
      │      │       │       │       │         │
      v      v       v       v       v         v
┌─────────────────────────────────────────────────────────┐
│                   Workflow Runtime                       │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐  │
│  │ WorkflowFile │  │   Variable   │  │    Task      │  │
│  │    Parser    │  │   Resolver   │  │   Executor   │  │
│  └──────────────┘  └──────────────┘  └──────────────┘  │
└─────────────────────────────────────────────────────────┘
                            │
                            v
┌─────────────────────────────────────────────────────────┐
│                   Agent Manager                          │
│  ┌──────────────────────────────────────────────────┐  │
│  │              Instance Registry                    │  │
│  │  ┌─────────────┐  ┌─────────────┐               │  │
│  │  │ reviewer@   │  │ generator@  │  ...          │  │
│  │  │ default     │  │ pr-123      │               │  │
│  │  └─────────────┘  └─────────────┘               │  │
│  └──────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────┘
                            │
                            v
┌─────────────────────────────────────────────────────────┐
│                   Backend Layer                          │
│  ┌─────────┐  ┌─────────┐  ┌─────────┐  ┌─────────┐   │
│  │   SDK   │  │ Claude  │  │  Codex  │  │ Cursor  │   │
│  │ Backend │  │   CLI   │  │   CLI   │  │   CLI   │   │
│  └─────────┘  └─────────┘  └─────────┘  └─────────┘   │
└─────────────────────────────────────────────────────────┘
```

### State Management

```typescript
// Instance state stored in ~/.agent-worker/instances/
interface InstanceState {
  workflow: string
  instance: string
  agents: Record<string, AgentState>
  createdAt: string
  pid: number
}

interface AgentState {
  name: string
  model: string
  socketPath: string
  status: 'starting' | 'running' | 'stopped'
  messageCount: number
}
```

---

## Migration Guide

### CLI Changes

```bash
# Before
agent-worker session new -m anthropic/claude-sonnet-4-5 -n reviewer
agent-worker send "hello" --to reviewer
agent-worker session list
agent-worker session end reviewer

# After
agent-worker new reviewer -m anthropic/claude-sonnet-4-5
agent-worker send "hello" --to reviewer
agent-worker ls
agent-worker down reviewer
```

### Deprecation Strategy

1. **Phase 1**: Add new commands, keep old as aliases with deprecation warning
2. **Phase 2**: Remove old commands in next major version

---

## Implementation Phases

### Phase 1: Core Refactoring
- [ ] Rename `session` to `agent` in CLI
- [ ] Add `new` as shorthand for `agent new`
- [ ] Add `ls` as alias for `agent list`
- [ ] Update internal types

### Phase 2: Instance Support
- [ ] Implement `--instance` flag
- [ ] Add `@instance` syntax for `--to`
- [ ] Update state management for multi-instance

### Phase 3: Workflow Basics
- [ ] Implement workflow file parser
- [ ] Add YAML schema validation
- [ ] Implement variable interpolation

### Phase 4: Workflow Execution
- [ ] Implement `run` command
- [ ] Implement `up` command
- [ ] Implement `down` command
- [ ] Implement `ps` command

### Phase 5: Task Execution
- [ ] Implement shell task executor
- [ ] Implement send task executor
- [ ] Add task output capture

### Phase 6: Advanced Task Features
- [ ] Implement parallel task execution (`parallel` keyword)
- [ ] Implement conditional tasks (`if` field)
- [ ] Add condition expression evaluator

---

## Design Decisions

### 1. Tool Definition

Tools can only be **referenced by name or file path**, not defined inline:

```yaml
agents:
  reviewer:
    tools:
      - read_file              # Built-in tool name
      - search_code            # Built-in tool name
      - ./my-tools.ts          # External file
```

**Rationale**: Tool definitions are complex (parameters, implementations). Inline definition would bloat workflow files and duplicate definitions across workflows.

### 2. Conditional Tasks

Supported via `if` field:

```yaml
tasks:
  - send: "Review"
    to: reviewer
    as: review

  - if: ${{ review.contains('security') }}
    send: "Deep security review"
    to: security-reviewer
```

**Condition syntax**: `${{ expression }}` where expression is evaluated as JavaScript.

### 3. Task Mode and Output Capture

Workflow tasks run in **task execution mode**, not conversation mode:

**Automatic context injection**:
```
[Task Mode] This is a task execution, not a conversation.
Complete the task and provide your final result in the last message.

Task: {send content}
```

**Output capture** - `as` field stores the agent's last message:

```yaml
# Basic: store last message
- send: "Review this code"
  to: reviewer
  as: review

# With summary prompt: agent summarizes before storing
- send: "Review this code"
  to: reviewer
  as:
    name: review
    prompt: "Summarize your review in one sentence"
```

**Behavior**:
- `as: review` → stores agent's last message as `review`
- `as: { name, prompt }` → sends additional prompt, stores that response

### 4. Parallel Tasks

Supported via `parallel` keyword for clarity and extensibility:

```yaml
tasks:
  # Sequential task
  - send: "Review code"
    to: code-reviewer
    as: review

  # Parallel tasks
  - parallel:
      - send: "Security review based on ${{ review }}"
        to: security-reviewer
        as: security
      - send: "Performance review based on ${{ review }}"
        to: perf-reviewer
        as: perf

  # Sequential (waits for parallel to complete)
  - send: "Summarize: ${{ security }} and ${{ perf }}"
    to: summarizer
```

**Execution model**:
- Top-level array items execute sequentially
- `parallel:` block executes all nested tasks concurrently
- All parallel tasks must complete before next sequential task starts
- Variables from parallel tasks are all available after the parallel block

**Future extensibility**:
```yaml
# Potential future syntax for concurrency limits
- parallel:
    max: 3  # Max concurrent tasks
    tasks:
      - send: ...
      - send: ...
```

---

## References

- [Docker Compose specification](https://docs.docker.com/compose/compose-file/)
- [GitHub Actions workflow syntax](https://docs.github.com/en/actions/reference/workflow-syntax-for-github-actions)
- [Ansible Playbook format](https://docs.ansible.com/ansible/latest/playbook_guide/)
