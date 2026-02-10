/**
 * Stream-JSON event parsing for CLI backends
 *
 * Each CLI backend outputs a different JSON event format:
 * - Cursor/Claude: --output-format=stream-json (system/init, assistant, result)
 * - Codex: --json (thread.started, item.completed, turn.completed)
 *
 * Rather than forcing a shared parser, we define a standard internal
 * StreamEvent type and provide per-format adapters to convert native
 * events into it. Each backend explicitly chooses its adapter.
 */

import type { BackendResponse } from "./types.ts";

// ==================== Standard Event Types ====================

/**
 * Standard internal event representation.
 * Each backend adapter converts native JSON events to this format.
 */
export type StreamEvent =
  | { kind: "init"; model?: string; sessionId?: string }
  | { kind: "tool_call"; name: string; args: string }
  | {
      kind: "completed";
      durationMs?: number;
      costUsd?: number;
      usage?: { input: number; output: number };
    }
  | { kind: "unknown"; type: string; raw: Record<string, unknown> };

/**
 * Converts a raw JSON event object to a standard StreamEvent.
 * Returns null for events that don't map to a standard event
 * (e.g., plain text messages — those are extracted by result extractors).
 */
export type EventAdapter = (raw: Record<string, unknown>) => StreamEvent | null;

// ==================== Standard Display Formatting ====================

/**
 * Format a standard StreamEvent into a human-readable progress message.
 * Returns null if the event doesn't need display.
 *
 * This function only knows about StreamEvent — it never touches
 * backend-specific raw JSON. Format-specific conversion is handled
 * by the EventAdapter.
 */
export function formatEvent(event: StreamEvent, backendName: string): string | null {
  switch (event.kind) {
    case "init": {
      const details: string[] = [];
      if (event.model) details.push(`model: ${event.model}`);
      if (event.sessionId) details.push(`session: ${event.sessionId}`);
      return `${backendName} initialized${details.length > 0 ? ` (${details.join(", ")})` : ""}`;
    }

    case "tool_call": {
      // CALL prefix causes the runner to promote this to always-visible
      const truncated = event.args.length > 100 ? event.args.slice(0, 100) + "..." : event.args;
      return `CALL ${event.name}(${truncated})`;
    }

    case "completed": {
      const parts = [backendName, "completed"];
      const details: string[] = [];
      if (event.durationMs) details.push(`${(event.durationMs / 1000).toFixed(1)}s`);
      if (event.costUsd) details.push(`$${event.costUsd.toFixed(4)}`);
      if (event.usage) details.push(`${event.usage.input} in, ${event.usage.output} out`);
      if (details.length > 0) parts.push(`(${details.join(", ")})`);
      return parts.join(" ");
    }

    case "unknown": {
      // Only log unknown events in debug mode (let caller decide visibility)
      const preview = JSON.stringify(event.raw).slice(0, 100);
      return `[DEBUG] ${backendName} unknown event type="${event.type}": ${preview}...`;
    }
  }
}

// ==================== Claude/Cursor Adapter ====================

/**
 * Adapter for Claude/Cursor stream-json format.
 *
 * Events:
 *   { type: "system", subtype: "init", model: "..." }
 *   { type: "assistant", message: { content: [{ type: "tool_use", name, input }] } }
 *   { type: "result", duration_ms: N, total_cost_usd: N }
 */
export const claudeAdapter: EventAdapter = (raw) => {
  const type = raw.type as string;

  if (type === "system" && raw.subtype === "init") {
    return {
      kind: "init",
      model: (raw.model as string) || undefined,
      sessionId: raw.session_id as string | undefined,
    };
  }

  if (type === "assistant") {
    const message = raw.message as { content?: Array<Record<string, unknown>> } | undefined;
    if (!message?.content) return null;

    // Extract tool calls
    const toolCalls = message.content.filter((c) => c.type === "tool_use");
    if (toolCalls.length > 0) {
      // Return first tool call as a StreamEvent
      // (multiple tool calls in one message are rare; formatEvent is called per event)
      const tc = toolCalls[0]!;
      return {
        kind: "tool_call",
        name: (tc.name as string) || "unknown",
        args: formatToolInput(tc.input),
      };
    }

    // Plain text assistant messages — no standard event (extracted by result extractor)
    return null;
  }

  if (type === "result") {
    return {
      kind: "completed",
      durationMs: raw.duration_ms as number | undefined,
      costUsd: raw.total_cost_usd as number | undefined,
    };
  }

  return null;
};

/**
 * Extract final result from Claude/Cursor stream-json output.
 *
 * Priority:
 * 1. type=result with result field
 * 2. Last assistant message with text content
 * 3. Raw stdout fallback
 */
