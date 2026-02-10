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

// ==================== Backend Event Type Definitions ====================

/**
 * Claude/Claude Code event format
 * @see https://docs.anthropic.com/en/docs/claude-code
 */
export type ClaudeEvent =
  | {
      type: "system";
      subtype: "init" | "hook_started" | "hook_response";
      model?: string;
      session_id?: string;
      hook_id?: string;
      hook_name?: string;
      output?: string;
    }
  | {
      type: "assistant";
      message: {
        content: Array<
          | { type: "text"; text: string }
          | { type: "tool_use"; id: string; name: string; input: unknown }
        >;
      };
    }
  | {
      type: "user";
      message: {
        role: "user";
        content: unknown[];
      };
    }
  | {
      type: "result";
      subtype: "success";
      result?: string;
      duration_ms?: number;
      total_cost_usd?: number;
    };

/**
 * Cursor Agent event format
 * @see https://docs.cursor.com/
 */
export type CursorEvent =
  | {
      type: "system";
      subtype: "init";
      model?: string;
      session_id?: string;
    }
  | {
      type: "user";
      message: {
        role: "user";
        content: Array<{ type: "text"; text: string }>;
      };
    }
  | {
      type: "assistant";
      message: {
        role: "assistant";
        content: Array<{ type: "text"; text: string }>;
      };
    }
  | {
      type: "tool_call";
      subtype: "started" | "completed";
      call_id?: string;
      tool_call?: {
        shellToolCall?: {
          args?: { command?: string; toolCallId?: string };
          result?: unknown;
        };
      };
    }
  | {
      type: "result";
      subtype: "success";
      duration_ms?: number;
    };

/**
 * OpenAI Codex event format
 * @see https://github.com/openai/codex
 */
export type CodexEvent =
  | {
      type: "thread.started";
      thread_id: string;
    }
  | {
      type: "turn.started";
    }
  | {
      type: "item.started";
      item: {
        id: string;
        type: "command_execution" | "reasoning";
      };
    }
  | {
      type: "item.completed";
      item:
        | {
            id: string;
            type: "reasoning";
            text: string;
          }
        | {
            id: string;
            type: "agent_message";
            text: string;
          }
        | {
            id: string;
            type: "function_call";
            name: string;
            arguments: string;
          }
        | {
            id: string;
            type: "command_execution";
            command: string;
            aggregated_output: string;
            exit_code: number;
            status: "completed" | "in_progress";
          };
    }
  | {
      type: "turn.completed";
      usage: {
        input_tokens: number;
        cached_input_tokens?: number;
        output_tokens: number;
      };
    };

// ==================== Standard Event Types ====================

/**
 * Standard internal event representation.
 * Each backend adapter converts native JSON events to this format.
 */
export type StreamEvent =
  | { kind: "init"; model?: string; sessionId?: string }
  | { kind: "tool_call_started"; name: string; callId?: string }
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

    case "tool_call_started": {
      // Show tool execution start (Cursor format)
      const callIdSuffix = event.callId ? ` [${event.callId.slice(0, 8)}]` : "";
      return `STARTING ${event.name}${callIdSuffix}`;
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
  const event = raw as ClaudeEvent;

  if (event.type === "system" && event.subtype === "init") {
    return {
      kind: "init",
      model: event.model,
      sessionId: event.session_id,
    };
  }

  if (event.type === "assistant") {
    // Extract tool calls
    const toolCalls = event.message.content.filter((c) => c.type === "tool_use");
    if (toolCalls.length > 0) {
      // Return first tool call as a StreamEvent
      // (multiple tool calls in one message are rare; formatEvent is called per event)
      const tc = toolCalls[0]!;
      return {
        kind: "tool_call",
        name: tc.name,
        args: formatToolInput(tc.input),
      };
    }

    // Plain text assistant messages — no standard event (extracted by result extractor)
    return null;
  }

  if (event.type === "result") {
    return {
      kind: "completed",
      durationMs: event.duration_ms,
      costUsd: event.total_cost_usd,
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

// ==================== Cursor Adapter ====================

/**
 * Adapter for Cursor stream-json format.
 *
 * Events:
 *   { type: "system", subtype: "init", model: "..." }
 *   { type: "tool_call", subtype: "started", call_id: "...", tool_call: { shellToolCall: {...} } }
 *   { type: "tool_call", subtype: "completed", call_id: "..." }
 *   { type: "result", duration_ms: N }
 */
export const cursorAdapter: EventAdapter = (raw) => {
  const event = raw as CursorEvent;

  if (event.type === "system" && event.subtype === "init") {
    return {
      kind: "init",
      model: event.model,
      sessionId: event.session_id,
    };
  }

  if (event.type === "tool_call") {
    if (event.subtype === "started" && event.tool_call) {
      // Extract tool name from shellToolCall
      const shellToolCall = event.tool_call.shellToolCall;
      if (shellToolCall) {
        // For shell tools, use "bash" as the name
        return {
          kind: "tool_call_started",
          name: "bash",
          callId: event.call_id,
        };
      }
      // For other tool types, extract name if available
      return {
        kind: "tool_call_started",
        name: "tool",
        callId: event.call_id,
      };
    }

    // completed events are not shown (result is in assistant message)
    return null;
  }

  if (event.type === "result") {
    return {
      kind: "completed",
      durationMs: event.duration_ms,
    };
  }

  return null;
};

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
  const event = raw as CodexEvent;

  if (event.type === "thread.started") {
    return {
      kind: "init",
      sessionId: `${event.thread_id.slice(0, 8)}...`,
    };
  }

  if (event.type === "item.completed") {
    // Tool call
    if (event.item.type === "function_call") {
      return {
        kind: "tool_call",
        name: event.item.name,
        args: event.item.arguments,
      };
    }

    // agent_message, reasoning, command_execution — skip (extracted by result extractor)
    return null;
  }

  if (event.type === "turn.completed") {
    return {
      kind: "completed",
      usage: {
        input: event.usage.input_tokens,
        output: event.usage.output_tokens,
      },
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
