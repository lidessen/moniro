#!/usr/bin/env bun
/**
 * Generate Workflow YAML Reference from Zod schema.
 *
 * Usage:
 *   bun scripts/gen-workflow-ref.ts                    # stdout
 *   bun scripts/gen-workflow-ref.ts > docs/workflow/SCHEMA.md
 *
 * Source of truth: src/workflow/schema.ts
 */

import {
  WorkflowFileSchema,
  AgentEntrySchema,
  RefAgentEntrySchema,
  InlineAgentEntrySchema,
  ContextConfigSchema,
  ParamDefinitionSchema,
  SetupTaskSchema,
  ProviderConfigSchema,
} from "../src/workflow/schema.ts";

// ── Zod 4 Introspection Helpers ──────────────────────────────────

interface FieldInfo {
  name: string;
  type: string;
  required: boolean;
  description: string;
}

/**
 * Named type references — map schema instances to markdown links.
 * Used to render "[AgentEntry](#agent-entry)" instead of "object | object".
 */
const NAMED_TYPES = new Map<any, string>();

function registerNamedType(schema: any, label: string, anchor: string): void {
  NAMED_TYPES.set(schema, `[${label}](#${anchor})`);
}

/** Get the Zod def type string */
function defType(schema: any): string {
  return schema?._zod?.def?.type ?? "unknown";
}

/** Get human-readable type string from a Zod schema */
function typeString(schema: any): string {
  // Check named type map first
  if (NAMED_TYPES.has(schema)) return NAMED_TYPES.get(schema)!;

  const dt = defType(schema);

  switch (dt) {
    case "string":
      return "string";
    case "number":
      return "number";
    case "boolean":
      return "boolean";
    case "literal": {
      const val = schema._zod.def.value;
      return typeof val === "string" ? `\`"${val}"\`` : `\`${val}\``;
    }
    case "enum": {
      const values = [...schema._zod.values];
      return values.map((v: string) => `\`"${v}"\``).join(" \\| ");
    }
    case "array": {
      const el = schema._zod.def.element;
      return `${typeString(el)}[]`;
    }
    case "optional": {
      const inner = schema._zod.def.innerType;
      // Check named types for the inner schema too
      if (NAMED_TYPES.has(inner)) return NAMED_TYPES.get(inner)!;
      return typeString(inner);
    }
    case "union": {
      const opts = schema._zod.def.options;
      // Check if the whole union is named
      return opts.map((o: any) => typeString(o)).join(" \\| ");
    }
    case "object":
      return "object";
    case "record": {
      const val = schema._zod.def.valueType;
      return `Record<string, ${typeString(val)}>`;
    }
    default:
      return dt;
  }
}

/** Check if a schema is optional */
function isOptional(schema: any): boolean {
  return defType(schema) === "optional";
}

/** Unwrap optional to get inner schema */
function unwrap(schema: any): any {
  if (defType(schema) === "optional") {
    return schema._zod.def.innerType;
  }
  return schema;
}

/** Get description from a schema (checks inner for optionals) */
function getDesc(schema: any): string {
  return schema.description ?? unwrap(schema)?.description ?? "";
}

/** Extract field info from an object schema */
function extractFields(schema: any): FieldInfo[] {
  const shape = schema._zod?.def?.shape;
  if (!shape) return [];

  const fields: FieldInfo[] = [];
  for (const [name, fieldSchema] of Object.entries(shape) as [string, any][]) {
    fields.push({
      name,
      type: typeString(fieldSchema),
      required: !isOptional(fieldSchema),
      description: getDesc(fieldSchema),
    });
  }
  return fields;
}

/** Render a fields table */
function fieldsTable(fields: FieldInfo[]): string {
  if (fields.length === 0) return "";
  const lines = [
    "| Field | Type | Required | Description |",
    "|-------|------|----------|-------------|",
  ];
  for (const f of fields) {
    const req = f.required ? "**yes**" : "no";
    lines.push(`| \`${f.name}\` | ${f.type} | ${req} | ${f.description} |`);
  }
  return lines.join("\n");
}

// ── Document Generation ──────────────────────────────────────────

