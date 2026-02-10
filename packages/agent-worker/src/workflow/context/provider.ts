/**
 * Context Provider interface + unified implementation
 * Domain logic for channel, inbox, document, and resource operations.
 * Storage I/O is delegated to a StorageBackend.
 */

import { nanoid } from "nanoid";
import type { Message, InboxMessage, InboxState, ResourceResult, ResourceType } from "./types.ts";
import {
  CONTEXT_DEFAULTS,
  calculatePriority,
  extractMentions,
  generateResourceId,
  createResourceRef,
  shouldUseResource,
} from "./types.ts";
import type { StorageBackend } from "./storage.ts";

// ==================== Interface ====================

/** Options for sending a channel message */
export interface SendOptions {
  /** DM recipient (private to sender + recipient) */
  to?: string;
  /** Entry kind ('log' = operational log, 'debug' = debug detail, 'tool_call' = tool invocation) */
  kind?: "log" | "debug" | "tool_call";
  /** Tool call metadata (only for kind='tool_call') */
  toolCall?: {
    name: string;
    args: string;
  };
}

/** Options for reading channel messages */
export interface ReadOptions {
  /** Only return entries after this timestamp */
  since?: string;
  /** Maximum entries to return (from the end) */
  limit?: number;
  /** Agent identity for visibility filtering (filters out DMs not addressed to this agent, and logs) */
  agent?: string;
}

/**
 * Context Provider interface
 * Provides domain operations for workflow context (channel, inbox, documents, resources).
 */
/** Result of an incremental channel read */
export interface TailResult {
  /** New entries since last cursor */
  entries: Message[];
  /** Updated cursor for next call (entry index) */
  cursor: number;
}

export interface ContextProvider {
  // Channel
  appendChannel(from: string, content: string, options?: SendOptions): Promise<Message>;
  readChannel(options?: ReadOptions): Promise<Message[]>;
  /** Read new channel entries incrementally from an entry cursor */
  tailChannel(cursor: number): Promise<TailResult>;
  /** Smart send: automatically converts long messages to resources */
  smartSend(from: string, content: string, options?: SendOptions): Promise<Message>;

  // Inbox
  getInbox(agent: string): Promise<InboxMessage[]>;
  /** Mark inbox messages as seen (controller picked them up) */
  markInboxSeen(agent: string, untilId: string): Promise<void>;
  ackInbox(agent: string, untilId: string): Promise<void>;

  // Team Documents
  readDocument(file?: string): Promise<string>;
  writeDocument(content: string, file?: string): Promise<void>;
  appendDocument(content: string, file?: string): Promise<void>;
  listDocuments(): Promise<string[]>;
  createDocument(file: string, content: string): Promise<void>;

  // Resources
  createResource(content: string, createdBy: string, type?: ResourceType): Promise<ResourceResult>;
  readResource(id: string): Promise<string | null>;

  // Agent Status
  /** Set agent status (updates state, task, metadata) */
  setAgentStatus(agent: string, status: Partial<import("./types.ts").AgentStatus>): Promise<void>;
  /** Get status for a specific agent */
  getAgentStatus(agent: string): Promise<import("./types.ts").AgentStatus | null>;
  /** List all agent statuses */
  listAgentStatus(): Promise<Record<string, import("./types.ts").AgentStatus>>;

  // Lifecycle
  /** Record current channel position as run epoch. Inbox will ignore messages before this point. */
  markRunStart(): Promise<void>;
  /** Clean up transient state (inbox cursors). Channel log and documents are preserved. */
  destroy(): Promise<void>;
}

// ==================== Storage Keys ====================

/** Logical storage key layout */
const KEYS = {
  channel: "channel.jsonl",
  inboxState: "_state/inbox.json",
  agentStatus: "_state/agent-status.json",
  documentPrefix: "documents/",
  resourcePrefix: "resources/",
} as const;

// ==================== Unified Implementation ====================

/**
 * Unified ContextProvider implementation.
 * All domain logic lives here; storage I/O goes through StorageBackend.
 *
 * Channel format: JSONL (one JSON object per line)
 * Documents: raw content strings
 * Resources: content-addressed blobs
 * Inbox state: JSON cursor file (ID-based)
 */
export class ContextProviderImpl implements ContextProvider {
  /** Cached parsed channel entries — incrementally synced from storage */
  private channelEntries: Message[] = [];
  /** Storage byte offset up to which the cache is synced */
  private channelOffset = 0;
  /** Guards concurrent syncChannel calls (share one in-flight read) */
  private syncPromise: Promise<Message[]> | null = null;
  /** Run epoch: channel entry count at run start. Inbox ignores entries before this index. */
  private runStartIndex = 0;

  constructor(
    private storage: StorageBackend,
    private validAgents: string[],
  ) {}

  /** Expose storage backend (for ProposalManager, testing, etc.) */
  getStorage(): StorageBackend {
    return this.storage;
  }

  // ==================== Channel ====================

