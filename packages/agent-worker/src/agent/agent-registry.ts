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

// ── AgentRegistry ─────────────────────────────────────────────────

export class AgentRegistry {
  /** Loaded agent handles, keyed by name */
  private agents = new Map<string, AgentHandle>();

  /** Project root directory */
  readonly projectDir: string;

  /** Agents directory (.agents/) */
  readonly agentsDir: string;

  constructor(projectDir: string) {
    this.projectDir = projectDir;
    this.agentsDir = join(projectDir, AGENTS_DIR);
  }

  // ── Discovery & Loading ─────────────────────────────────────────

  /**
   * Load all agents from .agents/*.yaml.
   * Skips invalid files (logs warnings).
   * Creates context directories for each loaded agent.
   */
  loadFromDisk(log?: (msg: string) => void): void {
    const defs = discoverAgents(this.projectDir, log);
    for (const def of defs) {
      this.registerDefinition(def);
    }
  }

  // ── Registration ────────────────────────────────────────────────

  /**
   * Register an agent definition. Creates AgentHandle + ensures context dir.
   * Overwrites existing agent with same name (reload semantics).
   */
  registerDefinition(def: AgentDefinition): AgentHandle {
    const contextDir = this.resolveContextDir(def);
    const handle = new AgentHandle(def, contextDir);
    handle.ensureContextDir();
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
   * @returns true if agent existed and was deleted.
   */
  delete(name: string): boolean {
    const handle = this.agents.get(name);
    if (!handle) return false;

    this.agents.delete(name);

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
