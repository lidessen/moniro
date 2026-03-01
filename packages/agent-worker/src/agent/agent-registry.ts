/**
 * AgentRegistry — Loads and manages top-level agent definitions.
 *
 * Responsibilities:
 *   - Discover agents from .agents/*.yaml
 *   - Load definitions → create AgentHandles
 *   - Register/unregister agents at runtime
 *   - Ensure context directories exist
 *   - Provide agent lookup by name
 *
 * Owned by the daemon. One registry per daemon process.
 */

import { mkdirSync, writeFileSync, unlinkSync, existsSync, rmSync } from "node:fs";
import { join } from "node:path";
import { AgentHandle } from "./agent-handle.ts";
import type { AgentDefinition } from "./definition.ts";
import { discoverAgents, serializeAgent, AGENTS_DIR } from "./yaml-parser.ts";
import type { Logger } from "../workflow/logger.ts";

// ── AgentRegistry ─────────────────────────────────────────────────

export class AgentRegistry {
  /** Loaded agent handles, keyed by name */
  private agents = new Map<string, AgentHandle>();

  /** Project root directory */
  readonly projectDir: string;

  /** Agents directory (.agents/) */
  readonly agentsDir: string;

  /** Optional logger (injected by daemon; absent in CLI direct mode) */
  private log?: Logger;

  constructor(projectDir: string, logger?: Logger) {
    this.projectDir = projectDir;
    this.agentsDir = join(projectDir, AGENTS_DIR);
    this.log = logger;
  }

  // ── Discovery & Loading ─────────────────────────────────────────

  /**
   * Load all agents from .agents/*.yaml.
   * Skips invalid files (logs warnings).
   * Creates context directories for each loaded agent.
   */
  loadFromDisk(warn?: (msg: string) => void): void {
    const logFn = warn ?? (this.log ? (msg: string) => this.log!.warn(msg) : undefined);
    const defs = discoverAgents(this.projectDir, logFn);
    for (const def of defs) {
      this.registerDefinition(def);
    }
    this.log?.info(`Loaded ${defs.length} agent(s) from disk`);
  }

  // ── Registration ────────────────────────────────────────────────

  /**
   * Register an agent definition. Creates AgentHandle + ensures context dir.
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
   * Register an ephemeral agent. No YAML file, no context directory.
   * Ephemeral agents exist only in daemon memory and are lost on restart.
   *
   * Used by the daemon's POST /agents endpoint for quick experimentation.
   */
  registerEphemeral(def: AgentDefinition): AgentHandle {
    const contextDir = this.resolveContextDir(def);
    const agentLogger = this.log?.child(def.name);
    const handle = new AgentHandle(def, contextDir, agentLogger, true);
    // Skip ensureContextDir for ephemeral agents — no disk persistence
    this.agents.set(def.name, handle);
    return handle;
  }

  /**
   * Create a new agent: write YAML file + register.
   * @throws Error if agent already exists on disk.
   */
  create(def: AgentDefinition): AgentHandle {
    const yamlPath = this.agentYamlPath(def.name);
    if (existsSync(yamlPath)) {
      throw new Error(`Agent file already exists: ${yamlPath}`);
    }

    // Ensure .agents/ directory exists
    mkdirSync(this.agentsDir, { recursive: true });

    // Write YAML file
    writeFileSync(yamlPath, serializeAgent(def));

    // Register in memory
    return this.registerDefinition(def);
  }

  /**
   * Delete an agent: remove YAML file + context directory + unregister.
   * For ephemeral agents, only unregisters from memory (no disk cleanup).
   * @returns true if agent existed and was deleted.
   */
  delete(name: string): boolean {
    const handle = this.agents.get(name);
    if (!handle) return false;

    this.agents.delete(name);

    // Ephemeral agents have no disk presence
    if (handle.ephemeral) return true;

    // Remove YAML file
    const yamlPath = this.agentYamlPath(name);
    if (existsSync(yamlPath)) {
      try {
        unlinkSync(yamlPath);
      } catch {
        /* best-effort */
      }
    }

    // Remove context directory
    if (existsSync(handle.contextDir)) {
      try {
        rmSync(handle.contextDir, { recursive: true, force: true });
      } catch {
        /* best-effort */
      }
    }

    return true;
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
      // Treat as relative to project root
      return join(this.projectDir, def.context.dir);
    }
    // Default: .agents/<name>/
    return join(this.agentsDir, def.name);
  }

  /** Path to agent's YAML file */
  private agentYamlPath(name: string): string {
    return join(this.agentsDir, `${name}.yaml`);
  }
}
