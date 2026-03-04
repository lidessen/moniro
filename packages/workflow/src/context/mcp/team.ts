/**
 * Team MCP tools — team_members, team_doc_*
 *
 * Shared workspace tools for agent collaboration:
 * team member discovery and shared document operations.
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { MCPToolContext } from "./types.ts";

export function registerTeamTools(server: McpServer, ctx: MCPToolContext): void {
  const { provider, validAgents, getAgentId, logTool } = ctx;

  server.tool(
    "team_members",
    "List all agents in this workflow. Use to discover who you can @mention. Optionally includes agent status (state, current task).",
    {
      includeStatus: z.boolean().optional().describe("Include agent status information"),
    },
    async (args, extra) => {
      const currentAgent = getAgentId(extra) || "anonymous";
      const includeStatus = args.includeStatus ?? false;

      const agents = validAgents.map((name) => ({
        name,
        mention: `@${name}`,
        isYou: name === currentAgent,
      }));

      const result: {
        agents: typeof agents;
        count: number;
        status?: Record<string, unknown>;
        hint: string;
      } = {
        agents,
        count: agents.length,
        hint: "Use @agent in channel_send to mention other agents",
      };

      if (includeStatus) {
        const statuses = await provider.listAgentStatus();
        result.status = statuses;
      }

      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(result),
          },
        ],
      };
    },
  );

  // ── Document tools ────────────────────────────────────────────

  server.tool(
    "team_doc_read",
    "Read a shared team document.",
    {
      file: z.string().optional().describe("Document file path (default: notes.md)"),
    },
    async ({ file }, extra) => {
      const agent = getAgentId(extra);
      logTool("team_doc_read", agent, { file });
      const content = await provider.readDocument(file);

      return {
        content: [
          {
            type: "text" as const,
            text: content || "(empty document)",
          },
        ],
      };
    },
  );

  server.tool(
    "team_doc_write",
    "Write/replace a shared team document.",
    {
      content: z.string().describe("New document content (replaces existing)"),
      file: z.string().optional().describe("Document file path (default: notes.md)"),
    },
    async ({ content, file }, extra) => {
      const agent = getAgentId(extra);
      logTool("team_doc_write", agent, { file, contentLen: content.length });
      await provider.writeDocument(content, file);

      return {
        content: [
          {
            type: "text" as const,
            text: `Document ${file || "notes.md"} written successfully`,
          },
        ],
      };
    },
  );

  server.tool(
    "team_doc_append",
    "Append content to a shared team document.",
    {
      content: z.string().describe("Content to append to the document"),
      file: z.string().optional().describe("Document file path (default: notes.md)"),
    },
    async ({ content, file }, extra) => {
      const agent = getAgentId(extra);
      logTool("team_doc_append", agent, { file, contentLen: content.length });
      await provider.appendDocument(content, file);

      return {
        content: [
          {
            type: "text" as const,
            text: `Content appended to ${file || "notes.md"}`,
          },
        ],
      };
    },
  );

  server.tool("team_doc_list", "List all shared team document files.", {}, async () => {
    const files = await provider.listDocuments();

    return {
      content: [
        {
          type: "text" as const,
          text: JSON.stringify({ files, count: files.length }),
        },
      ],
    };
  });

  server.tool(
    "team_doc_create",
    "Create a new shared team document file.",
    {
      file: z.string().describe('Document file path (e.g., "findings/auth.md")'),
      content: z.string().describe("Initial document content"),
    },
    async ({ file, content }) => {
      await provider.createDocument(file, content);

      return {
        content: [
          {
            type: "text" as const,
            text: `Document ${file} created successfully`,
          },
        ],
      };
    },
  );
}
