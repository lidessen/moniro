/**
 * Codex CLI backend — uses `codex exec` for non-interactive execution.
 *
 * MCP config written as YAML to .codex/config.yaml.
 */
import { execa } from "execa";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Backend, BackendResponse } from "./types.ts";

export interface CodexCliOptions {
  model?: string;
  cwd?: string;
  timeout?: number;
}

export function createCodexCliBackend(options: CodexCliOptions = {}): Backend {
  const timeout = options.timeout ?? 600_000;

  return {
    type: "codex",

    async send(message, sendOptions) {
      const args = ["exec", "--full-auto", "--json", "--skip-git-repo-check", message];

      if (options.model) args.push("--model", options.model);

      try {
        const result = await execa("codex", args, {
          cwd: options.cwd,
          timeout,
          stdin: "ignore",
        });

        return parseCodexOutput(result.stdout);
      } catch (error) {
        if (error && typeof error === "object" && "exitCode" in error) {
          const e = error as { exitCode?: number; stderr?: string };
          throw new Error(`codex failed (exit ${e.exitCode}): ${e.stderr?.slice(0, 500)}`);
        }
        throw error;
      }
    },

    setWorkspace(workspaceDir, mcpConfig) {
      const codexDir = join(workspaceDir, ".codex");
      if (!existsSync(codexDir)) {
        mkdirSync(codexDir, { recursive: true });
      }
      // Codex uses YAML config
      const yaml = `mcp_servers:\n${Object.entries(mcpConfig.mcpServers)
        .map(([name, cfg]: [string, any]) => {
          return `  ${name}:\n    command: ${cfg.command}\n    args: [${(cfg.args || []).map((a: string) => `"${a}"`).join(", ")}]`;
        })
        .join("\n")}\n`;
      writeFileSync(join(codexDir, "config.yaml"), yaml);
      options.cwd = workspaceDir;
    },
  };
}

function parseCodexOutput(stdout: string): BackendResponse {
  let content = "";
  const toolCalls: BackendResponse["toolCalls"] = [];

  for (const line of stdout.split("\n")) {
    if (!line.trim()) continue;
    try {
      const event = JSON.parse(line);
      if (event.type === "message" && event.content) {
        content += event.content;
      }
      if (event.type === "tool_call") {
        toolCalls.push({
          name: event.name,
          arguments: event.arguments,
          result: event.result ?? {},
        });
      }
    } catch {
      // Non-JSON line — append as content
      if (line.trim()) content += line + "\n";
    }
  }

  return {
    content: content.trim(),
    toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
  };
}
