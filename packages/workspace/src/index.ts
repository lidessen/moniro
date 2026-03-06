/**
 * @moniro/workspace — Workspace orchestration layer.
 *
 * One-shot multi-agent orchestration: parse YAML, run agents with shared
 * context, collect results. No daemon needed.
 */

// ── Factory ─────────────────────────────────────────────────────
export {
  createMinimalRuntime,
  createWiredLoop,
  type Workspace,
  type RuntimeContext,
  type WiredLoopConfig,
} from "./factory.ts";

// ── Runner ──────────────────────────────────────────────────────
export { runWorkflow, runWorkflowWithLoops, shutdownLoops } from "./runner.ts";

// ── Parser ──────────────────────────────────────────────────────
export {
  parseWorkflowFile,
  validateWorkflow,
  parseWorkflowParams,
  formatParamHelp,
  getKickoffMentions,
  type ParseOptions,
} from "./parser.ts";
export type { AgentRegistryLike } from "./parser.ts";

// ── Types ───────────────────────────────────────────────────────
export type {
  WorkflowFile,
  WorkflowAgentDef,
  RefAgentEntry,
  InlineAgentEntry,
  AgentEntry,
  ParsedWorkflow,
  ResolvedWorkflowAgent,
  ResolvedContext,
  ResolvedFileContext,
  ResolvedMemoryContext,
  ParamDefinition,
  SetupTask,
  ValidationResult,
  ValidationError,
  AgentHandleRef,
  BridgeConfig,
} from "./types.ts";
export { isRefAgentEntry } from "./types.ts";

// ── Loop ────────────────────────────────────────────────────────
export {
  createAgentLoop,
  checkWorkflowIdle,
  isWorkflowComplete,
  buildWorkflowIdleState,
} from "./loop/loop.ts";
export type {
  AgentLoop,
  AgentLoopConfig,
  AgentState,
  AgentInstruction,
  InstructionPriority,
  InstructionSource,
  InstructionProgress,
  AgentRunContext,
  AgentRunResult,
  PersonalContext,
  WorkflowIdleState,
} from "./loop/types.ts";
export { LOOP_DEFAULTS } from "./loop/types.ts";

// ── Priority Queue ─────────────────────────────────────────────
export {
  InstructionQueue,
  generateInstructionId,
  classifyInboxPriority,
} from "./loop/priority-queue.ts";

// ── Prompt ──────────────────────────────────────────────────────
export {
  buildAgentPrompt,
  formatConversation,
  formatInbox,
  formatChannel,
  soulSection,
  memorySection,
  todoSection,
  thinThreadSection,
  type PromptSection,
  DEFAULT_SECTIONS,
} from "./loop/prompt.ts";

// ── Backend adapter ─────────────────────────────────────────────
export { getBackendByType, getBackendForModel } from "./loop/backend.ts";

// ── Send ────────────────────────────────────────────────────────
export { parseSendTarget, formatUserSender, sendToWorkflowChannel } from "./loop/send.ts";
export type { SendTargetType, ParsedSendTarget, SendResult } from "./loop/send.ts";

// ── Mock runner ─────────────────────────────────────────────────
export { runMockAgent } from "./loop/mock-runner.ts";

// ── SDK runner ──────────────────────────────────────────────────
export { runSdkAgent } from "./loop/sdk-runner.ts";

// ── MCP Config ──────────────────────────────────────────────────
export { generateWorkflowMCPConfig } from "./loop/mcp-config.ts";

// ── Channel Bridge ──────────────────────────────────────────────
export { ChannelBridge, type MessageFilter, type BridgeSendOptions, type ChannelAdapter } from "./context/bridge.ts";
export { TelegramAdapter, type TelegramAdapterConfig, createBridgeAdapters } from "./context/adapters/index.ts";

