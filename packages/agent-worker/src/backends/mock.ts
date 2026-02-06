/**
 * Mock AI Backend
 *
 * Uses AI SDK generateText with a MockLanguageModelV3 provider
 * and real MCP tool execution for integration testing.
 *
 * The mock model generates scripted tool calls (channel_send)
 * to test the full workflow flow without real LLM API calls.
 */

import { generateText, tool, stepCountIs } from 'ai'
import { MockLanguageModelV3, mockValues } from 'ai/test'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { z } from 'zod'
import type { AgentBackend, AgentRunContext, AgentRunResult } from '../workflow/controller/types.ts'
import { buildAgentPrompt } from '../workflow/controller/prompt.ts'

// ==================== MCP Tool Bridge ====================

interface MCPToolBridge {
  tools: Record<string, ReturnType<typeof tool>>
  close: () => Promise<void>
}

/**
 * Connect to workflow MCP server via HTTP and create AI SDK tool wrappers
 */
async function createMCPToolBridge(
  mcpUrl: string,
  agentName: string
): Promise<MCPToolBridge> {
  const url = new URL(`${mcpUrl}?agent=${encodeURIComponent(agentName)}`)
  const transport = new StreamableHTTPClientTransport(url)
  const client = new Client({ name: agentName, version: '1.0.0' })
  await client.connect(transport)

  const { tools: mcpTools } = await client.listTools()

  const aiTools: Record<string, ReturnType<typeof tool>> = {}
  for (const mcpTool of mcpTools) {
    const toolName = mcpTool.name
    aiTools[toolName] = tool({
      description: mcpTool.description || toolName,
      parameters: z.record(z.unknown()),
      execute: async (args: Record<string, unknown>) => {
        const result = await client.callTool({ name: toolName, arguments: args })
        return result.content
      },
    })
  }

  return {
    tools: aiTools,
    close: () => client.close(),
  }
}

// ==================== Mock AI Backend ====================

/**
 * Mock AI Backend for testing
 *
 * Uses MockLanguageModelV3 to generate scripted tool calls,
 * with real MCP tool execution to test the full workflow flow.
 *
 * Workflow YAML usage:
 * ```yaml
 * agents:
 *   alice:
 *     backend: mock
 *     system_prompt: You are Alice.
 * ```
 */
export class MockAIBackend implements AgentBackend {
  readonly name = 'mock'

  constructor(private debugLog?: (message: string) => void) {}

  async run(ctx: AgentRunContext): Promise<AgentRunResult> {
    const startTime = Date.now()
    const log = this.debugLog || (() => {})

    try {
      // Connect to MCP server via HTTP and create AI SDK tool wrappers
      if (!ctx.mcpUrl) {
        return { success: false, error: 'Mock backend requires mcpUrl (HTTP MCP server)', duration: 0 }
      }
      const mcp = await createMCPToolBridge(ctx.mcpUrl, ctx.name)
      log(`[${ctx.name}] MCP connected, ${Object.keys(mcp.tools).length} tools`)

      // Summarize inbox for the mock response (strip @mentions to avoid re-triggering)
      const inboxSummary = ctx.inbox
        .map((m) => `${m.entry.from}: ${m.entry.content.slice(0, 80).replace(/@/g, '')}`)
        .join('; ')

      // Create mock model with scripted responses:
      // Step 1: call channel_send with a summary of inbox
      // Step 2: end turn
      const mockModel = new MockLanguageModelV3({
        doGenerate: mockValues(
          // Step 1: send channel message
          {
            content: [
              {
                type: 'tool-call' as const,
                toolCallId: `call-${ctx.name}-${Date.now()}`,
                toolName: 'channel_send',
                input: JSON.stringify({
                  message: `[${ctx.name}] Processed: ${inboxSummary.slice(0, 200)}`,
                }),
              },
            ],
            finishReason: { unified: 'tool-calls' as const, raw: 'tool_use' },
            usage: {
              inputTokens: { total: 100, noCache: 100, cacheRead: 0, cacheWrite: 0 },
              outputTokens: { total: 50, text: 50, reasoning: 0 },
            },
          },
          // Step 2: finish
          {
            content: [{ type: 'text' as const, text: `${ctx.name} done.` }],
            finishReason: { unified: 'stop' as const, raw: 'end_turn' },
            usage: {
              inputTokens: { total: 50, noCache: 50, cacheRead: 0, cacheWrite: 0 },
              outputTokens: { total: 10, text: 10, reasoning: 0 },
            },
          }
        ),
      })

      // Build prompt
      const prompt = buildAgentPrompt(ctx)
      log(`[${ctx.name}] Prompt (${prompt.length} chars): ${prompt.slice(0, 150)}...`)

      // Run with AI SDK generateText + real MCP tools
      const result = await generateText({
        model: mockModel,
        tools: mcp.tools,
        prompt,
        system: ctx.agent.resolvedSystemPrompt,
        stopWhen: stepCountIs(3),
      })

      log(`[${ctx.name}] Completed: ${result.text || '(tool calls only)'}`)
      log(`[${ctx.name}] Steps: ${result.steps.length}, Tool calls: ${result.steps.reduce((n, s) => n + s.toolCalls.length, 0)}`)

      // Disconnect
      await mcp.close()

      return { success: true, duration: Date.now() - startTime }
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error)
      log(`[${ctx.name}] Error: ${errorMsg}`)
      return { success: false, error: errorMsg, duration: Date.now() - startTime }
    }
  }
}

/**
 * Create a mock AI backend
 */
export function createMockBackend(debugLog?: (msg: string) => void): AgentBackend {
  return new MockAIBackend(debugLog)
}
