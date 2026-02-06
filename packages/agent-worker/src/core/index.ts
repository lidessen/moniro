// Core domain re-exports
export { AgentSession, type SendOptions, type StepInfo } from './session.ts'
export {
  createModel,
  createModelAsync,
  FRONTIER_MODELS,
  SUPPORTED_PROVIDERS,
  DEFAULT_PROVIDER,
  getDefaultModel,
} from './models.ts'
export type { SupportedProvider } from './models.ts'
export { createTools } from './tools.ts'
export type {
  AgentMessage,
  AgentResponse,
  MessageStatus,
  PendingApproval,
  SessionConfig,
  SessionState,
  ToolCall,
  ToolDefinition,
  TokenUsage,
  Transcript,
} from './types.ts'
export {
  getModelForBackend,
  parseModel,
  resolveModelAlias,
  BACKEND_DEFAULT_MODELS,
  SDK_MODEL_ALIASES,
  CURSOR_MODEL_MAP,
  CLAUDE_MODEL_MAP,
  CODEX_MODEL_MAP,
} from './model-maps.ts'
export type { BackendType, ParsedModel } from './model-maps.ts'
