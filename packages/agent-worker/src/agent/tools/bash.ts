/**
 * Integration with Vercel's bash-tool for file system operations
 *
 * Provides bash, readFile, writeFile tools for AI agents in a sandboxed environment
 */

import { createBashTool, type CreateBashToolOptions, type BashToolkit } from "bash-tool";
import { tool, jsonSchema } from "ai";

export type { CreateBashToolOptions, BashToolkit };
export { createBashTool };

/**
 * Options for creating bash tools compatible with AgentSession
 */
export interface BashToolsOptions extends CreateBashToolOptions {
  /**
   * Include readFile tool (default: true)
   */
  includeReadFile?: boolean;
  /**
   * Include writeFile tool (default: true)
   */
  includeWriteFile?: boolean;
}

/**
 * Create bash tools as AI SDK tool() objects for use with AgentSession
 *
 * @example
 * ```typescript
 * const { tools } = await createBashTools({
 *   files: { 'src/index.ts': 'console.log("hello")' }
 * })
 *
 * const session = new AgentSession({
 *   model: 'anthropic/claude-sonnet-4-5',
 *   system: 'You are a coding assistant.',
 *   tools
 * })
 * ```
 */
export async function createBashTools(
  options: BashToolsOptions = {},
): Promise<{ tools: Record<string, unknown>; toolkit: BashToolkit }> {
  const { includeReadFile = true, includeWriteFile = true, ...bashOptions } = options;

  const toolkit = await createBashTool(bashOptions);

  const tools: Record<string, unknown> = {};

  tools.bash = tool({
    description:
      "Execute bash commands in a sandboxed environment. Returns stdout, stderr, and exit code.",
    inputSchema: jsonSchema({
      type: "object",
      properties: {
        command: {
          type: "string",
          description: "The bash command to execute",
        },
      },
      required: ["command"],
    }),
    execute: async (args: Record<string, unknown>) => {
      const bashTool = toolkit.tools.bash;
      if (!bashTool?.execute) {
        throw new Error("Bash tool not available");
      }
      return bashTool.execute(args as { command: string }, {} as never);
    },
  });

  if (includeReadFile) {
    tools.readFile = tool({
      description: "Read the contents of a file from the sandbox filesystem.",
      inputSchema: jsonSchema({
        type: "object",
        properties: {
          path: {
            type: "string",
            description: "The path to the file to read",
          },
        },
        required: ["path"],
      }),
      execute: async (args: Record<string, unknown>) => {
        const readFileTool = toolkit.tools.readFile;
        if (!readFileTool?.execute) {
          throw new Error("ReadFile tool not available");
        }
        return readFileTool.execute(args as { path: string }, {} as never);
      },
    });
  }

  if (includeWriteFile) {
    tools.writeFile = tool({
      description:
        "Write content to a file in the sandbox filesystem. Creates parent directories if needed.",
      inputSchema: jsonSchema({
        type: "object",
        properties: {
          path: {
            type: "string",
            description: "The path to the file to write",
          },
          content: {
            type: "string",
            description: "The content to write to the file",
          },
        },
        required: ["path", "content"],
      }),
      execute: async (args: Record<string, unknown>) => {
        const writeFileTool = toolkit.tools.writeFile;
        if (!writeFileTool?.execute) {
          throw new Error("WriteFile tool not available");
        }
        return writeFileTool.execute(args as { path: string; content: string }, {} as never);
      },
    });
  }

  return { tools, toolkit };
}

/**
 * Quick helper to create bash tools with a directory
 */
export async function createBashToolsFromDirectory(
  source: string,
  options: Omit<BashToolsOptions, "uploadDirectory"> = {},
): Promise<{ tools: Record<string, unknown>; toolkit: BashToolkit }> {
  return createBashTools({
    ...options,
    uploadDirectory: { source },
  });
}

/**
 * Quick helper to create bash tools with inline files
 */
export async function createBashToolsFromFiles(
  files: Record<string, string>,
  options: Omit<BashToolsOptions, "files"> = {},
): Promise<{ tools: Record<string, unknown>; toolkit: BashToolkit }> {
  return createBashTools({
    ...options,
    files,
  });
}
