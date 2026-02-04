import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import {
  AgentSession,
  type SessionConfig,
  type SessionState,
  type TokenUsage,
} from 'agent-worker'
import type { ModelMessage } from 'ai'

const CONFIG_DIR = join(homedir(), '.agent-worker')
const SESSIONS_FILE = join(CONFIG_DIR, 'sessions.json')

interface StoredSession {
  id: string
  model: string
  system: string
  tools: SessionConfig['tools']
  createdAt: string
  // Persisted state
  messages: ModelMessage[]
  totalUsage: TokenUsage
}

interface SessionsData {
  current: string | null
  sessions: Record<string, StoredSession>
}

function ensureConfigDir(): void {
  if (!existsSync(CONFIG_DIR)) {
    mkdirSync(CONFIG_DIR, { recursive: true })
  }
}

function loadSessionsData(): SessionsData {
  ensureConfigDir()
  if (!existsSync(SESSIONS_FILE)) {
    return { current: null, sessions: {} }
  }
  return JSON.parse(readFileSync(SESSIONS_FILE, 'utf-8'))
}

function saveSessionsData(data: SessionsData): void {
  ensureConfigDir()
  writeFileSync(SESSIONS_FILE, JSON.stringify(data, null, 2))
}

// In-memory session instances
const activeSessions = new Map<string, AgentSession>()

/**
 * Save current session state to disk
 */
export function saveCurrentSession(): void {
  const data = loadSessionsData()
  if (!data.current) return

  const session = activeSessions.get(data.current)
  if (!session) return

  const stored = data.sessions[data.current]
  if (!stored) return

  // Update persisted state
  const state = session.getState()
  stored.messages = state.messages
  stored.totalUsage = state.totalUsage

  saveSessionsData(data)
}

export function createSession(config: SessionConfig): AgentSession {
  const session = new AgentSession(config)

  // Store session with full state
  const data = loadSessionsData()
  const state = session.getState()
  data.sessions[session.id] = {
    id: session.id,
    model: config.model,
    system: config.system,
    tools: config.tools,
    createdAt: session.createdAt,
    messages: state.messages,
    totalUsage: state.totalUsage,
  }
  data.current = session.id
  saveSessionsData(data)

  // Keep in memory
  activeSessions.set(session.id, session)

  return session
}

export function getCurrentSession(): AgentSession | null {
  const data = loadSessionsData()
  if (!data.current) return null

  // Check if already in memory
  if (activeSessions.has(data.current)) {
    return activeSessions.get(data.current)!
  }

  // Recreate from stored config with restored state
  const stored = data.sessions[data.current]
  if (!stored) return null

  // Build restore state
  const restore: SessionState = {
    id: stored.id,
    createdAt: stored.createdAt,
    messages: stored.messages ?? [],
    totalUsage: stored.totalUsage ?? { input: 0, output: 0, total: 0 },
  }

  const session = new AgentSession(
    {
      model: stored.model,
      system: stored.system,
      tools: stored.tools,
    },
    restore
  )

  // Store with CORRECT ID (the restored ID, not new)
  activeSessions.set(data.current, session)

  return session
}

export function listSessions(): StoredSession[] {
  const data = loadSessionsData()
  return Object.values(data.sessions)
}

export function useSession(id: string): boolean {
  const data = loadSessionsData()
  if (!data.sessions[id]) return false
  data.current = id
  saveSessionsData(data)
  return true
}

export function closeSession(id?: string): boolean {
  const data = loadSessionsData()
  const targetId = id ?? data.current
  if (!targetId || !data.sessions[targetId]) return false

  delete data.sessions[targetId]
  activeSessions.delete(targetId)

  if (data.current === targetId) {
    data.current = null
  }

  saveSessionsData(data)
  return true
}

export function getCurrentSessionId(): string | null {
  return loadSessionsData().current
}
