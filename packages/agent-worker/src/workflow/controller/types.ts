/**
 * Agent Controller Types
 * Types for agent lifecycle management and backend abstraction
 */

import type { ResolvedAgent } from '../types.ts'
import type { ContextProvider } from '../../context/provider.ts'
import type { Message, InboxMessage } from '../../context/types.ts'
import type { Backend } from '../../backends/types.ts'

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
  /** MCP HTTP URL for tool access */
  mcpUrl: string
  /** Workspace directory for this agent (isolated from project) */
  workspaceDir: string
  /** Project directory (the actual codebase to work on) */
  projectDir: string
  /** Poll interval in ms (default: 5000) */
  pollInterval?: number
  /** Retry configuration */
  retry?: RetryConfig
  /** Backend to use for running the agent */
  backend: Backend
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
  /** Recent channel messages (for context) */
  recentChannel: Message[]
  /** Current document content (entry point) */
  documentContent: string
  /** MCP HTTP URL */
  mcpUrl: string
  /** Workspace directory for this agent (isolated from project) */
  workspaceDir: string
  /** Project directory (the actual codebase to work on) */
  projectDir: string
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
