/**
 * Workflow file type definitions
 */

import type { ContextConfig } from "./context/types.ts";
import type { ProviderConfig, ScheduleConfig, AgentDefinition } from "@moniro/agent-loop";
import type { PersonalContextProvider } from "@moniro/agent-worker";

/**
 * Minimal handle interface — the workflow layer only needs the definition
 * plus optional personal context operations for prompt injection and MCP tools.
 *
 * Personal context methods come from PersonalContextProvider (@moniro/agent-worker).
 * This interface adds the definition field needed by the workflow layer.
 */
export interface AgentHandleRef extends PersonalContextProvider {
  readonly definition: AgentDefinition;
}

// Re-export context types for convenience
export type { ContextConfig, FileContextConfig, MemoryContextConfig } from "./context/types.ts";

// Re-export ProviderConfig (canonical source: @moniro/agent)
export type { ProviderConfig } from "@moniro/agent-loop";

// ==================== Workflow File ====================

/**
 * Workflow file structure
 */
export interface WorkflowFile {
  /** Workflow name (defaults to filename) */
  name?: string;

  /** Agent definitions — ref entries or inline definitions */
  agents: Record<string, AgentEntry>;

  /**
   * Shared context configuration
   * - undefined (not set): default file provider enabled
   * - false: explicitly disabled
   * - { provider: 'file', config?: { dir | bind } }: file provider (ephemeral or persistent)
   * - { provider: 'memory' }: memory provider (for testing)
   */
  context?: ContextConfig;

  /**
   * Workflow parameters — CLI-style definitions.
   * Values are passed after the workflow file on the command line
   * and accessible via ${{ params.name }} interpolation.
   */
  params?: ParamDefinition[];

  /**
   * Setup commands - run before kickoff
   * Shell commands to prepare variables for kickoff
   */
  setup?: SetupTask[];

  /**
   * Channel bridge configuration — connect external platforms to the workspace channel.
   * Each entry creates an adapter for one external platform.
   */
  bridges?: BridgeConfig[];

  /**
   * Kickoff message - initiates workflow via @mention
   * Optional: if omitted, agents start but wait for external trigger
   */
  kickoff?: string;
}

// ==================== Bridge Config ====================

/** Bridge adapter configuration in workflow YAML */
export interface BridgeConfig {
  /** Adapter type (e.g., "telegram") */
  adapter: string;
  /** Telegram bot token (supports ${{ env.VAR }} interpolation) */
  bot_token?: string;
  /** Telegram chat ID (supports ${{ env.VAR }} interpolation) */
  chat_id?: string;
}

// ==================== Agent Entry (Workflow YAML) ════════════════════

/**
 * Reference to a global agent definition from .agents/*.yaml.
 * The agent carries its persistent context (memory, notes, todo) into the workflow.
 */
export interface RefAgentEntry {
  /** Name of the global agent to reference */
  ref: string;
  /** Optional prompt extension for this workflow */
  prompt?: { append: string };
  /** Runtime overrides */
  max_tokens?: number;
  max_steps?: number;
}

/**
 * Inline agent definition — workflow-local, same structure as WorkflowAgentDef.
 * Formal type alias for the discriminated union.
 */
export type InlineAgentEntry = WorkflowAgentDef;

/**
 * A workflow agent entry — either a reference to a global agent or an inline definition.
 * Discriminated by presence of `ref` field.
 */
export type AgentEntry = RefAgentEntry | InlineAgentEntry;

/** Type guard: is this agent entry a reference to a global agent? */
export function isRefAgentEntry(entry: AgentEntry): entry is RefAgentEntry {
  return "ref" in entry && typeof (entry as RefAgentEntry).ref === "string";
}

// ==================== Agent Definition ====================

export interface WorkflowAgentDef {
  /** Backend to use: 'default' (Vercel AI SDK), 'claude', 'cursor', 'codex', 'opencode', 'mock' (testing) */
  backend?: "default" | "claude" | "cursor" | "codex" | "opencode" | "mock";

