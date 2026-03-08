/**
 * Agent session — worker-level session model.
 *
 * Provides: AgentSession (state + activation loop),
 * ExecutionAdapter (checkpoint-based execution),
 * AgentFeature (composable capabilities).
 */

// ── Types ──────────────────────────────────────────────────────
export type {
  InputEnvelope,
  RuntimeSignal,
  ActivationProgress,
  AgentSessionState,
  WaitingState,
  ActivationSnapshot,
  ActivationSummary,
  ActivationOutcome,
  BatchPolicy,
  Checkpoint,
  CheckpointDecision,
  ExecutionAdapterCapabilities,
  ExecutionAdapterHooks,
  ExecutionAdapter,
} from "./types.ts";

// ── Feature ────────────────────────────────────────────────────
export type {
  AgentFeature,
  FeatureContext,
  ActivationContext,
  CheckpointContext,
  PromptSection,
  McpToolSpec,
} from "./feature.ts";

// ── Adapter ────────────────────────────────────────────────────
export { createExecutionAdapter } from "./adapter.ts";
export type { ExecutionAdapterConfig } from "./adapter.ts";

// ── Session ────────────────────────────────────────────────────
export { AgentSession } from "./session.ts";
export type { AgentSessionConfig } from "./session.ts";

// ── Features ──────────────────────────────────────────────────
export { conversation } from "./features/index.ts";
export type { ConversationFeatureConfig } from "./features/index.ts";

// ── Input Abstractions ───────────────────────────────────────
export type { InboxSource } from "./features/index.ts";
