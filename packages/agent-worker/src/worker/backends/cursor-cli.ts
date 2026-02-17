/**
 * Cursor CLI backend — uses `cursor agent -p` or standalone `agent -p`.
 *
 * MCP config written to .cursor/mcp.json.
 */
import { execa } from "execa";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Backend, BackendResponse } from "./types.ts";

export interface CursorCliOptions {
  model?: string;
  cwd?: string;
  timeout?: number;
}

export function createCursorCliBackend(options: CursorCliOptions = {}): Backend {
  const timeout = options.timeout ?? 600_000;
  let resolvedCmd: { cmd: string; args: string[] } | null = null;

  async function resolveCommand(): Promise<{ cmd: string; args: string[] }> {
    if (resolvedCmd) return resolvedCmd;

    // Try "cursor agent" first (IDE-bundled)
    try {
      await execa("cursor", ["agent", "--version"], { stdin: "ignore", timeout: 3000 });
      resolvedCmd = { cmd: "cursor", args: ["agent"] };
      return resolvedCmd;
    } catch {
      // Fall back to standalone "agent"
    }

    try {
      await execa("agent", ["--version"], { stdin: "ignore", timeout: 3000 });
      resolvedCmd = { cmd: "agent", args: [] };
      return resolvedCmd;
    } catch {
      throw new Error("Cursor agent not found. Install Cursor IDE or the standalone agent CLI.");
    }
  }

  return {
    type: "cursor",

    async send(message, _sendOptions) {
      const { cmd, args: baseArgs } = await resolveCommand();
      const args = [
        ...baseArgs,
        "-p",
        "--force",
        "--approve-mcps",
        "--output-format=stream-json",
        message,
      ];

      if (options.model) args.push("--model", options.model);

      try {
        const result = await execa(cmd, args, {
          cwd: options.cwd,
          timeout,
          stdin: "ignore",
        });

        return parseCursorOutput(result.stdout);
      } catch (error) {
        if (error && typeof error === "object" && "exitCode" in error) {
          const e = error as { exitCode?: number; stderr?: string };
          throw new Error(`cursor failed (exit ${e.exitCode}): ${e.stderr?.slice(0, 500)}`);
        }
        throw error;
      }
    },

    setWorkspace(workspaceDir, mcpConfig) {
      const cursorDir = join(workspaceDir, ".cursor");
      if (!existsSync(cursorDir)) {
        mkdirSync(cursorDir, { recursive: true });
      }
      writeFileSync(join(cursorDir, "mcp.json"), JSON.stringify(mcpConfig, null, 2));
      options.cwd = workspaceDir;
    },
  };
}

function parseCursorOutput(stdout: string): BackendResponse {
  let content = "";

  for (const line of stdout.split("\n")) {
    if (!line.trim()) continue;
    try {
      const event = JSON.parse(line);
      if (event.type === "result") {
        content = event.result || "";
      } else if (event.type === "assistant" && event.message?.content) {
        for (const block of event.message.content) {
          if (block.type === "text") content += block.text;
        }
      }
    } catch {
      // Non-JSON output
    }
  }

  return { content: content.trim() };
}
