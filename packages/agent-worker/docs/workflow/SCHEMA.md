<!-- Auto-generated from src/workflow/schema.ts — DO NOT EDIT -->
<!-- Regenerate: bun scripts/gen-workflow-ref.ts > docs/workflow/SCHEMA.md -->

# Workflow YAML Schema Reference

Source of truth: [`src/workflow/schema.ts`](../../src/workflow/schema.ts)

---

## Workflow File

Workflow file — defines agents, context, and orchestration

| Field     | Type                                        | Required | Description                                                                              |
| --------- | ------------------------------------------- | -------- | ---------------------------------------------------------------------------------------- |
| `name`    | string                                      | no       | Workflow name (defaults to filename without extension)                                   |
| `agents`  | Record<string, [AgentEntry](#agent-entry)>  | **yes**  | Agent definitions — keyed by agent name                                                  |
| `context` | [ContextConfig](#context-configuration)     | no       | Shared context — `undefined`/`null` = default file provider, `false` = disabled          |
| `params`  | [ParamDefinition](#parameter-definitions)[] | no       | CLI-style parameter definitions                                                          |
| `setup`   | [SetupTask](#setup-tasks)[]                 | no       | Setup commands — run sequentially before kickoff                                         |
| `kickoff` | string                                      | no       | Kickoff message — initiates the workflow via `@mention`. Supports variable interpolation |

### Example

```yaml
name: review

agents:
  alice: { ref: alice }
  bob:
    ref: bob
    prompt:
      append: Focus on performance issues.
  helper:
    model: anthropic/claude-haiku-4-5
    system_prompt: You help with quick lookups.

context: null # default file provider

params:
  - name: target
    description: Branch to review
    required: true

setup:
  - shell: git diff main...${{ params.target }}
    as: changes

kickoff: |
  @alice Review these changes:
  ${{ changes }}
```

---

## Agent Entry

Agent entry — either a `ref` to a global agent or an inline definition. Discriminated by presence of `ref`

Workflows support two agent entry types:

| Type             | Discriminator   | Use Case                                       |
| ---------------- | --------------- | ---------------------------------------------- |
| **Ref agent**    | Has `ref` field | Reference a global agent from `.agents/*.yaml` |
| **Inline agent** | No `ref` field  | Define a workflow-local temporary agent        |

### Ref Agent Entry

Reference to a global agent definition — carries persistent context (memory, notes, todo)

| Field        | Type   | Required | Description                                                   |
| ------------ | ------ | -------- | ------------------------------------------------------------- |
| `ref`        | string | **yes**  | Name of the global agent to reference (from `.agents/*.yaml`) |
| `prompt`     | object | no       | Prompt extension for this workflow                            |
| `max_tokens` | number | no       | Override maximum tokens for response                          |
| `max_steps`  | number | no       | Override maximum tool call steps per turn                     |

**Disallowed fields**: `model`, `backend`, `provider`, `tools`, `system_prompt`, `wakeup`, `wakeup_prompt`, `timeout` — these come from the agent definition.

#### Examples

```yaml
# Shorthand — use agent as-is
alice: { ref: alice }

# With prompt extension
bob:
  ref: bob
  prompt:
    append: |
      In this workflow, focus on security issues.

# With runtime overrides
charlie:
  ref: charlie
  max_tokens: 16000
  max_steps: 50
```

### Inline Agent Entry

Inline agent definition — workflow-local, no persistent identity

| Field           | Type                                                                             | Required | Description                                                                                                                                    |
| --------------- | -------------------------------------------------------------------------------- | -------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| `backend`       | `"default"` \| `"claude"` \| `"cursor"` \| `"codex"` \| `"opencode"` \| `"mock"` | no       | Backend to use. `default` = Vercel AI SDK, others = CLI wrappers. CLI backends (`claude`, `cursor`, `codex`, `opencode`) don't require `model` |
| `model`         | string                                                                           | no       | Model identifier. Required for `default` backend. Formats: `provider/model`, `provider:model`, or `auto` for env-based detection               |
| `provider`      | string \| [ProviderConfig](#provider-configuration)                              | no       | Provider configuration — string (built-in name) or object (custom endpoint)                                                                    |
| `system_prompt` | string                                                                           | no       | System prompt — inline string or file path ending in `.txt`/`.md` (auto-loaded)                                                                |
| `tools`         | string[]                                                                         | no       | Tool names to enable for this agent                                                                                                            |
| `max_tokens`    | number                                                                           | no       | Maximum tokens for response                                                                                                                    |
| `max_steps`     | number                                                                           | no       | Maximum tool call steps per turn (default: 200)                                                                                                |
| `timeout`       | number                                                                           | no       | Backend timeout in milliseconds (overrides backend default)                                                                                    |
| `wakeup`        | string \| number                                                                 | no       | Periodic wakeup schedule: number (ms), duration string (`"30s"`/`"5m"`/`"2h"`), or cron expression                                             |
| `wakeup_prompt` | string                                                                           | no       | Custom prompt for wakeup events (requires `wakeup` to be set)                                                                                  |

#### Backend model requirements

| Backend    | `model` required? | Notes                                  |
| ---------- | ----------------- | -------------------------------------- |
| `default`  | **yes**           | Vercel AI SDK — needs model identifier |
| `claude`   | no                | Uses Claude Code CLI defaults          |
| `cursor`   | no                | Uses Cursor Agent defaults             |
| `codex`    | no                | Uses Codex CLI defaults                |
| `opencode` | no                | Uses OpenCode CLI defaults             |
| `mock`     | no                | Testing backend — echoes input         |

#### Examples

```yaml
# Minimal inline agent
helper:
  model: anthropic/claude-haiku-4-5
  system_prompt: You help with quick lookups.

# CLI backend (no model needed)
coder:
  backend: claude
  system_prompt: You write code.

# Full configuration
reviewer:
  model: anthropic/claude-sonnet-4-5
  provider:
    name: anthropic
    base_url: https://custom.api.com
    api_key: $CUSTOM_API_KEY
  system_prompt: prompts/reviewer.md
  tools: [read_file, write_file]
  max_tokens: 8000
  max_steps: 100
  timeout: 120000

# With periodic wakeup
monitor:
  model: anthropic/claude-haiku-4-5
  system_prompt: Check system health.
  wakeup: 5m
  wakeup_prompt: Run your health check now.
```

---

## Provider Configuration

Custom provider configuration for API endpoint overrides

| Field      | Type   | Required | Description                                                                             |
| ---------- | ------ | -------- | --------------------------------------------------------------------------------------- |
| `name`     | string | **yes**  | Provider SDK name (e.g., `anthropic`, `openai`)                                         |
| `base_url` | string | no       | Override base URL for the provider                                                      |
| `api_key`  | string | no       | API key — env var reference with `$` prefix (e.g., `$MINIMAX_API_KEY`) or literal value |

#### Examples

```yaml
# String shorthand
provider: anthropic

# Custom endpoint
provider:
  name: anthropic
  base_url: https://api.minimax.io/anthropic/v1
  api_key: $MINIMAX_API_KEY
```

---

## Context Configuration

Shared context for agent collaboration (channel, inbox, documents).

| Value                       | Behavior                                     |
| --------------------------- | -------------------------------------------- |
| _(not set)_ / `null`        | Default file provider enabled                |
| `false`                     | Context explicitly disabled                  |
| `{ provider: "file", ... }` | File-based context (ephemeral or persistent) |
| `{ provider: "memory" }`    | In-memory context (for testing)              |

### File Context Config

| Field  | Type   | Required | Description                                                     |
| ------ | ------ | -------- | --------------------------------------------------------------- |
| `dir`  | string | no       | Ephemeral context directory path (template variables supported) |
| `bind` | string | no       | Persistent context directory path — state survives across runs  |

> `dir` and `bind` are mutually exclusive. `bind` enables persistent mode.

#### Examples

```yaml
# Default (auto-generated ephemeral dir)
context: null

# Disabled
context: false

# Persistent context
context:
  provider: file
  config:
    bind: ./data/review

# In-memory (testing)
context:
  provider: memory
```

---

## Parameter Definitions

CLI-style workflow parameter definition

| Field         | Type                                    | Required | Description                                         |
| ------------- | --------------------------------------- | -------- | --------------------------------------------------- |
| `name`        | string                                  | **yes**  | Parameter name (used as `--name` on CLI)            |
| `description` | string                                  | no       | Human-readable description                          |
| `type`        | `"string"` \| `"number"` \| `"boolean"` | no       | Value type (default: `"string"`)                    |
| `short`       | string                                  | no       | Short flag — single character (used as `-x` on CLI) |
| `required`    | boolean                                 | no       | Whether the parameter is required                   |
| `default`     | string \| number \| boolean             | no       | Default value when not provided                     |

Parameters are passed on the CLI after the workflow file and accessible via `${{ params.name }}` interpolation.

#### Example

```yaml
params:
  - name: target
    description: Branch to review
    type: string
    short: t
    required: true
  - name: depth
    description: Analysis depth
    type: number
    default: 3
  - name: verbose
    description: Enable verbose output
    type: boolean
    short: v
```

CLI usage:

```sh
moniro run review.yml --target main -v --depth 5
```

---

## Setup Tasks

Setup command — runs before kickoff to prepare variables

| Field   | Type   | Required | Description                                                                        |
| ------- | ------ | -------- | ---------------------------------------------------------------------------------- |
| `shell` | string | **yes**  | Shell command to execute before kickoff                                            |
| `as`    | string | no       | Variable name to store command output (accessible via `${{ name }}` interpolation) |

Setup tasks run sequentially before kickoff. Output captured via `as` is available in `${{ name }}` interpolation.

Reserved variable names: `env`, `workflow`, `params`, `source`

#### Example

```yaml
setup:
  - shell: git diff main...HEAD
    as: changes
  - shell: date -u +%Y-%m-%d
    as: today
```

---

## Variable Interpolation

Variables use `${{ name }}` syntax throughout the workflow YAML (kickoff, system_prompt, etc.).

| Namespace     | Example                | Source                            |
| ------------- | ---------------------- | --------------------------------- |
| _(top-level)_ | `${{ changes }}`       | Setup task output (`as: changes`) |
| `env.*`       | `${{ env.API_KEY }}`   | Environment variables             |
| `params.*`    | `${{ params.target }}` | CLI parameters                    |
| `workflow.*`  | `${{ workflow.name }}` | Workflow metadata                 |
| `source.*`    | `${{ source.dir }}`    | Source directory path             |
