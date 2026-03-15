/**
 * Execution runtime types.
 *
 * These types define the execution boundary of agent-loop.
 * Everything here is about "how to execute", not "what to execute" or "why".
 */

import type { TokenUsage, ToolCall } from "../types.ts";

// ── Execution State ────────────────────────────────────────────

/**
 * States of an execution session.
 *
 * Transitions:
 *   idle → running
 *   running → waiting | preempted | completed | failed | cancelled
 *   waiting → running | cancelled
 *   preempted → running | cancelled
 *   completed, failed, cancelled → (terminal)
 */
export type ExecutionState =
  | "idle"
  | "running"
  | "waiting"
  | "preempted"
  | "completed"
  | "failed"
  | "cancelled";

// ── Runtime Capabilities ───────────────────────────────────────

/**
 * Capability-first backend description.
 * Instead of pretending all runtimes are the same, this explicitly
 * declares what each runtime can and cannot do.
 *
 * Upper layers use this to decide what features are available
 * (step hooks, cancellation, preemption, etc.)
 */
export interface RuntimeCapabilities {
  /** Whether the runtime supports streaming responses */
  streaming: boolean;
  /**
   * Who manages the tool loop:
   * - 'native': backend runs its own loop (CLI runtimes like claude, cursor, codex)
   * - 'external': we run the loop via ToolLoopAgent (SDK path)
   */
  toolLoop: "native" | "external";
  /**
   * Step-level control:
   * - 'none': no visibility into individual steps
   * - 'step-finish': can observe and influence steps (prepareStep + onStepFinish)
   */
  stepControl: "none" | "step-finish";
  /**
   * Cancellation mechanism:
   * - 'none': cannot cancel
   * - 'cooperative': can request cancellation (process may take time to stop)
   * - 'abortable': can abort immediately via AbortSignal
   */
  cancellation: "none" | "cooperative" | "abortable";
}

// ── Execution Input ────────────────────────────────────────────

/**
 * A message in the execution context.
 * This is the resolved form — no inbox, workspace, or collaboration semantics.
 */
export interface ExecutionMessage {
  role: "user" | "assistant" | "system" | "tool";
  content: string;
}

/**
 * Configuration for a single execution run.
 */
export interface ExecutionConfig {
  /** Maximum tokens for response */
  maxTokens?: number;
  /** Maximum tool call steps per run */
  maxSteps?: number;
  /** Timeout in milliseconds */
  timeout?: number;
  /** External abort signal */
  abortSignal?: AbortSignal;
  /**
   * Preemption trigger — checked at step boundaries.
   * When this returns true, the session transitions to 'preempted'.
   * This is the TRIGGER; the DECISION happens at loop boundaries
   * (step finish, tool return, wait return).
   */
  shouldYield?: () => boolean;
}

/**
 * What Loop.run() receives.
 *
 * This is fully resolved — the caller (agent-worker, workspace) is
 * responsible for assembling the system prompt, messages, and tools.
 * The execution layer does not know about soul, memory, inbox, workspace,
 * or any higher-level concept.
 */
export interface ExecutionInput {
  /** Resolved system prompt */
  system: string;
  /** Resolved messages */
  messages: ExecutionMessage[];
  /** Resolved AI SDK tools */
  tools?: Record<string, unknown>;
  /** Execution configuration */
  config?: ExecutionConfig;
}

// ── Execution Result ───────────────────────────────────────────

/**
 * Outcome of an execution run.
 */
export type ExecutionOutcome = "completed" | "failed" | "cancelled" | "preempted";

/**
 * What Loop.run() returns.
 */
export interface ExecutionResult {
  /** Final text content */
  content: string;
  /** All tool calls made during this run */
  toolCalls: ToolCall[];
  /** Token usage */
  usage: TokenUsage;
  /** Response latency in ms */
  latency: number;
  /** Number of steps executed */
  steps: number;
  /** How the run ended */
  outcome: ExecutionOutcome;
  /** Error message if outcome is 'failed' */
  error?: string;
  /** Context for resuming preempted work */
  resumeContext?: unknown;
}

// ── Work Item ──────────────────────────────────────────────────

/**
 * A unit of work for the execution queue.
 *
 * This unifies the queue with the execution object — the loop takes
 * a WorkItem, executes it, returns a result, and marks whether it
 * can be resumed.
 *
 * WorkItem is agnostic to what the work IS (inbox batch, schedule
 * wakeup, DM, etc.) — that mapping happens in the layer above.
 */
