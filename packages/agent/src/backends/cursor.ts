/**
 * Cursor CLI backend
 * Uses `cursor agent -p` for non-interactive mode with stream-json output
 *
 * MCP Configuration:
 * Cursor uses project-level MCP config via .cursor/mcp.json in the workspace.
 * The loop writes this file; cursor auto-discovers it from cwd.
 *
 * @see https://docs.cursor.com/context/model-context-protocol
 */

import type { Backend, BackendResponse } from "./types.ts";
import { DEFAULT_IDLE_TIMEOUT } from "./types.ts";
import { execWithIdleTimeout } from "./idle-timeout.ts";
import { handleCliBackendError, checkCliAvailable } from "./cli-helpers.ts";
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
  /**
   * Resolved command style:
   * - "subcommand": `cursor agent -p ...` (IDE-bundled CLI)
   * - "direct": `agent -p ...` (standalone install via cursor.com/install)
   * - null: not yet resolved
   */
  private resolvedStyle: "subcommand" | "direct" | null = null;

  constructor(options: CursorOptions = {}) {
    this.options = {
      timeout: DEFAULT_IDLE_TIMEOUT,
      ...options,
    };
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
      handleCliBackendError(error, "cursor agent", timeout);
    }
  }

  async isAvailable(): Promise<boolean> {
    const style = await this.resolveStyle();
    return style !== null;
  }

  getInfo(): { name: string; version?: string; model?: string } {
    return {
      name: "Cursor Agent CLI",
      model: this.options.model,
    };
  }

  /**
   * Resolve which cursor command style is available.
   * Tries in order:
   *   1. `cursor agent --version` — IDE-bundled CLI (subcommand style)
   *   2. `agent --version` — standalone install via cursor.com/install (direct style)
   * Result is cached after first resolution.
   */
  private async resolveStyle(): Promise<"subcommand" | "direct" | null> {
    if (this.resolvedStyle !== null) return this.resolvedStyle;

    // Try subcommand style: cursor agent --version
    if (await checkCliAvailable("cursor", ["agent", "--version"], 2000)) {
      this.resolvedStyle = "subcommand";
      return "subcommand";
    }

    // Try direct style: agent --version (standalone install)
    if (await checkCliAvailable("agent", ["--version"], 2000)) {
      this.resolvedStyle = "direct";
      return "direct";
    }

    return null;
  }

  protected async buildCommand(message: string): Promise<{ command: string; args: string[] }> {
    const style = await this.resolveStyle();
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

    if (!style) {
      throw new Error(
        "cursor agent CLI not found. Install via: curl -fsS https://cursor.com/install | bash",
      );
    }

    if (style === "direct") {
      // Standalone install: agent -p ...
      return { command: "agent", args: agentArgs };
    }

    // IDE-bundled: cursor agent -p ...
    return { command: "cursor", args: ["agent", ...agentArgs] };
  }
}
