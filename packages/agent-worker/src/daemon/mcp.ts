/**
 * Daemon MCP Server — context tools exposed to workers.
 *
 * Workers connect via HTTP, identified by ?agent=<name> query param.
 * Each tool handler is a thin wrapper over context operations.
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
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
import {
  proposalCreate,
  proposalGet,
  proposalVote,
  proposalCancel,
  voteList,
} from "./proposals.ts";
import type { DocumentProvider } from "../shared/types.ts";

export interface McpDeps {
  db: Database;
  documentProvider?: DocumentProvider;
}

/**
 * Create the Daemon MCP server with all context tools.
 */
export function createMcpServer(deps: McpDeps): McpServer {
  const server = new McpServer({
    name: "agent-worker-daemon",
    version: "1.0.0",
  });

  // Typed wrapper — tsgo can't resolve McpServer.tool() overloads with zod v3/v4 compat
  const tool = server.tool.bind(server) as (
    name: string,
    description: string,
    schema: Record<string, unknown>,
    cb: (...args: any[]) => any,
  ) => void;

  // ==================== Channel ====================

  tool(
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

  tool(
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

  tool(
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

  tool(
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

  tool(
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

  tool(
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

  tool(
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

  tool(
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

  // ==================== Documents ====================

  if (deps.documentProvider) {
    const docProvider = deps.documentProvider;

    tool(
      TOOLS.TEAM_DOC_READ,
      "Read a team document.",
      {
        path: z.string().describe("Document path (e.g., 'notes.md')."),
      },
      async (args, extra) => {
        const agent = resolveAgent(extra);
        const { workflow, tag } = resolveScope(deps.db, agent);

        const content = await docProvider.read(workflow, tag, args.path);
        if (content === null) {
          return {
            content: [{ type: "text" as const, text: JSON.stringify({ error: "Document not found" }) }],
            isError: true,
          };
        }

        return {
          content: [{ type: "text" as const, text: content }],
        };
      },
    );

    tool(
      TOOLS.TEAM_DOC_WRITE,
      "Write (create or overwrite) a team document.",
      {
        path: z.string().describe("Document path."),
        content: z.string().describe("Content to write."),
      },
      async (args, extra) => {
        const agent = resolveAgent(extra);
        const { workflow, tag } = resolveScope(deps.db, agent);

        await docProvider.write(workflow, tag, args.path, args.content);

        return {
          content: [{ type: "text" as const, text: JSON.stringify({ written: true, path: args.path }) }],
        };
      },
    );

    tool(
      TOOLS.TEAM_DOC_APPEND,
      "Append content to a team document.",
      {
        path: z.string().describe("Document path."),
        content: z.string().describe("Content to append."),
      },
      async (args, extra) => {
        const agent = resolveAgent(extra);
        const { workflow, tag } = resolveScope(deps.db, agent);

        await docProvider.append(workflow, tag, args.path, args.content);

        return {
          content: [{ type: "text" as const, text: JSON.stringify({ appended: true, path: args.path }) }],
        };
      },
    );

    tool(
      TOOLS.TEAM_DOC_LIST,
      "List available team documents.",
      {},
      async (_args, extra) => {
        const agent = resolveAgent(extra);
        const { workflow, tag } = resolveScope(deps.db, agent);

        const files = await docProvider.list(workflow, tag);

        return {
          content: [{ type: "text" as const, text: JSON.stringify({ documents: files }) }],
        };
      },
    );

    tool(
      TOOLS.TEAM_DOC_CREATE,
      "Create a new team document (fails if it already exists).",
      {
        path: z.string().describe("Document path."),
        content: z.string().describe("Initial content."),
      },
      async (args, extra) => {
        const agent = resolveAgent(extra);
        const { workflow, tag } = resolveScope(deps.db, agent);

        try {
          await docProvider.create(workflow, tag, args.path, args.content);
          return {
            content: [{ type: "text" as const, text: JSON.stringify({ created: true, path: args.path }) }],
          };
        } catch (err) {
          return {
            content: [{ type: "text" as const, text: JSON.stringify({ error: (err as Error).message }) }],
            isError: true,
          };
        }
      },
    );
  }

  // ==================== Proposals ====================

  tool(
    TOOLS.TEAM_PROPOSAL_CREATE,
    "Create a proposal for team voting. Options are the choices agents can vote on.",
    {
      type: z.enum(["election", "decision", "approval", "assignment"]).describe("Proposal type."),
      title: z.string().describe("Proposal title."),
      options: z.array(z.string()).describe("Voting options."),
      resolution: z.enum(["plurality", "majority", "unanimous"]).optional().describe("Resolution strategy (default: plurality)."),
      binding: z.boolean().optional().describe("Whether the result is binding (default: true)."),
    },
    (args, extra) => {
      const agent = resolveAgent(extra);
      const { workflow, tag } = resolveScope(deps.db, agent);

      const proposal = proposalCreate(deps.db, {
        type: args.type,
        title: args.title,
        options: args.options,
        resolution: args.resolution,
        binding: args.binding,
        creator: agent,
        workflow,
        tag,
      });

      return {
        content: [{ type: "text" as const, text: JSON.stringify({ id: proposal.id, title: proposal.title, options: proposal.options }) }],
      };
    },
  );

  tool(
    TOOLS.TEAM_VOTE,
    "Vote on an active proposal.",
    {
      proposalId: z.string().describe("Proposal ID."),
      choice: z.string().describe("Your vote (must be one of the proposal options)."),
      reason: z.string().optional().describe("Reason for your vote."),
    },
    (args, extra) => {
      const agent = resolveAgent(extra);

      const result = proposalVote(deps.db, args.proposalId, agent, args.choice, args.reason);

      return {
        content: [{ type: "text" as const, text: JSON.stringify(result) }],
        isError: !result.success,
      };
    },
  );

  tool(
    TOOLS.TEAM_PROPOSAL_STATUS,
    "Check the status of a proposal, including votes.",
    {
      proposalId: z.string().describe("Proposal ID."),
    },
    (args) => {
      const proposal = proposalGet(deps.db, args.proposalId);
      if (!proposal) {
        return {
          content: [{ type: "text" as const, text: JSON.stringify({ error: "Proposal not found" }) }],
          isError: true,
        };
      }

      const votes = voteList(deps.db, args.proposalId);

      return {
        content: [{
          type: "text" as const,
          text: JSON.stringify({
            ...proposal,
            votes: votes.map((v) => ({ agent: v.agent, choice: v.choice, reason: v.reason })),
          }),
        }],
      };
    },
  );

  tool(
    TOOLS.TEAM_PROPOSAL_CANCEL,
    "Cancel an active proposal (only the creator can cancel).",
    {
      proposalId: z.string().describe("Proposal ID."),
    },
    (args, extra) => {
      const agent = resolveAgent(extra);
      const result = proposalCancel(deps.db, args.proposalId, agent);

      return {
        content: [{ type: "text" as const, text: JSON.stringify(result) }],
        isError: !result.success,
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
