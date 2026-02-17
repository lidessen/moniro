/**
 * Scheduler — per-agent scheduling: poll, cron, wake.
 *
 * The scheduler decides WHEN to invoke a worker. The process manager
 * handles HOW (spawn subprocess). Context operations handle WHAT
 * (inbox query, ack).
 *
 * Each agent gets its own scheduler instance. The daemon manages
 * the collection.
 */
import type { Database } from "bun:sqlite";
import { inboxQuery, inboxAckAll, channelSend } from "./context.ts";
import { getAgent, updateAgentState } from "./registry.ts";
import { createProcessManager, type ProcessManagerDeps } from "./process-manager.ts";
import type { WorkerConfig, SessionResult } from "../shared/types.ts";
import { DEFAULT_POLL_INTERVAL, DEFAULT_MAX_RETRIES } from "../shared/constants.ts";

export type SchedulerState = "idle" | "running" | "stopped";

export interface AgentScheduler {
  /** Current state */
  state: SchedulerState;
  /** Start scheduling */
  start(): void;
  /** Stop scheduling */
  stop(): void;
  /** Immediate trigger (e.g., on @mention) */
  wake(): void;
}

export interface SchedulerDeps {
  db: Database;
  processManager: ReturnType<typeof createProcessManager>;
  /** Called when a worker produces a response */
  onWorkerResult?: (agent: string, result: SessionResult) => void;
}

/**
 * Create a scheduler for a single agent.
 */
export function createAgentScheduler(
  agentName: string,
  workflow: string,
  tag: string,
  deps: SchedulerDeps,
): AgentScheduler {
  let state: SchedulerState = "idle";
  let pollTimer: ReturnType<typeof setTimeout> | null = null;
  let running = false;
  let retryCount = 0;

  const agent = () => getAgent(deps.db, agentName);

  function getPollInterval(): number {
    const config = agent();
    if (config?.schedule) {
      return parseInterval(config.schedule);
    }
    return DEFAULT_POLL_INTERVAL;
  }

  async function tick() {
    if (state === "stopped" || running) return;

    // Check inbox (guard against DB closed during shutdown)
    let inbox;
    try {
      inbox = inboxQuery(deps.db, agentName, workflow, tag);
    } catch {
      return; // DB closed — bail
    }
    if (inbox.length === 0) {
      schedulePoll();
      return;
    }

    // Inbox has messages — run worker
    running = true;
    state = "running";
    try {
      updateAgentState(deps.db, agentName, "running");
    } catch {
      running = false;
      state = "idle";
      return;
    }

    try {
      const config = agent();
      if (!config) {
        running = false;
        state = "idle";
        return;
      }

      const workerConfig: WorkerConfig = {
        agent: {
          name: config.name,
          model: config.model,
          backend: config.backend,
          system: config.system,
        },
        daemonMcpUrl: "", // ProcessManager will fill this
        workflow,
        tag,
      };

      const spawned = deps.processManager.spawn(workerConfig);
      const result = await spawned.promise;

      // Success — write response to channel and ack inbox
      if (result.content != null && result.content !== "") {
        channelSend(deps.db, agentName, result.content, workflow, tag);
      }
      inboxAckAll(deps.db, agentName, workflow, tag);

      // Notify
      deps.onWorkerResult?.(agentName, result);

      retryCount = 0;
    } catch (err) {
      console.error(`[scheduler] ${agentName}: worker error (attempt ${retryCount + 1}/${DEFAULT_MAX_RETRIES}):`, (err as Error).message ?? err);
      retryCount++;
      if (retryCount >= DEFAULT_MAX_RETRIES) {
        console.error(`[scheduler] ${agentName}: max retries exhausted, acking inbox to prevent infinite loop`);
        retryCount = 0;
        // Ack inbox so workflow completion can detect idle state.
        // Without this, unacked messages keep pending_inbox=true forever.
        try {
          inboxAckAll(deps.db, agentName, workflow, tag);
        } catch {
          // DB may be closed during shutdown
        }
      }
    } finally {
      running = false;
      if (state !== "stopped") {
        state = "idle";
        try {
          updateAgentState(deps.db, agentName, "idle");
        } catch {
          // DB may be closed during shutdown
        }
        schedulePoll();
      }
    }
  }

  function schedulePoll() {
    if (state === "stopped") return;
    clearPoll();
    pollTimer = setTimeout(() => tick(), getPollInterval());
  }

  function clearPoll() {
    if (pollTimer) {
      clearTimeout(pollTimer);
      pollTimer = null;
    }
  }

  return {
    get state() {
      return state;
    },

    start() {
      if (state === "stopped") return;
      state = "idle";
      // Immediate first check
      tick();
    },

    stop() {
      state = "stopped";
      clearPoll();
    },

    wake() {
      if (state === "stopped") return;
      // Cancel pending poll and trigger immediately
      clearPoll();
      tick();
    },
  };
}

/**
 * Manages all agent schedulers for the daemon.
 */
export function createSchedulerManager(deps: SchedulerDeps) {
  const schedulers = new Map<string, AgentScheduler>();

  function key(agent: string, workflow: string, tag: string): string {
    return `${agent}@${workflow}:${tag}`;
  }

  return {
    /** Start scheduling an agent */
    start(agentName: string, workflow: string, tag: string): AgentScheduler {
      const k = key(agentName, workflow, tag);
      let scheduler = schedulers.get(k);
      if (!scheduler) {
        scheduler = createAgentScheduler(agentName, workflow, tag, deps);
        schedulers.set(k, scheduler);
      }
      scheduler.start();
      return scheduler;
    },

    /** Stop scheduling an agent */
    stop(agentName: string, workflow: string, tag: string): void {
      const k = key(agentName, workflow, tag);
      const scheduler = schedulers.get(k);
      if (scheduler) {
        scheduler.stop();
        schedulers.delete(k);
      }
    },

    /** Wake an agent (on @mention) */
    wake(agentName: string, workflow: string, tag: string): void {
      const k = key(agentName, workflow, tag);
      schedulers.get(k)?.wake();
    },

    /** Stop all schedulers */
    stopAll(): void {
      for (const [, scheduler] of schedulers) {
        scheduler.stop();
      }
      schedulers.clear();
    },

    /** Check if all schedulers are idle (for idle detection) */
    allIdle(): boolean {
      for (const [, scheduler] of schedulers) {
        if (scheduler.state === "running") return false;
      }
      return true;
    },

    /** Number of active schedulers */
    size(): number {
      return schedulers.size;
    },
  };
}

// ==================== Helpers ====================

/** Parse interval string like "30s", "5m", "1h" to milliseconds */
export function parseInterval(s: string): number {
  const match = s.match(/^(\d+)(ms|s|m|h)$/);
  if (!match) return DEFAULT_POLL_INTERVAL;
  const [, num, unit] = match;
  const n = Number.parseInt(num, 10);
  switch (unit) {
    case "ms":
      return n;
    case "s":
      return n * 1000;
    case "m":
      return n * 60_000;
    case "h":
      return n * 3_600_000;
    default:
      return DEFAULT_POLL_INTERVAL;
  }
}
