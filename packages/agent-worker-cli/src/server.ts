import { createServer, type Server } from 'node:net'
import { existsSync, unlinkSync, writeFileSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { AgentSession, type ToolDefinition } from 'agent-worker'

const CONFIG_DIR = join(homedir(), '.agent-worker')
const SOCKET_PATH = join(CONFIG_DIR, 'session.sock')
const PID_FILE = join(CONFIG_DIR, 'session.pid')

interface ServerState {
  session: AgentSession
  server: Server
}

let state: ServerState | null = null

interface Request {
  action: string
  payload?: unknown
}

interface Response {
  success: boolean
  data?: unknown
  error?: string
}

async function handleRequest(req: Request): Promise<Response> {
  if (!state) {
    return { success: false, error: 'No active session' }
  }

  const { session } = state

  try {
    switch (req.action) {
      case 'ping':
        return { success: true, data: { id: session.id, model: session.model } }

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
        // Graceful shutdown
        setTimeout(() => {
          cleanup()
          process.exit(0)
        }, 100)
        return { success: true, data: 'Shutting down' }

      default:
        return { success: false, error: `Unknown action: ${req.action}` }
    }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : String(error) }
  }
}

function cleanup(): void {
  if (existsSync(SOCKET_PATH)) {
    unlinkSync(SOCKET_PATH)
  }
  if (existsSync(PID_FILE)) {
    unlinkSync(PID_FILE)
  }
}

export function startServer(config: { model: string; system: string }): void {
  // Clean up any existing socket
  cleanup()

  // Create session
  const session = new AgentSession({
    model: config.model,
    system: config.system,
  })

  // Create Unix socket server
  const server = createServer((socket) => {
    let buffer = ''

    socket.on('data', async (data) => {
      buffer += data.toString()

      // Handle newline-delimited JSON
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

  server.listen(SOCKET_PATH, () => {
    // Write PID file
    writeFileSync(PID_FILE, process.pid.toString())

    console.log(`Session started: ${session.id}`)
    console.log(`Model: ${session.model}`)
    console.log(`Socket: ${SOCKET_PATH}`)
    console.log('\nSession is running. Use `agent-worker session end` to stop.')
  })

  server.on('error', (error) => {
    console.error('Server error:', error)
    cleanup()
    process.exit(1)
  })

  state = { session, server }

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

export function getSocketPath(): string {
  return SOCKET_PATH
}

export function getPidFile(): string {
  return PID_FILE
}

export function isServerRunning(): boolean {
  if (!existsSync(PID_FILE)) return false

  try {
    const pid = parseInt(readFileSync(PID_FILE, 'utf-8').trim(), 10)
    // Check if process exists
    process.kill(pid, 0)
    return true
  } catch {
    // Process doesn't exist, clean up stale files
    cleanup()
    return false
  }
}
