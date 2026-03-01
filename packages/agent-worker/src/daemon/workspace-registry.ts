/**
 * WorkspaceRegistry — Manages active workspaces in the daemon.
 *
 * A workspace is the shared collaboration infrastructure (context, MCP, event log)
 * that agents operate within. Both standalone agents and workflow agents
 * get a workspace.
 *
 * Keyed by "workflow:tag" (e.g., "review:pr-123", "global:main").
 */

import type { Workspace } from "../workflow/factory.ts";

export class WorkspaceRegistry {
  private workspaces = new Map<string, Workspace>();

  /** Register a workspace by key */
  set(key: string, workspace: Workspace): void {
    this.workspaces.set(key, workspace);
  }

  /** Get a workspace by key */
  get(key: string): Workspace | undefined {
    return this.workspaces.get(key);
  }

  /** Check if a workspace exists */
  has(key: string): boolean {
    return this.workspaces.has(key);
  }

  /** Remove a workspace (does NOT shutdown — caller must shutdown first) */
  delete(key: string): boolean {
    return this.workspaces.delete(key);
  }

  /** List all workspace keys */
  keys(): string[] {
    return [...this.workspaces.keys()];
  }

  /** List all active workspaces */
  values(): Workspace[] {
    return [...this.workspaces.values()];
  }

  /** Number of active workspaces */
  get size(): number {
    return this.workspaces.size;
  }

  /** Shutdown all workspaces (best-effort) */
  async shutdownAll(): Promise<void> {
    for (const [, ws] of this.workspaces) {
      try {
        await ws.shutdown();
      } catch {
        /* best-effort */
      }
    }
    this.workspaces.clear();
  }
}
