/**
 * Shared types — used across daemon, worker, and interface layers.
 *
 * These are the data types, not implementation. Each layer imports
 * from here and never from another layer's internals.
 */

// ==================== Messages ====================

/** Event kinds for channel messages */
export type EventKind = "message" | "tool_call" | "system" | "output" | "debug";

/** Tool call source */
export type ToolCallSource = "mcp" | "sdk" | "backend";

/** Tool call metadata (when kind='tool_call') */
export interface ToolCallData {
  name: string;
  args: string;
  source: ToolCallSource;
}

/** A structured message in the channel */
export interface Message {
  id: string;
  workflow: string;
  tag: string;
  sender: string;
  content: string;
  /** @mentions parsed at write time by daemon */
  recipients: string[];
  kind: EventKind;
  /** DM target — if set, only visible to sender and target */
  to?: string;
  /** Tool call metadata */
  toolCall?: ToolCallData;
  /** Extra metadata (JSON) */
  metadata?: Record<string, unknown>;
  createdAt: number;
}

/** Inbox message with priority */
export interface InboxMessage {
  message: Message;
  priority: "normal" | "high";
}

// ==================== Agents ====================

/** Agent state */
export type AgentState = "idle" | "running" | "stopped";

/** Agent configuration (stored in registry) */
export interface AgentConfig {
  name: string;
  model: string;
  backend: string;
  system?: string;
  workflow: string;
  tag: string;
  schedule?: string;
  /** Extra config: MCP servers, tools, etc. */
  configJson?: Record<string, unknown>;
  state: AgentState;
  createdAt: number;
}

/** Agent status for coordination */
export interface AgentStatus {
  state: AgentState;
  task?: string;
  startedAt?: string;
  lastUpdate: string;
  metadata?: Record<string, unknown>;
}

// ==================== Workflows ====================

/** Workflow state */
export type WorkflowState = "running" | "stopped";

/** Workflow record */
export interface Workflow {
  name: string;
  tag: string;
  configYaml?: string;
  state: WorkflowState;
  createdAt: number;
}

// ==================== Resources ====================

/** Resource content types */
export type ResourceType = "markdown" | "json" | "text" | "diff";

/** A stored resource */
export interface Resource {
  id: string;
  workflow: string;
  tag: string;
  content: string;
  type: ResourceType;
  createdBy: string;
  createdAt: number;
}

/** Resource constants */
export const RESOURCE_PREFIX = "res_";
export const RESOURCE_THRESHOLD = 1200;

// ==================== Proposals ====================

/** Proposal types */
export type ProposalType = "election" | "decision" | "approval" | "assignment";

/** Resolution strategy */
export type ResolutionStrategy = "plurality" | "majority" | "unanimous";

/** Proposal status */
export type ProposalStatus = "active" | "resolved" | "expired" | "cancelled";

/** A proposal for collaborative decision-making */
export interface Proposal {
  id: string;
  workflow: string;
  tag: string;
  type: ProposalType;
  title: string;
  options: string[];
  resolution: ResolutionStrategy;
  binding: boolean;
  status: ProposalStatus;
  creator: string;
  result?: string;
  createdAt: number;
  resolvedAt?: number;
}

/** A vote on a proposal */
export interface Vote {
  proposalId: string;
  agent: string;
  choice: string;
  reason?: string;
  createdAt: number;
}

// ==================== Worker Protocol ====================

/** Config passed to worker subprocess via env */
export interface WorkerConfig {
  agent: {
    name: string;
    model: string;
    backend: string;
    system?: string;
    /** Provider config from workflow YAML (api_key, base_url) */
    provider?: { name?: string; apiKey?: string; baseUrl?: string };
  };
  daemonMcpUrl: string;
  workerMcpConfigs?: McpServerConfig[];
  workflow: string;
  tag: string;
}

/** MCP server config for worker */
export interface McpServerConfig {
  name: string;
  command: string;
  args?: string[];
  env?: Record<string, string>;
}

/** IPC messages between daemon and worker */
export type WorkerIpcMessage =
  | { type: "heartbeat" }
  | { type: "result"; data: SessionResult }
  | { type: "error"; error: string };

/** Result from a worker session */
export interface SessionResult {
  content: string;
  toolCalls?: Array<{ name: string; arguments: unknown; result: unknown }>;
  usage?: { input: number; output: number; total: number };
}

// ==================== @mention Parsing ====================

const MENTION_PATTERN = /@([a-zA-Z][a-zA-Z0-9_-]*)/g;

/** Extract @mentions from content, filtered to known agents */
export function extractMentions(content: string, validAgents: string[]): string[] {
  const mentions: string[] = [];
  MENTION_PATTERN.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = MENTION_PATTERN.exec(content)) !== null) {
    const agent = match[1];
    if (agent && validAgents.includes(agent) && !mentions.includes(agent)) {
      mentions.push(agent);
    }
  }
  return mentions;
}

/** Urgent keyword pattern */
const URGENT_PATTERN = /\b(urgent|asap|blocked|critical)\b/i;

/** Calculate priority for an inbox message */
export function calculatePriority(msg: Message): "normal" | "high" {
  if (msg.recipients.length > 1) return "high";
  if (URGENT_PATTERN.test(msg.content)) return "high";
  return "normal";
}

// ==================== Documents ====================

/** Document provider interface — pluggable storage for workspace files */
export interface DocumentProvider {
  read(workflow: string, tag: string, path: string): Promise<string | null>;
  write(workflow: string, tag: string, path: string, content: string): Promise<void>;
  append(workflow: string, tag: string, path: string, content: string): Promise<void>;
  list(workflow: string, tag: string): Promise<string[]>;
  create(workflow: string, tag: string, path: string, content: string): Promise<void>;
}
