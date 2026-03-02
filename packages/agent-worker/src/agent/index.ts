// Agent: re-export from @moniro/agent for moved items
export {
  AgentWorker,
  createModel,
  createModelAsync,
  FRONTIER_MODELS,
  SUPPORTED_PROVIDERS,
  DEFAULT_PROVIDER,
  getDefaultModel,
  CONTEXT_SUBDIRS,
  AgentDefinitionSchema,
  AgentSoulSchema,
  AgentPromptConfigSchema,
  AgentContextConfigSchema,
  ConversationLog,
  ThinThread,
  DEFAULT_THIN_THREAD_SIZE,
  formatConversationMessages,
} from "@moniro/agent";
export type {
  SendOptions,
  StepInfo,
  SupportedProvider,
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
  AgentDefinition,
  AgentSoul,
  AgentPromptConfig,
  AgentContextConfig,
  ConversationMessage,
} from "@moniro/agent";

// System-layer files that remain in agent-worker
export { AgentHandle } from "./agent-handle.ts";
export type { AgentHandleState } from "./agent-handle.ts";
export { AgentRegistry } from "./agent-registry.ts";
export {
  parseAgentFile,
  parseAgentObject,
  discoverAgents,
  serializeAgent,
  AGENTS_DIR,
} from "./yaml-parser.ts";
