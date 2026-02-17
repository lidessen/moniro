/**
 * Tool Dispatch — handles JSON-RPC tool calls from workers over HTTP.
 *
 * Workers POST to /mcp?agent=<name> with JSON-RPC payloads.
 * This module dispatches tool names to context operations,
 * resolving agent identity from the query param.
 *
 * The MCP SDK server (mcp.ts) is for proper MCP transport (SSE/stdio).
 * This module is the current working path for worker→daemon communication.
 */
import type { Database } from "bun:sqlite";
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
import type { AgentState, DocumentProvider, ResourceType } from "../shared/types.ts";

export interface ToolCallResult {
  content: Array<{ type: "text"; text: string }>;
  isError?: boolean;
}

export interface DispatchDeps {
  db: Database;
  documentProvider?: DocumentProvider;
}

function resolveScope(
  db: Database,
  agent: string,
): { workflow: string; tag: string } {
  const agentConfig = getAgent(db, agent);
  if (!agentConfig) return { workflow: "global", tag: "main" };
  return { workflow: agentConfig.workflow, tag: agentConfig.tag };
}

function ok(data: unknown): ToolCallResult {
  return { content: [{ type: "text", text: JSON.stringify(data) }] };
}

function err(message: string): ToolCallResult {
  return {
    content: [{ type: "text", text: JSON.stringify({ error: message }) }],
    isError: true,
  };
}

/**
 * Dispatch a tool call to the appropriate context operation.
 */
export async function dispatchToolCall(
  deps: DispatchDeps,
  agent: string,
  tool: string,
  args: Record<string, unknown>,
): Promise<ToolCallResult> {
  const { db } = deps;
  const scope = () => resolveScope(db, agent);

  switch (tool) {
    // ==================== Channel ====================
    case TOOLS.CHANNEL_SEND: {
      const { workflow, tag } = scope();
      const result = channelSend(db, agent, args.message as string, workflow, tag, {
        to: args.to as string | undefined,
      });
      return ok({ sent: true, id: result.id, recipients: result.recipients });
    }

    case TOOLS.CHANNEL_READ: {
      const { workflow, tag } = scope();
      const messages = channelRead(db, workflow, tag, {
        since: args.since as string | undefined,
        limit: (args.limit as number) ?? 50,
        agent,
      });
      return ok(
        messages.map((m) => ({
          id: m.id,
          sender: m.sender,
          content: m.content,
          recipients: m.recipients,
          createdAt: m.createdAt,
        })),
      );
    }

    // ==================== Inbox ====================
    case TOOLS.MY_INBOX: {
      const { workflow, tag } = scope();
      const messages = inboxQuery(db, agent, workflow, tag);
      return ok(
        messages.map((m) => ({
          id: m.message.id,
          sender: m.message.sender,
          content: m.message.content,
          priority: m.priority,
          createdAt: m.message.createdAt,
        })),
      );
    }

    case TOOLS.MY_INBOX_ACK: {
      const { workflow, tag } = scope();
      if (args.until) {
        inboxAck(db, agent, workflow, tag, args.until as string);
      } else {
        inboxAckAll(db, agent, workflow, tag);
      }
      return ok({ acked: true });
    }

    // ==================== Team ====================
    case TOOLS.TEAM_MEMBERS: {
      const { workflow, tag } = scope();
      const agents = listAgents(db, workflow, tag);
      return ok(agents.map((a) => ({ name: a.name, model: a.model, state: a.state })));
    }

    case TOOLS.MY_STATUS_SET: {
      if (args.state) updateAgentState(db, agent, args.state as AgentState);
      return ok({ updated: true });
    }

    // ==================== Resources ====================
    case TOOLS.RESOURCE_CREATE: {
      const { workflow, tag } = scope();
      const resource = resourceCreate(
        db,
        args.content as string,
        (args.type as ResourceType) ?? "text",
        agent,
        workflow,
        tag,
      );
      return ok({ id: resource.id });
    }

    case TOOLS.RESOURCE_READ: {
      const resource = resourceRead(db, args.id as string);
      if (!resource) return err("Resource not found");
      return ok({
        id: resource.id,
        type: resource.type,
        content: resource.content,
        createdBy: resource.createdBy,
      });
    }

    // ==================== Documents ====================
    case TOOLS.TEAM_DOC_READ: {
      if (!deps.documentProvider) return err("Documents not configured");
      const { workflow, tag } = scope();
      const content = await deps.documentProvider.read(workflow, tag, args.path as string);
      if (content === null) return err("Document not found");
      return { content: [{ type: "text", text: content }] };
    }

    case TOOLS.TEAM_DOC_WRITE: {
      if (!deps.documentProvider) return err("Documents not configured");
      const { workflow, tag } = scope();
      await deps.documentProvider.write(workflow, tag, args.path as string, args.content as string);
      return ok({ written: true, path: args.path });
    }

    case TOOLS.TEAM_DOC_APPEND: {
      if (!deps.documentProvider) return err("Documents not configured");
      const { workflow, tag } = scope();
      await deps.documentProvider.append(
        workflow,
        tag,
        args.path as string,
        args.content as string,
      );
      return ok({ appended: true, path: args.path });
    }

    case TOOLS.TEAM_DOC_LIST: {
      if (!deps.documentProvider) return err("Documents not configured");
      const { workflow, tag } = scope();
      const files = await deps.documentProvider.list(workflow, tag);
      return ok({ documents: files });
    }

    case TOOLS.TEAM_DOC_CREATE: {
      if (!deps.documentProvider) return err("Documents not configured");
      const { workflow, tag } = scope();
      try {
        await deps.documentProvider.create(
          workflow,
          tag,
          args.path as string,
          args.content as string,
        );
        return ok({ created: true, path: args.path });
      } catch (e) {
        return err((e as Error).message);
      }
    }

    // ==================== Proposals ====================
    case TOOLS.TEAM_PROPOSAL_CREATE: {
      const { workflow, tag } = scope();
      const proposal = proposalCreate(db, {
        type: args.type as "election" | "decision" | "approval" | "assignment",
        title: args.title as string,
        options: args.options as string[],
        resolution: args.resolution as "plurality" | "majority" | "unanimous" | undefined,
        binding: args.binding as boolean | undefined,
        creator: agent,
        workflow,
        tag,
      });
      return ok({ id: proposal.id, title: proposal.title, options: proposal.options });
    }

    case TOOLS.TEAM_VOTE: {
      const result = proposalVote(
        db,
        args.proposalId as string,
        agent,
        args.choice as string,
        args.reason as string | undefined,
      );
      return {
        content: [{ type: "text", text: JSON.stringify(result) }],
        isError: !result.success,
      };
    }

    case TOOLS.TEAM_PROPOSAL_STATUS: {
      const proposal = proposalGet(db, args.proposalId as string);
      if (!proposal) return err("Proposal not found");
      const votes = voteList(db, args.proposalId as string);
      return ok({
        ...proposal,
        votes: votes.map((v) => ({ agent: v.agent, choice: v.choice, reason: v.reason })),
      });
    }

    case TOOLS.TEAM_PROPOSAL_CANCEL: {
      const result = proposalCancel(db, args.proposalId as string, agent);
      return {
        content: [{ type: "text", text: JSON.stringify(result) }],
        isError: !result.success,
      };
    }

    default:
      return err(`Unknown tool: ${tool}`);
  }
}
