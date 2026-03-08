/**
 * AgentFeature — the worker-level customization surface.
 *
 * Features contribute prompt sections, tools, MCP tools, and lifecycle hooks.
 * They use activation/checkpoint semantics, NOT step semantics.
 *
 * Key distinction from ExecutionHooks:
 * - ExecutionHooks operate at step level (SDK-only)
 * - AgentFeature hooks operate at activation/checkpoint level (all backends)
 */

import type { PersonalContext } from "../context/types.ts";
import type { ConversationMessage } from "../conversation.ts";
import type {
  ActivationOutcome,
  ActivationSnapshot,
  Checkpoint,
  CheckpointDecision,
  RuntimeSignal,
} from "./types.ts";

// ── Feature Context ────────────────────────────────────────────

/**
 * Context available when features contribute prompt sections and tools.
 */
export interface FeatureContext {
  /** Agent name */
  name: string;
  /** Resolved personal context */
  personalContext: PersonalContext;
  /** Recent conversation */
  thinThread: ConversationMessage[];
}

/**
 * Context available during activation lifecycle hooks.
 */
export interface ActivationContext {
  /** Immutable snapshot for this activation */
  snapshot: ActivationSnapshot;
  /** Available after activation completes (in afterActivation) */
  outcome?: ActivationOutcome;
}

/**
 * Context available at checkpoint decision points.
 */
export interface CheckpointContext {
  /** The checkpoint data */
  checkpoint: Checkpoint;
  /** Signals that arrived during execution */
  pendingSignals: RuntimeSignal[];
}

// ── Prompt Section ─────────────────────────────────────────────

/**
 * A tagged prompt section contributed by a feature.
 */
export interface PromptSection {
  /** Section identifier (for ordering and debugging) */
  tag: string;
  /** Section content (markdown) */
  content: string;
}

// ── MCP Tool Spec ──────────────────────────────────────────────

/**
 * MCP tool specification contributed by a feature.
 */
export interface McpToolSpec {
  /** MCP server URL or identifier */
  server: string;
  /** Optional tool name filter */
  tools?: string[];
}

// ── Agent Feature ──────────────────────────────────────────────

/**
 * A composable unit of agent capability.
 *
 * Features are resolved at activation time. They contribute:
 * - Prompt sections (assembled into system prompt)
 * - AI SDK tools
 * - MCP tool configurations
 * - Lifecycle hooks (activation and checkpoint level)
 *
 * Built-in features (soul, todo, inbox) are always present with
 * open customization points. Optional features (memory, workspace,
 * bash) are explicitly opted in.
 *
 * This is NOT a plugin system — no registry, no dynamic loading,
 * no session lifecycle. Just static composition.
 */
export interface AgentFeature {
  /** Feature name (for debugging and ordering) */
  name: string;

  // ── Contributions ──────────────────────────────────────────

  /** Contribute prompt sections */
  collectPromptSections?(ctx: FeatureContext): PromptSection[];

  /** Contribute AI SDK tools */
  collectTools?(ctx: FeatureContext): Record<string, unknown>;

  /** Contribute MCP tool configurations */
  collectMcpTools?(ctx: FeatureContext): McpToolSpec[];

  // ── Lifecycle Hooks ────────────────────────────────────────

  /**
   * Called before an activation starts.
   * Use for: loading context, preparing state.
   */
  beforeActivation?(ctx: ActivationContext): void | Promise<void>;

  /**
   * Called at each checkpoint during execution.
   * Use for: checking if preemption is needed, logging progress.
   *
   * Return a decision to influence execution:
   * - "continue": keep going (default if void)
   * - "yield": preempt this activation
   * - "abort": stop immediately
   */
  beforeCheckpoint?(ctx: CheckpointContext): CheckpointDecision | void;

  /**
   * Called after an activation completes.
   * Use for: saving state, recording metrics, updating context.
   */
  afterActivation?(ctx: ActivationContext): void | Promise<void>;

  /**
   * Called when an external event arrives while the session is active.
   * Use for: urgent interrupt logic, signal processing.
   */
  onExternalEvent?(event: RuntimeSignal): void;
}