// ── Context (Shared) ────────────────────────────────────────────
export type { ContextProvider } from "./context/provider.ts";
export { ContextProviderImpl } from "./context/provider.ts";
export {
  FileContextProvider,
  createFileContextProvider,
  resolveContextDir,
  getDefaultContextDir,
} from "./context/file-provider.ts";
export { createMemoryContextProvider, MemoryContextProvider } from "./context/memory-provider.ts";
export type {
  ContextConfig,
  FileContextConfig,
  MemoryContextConfig,
  Message,
  InboxMessage,
  InboxState,
  EventKind,
  ToolCallData,
  ToolCallSource,
  Resource,
  ResourceType,
  ResourceResult,
  AgentStatus,
  FileProviderConfig,
} from "./context/types.ts";
export { CONTEXT_DEFAULTS, extractMentions, calculatePriority } from "./context/types.ts";
export { MemoryStorage, FileStorage } from "./context/storage.ts";
export type { StorageBackend } from "./context/storage.ts";

// ── Context Stores ──────────────────────────────────────────────
export { DefaultTimelineStore } from "./context/stores/index.ts";
export type {
  ChannelStore,
  InboxStore,
  DocumentStore,
  ResourceStore,
  StatusStore,
  EventSink,
  TimelineStore,
} from "./context/stores/index.ts";

// ── Context MCP Server ──────────────────────────────────────────
export { createContextMCPServer, type ContextMCPServerOptions } from "./context/mcp/server.ts";
export { runWithHttp, type HttpMCPServer } from "./context/http-transport.ts";

// ── Proposals ───────────────────────────────────────────────────
export {
  ProposalManager,
  createProposalManager,
  PROPOSAL_DEFAULTS,
  formatProposal,
  formatProposalList,
} from "./context/proposals.ts";
export type { ProposalManagerOptions, Proposal } from "./context/proposals.ts";

// ── Event Log ───────────────────────────────────────────────────
export { EventLog } from "./context/event-log.ts";

// ── Logger Factories (Workflow-layer) ───────────────────────────
export { createChannelLogger, createEventLogger, createConsoleSink } from "./logger.ts";
export type { ChannelLoggerConfig } from "./logger.ts";
// Re-export Logger types from @moniro/agent for convenience
export { createSilentLogger, formatArg } from "@moniro/agent-loop";
export type { Logger, LogLevel } from "@moniro/agent-loop";

// ── Display ─────────────────────────────────────────────────────
export { startChannelWatcher, createDisplayContext, formatChannelEntry } from "./display.ts";
export type { ChannelWatcher, ChannelWatcherConfig, DisplayContext } from "./display.ts";
export { startPrettyDisplay, showWorkflowSummary } from "./display-pretty.ts";
export type { PrettyDisplayConfig, PrettyDisplayWatcher } from "./display-pretty.ts";

// ── Schema ──────────────────────────────────────────────────────
export { WorkflowFileSchema } from "./schema.ts";

// ── Interpolation ───────────────────────────────────────────────
export {
  interpolate,
  hasVariables,
  extractVariables,
  createContext,
  evaluateCondition,
} from "./interpolate.ts";
export type { VariableContext } from "./interpolate.ts";

// ── Source ──────────────────────────────────────────────────────
export { resolveSource, isRemoteSource, parseGitHubRef } from "./source.ts";

// ── Layout ──────────────────────────────────────────────────────
export {
  calculateLayout,
  getWidth,
  padToWidth,
  getIndent,
  formatTime,
  resetTimeTracking,
  createGroupingState,
  shouldGroup,
  LAYOUT_PRESETS,
} from "./layout.ts";
export type { LayoutConfig, LayoutOptions, TimeFormat, GroupingState } from "./layout.ts";

// ── Personal Context (re-exported from @moniro/agent-worker) ────
export type { PersonalContextProvider, PersonalContext } from "@moniro/agent-worker";
export {
  createPersonalContextTools,
  soulSection as personalSoulSection,
  memorySection as personalMemorySection,
  todoSection as personalTodoSection,
  DEFAULT_PERSONAL_SECTIONS,
  assemblePersonalPrompt,
} from "@moniro/agent-worker";

// ── Tools ───────────────────────────────────────────────────────
export {
  createBashTool,
  createBashTools,
  createBashToolsFromDirectory,
  createBashToolsFromFiles,
} from "./tools/bash.ts";
export type { BashToolkit, BashToolsOptions, CreateBashToolOptions } from "./tools/bash.ts";
export { createFeedbackTool, FEEDBACK_PROMPT } from "./tools/feedback.ts";
export type { FeedbackEntry, FeedbackToolOptions, FeedbackToolResult } from "./tools/feedback.ts";
