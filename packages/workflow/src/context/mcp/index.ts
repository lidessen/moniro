/**
 * MCP tools module
 *
 * Tool categories:
 *   SDK tools  (agent/tools/)  — for ToolLoopAgent (bash, read, write, skills, feedback)
 *   MCP tools  (this directory) — for McpServer (channel, resource, inbox, team, proposal, feedback, skills)
 *
 * Some capabilities (skills, feedback) exist in both forms:
 *   - SDK version: direct tool() for ToolLoopAgent
 *   - MCP version: server.tool() for McpServer
 *   Same data layer, different transport.
 */

export {
  createContextMCPServer,
  type ContextMCPServerOptions,
  type ContextMCPServer,
} from "./server.ts";
export type { MCPToolContext, ChannelToolOptions } from "./types.ts";
export { getAgentId, formatInbox, formatToolParams, createLogTool } from "./helpers.ts";
