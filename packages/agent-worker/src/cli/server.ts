// Backwards compatibility - everything has moved to daemon/
export {
  listSessions,
  setDefaultSession,
  isSessionRunning,
  waitForReady,
  registerSession,
  unregisterSession,
  getSessionInfo,
  type SessionInfo,
} from '../daemon/registry.ts'
export { startDaemon as startServer } from '../daemon/daemon.ts'
