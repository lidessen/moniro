import type { ModelMessage } from 'ai'

/**
 * Tool definition with optional mock implementation
 */
export interface ToolDefinition {
  name: string
  description: string
  parameters: {
    type: 'object'
    properties: Record<string, unknown>
    required?: string[]
  }
  /** Mock function - returns controlled response for testing */
  execute?: (args: Record<string, unknown>) => unknown | Promise<unknown>
}

/**
 * A single tool call with its result
 */
export interface ToolCall {
  name: string
  arguments: Record<string, unknown>
  result: unknown
  timing: number
}

/**
 * Token usage statistics
 */
export interface TokenUsage {
  input: number
  output: number
  total: number
}

/**
 * Response from a single message exchange
 */
export interface AgentResponse {
  /** Final text content */
  content: string
  /** All tool calls made during this turn */
  toolCalls: ToolCall[]
  /** Token usage */
  usage: TokenUsage
  /** Response latency in ms */
  latency: number
}

/**
 * Session configuration
 */
export interface SessionConfig {
  /** Model identifier (e.g., 'anthropic:claude-3-5-sonnet') */
  model: string
  /** System prompt */
  system: string
  /** Tool definitions with mock implementations */
  tools?: ToolDefinition[]
  /** Maximum tokens for response */
  maxTokens?: number
}

/**
 * Exported transcript for analysis
 */
export interface Transcript {
  sessionId: string
  model: string
  system: string
  messages: ModelMessage[]
  totalUsage: TokenUsage
  createdAt: string
}
