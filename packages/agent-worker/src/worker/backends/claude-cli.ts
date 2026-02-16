/**
 * Claude CLI backend — uses `claude -p` for non-interactive mode.
 *
 * Spawns claude as a child process with MCP config support.
 * Uses stream-json output format for structured results.
 */
import { execa } from "execa";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Backend, BackendResponse } from "./types.ts";

export interface ClaudeCliOptions {
  /** Model override (e.g., 'opus', 'sonnet') */
  model?: string;
  /** Working directory */
  cwd?: string;
  /** Timeout in ms (default: 600s) */
  timeout?: number;
  /** MCP config file path */
  mcpConfigPath?: string;
}

export function createClaudeCliBackend(options: ClaudeCliOptions = {}): Backend {
  const timeout = options.timeout ?? 600_000;
  let mcpConfigPath = options.mcpConfigPath;

  return {
    type: "claude",

    async send(message, sendOptions) {
      const args = ["-p", "--dangerously-skip-permissions", message];

      if (options.model) args.push("--model", options.model);
      if (sendOptions?.system) args.push("--append-system-prompt", sendOptions.system);
      if (mcpConfigPath) args.push("--mcp-config", mcpConfigPath);

      args.push("--output-format", "stream-json", "--verbose");

      try {
        const result = await execa("claude", args, {
          cwd: options.cwd,
          timeout,
          stdin: "ignore",
        });

        return parseStreamJson(result.stdout);
      } catch (error) {
        if (error && typeof error === "object" && "exitCode" in error) {
          const e = error as { exitCode?: number; stderr?: string };
          throw new Error(`claude failed (exit ${e.exitCode}): ${e.stderr?.slice(0, 500)}`);
        }
        throw error;
      }
    },

    setWorkspace(workspaceDir, mcpConfig) {
      if (!existsSync(workspaceDir)) {
        mkdirSync(workspaceDir, { recursive: true });
      }
      const configPath = join(workspaceDir, "mcp-config.json");
      writeFileSync(configPath, JSON.stringify(mcpConfig, null, 2));
      mcpConfigPath = configPath;
      options.cwd = workspaceDir;
    },
  };
}

/** Parse stream-json output from Claude CLI */
function parseStreamJson(stdout: string): BackendResponse {
  let content = "";
  const toolCalls: BackendResponse["toolCalls"] = [];

  for (const line of stdout.split("\n")) {
    if (!line.trim()) continue;
    try {
      const event = JSON.parse(line);
      if (event.type === "assistant" && event.message?.content) {
        for (const block of event.message.content) {
          if (block.type === "text") content += block.text;
          if (block.type === "tool_use") {
            toolCalls.push({
              name: block.name,
              arguments: block.input,
              result: {},
            });
          }
        }
      }
      if (event.type === "result") {
        content = event.result || content;
      }
    } catch {
      // Ignore non-JSON lines
    }
  }

  return {
    content: content.trim(),
    toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
  };
}
