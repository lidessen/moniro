import { createServer, type Server } from 'node:net'
import { existsSync, unlinkSync, writeFileSync, readFileSync, mkdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { AgentSession } from '../session.ts'
import type { ToolDefinition } from '../types.ts'

const CONFIG_DIR = join(homedir(), '.agent-worker')
const SESSIONS_DIR = join(CONFIG_DIR, 'sessions')
const REGISTRY_FILE = join(CONFIG_DIR, 'registry.json')

interface SessionRegistry {
  sessions: Record<string, SessionInfo>
  defaultSession?: string
}

interface SessionInfo {
  id: string
  name?: string
  model: string
  socketPath: string
  pidFile: string
  readyFile: string
  pid: number
  createdAt: string
  idleTimeout?: number // ms, 0 = no timeout
}

interface ServerState {
  session: AgentSession
  server: Server
  info: SessionInfo
  lastActivity: number
  pendingRequests: number
  idleTimer?: ReturnType<typeof setTimeout>
}

let state: ServerState | null = null

const DEFAULT_IDLE_TIMEOUT = 30 * 60 * 1000 // 30 minutes

interface Request {
  action: string
  payload?: unknown
}

interface Response {
  success: boolean
  data?: unknown
  error?: string
}

function ensureDirs(): void {
  if (!existsSync(CONFIG_DIR)) {
    mkdirSync(CONFIG_DIR, { recursive: true })
  }
  if (!existsSync(SESSIONS_DIR)) {
    mkdirSync(SESSIONS_DIR, { recursive: true })
  }
}

function loadRegistry(): SessionRegistry {
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

function saveRegistry(registry: SessionRegistry): void {
  ensureDirs()
  writeFileSync(REGISTRY_FILE, JSON.stringify(registry, null, 2))
}

function resetIdleTimer(): void {
  if (!state) return

  state.lastActivity = Date.now()

  // Clear existing timer
  if (state.idleTimer) {
    clearTimeout(state.idleTimer)
    state.idleTimer = undefined
  }

  // Set new timer if idle timeout is configured
  const timeout = state.info.idleTimeout ?? DEFAULT_IDLE_TIMEOUT
  if (timeout > 0) {
    state.idleTimer = setTimeout(() => {
      if (state && state.pendingRequests === 0) {
        console.log(`\nSession idle for ${timeout / 1000}s, shutting down...`)
        gracefulShutdown()
      } else {
        // Requests pending, reset timer
        resetIdleTimer()
      }
    }, timeout)
  }
}

async function gracefulShutdown(): Promise<void> {
  if (!state) {
    process.exit(0)
    return
  }

  // Stop accepting new connections
  state.server.close()

  // Wait for pending requests (max 10s)
  const maxWait = 10000
  const start = Date.now()
  while (state.pendingRequests > 0 && Date.now() - start < maxWait) {
    await new Promise(resolve => setTimeout(resolve, 100))
  }

  cleanup()
  process.exit(0)
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
      return uniqueSessions[0]
    }
    return null
  }
  return registry.sessions[idOrName] || null
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

async function handleRequest(req: Request): Promise<Response> {
  if (!state) {
    return { success: false, error: 'No active session' }
  }

  // Track activity
  state.pendingRequests++
  resetIdleTimer()

  const { session } = state

  try {
    switch (req.action) {
      case 'ping':
        return {
          success: true,
          data: {
            id: session.id,
            model: session.model,
            name: state.info.name,
          }
        }

      case 'send': {
        const { message, options } = req.payload as { message: string; options?: { autoApprove?: boolean } }
        const response = await session.send(message, options)
        return { success: true, data: response }
      }

      case 'tool_add': {
        const tool = req.payload as ToolDefinition
        session.addTool(tool)
        return { success: true, data: { name: tool.name } }
      }

      case 'tool_mock': {
        const { name, response } = req.payload as { name: string; response: unknown }
        session.setMockResponse(name, response)
        return { success: true, data: { name } }
      }

      case 'tool_list': {
        const tools = session.getTools()
        return { success: true, data: tools }
      }

      case 'tool_import': {
        const { filePath } = req.payload as { filePath: string }

        // Validate file path
        if (!filePath || typeof filePath !== 'string') {
          return { success: false, error: 'File path is required' }
        }

        // Dynamic import the file with error handling
        let module: Record<string, unknown>
        try {
          module = await import(filePath)
        } catch (importError) {
          const message = importError instanceof Error ? importError.message : String(importError)
          // Sanitize path from error message for security
          const sanitizedMsg = message.replace(filePath, '<file>')
          return { success: false, error: `Failed to import file: ${sanitizedMsg}` }
        }

        // Extract tools from module (support default export or named 'tools')
        let tools: ToolDefinition[] = []
        if (Array.isArray(module.default)) {
          tools = module.default
        } else if (typeof module.default === 'function') {
          // Support async factory function
          try {
            const result = await module.default()
            tools = Array.isArray(result) ? result : []
          } catch (factoryError) {
            const message = factoryError instanceof Error ? factoryError.message : String(factoryError)
            return { success: false, error: `Factory function failed: ${message}` }
          }
        } else if (Array.isArray(module.tools)) {
          tools = module.tools
        } else {
          return { success: false, error: 'No tools found. Export default array or named "tools" array.' }
        }

        // Validate and add tools
        const imported: string[] = []
        const skipped: string[] = []
        for (const tool of tools) {
          if (!tool.name || typeof tool.name !== 'string') {
            skipped.push('(unnamed)')
            continue
          }
          if (!tool.description || !tool.parameters) {
            skipped.push(tool.name)
            continue
          }
          session.addTool(tool)
          imported.push(tool.name)
        }

        return { success: true, data: { imported, skipped: skipped.length > 0 ? skipped : undefined } }
      }

      case 'history':
        return { success: true, data: session.history() }

      case 'stats':
        return { success: true, data: session.stats() }

      case 'export':
        return { success: true, data: session.export() }

      case 'clear':
        session.clear()
        return { success: true }

      case 'pending':
        return { success: true, data: session.getPendingApprovals() }

      case 'approve': {
        const { id } = req.payload as { id: string }
        const result = await session.approve(id)
        return { success: true, data: result }
      }

      case 'deny': {
        const { id, reason } = req.payload as { id: string; reason?: string }
        session.deny(id, reason)
        return { success: true }
      }

      case 'shutdown':
        // Decrement before async shutdown
        state.pendingRequests--
        setTimeout(() => gracefulShutdown(), 100)
        return { success: true, data: 'Shutting down' }

      default:
        return { success: false, error: `Unknown action: ${req.action}` }
    }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : String(error) }
  } finally {
    if (state && req.action !== 'shutdown') {
      state.pendingRequests--
    }
  }
}

