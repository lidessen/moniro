/**
 * Execution runtime — the core of agent-loop.
 *
 * Provides Loop for stateful, cancellable, preemptible execution.
 * All higher-level semantics (prompt assembly, personal context, collaboration)
 * are handled by upper layers.
 */

// ── Types ──────────────────────────────────────────────────────
export type {
  ExecutionState,
  RuntimeCapabilities,
  ExecutionMessage,
  ExecutionConfig,
  ExecutionInput,
  ExecutionOutcome,
  ExecutionResult,
  WorkItem,
  BeforeStepContext,
  StepMutation,
  AfterStepContext,
  ExecutionHooks,
  ExecutionObserver,
  Loop,
} from "./types.ts";

// ── State Machine ──────────────────────────────────────────────
export { ExecutionStateMachine } from "./state-machine.ts";

// ── Session ────────────────────────────────────────────────────
export { LoopImpl, createLoop } from "./session.ts";
export type { LoopConfig } from "./session.ts";
