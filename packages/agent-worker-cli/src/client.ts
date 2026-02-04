import { createConnection } from 'node:net'
import { getSocketPath, isServerRunning } from './server.ts'

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
 * Send a request to the session server
 */
export function sendRequest(req: Request): Promise<Response> {
  return new Promise((resolve, reject) => {
    if (!isServerRunning()) {
      resolve({ success: false, error: 'No active session. Start one with: agent-worker session start' })
      return
    }

    const socket = createConnection(getSocketPath())
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
 * Check if session server is running
 */
export function isSessionActive(): boolean {
  return isServerRunning()
}
