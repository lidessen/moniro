/**
 * Inbox MCP tools — my_inbox, my_inbox_ack, my_status_set
 *
 * Personal agent tools for checking @mentions/DMs
 * and updating agent status.
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { MCPToolContext } from "./types.ts";
import { formatInbox } from "./helpers.ts";

export function registerInboxTools(
  server: McpServer,
  ctx: MCPToolContext,
  options?: { debugLog?: (message: string) => void },
): void {
  const { provider, getAgentId, logTool } = ctx;
  const { debugLog } = options ?? {};

  server.tool(
    "my_inbox",
    "Check your unread inbox messages. Does NOT acknowledge — use my_inbox_ack after processing.",
    {},
    async (_args, extra) => {
      const agent = getAgentId(extra) || "anonymous";
      logTool("my_inbox", agent, {});
      const messages = await provider.getInbox(agent);
      if (debugLog && messages.length > 0) {
        debugLog(`[mcp:${agent}] my_inbox → ${messages.length} unread`);
      }

      return {
        content: [
          {
            type: "text" as const,
            text: formatInbox(messages),
          },
        ],
      };
    },
  );

  server.tool(
    "my_inbox_ack",
    "Acknowledge inbox messages up to a message ID. Call after processing messages.",
    {
      until: z.string().describe("Acknowledge messages up to and including this message ID"),
    },
    async ({ until }, extra) => {
      const agent = getAgentId(extra) || "anonymous";
      logTool("my_inbox_ack", agent, { until });
      await provider.ackInbox(agent, until);

      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify({ status: "acknowledged", until }),
          },
        ],
      };
    },
  );

  server.tool(
    "my_status_set",
    "Update your status and current task. Call when starting or completing work.",
    {
      task: z.string().optional().describe("Current task description (what you're working on)"),
      state: z
        .enum(["idle", "running"])
        .optional()
        .describe("Agent state (running = working, idle = available)"),
      metadata: z
        .record(z.unknown())
        .optional()
        .describe("Additional metadata (e.g., PR number, file path)"),
    },
    async (args, extra) => {
      const agent = getAgentId(extra) || "anonymous";
      logTool("my_status_set", agent, args);

      const status: Partial<import("../types.ts").AgentStatus> = {};
      if (args.task !== undefined) status.task = args.task;
      if (args.state !== undefined) status.state = args.state;
      if (args.metadata !== undefined) status.metadata = args.metadata;

      await provider.setAgentStatus(agent, status);

      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify({
              status: "updated",
              agent,
              ...status,
            }),
          },
        ],
      };
    },
  );
}
