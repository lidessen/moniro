/**
 * agent-worker — public API
 */

// Shared types
export type {
  Message,
  InboxMessage,
  AgentConfig,
  AgentState,
  AgentStatus,
  Workflow,
  WorkflowState,
  Resource,
  ResourceType,
  Proposal,
  ProposalType,
  ProposalStatus,
  Vote,
  WorkerConfig,
  SessionResult,
  DocumentProvider,
} from "./shared/types.ts";

export { extractMentions, calculatePriority } from "./shared/types.ts";
export { TOOLS, DEFAULT_WORKFLOW, DEFAULT_TAG } from "./shared/constants.ts";

// Daemon
export { startDaemon, type DaemonOptions, type DaemonHandle } from "./daemon/index.ts";
