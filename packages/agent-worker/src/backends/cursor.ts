/**
 * Cursor CLI backend
 * Uses `cursor-agent -p` for non-interactive mode with stream-json output
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
import { execWithIdleTimeout, IdleTimeoutError } from "./idle-timeout.ts";

export interface CursorOptions {
  /** Model to use */
  model?: string;
  /** Working directory (defaults to workspace if set, otherwise cwd) */
  cwd?: string;
  /** Workspace directory for agent isolation (contains .cursor/mcp.json) */
  workspace?: string;
  /** Idle timeout in milliseconds — kills process if no output for this duration */
  timeout?: number;
  /** Debug log function (for workflow diagnostics) */
  debugLog?: (message: string) => void;
}

export class CursorBackend implements Backend {
  readonly type = "cursor" as const;
  private options: CursorOptions;

  constructor(options: CursorOptions = {}) {
    this.options = {
      timeout: 300000, // 5 minute default (matches claude/codex)
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
    const { command, args } = this.buildCommand(message);
    // Use workspace as cwd if set, otherwise fall back to cwd option
    const cwd = this.options.workspace || this.options.cwd;
    const debugLog = this.options.debugLog;

    // Line buffer for stream-json parsing
    let lineBuf = "";

    try {
      const { stdout } = await execWithIdleTimeout({
        command,
        args,
        cwd,
        timeout: this.options.timeout!,
        onStdout: debugLog
          ? (chunk) => {
              // Parse stream-json lines for progress reporting
              lineBuf += chunk;
              const lines = lineBuf.split("\n");
              // Keep incomplete last line in buffer
              lineBuf = lines.pop() ?? "";

              for (const line of lines) {
                if (!line.trim()) continue;
                try {
                  const event = JSON.parse(line);
                  const progress = formatCursorEvent(event);
                  if (progress) debugLog(progress);
                } catch {
                  // Not JSON — ignore
                }
              }
            }
          : undefined,
      });

      // Parse stream-json result: extract final result from last JSON line
      return parseCursorStreamResult(stdout);
    } catch (error) {
      if (error instanceof IdleTimeoutError) {
        throw new Error(
          `cursor-agent timed out after ${this.options.timeout}ms of inactivity`,
        );
      }
      if (error && typeof error === "object" && "exitCode" in error) {
        const execError = error as { exitCode?: number; stderr?: string; shortMessage?: string };
        throw new Error(
          `cursor-agent failed (exit ${execError.exitCode}): ${execError.stderr || execError.shortMessage}`,
        );
      }
      throw error;
    }
  }

  async isAvailable(): Promise<boolean> {
    // Try both 'agent' and 'cursor-agent' commands
    const commands = ["cursor-agent", "agent"];

    for (const cmd of commands) {
      try {
        await execa(cmd, ["--version"], { stdin: "ignore", timeout: 2000 });
        return true;
      } catch {
        // Try next command
      }
    }

    return false;
  }

  getInfo(): { name: string; version?: string; model?: string } {
    return {
      name: "Cursor Agent CLI",
      model: this.options.model,
    };
  }

  protected buildCommand(message: string): { command: string; args: string[] } {
    // Use 'cursor-agent -p' command
    // --force: auto-approve all operations (required for non-interactive)
    // --approve-mcps: auto-approve MCP servers (required for workflow MCP tools)
    // --output-format=stream-json: structured output for progress parsing
    const args: string[] = [
      "-p",
      "--force",
      "--approve-mcps",
      "--output-format=stream-json",
      message,
    ];

    if (this.options.model) {
      args.push("--model", this.options.model);
    }

    return { command: "cursor-agent", args };
  }
}

// ==================== Stream-JSON Parsing ====================

/**
 * Format a cursor stream-json event into a human-readable progress message.
 * Returns null for events that don't need to be shown.
 */
function formatCursorEvent(event: Record<string, unknown>): string | null {
  const type = event.type as string;

  if (type === "system" && event.subtype === "init") {
    const model = (event.model as string) || "unknown";
    return `Cursor initialized (model: ${model})`;
  }

  if (type === "assistant") {
    const message = event.message as { content?: Array<Record<string, unknown>> } | undefined;
    if (!message?.content) return null;

    // Report tool calls
    const toolCalls = message.content.filter((c) => c.type === "tool_use");
    if (toolCalls.length > 0) {
      return toolCalls
        .map((tc) => `CALL ${tc.name}(${formatToolArgs(tc.input)})`)
        .join("\n");
    }

    return null; // Skip plain text assistant messages (will be in final result)
  }

  if (type === "result") {
    const duration = event.duration_ms as number | undefined;
    if (duration) {
      return `Cursor completed (${(duration / 1000).toFixed(1)}s)`;
    }
  }

  return null;
}

/**
 * Format tool call arguments for logging (truncated)
 */
function formatToolArgs(input: unknown): string {
  if (!input || typeof input !== "object") return "";
  try {
    const str = JSON.stringify(input);
    return str.length > 100 ? str.slice(0, 100) + "..." : str;
  } catch {
    return "";
  }
}

/**
 * Parse cursor stream-json output to extract the final result.
 * Falls back to raw stdout if parsing fails.
 */
function parseCursorStreamResult(stdout: string): BackendResponse {
  const lines = stdout.trim().split("\n");

  // Find the result event (last line with type=result)
  for (let i = lines.length - 1; i >= 0; i--) {
    try {
      const event = JSON.parse(lines[i]!);
      if (event.type === "result" && event.result) {
        return { content: event.result };
      }
    } catch {
      // Not JSON — skip
    }
  }

  // Fallback: find last assistant message
  for (let i = lines.length - 1; i >= 0; i--) {
    try {
      const event = JSON.parse(lines[i]!);
      if (event.type === "assistant" && event.message?.content) {
        const textParts = event.message.content
          .filter((c: Record<string, unknown>) => c.type === "text")
          .map((c: Record<string, unknown>) => c.text);
        if (textParts.length > 0) {
          return { content: textParts.join("\n") };
        }
      }
    } catch {
      // Not JSON — skip
    }
  }

  // Final fallback: return raw stdout
  return { content: stdout.trim() };
}