function generate(): string {
  // Register named types for cross-referencing
  registerNamedType(AgentEntrySchema, "AgentEntry", "agent-entry");
  registerNamedType(RefAgentEntrySchema, "RefAgentEntry", "ref-agent-entry");
  registerNamedType(InlineAgentEntrySchema, "InlineAgentEntry", "inline-agent-entry");
  registerNamedType(ContextConfigSchema, "ContextConfig", "context-configuration");
  registerNamedType(ParamDefinitionSchema, "ParamDefinition", "parameter-definitions");
  registerNamedType(SetupTaskSchema, "SetupTask", "setup-tasks");
  registerNamedType(ProviderConfigSchema, "ProviderConfig", "provider-configuration");

  const sections: string[] = [];

  sections.push(`<!-- Auto-generated from src/workflow/schema.ts — DO NOT EDIT -->
<!-- Regenerate: bun scripts/gen-workflow-ref.ts > docs/workflow/SCHEMA.md -->

# Workflow YAML Schema Reference

Source of truth: [\`src/workflow/schema.ts\`](../../src/workflow/schema.ts)

---`);

  // ── Top-level
  sections.push(`## Workflow File

${WorkflowFileSchema.description}

${fieldsTable(extractFields(WorkflowFileSchema))}

### Example

\`\`\`yaml
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

context: null    # default file provider

params:
  - name: target
    description: Branch to review
    required: true

setup:
  - shell: git diff main...\${{ params.target }}
    as: changes

kickoff: |
  @alice Review these changes:
  \${{ changes }}
\`\`\``);

  // ── Agent Entry
  sections.push(`---

## Agent Entry

${AgentEntrySchema.description ?? ""}

Workflows support two agent entry types:

| Type | Discriminator | Use Case |
|------|--------------|----------|
| **Ref agent** | Has \`ref\` field | Reference a global agent from \`.agents/*.yaml\` |
| **Inline agent** | No \`ref\` field | Define a workflow-local temporary agent |`);

  // ── Ref Agent
  sections.push(`### Ref Agent Entry

${RefAgentEntrySchema.description}

${fieldsTable(extractFields(RefAgentEntrySchema))}

**Disallowed fields**: \`model\`, \`backend\`, \`provider\`, \`tools\`, \`system_prompt\`, \`wakeup\`, \`wakeup_prompt\`, \`timeout\` — these come from the agent definition.

#### Examples

\`\`\`yaml
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
\`\`\``);

  // ── Inline Agent
  sections.push(`### Inline Agent Entry

${InlineAgentEntrySchema.description}

${fieldsTable(extractFields(InlineAgentEntrySchema))}

#### Backend model requirements

| Backend | \`model\` required? | Notes |
|---------|-------------------|-------|
| \`default\` | **yes** | Vercel AI SDK — needs model identifier |
| \`claude\` | no | Uses Claude Code CLI defaults |
| \`cursor\` | no | Uses Cursor Agent defaults |
| \`codex\` | no | Uses Codex CLI defaults |
| \`opencode\` | no | Uses OpenCode CLI defaults |
| \`mock\` | no | Testing backend — echoes input |

#### Examples

\`\`\`yaml
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
    api_key: \$CUSTOM_API_KEY
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
\`\`\``);

  // ── Provider Config
  sections.push(`---

## Provider Configuration

${ProviderConfigSchema.description}

${fieldsTable(extractFields(ProviderConfigSchema))}

#### Examples

\`\`\`yaml
# String shorthand
provider: anthropic

# Custom endpoint
provider:
  name: anthropic
  base_url: https://api.minimax.io/anthropic/v1
  api_key: \$MINIMAX_API_KEY
\`\`\``);

  // ── Context
  sections.push(`---

## Context Configuration

Shared context for agent collaboration (channel, inbox, documents).

| Value | Behavior |
|-------|----------|
| *(not set)* / \`null\` | Default file provider enabled |
| \`false\` | Context explicitly disabled |
| \`{ provider: "file", ... }\` | File-based context (ephemeral or persistent) |
| \`{ provider: "memory" }\` | In-memory context (for testing) |

### File Context Config

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| \`dir\` | string | no | Ephemeral context directory path (template variables supported) |
| \`bind\` | string | no | Persistent context directory path — state survives across runs |

> \`dir\` and \`bind\` are mutually exclusive. \`bind\` enables persistent mode.

#### Examples

\`\`\`yaml
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
\`\`\``);

  // ── Params
  sections.push(`---

## Parameter Definitions

${ParamDefinitionSchema.description}

${fieldsTable(extractFields(ParamDefinitionSchema))}

Parameters are passed on the CLI after the workflow file and accessible via \`\${{ params.name }}\` interpolation.

#### Example

\`\`\`yaml
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
\`\`\`

CLI usage:

\`\`\`sh
moniro run review.yml --target main -v --depth 5
\`\`\``);

  // ── Setup
  sections.push(`---

## Setup Tasks

${SetupTaskSchema.description}

${fieldsTable(extractFields(SetupTaskSchema))}

Setup tasks run sequentially before kickoff. Output captured via \`as\` is available in \`\${{ name }}\` interpolation.

Reserved variable names: \`env\`, \`workflow\`, \`params\`, \`source\`

#### Example

\`\`\`yaml
setup:
  - shell: git diff main...HEAD
    as: changes
  - shell: date -u +%Y-%m-%d
    as: today
\`\`\``);

  // ── Interpolation
  sections.push(`---

## Variable Interpolation

Variables use \`\${{ name }}\` syntax throughout the workflow YAML (kickoff, system_prompt, etc.).

| Namespace | Example | Source |
|-----------|---------|--------|
| *(top-level)* | \`\${{ changes }}\` | Setup task output (\`as: changes\`) |
| \`env.*\` | \`\${{ env.API_KEY }}\` | Environment variables |
| \`params.*\` | \`\${{ params.target }}\` | CLI parameters |
| \`workflow.*\` | \`\${{ workflow.name }}\` | Workflow metadata |
| \`source.*\` | \`\${{ source.dir }}\` | Source directory path |`);

  return sections.join("\n\n");
}

// ── Main ─────────────────────────────────────────────────────────

console.log(generate());
