/**
 * agent-worker — System layer public API.
 *
 * Persistent daemon service. Long-running agents with identity, conversation
 * history, scheduled wakeups, priority queues.
 *
 * Depends on @moniro/agent-loop (Worker) and @moniro/workspace (Orchestration).
 *
 * For agent execution, import from @moniro/agent-loop.
 * For workspace orchestration, import from @moniro/workspace.
 * For personal context tools, import from @moniro/agent-worker.
 */

// ── Daemon ──────────────────────────────────────────────────────
export { startDaemon } from "./daemon/daemon.ts";
export type { DaemonState, WorkflowHandle } from "./daemon/daemon.ts";

// ── Discovery ───────────────────────────────────────────────────
export {
  DEFAULT_PORT,
  readDaemonInfo,
  writeDaemonInfo,
  removeDaemonInfo,
  isDaemonRunning,
} from "./daemon/registry.ts";
export type { DaemonInfo } from "./daemon/registry.ts";

// ── Event Log (Daemon) ──────────────────────────────────────────
export { DaemonEventLog } from "./daemon/event-log.ts";

// ── Agent Handle (System-layer persistence) ─────────────────────
export { AgentHandle } from "./agent/agent-handle.ts";
export type { AgentHandleState } from "./agent/agent-handle.ts";

// ── Agent Registry (System-layer discovery) ─────────────────────
export { AgentRegistry } from "./agent/agent-registry.ts";

// ── Agent Config (daemon runtime) ───────────────────────────────
export type { AgentConfig } from "./agent/config.ts";

// ── State Store ─────────────────────────────────────────────────
export type { StateStore } from "./agent/store.ts";
export { MemoryStateStore } from "./agent/store.ts";

// ── Worker Handle (execution contract) ──────────────────────────
export { LocalWorker } from "./agent/handle.ts";
export type { WorkerHandle } from "./agent/handle.ts";
