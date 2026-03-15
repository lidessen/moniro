/**
 * Runtime factory and exports
 */

export * from "./types.ts";
export { ClaudeCodeRuntime, type ClaudeCodeOptions } from "./claude-code.ts";
export { CodexRuntime, type CodexOptions } from "./codex.ts";
export { CursorRuntime, type CursorOptions } from "./cursor.ts";
export { OpenCodeRuntime, type OpenCodeOptions } from "./opencode.ts";
export { SdkRuntime, type SdkRuntimeOptions } from "./sdk.ts";
export { MockRuntime, createMockRuntime } from "./mock.ts";
export { execWithIdleTimeout, IdleTimeoutError } from "./idle-timeout.ts";
export {
  type StreamEvent,
  type StreamParserCallbacks,
  type EventAdapter,
  formatEvent,
  claudeAdapter,
  codexAdapter,
  extractClaudeResult,
  extractCodexResult,
  createStreamParser,
} from "./stream-json.ts";
export { opencodeAdapter, extractOpenCodeResult } from "./opencode.ts";

import type { Runtime, RuntimeType } from "./types.ts";
import type { ProviderConfig } from "../types.ts";
import { getModelForRuntime, normalizeRuntimeType } from "./model-maps.ts";
import { ClaudeCodeRuntime, type ClaudeCodeOptions } from "./claude-code.ts";
import { CodexRuntime, type CodexOptions } from "./codex.ts";
import { CursorRuntime, type CursorOptions } from "./cursor.ts";
import { OpenCodeRuntime, type OpenCodeOptions } from "./opencode.ts";
import { SdkRuntime } from "./sdk.ts";

export type RuntimeOptions =
  | { type: "default"; model?: string; maxTokens?: number; provider?: string | ProviderConfig }
  | { type: "claude"; model?: string; options?: Omit<ClaudeCodeOptions, "model"> }
  | { type: "codex"; model?: string; options?: Omit<CodexOptions, "model"> }
  | { type: "cursor"; model?: string; options?: Omit<CursorOptions, "model"> }
  | { type: "opencode"; model?: string; options?: Omit<OpenCodeOptions, "model"> };

/**
 * Create a runtime instance
 * Model names are automatically translated to runtime-specific format
 * Accepts "sdk" as deprecated alias for "default"
 *
 * Examples:
 * - "sonnet" → cursor: "sonnet-4.5", claude: "sonnet", default: "claude-sonnet-4-5-20250514"
 * - "anthropic/claude-sonnet-4-5" → cursor: "sonnet-4.5", claude: "sonnet"
 */
export function createRuntime(
  config: RuntimeOptions | { type: "sdk"; model?: string; maxTokens?: number },
): Runtime {
  // Normalize "sdk" → "default" for backward compatibility
  const normalized = { ...config, type: normalizeRuntimeType(config.type) } as RuntimeOptions;
  // Translate model to runtime-specific format
  const model = getModelForRuntime(normalized.model, normalized.type);

  switch (normalized.type) {
    case "default": {
      const provider = (normalized as { provider?: string | ProviderConfig }).provider;
      return new SdkRuntime({
        model,
        maxTokens: (normalized as { maxTokens?: number }).maxTokens,
        provider,
      });
    }
    case "claude":
      return new ClaudeCodeRuntime({
        ...(normalized as { options?: Record<string, unknown> }).options,
        model,
      });
    case "codex":
      return new CodexRuntime({
        ...(normalized as { options?: Record<string, unknown> }).options,
        model,
      });
    case "cursor":
      return new CursorRuntime({
        ...(normalized as { options?: Record<string, unknown> }).options,
        model,
      });
    case "opencode":
      return new OpenCodeRuntime({
        ...(normalized as { options?: Record<string, unknown> }).options,
        model,
      });
    default:
      throw new Error(`Unknown runtime type: ${(normalized as { type: string }).type}`);
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
export async function checkRuntimes(): Promise<Record<RuntimeType, boolean>> {
  const claude = new ClaudeCodeRuntime();
  const codex = new CodexRuntime();
  const cursor = new CursorRuntime();
  const opencode = new OpenCodeRuntime();

  // Each isAvailable() spawns a process; use a 3s timeout to avoid hanging
  const [claudeAvailable, codexAvailable, cursorAvailable, opencodeAvailable] = await Promise.all([
    withTimeout(claude.isAvailable(), 3000),
    withTimeout(codex.isAvailable(), 3000),
    withTimeout(cursor.isAvailable(), 3000),
    withTimeout(opencode.isAvailable(), 3000),
  ]);

  return {
    default: true, // Always available (depends on API keys at runtime)
    claude: claudeAvailable,
    codex: codexAvailable,
    cursor: cursorAvailable,
    opencode: opencodeAvailable,
    mock: true, // Always available (in-memory)
  };
}

/**
 * List available backends with info
 */
export async function listRuntimes(): Promise<
  Array<{ type: RuntimeType; available: boolean; name: string }>
> {
  const availability = await checkRuntimes();

  return [
    { type: "default", available: availability.default, name: "Vercel AI SDK" },
    { type: "claude", available: availability.claude, name: "Claude Code CLI" },
    { type: "codex", available: availability.codex, name: "OpenAI Codex CLI" },
    { type: "cursor", available: availability.cursor, name: "Cursor Agent CLI" },
    { type: "opencode", available: availability.opencode, name: "OpenCode CLI" },
  ];
}
