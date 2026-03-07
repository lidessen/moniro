/**
 * Shared helpers for MCP tools.
 *
 * - getAgentId: extracts caller identity from MCP session
 * - formatInbox: formats inbox messages for display
 * - createLogTool: creates a logTool function bound to an EventLog
 */

import type { EventLog } from "../event-log.ts";
import type { InboxMessage } from "../types.ts";

/**
 * Extract agent ID from MCP extra context.
 * Session ID format: "agentName-uuid8chars" — extract agent name.
 */
export function getAgentId(extra: unknown): string | undefined {
  if (!extra || typeof extra !== "object") return undefined;

  // Try sessionId first (set by sessionIdGenerator in HTTP transport)
  if ("sessionId" in extra && typeof extra.sessionId === "string") {
    const sid = extra.sessionId;
    const match = sid.match(/^(.+)-[0-9a-f]{8}$/);
    return match ? match[1] : sid;
  }

  // Try meta.agentId as fallback
  if ("meta" in extra && extra.meta && typeof extra.meta === "object") {
    const meta = extra.meta as Record<string, unknown>;
    if ("agentId" in meta && typeof meta.agentId === "string") {
      return meta.agentId;
    }
  }

  return undefined;
}

/**
 * Format inbox messages for JSON display.
 */
export function formatInbox(messages: InboxMessage[]): string {
  if (messages.length === 0) {
    return JSON.stringify({ messages: [], count: 0 });
  }

  return JSON.stringify({
    messages: messages.map((m) => ({
      id: m.entry.id,
      from: m.entry.from,
      content: m.entry.content,
      timestamp: m.entry.timestamp,
      priority: m.priority,
    })),
    count: messages.length,
  });
}

/**
 * Format tool call parameters as a concise string.
 */
export function formatToolParams(params: Record<string, unknown>): string {
  return Object.entries(params)
    .filter(([_, v]) => v !== undefined)
    .map(([k, v]) => {
      const val = typeof v === "string" && v.length > 50 ? v.slice(0, 50) + "..." : v;
      return `${k}=${JSON.stringify(val)}`;
    })
    .join(", ");
}

/**
 * Create a logTool function that records tool calls via EventLog.
 */
export function createLogTool(
  eventLog: EventLog,
): (tool: string, agent: string | undefined, params: Record<string, unknown>) => void {
  return (tool, agent, params) => {
    if (!agent) return;
    const args = formatToolParams(params);
    eventLog.toolCall(agent, tool, args, "mcp");
  };
}
