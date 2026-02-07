import { ToolLoopAgent, stepCountIs, type ModelMessage } from 'ai'
import { createModelAsync } from './models.ts'
import { createTools } from './tools/convert.ts'
import type {
  AgentMessage,
  AgentResponse,
  PendingApproval,
  SessionConfig,
  SessionState,
  ToolCall,
  ToolDefinition,
  TokenUsage,
  Transcript,
} from './types.ts'
import type { Backend } from '../backends/types.ts'

/**
 * Extended session config that supports both SDK and CLI backends.
 * When a backend is provided, send() delegates to it instead of ToolLoopAgent.
 * This enables unified session management regardless of backend type.
 */
export interface AgentSessionConfig extends SessionConfig {
  /** CLI backend - when provided, send() delegates to this backend */
  backend?: Backend
}

/**
 * Step finish callback info
 */
export interface StepInfo {
  stepNumber: number
  toolCalls: ToolCall[]
  usage: TokenUsage
}

/**
 * Options for send() method
 */
export interface SendOptions {
  /** Auto-approve all tool calls that require approval (default: true) */
  autoApprove?: boolean
  /** Callback after each agent step */
  onStepFinish?: (info: StepInfo) => void | Promise<void>
}

/**
 * AgentSession - Stateful session for controlled agent testing
 *
 * Uses ToolLoopAgent internally for multi-step reasoning loops.
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
  private messages: AgentMessage[] = []
  private totalUsage: TokenUsage = { input: 0, output: 0, total: 0 }
  private pendingApprovals: PendingApproval[] = []

  // CLI backend (null for SDK sessions)
  private backend: Backend | null

  // Cached agent instance (rebuilt when tools change) - SDK only
  private cachedAgent: ToolLoopAgent | null = null
  private toolsChanged = false

  /**
   * Whether this session supports tool management (SDK backend only)
   */
  get supportsTools(): boolean {
    return this.backend === null
  }

  /**
   * Convert AgentMessage[] to ModelMessage[] for AI SDK
   */
  private toModelMessages(): ModelMessage[] {
    return this.messages
      .filter((m) => m.status !== 'responding') // Exclude incomplete messages
      .map((m) => ({ role: m.role, content: m.content })) as ModelMessage[]
  }

  constructor(config: AgentSessionConfig, restore?: SessionState) {
    // Restore from saved state or create new
    if (restore) {
      this.id = restore.id
      this.createdAt = restore.createdAt
      this.messages = [...restore.messages]
      this.totalUsage = { ...restore.totalUsage }
      this.pendingApprovals = [...(restore.pendingApprovals ?? [])]
    } else {
      this.id = crypto.randomUUID()
      this.createdAt = new Date().toISOString()
    }

    this.model = config.model
    this.system = config.system
    this.tools = config.tools ?? []
    this.maxTokens = config.maxTokens ?? 4096
    this.maxSteps = config.maxSteps ?? 10
    this.backend = config.backend ?? null
  }

  /**
   * Check if a tool needs approval for given arguments
   */
  private toolNeedsApproval(tool: ToolDefinition, args: Record<string, unknown>): boolean {
    if (!tool.needsApproval) return false
    if (typeof tool.needsApproval === 'function') {
      return tool.needsApproval(args)
    }
    return tool.needsApproval
  }

  /**
   * Build tools with approval handling
   */
  private buildTools(autoApprove: boolean): ReturnType<typeof createTools> | undefined {
    if (this.tools.length === 0) return undefined

    // Wrap tools to handle approval
    const wrappedTools = this.tools.map((tool) => ({
      ...tool,
      execute: async (args: Record<string, unknown>) => {
        // Check if approval is needed
        if (!autoApprove && this.toolNeedsApproval(tool, args)) {
          // Create pending approval
          const approval: PendingApproval = {
            id: crypto.randomUUID(),
            toolName: tool.name,
            toolCallId: crypto.randomUUID(),
            arguments: args,
            requestedAt: new Date().toISOString(),
            status: 'pending',
          }
          this.pendingApprovals.push(approval)
          return { __approvalRequired: true, approvalId: approval.id }
        }
        // Execute normally
        if (tool.execute) {
          return tool.execute(args)
        }
        // Return static mock response if set
        if (tool.mockResponse !== undefined) {
          return tool.mockResponse
        }
        return { error: 'No mock implementation provided' }
      },
    }))
    return createTools(wrappedTools)
  }

  /**
   * Get or create cached agent, rebuild if tools changed
   */
  private async getAgent(autoApprove: boolean): Promise<ToolLoopAgent> {
    if (!this.cachedAgent || this.toolsChanged || !autoApprove) {
      const model = await createModelAsync(this.model)
      this.cachedAgent = new ToolLoopAgent({
        model,
        instructions: this.system,
        tools: this.buildTools(autoApprove),
        maxOutputTokens: this.maxTokens,
        stopWhen: stepCountIs(this.maxSteps),
      })
      if (autoApprove) {
        this.toolsChanged = false
      }
    }
    return this.cachedAgent
  }

  /**
   * Send a message via CLI backend (non-SDK path)
   * Delegates to backend.send() and manages history/usage uniformly
   */
  private async sendViaBackend(content: string): Promise<AgentResponse> {
    const startTime = performance.now()
    const timestamp = new Date().toISOString()

    // Add user message to history
    this.messages.push({ role: 'user', content, status: 'complete', timestamp })

    const result = await this.backend!.send(content, { system: this.system })
    const latency = Math.round(performance.now() - startTime)

    // Add assistant response to history
    this.messages.push({
      role: 'assistant',
      content: result.content,
      status: 'complete',
      timestamp: new Date().toISOString(),
    })

    // Track usage if backend provides it
    const usage: TokenUsage = {
      input: result.usage?.input ?? 0,
      output: result.usage?.output ?? 0,
      total: result.usage?.total ?? 0,
    }
    this.totalUsage.input += usage.input
    this.totalUsage.output += usage.output
    this.totalUsage.total += usage.total

    // Map backend tool calls to ToolCall format
    const toolCalls: ToolCall[] = (result.toolCalls ?? []).map((tc) => ({
      name: tc.name,
      arguments: tc.arguments as Record<string, unknown>,
      result: tc.result,
      timing: 0,
    }))

    return {
      content: result.content,
      toolCalls,
      pendingApprovals: [],
      usage,
      latency,
    }
  }

  /**
   * Send a message and get the agent's response
   * Conversation state is maintained across calls
   *
   * @param content - The message to send
   * @param options - Send options (autoApprove, onStepFinish, etc.)
   */
  async send(content: string, options: SendOptions = {}): Promise<AgentResponse> {
    // CLI backend: delegate to backend.send()
    if (this.backend) {
      return this.sendViaBackend(content)
    }

    // SDK backend: use ToolLoopAgent
    const { autoApprove = true, onStepFinish } = options
    const startTime = performance.now()
    const timestamp = new Date().toISOString()

    // Add user message to history
    this.messages.push({ role: 'user', content, status: 'complete', timestamp })

    const agent = await this.getAgent(autoApprove)

    // Track tool calls across steps
    const allToolCalls: ToolCall[] = []
    let stepNumber = 0

    const result = await agent.generate({
      messages: this.toModelMessages(),
      onStepFinish: async ({ usage, toolCalls, toolResults }) => {
        stepNumber++

        // Build tool calls for this step
        const stepToolCalls: ToolCall[] = []
        if (toolCalls) {
          for (const tc of toolCalls) {
            const toolResult = toolResults?.find((tr) => tr.toolCallId === tc.toolCallId)
            const toolCall: ToolCall = {
              name: tc.toolName,
              arguments: tc.input as Record<string, unknown>,
              result: toolResult?.output ?? null,
              timing: 0,
            }
            stepToolCalls.push(toolCall)
            allToolCalls.push(toolCall)
          }
        }

        // Call user's callback if provided
        if (onStepFinish) {
          const stepUsage: TokenUsage = {
            input: usage?.inputTokens ?? 0,
            output: usage?.outputTokens ?? 0,
            total: (usage?.inputTokens ?? 0) + (usage?.outputTokens ?? 0),
          }
          await onStepFinish({ stepNumber, toolCalls: stepToolCalls, usage: stepUsage })
        }
      },
    })

    const latency = Math.round(performance.now() - startTime)

    // Add assistant response to history (complete)
    this.messages.push({
      role: 'assistant',
      content: result.text,
      status: 'complete',
      timestamp: new Date().toISOString(),
    })

    // Update usage
    const usage: TokenUsage = {
      input: result.usage?.inputTokens ?? 0,
      output: result.usage?.outputTokens ?? 0,
      total: (result.usage?.inputTokens ?? 0) + (result.usage?.outputTokens ?? 0),
    }
    this.totalUsage.input += usage.input
    this.totalUsage.output += usage.output
    this.totalUsage.total += usage.total

    // Get pending approvals created during this send
    const currentPending = this.pendingApprovals.filter((p) => p.status === 'pending')

    return {
      content: result.text,
      toolCalls: allToolCalls,
      pendingApprovals: currentPending,
      usage,
      latency,
    }
  }

  /**
   * Send a message and stream the response
   * Returns an async iterable of text chunks
   *
   * For CLI backends, falls back to non-streaming: calls send() and yields
   * the full response as a single chunk.
   *
   * @param content - The message to send
   * @param options - Send options (autoApprove, onStepFinish, etc.)
   */
  async *sendStream(
    content: string,
    options: SendOptions = {}
  ): AsyncGenerator<string, AgentResponse, unknown> {
    // CLI backends: fall back to non-streaming
    if (this.backend) {
      const response = await this.sendViaBackend(content)
      yield response.content
      return response
    }

    // SDK backend: full streaming support
    const { autoApprove = true, onStepFinish } = options
    const startTime = performance.now()
    const timestamp = new Date().toISOString()

    // Add user message to history
    this.messages.push({ role: 'user', content, status: 'complete', timestamp })

    // Add assistant message with 'responding' status immediately
    // This allows other observers to see the message is in progress
    const assistantMsg: AgentMessage = {
      role: 'assistant',
      content: '',
      status: 'responding',
      timestamp: new Date().toISOString(),
    }
    this.messages.push(assistantMsg)

    const agent = await this.getAgent(autoApprove)

    // Track tool calls across steps
    const allToolCalls: ToolCall[] = []
    let stepNumber = 0

    const result = await agent.stream({
      messages: this.toModelMessages(),
      onStepFinish: async ({ usage, toolCalls, toolResults }) => {
        stepNumber++

        const stepToolCalls: ToolCall[] = []
        if (toolCalls) {
          for (const tc of toolCalls) {
            const toolResult = toolResults?.find((tr) => tr.toolCallId === tc.toolCallId)
            const toolCall: ToolCall = {
              name: tc.toolName,
              arguments: tc.input as Record<string, unknown>,
              result: toolResult?.output ?? null,
              timing: 0,
            }
            stepToolCalls.push(toolCall)
            allToolCalls.push(toolCall)
          }
        }

        if (onStepFinish) {
          const stepUsage: TokenUsage = {
            input: usage?.inputTokens ?? 0,
            output: usage?.outputTokens ?? 0,
            total: (usage?.inputTokens ?? 0) + (usage?.outputTokens ?? 0),
          }
          await onStepFinish({ stepNumber, toolCalls: stepToolCalls, usage: stepUsage })
        }
      },
    })

    // Stream text chunks and update assistant message in real-time
    for await (const chunk of result.textStream) {
      assistantMsg.content += chunk
      yield chunk
    }

    const latency = Math.round(performance.now() - startTime)

    // Get final text and mark as complete
    const text = await result.text
    assistantMsg.content = text
    assistantMsg.status = 'complete'

    // Update usage
    const finalUsage = await result.usage
    const usage: TokenUsage = {
      input: finalUsage?.inputTokens ?? 0,
      output: finalUsage?.outputTokens ?? 0,
      total: (finalUsage?.inputTokens ?? 0) + (finalUsage?.outputTokens ?? 0),
    }
    this.totalUsage.input += usage.input
    this.totalUsage.output += usage.output
    this.totalUsage.total += usage.total

    const currentPending = this.pendingApprovals.filter((p) => p.status === 'pending')

    return {
      content: text,
      toolCalls: allToolCalls,
      pendingApprovals: currentPending,
      usage,
      latency,
    }
  }

  /**
   * Add a tool definition with mock implementation
   * Only supported for SDK backends (ToolLoopAgent)
   */
  addTool(tool: ToolDefinition): void {
    if (this.backend) {
      throw new Error('Tool management not supported for CLI backends')
    }
    this.tools.push(tool)
    this.toolsChanged = true
    this.cachedAgent = null // Force rebuild
  }

  /**
   * Set mock response for an existing tool
   * Only supported for SDK backends
   */
  mockTool(name: string, mockFn: (args: Record<string, unknown>) => unknown): void {
    if (this.backend) {
      throw new Error('Tool management not supported for CLI backends')
    }
    const tool = this.tools.find((t) => t.name === name)
    if (tool) {
      tool.execute = mockFn
      this.toolsChanged = true
      this.cachedAgent = null // Force rebuild
    } else {
      throw new Error(`Tool not found: ${name}`)
    }
  }

  /**
   * Get current tool definitions (without execute functions)
   */
  getTools(): ToolDefinition[] {
    return this.tools.map((t) => ({
      name: t.name,
      description: t.description,
      parameters: t.parameters,
      needsApproval: t.needsApproval,
      mockResponse: t.mockResponse,
    }))
  }

  /**
   * Set a static mock response for an existing tool (JSON-serializable)
   * Only supported for SDK backends
   */
  setMockResponse(name: string, response: unknown): void {
    if (this.backend) {
      throw new Error('Tool management not supported for CLI backends')
    }
    const tool = this.tools.find((t) => t.name === name)
    if (tool) {
      tool.mockResponse = response
      this.toolsChanged = true
      this.cachedAgent = null // Force rebuild
    } else {
      throw new Error(`Tool not found: ${name}`)
    }
  }

  /**
   * Get conversation history with status information
   * Messages with status 'responding' are still being generated
   */
  history(): AgentMessage[] {
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
      pendingApprovals: [...this.pendingApprovals],
    }
  }

  /**
   * Get all pending approvals
   */
  getPendingApprovals(): PendingApproval[] {
    return this.pendingApprovals.filter((p) => p.status === 'pending')
  }

  /**
   * Approve a pending tool call and execute it
   * @returns The tool execution result
   */
  async approve(approvalId: string): Promise<unknown> {
    const approval = this.pendingApprovals.find((p) => p.id === approvalId)
    if (!approval) {
      throw new Error(`Approval not found: ${approvalId}`)
    }
    if (approval.status !== 'pending') {
      throw new Error(`Approval already ${approval.status}: ${approvalId}`)
    }

    // Find the tool
    const tool = this.tools.find((t) => t.name === approval.toolName)
    if (!tool) {
      throw new Error(`Tool not found: ${approval.toolName}`)
    }

    // Execute the tool
    let result: unknown
    if (tool.execute) {
      result = await tool.execute(approval.arguments)
    } else {
      result = { error: 'No mock implementation provided' }
    }

    // Update approval status
    approval.status = 'approved'

    return result
  }

  /**
   * Deny a pending tool call
   * @param approvalId - The approval ID to deny
   * @param reason - Optional reason for denial
   */
  deny(approvalId: string, reason?: string): void {
    const approval = this.pendingApprovals.find((p) => p.id === approvalId)
    if (!approval) {
      throw new Error(`Approval not found: ${approvalId}`)
    }
    if (approval.status !== 'pending') {
      throw new Error(`Approval already ${approval.status}: ${approvalId}`)
    }

    approval.status = 'denied'
    approval.denyReason = reason
  }

  /**
   * Clear conversation history (keep system prompt and tools)
   */
  clear(): void {
    this.messages = []
    this.totalUsage = { input: 0, output: 0, total: 0 }
    this.pendingApprovals = []
  }
}
