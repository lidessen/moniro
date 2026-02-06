/**
 * Agent Backend Implementations
 * Different ways to run agents (SDK, CLI, etc.)
 */

import type { AgentBackend, AgentRunContext, AgentRunResult } from './types.ts'
import { parseModel } from '../../core/model-maps.ts'
import { buildAgentPrompt } from './prompt.ts'
import { CursorBackend as CursorCLI } from '../../backends/cursor.ts'
import { ClaudeCodeBackend as ClaudeCLI } from '../../backends/claude-code.ts'
import { CodexBackend as CodexCLI } from '../../backends/codex.ts'
import { createMockBackend } from '../../backends/mock.ts'
import { getModelForBackend } from '../../backends/types.ts'

// Re-export for backward compatibility (moved to mcp-config.ts)
export { generateWorkflowMCPConfig, type WorkflowMCPConfig } from './mcp-config.ts'

// ==================== SDK Backend ====================

/**
 * SDK Backend - uses Anthropic SDK directly
 *
 * This is the most capable backend, with full MCP tool support.
 * Requires ANTHROPIC_API_KEY environment variable.
 */
export class SDKBackend implements AgentBackend {
  readonly name = 'sdk'

  constructor(
    private getClient: () => Promise<AnthropicLike>,
    private getMCPTools?: (mcpUrl: string) => Promise<Tool[]>
  ) {}

  async run(ctx: AgentRunContext): Promise<AgentRunResult> {
    const startTime = Date.now()

    try {
      const client = await this.getClient()
      if (!ctx.agent.model) {
        throw new Error('SDK backend requires a model to be specified')
      }
      const { model } = parseModel(ctx.agent.model)

      // Build initial messages
      const messages: Message[] = [{ role: 'user', content: buildAgentPrompt(ctx) }]

      // Get MCP tools if available
      const tools = this.getMCPTools ? await this.getMCPTools(ctx.mcpUrl) : []

      // Agentic loop
      while (true) {
        const response = await client.messages.create({
          model,
          system: ctx.agent.resolvedSystemPrompt,
          messages,
          tools: tools.length > 0 ? tools : undefined,
          max_tokens: 4096,
        })

        // Check for end of turn
        if (response.stop_reason === 'end_turn') {
          break
        }

        // Handle tool use
        if (response.stop_reason === 'tool_use') {
          const toolResults = await this.handleToolCalls(response.content)
          messages.push({ role: 'assistant', content: response.content })
          messages.push({ role: 'user', content: toolResults })
        } else {
          // Other stop reasons (max_tokens, etc.)
          break
        }
      }

      return { success: true, duration: Date.now() - startTime }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
        duration: Date.now() - startTime,
      }
    }
  }

  private async handleToolCalls(
    content: ContentBlock[]
  ): Promise<ContentBlock[]> {
    const results: ContentBlock[] = []

    for (const block of content) {
      if (block.type === 'tool_use') {
        // TODO: Connect to MCP server and execute tool
        // For now, return placeholder
        results.push({
          type: 'tool_result',
          tool_use_id: block.id,
          content: 'Tool execution not implemented',
        })
      }
    }

    return results
  }
}

// Minimal type definitions for Anthropic SDK compatibility
interface AnthropicLike {
  messages: {
    create(params: {
      model: string
      system: string
      messages: Message[]
      tools?: Tool[]
      max_tokens: number
    }): Promise<{
      stop_reason: 'end_turn' | 'tool_use' | 'max_tokens' | 'stop_sequence'
      content: ContentBlock[]
    }>
  }
}

interface Message {
  role: 'user' | 'assistant'
  content: string | ContentBlock[]
}

interface Tool {
  name: string
  description: string
  input_schema: Record<string, unknown>
}

interface ContentBlock {
  type: 'text' | 'tool_use' | 'tool_result'
  text?: string
  id?: string
  name?: string
  input?: Record<string, unknown>
  tool_use_id?: string
  content?: string
}

// ==================== Backend Selection ====================

export interface BackendOptions {
  getClient?: () => Promise<AnthropicLike>
  getMCPTools?: (mcpUrl: string) => Promise<Tool[]>
}

/**
 * Get backend by explicit backend type
 *
 * For CLI backends (claude, cursor, codex), this uses the Backend
 * implementations from backends/ directly — they implement run() natively.
 */
export function getBackendByType(
  backendType: 'sdk' | 'claude' | 'cursor' | 'codex' | 'mock',
  options?: BackendOptions & { model?: string; debugLog?: (msg: string) => void }
): AgentBackend {
  switch (backendType) {
    case 'sdk':
      if (!options?.getClient) {
        throw new Error('SDK backend requires getClient function')
      }
      return new SDKBackend(options.getClient, options.getMCPTools)

    case 'claude': {
      const translatedModel = options?.model ? getModelForBackend(options.model, 'claude') : undefined
      const cli = new ClaudeCLI({ model: translatedModel, debugLog: options?.debugLog })
      return { name: 'claude', run: (ctx) => cli.run(ctx) }
    }

    case 'codex': {
      const translatedModel = options?.model ? getModelForBackend(options.model, 'codex') : undefined
      const cli = new CodexCLI({ model: translatedModel, debugLog: options?.debugLog })
      return { name: 'codex', run: (ctx) => cli.run(ctx) }
    }

    case 'cursor': {
      const translatedModel = options?.model ? getModelForBackend(options.model, 'cursor') : undefined
      const cli = new CursorCLI({ model: translatedModel, debugLog: options?.debugLog })
      return { name: 'cursor', run: (ctx) => cli.run(ctx) }
    }

    case 'mock':
      return createMockBackend(options?.debugLog)

    default:
      throw new Error(`Unknown backend type: ${backendType}`)
  }
}

/**
 * Get appropriate backend for a model identifier
 *
 * Infers backend type from model name and delegates to getBackendByType.
 * Prefer using getBackendByType with explicit backend field in workflow configs.
 */
export function getBackendForModel(
  model: string,
  options?: BackendOptions & { debugLog?: (msg: string) => void }
): AgentBackend {
  const { provider } = parseModel(model)

  switch (provider) {
    case 'anthropic':
      return getBackendByType('sdk', options)

    case 'claude':
      return getBackendByType('claude', { ...options, model })

    case 'codex':
      return getBackendByType('codex', { ...options, model })

    default:
      throw new Error(`Unknown provider: ${provider}. Specify backend explicitly.`)
  }
}
