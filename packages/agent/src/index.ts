/**
 * @moniro/agent — Agent execution layer.
 *
 * Pure execution: create an agent, send a message, get a response.
 * Zero orchestration, zero daemon knowledge.
 */

// ── Worker ──────────────────────────────────────────────────────
export { AgentWorker } from "./worker.ts";
export type { AgentWorkerConfig, SendOptions, StepInfo } from "./worker.ts";

// ── Types ───────────────────────────────────────────────────────
export type {
  ProviderConfig,
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
} from "./types.ts";

// ── Models ──────────────────────────────────────────────────────
export {
  createModel,
  createModelAsync,
  createModelWithProvider,
  isAutoProvider,
  resolveModelFallback,
  discoverProvider,
  resolveAutoModel,
  FRONTIER_MODELS,
  SUPPORTED_PROVIDERS,
  DEFAULT_PROVIDER,
  getDefaultModel,
} from "./models.ts";
export type { SupportedProvider } from "./models.ts";

// ── Logger ──────────────────────────────────────────────────────
export { createSilentLogger, formatArg } from "./logger.ts";
export type { Logger, LogLevel } from "./logger.ts";

// ── Schedule ────────────────────────────────────────────────────
export { resolveSchedule, parseDuration } from "./schedule.ts";
export type { ScheduleConfig, ResolvedSchedule } from "./schedule.ts";

// ── Cron ────────────────────────────────────────────────────────
export { parseCron, nextCronTime, msUntilNextCron } from "./cron.ts";
export type { CronFields } from "./cron.ts";

// ── Execution Runtime ──────────────────────────────────────────
export { ExecutionStateMachine, ExecutionSessionImpl, createExecutionSession } from "./execution/index.ts";
export type {
  ExecutionState,
  BackendCapabilities,
  ExecutionMessage,
  ExecutionConfig,
  ExecutionInput,
  ExecutionOutcome,
  ExecutionResult,
  WorkItem,
  BeforeStepContext,
  StepMutation,
  AfterStepContext,
  ExecutionHooks,
  ExecutionObserver,
  ExecutionSession,
  ExecutionSessionConfig,
} from "./execution/index.ts";

// ── Backends ────────────────────────────────────────────────────
export { createBackend, checkBackends, listBackends } from "./backends/index.ts";
export type { Backend, BackendType, BackendConfig, BackendResponse, BackendSendOptions } from "./backends/types.ts";
export type { BackendOptions } from "./backends/index.ts";
export {
  parseModel,
  normalizeBackendType,
  getModelForBackend,
  resolveModelAlias,
  BACKEND_DEFAULT_MODELS,
} from "./backends/model-maps.ts";
export { SdkBackend } from "./backends/sdk.ts";
export type { SdkBackendOptions } from "./backends/sdk.ts";
export { ClaudeCodeBackend } from "./backends/claude-code.ts";
export type { ClaudeCodeOptions } from "./backends/claude-code.ts";
export { CodexBackend } from "./backends/codex.ts";
export type { CodexOptions } from "./backends/codex.ts";
export { CursorBackend } from "./backends/cursor.ts";
export type { CursorOptions } from "./backends/cursor.ts";
export { OpenCodeBackend } from "./backends/opencode.ts";
export type { OpenCodeOptions } from "./backends/opencode.ts";
export { MockAIBackend, createMockBackend } from "./backends/mock.ts";
export { execWithIdleTimeout, IdleTimeoutError } from "./backends/idle-timeout.ts";
export type { StreamEvent, StreamParserCallbacks, EventAdapter } from "./backends/stream-json.ts";
export {
  formatEvent,
  claudeAdapter,
  codexAdapter,
  extractClaudeResult,
  extractCodexResult,
  createStreamParser,
} from "./backends/stream-json.ts";
export { opencodeAdapter, extractOpenCodeResult } from "./backends/opencode.ts";

// ── AI SDK Re-exports (for worker layer) ────────────────────────
export { ToolLoopAgent, stepCountIs, type ModelMessage } from "ai";

// ── Tool Infrastructure ─────────────────────────────────────────
export { createTool } from "./tools/create-tool.ts";

// ── Skills ──────────────────────────────────────────────────────
export { createSkillTool } from "./skills/index.ts";
export type {
  CreateSkillToolOptions,
  DiscoveredSkill,
  Skill,
  SkillMetadata,
  SkillToolkit,
} from "./skills/index.ts";
export { SkillImporter } from "./skills/importer.ts";
export type { ImportedSkill } from "./skills/importer.ts";
export { parseImportSpec, buildGitUrl, getSpecDisplayName } from "./skills/import-spec.ts";
export type { ImportSpec, GitProvider } from "./skills/import-spec.ts";

// ── Agent Definition ────────────────────────────────────────────
export type {
  AgentDefinition,
  AgentSoul,
  AgentPromptConfig,
  AgentContextConfig,
} from "./definition.ts";
export {
  CONTEXT_SUBDIRS,
  AgentSoulSchema,
  AgentPromptConfigSchema,
  AgentContextConfigSchema,
  AgentDefinitionSchema,
} from "./definition.ts";
