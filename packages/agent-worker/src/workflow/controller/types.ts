/**
 * Agent Controller Types
 * Types for agent lifecycle management and backend abstraction
 */

import type { ResolvedAgent } from '../types.ts'
import type { ContextProvider } from '../context/provider.ts'
import type { ChannelEntry, InboxMessage } from '../context/types.ts'

// ==================== Controller ====================

/** Agent controller state */
export type AgentState = 'idle' | 'running' | 'stopped'

/** Agent controller interface */
export interface AgentController {
  /** Agent name */
  readonly name: string

  /** Current state */
  readonly state: AgentState

  /** Start the controller (begin polling loop) */
  start(): Promise<void>

  /** Stop the controller */
  stop(): Promise<void>

  /** Interrupt: immediately check inbox (skip poll wait) */
  wake(): void
}

/** Retry configuration */
export interface RetryConfig {
  /** Maximum number of retry attempts (default: 3) */
  maxAttempts?: number
  /** Initial backoff delay in ms (default: 1000) */
  backoffMs?: number
  /** Backoff multiplier (default: 2) */
  backoffMultiplier?: number
}

/** Agent controller configuration */
export interface AgentControllerConfig {
  /** Agent name */
  name: string
  /** Resolved agent definition */
  agent: ResolvedAgent
  /** Context provider for channel/document access */
  contextProvider: ContextProvider
  /** MCP socket path for tool access */
  mcpSocketPath: string
  /** Poll interval in ms (default: 5000) */
  pollInterval?: number
  /** Retry configuration */
  retry?: RetryConfig
  /** Backend to use for running the agent */
  backend: AgentBackend
  /** Callback when agent run completes */
  onRunComplete?: (result: AgentRunResult) => void
  /** Log function */
  log?: (message: string) => void
}

// ==================== Agent Run ====================

/** Context passed to agent for a run */
export interface AgentRunContext {
  /** Agent name */
  name: string
  /** Agent config */
  agent: ResolvedAgent
  /** Unread inbox messages */
  inbox: InboxMessage[]
  /** Recent channel entries (for context) */
  recentChannel: ChannelEntry[]
  /** Current document content (entry point) */
  documentContent: string
  /** MCP socket path */
  mcpSocketPath: string
  /** Retry attempt number (1 = first try, 2+ = retry) */
  retryAttempt: number
}

/** Result of an agent run */
export interface AgentRunResult {
  /** Whether the run succeeded */
  success: boolean
  /** Error message if failed */
  error?: string
  /** Duration in ms */
  duration: number
}

// ==================== Backend ====================

/** Agent backend interface */
export interface AgentBackend {
  /** Backend name for identification */
  readonly name: string
  /** Run the agent with the given context */
  run(ctx: AgentRunContext): Promise<AgentRunResult>
}

// ==================== Idle Detection ====================

/** Workflow idle state for run mode exit detection */
export interface WorkflowIdleState {
  /** All controllers are idle */
  allControllersIdle: boolean
  /** No unread inbox messages for any agent */
  noUnreadMessages: boolean
  /** No active/pending proposals */
  noActiveProposals: boolean
  /** Idle debounce period has elapsed */
  idleDebounceElapsed: boolean
}

// ==================== Model Parsing ====================

/** Parsed model information */
export interface ParsedModel {
  /** Provider name (anthropic, claude, codex, etc.) */
  provider: string
  /** Model identifier */
  model: string
}

/** Model aliases for short names */
export const MODEL_ALIASES: Record<string, string> = {
  'claude-sonnet-4-5': 'claude-sonnet-4-5-20250514',
  'claude-opus-4': 'claude-opus-4-20250514',
  'claude-haiku-3-5': 'claude-haiku-3-5-20250514',
  'sonnet': 'claude-sonnet-4-5-20250514',
  'opus': 'claude-opus-4-20250514',
  'haiku': 'claude-haiku-3-5-20250514',
}

/**
 * Parse model string to provider and version
 * Format: provider/model-name or just model-name (defaults to anthropic)
 */
export function parseModel(model: string): ParsedModel {
  const parts = model.split('/')
  if (parts.length === 2) {
    return {
      provider: parts[0]!,
      model: resolveModelAlias(parts[1]!),
    }
  }
  return {
    provider: 'anthropic',
    model: resolveModelAlias(model),
  }
}

/**
 * Resolve model alias to specific version
 */
export function resolveModelAlias(model: string): string {
  return MODEL_ALIASES[model] || model
}

// ==================== Defaults ====================

/** Default controller configuration values */
export const CONTROLLER_DEFAULTS = {
  pollInterval: 5000,
  retry: {
    maxAttempts: 3,
    backoffMs: 1000,
    backoffMultiplier: 2,
  },
  recentChannelLimit: 50,
  idleDebounceMs: 2000,
} as const