export interface WorkItem {
  /** Unique item ID */
  id: string;
  /** Execution priority */
  priority: "immediate" | "normal" | "background";
  /** What kind of work this is */
  kind: "message" | "wakeup" | "resume" | "system";
  /** Work payload — opaque to the execution layer */
  payload: unknown;
  /** Whether this item can be resumed after preemption */
  resumable?: boolean;
}

// ── Execution Hooks ────────────────────────────────────────────

/**
 * Context provided to beforeStep hook.
 * Maps to AI SDK's prepareStep — can mutate execution for this step.
 */
export interface BeforeStepContext {
  /** Current step number (1-based) */
  stepNumber: number;
}

/**
 * What beforeStep can return to modify the next step.
 * Maps to AI SDK's PrepareStepResult.
 */
export interface StepMutation {
  /** Filter available tools for this step */
  activeTools?: string[];
  /** Override system prompt for this step */
  system?: string;
}

/**
 * Context provided to afterStep hook.
 * Maps to AI SDK's onStepFinish callback data.
 */
export interface AfterStepContext {
  /** Current step number (1-based) */
  stepNumber: number;
  /** Tool calls made in this step */
  toolCalls: ToolCall[];
  /** Token usage for this step */
  usage: TokenUsage;
}

/**
 * Hooks at the execution boundary.
 *
 * These hooks must NOT depend on workspace, inbox, proposal, or any
 * collaboration type. Upper layers adapt their semantics into generic
 * signals/mutations before passing them here.
 *
 * Hook lifecycle:
 *   beforeRun → [beforeStep → LLM call → afterStep]* → afterRun
 *   onStateChange fires on any state transition
 */
export interface ExecutionHooks {
  /** Called before execution starts. Can modify input. */
  beforeRun?: (input: ExecutionInput) => ExecutionInput | Promise<ExecutionInput | void> | void;
  /** Called before each step. Can modify tools/system for this step. */
  beforeStep?: (ctx: BeforeStepContext) => StepMutation | Promise<StepMutation | void> | void;
  /** Called after each step completes. */
  afterStep?: (ctx: AfterStepContext) => void | Promise<void>;
  /** Called after execution finishes. */
  afterRun?: (result: ExecutionResult) => void | Promise<void>;
  /** Called on any state transition. */
  onStateChange?: (from: ExecutionState, to: ExecutionState) => void;
}

// ── Execution Observer ─────────────────────────────────────────

/**
 * Unified observation interface for execution progress.
 *
 * Works across both execution paths:
 * - SDK path: fed by AI SDK hooks (onToolCallStart/Finish, onStepFinish)
 * - CLI path: fed by stream-json event parsing
 *
 * Observation is read-only — observers cannot modify execution.
 * For mutation, use ExecutionHooks (beforeStep, etc.)
 *
 * Granularity differs by runtime:
 * - SDK path provides per-tool timing, structured arguments/results
 * - CLI path provides tool names and string args (what the stream gives)
 * - Both provide usage stats when available
 */
export interface ExecutionObserver {
  /** Tool execution started */
  onToolCallStart?(event: { name: string; callId?: string; arguments?: unknown }): void;
  /** Tool execution completed */
  onToolCallEnd?(event: {
    name: string;
    result?: unknown;
    durationMs?: number;
    error?: string;
  }): void;
  /** Text output from agent */
  onText?(text: string): void;
  /** Token usage update (per-step for SDK, per-run for CLI) */
  onUsage?(usage: TokenUsage): void;
  /** Execution initialized (model info, session ID) */
  onInit?(info: { model?: string; sessionId?: string }): void;
}

// ── Execution Session ──────────────────────────────────────────

/**
 * The core execution runtime object.
 *
 * Represents a single, stateful execution context that can:
 * - Run input through a model (with or without tool loop)
 * - Be cancelled mid-execution
 * - Be preempted and resumed
 * - Report its current state
 *
 * It does NOT know about:
 * - Agent identity (soul, personality)
 * - Personal context (memory, todos)
 * - Collaboration (inbox, workspace, channels)
 * - Conversation history (that's the caller's job)
 */
export interface Loop {
  readonly id: string;
  readonly capabilities: RuntimeCapabilities;

  /** Execute a run with resolved input */
  run(input: ExecutionInput): Promise<ExecutionResult>;
  /** Cancel the current run */
  cancel(reason?: string): Promise<void>;
  /** Get current execution state */
  getState(): ExecutionState;
}
