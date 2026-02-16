/**
 * Skills MCP tool — skills_list, skills_view, skills_read
 *
 * Exposes skills to agents via MCP protocol.
 * Same SkillsProvider as the SDK tool, different transport.
 *
 * SDK version: agent/tools/skills.ts (for ToolLoopAgent)
 * MCP version: this file (for McpServer)
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { SkillsProvider } from "../../../agent/skills/provider.ts";

export function registerSkillsTools(server: McpServer, provider: SkillsProvider): void {
  server.tool(
    "skills_list",
    "List all available agent skills with their descriptions.",
    {},
    async () => {
      const skills = provider.list();

      if (skills.length === 0) {
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({ message: "No skills available" }),
            },
          ],
        };
      }

      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify({
              skills: skills.map((s) => ({
                name: s.name,
                description: s.description,
              })),
            }),
          },
        ],
      };
    },
  );

  server.tool(
    "skills_view",
    "Read the complete SKILL.md file for a skill.",
    {
      skillName: z.string().describe("Skill name to view"),
    },
    async ({ skillName }) => {
      const content = await provider.view(skillName);

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

  server.tool(
    "skills_read",
    "Read a file within a skill directory (e.g., references/, scripts/, assets/).",
    {
      skillName: z.string().describe("Skill name"),
      filePath: z
        .string()
        .describe('Relative file path within the skill (e.g., "references/search-strategies.md")'),
    },
    async ({ skillName, filePath }) => {
      const content = await provider.readFile(skillName, filePath);

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
