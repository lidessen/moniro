/**
 * Backend factory and exports
 */

export * from "./types.ts";
export { ClaudeCodeBackend, type ClaudeCodeOptions } from "./claude-code.ts";
export { CodexBackend, type CodexOptions } from "./codex.ts";
export { CursorBackend, type CursorOptions } from "./cursor.ts";
export { SdkBackend, type SdkBackendOptions } from "./sdk.ts";
export { MockAIBackend, createMockBackend } from "./mock.ts";
export { execWithIdleTimeout, IdleTimeoutError } from "./idle-timeout.ts";
export { formatStreamEvent, createStreamParser, parseStreamResult } from "./stream-json.ts";

import type { Backend, BackendType } from "./types.ts";
import { getModelForBackend } from "./types.ts";
import { ClaudeCodeBackend, type ClaudeCodeOptions } from "./claude-code.ts";
import { CodexBackend, type CodexOptions } from "./codex.ts";
import { CursorBackend, type CursorOptions } from "./cursor.ts";
import { SdkBackend } from "./sdk.ts";

export type BackendOptions =
  | { type: "sdk"; model?: string; maxTokens?: number }
  | { type: "claude"; model?: string; options?: Omit<ClaudeCodeOptions, "model"> }
  | { type: "codex"; model?: string; options?: Omit<CodexOptions, "model"> }
  | { type: "cursor"; model?: string; options?: Omit<CursorOptions, "model"> };

/**
 * Create a backend instance
 * Model names are automatically translated to backend-specific format
 *
 * Examples:
 * - "sonnet" → cursor: "sonnet-4.5", claude: "sonnet", sdk: "claude-sonnet-4-5-20250514"
 * - "anthropic/claude-sonnet-4-5" → cursor: "sonnet-4.5", claude: "sonnet"
 */
export function createBackend(config: BackendOptions): Backend {
  // Translate model to backend-specific format
  const model = getModelForBackend(config.model, config.type);

  switch (config.type) {
    case "sdk":
      return new SdkBackend({ model, maxTokens: config.maxTokens });
    case "claude":
      return new ClaudeCodeBackend({ ...config.options, model });
    case "codex":
      return new CodexBackend({ ...config.options, model });
    case "cursor":
      return new CursorBackend({ ...config.options, model });
    default:
      throw new Error(`Unknown backend type: ${(config as { type: string }).type}`);
  }
}

/** Check availability with a timeout to avoid hanging when CLIs are missing */
function withTimeout(promise: Promise<boolean>, ms: number): Promise<boolean> {
  return Promise.race([
    promise,
    new Promise<boolean>((resolve) => setTimeout(() => resolve(false), ms)),
  ]);
}

/**
 * Check which backends are available
 */
export async function checkBackends(): Promise<Record<BackendType, boolean>> {
  const claude = new ClaudeCodeBackend();
  const codex = new CodexBackend();
  const cursor = new CursorBackend();

  // Each isAvailable() spawns a process; use a 3s timeout to avoid hanging
  const [claudeAvailable, codexAvailable, cursorAvailable] = await Promise.all([
    withTimeout(claude.isAvailable(), 3000),
    withTimeout(codex.isAvailable(), 3000),
    withTimeout(cursor.isAvailable(), 3000),
  ]);

  return {
    sdk: true, // Always available (depends on API keys at runtime)
    claude: claudeAvailable,
    codex: codexAvailable,
    cursor: cursorAvailable,
    mock: true, // Always available (in-memory)
  };
}

/**
 * List available backends with info
 */
export async function listBackends(): Promise<
  Array<{ type: BackendType; available: boolean; name: string }>
> {
  const availability = await checkBackends();

  return [
    { type: "sdk", available: availability.sdk, name: "Vercel AI SDK" },
    { type: "claude", available: availability.claude, name: "Claude Code CLI" },
    { type: "codex", available: availability.codex, name: "OpenAI Codex CLI" },
    { type: "cursor", available: availability.cursor, name: "Cursor Agent CLI" },
  ];
}
