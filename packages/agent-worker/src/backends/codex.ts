/**
 * OpenAI Codex CLI backend
 * Uses `codex exec` for non-interactive mode with JSON event output
 *
 * MCP Configuration:
 * Codex uses project-level MCP config via .codex/config.yaml in the workspace.
 * The loop writes this file; codex auto-discovers it from cwd.
 *
 * @see https://github.com/openai/codex
 */

import type { Backend, BackendResponse } from "./types.ts";
import { DEFAULT_IDLE_TIMEOUT } from "./types.ts";
import { execWithIdleTimeout } from "./idle-timeout.ts";
import { handleCliBackendError, checkCliAvailable } from "./cli-helpers.ts";
import {
  createStreamParser,
  codexAdapter,
  extractCodexResult,
  type StreamParserCallbacks,
} from "./stream-json.ts";

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
  /** Stream parser callbacks (structured event output) */
  streamCallbacks?: StreamParserCallbacks;
}

export class CodexBackend implements Backend {
  readonly type = "codex" as const;
  private options: CodexOptions;

  constructor(options: CodexOptions = {}) {
    this.options = {
      timeout: DEFAULT_IDLE_TIMEOUT,
      ...options,
    };
  }

  async send(message: string, _options?: { system?: string }): Promise<BackendResponse> {
    const args = this.buildArgs(message);
    // Use workspace as cwd if set
    const cwd = this.options.workspace || this.options.cwd;
    const timeout = this.options.timeout ?? DEFAULT_IDLE_TIMEOUT;

    try {
      const { stdout } = await execWithIdleTimeout({
        command: "codex",
        args,
        cwd,
        timeout,
        onStdout: this.options.streamCallbacks
          ? createStreamParser(this.options.streamCallbacks, "Codex", codexAdapter)
          : undefined,
      });

      return extractCodexResult(stdout);
    } catch (error) {
      handleCliBackendError(error, "codex", timeout);
    }
  }

  async isAvailable(): Promise<boolean> {
    return checkCliAvailable("codex");
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
    const args: string[] = ["exec", "--full-auto", "--json", "--skip-git-repo-check", message];

    if (this.options.model) {
      args.push("--model", this.options.model);
    }

    if (this.options.resume) {
      args.push("--resume", this.options.resume);
    }

    return args;
  }
}
