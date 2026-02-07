import type { Server } from 'node:net'
import type { AgentSession } from '../agent/session.ts'
import type { ToolDefinition } from '../agent/types.ts'
import type { SkillImporter } from '../agent/skills/index.ts'
import type { SessionInfo } from './registry.ts'

export interface ServerState {
  session: AgentSession // Always non-null: unified session for all backends
  server: Server
  info: SessionInfo
  lastActivity: number
  pendingRequests: number
  idleTimer?: ReturnType<typeof setTimeout>
  importer?: SkillImporter // For cleaning up imported skills
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

  const { session, info } = state

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
        const { message, options, async: isAsync } = req.payload as {
          message: string
          options?: { autoApprove?: boolean }
          async?: boolean
        }

        if (isAsync) {
          session.send(message, options).catch((error) => {
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
        if (!session.supportsTools) {
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
    if (getState() && req.action !== 'shutdown') {
      state.pendingRequests--
    }
  }
}
