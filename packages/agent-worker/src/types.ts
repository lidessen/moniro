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
  /** Model identifier (e.g., 'openai/gpt-5.2' or 'anthropic:claude-sonnet-4-5') */
  model: string
  /** System prompt */
  system: string
  /** Tool definitions with mock implementations */
  tools?: ToolDefinition[]
  /** Maximum tokens for response (default: 4096) */
  maxTokens?: number
  /** Maximum tool call steps per turn (default: 10) */
  maxSteps?: number
}

/**
 * Persisted session state for restoration
 */
export interface SessionState {
  /** Session ID to restore */
  id: string
  /** Creation timestamp */
  createdAt: string
  /** Conversation messages */
  messages: ModelMessage[]
  /** Accumulated token usage */
  totalUsage: TokenUsage
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
