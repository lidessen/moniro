import type { Server } from 'node:net'
import type { AgentSession } from '../core/session.ts'
import type { ToolDefinition } from '../core/types.ts'
import type { Backend } from '../backends/types.ts'
import type { SkillImporter } from '../skills/index.ts'
import type { SessionInfo } from './registry.ts'

export interface ServerState {
  session: AgentSession | null // null when using CLI backend
  backend: Backend | null // non-null when using CLI backend
  server: Server
  info: SessionInfo
  lastActivity: number
  pendingRequests: number
  idleTimer?: ReturnType<typeof setTimeout>
  importer?: SkillImporter // For cleaning up imported skills
  // For CLI backends: simple message history
  cliHistory: Array<{ role: 'user' | 'assistant'; content: string; timestamp: string }>
}

export interface Request {
  action: string
  payload?: unknown
}

export interface Response {
  success: boolean
  data?: unknown
  error?: string
}

export async function handleRequest(
  getState: () => ServerState | null,
  req: Request,
  resetIdleTimer: () => void,
  gracefulShutdown: () => Promise<void>
): Promise<Response> {
  const state = getState()
  if (!state) {
    return { success: false, error: 'No active session' }
  }

  // Track activity
  state.pendingRequests++
  resetIdleTimer()

  const { session, backend, info } = state

  try {
    switch (req.action) {
      case 'ping':
        return {
          success: true,
          data: {
            id: info.id,
            model: info.model,
            backend: info.backend,
            name: info.name,
          },
        }

      case 'send': {
        const { message, options, async } = req.payload as {
          message: string
          options?: { autoApprove?: boolean }
          async?: boolean
        }

        // CLI backend path
        if (backend) {
          const timestamp = new Date().toISOString()
          state.cliHistory.push({ role: 'user', content: message, timestamp })

          // Async mode: return immediately, process in background
          if (async) {
            // Add placeholder for assistant response
            state.cliHistory.push({
              role: 'assistant',
              content: '(processing...)',
              timestamp: new Date().toISOString(),
            })

            // Process in background with timeout
            const timeoutMs = 60000 // 60 seconds timeout
            const timeoutPromise = new Promise<never>((_, reject) =>
              setTimeout(() => reject(new Error('Request timed out after 60 seconds')), timeoutMs)
            )

            Promise.race([backend.send(message, { system: info.system }), timeoutPromise])
              .then((result) => {
                // Update the last message (which is the placeholder)
                const currentState = getState()
                if (!currentState) return
                const lastMsg = currentState.cliHistory[currentState.cliHistory.length - 1]
                if (lastMsg && lastMsg.content === '(processing...)') {
                  lastMsg.content = result.content
                  lastMsg.timestamp = new Date().toISOString()
                }
              })
              .catch((error) => {
                const currentState = getState()
                if (!currentState) return
                const lastMsg = currentState.cliHistory[currentState.cliHistory.length - 1]
                if (lastMsg && lastMsg.content === '(processing...)') {
                  lastMsg.content = `Error: ${error instanceof Error ? error.message : String(error)}`
                  lastMsg.timestamp = new Date().toISOString()
                }
              })

            return {
              success: true,
              data: {
                async: true,
                message: 'Processing in background. Use `peek` to check the response.',
              },
            }
          }

          // Sync mode: wait for response
          const result = await backend.send(message, { system: info.system })
          state.cliHistory.push({
            role: 'assistant',
            content: result.content,
            timestamp: new Date().toISOString(),
          })

          return {
            success: true,
            data: {
              content: result.content,
              toolCalls: result.toolCalls || [],
              pendingApprovals: [],
              usage: result.usage || { input: 0, output: 0, total: 0 },
              latency: 0,
            },
          }
        }

        // SDK backend path
        if (session) {
          // Async mode for SDK backend
          if (async) {
            // Process in background, return immediately
            session.send(message, options)
              .catch((error) => {
                console.error('Background send error:', error)
              })

            return {
              success: true,
              data: {
                async: true,
                message: 'Processing in background. Use `peek` to check the response.',
              },
            }
          }

          // Sync mode
          const response = await session.send(message, options)
          return { success: true, data: response }
        }

        return { success: false, error: 'No backend configured' }
      }

      case 'tool_add': {
        if (!session) {
          return { success: false, error: 'Tool management not supported for CLI backends' }
        }
        const tool = req.payload as ToolDefinition
        session.addTool(tool)
        return { success: true, data: { name: tool.name } }
      }

      case 'tool_mock': {
        if (!session) {
          return { success: false, error: 'Tool management not supported for CLI backends' }
        }
        const { name, response } = req.payload as { name: string; response: unknown }
        session.setMockResponse(name, response)
        return { success: true, data: { name } }
      }

      case 'tool_list': {
        if (!session) {
          return { success: true, data: [] }
        }
        const tools = session.getTools()
        return { success: true, data: tools }
      }

      case 'tool_import': {
        if (!session) {
          return { success: false, error: 'Tool import not supported for CLI backends' }
        }
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
            const message =
              factoryError instanceof Error ? factoryError.message : String(factoryError)
            return { success: false, error: `Factory function failed: ${message}` }
          }
        } else if (Array.isArray(module.tools)) {
          tools = module.tools
        } else {
          return {
            success: false,
            error: 'No tools found. Export default array or named "tools" array.',
          }
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

        return {
          success: true,
          data: { imported, skipped: skipped.length > 0 ? skipped : undefined },
        }
      }

      case 'history':
        if (backend) {
          return { success: true, data: state.cliHistory }
        }
        if (session) {
          return { success: true, data: session.history() }
        }
        return { success: true, data: [] }

      case 'stats':
        if (backend) {
          return {
            success: true,
            data: { messageCount: state.cliHistory.length, usage: { input: 0, output: 0, total: 0 } },
          }
        }
        if (session) {
          return { success: true, data: session.stats() }
        }
        return { success: true, data: { messageCount: 0, usage: { input: 0, output: 0, total: 0 } } }

      case 'export':
        if (backend) {
          return {
            success: true,
            data: {
              sessionId: info.id,
              model: info.model,
              backend: info.backend,
              messages: state.cliHistory,
              createdAt: info.createdAt,
            },
          }
        }
        if (session) {
          return { success: true, data: session.export() }
        }
        return { success: false, error: 'No session to export' }

      case 'clear':
        if (backend) {
          state.cliHistory = []
          return { success: true }
        }
        if (session) {
          session.clear()
          return { success: true }
        }
        return { success: true }

      case 'pending':
        if (session) {
          return { success: true, data: session.getPendingApprovals() }
        }
        return { success: true, data: [] }

      case 'approve': {
        if (!session) {
          return { success: false, error: 'Approvals not supported for CLI backends' }
        }
        const { id } = req.payload as { id: string }
        const result = await session.approve(id)
        return { success: true, data: result }
      }

      case 'deny': {
        if (!session) {
          return { success: false, error: 'Approvals not supported for CLI backends' }
        }
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
    if (getState() && req.action !== 'shutdown') {
      state.pendingRequests--
    }
  }
}
