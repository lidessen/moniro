/**
 * Claude Code CLI backend
 * Uses `claude -p` for non-interactive mode
 *
 * MCP Configuration:
 * Claude supports per-invocation MCP config via --mcp-config flag.
 * Use setWorkspace() for workspace isolation, or setMcpConfigPath() directly.
 *
 * @see https://docs.anthropic.com/en/docs/claude-code
 */

import { execa } from "execa";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Backend, BackendResponse } from "./types.ts";
import { execWithIdleTimeoutAbortable, IdleTimeoutError } from "./idle-timeout.ts";
import { createStreamParser, claudeAdapter, extractClaudeResult } from "./stream-json.ts";

export interface ClaudeCodeOptions {
  /** Model to use (e.g., 'opus', 'sonnet') */
  model?: string;
  /** Additional system prompt to append */
  appendSystemPrompt?: string;
  /** Allowed tools (permission rule syntax) */
  allowedTools?: string[];
  /** Output format: 'text' | 'json' | 'stream-json' */
  outputFormat?: "text" | "json" | "stream-json";
  /** Continue most recent conversation */
  continue?: boolean;
  /** Resume specific session by ID */
  resume?: string;
  /** Working directory (defaults to workspace if set) */
  cwd?: string;
  /** Workspace directory for agent isolation */
  workspace?: string;
  /** Idle timeout in milliseconds — kills process if no output for this duration */
  timeout?: number;
  /** MCP config file path (for workflow context) */
  mcpConfigPath?: string;
  /** Debug log function (for workflow diagnostics) */
  debugLog?: (message: string) => void;
}

export class ClaudeCodeBackend implements Backend {
  readonly type = "claude" as const;
  private options: ClaudeCodeOptions;
  private currentAbort?: () => void;

  constructor(options: ClaudeCodeOptions = {}) {
    this.options = {
      timeout: 300000, // 5 minute default
      ...options,
    };
  }

  /**
   * Set up workspace directory with MCP config
   * Claude uses --mcp-config flag, so we just write the config file
   */
  setWorkspace(workspaceDir: string, mcpConfig: { mcpServers: Record<string, unknown> }): void {
    this.options.workspace = workspaceDir;

    // Ensure workspace exists
    if (!existsSync(workspaceDir)) {
      mkdirSync(workspaceDir, { recursive: true });
    }

    // Write MCP config file in workspace
    const mcpConfigPath = join(workspaceDir, "mcp-config.json");
    writeFileSync(mcpConfigPath, JSON.stringify(mcpConfig, null, 2));
    this.options.mcpConfigPath = mcpConfigPath;
  }

  async send(message: string, options?: { system?: string }): Promise<BackendResponse> {
    const args = this.buildArgs(message, options);
    // Use workspace as cwd if set
    const cwd = this.options.workspace || this.options.cwd;
    const debugLog = this.options.debugLog;
    const outputFormat = this.options.outputFormat ?? "stream-json";
    const timeout = this.options.timeout ?? 300000;

    try {
      const { promise, abort } = execWithIdleTimeoutAbortable({
        command: "claude",
        args,
        cwd,
        timeout,
        onStdout:
          outputFormat === "stream-json" && debugLog
            ? createStreamParser(debugLog, "Claude", claudeAdapter)
            : undefined,
      });

      // Store abort function for external cleanup
      this.currentAbort = abort;

      const { stdout } = await promise;

      // Clear abort after completion
      this.currentAbort = undefined;

      // Parse response based on output format
      if (outputFormat === "stream-json") {
        return extractClaudeResult(stdout);
      }

      if (outputFormat === "json") {
        try {
          const parsed = JSON.parse(stdout);
          return {
            content: parsed.content || parsed.result || stdout,
            toolCalls: parsed.toolCalls,
            usage: parsed.usage,
          };
        } catch {
          return { content: stdout.trim() };
        }
      }

      return { content: stdout.trim() };
    } catch (error) {
      this.currentAbort = undefined;

      if (error instanceof IdleTimeoutError) {
        throw new Error(`claude timed out after ${timeout}ms of inactivity`);
      }
      if (error && typeof error === "object" && "exitCode" in error) {
        const execError = error as { exitCode?: number; stderr?: string; shortMessage?: string };
        throw new Error(
          `claude failed (exit ${execError.exitCode}): ${execError.stderr || execError.shortMessage}`,
        );
      }
      throw error;
    }
  }

  async isAvailable(): Promise<boolean> {
    try {
      await execa("claude", ["--version"], { stdin: "ignore", timeout: 5000 });
      return true;
    } catch {
      return false;
    }
  }

  getInfo(): { name: string; version?: string; model?: string } {
    return {
      name: "Claude Code CLI",
      model: this.options.model,
    };
  }

  private buildArgs(message: string, options?: { system?: string }): string[] {
    // -p: non-interactive print mode
    // --dangerously-skip-permissions: auto-approve all operations (required for workflow MCP tools)
    const args: string[] = ["-p", "--dangerously-skip-permissions", message];

    if (this.options.model) {
      args.push("--model", this.options.model);
    }

    if (options?.system || this.options.appendSystemPrompt) {
      const system = options?.system || this.options.appendSystemPrompt;
      args.push("--append-system-prompt", system!);
    }

    if (this.options.allowedTools?.length) {
      args.push("--allowed-tools", this.options.allowedTools.join(","));
    }

    // Default to stream-json for structured progress reporting
    const outputFormat = this.options.outputFormat ?? "stream-json";
    args.push("--output-format", outputFormat);

    if (this.options.continue) {
      args.push("--continue");
    }

    if (this.options.resume) {
      args.push("--resume", this.options.resume);
    }

    if (this.options.mcpConfigPath) {
      args.push("--mcp-config", this.options.mcpConfigPath);
    }

    return args;
  }

  /**
   * Set MCP config path (for workflow integration)
   */
  setMcpConfigPath(path: string): void {
    this.options.mcpConfigPath = path;
  }

  /**
   * Abort any running claude process
   */
  abort(): void {
    if (this.currentAbort) {
      this.currentAbort();
      this.currentAbort = undefined;
    }
  }
}
