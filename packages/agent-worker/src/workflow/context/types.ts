/**
 * Context types for workflow
 * Shared context for agent collaboration via channel + document
 */

/** A single message in the channel (public, DM, or log) */
export interface Message {
  /** Unique message ID (nanoid) */
  id: string;
  /** ISO timestamp */
  timestamp: string;
  /** Author agent name or 'system' */
  from: string;
  /** Message content */
  content: string;
  /** Extracted @mentions */
  mentions: string[];
  /** DM recipient — if set, only visible to sender and recipient */
  to?: string;
  /** Entry kind — undefined = normal message, 'log' = operational log, 'debug' = debug detail, 'tool_call' = tool invocation */
  kind?: "log" | "debug" | "tool_call";
  /** Tool call metadata (only present when kind='tool_call') */
  toolCall?: {
    /** Tool name (e.g., 'channel_send', 'my_inbox') */
    name: string;
    /** Tool arguments as formatted string for display */
    args: string;
  };
}

// ==================== Resource System ====================
// General-purpose resource reference mechanism.
// Resources can be referenced from channel messages, documents, or anywhere
// via the `resource:<id>` URI scheme.

/** Resource metadata */
export interface Resource {
  /** Unique ID (e.g., res_abc123) */
  id: string;
  /** Content type hint */
  type: ResourceType;
  /** ISO timestamp of creation */
  createdAt: string;
  /** Agent who created the resource */
  createdBy: string;
}

/** Resource content types */
export type ResourceType = "markdown" | "json" | "text" | "diff";

/** Resource creation result */
export interface ResourceResult {
  /** Unique ID */
  id: string;
  /** Ready-to-use reference: resource:id */
  ref: string;
}

/** Resource ID prefix */
export const RESOURCE_PREFIX = "res_";

/** Resource URI scheme */
export const RESOURCE_SCHEME = "resource:";

/** Resources storage directory name */
export const RESOURCES_DIR = "resources";

/** Resource threshold in characters - content longer than this should use resources */
export const RESOURCE_THRESHOLD = 500;

/** Message length threshold for channel messages - content longer than this should use resources or documents */
export const MESSAGE_LENGTH_THRESHOLD = 1200;

/**
 * Generate a unique resource ID
 */
export function generateResourceId(): string {
  const timestamp = Date.now().toString(36);
  const random = Math.random().toString(36).slice(2, 8);
  return `${RESOURCE_PREFIX}${timestamp}${random}`;
}

/**
 * Create resource reference for use in markdown
 * Example: resource:res_abc123
 */
export function createResourceRef(id: string): string {
  return `${RESOURCE_SCHEME}${id}`;
}

/**
 * Parse resource reference from markdown link
 * Extracts ID from "resource:res_xxx" format
 */
export function parseResourceRef(ref: string): string | null {
  if (ref.startsWith(RESOURCE_SCHEME)) {
    return ref.slice(RESOURCE_SCHEME.length);
  }
  return null;
}

/**
 * Check if a string is a resource ID
 */
export function isResourceId(str: string): boolean {
  return str.startsWith(RESOURCE_PREFIX);
}

/**
 * Check if content should be stored as a resource instead of inline
 */
export function shouldUseResource(content: string): boolean {
  return content.length > MESSAGE_LENGTH_THRESHOLD;
}

// ==================== Agent Status ====================

/** Agent status information for coordination */
export interface AgentStatus {
  /** Agent state */
  state: "idle" | "running" | "stopped";
  /** Current task description (what the agent is working on) */
  task?: string;
  /** When the agent started the current task */
  startedAt?: string;
  /** Last status update timestamp */
  lastUpdate: string;
  /** Additional metadata (e.g., PR number, commit hash) */
  metadata?: Record<string, unknown>;
}

/** Inbox message (unread @mention or DM) */
export interface InboxMessage {
  /** The message */
  entry: Message;
  /** Priority level */
  priority: "normal" | "high";
  /** Whether the controller has picked up this message (but not yet processed) */
  seen: boolean;
}

/** Inbox state (per-agent cursors) */
export interface InboxState {
  /** Per-agent ack cursor: agent name → ID of last acknowledged (processed) message */
  readCursors: Record<string, string>;
  /** Per-agent seen cursor: agent name → ID of last seen (picked up by controller) message */
  seenCursors?: Record<string, string>;
}

/**
 * Context configuration in workflow file
 *
 * - undefined (not set): default file provider enabled
 * - false: explicitly disabled
 * - { provider: 'file', config?: {...} }: file provider with optional config
 * - { provider: 'memory' }: memory provider (for testing)
 */
export type ContextConfig = false | FileContextConfig | MemoryContextConfig;

/** File-based context provider configuration */
export interface FileContextConfig {
  provider: "file";
  /** Document owner (single-writer model, optional) */
  documentOwner?: string;
  config?: FileProviderConfig;
}

/** Memory-based context provider configuration (for testing) */
export interface MemoryContextConfig {
  provider: "memory";
  /** Document owner (single-writer model, optional) */
  documentOwner?: string;
}

/**
 * Configuration for file provider.
 *
 * Use `dir` for ephemeral context (transient state cleaned on shutdown).
 * Use `bind` for persistent context (all state preserved across runs, like Docker Compose volumes).
 * `dir` and `bind` are mutually exclusive — specify one or the other (not both).
 */
export interface FileProviderConfig {
  /** Context directory — ephemeral (default: ~/.agent-worker/workflows/${{ workflow.name }}/${{ workflow.tag }}/) */
  dir?: string;
  /**
   * Bind directory — persistent across runs.
   * Shutdown preserves ALL state (inbox cursors, channel, documents).
   * Path is relative to workflow file, supports ${{ workflow.name }} and ${{ workflow.tag }} templates.
   */
  bind?: string;
}

/** Default context configuration values */
export const CONTEXT_DEFAULTS = {
  /** Default context directory template */
  dir: "~/.agent-worker/workflows/${{ workflow.name }}/${{ workflow.tag }}/",
  /** Default document file name */
  document: "notes.md",
} as const;

/** Mention pattern for extracting @mentions */
export const MENTION_PATTERN = /@([a-zA-Z][a-zA-Z0-9_-]*)/g;

/**
 * Extract @mentions from a message
 */
export function extractMentions(content: string, validAgents: string[]): string[] {
  const mentions: string[] = [];
  let match: RegExpExecArray | null;

  // Reset regex state
  MENTION_PATTERN.lastIndex = 0;

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

/**
 * Calculate priority for an inbox message
 */
export function calculatePriority(msg: Message): "normal" | "high" {
  // Multiple mentions = coordination needed
  if (msg.mentions.length > 1) return "high";

  // Urgent keywords
  if (URGENT_PATTERN.test(msg.content)) return "high";

  return "normal";
}
