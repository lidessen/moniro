/**
 * Claude Code CLI backend
 * Uses `claude -p` for non-interactive mode
 *
 * MCP Configuration:
 * Claude supports per-invocation MCP config via --mcp-config flag.
 * The loop writes mcp-config.json to the workspace; this backend
 * auto-discovers it when workspace is set.
 *
 * @see https://docs.anthropic.com/en/docs/claude-code
 */

import { checkCliAvailable } from "./cli-helpers.ts";
import { existsSync } from "node:fs";
import { join } from "node:path";
import type { Backend, BackendResponse } from "./types.ts";
import { DEFAULT_IDLE_TIMEOUT } from "./types.ts";
import { execWithIdleTimeoutAbortable, IdleTimeoutError } from "./idle-timeout.ts";
import {
  createStreamParser,
  claudeAdapter,
  extractClaudeResult,
  type StreamParserCallbacks,
} from "./stream-json.ts";

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
  /** Stream parser callbacks (structured event output) */
  streamCallbacks?: StreamParserCallbacks;
}

export class ClaudeCodeBackend implements Backend {
  readonly type = "claude" as const;
  private options: ClaudeCodeOptions;
  private currentAbort?: () => void;

  constructor(options: ClaudeCodeOptions = {}) {
    this.options = {
      timeout: DEFAULT_IDLE_TIMEOUT,
      ...options,
    };
  }

  async send(message: string, options?: { system?: string }): Promise<BackendResponse> {
    const args = this.buildArgs(message, options);
    // Use workspace as cwd if set
    const cwd = this.options.workspace || this.options.cwd;
    const outputFormat = this.options.outputFormat ?? "stream-json";
    const timeout = this.options.timeout ?? DEFAULT_IDLE_TIMEOUT;

    try {
      const { promise, abort } = execWithIdleTimeoutAbortable({
        command: "claude",
        args,
        cwd,
        timeout,
        onStdout:
          outputFormat === "stream-json" && this.options.streamCallbacks
            ? createStreamParser(this.options.streamCallbacks, "Claude", claudeAdapter)
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
        // Distinguish startup timeout (no output at all) from idle timeout (output then silence)
        if (error.stdout === "" && error.stderr === "") {
          throw new Error(
            `claude produced no output within ${error.timeout}ms. ` +
              `This often happens when running nested 'claude -p' inside an existing Claude Code session. ` +
              `Consider using the SDK backend (model: "anthropic/claude-sonnet-4-5") instead.`,
          );
        }
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
    return checkCliAvailable("claude");
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

    // stream-json requires --verbose when using -p (print mode)
    if (outputFormat === "stream-json") {
      args.push("--verbose");
    }

    if (this.options.continue) {
      args.push("--continue");
    }

    if (this.options.resume) {
      args.push("--resume", this.options.resume);
    }

    // MCP config: explicit path or auto-discover from workspace
    const mcpConfigPath =
      this.options.mcpConfigPath ??
      (this.options.workspace
        ? (() => {
            const p = join(this.options.workspace, "mcp-config.json");
            return existsSync(p) ? p : undefined;
          })()
        : undefined);
    if (mcpConfigPath) {
      args.push("--mcp-config", mcpConfigPath);
    }

    return args;
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