function cleanup(): void {
  if (state) {
    if (state.idleTimer) {
      clearTimeout(state.idleTimer)
    }
    if (existsSync(state.info.socketPath)) {
      unlinkSync(state.info.socketPath)
    }
    if (existsSync(state.info.pidFile)) {
      unlinkSync(state.info.pidFile)
    }
    if (existsSync(state.info.readyFile)) {
      unlinkSync(state.info.readyFile)
    }
    unregisterSession(state.info.id)
  }
}

export function startServer(config: { model: string; system: string; name?: string; idleTimeout?: number }): void {
  ensureDirs()

  // Create session
  const session = new AgentSession({
    model: config.model,
    system: config.system,
  })

  // Generate paths
  const socketPath = join(SESSIONS_DIR, `${session.id}.sock`)
  const pidFile = join(SESSIONS_DIR, `${session.id}.pid`)
  const readyFile = join(SESSIONS_DIR, `${session.id}.ready`)

  // Clean up any existing socket
  if (existsSync(socketPath)) {
    unlinkSync(socketPath)
  }

  const info: SessionInfo = {
    id: session.id,
    name: config.name,
    model: config.model,
    socketPath,
    pidFile,
    readyFile,
    pid: process.pid,
    createdAt: session.createdAt,
    idleTimeout: config.idleTimeout,
  }

  // Create Unix socket server
  const server = createServer((socket) => {
    let buffer = ''

    socket.on('data', async (data) => {
      buffer += data.toString()

      const lines = buffer.split('\n')
      buffer = lines.pop() || ''

      for (const line of lines) {
        if (!line.trim()) continue

        try {
          const req: Request = JSON.parse(line)
          const res = await handleRequest(req)
          socket.write(JSON.stringify(res) + '\n')
        } catch (error) {
          socket.write(JSON.stringify({
            success: false,
            error: error instanceof Error ? error.message : 'Parse error',
          }) + '\n')
        }
      }
    })

    socket.on('error', () => {
      // Ignore client errors
    })
  })

  server.listen(socketPath, () => {
    // Write PID file
    writeFileSync(pidFile, process.pid.toString())

    // Register session
    registerSession(info)

    // Initialize state
    state = {
      session,
      server,
      info,
      lastActivity: Date.now(),
      pendingRequests: 0,
    }

    // Write ready file (signals CLI that server is ready)
    writeFileSync(readyFile, session.id)

    // Start idle timer
    resetIdleTimer()

    const nameStr = config.name ? ` (${config.name})` : ''
    console.log(`Session started: ${session.id}${nameStr}`)
    console.log(`Model: ${session.model}`)
  })

  server.on('error', (error) => {
    console.error('Server error:', error)
    cleanup()
    process.exit(1)
  })

  // Handle signals
  process.on('SIGINT', () => {
    console.log('\nShutting down...')
    cleanup()
    process.exit(0)
  })

  process.on('SIGTERM', () => {
    cleanup()
    process.exit(0)
  })
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
