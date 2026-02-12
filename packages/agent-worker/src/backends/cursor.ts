/**
 * Cursor CLI backend
 * Uses `cursor agent -p` for non-interactive mode with stream-json output
 *
 * MCP Configuration:
 * Cursor uses project-level MCP config via .cursor/mcp.json in the workspace.
 * Use setWorkspace() to set up a dedicated workspace with MCP config.
 *
 * @see https://docs.cursor.com/context/model-context-protocol
 */

import { execa } from "execa";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Backend, BackendResponse } from "./types.ts";
import { DEFAULT_IDLE_TIMEOUT } from "./types.ts";
import { execWithIdleTimeout, IdleTimeoutError } from "./idle-timeout.ts";
import {
  createStreamParser,
  cursorAdapter,
  extractClaudeResult,
  type StreamParserCallbacks,
} from "./stream-json.ts";

export interface CursorOptions {
  /** Model to use */
  model?: string;
  /** Working directory (defaults to workspace if set, otherwise cwd) */
  cwd?: string;
  /** Workspace directory for agent isolation (contains .cursor/mcp.json) */
  workspace?: string;
  /** Idle timeout in milliseconds — kills process if no output for this duration */
  timeout?: number;
  /** Stream parser callbacks (structured event output) */
  streamCallbacks?: StreamParserCallbacks;
}

export class CursorBackend implements Backend {
  readonly type = "cursor" as const;
  private options: CursorOptions;
  /** Resolved command: "cursor" (subcommand style) */
  private resolvedCommand: string | null = null;

  constructor(options: CursorOptions = {}) {
    this.options = {
      timeout: DEFAULT_IDLE_TIMEOUT,
      ...options,
    };
  }

  /**
   * Set up workspace directory with MCP config
   * Creates .cursor/mcp.json in the workspace
   */
  setWorkspace(workspaceDir: string, mcpConfig: { mcpServers: Record<string, unknown> }): void {
    this.options.workspace = workspaceDir;

    // Create .cursor directory
    const cursorDir = join(workspaceDir, ".cursor");
    if (!existsSync(cursorDir)) {
      mkdirSync(cursorDir, { recursive: true });
    }

    // Write MCP config
    const mcpConfigPath = join(cursorDir, "mcp.json");
    writeFileSync(mcpConfigPath, JSON.stringify(mcpConfig, null, 2));
  }

  async send(message: string, _options?: { system?: string }): Promise<BackendResponse> {
    const { command, args } = await this.buildCommand(message);
    // Use workspace as cwd if set, otherwise fall back to cwd option
    const cwd = this.options.workspace || this.options.cwd;
    const timeout = this.options.timeout ?? DEFAULT_IDLE_TIMEOUT;

    try {
      const { stdout } = await execWithIdleTimeout({
        command,
        args,
        cwd,
        timeout,
        onStdout: this.options.streamCallbacks
          ? createStreamParser(this.options.streamCallbacks, "Cursor", cursorAdapter)
          : undefined,
      });

      return extractClaudeResult(stdout);
    } catch (error) {
      if (error instanceof IdleTimeoutError) {
        throw new Error(`cursor agent timed out after ${timeout}ms of inactivity`);
      }
      if (error && typeof error === "object" && "exitCode" in error) {
        const execError = error as { exitCode?: number; stderr?: string; shortMessage?: string };
        throw new Error(
          `cursor agent failed (exit ${execError.exitCode}): ${execError.stderr || execError.shortMessage}`,
        );
      }
      throw error;
    }
  }

  async isAvailable(): Promise<boolean> {
    const cmd = await this.resolveCommand();
    return cmd !== null;
  }

  getInfo(): { name: string; version?: string; model?: string } {
    return {
      name: "Cursor Agent CLI",
      model: this.options.model,
    };
  }

  /**
   * Resolve which cursor command is available.
   * Checks `cursor agent --version` (subcommand style).
   * Result is cached after first resolution.
   */
  private async resolveCommand(): Promise<string | null> {
    if (this.resolvedCommand !== null) return this.resolvedCommand;

    try {
      await execa("cursor", ["agent", "--version"], { stdin: "ignore", timeout: 2000 });
      this.resolvedCommand = "cursor";
      return "cursor";
    } catch {
      // Not available
    }

    return null;
  }

  protected async buildCommand(message: string): Promise<{ command: string; args: string[] }> {
    const cmd = await this.resolveCommand();
    // --force: auto-approve all operations (required for non-interactive)
    // --approve-mcps: auto-approve MCP servers (required for workflow MCP tools)
    // --output-format=stream-json: structured output for progress parsing
    const agentArgs: string[] = [
      "-p",
      "--force",
      "--approve-mcps",
      "--output-format=stream-json",
      message,
    ];

    if (this.options.model) {
      agentArgs.push("--model", this.options.model);
    }

    if (!cmd) {
      throw new Error("cursor agent CLI not found");
    }

    // Subcommand style: cursor agent -p ...
    return { command: "cursor", args: ["agent", ...agentArgs] };
  }
}
