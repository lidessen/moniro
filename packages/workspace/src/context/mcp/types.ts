/**
 * Shared types for MCP tool registration.
 *
 * Each tool category file receives an MCPToolContext
 * containing the dependencies needed to implement tools.
 */

import type { ContextProvider } from "../provider.ts";
import type { EventLog } from "../event-log.ts";
import type { Message } from "../types.ts";

/**
 * Shared dependencies for all MCP tool categories.
 */
export interface MCPToolContext {
  /** Context provider for storage operations */
  provider: ContextProvider;
  /** Event log for unified event recording */
  eventLog: EventLog;
  /** Valid agent names for @mention validation */
  validAgents: string[];
  /** Extract agent ID from MCP extra context */
  getAgentId: (extra: unknown) => string | undefined;
  /** Log a tool call to the channel (fire-and-forget) */
  logTool: (tool: string, agent: string | undefined, params: Record<string, unknown>) => void;
}

/**
 * Extended context for channel tools that can notify on @mentions.
 */
export interface ChannelToolOptions {
  onMention?: (from: string, target: string, msg: Message) => void;
}
