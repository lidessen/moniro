/**
 * Backend factory — create backend by type.
 */
import type { Backend, BackendType } from "./types.ts";
import { createMockBackend } from "./mock.ts";

export type { Backend, BackendType, BackendResponse } from "./types.ts";

export interface BackendOptions {
  type: BackendType;
  model?: string;
  maxTokens?: number;
  timeout?: number;
  cwd?: string;
}

/**
 * Create a backend instance by type.
 * CLI backends (claude, codex, cursor) are lazily imported.
 */
export async function createBackend(options: BackendOptions): Promise<Backend> {
  const type = options.type === "default" ? "sdk" : options.type;

  switch (type) {
    case "mock":
      return createMockBackend({ response: "" });

    case "sdk": {
      const { createSdkBackend } = await import("./sdk.ts");
      return createSdkBackend({
        model: options.model ?? "anthropic/claude-sonnet-4-5",
        maxTokens: options.maxTokens,
      });
    }

    case "claude": {
      const { createClaudeCliBackend } = await import("./claude-cli.ts");
      return createClaudeCliBackend({
        model: options.model,
        timeout: options.timeout,
        cwd: options.cwd,
      });
    }

    case "codex": {
      const { createCodexCliBackend } = await import("./codex-cli.ts");
      return createCodexCliBackend({
        model: options.model,
        timeout: options.timeout,
        cwd: options.cwd,
      });
    }

    case "cursor": {
      const { createCursorCliBackend } = await import("./cursor-cli.ts");
      return createCursorCliBackend({
        model: options.model,
        timeout: options.timeout,
        cwd: options.cwd,
      });
    }

    default:
      throw new Error(`Unknown backend type: ${type}`);
  }
}
