// Re-export registry functions and types
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

// Re-export daemon entry point
export { startDaemon } from './daemon.ts'

// Re-export handler types
export type { ServerState, Request, Response } from './handler.ts'
