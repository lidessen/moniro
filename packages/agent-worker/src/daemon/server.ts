// Re-exports from daemon modules (server.ts moved from cli/ to daemon/)
export {
  listSessions,
  setDefaultSession,
  isSessionRunning,
  waitForReady,
  registerSession,
  unregisterSession,
  getSessionInfo,
  type SessionInfo,
} from './registry.ts'
export { startDaemon as startServer } from './daemon.ts'
