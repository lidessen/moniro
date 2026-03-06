/**
 * Context Provider interface + composite implementation.
 *
 * The ContextProvider interface defines business-method-level operations.
 * ContextProviderImpl composes domain-specific stores to satisfy the interface.
 * Each store owns its own concern and persistence strategy.
 */

import type {
  Message,
  InboxMessage,
  ResourceResult,
  ResourceType,
  EventKind,
  ToolCallData,
} from "./types.ts";
import { extractMentions, shouldUseResource } from "./types.ts";
import type { ChannelStore } from "./stores/channel.ts";
import type { InboxStore } from "./stores/inbox.ts";
import type { DocumentStore } from "./stores/document.ts";
import type { ResourceStore } from "./stores/resource.ts";
import type { StatusStore } from "./stores/status.ts";

// ==================== Interface ====================

/** Options for sending a channel message */
export interface SendOptions {
  /** DM recipient (private to sender + recipient) */
  to?: string;
  /** Event kind */
  kind?: EventKind;
  /** Tool call metadata (only for kind='tool_call') */
  toolCall?: ToolCallData;
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
  /** Mark inbox messages as seen (loop picked them up) */
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

// ==================== Composite Implementation ====================

/**
 * Composite ContextProvider — delegates to domain-specific stores.
 *
 * Each store owns one concern:
 * - ChannelStore:  append-only JSONL message log
 * - InboxStore:    filtered view of channel with per-agent cursors
 * - DocumentStore: raw text documents
 * - ResourceStore: content-addressed blobs
 * - StatusStore:   agent status tracking
 *
 * smartSend is the only cross-store orchestration (channel + resource).
 */
export class ContextProviderImpl implements ContextProvider {
  constructor(
    readonly channel: ChannelStore,
    readonly inbox: InboxStore,
    readonly documents: DocumentStore,
    readonly resources: ResourceStore,
    readonly status: StatusStore,
    private validAgents: string[],
  ) {}

  // ==================== Channel ====================

  appendChannel(from: string, content: string, options?: SendOptions): Promise<Message> {
    return this.channel.append(from, content, options);
  }

  readChannel(options?: ReadOptions): Promise<Message[]> {
    return this.channel.read(options);
  }

  tailChannel(cursor: number): Promise<TailResult> {
    return this.channel.tail(cursor);
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
      return this.channel.append(from, content, options);
    }

    // Long message: convert to resource
    const resourceType: ResourceType =
      content.startsWith("```") || content.includes("\n```") ? "markdown" : "text";

    const resource = await this.resources.create(content, from, resourceType);

    // Log full content in debug channel (visible in logs but not to agents)
    await this.channel.append(
      "system",
      `Created resource ${resource.id} (${content.length} chars) for @${from}:\n${content}`,
      { kind: "debug" },
    );

    // Extract @mentions from original content to preserve them in short message
    const mentions = extractMentions(content, this.validAgents);
    const mentionPrefix = mentions.length > 0 ? mentions.map((m) => `@${m}`).join(" ") + " " : "";

    // Send short reference message with preserved @mentions
    const shortMessage = `${mentionPrefix}[Long content stored as resource]\n\nRead the full content: resource_read("${resource.id}")\n\nReference: ${resource.ref}`;

    return this.channel.append(from, shortMessage, options);
  }

  // ==================== Inbox ====================

  getInbox(agent: string): Promise<InboxMessage[]> {
    return this.inbox.getInbox(agent);
  }

  markInboxSeen(agent: string, untilId: string): Promise<void> {
    return this.inbox.markSeen(agent, untilId);
  }

  ackInbox(agent: string, untilId: string): Promise<void> {
    return this.inbox.ack(agent, untilId);
  }

  // ==================== Team Documents ====================

  readDocument(file?: string): Promise<string> {
    return this.documents.read(file);
  }

  writeDocument(content: string, file?: string): Promise<void> {
    return this.documents.write(content, file);
  }

  appendDocument(content: string, file?: string): Promise<void> {
    return this.documents.append(content, file);
  }

  listDocuments(): Promise<string[]> {
    return this.documents.list();
  }

  createDocument(file: string, content: string): Promise<void> {
    return this.documents.create(file, content);
  }

  // ==================== Resources ====================

  createResource(content: string, createdBy: string, type?: ResourceType): Promise<ResourceResult> {
    return this.resources.create(content, createdBy, type);
  }

  readResource(id: string): Promise<string | null> {
    return this.resources.read(id);
  }

  // ==================== Agent Status ====================

  setAgentStatus(agent: string, status: Partial<import("./types.ts").AgentStatus>): Promise<void> {
    return this.status.set(agent, status);
  }

  getAgentStatus(agent: string): Promise<import("./types.ts").AgentStatus | null> {
    return this.status.get(agent);
  }

  listAgentStatus(): Promise<Record<string, import("./types.ts").AgentStatus>> {
    return this.status.list();
  }

  // ==================== Lifecycle ====================

  async markRunStart(): Promise<void> {
    await this.inbox.markRunStart();
  }

  async destroy(): Promise<void> {
    await this.inbox.destroy();
  }
}

// ==================== Helpers ====================

/**
 * Format messages as human-readable markdown.
 * Useful for debugging / export — not used for storage.
 */
export function formatChannelAsMarkdown(entries: Message[]): string {
  return entries.map((e) => `### ${e.timestamp} [${e.from}]\n${e.content}\n`).join("\n");
}
