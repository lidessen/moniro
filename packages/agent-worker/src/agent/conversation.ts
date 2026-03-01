/**
 * Conversation Model — ThinThread + ConversationLog
 *
 * ConversationLog: JSONL append-only storage for complete conversation history.
 * ThinThread: Bounded in-memory message buffer for prompt context.
 *
 * Together they give agents conversation continuity:
 *   - ThinThread provides recent context in every prompt (bounded)
 *   - ConversationLog persists full history for recall (unbounded)
 *
 * Persistence paths:
 *   Personal → .agents/<name>/conversations/personal.jsonl
 *   Workspace → .workspace/conversations/<name>.jsonl (future)
 */

import { appendFileSync, readFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

// ── Types ─────────────────────────────────────────────────────────

/** A single message in an agent's conversation */
export interface ConversationMessage {
  /** Message role */
  role: "user" | "assistant" | "system";
  /** Message content */
  content: string;
  /** ISO timestamp */
  timestamp: string;
}

/** Default thin thread size (messages) */
export const DEFAULT_THIN_THREAD_SIZE = 10;

// ── ConversationLog ───────────────────────────────────────────────

/**
 * Append-only JSONL conversation log.
 *
 * Each agent has one at `.agents/<name>/conversations/personal.jsonl`.
 * Synchronous append for reliability (no lost messages on crash).
 * Read operations load from disk (not cached — ThinThread handles the hot path).
 */
export class ConversationLog {
  constructor(private readonly filePath: string) {}

  /** Append a message to the log. Synchronous for durability. */
  append(msg: ConversationMessage): void {
    const dir = dirname(this.filePath);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
    appendFileSync(this.filePath, JSON.stringify(msg) + "\n");
  }

  /** Read all messages from the log. */
  readAll(): ConversationMessage[] {
    if (!existsSync(this.filePath)) return [];
    const content = readFileSync(this.filePath, "utf-8");
    return parseJsonl<ConversationMessage>(content);
  }

  /** Read the last N messages from the log. */
  readTail(n: number): ConversationMessage[] {
    const all = this.readAll();
    return all.slice(-n);
  }

  /** Whether the log file exists and has content. */
  get exists(): boolean {
    return existsSync(this.filePath);
  }

  /** The file path of this log. */
  get path(): string {
    return this.filePath;
  }
}

// ── ThinThread ────────────────────────────────────────────────────

/**
 * Bounded in-memory conversation buffer for prompt context.
 *
 * Keeps the last N messages. When the buffer is full, the oldest
 * message is dropped. This gives agents recent conversation context
 * without unbounded prompt growth.
 */
export class ThinThread {
  private messages: ConversationMessage[] = [];

  constructor(private readonly maxMessages: number = DEFAULT_THIN_THREAD_SIZE) {}

  /** Add a message. Drops oldest if over capacity. */
  push(msg: ConversationMessage): void {
    this.messages.push(msg);
    if (this.messages.length > this.maxMessages) {
      this.messages = this.messages.slice(-this.maxMessages);
    }
  }

  /** Get all messages in the buffer (copy). */
  getMessages(): ConversationMessage[] {
    return [...this.messages];
  }

  /** Number of messages currently in the buffer. */
  get length(): number {
    return this.messages.length;
  }

  /** Maximum buffer capacity. */
  get capacity(): number {
    return this.maxMessages;
  }

  /** Render messages for prompt injection. Returns null if empty. */
  render(): string | null {
    if (this.messages.length === 0) return null;
    return formatConversationMessages(this.messages);
  }

  /** Create a ThinThread pre-populated from a ConversationLog's tail. */
  static fromLog(log: ConversationLog, maxMessages: number = DEFAULT_THIN_THREAD_SIZE): ThinThread {
    const thread = new ThinThread(maxMessages);
    const tail = log.readTail(maxMessages);
    for (const msg of tail) {
      thread.messages.push(msg);
    }
    return thread;
  }
}

// ── Format ────────────────────────────────────────────────────────

/**
 * Format conversation messages for display.
 * Shared by ThinThread.render() and prompt section.
 */
export function formatConversationMessages(messages: ConversationMessage[]): string {
  return messages
    .map((m) => {
      const time = m.timestamp.slice(11, 19);
      const role = m.role === "user" ? "User" : m.role === "assistant" ? "You" : "System";
      return `[${time}] ${role}: ${m.content}`;
    })
    .join("\n");
}

// ── Helpers ───────────────────────────────────────────────────────

/** Parse JSONL content into an array of objects. Skips malformed lines. */
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
