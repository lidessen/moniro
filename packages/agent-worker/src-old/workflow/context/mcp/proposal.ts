/**
 * Proposal MCP tools — team_proposal_create, team_vote,
 * team_proposal_status, team_proposal_cancel
 *
 * Structured decision-making via proposals and voting.
 * Only registered when a ProposalManager is provided.
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { formatProposal, formatProposalList, type ProposalManager } from "../proposals.ts";
import type { MCPToolContext } from "./types.ts";

export function registerProposalTools(
  server: McpServer,
  ctx: MCPToolContext,
  proposalManager: ProposalManager,
): void {
  const { provider, validAgents, getAgentId } = ctx;

  server.tool(
    "team_proposal_create",
    "Create a new proposal for team voting. Use for decisions, elections, approvals, or assignments.",
    {
      type: z.enum(["election", "decision", "approval", "assignment"]).describe("Type of proposal"),
      title: z.string().describe("Brief title for the proposal"),
      description: z.string().optional().describe("Detailed description"),
      options: z
        .array(
          z.object({
            id: z.string().describe("Unique option identifier"),
            label: z.string().describe("Display label for the option"),
          }),
        )
        .optional()
        .describe("Voting options (required except for approval type)"),
      resolution: z
        .object({
          type: z
            .enum(["plurality", "majority", "unanimous"])
            .optional()
            .describe("How to determine winner"),
          quorum: z.number().optional().describe("Minimum votes required"),
          tieBreaker: z
            .enum(["first", "random", "creator-decides"])
            .optional()
            .describe("How to break ties"),
        })
        .optional()
        .describe("Resolution rules"),
      binding: z.boolean().optional().describe("Whether result is binding (default: true)"),
      timeoutSeconds: z.number().optional().describe("Timeout in seconds (default: 3600)"),
    },
    async (params, extra) => {
      const createdBy = getAgentId(extra) || "anonymous";

      try {
        const proposal = proposalManager.create({
          type: params.type,
          title: params.title,
          description: params.description,
          options: params.options,
          resolution: params.resolution,
          binding: params.binding,
          timeoutSeconds: params.timeoutSeconds,
          createdBy,
        });

        const optionsList = proposal.options.map((o) => `${o.id}: ${o.label}`).join(", ");
        const otherAgents = validAgents
          .filter((a) => a !== createdBy)
          .map((a) => `@${a}`)
          .join(" ");
        await provider.appendChannel(
          createdBy,
          `Created proposal "${proposal.title}" (${proposal.id})\nOptions: ${optionsList}\nUse team_vote tool to cast your vote. ${otherAgents}`,
        );

        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({
                status: "created",
                proposal: {
                  id: proposal.id,
                  title: proposal.title,
                  options: proposal.options,
                  expiresAt: proposal.expiresAt,
                },
              }),
            },
          ],
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({
                status: "error",
                error: error instanceof Error ? error.message : String(error),
              }),
            },
          ],
        };
      }
    },
  );

  server.tool(
    "team_vote",
    "Cast your vote on a team proposal.",
    {
      proposal: z.string().describe("Proposal ID (e.g., prop-1)"),
      choice: z.string().describe("Option ID to vote for"),
      reason: z.string().optional().describe("Optional reason for your vote"),
    },
    async ({ proposal: proposalId, choice, reason }, extra) => {
      const voter = getAgentId(extra) || "anonymous";

      const result = proposalManager.vote({
        proposalId,
        voter,
        choice,
        reason,
      });

      if (!result.success) {
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({ status: "error", error: result.error }),
            },
          ],
        };
      }

      const reasonText = reason ? ` (reason: ${reason})` : "";
      await provider.appendChannel(voter, `Voted "${choice}" on ${proposalId}${reasonText}`);

      if (result.resolved && result.proposal) {
        const winnerOption = result.proposal.options.find(
          (o) => o.id === result.proposal!.result?.winner,
        );
        const voters = Object.keys(result.proposal.result?.votes || {});
        const mentions = voters.map((v) => `@${v}`).join(" ");
        await provider.appendChannel(
          "system",
          `Proposal ${proposalId} resolved! Winner: ${winnerOption?.label || result.proposal.result?.winner || "none"} ${mentions}`,
        );
      }

      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify({
              status: "voted",
              proposal: proposalId,
              choice,
              resolved: result.resolved,
              winner: result.proposal?.result?.winner,
            }),
          },
        ],
      };
    },
  );

  server.tool(
    "team_proposal_status",
    "Check status of team proposals. Omit proposal ID to see all active proposals.",
    {
      proposal: z.string().optional().describe("Proposal ID (omit for all active)"),
    },
    async ({ proposal: proposalId }) => {
      if (proposalId) {
        const proposal = proposalManager.get(proposalId);
        if (!proposal) {
          return {
            content: [
              {
                type: "text" as const,
                text: JSON.stringify({
                  status: "error",
                  error: `Proposal not found: ${proposalId}`,
                }),
              },
            ],
          };
        }

        return {
          content: [
            {
              type: "text" as const,
              text: formatProposal(proposal),
            },
          ],
        };
      }

      const activeProposals = proposalManager.list("active");

      return {
        content: [
          {
            type: "text" as const,
            text:
              activeProposals.length > 0
                ? formatProposalList(activeProposals)
                : "(no active proposals)",
          },
        ],
      };
    },
  );

  server.tool(
    "team_proposal_cancel",
    "Cancel a proposal you created.",
    {
      proposal: z.string().describe("Proposal ID to cancel"),
    },
    async ({ proposal: proposalId }, extra) => {
      const cancelledBy = getAgentId(extra) || "anonymous";

      const result = proposalManager.cancel(proposalId, cancelledBy);

      if (!result.success) {
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({ status: "error", error: result.error }),
            },
          ],
        };
      }

      await provider.appendChannel(cancelledBy, `Cancelled proposal ${proposalId}`);

      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify({ status: "cancelled", proposal: proposalId }),
          },
        ],
      };
    },
  );
}
