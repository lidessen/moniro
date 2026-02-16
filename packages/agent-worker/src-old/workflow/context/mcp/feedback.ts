/**
 * Feedback MCP tool — feedback_submit
 *
 * Lets agents surface workflow improvement needs via MCP.
 * Only registered when feedback is enabled.
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { FeedbackEntry } from "../../../agent/tools/feedback.ts";
import type { MCPToolContext } from "./types.ts";

/**
 * Register the feedback_submit tool and return a getter for collected entries.
 */
export function registerFeedbackTool(
  server: McpServer,
  ctx: MCPToolContext,
): { getFeedback: () => FeedbackEntry[] } {
  const { getAgentId, logTool } = ctx;
  const entries: FeedbackEntry[] = [];

  server.tool(
    "feedback_submit",
    "Report a workflow improvement need. Use when you hit something inconvenient — a missing tool, an awkward step, or a capability you wished you had.",
    {
      target: z
        .string()
        .describe(
          "The area this is about — a tool name, a workflow step, or a general area (e.g. file search, code review).",
        ),
      type: z
        .enum(["missing", "friction", "suggestion"])
        .describe(
          "missing: a tool or capability you needed but didn't have. friction: something that works but is awkward or slow. suggestion: a concrete improvement idea.",
        ),
      description: z.string().describe("What you needed or what could be improved. Be specific."),
      context: z
        .string()
        .optional()
        .describe("Optional: what you were trying to do when you hit this."),
    },
    async ({ target, type, description, context: ctx }, extra) => {
      const from = getAgentId(extra) || "anonymous";
      logTool("feedback_submit", from, { target, type });

      const entry: FeedbackEntry = {
        timestamp: new Date().toISOString(),
        target,
        type,
        description,
        ...(ctx ? { context: ctx } : {}),
      };

      if (entries.length >= 50) {
        entries.shift();
      }
      entries.push(entry);

      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify({ status: "recorded" }),
          },
        ],
      };
    },
  );

  return { getFeedback: () => [...entries] };
}
