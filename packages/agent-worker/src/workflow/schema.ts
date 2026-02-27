/**
 * Workflow YAML Schema — Single source of truth.
 *
 * Used for:
 *   1. Reference documentation generation (scripts/gen-workflow-ref.ts)
 *   2. Future: replace hand-written validateWorkflow() in parser.ts
 *
 * Every field has a .describe() — the generator reads these to produce docs.
 */

import { z } from "zod";

// ── Reusable Components ──────────────────────────────────────────

export const ProviderConfigSchema = z
  .object({
    name: z.string().describe("Provider SDK name (e.g., `anthropic`, `openai`)"),
    base_url: z.string().optional().describe("Override base URL for the provider"),
    api_key: z
      .string()
      .optional()
      .describe("API key — env var reference with `$` prefix (e.g., `$MINIMAX_API_KEY`) or literal value"),
  })
  .describe("Custom provider configuration for API endpoint overrides");

// ── Agent Entries ────────────────────────────────────────────────

export const RefAgentEntrySchema = z
  .object({
    ref: z.string().min(1).describe("Name of the global agent to reference (from `.agents/*.yaml`)"),
    prompt: z
      .object({
        append: z.string().describe("Additional instructions appended to the agent's base system prompt"),
      })
      .optional()
      .describe("Prompt extension for this workflow"),
    max_tokens: z.number().int().positive().optional().describe("Override maximum tokens for response"),
    max_steps: z.number().int().positive().optional().describe("Override maximum tool call steps per turn"),
  })
  .describe("Reference to a global agent definition — carries persistent context (memory, notes, todo)");

export const InlineAgentEntrySchema = z
  .object({
    backend: z
      .enum(["default", "claude", "cursor", "codex", "opencode", "mock"])
      .optional()
      .describe(
        "Backend to use. `default` = Vercel AI SDK, others = CLI wrappers. " +
          "CLI backends (`claude`, `cursor`, `codex`, `opencode`) don't require `model`",
      ),
    model: z
      .string()
      .optional()
      .describe(
        "Model identifier. Required for `default` backend. " +
          "Formats: `provider/model`, `provider:model`, or `auto` for env-based detection",
      ),
    provider: z
      .union([z.string(), ProviderConfigSchema])
      .optional()
      .describe("Provider configuration — string (built-in name) or object (custom endpoint)"),
    system_prompt: z
      .string()
      .optional()
      .describe("System prompt — inline string or file path ending in `.txt`/`.md` (auto-loaded)"),
    tools: z.array(z.string()).optional().describe("Tool names to enable for this agent"),
    max_tokens: z.number().int().positive().optional().describe("Maximum tokens for response"),
    max_steps: z
      .number()
      .int()
      .positive()
      .optional()
      .describe("Maximum tool call steps per turn (default: 200)"),
    timeout: z
      .number()
      .int()
      .positive()
      .optional()
      .describe("Backend timeout in milliseconds (overrides backend default)"),
    wakeup: z
      .union([z.string(), z.number()])
      .optional()
      .describe('Periodic wakeup schedule: number (ms), duration string (`"30s"`/`"5m"`/`"2h"`), or cron expression'),
    wakeup_prompt: z
      .string()
      .optional()
      .describe("Custom prompt for wakeup events (requires `wakeup` to be set)"),
  })
  .describe("Inline agent definition — workflow-local, no persistent identity");

export const AgentEntrySchema = z
  .union([RefAgentEntrySchema, InlineAgentEntrySchema])
  .describe("Agent entry — either a `ref` to a global agent or an inline definition. Discriminated by presence of `ref`");

// ── Context ──────────────────────────────────────────────────────

const FileContextConfigSchema = z
  .object({
    dir: z.string().optional().describe("Ephemeral context directory path (template variables supported)"),
    bind: z.string().optional().describe("Persistent context directory path — state survives across runs"),
  })
  .describe("File context configuration (`dir` and `bind` are mutually exclusive)");

export const ContextConfigSchema = z
  .union([
    z.literal(false).describe("Explicitly disable shared context"),
    z
      .object({
        provider: z
          .enum(["file", "memory"])
          .describe('Context provider type. `file` for disk-based, `memory` for testing'),
        config: FileContextConfigSchema.optional().describe("Provider-specific configuration"),
        documentOwner: z
          .string()
          .optional()
          .describe("Document owner for single-writer model"),
      })
      .describe("Shared context configuration"),
  ])
  .optional()
  .describe("Shared context — `undefined`/`null` = default file provider, `false` = disabled");

// ── Params ───────────────────────────────────────────────────────

export const ParamDefinitionSchema = z
  .object({
    name: z.string().min(1).describe("Parameter name (used as `--name` on CLI)"),
    description: z.string().optional().describe("Human-readable description"),
    type: z
      .enum(["string", "number", "boolean"])
      .optional()
      .describe('Value type (default: `"string"`)'),
    short: z
      .string()
      .max(1)
      .optional()
      .describe("Short flag — single character (used as `-x` on CLI)"),
    required: z.boolean().optional().describe("Whether the parameter is required"),
    default: z
      .union([z.string(), z.number(), z.boolean()])
      .optional()
      .describe("Default value when not provided"),
  })
  .describe("CLI-style workflow parameter definition");

// ── Setup ────────────────────────────────────────────────────────

export const SetupTaskSchema = z
  .object({
    shell: z.string().min(1).describe("Shell command to execute before kickoff"),
    as: z
      .string()
      .optional()
      .describe("Variable name to store command output (accessible via `${{ name }}` interpolation)"),
  })
  .describe("Setup command — runs before kickoff to prepare variables");

// ── Workflow File ────────────────────────────────────────────────

export const WorkflowFileSchema = z
  .object({
    name: z.string().optional().describe("Workflow name (defaults to filename without extension)"),
    agents: z.record(z.string(), AgentEntrySchema).describe("Agent definitions — keyed by agent name"),
    context: ContextConfigSchema,
    params: z.array(ParamDefinitionSchema).optional().describe("CLI-style parameter definitions"),
    setup: z.array(SetupTaskSchema).optional().describe("Setup commands — run sequentially before kickoff"),
    kickoff: z
      .string()
      .optional()
      .describe("Kickoff message — initiates the workflow via `@mention`. Supports variable interpolation"),
  })
  .describe("Workflow file — defines agents, context, and orchestration");
