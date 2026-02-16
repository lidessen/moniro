/**
 * Daemon MCP Server — context tools exposed to workers.
 *
 * Workers connect via HTTP, identified by ?agent=<name> query param.
 * Each tool handler is a thin wrapper over context operations.
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import type { Database } from "bun:sqlite";
import { z } from "zod";
import { TOOLS } from "../shared/constants.ts";
import {
  channelSend,
  channelRead,
  inboxQuery,
  inboxAck,
  inboxAckAll,
  resourceCreate,
  resourceRead,
} from "./context.ts";
import { listAgents, getAgent, updateAgentState } from "./registry.ts";

export interface McpDeps {
  db: Database;
}

/**
 * Create the Daemon MCP server with all context tools.
 */
export function createMcpServer(deps: McpDeps): McpServer {
  const server = new McpServer({
    name: "agent-worker-daemon",
    version: "1.0.0",
  });

  // ==================== Channel ====================

  server.tool(
    TOOLS.CHANNEL_SEND,
    "Send a message to the team channel. Use @name to mention specific agents.",
    {
      message: z.string().describe("Message content. Use @name to mention agents."),
      to: z.string().optional().describe("Direct message to specific agent (private)."),
    },
    (args, extra) => {
      const agent = resolveAgent(extra);
      const { workflow, tag } = resolveScope(deps.db, agent);

      const result = channelSend(deps.db, agent, args.message, workflow, tag, {
        to: args.to,
      });

      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify({
              sent: true,
              id: result.id,
              recipients: result.recipients,
            }),
          },
        ],
      };
    },
  );

  server.tool(
    TOOLS.CHANNEL_READ,
    "Read recent messages from the team channel.",
    {
      since: z.string().optional().describe("Message ID to read from (exclusive)."),
      limit: z.number().optional().describe("Max messages to return (default: 50)."),
    },
    (args, extra) => {
      const agent = resolveAgent(extra);
      const { workflow, tag } = resolveScope(deps.db, agent);

      const messages = channelRead(deps.db, workflow, tag, {
        since: args.since,
        limit: args.limit ?? 50,
      });

      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(
              messages.map((m) => ({
                id: m.id,
                sender: m.sender,
                content: m.content,
                recipients: m.recipients,
                createdAt: m.createdAt,
              })),
            ),
          },
        ],
      };
    },
  );

  // ==================== Inbox ====================

  server.tool(
    TOOLS.MY_INBOX,
    "Check your inbox for unread @mentions. Returns messages directed to you that you haven't acknowledged yet.",
    {},
    (_args, extra) => {
      const agent = resolveAgent(extra);
      const { workflow, tag } = resolveScope(deps.db, agent);

      const messages = inboxQuery(deps.db, agent, workflow, tag);

      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(
              messages.map((m) => ({
                id: m.message.id,
                sender: m.message.sender,
                content: m.message.content,
                priority: m.priority,
                createdAt: m.message.createdAt,
              })),
            ),
          },
        ],
      };
    },
  );

  server.tool(
    TOOLS.MY_INBOX_ACK,
    "Acknowledge inbox messages up to a specific message ID. Acknowledged messages won't appear in your inbox again.",
    {
      until: z
        .string()
        .optional()
        .describe("Message ID to ack up to. If omitted, acks all current messages."),
    },
    (args, extra) => {
      const agent = resolveAgent(extra);
      const { workflow, tag } = resolveScope(deps.db, agent);

      if (args.until) {
        inboxAck(deps.db, agent, workflow, tag, args.until);
      } else {
        inboxAckAll(deps.db, agent, workflow, tag);
      }

      return {
        content: [{ type: "text" as const, text: JSON.stringify({ acked: true }) }],
      };
    },
  );

  // ==================== Team ====================

  server.tool(
    TOOLS.TEAM_MEMBERS,
    "List all agents in your workflow.",
    {
      includeStatus: z.boolean().optional().describe("Include agent status info."),
    },
    (_args, extra) => {
      const agent = resolveAgent(extra);
      const { workflow, tag } = resolveScope(deps.db, agent);

      const agents = listAgents(deps.db, workflow, tag);

      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(
              agents.map((a) => ({
                name: a.name,
                model: a.model,
                state: a.state,
              })),
            ),
          },
        ],
      };
    },
  );

  server.tool(
    TOOLS.MY_STATUS_SET,
    "Update your status and current task.",
    {
      state: z.enum(["idle", "running"]).optional().describe("Your current state."),
      task: z.string().optional().describe("Description of what you're working on."),
    },
    (args, extra) => {
      const agent = resolveAgent(extra);

      if (args.state) {
        updateAgentState(deps.db, agent, args.state);
      }

      return {
        content: [{ type: "text" as const, text: JSON.stringify({ updated: true }) }],
      };
    },
  );

  // ==================== Resources ====================

  server.tool(
    TOOLS.RESOURCE_CREATE,
    "Store large content as a resource. Returns a resource ID that can be referenced in messages.",
    {
      content: z.string().describe("Content to store."),
      type: z
        .enum(["markdown", "json", "text", "diff"])
        .optional()
        .describe("Content type (default: text)."),
    },
    (args, extra) => {
      const agent = resolveAgent(extra);
      const { workflow, tag } = resolveScope(deps.db, agent);

      const resource = resourceCreate(
        deps.db,
        args.content,
        args.type ?? "text",
        agent,
        workflow,
        tag,
      );

      return {
        content: [
          { type: "text" as const, text: JSON.stringify({ id: resource.id }) },
        ],
      };
    },
  );

  server.tool(
    TOOLS.RESOURCE_READ,
    "Read a stored resource by ID.",
    {
      id: z.string().describe("Resource ID."),
    },
    (args) => {
      const resource = resourceRead(deps.db, args.id);
      if (!resource) {
        return {
          content: [{ type: "text" as const, text: JSON.stringify({ error: "Resource not found" }) }],
          isError: true,
        };
      }

      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify({
              id: resource.id,
              type: resource.type,
              content: resource.content,
              createdBy: resource.createdBy,
            }),
          },
        ],
      };
    },
  );

  return server;
}

// ==================== Helpers ====================

/**
 * Resolve agent name from MCP request extra context.
 * Agent identity flows through sessionId (set by transport).
 */
function resolveAgent(extra: Record<string, unknown>): string {
  const sessionId = (extra as { sessionId?: string }).sessionId;
  if (!sessionId) throw new Error("No agent identity in request");
  return sessionId;
}

/**
 * Resolve workflow/tag scope for an agent.
 */
function resolveScope(
  db: Database,
  agent: string,
): { workflow: string; tag: string } {
  const agentConfig = getAgent(db, agent);
  if (!agentConfig) {
    return { workflow: "global", tag: "main" };
  }
  return { workflow: agentConfig.workflow, tag: agentConfig.tag };
}
