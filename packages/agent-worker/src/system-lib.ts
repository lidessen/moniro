/**
 * agent-worker (System) barrel — System layer public API.
 *
 * Persistent daemon service. Long-running agents with identity, conversation
 * history, scheduled wakeups, priority queues.
 *
 * This layer depends on both @moniro/agent and @moniro/workflow.
 *
 * Boundary validation: This file imports from:
 *   - daemon/ (HTTP server, process lifecycle)
 *   - agent/ (handle, registry — System-layer files in agent/ directory)
 *   - cli/ (client commands)
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

// ── Workspace Registry ──────────────────────────────────────────
export { WorkspaceRegistry } from "./daemon/workspace-registry.ts";

// ── Event Log (Daemon) ──────────────────────────────────────────
export { DaemonEventLog } from "./daemon/event-log.ts";

// ── Agent Handle (System-layer persistence) ─────────────────────
export { AgentHandle } from "./agent/agent-handle.ts";
export type { AgentHandleState } from "./agent/agent-handle.ts";

// ── Agent Registry (System-layer discovery) ─────────────────────
export { AgentRegistry } from "./agent/agent-registry.ts";

// ── Agent Config (daemon runtime) ───────────────────────────────
export type { AgentConfig } from "./agent/config.ts";

// ── Agent YAML Parser ───────────────────────────────────────────
export {
  parseAgentFile,
  parseAgentObject,
  discoverAgents,
  serializeAgent,
  AGENTS_DIR,
} from "./agent/yaml-parser.ts";

// ── State Store ─────────────────────────────────────────────────
export type { StateStore } from "./agent/store.ts";
export { MemoryStateStore } from "./agent/store.ts";

// ── Handle (createAgentHandle factory) ──────────────────────────
export { createAgentHandle } from "./agent/handle.ts";
