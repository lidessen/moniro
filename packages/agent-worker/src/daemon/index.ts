// Daemon discovery
export { DEFAULT_PORT, readDaemonInfo, isDaemonRunning, type DaemonInfo } from "./registry.ts";

// Daemon entry point and types
export { startDaemon } from "./daemon.ts";
export type { DaemonState, WorkflowHandle } from "./daemon.ts";
export { startHttpServer, type ServerHandle } from "./serve.ts";

// Agent architecture types
export type { AgentConfig } from "../agent/config.ts";
export type { StateStore } from "../agent/store.ts";
export { MemoryStateStore } from "../agent/store.ts";

// Event logging
export { DaemonEventLog } from "./event-log.ts";
