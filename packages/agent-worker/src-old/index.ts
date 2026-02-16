export {
  AgentWorker,
  AgentWorker as AgentSession, // deprecated alias
  type AgentWorkerConfig,
  type AgentWorkerConfig as AgentSessionConfig, // deprecated alias
  type SendOptions,
  type StepInfo,
} from "./agent/worker.ts";
export {
  createModel,
  createModelAsync,
  FRONTIER_MODELS,
  SUPPORTED_PROVIDERS,
} from "./agent/models.ts";
export {
  createBashTool,
  createBashTools,
  createBashToolsFromDirectory,
  createBashToolsFromFiles,
} from "./agent/tools/bash.ts";
export { createFeedbackTool, FEEDBACK_PROMPT } from "./agent/tools/feedback.ts";
export {
  createBackend,
  checkBackends,
  listBackends,
  ClaudeCodeBackend,
  CodexBackend,
  CursorBackend,
  SdkBackend,
  MockAIBackend,
  createMockBackend,
} from "./backends/index.ts";
export {
  SkillsProvider,
  createSkillsTool,
  SkillImporter,
  parseImportSpec,
  buildGitUrl,
  getSpecDisplayName,
  type SkillMetadata,
  type ImportedSkill,
  type ImportSpec,
  type GitProvider,
} from "./agent/skills/index.ts";
export type { SupportedProvider } from "./agent/models.ts";
export type { BashToolkit, BashToolsOptions, CreateBashToolOptions } from "./agent/tools/bash.ts";
export type {
  FeedbackEntry,
  FeedbackToolOptions,
  FeedbackToolResult,
} from "./agent/tools/feedback.ts";
export type {
  Backend,
  BackendType,
  BackendConfig,
  BackendResponse,
  BackendOptions,
  ClaudeCodeOptions,
  CodexOptions,
  CursorOptions,
  SdkBackendOptions,
} from "./backends/index.ts";
export type {
  AgentMessage,
  AgentResponse,
  ApprovalCheck,
  MessageStatus,
  PendingApproval,
  SessionConfig,
  SessionState,
  ToolCall,
  ToolInfo,
  TokenUsage,
  Transcript,
} from "./agent/types.ts";
