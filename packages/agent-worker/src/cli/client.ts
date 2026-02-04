import { createConnection } from 'node:net'
import { getSessionInfo, isSessionRunning } from './server.ts'

interface Request {
  action: string
  payload?: unknown
}

interface Response {
  success: boolean
  data?: unknown
  error?: string
}

/**
 * Send a request to a specific session
 * @param req - The request to send
 * @param target - Session ID or name (optional, uses default if not specified)
 */
export function sendRequest(req: Request, target?: string): Promise<Response> {
  return new Promise((resolve, reject) => {
    const info = getSessionInfo(target)

    if (!info) {
      if (target) {
        resolve({ success: false, error: `Session not found: ${target}` })
      } else {
        resolve({ success: false, error: 'No active session. Start one with: agent-worker session start -m <model>' })
      }
      return
    }

    if (!isSessionRunning(target)) {
      resolve({ success: false, error: `Session not running: ${target || info.id}` })
      return
    }

    const socket = createConnection(info.socketPath)
    let buffer = ''

    socket.on('connect', () => {
      socket.write(JSON.stringify(req) + '\n')
    })

    socket.on('data', (data) => {
      buffer += data.toString()
      const lines = buffer.split('\n')
      buffer = lines.pop() || ''

      for (const line of lines) {
        if (!line.trim()) continue
        try {
          const res: Response = JSON.parse(line)
          socket.end()
          resolve(res)
        } catch (error) {
          socket.end()
          reject(error)
        }
      }
    })

    socket.on('error', (error) => {
      reject(error)
    })

    socket.on('timeout', () => {
      socket.end()
      reject(new Error('Connection timeout'))
    })

    socket.setTimeout(60000) // 60 second timeout for API calls
  })
}

/**
 * Check if any session is active, or a specific session
 */
export function isSessionActive(target?: string): boolean {
  return isSessionRunning(target)
}
