/**
 * StateStore — Pluggable conversation state persistence.
 *
 * The daemon saves/loads agent state through this interface.
 * Workers don't interact with the store directly — the daemon
 * orchestrates: load → worker.restore → execute → worker.getState → save.
 *
 * Implementations:
 *   MemoryStateStore  — in-process (default, no persistence across restarts)
 *   FileStateStore    — future: JSON files in ~/.agent-worker/states/
 *   RedisStateStore   — future: distributed state
 */

import type { SessionState } from "./types.ts";

// ── Interface ──────────────────────────────────────────────────────

export interface StateStore {
  /** Load conversation state for an agent. Returns null if no state exists. */
  load(agentId: string): Promise<SessionState | null>;

  /** Save conversation state for an agent. */
  save(agentId: string, state: SessionState): Promise<void>;

  /** Delete conversation state for an agent. */
  delete(agentId: string): Promise<void>;
}

// ── MemoryStateStore ───────────────────────────────────────────────

/**
 * In-memory state store. State is lost when the daemon stops.
 * Suitable for development and single-machine deployments.
 */
export class MemoryStateStore implements StateStore {
  private states = new Map<string, SessionState>();

  async load(agentId: string): Promise<SessionState | null> {
    return this.states.get(agentId) ?? null;
  }

  async save(agentId: string, state: SessionState): Promise<void> {
    this.states.set(agentId, state);
  }

  async delete(agentId: string): Promise<void> {
    this.states.delete(agentId);
  }
}
