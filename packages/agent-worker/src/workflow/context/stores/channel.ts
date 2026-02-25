/**
 * Channel Store
 * Append-only JSONL message log with incremental sync and visibility filtering.
 */

import { nanoid } from "nanoid";
import type { Message } from "../types.ts";
import { extractMentions } from "../types.ts";
import type { StorageBackend } from "../storage.ts";
import type { SendOptions, ReadOptions, TailResult } from "../provider.ts";

const CHANNEL_KEY = "channel.jsonl";

// ==================== Interface ====================

export interface ChannelStore {
  append(from: string, content: string, options?: SendOptions): Promise<Message>;
  read(options?: ReadOptions): Promise<Message[]>;
  tail(cursor: number): Promise<TailResult>;
  /** Sync cached entries from storage. Returns all entries. */
  sync(): Promise<Message[]>;
  /** Current number of cached entries */
  length(): number;
}

// ==================== Default Implementation ====================

/**
 * JSONL-backed channel store.
 * Incrementally syncs from a StorageBackend using byte offsets.
 */
export class DefaultChannelStore implements ChannelStore {
  private entries: Message[] = [];
  private offset = 0;
  private syncPromise: Promise<Message[]> | null = null;

  constructor(
    private storage: StorageBackend,
    private validAgents: string[],
  ) {}

  sync(): Promise<Message[]> {
    if (!this.syncPromise) {
      this.syncPromise = this.doSync().finally(() => {
        this.syncPromise = null;
      });
    }
    return this.syncPromise;
  }

  private async doSync(): Promise<Message[]> {
    const result = await this.storage.readFrom(CHANNEL_KEY, this.offset);
    if (result.content) {
      this.entries.push(...parseJsonl<Message>(result.content));
      this.offset = result.offset;
    }
    return this.entries;
  }

  length(): number {
    return this.entries.length;
  }

  async append(from: string, content: string, options?: SendOptions): Promise<Message> {
    const id = nanoid();
    const timestamp = new Date().toISOString();
    const mentions = extractMentions(content, this.validAgents);
    const msg: Message = { id, timestamp, from, content, mentions };

    if (options?.to) msg.to = options.to;
    if (options?.kind) msg.kind = options.kind;
    if (options?.toolCall) msg.toolCall = options.toolCall;

    const line = JSON.stringify(msg) + "\n";
    await this.storage.append(CHANNEL_KEY, line);

    return msg;
  }

  async read(options?: ReadOptions): Promise<Message[]> {
    let entries = await this.sync();

    // Visibility filtering: agent sees public msgs + DMs to/from them
    // Hidden from agents: system, debug, output (operational noise)
    if (options?.agent) {
      const agent = options.agent;
      entries = entries.filter((e) => {
        if (e.kind === "system" || e.kind === "debug" || e.kind === "output") return false;
        // DMs: only visible to sender and recipient
        if (e.to) return e.to === agent || e.from === agent;
        // Public messages + tool_call: visible to all
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

  async tail(cursor: number): Promise<TailResult> {
    const entries = await this.sync();
    return { entries: entries.slice(cursor), cursor: entries.length };
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
