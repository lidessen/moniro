/**
 * DaemonEventLog — Daemon-level append-only JSONL event log.
 *
 * Persists to `~/.agent-worker/events.jsonl`.
 * Records daemon startup/shutdown, registry operations, importer progress.
 *
 * Uses the same Message format as ChannelStore and TimelineStore,
 * enabling read-time merge for unified timeline views.
 */

import { appendFileSync, mkdirSync, existsSync } from "node:fs";
import { readFile, open } from "node:fs/promises";
import { join } from "node:path";
import { nanoid } from "nanoid";
import type { Message, EventKind } from "../workflow/context/types.ts";
import type { EventSink } from "../workflow/context/stores/timeline.ts";

const EVENTS_FILE = "events.jsonl";

/**
 * Append-only JSONL event log for daemon-level events.
 * Uses synchronous writes — daemon events are infrequent and must not be lost.
 */
export class DaemonEventLog implements EventSink {
  private filePath: string;

  constructor(daemonDir: string) {
    if (!existsSync(daemonDir)) {
      mkdirSync(daemonDir, { recursive: true });
    }
    this.filePath = join(daemonDir, EVENTS_FILE);
  }

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
    try {
      appendFileSync(this.filePath, line);
    } catch {
      // Best-effort — daemon logging should never crash the daemon
    }
  }

  /** Read all events (full file read). */
  async readAll(): Promise<Message[]> {
    try {
      const content = await readFile(this.filePath, "utf-8");
      return content
        .split("\n")
        .filter((l) => l.trim())
        .map((l) => JSON.parse(l) as Message);
    } catch {
      return [];
    }
  }

  /** Read events from byte offset (incremental sync). */
  async readFrom(offset: number): Promise<{ events: Message[]; offset: number }> {
    let fh;
    try {
      fh = await open(this.filePath, "r");
      const { size } = await fh.stat();
      if (offset >= size) return { events: [], offset: size };
      const length = size - offset;
      const buffer = Buffer.alloc(length);
      await fh.read(buffer, 0, length, offset);
      const content = buffer.toString("utf-8");
      const events: Message[] = [];
      for (const line of content.split("\n")) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        try {
          events.push(JSON.parse(trimmed) as Message);
        } catch {
          // Skip malformed lines
        }
      }
      return { events, offset: size };
    } catch {
      return { events: [], offset };
    } finally {
      await fh?.close();
    }
  }
}
