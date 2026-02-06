import { existsSync, unlinkSync, writeFileSync, readFileSync, mkdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { BackendType } from '../backends/types.ts'

export const CONFIG_DIR = join(homedir(), '.agent-worker')
export const SESSIONS_DIR = join(CONFIG_DIR, 'sessions')
export const REGISTRY_FILE = join(CONFIG_DIR, 'registry.json')

export interface SessionRegistry {
  sessions: Record<string, SessionInfo>
  defaultSession?: string
}

export interface SessionInfo {
  id: string
  name?: string
  model: string
  system: string
  backend: BackendType
  socketPath: string
  pidFile: string
  readyFile: string
  pid: number
  createdAt: string
  idleTimeout?: number // ms, 0 = no timeout
}

export function ensureDirs(): void {
  if (!existsSync(CONFIG_DIR)) {
    mkdirSync(CONFIG_DIR, { recursive: true })
  }
  if (!existsSync(SESSIONS_DIR)) {
    mkdirSync(SESSIONS_DIR, { recursive: true })
  }
}

export function loadRegistry(): SessionRegistry {
  ensureDirs()
  if (!existsSync(REGISTRY_FILE)) {
    return { sessions: {} }
  }
  try {
    return JSON.parse(readFileSync(REGISTRY_FILE, 'utf-8'))
  } catch {
    return { sessions: {} }
  }
}

export function saveRegistry(registry: SessionRegistry): void {
  ensureDirs()
  writeFileSync(REGISTRY_FILE, JSON.stringify(registry, null, 2))
}

export function registerSession(info: SessionInfo): void {
  const registry = loadRegistry()
  registry.sessions[info.id] = info
  if (info.name) {
    // Also register by name for easy lookup
    registry.sessions[info.name] = info
  }
  // Set as default if first session
  if (Object.keys(registry.sessions).length <= 2) {
    registry.defaultSession = info.id
  }
  saveRegistry(registry)
}

export function unregisterSession(idOrName: string): void {
  const registry = loadRegistry()
  const info = registry.sessions[idOrName]
  if (info) {
    delete registry.sessions[info.id]
    if (info.name) {
      delete registry.sessions[info.name]
    }
    if (registry.defaultSession === info.id) {
      // Set another session as default
      const remaining = Object.values(registry.sessions).filter(s => s.id !== info.id)
      registry.defaultSession = remaining[0]?.id
    }
  }
  saveRegistry(registry)
}

export function getSessionInfo(idOrName?: string): SessionInfo | null {
  const registry = loadRegistry()
  if (!idOrName) {
    // Return default session
    if (registry.defaultSession) {
      return registry.sessions[registry.defaultSession] || null
    }
    // Return the only session if there's just one
    const sessions = Object.values(registry.sessions)
    const uniqueSessions = sessions.filter((s, i, arr) =>
      arr.findIndex(x => x.id === s.id) === i
    )
    if (uniqueSessions.length === 1) {
      return uniqueSessions[0] ?? null
    }
    return null
  }

  // Try exact match first (by id or name)
  if (registry.sessions[idOrName]) {
    return registry.sessions[idOrName]!
  }

  // Try prefix match on IDs (supports short IDs like "e8ab33e7")
  const sessions = Object.values(registry.sessions)
  const matches = sessions.filter(s => s.id.startsWith(idOrName))
  // Dedupe and return if exactly one match
  const unique = matches.filter((s, i, arr) => arr.findIndex(x => x.id === s.id) === i)
  if (unique.length === 1) {
    return unique[0]!
  }

  return null
}

export function listSessions(): SessionInfo[] {
  const registry = loadRegistry()
  // Deduplicate (since we store by both id and name)
  const seen = new Set<string>()
  return Object.values(registry.sessions).filter(info => {
    if (seen.has(info.id)) return false
    seen.add(info.id)
    return true
  })
}

export function setDefaultSession(idOrName: string): boolean {
  const registry = loadRegistry()
  const info = registry.sessions[idOrName]
  if (!info) return false
  registry.defaultSession = info.id
  saveRegistry(registry)
  return true
}

export function isSessionRunning(idOrName?: string): boolean {
  const info = getSessionInfo(idOrName)
  if (!info) return false

  try {
    // Check if process exists
    process.kill(info.pid, 0)
    return true
  } catch {
    // Process doesn't exist, clean up
    if (existsSync(info.socketPath)) {
      unlinkSync(info.socketPath)
    }
    if (existsSync(info.pidFile)) {
      unlinkSync(info.pidFile)
    }
    if (info.readyFile && existsSync(info.readyFile)) {
      unlinkSync(info.readyFile)
    }
    unregisterSession(info.id)
    return false
  }
}

/**
 * Wait for a session to be ready (ready file exists)
 * Returns session info if ready, null if timeout
 */
export async function waitForReady(
  nameOrId: string | undefined,
  timeoutMs: number = 5000
): Promise<SessionInfo | null> {
  const start = Date.now()
  const pollInterval = 50

  while (Date.now() - start < timeoutMs) {
    const info = getSessionInfo(nameOrId)
    if (info?.readyFile && existsSync(info.readyFile)) {
      return info
    }
    await new Promise(resolve => setTimeout(resolve, pollInterval))
  }

  return null
}
