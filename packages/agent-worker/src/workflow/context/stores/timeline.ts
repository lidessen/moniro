/**
 * Timeline Store — Agent-level append-only JSONL event log.
 *
 * Each agent has its own timeline at `.agents/<name>/timeline.jsonl`.
 * Records state changes, errors, maxSteps warnings, worker events.
 *
 * Uses the same StorageBackend + Message format as ChannelStore,
 * enabling read-time merge for unified timeline views.
 */

import { nanoid } from "nanoid";
import type { Message, EventKind } from "../types.ts";
import type { StorageBackend } from "../storage.ts";

const TIMELINE_KEY = "timeline.jsonl";

// ── EventSink — minimal write-only interface ──────────────────────

/**
 * Minimal write-only interface for event logging.
 * Shared by DaemonEventLog, TimelineStore, and ChannelStore (via adapter).
 */
export interface EventSink {
  /** Append an event. Fire-and-forget — logging never blocks. */
  append(from: string, content: string, options?: { kind?: EventKind }): void;
}

// ── TimelineStore ─────────────────────────────────────────────────

export interface TimelineStore extends EventSink {
  /** Read events with optional incremental sync (byte offset). */
  read(offset?: number): Promise<{ events: Message[]; offset: number }>;
}

/**
 * JSONL-backed timeline store.
 * Incrementally syncs from a StorageBackend using byte offsets.
 */
export class DefaultTimelineStore implements TimelineStore {
  constructor(private storage: StorageBackend) {}

  append(from: string, content: string, options?: { kind?: EventKind }): void {
    const event: Message = {
      id: nanoid(),
      timestamp: new Date().toISOString(),
      from,
      content,
      mentions: [],
      kind: options?.kind ?? "system",
    };
    const line = JSON.stringify(event) + "\n";
    // Fire-and-forget — same pattern as ChannelStore
    void this.storage.append(TIMELINE_KEY, line);
  }

  async read(offset?: number): Promise<{ events: Message[]; offset: number }> {
    const result = await this.storage.readFrom(TIMELINE_KEY, offset ?? 0);
    const events: Message[] = [];
    if (result.content) {
      for (const line of result.content.split("\n")) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        try {
          events.push(JSON.parse(trimmed) as Message);
        } catch {
          // Skip malformed lines
        }
      }
    }
    return { events, offset: result.offset };
  }
}
