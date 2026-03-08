/**
 * Execution state machine.
 *
 * Enforces valid state transitions for ExecutionSession.
 * Terminal states (completed, failed, cancelled) cannot be left.
 */

import type { ExecutionState } from "./types.ts";

/** Valid transitions from each state */
const TRANSITIONS: Record<ExecutionState, readonly ExecutionState[]> = {
  idle: ["running"],
  running: ["waiting", "preempted", "completed", "failed", "cancelled"],
  waiting: ["running", "cancelled"],
  preempted: ["running", "cancelled"],
  completed: [],
  failed: [],
  cancelled: [],
};

const TERMINAL_STATES: ReadonlySet<ExecutionState> = new Set(["completed", "failed", "cancelled"]);

export class ExecutionStateMachine {
  private _state: ExecutionState = "idle";
  private _listener?: (from: ExecutionState, to: ExecutionState) => void;

  get state(): ExecutionState {
    return this._state;
  }

  get isTerminal(): boolean {
    return TERMINAL_STATES.has(this._state);
  }

  get isRunning(): boolean {
    return this._state === "running";
  }

  /**
   * Transition to a new state.
   * Throws if the transition is not valid.
   */
  transition(to: ExecutionState): void {
    const valid = TRANSITIONS[this._state];
    if (!valid.includes(to)) {
      throw new Error(`Invalid state transition: ${this._state} → ${to}`);
    }
    const from = this._state;
    this._state = to;
    this._listener?.(from, to);
  }

  /**
   * Try to transition. Returns false if invalid (instead of throwing).
   */
  tryTransition(to: ExecutionState): boolean {
    const valid = TRANSITIONS[this._state];
    if (!valid.includes(to)) return false;
    const from = this._state;
    this._state = to;
    this._listener?.(from, to);
    return true;
  }

  /**
   * Reset to idle. Only valid from terminal states.
   * Used when a session is reused for another run.
   */
  reset(): void {
    if (!this.isTerminal && this._state !== "idle") {
      throw new Error(`Cannot reset from non-terminal state: ${this._state}`);
    }
    const from = this._state;
    this._state = "idle";
    if (from !== "idle") {
      this._listener?.(from, "idle");
    }
  }

  /**
   * Register state change listener.
   */
  onStateChange(fn: (from: ExecutionState, to: ExecutionState) => void): void {
    this._listener = fn;
  }
}
