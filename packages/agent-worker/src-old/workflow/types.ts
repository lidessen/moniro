/**
 * Workflow file type definitions
 */

import type { ContextConfig } from "./context/types.ts";
import type { ScheduleConfig } from "../daemon/registry.ts";

// Re-export context types for convenience
export type { ContextConfig, FileContextConfig, MemoryContextConfig } from "./context/types.ts";

// ==================== Workflow File ====================

/**
 * Workflow file structure
 */
export interface WorkflowFile {
  /** Workflow name (defaults to filename) */
  name?: string;

  /** Agent definitions */
  agents: Record<string, AgentDefinition>;

  /**
   * Shared context configuration
   * - undefined (not set): default file provider enabled
   * - false: explicitly disabled
   * - { provider: 'file', config?: { dir | bind } }: file provider (ephemeral or persistent)
   * - { provider: 'memory' }: memory provider (for testing)
   */
  context?: ContextConfig;

  /**
   * Setup commands - run before kickoff
   * Shell commands to prepare variables for kickoff
   */
  setup?: SetupTask[];

  /**
   * Kickoff message - initiates workflow via @mention
   * Optional: if omitted, agents start but wait for external trigger
   */
  kickoff?: string;
}

// ==================== Provider Configuration ====================

/**
 * Custom provider configuration for API endpoint overrides.
 * Allows pointing any compatible SDK at a different base URL.
 *
 * Examples:
 *   provider: anthropic                    # string → built-in provider
 *   provider:                              # object → custom endpoint
 *     name: anthropic
 *     base_url: https://api.minimax.io/anthropic/v1
 *     api_key: $MINIMAX_API_KEY
 */
export interface ProviderConfig {
  /** Provider SDK name (e.g., 'anthropic', 'openai') */
  name: string;
  /** Override base URL for the provider */
  base_url?: string;
  /** API key — env var reference with '$' prefix (e.g., '$MINIMAX_API_KEY') or literal value */
  api_key?: string;
}

// ==================== Agent Definition ====================

export interface AgentDefinition {
  /** Backend to use: 'default' (Vercel AI SDK), 'claude', 'cursor', 'codex', 'opencode', 'mock' (testing) */
  backend?: "default" | "claude" | "cursor" | "codex" | "opencode" | "mock";

  /** Model identifier. When provider is set, this is just the model name (e.g., 'MiniMax-M2.5').
   *  Without provider, uses existing formats: 'provider/model', 'provider:model', or 'provider'. */
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
  agents: Record<string, ResolvedAgent>;

  /** Resolved context configuration */
  context?: ResolvedContext;

  /** Setup tasks */
  setup: SetupTask[];

  /** Kickoff message (with variables interpolated) */
  kickoff?: string;
}

export interface ResolvedAgent extends AgentDefinition {
  /** Resolved system prompt content */
  resolvedSystemPrompt?: string;

  /** Schedule config derived from wakeup/wakeup_prompt fields */
  schedule?: ScheduleConfig;
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
