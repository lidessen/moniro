/**
 * Channel MCP tools — channel_send, channel_read
 *
 * The shared append-only channel is the primary communication
 * mechanism between agents. Supports @mentions, DMs, and
 * automatic resource conversion for long messages.
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { SendOptions } from "../provider.ts";
import type { MCPToolContext, ChannelToolOptions } from "./types.ts";

const CHANNEL_MSG_LIMIT = 2000;

export function registerChannelTools(
  server: McpServer,
  ctx: MCPToolContext,
  options?: ChannelToolOptions,
): void {
  const { provider, getAgentId, logTool } = ctx;
  const { onMention } = options ?? {};

  server.tool(
    "channel_send",
    `Send a message to the shared channel. Use @agent to mention/notify. Use "to" for private DMs. ` +
      `Long messages (> ${CHANNEL_MSG_LIMIT} chars) are automatically converted to resources.`,
    {
      message: z
        .string()
        .describe(
          "Message content, can include @mentions like @reviewer or @coder. Long messages are auto-converted to resources.",
        ),
      to: z
        .string()
        .optional()
        .describe("Send as DM to a specific agent (private, only you and recipient see it)"),
    },
    async ({ message, to }, extra) => {
      const from = getAgentId(extra) || "anonymous";
      logTool("channel_send", from, { message, to });

      const sendOpts: SendOptions | undefined = to ? { to } : undefined;
      const msg = await provider.smartSend(from, message, sendOpts);

      for (const target of msg.mentions) {
        onMention?.(from, target, msg);
      }
      if (to && !msg.mentions.includes(to)) {
        onMention?.(from, to, msg);
      }

      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify({
              status: "sent",
              timestamp: msg.timestamp,
              mentions: msg.mentions,
              to: msg.to,
            }),
          },
        ],
      };
    },
  );

  server.tool(
    "channel_read",
    "Read messages from the shared channel. DMs and logs are automatically filtered based on your identity.",
    {
      since: z.string().optional().describe("Read entries after this timestamp (ISO format)"),
      limit: z.number().optional().describe("Maximum entries to return"),
    },
    async ({ since, limit }, extra) => {
      const agent = getAgentId(extra);
      logTool("channel_read", agent, { since, limit });
      const entries = await provider.readChannel({ since, limit, agent });

      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(entries),
          },
        ],
      };
    },
  );
}
