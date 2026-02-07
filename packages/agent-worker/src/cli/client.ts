import { createConnection } from 'node:net'
import { getSessionInfo, isSessionRunning } from '../daemon/server.ts'

interface Request {
  action: string
  payload?: unknown
}

interface Response {
  success: boolean
  data?: unknown
  error?: string
}

interface SendOptions {
  target?: string
  debug?: boolean
}

/**
 * Send a request to a specific session
 * @param req - The request to send
 * @param target - Session ID or name (optional, uses default if not specified)
 * @param options - Additional options (debug mode, etc.)
 */
export function sendRequest(req: Request, target?: string, options?: SendOptions): Promise<Response>
export function sendRequest(req: Request, targetOrOptions?: string | SendOptions, options?: SendOptions): Promise<Response> {
  // Handle overloaded signatures
  let target: string | undefined
  let opts: SendOptions = {}

  if (typeof targetOrOptions === 'string') {
    target = targetOrOptions
    opts = options || {}
  } else if (targetOrOptions) {
    opts = targetOrOptions
    target = opts.target
  }
  const debug = opts.debug || false

  return new Promise((resolve, reject) => {
    if (debug) {
      console.error(`[DEBUG] Looking up session: ${target || '(default)'}`)
    }

    const info = getSessionInfo(target)

    if (!info) {
      if (target) {
        resolve({ success: false, error: `Session not found: ${target}` })
      } else {
        resolve({ success: false, error: 'No active session. Start one with: agent-worker session start -m <model>' })
      }
      return
    }

    if (debug) {
      console.error(`[DEBUG] Found session: ${info.id} (${info.backend})`)
      console.error(`[DEBUG] Socket path: ${info.socketPath}`)
    }

    if (!isSessionRunning(target)) {
      resolve({ success: false, error: `Session not running: ${target || info.id}` })
      return
    }

    if (debug) {
      console.error(`[DEBUG] Connecting to socket...`)
    }

    const socket = createConnection(info.socketPath)
    let buffer = ''
    const startTime = Date.now()

    socket.on('connect', () => {
      if (debug) {
        console.error(`[DEBUG] Connected. Sending request:`)
        console.error(`[DEBUG] ${JSON.stringify(req, null, 2)}`)
      }
      socket.write(JSON.stringify(req) + '\n')
    })

    socket.on('data', (data) => {
      if (debug) {
        const elapsed = ((Date.now() - startTime) / 1000).toFixed(2)
        console.error(`[DEBUG] Received data after ${elapsed}s: ${data.toString().substring(0, 100)}...`)
      }

      buffer += data.toString()
      const lines = buffer.split('\n')
      buffer = lines.pop() || ''

      for (const line of lines) {
        if (!line.trim()) continue
        try {
          const res: Response = JSON.parse(line)
          if (debug) {
            const elapsed = ((Date.now() - startTime) / 1000).toFixed(2)
            console.error(`[DEBUG] Received response after ${elapsed}s`)
          }
          socket.end()
          resolve(res)
        } catch (error) {
          if (debug) {
            console.error(`[DEBUG] Parse error:`, error)
          }
          socket.end()
          reject(error)
        }
      }
    })

    socket.on('error', (error) => {
      if (debug) {
        console.error(`[DEBUG] Socket error:`, error)
      }
      reject(error)
    })

    socket.on('timeout', () => {
      if (debug) {
        console.error(`[DEBUG] Socket timeout after 60s`)
      }
      socket.end()
      reject(new Error('Connection timeout'))
    })

    socket.setTimeout(60000) // 60 second timeout for API calls

    if (debug) {
      console.error(`[DEBUG] Waiting for response (60s timeout)...`)
    }
  })
}

/**
 * Check if any session is active, or a specific session
 */
export function isSessionActive(target?: string): boolean {
  return isSessionRunning(target)
}
