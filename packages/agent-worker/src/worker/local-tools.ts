/**
 * Local Tools — bash/file tools that execute directly in the worker process.
 *
 * Unlike daemon tools (which proxy to the daemon MCP server), these run
 * locally in the worker subprocess. Used by the SDK backend so LLMs can
 * execute shell commands and read/write files.
 *
 * For CLI backends (Claude, Cursor, Codex), these capabilities are built-in.
 */
import { tool, jsonSchema } from "ai";

/**
 * Create local execution tools for SDK backend workers.
 */
export function createLocalTools() {
  return {
    bash: tool({
      description:
        "Execute a bash command and return stdout, stderr, and exit code. Use for running shell commands, scripts, and system operations.",
      inputSchema: jsonSchema<{ command: string; timeout?: number }>({
        type: "object",
        properties: {
          command: {
            type: "string",
            description: "The bash command to execute.",
          },
          timeout: {
            type: "number",
            description: "Timeout in milliseconds (default 30000).",
          },
        },
        required: ["command"],
      }),
      execute: async ({ command, timeout }) => {
        const { execSync } = await import("node:child_process");
        try {
          const stdout = execSync(command, {
            encoding: "utf-8",
            timeout: timeout ?? 30_000,
            stdio: ["pipe", "pipe", "pipe"],
            maxBuffer: 10 * 1024 * 1024, // 10MB
          });
          return { stdout: stdout, stderr: "", exitCode: 0 };
        } catch (error) {
          const e = error as { stdout?: string; stderr?: string; status?: number };
          return {
            stdout: e.stdout ?? "",
            stderr: e.stderr ?? "",
            exitCode: e.status ?? 1,
          };
        }
      },
    }),

    readFile: tool({
      description: "Read the contents of a file from the filesystem.",
      inputSchema: jsonSchema<{ path: string }>({
        type: "object",
        properties: {
          path: {
            type: "string",
            description: "Absolute or relative path to the file.",
          },
        },
        required: ["path"],
      }),
      execute: async ({ path }) => {
        const { readFileSync } = await import("node:fs");
        try {
          const content = readFileSync(path, "utf-8");
          return { content, error: null };
        } catch (error) {
          return { content: null, error: (error as Error).message };
        }
      },
    }),

    writeFile: tool({
      description:
        "Write content to a file on the filesystem. Creates parent directories if needed.",
      inputSchema: jsonSchema<{ path: string; content: string }>({
        type: "object",
        properties: {
          path: {
            type: "string",
            description: "Absolute or relative path to the file.",
          },
          content: {
            type: "string",
            description: "The content to write.",
          },
        },
        required: ["path", "content"],
      }),
      execute: async ({ path, content }) => {
        const { writeFileSync, mkdirSync } = await import("node:fs");
        const { dirname } = await import("node:path");
        try {
          mkdirSync(dirname(path), { recursive: true });
          writeFileSync(path, content, "utf-8");
          return { written: true, path, bytes: content.length };
        } catch (error) {
          return { written: false, error: (error as Error).message };
        }
      },
    }),
  };
}
