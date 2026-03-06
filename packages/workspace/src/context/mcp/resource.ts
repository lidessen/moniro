/**
 * Resource MCP tools — resource_create, resource_read
 *
 * General-purpose reference mechanism. Resources can be
 * referenced from channel messages, documents, or anywhere
 * via resource:id URIs.
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { ResourceType } from "../types.ts";
import type { MCPToolContext } from "./types.ts";

export function registerResourceTools(server: McpServer, ctx: MCPToolContext): void {
  const { provider, getAgentId, logTool } = ctx;

  server.tool(
    "resource_create",
    "Store large content as a resource. Returns a reference (resource:id) usable in channel messages or documents.",
    {
      content: z.string().describe("Content to store as resource"),
      type: z
        .enum(["markdown", "json", "text", "diff"])
        .optional()
        .describe("Content type hint (default: text)"),
    },
    async ({ content, type }, extra) => {
      const createdBy = getAgentId(extra) || "anonymous";
      logTool("resource_create", createdBy, { type, contentLen: content.length });
      const result = await provider.createResource(content, createdBy, type as ResourceType);

      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify({
              id: result.id,
              ref: result.ref,
              hint: `Use [description](${result.ref}) in messages or documents`,
            }),
          },
        ],
      };
    },
  );

  server.tool(
    "resource_read",
    "Read resource content by ID. Use when you encounter resource:id references.",
    {
      id: z.string().describe("Resource ID (e.g., res_abc123)"),
    },
    async ({ id }) => {
      const content = await provider.readResource(id);

      if (content === null) {
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({ error: `Resource not found: ${id}` }),
            },
          ],
        };
      }

      return {
        content: [
          {
            type: "text" as const,
            text: content,
          },
        ],
      };
    },
  );
}
