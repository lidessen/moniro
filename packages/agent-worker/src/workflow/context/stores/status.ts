/**
 * Status Store
 * Agent status tracking for coordination.
 */

import type { StorageBackend } from "../storage.ts";
import type { AgentStatus } from "../types.ts";

const STATUS_KEY = "_state/agent-status.json";

// ==================== Interface ====================

export interface StatusStore {
  set(agent: string, status: Partial<AgentStatus>): Promise<void>;
  get(agent: string): Promise<AgentStatus | null>;
  list(): Promise<Record<string, AgentStatus>>;
}

// ==================== Default Implementation ====================

/**
 * Default status store backed by a JSON file via StorageBackend.
 * All agent statuses are stored in a single JSON object.
 */
export class DefaultStatusStore implements StatusStore {
  constructor(private storage: StorageBackend) {}

  async set(agent: string, status: Partial<AgentStatus>): Promise<void> {
    const statuses = await this.loadAll();
    const existing = statuses[agent] || { state: "idle", lastUpdate: new Date().toISOString() };

    // Merge updates
    statuses[agent] = {
      ...existing,
      ...status,
      lastUpdate: new Date().toISOString(),
    };

    // Set startedAt when transitioning to running state
    if (status.state === "running" && existing.state !== "running") {
      statuses[agent]!.startedAt = new Date().toISOString();
    }

    // Clear startedAt and task when transitioning to idle
    if (status.state === "idle") {
      statuses[agent]!.startedAt = undefined;
      statuses[agent]!.task = undefined;
    }

    await this.save(statuses);
  }

  async get(agent: string): Promise<AgentStatus | null> {
    const statuses = await this.loadAll();
    return statuses[agent] || null;
  }

  async list(): Promise<Record<string, AgentStatus>> {
    return this.loadAll();
  }

  private async loadAll(): Promise<Record<string, AgentStatus>> {
    const raw = await this.storage.read(STATUS_KEY);
    if (!raw) return {};
    try {
      return JSON.parse(raw);
    } catch {
      return {};
    }
  }

  private async save(statuses: Record<string, AgentStatus>): Promise<void> {
    await this.storage.write(STATUS_KEY, JSON.stringify(statuses, null, 2));
  }
}
