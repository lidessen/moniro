// Daemon discovery
export {
  DEFAULT_PORT,
  readDaemonInfo,
  isDaemonRunning,
  type DaemonInfo,
} from "./registry.ts";

// Daemon entry point and types
export { startDaemon } from "./daemon.ts";
export type { AgentState, DaemonState } from "./daemon.ts";
