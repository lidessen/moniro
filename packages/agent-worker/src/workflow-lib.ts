/**
 * @moniro/workflow barrel — Re-exports from @moniro/workflow.
 *
 * This file preserves backwards compatibility for internal imports.
 * All exports now come from the extracted @moniro/workflow package.
 */

export {
  // Factory
  createMinimalRuntime,
  createWiredLoop,
  type Workspace,
  type RuntimeContext,
  type WiredLoopConfig,

  // Runner
  runWorkflow,
  runWorkflowWithLoops,
  shutdownLoops,

  // Parser
  parseWorkflowFile,
  validateWorkflow,
  parseWorkflowParams,
  formatParamHelp,
  getKickoffMentions,
  type ParseOptions,
  type AgentRegistryLike,

  // Types
  isRefAgentEntry,
  type WorkflowFile,
  type WorkflowAgentDef,
  type RefAgentEntry,
  type InlineAgentEntry,
  type AgentEntry,
  type ParsedWorkflow,
  type ResolvedWorkflowAgent,
  type ResolvedContext,
  type ResolvedFileContext,
  type ResolvedMemoryContext,
  type ParamDefinition,
  type SetupTask,
  type ValidationResult,
  type ValidationError,
  type AgentHandleRef,

  // Loop
  createAgentLoop,
  LOOP_DEFAULTS,
  type AgentLoop,
  type AgentLoopConfig,
  type AgentState,
  type AgentRunContext,
  type AgentRunResult,
  type WorkflowIdleState,

  // Prompt
  buildAgentPrompt,
  formatConversation,
  thinThreadSection,
  DEFAULT_SECTIONS,
  type PromptSection,

  // Backend adapter
  getBackendByType,
  getBackendForModel,

  // Send
  parseSendTarget,
  formatUserSender,
  type SendTargetType,
  type ParsedSendTarget,
  type SendResult,

  // MCP Config
  generateWorkflowMCPConfig,

  // Context
  ContextProviderImpl,
  FileContextProvider,
  createFileContextProvider,
  resolveContextDir,
  getDefaultContextDir,
  createMemoryContextProvider,
  CONTEXT_DEFAULTS,
  type ContextProvider,
  type ContextConfig,
  type FileContextConfig,
  type MemoryContextConfig,
  type Message,
  type InboxMessage,
  type InboxState,
  type EventKind,
  type StorageBackend,

  // Context Stores
  type ChannelStore,
  type InboxStore,
  type DocumentStore,
  type ResourceStore,
  type StatusStore,
  type EventSink,
  type TimelineStore,

  // Context MCP Server
  createContextMCPServer,
  type ContextMCPServerOptions,
  runWithHttp,
  type HttpMCPServer,

  // Proposals
  ProposalManager,
  createProposalManager,
  PROPOSAL_DEFAULTS,
  type ProposalManagerOptions,

  // Event Log
  EventLog,

  // Logger
  createChannelLogger,
  createEventLogger,
  createConsoleSink,
  createSilentLogger,
  formatArg,
  type ChannelLoggerConfig,
  type Logger,
  type LogLevel,

  // Display
  startChannelWatcher,
  createDisplayContext,
  formatChannelEntry,
  type ChannelWatcher,
  type ChannelWatcherConfig,
  type DisplayContext,

  // Schema
  WorkflowFileSchema,

  // Interpolation
  interpolate,
  hasVariables,
  extractVariables,
  createContext,
  type VariableContext,

  // Source
  resolveSource,
  isRemoteSource,
  parseGitHubRef,

  // Layout
  calculateLayout,
  getWidth,
  padToWidth,
  getIndent,
  formatTime,
  resetTimeTracking,
  createGroupingState,
  shouldGroup,
  LAYOUT_PRESETS,
  type LayoutConfig,
  type LayoutOptions,
  type TimeFormat,
  type GroupingState,

  // Tools
  createBashTool,
  createBashTools,
  createBashToolsFromDirectory,
  createBashToolsFromFiles,
  createFeedbackTool,
  FEEDBACK_PROMPT,
  type BashToolkit,
  type BashToolsOptions,
  type CreateBashToolOptions,
  type FeedbackEntry,
  type FeedbackToolOptions,
  type FeedbackToolResult,
} from "@moniro/workflow";
