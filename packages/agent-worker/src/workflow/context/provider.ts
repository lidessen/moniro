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
} from "./types.ts";
import type { StorageBackend } from "./storage.ts";

// ==================== Interface ====================

/** Options for sending a channel message */
export interface SendOptions {
  /** DM recipient (private to sender + recipient) */
  to?: string;
  /** Entry kind ('log' = operational log, 'debug' = debug detail; both hidden from agents) */
  kind?: "log" | "debug";
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
  /** New entries since last offset */
  entries: Message[];
  /** Updated byte offset for next call */
  offset: number;
}

export interface ContextProvider {
  // Channel
  appendChannel(from: string, content: string, options?: SendOptions): Promise<Message>;
  readChannel(options?: ReadOptions): Promise<Message[]>;
  /** Read new channel entries incrementally from a byte offset */
  tailChannel(offset: number): Promise<TailResult>;

  // Inbox
  getInbox(agent: string): Promise<InboxMessage[]>;
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

  // Lifecycle
  /** Clean up transient state (inbox cursors). Channel log and documents are preserved. */
  destroy(): Promise<void>;
}

// ==================== Storage Keys ====================

/** Logical storage key layout */
const KEYS = {
  channel: "channel.jsonl",
  inboxState: "_state/inbox.json",
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
  constructor(
    private storage: StorageBackend,
    private validAgents: string[],
  ) {}

  /** Expose storage backend (for ProposalManager, testing, etc.) */
  getStorage(): StorageBackend {
    return this.storage;
  }

  // ==================== Channel ====================

  async appendChannel(from: string, content: string, options?: SendOptions): Promise<Message> {
    const id = nanoid();
    const timestamp = new Date().toISOString();
    const mentions = extractMentions(content, this.validAgents);
    const msg: Message = { id, timestamp, from, content, mentions };

    // Add optional fields only if present
    if (options?.to) msg.to = options.to;
    if (options?.kind) msg.kind = options.kind;

    // JSONL: one JSON object per line
    const line = JSON.stringify(msg) + "\n";
    await this.storage.append(KEYS.channel, line);

    return msg;
  }

  async readChannel(options?: ReadOptions): Promise<Message[]> {
    const raw = await this.storage.read(KEYS.channel);
    if (!raw) return [];

    let entries = parseJsonl<Message>(raw);

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

  async tailChannel(offset: number): Promise<TailResult> {
    const result = await this.storage.readFrom(KEYS.channel, offset);
    if (!result.content) return { entries: [], offset };
    return { entries: parseJsonl<Message>(result.content), offset: result.offset };
  }

  // ==================== Inbox ====================

  async getInbox(agent: string): Promise<InboxMessage[]> {
    const state = await this.loadInboxState();
    const lastAckId = state.readCursors[agent];

    // Read all messages (unfiltered)
    const raw = await this.storage.read(KEYS.channel);
    if (!raw) return [];

    let entries = parseJsonl<Message>(raw);

    // Skip messages up to and including the last acked message
    if (lastAckId) {
      const ackIdx = entries.findIndex((e) => e.id === lastAckId);
      if (ackIdx >= 0) {
        entries = entries.slice(ackIdx + 1);
      }
      // If ackIdx is -1 (ID not found — e.g. legacy cursor), show all messages
    }

    // Inbox includes: @mentions to this agent OR DMs to this agent
    // Excludes: logs, debug entries, messages from self
    return entries
      .filter((e) => {
        if (e.kind === "log" || e.kind === "debug") return false;
        if (e.from === agent) return false;
        return e.mentions.includes(agent) || e.to === agent;
      })
      .map((entry) => ({
        entry,
        priority: calculatePriority(entry),
      }));
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
      return { readCursors: data.readCursors || {} };
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

  // ==================== Lifecycle ====================

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
