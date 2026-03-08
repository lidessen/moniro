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

// ── Models (public: discovery & resolution only) ─────────────────
// createModel/createModelAsync/createModelWithProvider are internal
// to SDK runtime — not part of the public API.
export {
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

// ── Loop ──────────────────────────────────────────────────────
export { ExecutionStateMachine, LoopImpl, createLoop } from "./loop/index.ts";
export type {
  ExecutionState,
  RuntimeCapabilities,
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
  Loop,
  LoopConfig,
} from "./loop/index.ts";

// ── Runtimes ────────────────────────────────────────────────────
export { createRuntime, checkRuntimes, listRuntimes } from "./runtimes/index.ts";
export type { Runtime, RuntimeType, RuntimeConfig, RuntimeResponse, RuntimeSendOptions } from "./runtimes/types.ts";
export type { RuntimeOptions } from "./runtimes/index.ts";
export {
  parseModel,
  normalizeRuntimeType,
  getModelForRuntime,
  resolveModelAlias,
  RUNTIME_DEFAULT_MODELS,
} from "./runtimes/model-maps.ts";
export { SdkRuntime } from "./runtimes/sdk.ts";
export type { SdkRuntimeOptions } from "./runtimes/sdk.ts";
export { ClaudeCodeRuntime } from "./runtimes/claude-code.ts";
export type { ClaudeCodeOptions } from "./runtimes/claude-code.ts";
export { CodexRuntime } from "./runtimes/codex.ts";
export type { CodexOptions } from "./runtimes/codex.ts";
export { CursorRuntime } from "./runtimes/cursor.ts";
export type { CursorOptions } from "./runtimes/cursor.ts";
export { OpenCodeRuntime } from "./runtimes/opencode.ts";
export type { OpenCodeOptions } from "./runtimes/opencode.ts";
export { MockRuntime, createMockRuntime } from "./runtimes/mock.ts";
export { execWithIdleTimeout, IdleTimeoutError } from "./runtimes/idle-timeout.ts";
export type { StreamEvent, StreamParserCallbacks, EventAdapter } from "./runtimes/stream-json.ts";
export {
  formatEvent,
  claudeAdapter,
  codexAdapter,
  extractClaudeResult,
  extractCodexResult,
  createStreamParser,
} from "./runtimes/stream-json.ts";
export { opencodeAdapter, extractOpenCodeResult } from "./runtimes/opencode.ts";

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
