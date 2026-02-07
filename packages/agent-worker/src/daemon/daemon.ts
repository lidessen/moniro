import { createServer } from 'node:net'
import { existsSync, unlinkSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { AgentSession } from '../agent/session.ts'
import type { ToolDefinition } from '../agent/types.ts'
import type { BackendType } from '../backends/types.ts'
import { createBackend } from '../backends/index.ts'
import { SkillsProvider, createSkillsTool, SkillImporter } from '../agent/skills/index.ts'
import {
  SESSIONS_DIR,
  ensureDirs,
  registerSession,
  unregisterSession,
} from './registry.ts'
import type { SessionInfo } from './registry.ts'
import { handleRequest } from './handler.ts'
import type { ServerState, Request } from './handler.ts'

const DEFAULT_SKILL_DIRS = [
  '.agents/skills',
  '.claude/skills',
  '.cursor/skills',
  join(homedir(), '.agents/skills'),
  join(homedir(), '.claude/skills'),
]

/**
 * Setup skills provider and return Skills tool
 * Supports both local and imported skills
 * Skills are always loaded and provided as tools, regardless of backend
 */
async function setupSkills(
  sessionId: string,
  skillPaths?: string[],
  skillDirs?: string[],
  importSkills?: string[]
): Promise<{ tools: ToolDefinition[]; importer?: SkillImporter }> {
  const provider = new SkillsProvider()

  // Scan default directories
  for (const dir of DEFAULT_SKILL_DIRS) {
    try {
      provider.scanDirectorySync(dir)
    } catch {
      // Ignore errors from default paths
    }
  }

  // Scan additional directories
  if (skillDirs) {
    for (const dir of skillDirs) {
      try {
        provider.scanDirectorySync(dir)
      } catch (error) {
        console.error(`Failed to scan skill directory ${dir}:`, error)
      }
    }
  }

  // Add individual skills
  if (skillPaths) {
    for (const skillPath of skillPaths) {
      try {
        provider.addSkillSync(skillPath)
      } catch (error) {
        console.error(`Failed to add skill ${skillPath}:`, error)
      }
    }
  }

  // Import remote skills
  let importer: SkillImporter | undefined
  if (importSkills && importSkills.length > 0) {
    importer = new SkillImporter(sessionId)

    try {
      await importer.importMultiple(importSkills)
      await provider.addImportedSkills(importer)
    } catch (error) {
      console.error('Failed to import skills:', error)
    }
  }

  const skills = provider.list()
  if (skills.length > 0) {
    console.log(`Loaded ${skills.length} skill(s):`)
    for (const skill of skills) {
      console.log(`  - ${skill.name}: ${skill.description}`)
    }
  }

  return {
    tools: skills.length > 0 ? [createSkillsTool(provider)] : [],
    importer,
  }
}

let state: ServerState | null = null

const DEFAULT_IDLE_TIMEOUT = 30 * 60 * 1000 // 30 minutes

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

  // Cleanup imported skills
  if (state.importer) {
    await state.importer.cleanup()
  }

  cleanup()
  process.exit(0)
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

export async function startDaemon(config: {
  model: string
  system: string
  name?: string
  idleTimeout?: number
  backend?: BackendType
  skills?: string[]
  skillDirs?: string[]
  importSkills?: string[]
}): Promise<void> {
  ensureDirs()

  const backendType = config.backend || 'sdk'
  const sessionId = crypto.randomUUID()

  // Setup skills (both local and imported)
  const { tools, importer } = await setupSkills(
    sessionId,
    config.skills,
    config.skillDirs,
    config.importSkills
  )

  // Create unified AgentSession (with CLI backend for non-SDK types)
  const cliBackend = backendType !== 'sdk'
    ? createBackend({
        type: backendType,
        model: config.model,
      } as Parameters<typeof createBackend>[0])
    : undefined

  const session = new AgentSession({
    model: config.model,
    system: config.system,
    tools,
    backend: cliBackend,
  })

  const effectiveId = session.id

  // Generate paths
  const socketPath = join(SESSIONS_DIR, `${effectiveId}.sock`)
  const pidFile = join(SESSIONS_DIR, `${effectiveId}.pid`)
  const readyFile = join(SESSIONS_DIR, `${effectiveId}.ready`)

  // Clean up any existing socket
  if (existsSync(socketPath)) {
    unlinkSync(socketPath)
  }

  const info: SessionInfo = {
    id: effectiveId,
    name: config.name,
    model: config.model,
    system: config.system,
    backend: backendType,
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
          const res = await handleRequest(() => state, req, resetIdleTimer, gracefulShutdown)
          socket.write(JSON.stringify(res) + '\n')
        } catch (error) {
          socket.write(
            JSON.stringify({
              success: false,
              error: error instanceof Error ? error.message : 'Parse error',
            }) + '\n'
          )
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
      importer,
    }

    // Write ready file (signals CLI that server is ready)
    writeFileSync(readyFile, effectiveId)

    // Start idle timer
    resetIdleTimer()

    const nameStr = config.name ? ` (${config.name})` : ''
    console.log(`Session started: ${effectiveId}${nameStr}`)
    console.log(`Model: ${config.model}`)
    console.log(`Backend: ${backendType}`)
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
