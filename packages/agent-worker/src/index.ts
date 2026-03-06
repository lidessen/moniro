/**
 * agent-worker — System layer public API.
 *
 * Persistent daemon service. Long-running agents with identity, conversation
 * history, scheduled wakeups, priority queues.
 *
 * Depends on @moniro/agent-loop (Worker) and @moniro/workspace (Orchestration).
 *
 * For agent execution, import from @moniro/agent-loop.
 * For workspace orchestration, import from @moniro/workspace.
 */

// ── Daemon ──────────────────────────────────────────────────────
export { startDaemon } from "./daemon/daemon.ts";
export type { DaemonState, WorkflowHandle } from "./daemon/daemon.ts";

// ── Discovery ───────────────────────────────────────────────────
export {
  DEFAULT_PORT,
  readDaemonInfo,
  writeDaemonInfo,
  removeDaemonInfo,
  isDaemonRunning,
} from "./daemon/registry.ts";
export type { DaemonInfo } from "./daemon/registry.ts";

// ── Workspace Registry ──────────────────────────────────────────
export { WorkspaceRegistry } from "./daemon/workspace-registry.ts";

// ── Event Log (Daemon) ──────────────────────────────────────────
export { DaemonEventLog } from "./daemon/event-log.ts";

// ── Agent Handle (System-layer persistence) ─────────────────────
export { AgentHandle } from "./agent/agent-handle.ts";
export type { AgentHandleState } from "./agent/agent-handle.ts";

// ── Agent Registry (System-layer discovery) ─────────────────────
export { AgentRegistry } from "./agent/agent-registry.ts";

// ── Agent Config (daemon runtime) ───────────────────────────────
export type { AgentConfig } from "./agent/config.ts";

// ── Agent YAML Parser ───────────────────────────────────────────
export {
  parseAgentFile,
  parseAgentObject,
  discoverAgents,
  serializeAgent,
  AGENTS_DIR,
} from "./agent/yaml-parser.ts";

// ── State Store ─────────────────────────────────────────────────
export type { StateStore } from "./agent/store.ts";
export { MemoryStateStore } from "./agent/store.ts";

// ── Worker Handle (execution contract) ──────────────────────────
export { LocalWorker } from "./agent/handle.ts";
export type { WorkerHandle } from "./agent/handle.ts";

// ── Backwards-compat re-exports from @moniro/agent ──────────────
export {
  AgentWorker,
  createModel,
  createModelAsync,
  FRONTIER_MODELS,
  SUPPORTED_PROVIDERS,
  createBackend,
  checkBackends,
  listBackends,
  ClaudeCodeBackend,
  CodexBackend,
  CursorBackend,
  SdkBackend,
  MockAIBackend,
  createMockBackend,
  SkillsProvider,
  createSkillsTool,
  SkillImporter,
  parseImportSpec,
  buildGitUrl,
  getSpecDisplayName,
} from "@moniro/agent-loop";
export type {
  AgentWorkerConfig,
  SendOptions,
  StepInfo,
  SupportedProvider,
  Backend,
  BackendType,
  BackendConfig,
  BackendResponse,
  BackendOptions,
  ClaudeCodeOptions,
  CodexOptions,
  CursorOptions,
  SdkBackendOptions,
  SkillMetadata,
  ImportedSkill,
  ImportSpec,
  GitProvider,
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
} from "@moniro/agent-loop";

// ── Re-exports from @moniro/agent-worker (personal agent layer) ──
export {
  createPersonalContextTools,
  soulSection as personalSoulSection,
  memorySection as personalMemorySection,
  todoSection as personalTodoSection,
  DEFAULT_PERSONAL_SECTIONS,
  assemblePersonalPrompt,
  createBashTool,
  createBashTools,
  createBashToolsFromDirectory,
  createBashToolsFromFiles,
} from "@moniro/agent-worker";
export type {
  PersonalContextProvider,
  PersonalContext,
  PersonalPromptContext,
  PersonalPromptSection,
  BashToolkit,
  BashToolsOptions,
  CreateBashToolOptions,
} from "@moniro/agent-worker";

// ── Backwards-compat re-exports from @moniro/workflow ────────────
export {
  createFeedbackTool,
  FEEDBACK_PROMPT,
} from "@moniro/workspace";
export type {
  FeedbackEntry,
  FeedbackToolOptions,
  FeedbackToolResult,
} from "@moniro/workspace";