  /** Model identifier. When provider is set, this is just the model name (e.g., 'MiniMax-M2.5').
   *  Without provider, uses existing formats: 'provider/model', 'provider:model', or 'provider'.
   *  Use 'auto' for auto-detection from environment. */
  model?: string;

  /**
   * Provider configuration — string (built-in name) or object (custom endpoint).
   * When set, 'model' is just the model name without provider prefix.
   */
  provider?: string | ProviderConfig;

  /** System prompt - inline string or file path (optional) */
  system_prompt?: string;

  /** Tool names to enable */
  tools?: string[];

  /** Maximum tokens for response */
  max_tokens?: number;

  /** Maximum tool call steps per turn (default: 200) */
  max_steps?: number;

  /** Backend timeout in milliseconds (overrides backend default) */
  timeout?: number;

  /** Periodic wakeup schedule: number (ms), duration string ("30s"/"5m"/"2h"), or cron expression */
  wakeup?: string | number;

  /** Custom prompt for wakeup events */
  wakeup_prompt?: string;
}

// ==================== Param Definition ====================

/** Supported parameter types */
export type ParamType = "string" | "number" | "boolean";

/** A workflow parameter definition (CLI-style) */
export interface ParamDefinition {
  /** Parameter name (used as --name on CLI) */
  name: string;
  /** Human-readable description */
  description?: string;
  /** Value type (default: "string") */
  type?: ParamType;
  /** Short flag (single character, used as -x on CLI) */
  short?: string;
  /** Whether the parameter is required */
  required?: boolean;
  /** Default value */
  default?: string | number | boolean;
}

// ==================== Setup Task ====================

export interface SetupTask {
  /** Shell command to execute */
  shell: string;

  /** Variable name to store output */
  as?: string;
}

// ==================== Parsed Workflow ====================

export interface ParsedWorkflow {
  name: string;
  filePath: string;
  /**
   * Absolute path to the source root directory.
   * - Local workflows: directory containing the workflow file
   * - Remote workflows: root of the cloned repository
   *
   * Exposed as ${{ source.dir }} in workflow interpolation.
   */
  sourceDir: string;
  agents: Record<string, ResolvedWorkflowAgent>;

  /** Resolved context configuration */
  context?: ResolvedContext;

  /** Workflow parameter definitions */
  params?: ParamDefinition[];

  /** Setup tasks */
  setup: SetupTask[];

  /** Kickoff message (with variables interpolated) */
  kickoff?: string;
}

export interface ResolvedWorkflowAgent extends WorkflowAgentDef {
  /** Resolved system prompt content */
  resolvedSystemPrompt?: string;

  /** Schedule config derived from wakeup/wakeup_prompt fields */
  schedule?: ScheduleConfig;

  /** Agent handle for ref agents (undefined for inline agents) */
  handle?: AgentHandleRef;

  /** Whether this agent was resolved from a global definition */
  isRef?: boolean;
}

/** Resolved context configuration */
export type ResolvedContext = ResolvedFileContext | ResolvedMemoryContext;

/** Resolved file context with actual paths */
export interface ResolvedFileContext {
  provider: "file";
  /** Context directory path */
  dir: string;
  /** Document owner (single-writer model, optional) */
  documentOwner?: string;
  /**
   * Whether this context is persistent (bound).
   * When true, shutdown preserves ALL state (inbox, channel, docs).
   * When false (default), shutdown clears transient state (inbox cursors).
   */
  persistent?: boolean;
}

/** Resolved memory context (for testing) */
export interface ResolvedMemoryContext {
  provider: "memory";
  /** Document owner (single-writer model, optional) */
  documentOwner?: string;
}

// ==================== Validation ====================

export interface ValidationError {
  path: string;
  message: string;
}

export interface ValidationResult {
  valid: boolean;
  errors: ValidationError[];
}
