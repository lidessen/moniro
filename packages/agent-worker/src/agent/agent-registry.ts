/**
 * AgentRegistry — In-memory agent registry.
 *
 * Responsibilities:
 *   - Register/unregister agents at runtime
 *   - Ensure context directories exist (for config agents)
 *   - Provide agent lookup by name
 *
 * All agents are registered programmatically (from config.yml or daemon API).
 * No disk-based discovery (.agents/ is deprecated).
 *
 * Owned by the daemon. One registry per daemon process.
 */

import { join } from "node:path";
import { AgentHandle } from "./agent-handle.ts";
import type { AgentDefinition, Logger } from "@moniro/agent-loop";

// ── AgentRegistry ─────────────────────────────────────────────────

export class AgentRegistry {
  /** Loaded agent handles, keyed by name */
  private agents = new Map<string, AgentHandle>();

  /** Workspace root directory (e.g. ~/.agent-worker/ for global) */
  readonly projectDir: string;

  /** Optional logger (injected by daemon) */
  private log?: Logger;

  constructor(projectDir: string, logger?: Logger) {
    this.projectDir = projectDir;
    this.log = logger;
  }

  // ── Registration ────────────────────────────────────────────────

  /**
   * Register a config agent (from config.yml). Creates context dir on disk.
   * Overwrites existing agent with same name (reload semantics).
   */
  registerDefinition(def: AgentDefinition): AgentHandle {
    const contextDir = this.resolveContextDir(def);
    const agentLogger = this.log?.child(def.name);
    const handle = new AgentHandle(def, contextDir, agentLogger, false);
    handle.ensureContextDir();
    this.agents.set(def.name, handle);
    return handle;
  }

  /**
   * Register an ephemeral agent (from daemon API).
   * Exists only in memory, lost on restart.
   */
  registerEphemeral(def: AgentDefinition): AgentHandle {
    const contextDir = this.resolveContextDir(def);
    const agentLogger = this.log?.child(def.name);
    const handle = new AgentHandle(def, contextDir, agentLogger, true);
    this.agents.set(def.name, handle);
    return handle;
  }

  /**
   * Unregister an agent from memory.
   * @returns true if agent existed and was removed.
   */
  delete(name: string): boolean {
    return this.agents.delete(name);
  }

  // ── Lookup ──────────────────────────────────────────────────────

  /** Get agent handle by name */
  get(name: string): AgentHandle | undefined {
    return this.agents.get(name);
  }

  /** Check if agent exists */
  has(name: string): boolean {
    return this.agents.has(name);
  }

  /** List all registered agent handles */
  list(): AgentHandle[] {
    return [...this.agents.values()];
  }

  /** Number of registered agents */
  get size(): number {
    return this.agents.size;
  }

  // ── Path Helpers ────────────────────────────────────────────────

  /** Resolve agent's context directory (absolute path) */
  private resolveContextDir(def: AgentDefinition): string {
    if (def.context?.dir) {
      return join(this.projectDir, def.context.dir);
    }
    // Default: <workspace>/agents/<name>/
    return join(this.projectDir, "agents", def.name);
  }
}