export function extractClaudeResult(stdout: string): BackendResponse {
  const lines = stdout.trim().split("\n");

  // 1. Find result event
  for (let i = lines.length - 1; i >= 0; i--) {
    try {
      const event = JSON.parse(lines[i]!);
      if (event.type === "result" && event.result) {
        return { content: event.result };
      }
    } catch {
      // Not JSON
    }
  }

  // 2. Last assistant message
  for (let i = lines.length - 1; i >= 0; i--) {
    try {
      const event = JSON.parse(lines[i]!);
      if (event.type === "assistant" && event.message?.content) {
        const textParts = event.message.content
          .filter((c: Record<string, unknown>) => c.type === "text")
          .map((c: Record<string, unknown>) => c.text);
        if (textParts.length > 0) {
          return { content: textParts.join("\n") };
        }
      }
    } catch {
      // Not JSON
    }
  }

  // 3. Raw stdout
  return { content: stdout.trim() };
}

// ==================== Codex Adapter ====================

/**
 * Adapter for Codex --json format.
 *
 * Events:
 *   { type: "thread.started", thread_id: "..." }
 *   { type: "item.completed", item: { type: "function_call", name, arguments } }
 *   { type: "item.completed", item: { type: "agent_message", text } }  → skipped (result only)
 *   { type: "turn.completed", usage: { input_tokens, output_tokens } }
 */
export const codexAdapter: EventAdapter = (raw) => {
  const type = raw.type as string;

  if (type === "thread.started") {
    const threadId = raw.thread_id as string | undefined;
    return {
      kind: "init",
      sessionId: threadId ? `${threadId.slice(0, 8)}...` : undefined,
    };
  }

  if (type === "item.completed") {
    const item = raw.item as Record<string, unknown> | undefined;
    if (!item) return null;

    // Tool call
    if (item.type === "function_call") {
      return {
        kind: "tool_call",
        name: (item.name as string) || "unknown",
        args: (item.arguments as string) ?? "",
      };
    }

    // agent_message — skip (extracted by result extractor)
    return null;
  }

  if (type === "turn.completed") {
    const usage = raw.usage as { input_tokens?: number; output_tokens?: number } | undefined;
    return {
      kind: "completed",
      usage: usage
        ? {
            input: usage.input_tokens ?? 0,
            output: usage.output_tokens ?? 0,
          }
        : undefined,
    };
  }

  return null;
};

/**
 * Extract final result from Codex --json output.
 *
 * Priority:
 * 1. Last item.completed with item.type=agent_message
 * 2. Raw stdout fallback
 */
export function extractCodexResult(stdout: string): BackendResponse {
  const lines = stdout.trim().split("\n");

  // 1. Find last agent_message
  for (let i = lines.length - 1; i >= 0; i--) {
    try {
      const event = JSON.parse(lines[i]!);
      if (
        event.type === "item.completed" &&
        event.item?.type === "agent_message" &&
        event.item?.text
      ) {
        return { content: event.item.text };
      }
    } catch {
      // Not JSON
    }
  }

  // 2. Raw stdout
  return { content: stdout.trim() };
}

// ==================== Stream Line Parser ====================

/**
 * Create a line-buffered stream parser.
 *
 * Accumulates stdout chunks, parses each line through the given adapter,
 * and emits formatted progress messages via debugLog.
 *
 * @param debugLog - Callback for progress messages
 * @param backendName - Display name (e.g., "Cursor", "Claude", "Codex")
 * @param adapter - Format-specific adapter to convert raw JSON → StreamEvent
 */
export function createStreamParser(
  debugLog: (message: string) => void,
  backendName: string,
  adapter: EventAdapter,
): (chunk: string) => void {
  let lineBuf = "";

  return (chunk: string) => {
    lineBuf += chunk;
    const lines = lineBuf.split("\n");
    // Keep incomplete last line in buffer
    lineBuf = lines.pop() ?? "";

    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const raw = JSON.parse(line);
        let event = adapter(raw);

        // If adapter doesn't recognize the event, create an "unknown" event
        if (!event && raw.type) {
          event = {
            kind: "unknown",
            type: raw.type as string,
            raw,
          };
        }

        if (event) {
          const progress = formatEvent(event, backendName);
          if (progress) debugLog(progress);
        }
      } catch {
        // Not JSON — ignore
      }
    }
  };
}

// ==================== Helpers ====================

/**
 * Format tool call input for display (truncated JSON string)
 */
function formatToolInput(input: unknown): string {
  if (!input || typeof input !== "object") return "";
  try {
    const str = JSON.stringify(input);
    return str.length > 100 ? str.slice(0, 100) + "..." : str;
  } catch {
    return "";
  }
}
