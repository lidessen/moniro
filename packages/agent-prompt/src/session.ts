import { generateText, stepCountIs, type LanguageModel, type ModelMessage } from 'ai'
import { createModelAsync } from './models.ts'
import { createTools } from './tools.ts'
import type {
  AgentResponse,
  SessionConfig,
  SessionState,
  ToolCall,
  ToolDefinition,
  TokenUsage,
  Transcript,
} from './types.ts'

/**
 * AgentSession - Stateful session for controlled agent testing
 *
 * Maintains conversation state across multiple send() calls,
 * enabling improvisational testing where you observe responses
 * and decide next actions.
 */
export class AgentSession {
  readonly id: string
  readonly model: string
  readonly system: string
  readonly createdAt: string

  private tools: ToolDefinition[]
  private maxTokens: number
  private maxSteps: number
  private messages: ModelMessage[] = []
  private totalUsage: TokenUsage = { input: 0, output: 0, total: 0 }

  // Cached instances
  private cachedModel: LanguageModel | null = null
  private cachedTools: ReturnType<typeof createTools> | null = null
  private toolsChanged = false

  constructor(config: SessionConfig, restore?: SessionState) {
    // Restore from saved state or create new
    if (restore) {
      this.id = restore.id
      this.createdAt = restore.createdAt
      this.messages = [...restore.messages]
      this.totalUsage = { ...restore.totalUsage }
    } else {
      this.id = crypto.randomUUID()
      this.createdAt = new Date().toISOString()
    }

    this.model = config.model
    this.system = config.system
    this.tools = config.tools ?? []
    this.maxTokens = config.maxTokens ?? 4096
    this.maxSteps = config.maxSteps ?? 10
  }

  /**
   * Get or create cached model instance (lazy loads provider if needed)
   */
  private async getModel(): Promise<LanguageModel> {
    if (!this.cachedModel) {
      this.cachedModel = await createModelAsync(this.model)
    }
    return this.cachedModel
  }

  /**
   * Get or create cached tools, rebuild if tools changed
   */
  private getTools(): ReturnType<typeof createTools> | undefined {
    if (this.tools.length === 0) return undefined

    if (!this.cachedTools || this.toolsChanged) {
      this.cachedTools = createTools(this.tools)
      this.toolsChanged = false
    }
    return this.cachedTools
  }

  /**
   * Send a message and get the agent's response
   * Conversation state is maintained across calls
   */
  async send(content: string): Promise<AgentResponse> {
    const startTime = performance.now()

    // Add user message to history
    this.messages.push({ role: 'user', content })

    const result = await generateText({
      model: await this.getModel(),
      system: this.system,
      messages: this.messages,
      tools: this.getTools(),
      maxOutputTokens: this.maxTokens,
      stopWhen: stepCountIs(this.maxSteps),
    })

    const latency = Math.round(performance.now() - startTime)

    // Extract tool calls from steps
    const toolCalls: ToolCall[] = []
    for (const step of result.steps) {
      if (step.toolCalls) {
        for (const tc of step.toolCalls) {
          const toolResult = step.toolResults?.find((tr) => tr.toolCallId === tc.toolCallId)
          toolCalls.push({
            name: tc.toolName,
            arguments: tc.input as Record<string, unknown>,
            result: toolResult?.output ?? null,
            timing: 0, // Individual timing not available
          })
        }
      }
    }

    // Add assistant response to history
    this.messages.push({ role: 'assistant', content: result.text })

    // Update usage
    const usage: TokenUsage = {
      input: result.usage?.inputTokens ?? 0,
      output: result.usage?.outputTokens ?? 0,
      total: (result.usage?.inputTokens ?? 0) + (result.usage?.outputTokens ?? 0),
    }
    this.totalUsage.input += usage.input
    this.totalUsage.output += usage.output
    this.totalUsage.total += usage.total

    return {
      content: result.text,
      toolCalls,
      usage,
      latency,
    }
  }

  /**
   * Add a tool definition with mock implementation
   */
  addTool(tool: ToolDefinition): void {
    this.tools.push(tool)
    this.toolsChanged = true
  }

  /**
   * Set mock response for an existing tool
   */
  mockTool(name: string, mockFn: (args: Record<string, unknown>) => unknown): void {
    const tool = this.tools.find((t) => t.name === name)
    if (tool) {
      tool.execute = mockFn
      this.toolsChanged = true
    } else {
      throw new Error(`Tool not found: ${name}`)
    }
  }

  /**
   * Get conversation history
   */
  history(): ModelMessage[] {
    return [...this.messages]
  }

  /**
   * Get session statistics
   */
  stats(): { messageCount: number; usage: TokenUsage } {
    return {
      messageCount: this.messages.length,
      usage: { ...this.totalUsage },
    }
  }

  /**
   * Export full transcript for analysis
   */
  export(): Transcript {
    return {
      sessionId: this.id,
      model: this.model,
      system: this.system,
      messages: [...this.messages],
      totalUsage: { ...this.totalUsage },
      createdAt: this.createdAt,
    }
  }

  /**
   * Get session state for persistence
   */
  getState(): SessionState {
    return {
      id: this.id,
      createdAt: this.createdAt,
      messages: [...this.messages],
      totalUsage: { ...this.totalUsage },
    }
  }

  /**
   * Clear conversation history (keep system prompt and tools)
   */
  clear(): void {
    this.messages = []
    this.totalUsage = { input: 0, output: 0, total: 0 }
  }
}
