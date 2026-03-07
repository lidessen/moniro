/**
 * MCP tools module
 *
 * Tool categories:
 *   SDK tools  (agent/tools/)  — for ToolLoopAgent (bash, read, write, feedback)
 *   MCP tools  (this directory) — for McpServer (channel, resource, inbox, team, proposal, feedback)
 */

export {
  createContextMCPServer,
  type ContextMCPServerOptions,
  type ContextMCPServer,
} from "./server.ts";
export type { MCPToolContext, ChannelToolOptions } from "./types.ts";
export { getAgentId, formatInbox, formatToolParams, createLogTool } from "./helpers.ts";
export { registerPersonalContextTools, type HandleResolver } from "./personal.ts";
