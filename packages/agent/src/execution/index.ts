/**
 * Execution runtime — the core of agent-loop.
 *
 * Provides ExecutionSession for stateful, cancellable, preemptible execution.
 * All higher-level semantics (prompt assembly, personal context, collaboration)
 * are handled by upper layers.
 */

// ── Types ──────────────────────────────────────────────────────
export type {
  ExecutionState,
  BackendCapabilities,
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
  ExecutionSession,
} from "./types.ts";

// ── State Machine ──────────────────────────────────────────────
export { ExecutionStateMachine } from "./state-machine.ts";

// ── Session ────────────────────────────────────────────────────
export { ExecutionSessionImpl, createExecutionSession } from "./session.ts";
export type { ExecutionSessionConfig } from "./session.ts";
