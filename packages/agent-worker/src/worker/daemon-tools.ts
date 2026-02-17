/**
 * Daemon Tools — Vercel AI SDK tool definitions that proxy to the Daemon MCP server.
 *
 * For CLI backends, MCP is handled natively via --mcp-config.
 * For the SDK backend, we need explicit tool definitions so generateText
 * can call tools in a loop (LLM requests tool → execute locally → return result).
 *
 * NOTE: AI SDK v6 renamed `parameters` → `inputSchema`. We use `jsonSchema()`
 * instead of Zod because AI SDK v6's zod3ToJsonSchema produces empty schemas.
 */
import { tool, jsonSchema } from "ai";
import type { DaemonMcpClient } from "./mcp-client.ts";

/**
 * Create Vercel AI SDK tools from a Daemon MCP client.
 * These are the collaboration tools agents use to communicate.
 */
export function createDaemonTools(daemon: DaemonMcpClient) {
  return {
    channel_send: tool({
      description:
        "Send a message to the team channel. Use @mentions to address specific agents (e.g., @reviewer). Your message will appear in their inbox.",
      inputSchema: jsonSchema<{ message: string; to?: string }>({
        type: "object",
        properties: {
          message: {
            type: "string",
            description: "The message content. Use @agent_name to mention team members.",
          },
          to: {
            type: "string",
            description: "Direct message to a specific agent (private, not visible to others).",
          },
        },
        required: ["message"],
      }),
      execute: async ({ message, to }) => {
        return await daemon.channelSend(message, to);
      },
    }),

    my_inbox_ack: tool({
      description:
        "Acknowledge inbox messages as processed. Call this after you have handled all your inbox messages.",
      inputSchema: jsonSchema<{ until?: string }>({
        type: "object",
        properties: {
          until: {
            type: "string",
            description: "Acknowledge up to this message ID. Omit to ack all.",
          },
        },
      }),
      execute: async ({ until }) => {
        await daemon.myInboxAck(until);
        return { acked: true };
      },
    }),

    channel_read: tool({
      description: "Read recent messages from the team channel.",
      inputSchema: jsonSchema<{ limit?: number }>({
        type: "object",
        properties: {
          limit: {
            type: "number",
            description: "Max messages to return (default 20).",
          },
        },
      }),
      execute: async ({ limit }) => {
        return await daemon.channelRead({ limit: limit ?? 20 });
      },
    }),

    team_members: tool({
      description: "List all team members and their current state.",
      inputSchema: jsonSchema<Record<string, never>>({
        type: "object",
        properties: {},
      }),
      execute: async () => {
        return await daemon.teamMembers();
      },
    }),
  };
}