  /**
   * Sync cached entries from storage via incremental read.
   * Only parses newly appended JSONL lines since last sync.
   * Concurrent callers share the same in-flight read to avoid duplicate pushes.
   */
  private syncChannel(): Promise<Message[]> {
    if (!this.syncPromise) {
      this.syncPromise = this.doSyncChannel().finally(() => {
        this.syncPromise = null;
      });
    }
    return this.syncPromise;
  }

  private async doSyncChannel(): Promise<Message[]> {
    const result = await this.storage.readFrom(KEYS.channel, this.channelOffset);
    if (result.content) {
      this.channelEntries.push(...parseJsonl<Message>(result.content));
      this.channelOffset = result.offset;
    }
    return this.channelEntries;
  }

  async appendChannel(from: string, content: string, options?: SendOptions): Promise<Message> {
    const id = nanoid();
    const timestamp = new Date().toISOString();
    const mentions = extractMentions(content, this.validAgents);
    const msg: Message = { id, timestamp, from, content, mentions };

    // Add optional fields only if present
    if (options?.to) msg.to = options.to;
    if (options?.kind) msg.kind = options.kind;
    if (options?.toolCall) msg.toolCall = options.toolCall;

    // JSONL: one JSON object per line
    const line = JSON.stringify(msg) + "\n";
    await this.storage.append(KEYS.channel, line);

    return msg;
  }

  async readChannel(options?: ReadOptions): Promise<Message[]> {
    let entries = await this.syncChannel();

    // Visibility filtering: agent sees public msgs + DMs to/from them, no logs/debug
    if (options?.agent) {
      const agent = options.agent;
      entries = entries.filter((e) => {
        // Logs and debug entries are hidden from agents
        if (e.kind === "log" || e.kind === "debug") return false;
        // DMs: only visible to sender and recipient
        if (e.to) return e.to === agent || e.from === agent;
        // Public messages: visible to all
        return true;
      });
    }

    if (options?.since) {
      entries = entries.filter((e) => e.timestamp > options.since!);
    }

    if (options?.limit && options.limit > 0) {
      entries = entries.slice(-options.limit);
    }

    return entries;
  }

  async tailChannel(cursor: number): Promise<TailResult> {
    const entries = await this.syncChannel();
    return { entries: entries.slice(cursor), cursor: entries.length };
  }

  /**
   * Smart send: automatically converts long messages to resources
   *
   * If content exceeds MESSAGE_LENGTH_THRESHOLD:
   * 1. Creates a resource with the full content
   * 2. Sends a short message referencing the resource
   * 3. Logs the full content in debug channel for visibility
   */
  async smartSend(from: string, content: string, options?: SendOptions): Promise<Message> {
    // Short message: send directly
    if (!shouldUseResource(content)) {
      return this.appendChannel(from, content, options);
    }

    // Long message: convert to resource
    const resourceType: ResourceType =
      content.startsWith("```") || content.includes("\n```") ? "markdown" : "text";

    const resource = await this.createResource(content, from, resourceType);

    // Log full content in debug channel (visible in logs but not to agents)
    await this.appendChannel(
      "system",
      `Created resource ${resource.id} (${content.length} chars) for @${from}:\n${content}`,
      { kind: "debug" },
    );

    // Extract @mentions from original content to preserve them in short message
    const mentions = extractMentions(content, this.validAgents);
    const mentionPrefix = mentions.length > 0 ? mentions.map((m) => `@${m}`).join(" ") + " " : "";

    // Send short reference message with preserved @mentions
    const shortMessage = `${mentionPrefix}[Long content stored as resource]\n\nRead the full content: resource_read("${resource.id}")\n\nReference: ${resource.ref}`;

    return this.appendChannel(from, shortMessage, options);
  }

  // ==================== Inbox ====================

  async getInbox(agent: string): Promise<InboxMessage[]> {
    const state = await this.loadInboxState();
    const lastAckId = state.readCursors[agent];
    const lastSeenId = state.seenCursors?.[agent];

    let entries = await this.syncChannel();

    // Run epoch floor: skip messages from before this run started
    if (this.runStartIndex > 0) {
      entries = entries.slice(this.runStartIndex);
    }

    // Skip messages up to and including the last acked message
    if (lastAckId) {
      const ackIdx = entries.findIndex((e) => e.id === lastAckId);
      if (ackIdx >= 0) {
        entries = entries.slice(ackIdx + 1);
      }
      // If ackIdx is -1 (ID not found — e.g. legacy cursor), show all messages
    }

    // Find seen boundary
    let seenIdx = -1;
    if (lastSeenId) {
      seenIdx = entries.findIndex((e) => e.id === lastSeenId);
    }

    // Inbox includes: @mentions to this agent OR DMs to this agent
    // Excludes: logs, debug entries, messages from self
    return entries
      .filter((e) => {
        if (e.kind === "log" || e.kind === "debug") return false;
        if (e.from === agent) return false;
        return e.mentions.includes(agent) || e.to === agent;
      })
      .map((entry) => {
        const entryIdx = entries.indexOf(entry);
        return {
          entry,
          priority: calculatePriority(entry),
          seen: seenIdx >= 0 && entryIdx <= seenIdx,
        };
      });
  }

