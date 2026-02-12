/**
 * Workflow file type definitions
 */

import type { ContextConfig } from "./context/types.ts";

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

// ==================== Agent Definition ====================

export interface AgentDefinition {
  /** Backend to use: 'default' (Vercel AI SDK), 'claude', 'cursor', 'codex', 'opencode', 'mock' (testing) */
  backend?: "default" | "claude" | "cursor" | "codex" | "opencode" | "mock";

  /** Model identifier (e.g., 'anthropic/claude-sonnet-4-5'). Optional for CLI backends that have defaults. */
  model?: string;

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
