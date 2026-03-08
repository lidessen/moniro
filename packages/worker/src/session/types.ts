/**
 * Agent Session types.
 *
 * These types define the worker-level session model.
 * The core insight: worker depends on checkpoints, not steps.
 * Steps are just how some backends provide finer checkpoints.
 */

import type { TokenUsage, ToolCall } from "@moniro/agent-loop";
import type { ConversationMessage } from "../conversation.ts";
import type { PersonalContext } from "../context/types.ts";

// ── Input & Signals ────────────────────────────────────────────

/**
 * An input envelope — the unit of external input to the session.
 * Abstracts over inbox messages, DMs, wakeups, system signals, etc.
 *
 * Every input has an ID. IDs are used for ack tracking —
 * the inbox feature acks specific IDs, not "up to" cursors.
 */
export interface InputEnvelope {
  /** Stable ID for this input. Used for ack, dedup, and progress tracking. */
  id: string;
  kind: "message" | "wakeup" | "resume" | "system";
  priority: "immediate" | "normal" | "background";
  content: string;
  source?: string;
  timestamp: string;
  metadata?: Record<string, unknown>;
  /** Progress from a previous preempted activation (for resume inputs) */
  progress?: ActivationProgress;
}

/**
 * A runtime signal — events that arrive while the session is running.
 * These don't go through the input queue; they're urgent notifications.
 */
export interface RuntimeSignal {
  type: "new-input" | "cancel-wait" | "stop" | "wake";
  urgent: boolean;
  payload?: unknown;
}

// ── Activation Progress ───────────────────────────────────────

/**
 * Progress carried from a preempted activation into the resume input.
 * Enables the next activation to continue where the previous left off.
 */
export interface ActivationProgress {
  /** Steps completed before preemption */
  completedSteps: number;
  /** Tool calls made before preemption */
  completedToolCalls: ToolCall[];
  /** Content produced before preemption */
  completedContent: string;
  /** Token usage before preemption */
  completedUsage: TokenUsage;
  /** How many times this work has been preempted */
  preemptCount: number;
  /** Original input IDs that started this work */
  originalInputIds: string[];
}

// ── Session State ──────────────────────────────────────────────

/**
 * The core session state.
 *
 * This is worker-owned state, not backend state.
 * The worker maintains this across activations regardless of
 * which backend executed the work.
 */
export interface AgentSessionState {
  /** Current session mode */
  mode: "idle" | "running" | "waiting";
  /** Queued inputs not yet processed */
  pendingInputs: InputEnvelope[];
  /** Signals received during execution */
  pendingSignals: RuntimeSignal[];
  /** Resolved personal context (soul, memory, todos) */
  personalContext: PersonalContext;
  /** Recent conversation for prompt continuity */
  thinThread: ConversationMessage[];
  /** Active waiting state (when mode === "waiting") */
  waiting?: WaitingState;
  /** Summary of the most recent activation */
  lastActivation?: ActivationSummary;
}

export interface WaitingState {
  since: string;
  reason?: string;
}

// ── Activation ─────────────────────────────────────────────────

/**
 * Immutable snapshot for one activation.
 *
 * Built at activation start, frozen for the duration.
 * New signals/inputs that arrive during execution don't
 * modify this snapshot — they queue for the next activation.
 */
export interface ActivationSnapshot {
  /** Session ID — unique per session instance */
  sessionId: string;
  inputBatch: InputEnvelope[];
  runtimeSignals: RuntimeSignal[];
  personalContext: PersonalContext;
  thinThread: ConversationMessage[];
}

/**
 * Summary of a completed activation.
 */
export interface ActivationSummary {
  id: string;
  startedAt: string;
  endedAt: string;
  inputCount: number;
  outcome: "completed" | "preempted" | "failed" | "waiting";
  steps: number;
  toolCalls: number;
  usage: TokenUsage;
}

/**
 * What the activation loop produces after one execute() call.
 */