  async markInboxSeen(agent: string, untilId: string): Promise<void> {
    const state = await this.loadInboxState();
    if (!state.seenCursors) state.seenCursors = {};
    state.seenCursors[agent] = untilId;
    await this.storage.write(KEYS.inboxState, JSON.stringify(state, null, 2));
  }

  async ackInbox(agent: string, untilId: string): Promise<void> {
    const state = await this.loadInboxState();
    state.readCursors[agent] = untilId;
    await this.storage.write(KEYS.inboxState, JSON.stringify(state, null, 2));
  }

  private async loadInboxState(): Promise<InboxState> {
    const raw = await this.storage.read(KEYS.inboxState);
    if (!raw) return { readCursors: {} };
    try {
      const data = JSON.parse(raw);
      return {
        readCursors: data.readCursors || {},
        seenCursors: data.seenCursors,
      };
    } catch {
      return { readCursors: {} };
    }
  }

  // ==================== Team Documents ====================

  private docKey(file?: string): string {
    return KEYS.documentPrefix + (file || CONTEXT_DEFAULTS.document);
  }

  async readDocument(file?: string): Promise<string> {
    return (await this.storage.read(this.docKey(file))) ?? "";
  }

  async writeDocument(content: string, file?: string): Promise<void> {
    await this.storage.write(this.docKey(file), content);
  }

  async appendDocument(content: string, file?: string): Promise<void> {
    await this.storage.append(this.docKey(file), content);
  }

  async listDocuments(): Promise<string[]> {
    const files = await this.storage.list(KEYS.documentPrefix);
    return files.filter((f) => f.endsWith(".md")).sort();
  }

  async createDocument(file: string, content: string): Promise<void> {
    const key = this.docKey(file);
    if (await this.storage.exists(key)) {
      throw new Error(`Document already exists: ${file}`);
    }
    await this.storage.write(key, content);
  }

  // ==================== Resources ====================

  async createResource(
    content: string,
    _createdBy: string,
    type: ResourceType = "text",
  ): Promise<ResourceResult> {
    const id = generateResourceId();
    const ext = type === "json" ? "json" : type === "diff" ? "diff" : "md";
    const key = `${KEYS.resourcePrefix}${id}.${ext}`;

    await this.storage.write(key, content);

    return { id, ref: createResourceRef(id) };
  }

  async readResource(id: string): Promise<string | null> {
    // Try common extensions
    for (const ext of ["md", "json", "diff", "txt"]) {
      const key = `${KEYS.resourcePrefix}${id}.${ext}`;
      const content = await this.storage.read(key);
      if (content !== null) return content;
    }
    return null;
  }

  // ==================== Agent Status ====================

  private async loadAgentStatus(): Promise<Record<string, import("./types.ts").AgentStatus>> {
    const raw = await this.storage.read(KEYS.agentStatus);
    if (!raw) return {};
    try {
      return JSON.parse(raw);
    } catch {
      return {};
    }
  }

  private async saveAgentStatus(
    statuses: Record<string, import("./types.ts").AgentStatus>,
  ): Promise<void> {
    await this.storage.write(KEYS.agentStatus, JSON.stringify(statuses, null, 2));
  }

  async setAgentStatus(
    agent: string,
    status: Partial<import("./types.ts").AgentStatus>,
  ): Promise<void> {
    const statuses = await this.loadAgentStatus();
    const existing = statuses[agent] || { state: "idle", lastUpdate: new Date().toISOString() };

    // Merge updates
    statuses[agent] = {
      ...existing,
      ...status,
      lastUpdate: new Date().toISOString(),
    };

    // Set startedAt when transitioning to running state
    if (status.state === "running" && existing.state !== "running") {
      statuses[agent]!.startedAt = new Date().toISOString();
    }

    // Clear startedAt and task when transitioning to idle
    if (status.state === "idle") {
      statuses[agent]!.startedAt = undefined;
      statuses[agent]!.task = undefined;
    }

    await this.saveAgentStatus(statuses);
  }

  async getAgentStatus(agent: string): Promise<import("./types.ts").AgentStatus | null> {
    const statuses = await this.loadAgentStatus();
    return statuses[agent] || null;
  }

  async listAgentStatus(): Promise<Record<string, import("./types.ts").AgentStatus>> {
    return this.loadAgentStatus();
  }

  // ==================== Lifecycle ====================

  async markRunStart(): Promise<void> {
    const entries = await this.syncChannel();
    this.runStartIndex = entries.length;
  }

  async destroy(): Promise<void> {
    await this.storage.delete(KEYS.inboxState);
  }
}

// ==================== Helpers ====================

/**
 * Parse JSONL content into an array of objects.
 * Skips empty lines and lines that fail to parse.
 */
function parseJsonl<T>(content: string): T[] {
  const results: T[] = [];
  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      results.push(JSON.parse(trimmed) as T);
    } catch {
      // Skip malformed lines
    }
  }
  return results;
}

/**
 * Format messages as human-readable markdown.
 * Useful for debugging / export — not used for storage.
 */
export function formatChannelAsMarkdown(entries: Message[]): string {
  return entries.map((e) => `### ${e.timestamp} [${e.from}]\n${e.content}\n`).join("\n");
}
