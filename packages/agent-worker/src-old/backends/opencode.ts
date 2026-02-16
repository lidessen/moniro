/**
 * OpenCode CLI backend
 * Uses `opencode run` for non-interactive mode with JSON event output
 *
 * MCP Configuration:
 * OpenCode uses project-level MCP config via opencode.json in the workspace.
 * Use setWorkspace() to set up a dedicated workspace with MCP config.
 *
 * @see https://opencode.ai/docs/
 */

import { execa } from "execa";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Backend, BackendResponse } from "./types.ts";
import { DEFAULT_IDLE_TIMEOUT } from "./types.ts";
import { execWithIdleTimeout, IdleTimeoutError } from "./idle-timeout.ts";
import {
  createStreamParser,
  type StreamParserCallbacks,
  type EventAdapter,
} from "./stream-json.ts";

export interface OpenCodeOptions {
  /** Model to use in provider/model format (e.g., 'deepseek/deepseek-chat') */
  model?: string;
  /** Working directory (defaults to workspace if set) */
  cwd?: string;
  /** Workspace directory for agent isolation */
  workspace?: string;
  /** Idle timeout in milliseconds — kills process if no output for this duration */
  timeout?: number;
  /** Stream parser callbacks (structured event output) */
  streamCallbacks?: StreamParserCallbacks;
}

export class OpenCodeBackend implements Backend {
  readonly type = "opencode" as const;
  private options: OpenCodeOptions;

  constructor(options: OpenCodeOptions = {}) {
    this.options = {
      timeout: DEFAULT_IDLE_TIMEOUT,
      ...options,
    };
  }

  /**
   * Set up workspace directory with MCP config
   * Creates opencode.json in the workspace with MCP server config
   */
  setWorkspace(workspaceDir: string, mcpConfig: { mcpServers: Record<string, unknown> }): void {
    this.options.workspace = workspaceDir;

    if (!existsSync(workspaceDir)) {
      mkdirSync(workspaceDir, { recursive: true });
    }

    // Convert mcpServers to OpenCode's mcp format
    // OpenCode uses { mcp: { name: { type: "local", command: [...] } } }
    const opencodeMcp: Record<string, unknown> = {};
    for (const [name, config] of Object.entries(mcpConfig.mcpServers)) {
      const serverConfig = config as {
        command?: string;
        args?: string[];
        env?: Record<string, string>;
      };
      opencodeMcp[name] = {
        type: "local",
        command: [serverConfig.command, ...(serverConfig.args || [])],
        enabled: true,
        ...(serverConfig.env ? { environment: serverConfig.env } : {}),
      };
    }

    const opencodeConfig = {
      $schema: "https://opencode.ai/config.json",
      mcp: opencodeMcp,
    };

    const configPath = join(workspaceDir, "opencode.json");
    writeFileSync(configPath, JSON.stringify(opencodeConfig, null, 2));
  }

  async send(message: string, _options?: { system?: string }): Promise<BackendResponse> {
    const args = this.buildArgs(message);
    const cwd = this.options.workspace || this.options.cwd;
    const timeout = this.options.timeout ?? DEFAULT_IDLE_TIMEOUT;

    try {
      const { stdout } = await execWithIdleTimeout({
        command: "opencode",
        args,
        cwd,
        timeout,
        onStdout: this.options.streamCallbacks
          ? createStreamParser(this.options.streamCallbacks, "OpenCode", opencodeAdapter)
          : undefined,
      });

      return extractOpenCodeResult(stdout);
    } catch (error) {
      if (error instanceof IdleTimeoutError) {
        throw new Error(`opencode timed out after ${timeout}ms of inactivity`);
      }
      if (error && typeof error === "object" && "exitCode" in error) {
        const execError = error as { exitCode?: number; stderr?: string; shortMessage?: string };
        throw new Error(
          `opencode failed (exit ${execError.exitCode}): ${execError.stderr || execError.shortMessage}`,
        );
      }
      throw error;
    }
  }

  async isAvailable(): Promise<boolean> {
    try {
      await execa("opencode", ["--version"], { stdin: "ignore", timeout: 5000 });
      return true;
    } catch {
      return false;
    }
  }

  getInfo(): { name: string; version?: string; model?: string } {
    return {
      name: "OpenCode CLI",
      model: this.options.model,
    };
  }

  private buildArgs(message: string): string[] {
    // run: non-interactive mode
    // --format json: NDJSON event output for progress parsing
    const args: string[] = ["run", "--format", "json", message];

    if (this.options.model) {
      args.push("--model", this.options.model);
    }

    return args;
  }
}

// ==================== OpenCode Event Types ====================

/**
 * OpenCode JSON event format
 * Events: step_start, text, tool_use, step_finish
 */
export type OpenCodeEvent =
  | {
      type: "step_start";
      sessionID: string;
      part: { type: "step-start"; snapshot?: string };
    }
  | {
      type: "text";
      sessionID: string;
      part: { type: "text"; text: string };
    }
  | {
      type: "tool_use";
      sessionID: string;
      part: {
        type: "tool";
        callID: string;
        tool: string;
        state: {
          status: string;
          input?: Record<string, unknown>;
          output?: string;
        };
      };
    }
  | {
      type: "step_finish";
      sessionID: string;
      part: {
        type: "step-finish";
        reason: string;
        cost?: number;
        tokens?: {
          total: number;
          input: number;
          output: number;
          reasoning?: number;
        };
      };
    };

// ==================== OpenCode Adapter ====================

/**
 * Adapter for OpenCode --format json output.
 *
 * Events:
 *   { type: "step_start", sessionID: "..." }
 *   { type: "tool_use", part: { tool: "bash", state: { input: {...} } } }
 *   { type: "text", part: { text: "..." } }            → skipped (result only)
 *   { type: "step_finish", part: { cost, tokens } }
 */
export const opencodeAdapter: EventAdapter = (raw) => {
  const event = raw as OpenCodeEvent;

  if (event.type === "step_start") {
    return {
      kind: "init",
      sessionId: event.sessionID,
    };
  }

  if (event.type === "tool_use") {
    const { tool, state } = event.part;
    const args = state.input ? JSON.stringify(state.input) : "";
    return {
      kind: "tool_call",
      name: tool,
      args: args.length > 100 ? args.slice(0, 100) + "..." : args,
    };
  }

  if (event.type === "text") {
    // Text messages — skip (extracted by result extractor)
    return { kind: "skip" };
  }

  if (event.type === "step_finish") {
    const { cost, tokens } = event.part;
    return {
      kind: "completed",
      costUsd: cost,
      usage: tokens ? { input: tokens.input, output: tokens.output } : undefined,
    };
  }

  return null;
};

/**
 * Extract final result from OpenCode --format json output.
 *
 * Priority:
 * 1. Last text event
 * 2. Raw stdout fallback
 */
export function extractOpenCodeResult(stdout: string): BackendResponse {
  const lines = stdout.trim().split("\n");

  // 1. Find last text event
  for (let i = lines.length - 1; i >= 0; i--) {
    try {
      const event = JSON.parse(lines[i]!);
      if (event.type === "text" && event.part?.text) {
        return { content: event.part.text };
      }
    } catch {
      // Not JSON
    }
  }

  // 2. Raw stdout
  return { content: stdout.trim() };
}
