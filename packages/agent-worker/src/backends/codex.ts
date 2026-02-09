/**
 * OpenAI Codex CLI backend
 * Uses `codex exec` for non-interactive mode with JSON event output
 *
 * MCP Configuration:
 * Codex uses project-level MCP config. Use setWorkspace() to set up
 * a dedicated workspace directory with .codex/config.yaml for MCP settings.
 *
 * @see https://github.com/openai/codex
 */

import { execa } from "execa";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { stringify as yamlStringify } from "yaml";
import type { Backend, BackendResponse } from "./types.ts";
import { execWithIdleTimeout, IdleTimeoutError } from "./idle-timeout.ts";
import { createStreamParser, codexAdapter, extractCodexResult } from "./stream-json.ts";

export interface CodexOptions {
  /** Model to use (e.g., 'gpt-5.2-codex') */
  model?: string;
  /** Working directory (defaults to workspace if set) */
  cwd?: string;
  /** Workspace directory for agent isolation */
  workspace?: string;
  /** Resume a previous session */
  resume?: string;
  /** Idle timeout in milliseconds — kills process if no output for this duration */
  timeout?: number;
  /** Debug log function (for workflow diagnostics) */
  debugLog?: (message: string) => void;
}

export class CodexBackend implements Backend {
  readonly type = "codex" as const;
  private options: CodexOptions;

  constructor(options: CodexOptions = {}) {
    this.options = {
      timeout: 300000, // 5 minute default
      ...options,
    };
  }

  /**
   * Set up workspace directory with MCP config
   * Creates .codex/config.yaml in the workspace with MCP server config
   */
  setWorkspace(workspaceDir: string, mcpConfig: { mcpServers: Record<string, unknown> }): void {
    this.options.workspace = workspaceDir;

    // Create .codex directory
    const codexDir = join(workspaceDir, ".codex");
    if (!existsSync(codexDir)) {
      mkdirSync(codexDir, { recursive: true });
    }

    // Convert MCP config to codex format and write as YAML
    // Codex uses mcp_servers in its config
    const codexConfig = {
      mcp_servers: mcpConfig.mcpServers,
    };
    const configPath = join(codexDir, "config.yaml");
    writeFileSync(configPath, yamlStringify(codexConfig));
  }

  async send(message: string, _options?: { system?: string }): Promise<BackendResponse> {
    const args = this.buildArgs(message);
    // Use workspace as cwd if set
    const cwd = this.options.workspace || this.options.cwd;
    const debugLog = this.options.debugLog;
    const timeout = this.options.timeout ?? 300000;

    try {
      const { stdout } = await execWithIdleTimeout({
        command: "codex",
        args,
        cwd,
        timeout,
        onStdout: debugLog ? createStreamParser(debugLog, "Codex", codexAdapter) : undefined,
      });

      return extractCodexResult(stdout);
    } catch (error) {
      if (error instanceof IdleTimeoutError) {
        throw new Error(
          `codex timed out after ${timeout}ms of inactivity`,
        );
      }
      if (error && typeof error === "object" && "exitCode" in error) {
        const execError = error as { exitCode?: number; stderr?: string; shortMessage?: string };
        throw new Error(
          `codex failed (exit ${execError.exitCode}): ${execError.stderr || execError.shortMessage}`,
        );
      }
      throw error;
    }
  }

  async isAvailable(): Promise<boolean> {
    try {
      await execa("codex", ["--version"], { stdin: "ignore", timeout: 5000 });
      return true;
    } catch {
      return false;
    }
  }

  getInfo(): { name: string; version?: string; model?: string } {
    return {
      name: "OpenAI Codex CLI",
      model: this.options.model,
    };
  }

  private buildArgs(message: string): string[] {
    // exec: non-interactive mode
    // --full-auto: auto-approve with workspace-write sandbox
    // --json: JSONL event output for progress parsing
    // --skip-git-repo-check: allow running outside git repos (workspace dirs)
    const args: string[] = [
      "exec",
      "--full-auto",
      "--json",
      "--skip-git-repo-check",
      message,
    ];

    if (this.options.model) {
      args.push("--model", this.options.model);
    }

    if (this.options.resume) {
      args.push("--resume", this.options.resume);
    }

    return args;
  }
}
