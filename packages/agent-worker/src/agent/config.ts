/**
 * AgentConfig — Pure data describing what an agent is.
 *
 * Owned by the daemon's registry. No behavior, no state.
 * Separates identity/configuration from execution and conversation state.
 */

import type { BackendType } from "../backends/types.ts";
import type { ProviderConfig } from "../workflow/types.ts";

export interface AgentConfig {
  /** Agent name (unique within daemon) */
  name: string;
  /** Model identifier (e.g., 'anthropic/claude-sonnet-4-5' or just 'MiniMax-M2.5' when provider is set) */
  model: string;
  /** System prompt */
  system: string;
  /** Backend type */
  backend: BackendType;
  /** Provider configuration — string (built-in) or object (custom endpoint) */
  provider?: string | ProviderConfig;
  /** Workflow this agent belongs to */
  workflow: string;
  /** Workflow instance tag */
  tag: string;
  /** When this agent was created */
  createdAt: string;
}