export interface ActivationOutcome {
  content: string;
  toolCalls: ToolCall[];
  usage: TokenUsage;
  latency: number;
  steps: number;
  result: "completed" | "preempted" | "failed" | "aborted";
  error?: string;
  /** The agent expressed intent to wait for external input */
  requestedWait?: boolean;
}

// ── Batch Policy ───────────────────────────────────────────────

/**
 * Controls how many inputs are batched into one activation.
 *
 * CLI backends benefit from larger batches (fewer round-trips).
 * SDK backends can use smaller batches (more responsive).
 * But batch size is a worker policy, not a backend policy.
 */
export interface BatchPolicy {
  /** Max messages per activation */
  maxMessages: number;
  /** Only include urgent inputs (immediate priority) */
  includeUrgentOnly?: boolean;
  /** Wait this long for more messages before starting activation */
  mergeWindowMs?: number;
}

// ── Checkpoint ─────────────────────────────────────────────────

/**
 * A point where the worker can re-evaluate and decide.
 *
 * SDK path: fires at each step finish (granularity: "step")
 * CLI path: fires once at run finish (granularity: "run")
 *
 * The worker's correctness depends on checkpoints, not steps.
 * Steps are just how some backends provide finer checkpoints.
 */
export interface Checkpoint {
  /** How fine-grained this checkpoint is */
  granularity: "step" | "run";
  /** Step number within this activation */
  stepNumber: number;
  /** Tool calls observed so far */
  toolCalls: ToolCall[];
  /** Token usage observed so far */
  usage: TokenUsage;
  /** Text content produced so far */
  content?: string;
}

/**
 * What the worker decides at a checkpoint.
 */
export type CheckpointDecision = "continue" | "yield" | "abort";

// ── Execution Adapter ──────────────────────────────────────────

/**
 * Backend capabilities from the worker's perspective.
 * Uses checkpoint granularity instead of step control.
 */
export interface ExecutionAdapterCapabilities {
  streaming: boolean;
  /** How fine-grained checkpoints are */
  checkpointGranularity: "step" | "run";
  /** Whether abort is supported */
  supportsAbort: boolean;
}

/**
 * Per-execute hooks for the adapter.
 * These are different from ExecutionHooks — they use checkpoint
 * semantics, not step semantics.
 */
export interface ExecutionAdapterHooks {
  /**
   * Called at each checkpoint. Return a decision:
   * - "continue": keep going
   * - "yield": preempt (save context for resume)
   * - "abort": stop immediately
   * - void/undefined: same as "continue"
   */
  onCheckpoint?: (checkpoint: Checkpoint) => Promise<CheckpointDecision | void>;
  /** Tool execution started */
  onToolCall?: (event: { name: string; arguments?: unknown }) => void;
  /** Tool execution completed */
  onToolResult?: (event: { name: string; result?: unknown; durationMs?: number }) => void;
  /** Text output from agent */
  onText?: (text: string) => void;
  /** Token usage update */
  onUsage?: (usage: TokenUsage) => void;
}

/**
 * The execution interface from the worker's perspective.
 *
 * This is NOT ExecutionSession — it's a focused adapter that:
 * - Has no state machine (worker owns state)
 * - Takes hooks per-call (not per-construction)
 * - Uses checkpoint abstraction (not step abstraction)
 *
 * Two implementations:
 * - SDK adapter: checkpoints at step finish, full observability
 * - CLI adapter: checkpoints at run finish, stream-based observability
 */
export interface ExecutionAdapter {
  readonly capabilities: ExecutionAdapterCapabilities;
  /** Execute with resolved input and optional hooks */
  execute(
    input: {
      system: string;
      messages: Array<{ role: string; content: string }>;
      tools?: Record<string, unknown>;
      maxTokens?: number;
      maxSteps?: number;
    },
    hooks?: ExecutionAdapterHooks,
  ): Promise<ActivationOutcome>;
  /** Request abort (if supported) */
  abort?(): void;
}
