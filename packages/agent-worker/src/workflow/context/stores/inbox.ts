/**
 * Inbox Store
 * Filtered view of channel with per-agent cursors (seen/ack).
 */

import type { InboxMessage, InboxState } from "../types.ts";
import { calculatePriority } from "../types.ts";
import type { StorageBackend } from "../storage.ts";
import type { ChannelStore } from "./channel.ts";

const INBOX_STATE_KEY = "_state/inbox.json";

// ==================== Interface ====================

export interface InboxStore {
  getInbox(agent: string): Promise<InboxMessage[]>;
  markSeen(agent: string, untilId: string): Promise<void>;
  ack(agent: string, untilId: string): Promise<void>;
  /** Set run epoch: inbox ignores entries before current channel length */
  markRunStart(): Promise<void>;
  /** Clean up transient state (inbox cursors) */
  destroy(): Promise<void>;
}

// ==================== Default Implementation ====================

/**
 * Default inbox store backed by channel + JSON cursor file.
 * Inbox is a filtered view of the channel, not a separate log.
 */
export class DefaultInboxStore implements InboxStore {
  private runStartIndex = 0;

  constructor(
    private channel: ChannelStore,
    private storage: StorageBackend,
  ) {}

  async getInbox(agent: string): Promise<InboxMessage[]> {
    const state = await this.loadState();
    const lastAckId = state.readCursors[agent];
    const lastSeenId = state.seenCursors?.[agent];

    let entries = await this.channel.sync();

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
    // Excludes: system, debug, output, tool_call, messages from self
    return entries
      .filter((e) => {
        if (
          e.kind === "system" ||
          e.kind === "debug" ||
          e.kind === "output" ||
          e.kind === "tool_call"
        )
          return false;
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

  async markSeen(agent: string, untilId: string): Promise<void> {
    const state = await this.loadState();
    if (!state.seenCursors) state.seenCursors = {};
    state.seenCursors[agent] = untilId;
    await this.storage.write(INBOX_STATE_KEY, JSON.stringify(state, null, 2));
  }

  async ack(agent: string, untilId: string): Promise<void> {
    const state = await this.loadState();
    state.readCursors[agent] = untilId;
    await this.storage.write(INBOX_STATE_KEY, JSON.stringify(state, null, 2));
  }

  async markRunStart(): Promise<void> {
    const entries = await this.channel.sync();
    this.runStartIndex = entries.length;
  }

  async destroy(): Promise<void> {
    await this.storage.delete(INBOX_STATE_KEY);
  }

  private async loadState(): Promise<InboxState> {
    const raw = await this.storage.read(INBOX_STATE_KEY);
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
}
