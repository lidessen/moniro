/**
 * Backend types for different AI execution engines
 */

// Re-export model maps from canonical source
export {
  type BackendType,
  BACKEND_DEFAULT_MODELS,
  SDK_MODEL_ALIASES,
  CURSOR_MODEL_MAP,
  CLAUDE_MODEL_MAP,
  CODEX_MODEL_MAP,
  getModelForBackend,
} from '../core/model-maps.ts'

import type { BackendType } from '../core/model-maps.ts'

export interface BackendConfig {
  type: BackendType
  /** Model identifier (interpretation depends on backend) */
  model?: string
  /** Additional CLI flags or SDK options */
  options?: Record<string, unknown>
}

export interface BackendResponse {
  content: string
  /** Tool calls made during execution (if supported) */
  toolCalls?: Array<{
    name: string
    arguments: unknown
    result: unknown
  }>
  /** Usage statistics (if available) */
  usage?: {
    input: number
    output: number
    total: number
  }
}

export interface Backend {
  readonly type: BackendType
  /** Send a message and get a response */
  send(message: string, options?: { system?: string }): Promise<BackendResponse>
  /** Check if the backend is available (CLI installed, API key set, etc.) */
  isAvailable?(): Promise<boolean>
  /** Get backend info for display */
  getInfo?(): { name: string; version?: string; model?: string }
  /** Set up workspace directory with MCP config for workflow isolation */
  setWorkspace?(workspaceDir: string, mcpConfig: { mcpServers: Record<string, unknown> }): void
}
