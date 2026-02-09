/**
 * Stream-JSON event parsing for CLI backends
 *
 * Both cursor-agent and claude CLI support --output-format=stream-json,
 * which outputs newline-delimited JSON events. This module provides shared
 * parsing for progress reporting and result extraction.
 *
 * Event types:
 *   system/init  → agent initialized with model info
 *   assistant    → model response (may include tool_use content)
 *   result       → final result with duration and cost
 */

import type { BackendResponse } from "./types.ts";

// ==================== Progress Formatting ====================

/**
 * Format a stream-json event into a human-readable progress message.
 * Returns null for events that don't need to be shown.
 *
 * @param event - Parsed JSON event object
 * @param backendName - Backend name for display (e.g., "Cursor", "Claude")
 */
export function formatStreamEvent(
  event: Record<string, unknown>,
  backendName: string,
): string | null {
  const type = event.type as string;

  if (type === "system" && event.subtype === "init") {
    const model = (event.model as string) || "unknown";
    return `${backendName} initialized (model: ${model})`;
  }

  if (type === "assistant") {
    const message = event.message as { content?: Array<Record<string, unknown>> } | undefined;
    if (!message?.content) return null;

    // Report tool calls — prefixed with CALL so the runner promotes them to always-visible
    const toolCalls = message.content.filter((c) => c.type === "tool_use");
    if (toolCalls.length > 0) {
      return toolCalls
        .map((tc) => `CALL ${tc.name}(${formatToolArgs(tc.input)})`)
        .join("\n");
    }

    return null; // Skip plain text assistant messages (will be in final result)
  }

  if (type === "result") {
    const duration = event.duration_ms as number | undefined;
    const cost = event.total_cost_usd as number | undefined;
    const parts = [backendName, "completed"];
    const details: string[] = [];
    if (duration) details.push(`${(duration / 1000).toFixed(1)}s`);
    if (cost) details.push(`$${cost.toFixed(4)}`);
    if (details.length > 0) parts.push(`(${details.join(", ")})`);
    return parts.join(" ");
  }

  return null;
}

/**
 * Format tool call arguments for logging (truncated)
 */
function formatToolArgs(input: unknown): string {
  if (!input || typeof input !== "object") return "";
  try {
    const str = JSON.stringify(input);
    return str.length > 100 ? str.slice(0, 100) + "..." : str;
  } catch {
    return "";
  }
}

// ==================== Stream Line Parser ====================

/**
 * Create a line-buffered stream-json parser.
 *
 * Accumulates stdout chunks and emits parsed progress messages
 * via the debugLog callback. Handles partial lines across chunks.
 */
export function createStreamParser(
  debugLog: (message: string) => void,
  backendName: string,
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
        const event = JSON.parse(line);
        const progress = formatStreamEvent(event, backendName);
        if (progress) debugLog(progress);
      } catch {
        // Not JSON — ignore
      }
    }
  };
}

// ==================== Result Extraction ====================

/**
 * Parse stream-json output to extract the final result.
 * Falls back to raw stdout if parsing fails.
 *
 * Searches for:
 * 1. A result event with type=result and a result field
 * 2. The last assistant message with text content
 * 3. Raw stdout as final fallback
 */
export function parseStreamResult(stdout: string): BackendResponse {
  const lines = stdout.trim().split("\n");

  // Find the result event (last line with type=result)
  for (let i = lines.length - 1; i >= 0; i--) {
    try {
      const event = JSON.parse(lines[i]!);
      if (event.type === "result" && event.result) {
        return { content: event.result };
      }
    } catch {
      // Not JSON — skip
    }
  }

  // Fallback: find last assistant message
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
      // Not JSON — skip
    }
  }

  // Final fallback: return raw stdout
  return { content: stdout.trim() };
}
