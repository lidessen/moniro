/**
 * @moniro/agent-worker — Personal agent layer.
 *
 * Makes an execution loop into a "person" with identity, memory, and tools.
 * Does not depend on workspace/collaboration — personal agents run independently.
 *
 * Depends on @moniro/agent (Agent Loop) for execution primitives.
 */

// ── Personal Context ────────────────────────────────────────────
export type { PersonalContextProvider, PersonalContext } from "./context/types.ts";
export { createPersonalContextTools } from "./context/tools.ts";

// ── Prompt Assembly ─────────────────────────────────────────────
export type { PersonalPromptContext, PersonalPromptSection } from "./prompt/types.ts";
export {
  soulSection,
  memorySection,
  todoSection,
  DEFAULT_PERSONAL_SECTIONS,
  assemblePersonalPrompt,
} from "./prompt/sections.ts";

// ── Bash Tools ──────────────────────────────────────────────────
export {
  createBashTool,
  createBashTools,
  createBashToolsFromDirectory,
  createBashToolsFromFiles,
} from "./tools/bash.ts";
export type { BashToolsOptions, BashToolkit, CreateBashToolOptions } from "./tools/bash.ts";

// ── Conversation (Personal Context) ────────────────────────────
export type { ConversationMessage } from "./conversation.ts";
export {
  ConversationLog,
  ThinThread,
  DEFAULT_THIN_THREAD_SIZE,
  formatConversationMessages,
} from "./conversation.ts";

// ── Session ────────────────────────────────────────────────────
export { AgentSession, createExecutionAdapter } from "./session/index.ts";
export type {
  AgentSessionConfig,
  AgentSessionState,
  AgentFeature,
  FeatureContext,
  ActivationContext,
  CheckpointContext,
  PromptSection,
  McpToolSpec,
  InputEnvelope,
  RuntimeSignal,
  ActivationSnapshot,
  ActivationSummary,
  ActivationOutcome,
  BatchPolicy,
  Checkpoint,
  CheckpointDecision,
  ExecutionAdapter,
  ExecutionAdapterConfig,
  ExecutionAdapterCapabilities,
  ExecutionAdapterHooks,
  WaitingState,
  ActivationProgress,
  ConversationFeatureConfig,
  InboxSource,
} from "./session/index.ts";
export { conversation } from "./session/index.ts";
