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
    // ==================== Channel ====================

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

    channel_read: tool({
      description: "Read recent messages from the team channel.",
      inputSchema: jsonSchema<{ limit?: number; since?: string }>({
        type: "object",
        properties: {
          limit: {
            type: "number",
            description: "Max messages to return (default 20).",
          },
          since: {
            type: "string",
            description: "Return messages after this message ID.",
          },
        },
      }),
      execute: async ({ limit, since }) => {
        return await daemon.channelRead({ limit: limit ?? 20, since });
      },
    }),

    // ==================== Inbox ====================

    my_inbox: tool({
      description: "Read your unread inbox messages. These are messages that mention you or are addressed to you.",
      inputSchema: jsonSchema<Record<string, never>>({
        type: "object",
        properties: {},
      }),
      execute: async () => {
        return await daemon.myInbox();
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

    // ==================== Team ====================

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

    my_status_set: tool({
      description: "Update your current status (state).",
      inputSchema: jsonSchema<{ state: string }>({
        type: "object",
        properties: {
          state: {
            type: "string",
            description: "Your state: idle, running, or stopped.",
          },
        },
        required: ["state"],
      }),
      execute: async ({ state }) => {
        return await daemon.call("my_status_set", { state });
      },
    }),

    // ==================== Resources ====================

    resource_create: tool({
      description: "Store a large piece of content as a resource. Returns a resource ID that can be shared with other agents.",
      inputSchema: jsonSchema<{ content: string; type?: string }>({
        type: "object",
        properties: {
          content: {
            type: "string",
            description: "The content to store.",
          },
          type: {
            type: "string",
            description: "Content type: text, markdown, json, or diff. Defaults to text.",
          },
        },
        required: ["content"],
      }),
      execute: async ({ content, type }) => {
        return await daemon.call("resource_create", { content, type });
      },
    }),

    resource_read: tool({
      description: "Read a stored resource by its ID.",
      inputSchema: jsonSchema<{ id: string }>({
        type: "object",
        properties: {
          id: {
            type: "string",
            description: "The resource ID (e.g., res_abc123).",
          },
        },
        required: ["id"],
      }),
      execute: async ({ id }) => {
        return await daemon.call("resource_read", { id });
      },
    }),

    // ==================== Documents ====================

    team_doc_read: tool({
      description: "Read a shared team document.",
      inputSchema: jsonSchema<{ path: string }>({
        type: "object",
        properties: {
          path: {
            type: "string",
            description: "Document path within the workspace.",
          },
        },
        required: ["path"],
      }),
      execute: async ({ path }) => {
        return await daemon.call("team_doc_read", { path });
      },
    }),

    team_doc_write: tool({
      description: "Write (overwrite) a shared team document.",
      inputSchema: jsonSchema<{ path: string; content: string }>({
        type: "object",
        properties: {
          path: {
            type: "string",
            description: "Document path within the workspace.",
          },
          content: {
            type: "string",
            description: "Content to write.",
          },
        },
        required: ["path", "content"],
      }),
      execute: async ({ path, content }) => {
        return await daemon.call("team_doc_write", { path, content });
      },
    }),

    team_doc_append: tool({
      description: "Append content to a shared team document.",
      inputSchema: jsonSchema<{ path: string; content: string }>({
        type: "object",
        properties: {
          path: {
            type: "string",
            description: "Document path within the workspace.",
          },
          content: {
            type: "string",
            description: "Content to append.",
          },
        },
        required: ["path", "content"],
      }),
      execute: async ({ path, content }) => {
        return await daemon.call("team_doc_append", { path, content });
      },
    }),

    team_doc_list: tool({
      description: "List all shared team documents.",
      inputSchema: jsonSchema<Record<string, never>>({
        type: "object",
        properties: {},
      }),
      execute: async () => {
        return await daemon.call("team_doc_list", {});
      },
    }),

    team_doc_create: tool({
      description: "Create a new shared team document. Fails if the document already exists.",
      inputSchema: jsonSchema<{ path: string; content: string }>({
        type: "object",
        properties: {
          path: {
            type: "string",
            description: "Document path within the workspace.",
          },
          content: {
            type: "string",
            description: "Initial content.",
          },
        },
        required: ["path", "content"],
      }),
      execute: async ({ path, content }) => {
        return await daemon.call("team_doc_create", { path, content });
      },
    }),

    // ==================== Proposals ====================

    team_proposal_create: tool({
      description: "Create a proposal for team voting. Use for decisions that need consensus.",
      inputSchema: jsonSchema<{
        type: string;
        title: string;
        options: string[];
        resolution?: string;
        binding?: boolean;
      }>({
        type: "object",
        properties: {
          type: {
            type: "string",
            description: "Proposal type: election, decision, approval, or assignment.",
          },
          title: {
            type: "string",
            description: "What is being decided.",
          },
          options: {
            type: "array",
            items: { type: "string" },
            description: "Available choices.",
          },
          resolution: {
            type: "string",
            description: "Resolution strategy: plurality, majority, or unanimous. Defaults to plurality.",
          },
          binding: {
            type: "boolean",
            description: "Whether the result is binding. Defaults to true.",
          },
        },
        required: ["type", "title", "options"],
      }),
      execute: async ({ type, title, options, resolution, binding }) => {
        return await daemon.call("team_proposal_create", { type, title, options, resolution, binding });
      },
    }),

    team_vote: tool({
      description: "Vote on an active proposal.",
      inputSchema: jsonSchema<{ proposalId: string; choice: string; reason?: string }>({
        type: "object",
        properties: {
          proposalId: {
            type: "string",
            description: "The proposal ID to vote on.",
          },
          choice: {
            type: "string",
            description: "Your chosen option (must be one of the proposal's options).",
          },
          reason: {
            type: "string",
            description: "Optional reason for your vote.",
          },
        },
        required: ["proposalId", "choice"],
      }),
      execute: async ({ proposalId, choice, reason }) => {
        return await daemon.call("team_vote", { proposalId, choice, reason });
      },
    }),

    team_proposal_status: tool({
      description: "Check the current status and votes on a proposal.",
      inputSchema: jsonSchema<{ proposalId: string }>({
        type: "object",
        properties: {
          proposalId: {
            type: "string",
            description: "The proposal ID to check.",
          },
        },
        required: ["proposalId"],
      }),
      execute: async ({ proposalId }) => {
        return await daemon.call("team_proposal_status", { proposalId });
      },
    }),

    team_proposal_cancel: tool({
      description: "Cancel a proposal you created.",
      inputSchema: jsonSchema<{ proposalId: string }>({
        type: "object",
        properties: {
          proposalId: {
            type: "string",
            description: "The proposal ID to cancel.",
          },
        },
        required: ["proposalId"],
      }),
      execute: async ({ proposalId }) => {
        return await daemon.call("team_proposal_cancel", { proposalId });
      },
    }),
  };
}
