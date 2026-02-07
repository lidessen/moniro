/**
 * Message status for streaming/response tracking
 */
export type MessageStatus = 'responding' | 'complete'

/**
 * Extended message with status for tracking streaming state
 */
export interface AgentMessage {
  role: 'user' | 'assistant' | 'system' | 'tool'
  content: string
  /** Message status - 'responding' while streaming, 'complete' when done */
  status?: MessageStatus
  /** Timestamp when message started */
  timestamp?: string
}

/**
 * Approval check — static boolean or dynamic function
 */
export type ApprovalCheck = boolean | ((args: Record<string, unknown>) => boolean)

/**
 * Tool info returned by getTools() — read-only view
 */
export interface ToolInfo {
  name: string
  description?: string
  needsApproval: boolean
}

/**
 * A pending tool call awaiting user approval
 */
export interface PendingApproval {
  /** Unique approval ID */
  id: string
  /** Tool name */
  toolName: string
  /** Tool call ID from the model */
  toolCallId: string
  /** Arguments passed to the tool */
  arguments: Record<string, unknown>
  /** When the approval was requested */
  requestedAt: string
  /** Current status */
  status: 'pending' | 'approved' | 'denied'
  /** Denial reason if denied */
  denyReason?: string
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
  /** Tool calls awaiting approval (response is incomplete until approved) */
  pendingApprovals: PendingApproval[]
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
  /** AI SDK tools — Record<name, tool()> */
  tools?: Record<string, unknown>
  /** Per-tool approval config — Record<name, boolean | (args) => boolean> */
  approval?: Record<string, ApprovalCheck>
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
  /** Conversation messages with status */
  messages: AgentMessage[]
  /** Accumulated token usage */
  totalUsage: TokenUsage
  /** Pending tool approvals */
  pendingApprovals: PendingApproval[]
}

/**
 * Exported transcript for analysis
 */
export interface Transcript {
  sessionId: string
  model: string
  system: string
  messages: AgentMessage[]
  totalUsage: TokenUsage
  createdAt: string
}
