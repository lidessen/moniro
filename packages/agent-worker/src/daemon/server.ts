// Re-exports from daemon modules
export {
  // Daemon discovery
  DEFAULT_PORT,
  readDaemonInfo,
  isDaemonRunning,
  type DaemonInfo,
  // Legacy session (kept for transition)
  listSessions,
  setDefaultSession,
  isSessionRunning,
  waitForReady,
  registerSession,
  unregisterSession,
  getSessionInfo,
  type SessionInfo,
} from "./registry.ts";
export { startDaemon } from "./daemon.ts";
