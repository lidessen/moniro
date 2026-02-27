/**
 * AgentDefinition — Top-level persistent agent identity.
 *
 * This is the NEW AgentDefinition from AGENT-TOP-LEVEL architecture.
 * It describes WHO an agent is (prompt, soul, context) — not how it runs in a workflow.
 *
 * Loaded from .agents/*.yaml files. Workflows reference agents by name.
 *
 * Distinct from:
 *   - WorkflowAgentDef (workflow/types.ts) — inline agent config within a workflow
 *   - AgentConfig (agent/config.ts)        — runtime config for daemon-created agents
 */

import { z } from "zod/v4";
import type { ScheduleConfig } from "../daemon/registry.ts";

// ── Soul ──────────────────────────────────────────────────────────

/**
 * Agent soul — persistent identity traits injected into prompt context.
 * Captures WHO the agent is beyond the system prompt.
 *
 * The system prompt says "what to do now"; the soul says "who you are always."
 */
export interface AgentSoul {
  /** What this agent does */
  role?: string;
  /** Domain knowledge areas */
  expertise?: string[];
  /** Communication and work style */
  style?: string;
  /** Core values/guidelines */
  principles?: string[];
  /** Extensible — additional fields preserved */
  [key: string]: unknown;
}

// ── Prompt Config ─────────────────────────────────────────────────

/**
 * Agent prompt configuration.
 * Exactly one of `system` or `system_file` must be provided.
 */
export interface AgentPromptConfig {
  /** Inline system prompt */
  system?: string;
  /** Path to system prompt file (relative to agent YAML location) */
  system_file?: string;
}

// ── Context Config ────────────────────────────────────────────────

/**
 * Agent context directory configuration.
 */
export interface AgentContextConfig {
  /** Path to agent's persistent context directory. Default: .agents/<name>/ */
  dir?: string;
  /** Number of recent messages to keep in prompt thin thread. Default: 10 */
  thin_thread?: number;
}

// ── Agent Definition ──────────────────────────────────────────────

/**
 * Top-level agent definition — loaded from .agents/<name>.yaml.
 *
 * This is the single source of truth for "who this agent is".
 * Workflows reference agents by name; the definition travels with the agent.
 */
export interface AgentDefinition {
  /** Agent name (unique within project, matches filename) */
  name: string;
  /** Model identifier (e.g., 'anthropic/claude-sonnet-4-5') */
  model: string;
  /** Backend type */
  backend?: "sdk" | "claude" | "cursor" | "codex" | "opencode" | "mock";
  /** Provider configuration */
  provider?: string | { name: string; base_url?: string; api_key?: string };
  /** System prompt configuration */
  prompt: AgentPromptConfig;
  /** Persistent identity traits */
  soul?: AgentSoul;
  /** Context directory configuration */
  context?: AgentContextConfig;
  /** Maximum tokens for response */
  max_tokens?: number;
  /** Maximum tool call steps per turn */
  max_steps?: number;
  /** Periodic wakeup schedule */
  schedule?: ScheduleConfig;
}

// ── Context Subdirectories ────────────────────────────────────────

/**
 * Standard subdirectories within an agent's context directory.
 * Created automatically when the agent is loaded.
 */
export const CONTEXT_SUBDIRS = ["memory", "notes", "conversations", "todo"] as const;

// ── Zod Schemas ───────────────────────────────────────────────────

export const AgentSoulSchema = z.object({
  role: z.string().optional(),
  expertise: z.array(z.string()).optional(),
  style: z.string().optional(),
  principles: z.array(z.string()).optional(),
}).passthrough();  // Extensible — custom soul fields preserved

const ProviderConfigSchema = z.object({
  name: z.string(),
  base_url: z.string().optional(),
  api_key: z.string().optional(),
}).passthrough();  // Allow extra provider fields

export const AgentPromptConfigSchema = z.union([
  z.object({ system: z.string(), system_file: z.undefined().optional() }),
  z.object({ system_file: z.string(), system: z.undefined().optional() }),
]);

export const AgentContextConfigSchema = z.object({
  dir: z.string().optional(),
  thin_thread: z.number().int().min(1).optional(),
});

const ScheduleConfigSchema = z.object({
  wakeup: z.union([z.string(), z.number()]),
  prompt: z.string().optional(),
});

export const AgentDefinitionSchema = z.object({
  name: z.string().min(1),
  model: z.string().min(1),
  backend: z
    .enum(["sdk", "claude", "cursor", "codex", "opencode", "mock"])
    .optional(),
  provider: z.union([z.string(), ProviderConfigSchema]).optional(),
  prompt: AgentPromptConfigSchema,
  soul: AgentSoulSchema.optional(),
  context: AgentContextConfigSchema.optional(),
  max_tokens: z.number().int().positive().optional(),
  max_steps: z.number().int().positive().optional(),
  schedule: ScheduleConfigSchema.optional(),
});
