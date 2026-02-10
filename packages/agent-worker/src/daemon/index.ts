// Re-export registry functions and types
export {
  // Daemon discovery (new)
  DEFAULT_PORT,
  readDaemonInfo,
  isDaemonRunning,
  type DaemonInfo,
  // Legacy session functions (kept for transition)
  listSessions,
  setDefaultSession,
  isSessionRunning,
  waitForReady,
  registerSession,
  unregisterSession,
  getSessionInfo,
  parseDuration,
  resolveSchedule,
  getInstanceAgents,
  getInstanceAgentNames,
  getAgentDisplayName,
  generateAutoName,
  type SessionInfo,
  type ScheduleConfig,
  type ResolvedSchedule,
} from "./registry.ts";

// Re-export daemon entry point
export { startDaemon } from "./daemon.ts";

// Re-export handler types
export type { ServerState, Request, Response } from "./handler.ts";

// Re-export cron utilities
export { parseCron, nextCronTime, msUntilNextCron } from "./cron.ts";
