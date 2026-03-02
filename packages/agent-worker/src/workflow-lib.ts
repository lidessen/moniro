/**
 * @moniro/workflow barrel — Workflow layer public API.
 *
 * One-shot multi-agent orchestration. Parse YAML, run agents with shared context.
 * No daemon needed.
 *
 * Boundary validation: This file should import ONLY from:
 *   - workflow/ (all subdirectories)
 *   - agent-lib exports (agent/, backends/) — downward dependency OK
 * It must NOT import from daemon/ or cli/.
 *
 * Known violations (to fix in package extraction):
 *   - workflow/types.ts imports AgentHandle from agent/ (System-layer type)
 *   - workflow/parser.ts imports AgentRegistry from agent/ (System-layer type)
 *   These are Workflow → System dependencies that will be resolved with
 *   interface extraction when packages are physically split.
 */

// ── Factory ─────────────────────────────────────────────────────
export {
  createMinimalRuntime,
  createWiredLoop,
  type Workspace,
  type RuntimeContext,
  type WiredLoopConfig,
} from "./workflow/factory.ts";

// ── Runner ──────────────────────────────────────────────────────
export {
  runWorkflow,
  runWorkflowWithLoops,
  shutdownLoops,
} from "./workflow/runner.ts";

// ── Parser ──────────────────────────────────────────────────────
export {
  parseWorkflowString,
  parseWorkflowFile,
  resolveWorkflowRef,
  validateWorkflowFile,
} from "./workflow/parser.ts";

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
} from "./workflow/types.ts";
export { isRefAgentEntry } from "./workflow/types.ts";

// ── Loop ────────────────────────────────────────────────────────
export { createAgentLoop } from "./workflow/loop/loop.ts";
export type {
  AgentLoop,
  AgentLoopConfig,
  AgentState,
  AgentRunContext,
  AgentRunResult,
  WorkflowIdleState,
} from "./workflow/loop/types.ts";
export { LOOP_DEFAULTS } from "./workflow/loop/types.ts";

// ── Prompt ──────────────────────────────────────────────────────
export {
  buildAgentPrompt,
  type PromptSection,
  DEFAULT_SECTIONS,
} from "./workflow/loop/prompt.ts";

// ── Backend adapter ─────────────────────────────────────────────
export { resolveBackend } from "./workflow/loop/backend.ts";

// ── MCP Config ──────────────────────────────────────────────────
export { generateWorkflowMCPConfig } from "./workflow/loop/mcp-config.ts";

// ── Context (Shared) ────────────────────────────────────────────
export type { ContextProvider } from "./workflow/context/provider.ts";
export { ContextProviderImpl } from "./workflow/context/provider.ts";
export { FileContextProvider, resolveContextDir } from "./workflow/context/file-provider.ts";
export { createMemoryContextProvider } from "./workflow/context/memory-provider.ts";
export type {
  ContextConfig,
  FileContextConfig,
  MemoryContextConfig,
  Message,
  ChannelEntry,
  InboxEntry,
  EventKind,
} from "./workflow/context/types.ts";
export type { StorageBackend } from "./workflow/context/storage.ts";

// ── Context Stores ──────────────────────────────────────────────
export type {
  ChannelStore,
  InboxStore,
  DocumentStore,
  ResourceStore,
  StatusStore,
  EventSink,
  TimelineStore,
} from "./workflow/context/stores/index.ts";

// ── Context MCP Server ──────────────────────────────────────────
export {
  createContextMCPServer,
  type ContextMCPServerOptions,
} from "./workflow/context/mcp/server.ts";

// ── Proposals ───────────────────────────────────────────────────
export { ProposalManagerImpl } from "./workflow/context/proposals.ts";
export type { ProposalManager } from "./workflow/context/proposals.ts";

// ── Event Log ───────────────────────────────────────────────────
export { EventLog } from "./workflow/context/event-log.ts";

// ── Logger Factories (Workflow-layer) ───────────────────────────
export { createChannelLogger, createEventLogger, createConsoleSink } from "./workflow/logger.ts";
export type { ChannelLoggerConfig } from "./workflow/logger.ts";

// ── Display ─────────────────────────────────────────────────────
export { ChannelWatcher } from "./workflow/display.ts";
export type { DisplayConfig } from "./workflow/display.ts";

// ── Schema ──────────────────────────────────────────────────────
export { WorkflowFileSchema } from "./workflow/schema.ts";

// ── Interpolation ───────────────────────────────────────────────
export { interpolateTemplate } from "./workflow/interpolate.ts";
