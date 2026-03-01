/**
 * Agent Loop Types
 * Types for agent lifecycle management and backend abstraction
 */

import type { ResolvedWorkflowAgent } from "../types.ts";
import type { ContextProvider } from "../context/provider.ts";
import type { Message, InboxMessage } from "../context/types.ts";
import type { Backend } from "@/backends/types.ts";
import type { ConversationMessage, ConversationLog, ThinThread } from "../../agent/conversation.ts";

// ==================== Agent Loop ====================

/** Agent loop state */
export type AgentState = "idle" | "running" | "stopped";

/** Agent loop interface */
export interface AgentLoop {
  /** Agent name */
  readonly name: string;

  /** Current state */
  readonly state: AgentState;

  /** Whether any run exhausted all retries without success */
  readonly hasFailures: boolean;

  /** Last error message from a failed run (if hasFailures is true) */
  readonly lastError: string | undefined;

  /** Start the loop (begin polling) */
  start(): Promise<void>;

  /** Stop the loop */
  stop(): Promise<void>;

  /** Interrupt: immediately check inbox (skip poll wait) */
  wake(): void;

  /**
   * Direct send — synchronous request-response mode.
   *
   * Bypasses the poll loop: writes message to channel, immediately runs the
   * agent, writes response to channel, and returns the result.
   *
   * Used by the daemon for `POST /run` and `POST /serve` on standalone agents
   * that live inside a 1-agent workflow. This gives them full context
   * infrastructure (channel, MCP tools) while preserving request-response UX.
   *
   * Can be called regardless of loop state (idle or stopped).
   * If the poll loop is running, it won't interfere — sendDirect acquires
   * a logical lock so the two paths don't race.
   */
  sendDirect(message: string): Promise<AgentRunResult>;
}

/** Retry configuration */
export interface RetryConfig {
  /** Maximum number of retry attempts (default: 3) */
  maxAttempts?: number;
  /** Initial backoff delay in ms (default: 1000) */
  backoffMs?: number;
  /** Backoff multiplier (default: 2) */
  backoffMultiplier?: number;
}

/** Agent loop configuration */
export interface AgentLoopConfig {
  /** Agent name */
  name: string;
  /** Resolved agent definition */
  agent: ResolvedWorkflowAgent;
  /** Context provider for channel/document access */
  contextProvider: ContextProvider;
  /** Unified event log */
  eventLog?: import("../context/event-log.ts").EventLog;
  /** MCP HTTP URL for tool access */
  mcpUrl: string;
  /** Workspace directory for this agent (isolated from project) */
  workspaceDir: string;
  /** Project directory (the actual codebase to work on) */
  projectDir: string;
  /** Poll interval in ms (default: 5000) */
  pollInterval?: number;
  /** Retry configuration */
  retry?: RetryConfig;
  /** Backend to use for running the agent */
  backend: Backend;
  /** Callback when agent run completes */
  onRunComplete?: (result: AgentRunResult) => void;
  /** Log function (debug level — only shown with --debug) */
  log?: (message: string) => void;
  /** Info log function (always shown — for key lifecycle events) */
  infoLog?: (message: string) => void;
  /** Error log function (always shown — for failures, missing API keys, etc.) */
  errorLog?: (message: string) => void;
  /** Enable feedback tool in agent prompts */
  feedback?: boolean;
  /** Conversation log for persistence (absent for workflow agents) */
  conversationLog?: ConversationLog;
  /** Thin thread for bounded conversation context (absent for workflow agents) */
  thinThread?: ThinThread;
}

// ==================== Agent Run ====================

/** Context passed to agent for a run */
export interface AgentRunContext {
  /** Agent name */
  name: string;
  /** Agent config */
  agent: ResolvedWorkflowAgent;
  /** Unread inbox messages */
  inbox: InboxMessage[];
  /** Recent channel messages (for context) */
  recentChannel: Message[];
  /** Current document content (entry point) */
  documentContent: string;
  /** MCP HTTP URL */
  mcpUrl: string;
  /** Workspace directory for this agent (isolated from project) */
  workspaceDir: string;
  /** Project directory (the actual codebase to work on) */
  projectDir: string;
  /** Retry attempt number (1 = first try, 2+ = retry) */
  retryAttempt: number;
  /** Context provider (for channel access) */
  provider: import("../context/provider.ts").ContextProvider;
  /** Unified event log (for recording tool calls, etc.) */
  eventLog?: import("../context/event-log.ts").EventLog;
  /** Whether feedback tool is enabled */
  feedback?: boolean;
  /** Recent conversation messages (thin thread for continuity) */
  thinThread?: ConversationMessage[];
}

/** Result of an agent run */
export interface AgentRunResult {
  /** Whether the run succeeded */
  success: boolean;
  /** Error message if failed */
  error?: string;
  /** Duration in ms */
  duration: number;
  /** Agent text response (SDK backends only — CLI backends handle output via tools) */
  content?: string;
  /** Number of steps (SDK/mock backends) */
  steps?: number;
  /** Number of tool calls (SDK/mock backends) */
  toolCalls?: number;
}

// ==================== Idle Detection ====================

/** Workflow idle state for run mode exit detection */
export interface WorkflowIdleState {
  /** All loops are idle */
  allLoopsIdle: boolean;
  /** No unread inbox messages for any agent */
  noUnreadMessages: boolean;
  /** No active/pending proposals */
  noActiveProposals: boolean;
  /** Idle debounce period has elapsed */
  idleDebounceElapsed: boolean;
}

// ==================== Defaults ====================

/** Default loop configuration values */
export const LOOP_DEFAULTS = {
  pollInterval: 5000,
  retry: {
    maxAttempts: 3,
    backoffMs: 1000,
    backoffMultiplier: 2,
  },
  recentChannelLimit: 50,
  idleDebounceMs: 2000,
} as const;
