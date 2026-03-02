/**
 * @moniro/agent barrel — Agent layer public API.
 *
 * Pure execution layer. Zero orchestration, zero daemon knowledge.
 * Use this to create an agent, send a message, get a response.
 *
 * Boundary validation: This file should import ONLY from:
 *   - agent/ (worker, models, types, tools/, skills/, logger, schedule, cron, conversation, definition)
 *   - backends/
 * It must NOT import from workflow/ or daemon/ or cli/.
 */

// ── Worker ──────────────────────────────────────────────────────
export { AgentWorker } from "./agent/worker.ts";
export type { AgentWorkerConfig, SendOptions, StepInfo } from "./agent/worker.ts";

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
} from "./agent/types.ts";

// ── Models ──────────────────────────────────────────────────────
export {
  createModel,
  createModelAsync,
  createModelWithProvider,
  isAutoProvider,
  resolveModelFallback,
  FRONTIER_MODELS,
  SUPPORTED_PROVIDERS,
  DEFAULT_PROVIDER,
  getDefaultModel,
} from "./agent/models.ts";

// ── Logger ──────────────────────────────────────────────────────
export { createSilentLogger, formatArg } from "./agent/logger.ts";
export type { Logger, LogLevel } from "./agent/logger.ts";

// ── Schedule ────────────────────────────────────────────────────
export { resolveSchedule, parseDuration } from "./agent/schedule.ts";
export type { ScheduleConfig, ResolvedSchedule } from "./agent/schedule.ts";

// ── Cron ────────────────────────────────────────────────────────
export { parseCron, nextCronTime, msUntilNextCron } from "./agent/cron.ts";
export type { CronFields } from "./agent/cron.ts";

// ── Backends ────────────────────────────────────────────────────
export { createBackend, checkBackends, listBackends } from "./backends/index.ts";
export type { Backend, BackendType, BackendConfig, BackendResponse } from "./backends/types.ts";
export { SdkBackend } from "./backends/sdk.ts";
export { ClaudeCodeBackend } from "./backends/claude-code.ts";
export { CodexBackend } from "./backends/codex.ts";
export { CursorBackend } from "./backends/cursor.ts";
export { OpenCodeBackend } from "./backends/opencode.ts";
export { MockAIBackend, createMockBackend } from "./backends/mock.ts";
export { execWithIdleTimeout, IdleTimeoutError } from "./backends/idle-timeout.ts";
export type { StreamEvent, StreamParserCallbacks, EventAdapter } from "./backends/stream-json.ts";
export { formatEvent, claudeAdapter, codexAdapter, createStreamParser } from "./backends/stream-json.ts";

// ── Tool Infrastructure ─────────────────────────────────────────
export { createTool } from "./agent/tools/create-tool.ts";

// ── Skills ──────────────────────────────────────────────────────
export { SkillsProvider } from "./agent/skills/provider.ts";
export type { SkillMetadata } from "./agent/skills/provider.ts";
export { createSkillsTool } from "./agent/skills/index.ts";
export { SkillImporter } from "./agent/skills/importer.ts";
export type { ImportedSkill } from "./agent/skills/importer.ts";
export { parseImportSpec, buildGitUrl, getSpecDisplayName } from "./agent/skills/import-spec.ts";
export type { ImportSpec, GitProvider } from "./agent/skills/import-spec.ts";

// ── Agent Definition ────────────────────────────────────────────
export type {
  AgentDefinition,
  AgentSoul,
  AgentPromptConfig,
  AgentContextConfig,
} from "./agent/definition.ts";
export {
  CONTEXT_SUBDIRS,
  AgentSoulSchema,
  AgentPromptConfigSchema,
  AgentContextConfigSchema,
  AgentDefinitionSchema,
} from "./agent/definition.ts";

// ── Conversation (Personal Context) ─────────────────────────────
export type { ConversationMessage } from "./agent/conversation.ts";
export {
  ConversationLog,
  ThinThread,
  DEFAULT_THIN_THREAD_SIZE,
  formatConversationMessages,
} from "./agent/conversation.ts";
