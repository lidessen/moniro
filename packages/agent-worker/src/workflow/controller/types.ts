/**
 * Agent Controller Types
 * Types for agent lifecycle management and backend abstraction
 */

import type { ResolvedAgent } from '../types.ts'
import type { ContextProvider } from '../context/provider.ts'
import type { Message, InboxMessage } from '../context/types.ts'

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

/** Backend type */
export type BackendType = 'sdk' | 'claude' | 'cursor' | 'codex' | 'mock'

/** Parsed model information */
export interface ParsedModel {
  /** Provider name (anthropic, claude, codex, etc.) */
  provider: string
  /** Model identifier */
  model: string
}

/** Default model per backend */
export const BACKEND_DEFAULT_MODELS: Record<BackendType, string> = {
  mock: 'mock-model',
  sdk: 'claude-sonnet-4-5',
  claude: 'sonnet',
  cursor: 'sonnet-4.5',
  codex: 'gpt-5.2-codex',
}

/** Model aliases for SDK (Anthropic format) */
export const SDK_MODEL_ALIASES: Record<string, string> = {
  sonnet: 'claude-sonnet-4-5-20250514',
  opus: 'claude-opus-4-20250514',
  haiku: 'claude-haiku-3-5-20250514',
  'claude-sonnet-4-5': 'claude-sonnet-4-5-20250514',
  'claude-opus-4': 'claude-opus-4-20250514',
  'claude-haiku-3-5': 'claude-haiku-3-5-20250514',
}

/**
 * Model translation for Cursor backend
 * Cursor uses its own naming convention
 */
export const CURSOR_MODEL_MAP: Record<string, string> = {
  // Anthropic models
  sonnet: 'sonnet-4.5',
  opus: 'opus-4.5',
  'sonnet-4.5': 'sonnet-4.5',
  'opus-4.5': 'opus-4.5',
  'opus-4.6': 'opus-4.6',
  'claude-sonnet-4-5': 'sonnet-4.5',
  'claude-opus-4-5': 'opus-4.5',
  'anthropic/claude-sonnet-4-5': 'sonnet-4.5',
  'anthropic/claude-opus-4-5': 'opus-4.5',
  // OpenAI/GPT models
  'gpt-5.2': 'gpt-5.2',
  'gpt-5.1': 'gpt-5.1-high',
  'gpt-4': 'gpt-5.2',
  // Gemini
  'gemini-pro': 'gemini-3-pro',
  'gemini-flash': 'gemini-3-flash',
  // Special
  auto: 'auto',
}

/**
 * Model translation for Claude CLI backend
 * Claude CLI uses short model names
 */
export const CLAUDE_MODEL_MAP: Record<string, string> = {
  sonnet: 'sonnet',
  opus: 'opus',
  haiku: 'haiku',
  'sonnet-4.5': 'sonnet',
  'opus-4.5': 'opus',
  'claude-sonnet-4-5': 'sonnet',
  'claude-opus-4': 'opus',
  'claude-haiku-3-5': 'haiku',
  'anthropic/claude-sonnet-4-5': 'sonnet',
  'anthropic/claude-opus-4': 'opus',
}

/**
 * Model translation for Codex CLI backend
 */
export const CODEX_MODEL_MAP: Record<string, string> = {
  'gpt-5.2-codex': 'gpt-5.2-codex',
  'gpt-5.2': 'gpt-5.2-codex',
  o3: 'o3',
  'o3-mini': 'o3-mini',
}

/**
 * Get the model name for a specific backend
 * Translates generic model names to backend-specific format
 */
export function getModelForBackend(model: string | undefined, backend: BackendType): string {
  // Use default if no model specified
  if (!model) {
    return BACKEND_DEFAULT_MODELS[backend]
  }

  // Strip provider prefix if present (e.g., "anthropic/claude-sonnet-4-5" -> "claude-sonnet-4-5")
  const normalizedModel = model.includes('/') ? model.split('/').pop()! : model

  switch (backend) {
    case 'sdk':
      return SDK_MODEL_ALIASES[normalizedModel] || normalizedModel

    case 'cursor':
      return CURSOR_MODEL_MAP[model] || CURSOR_MODEL_MAP[normalizedModel] || normalizedModel

    case 'claude':
      return CLAUDE_MODEL_MAP[model] || CLAUDE_MODEL_MAP[normalizedModel] || normalizedModel

    case 'codex':
      return CODEX_MODEL_MAP[model] || CODEX_MODEL_MAP[normalizedModel] || normalizedModel

    default:
      return normalizedModel
  }
}

/**
 * Parse model string to provider and version (legacy, for SDK backend)
 * Format: provider/model-name or just model-name (defaults to anthropic)
 */
export function parseModel(model: string): ParsedModel {
  const parts = model.split('/')
  if (parts.length === 2) {
    return {
      provider: parts[0]!,
      model: SDK_MODEL_ALIASES[parts[1]!] || parts[1]!,
    }
  }
  return {
    provider: 'anthropic',
    model: SDK_MODEL_ALIASES[model] || model,
  }
}

/**
 * Resolve model alias to specific version (for SDK backend)
 */
export function resolveModelAlias(model: string): string {
  return SDK_MODEL_ALIASES[model] || model
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
