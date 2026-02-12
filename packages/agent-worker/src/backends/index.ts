/**
 * Backend factory and exports
 */

export * from "./types.ts";
export { ClaudeCodeBackend, type ClaudeCodeOptions } from "./claude-code.ts";
export { CodexBackend, type CodexOptions } from "./codex.ts";
export { CursorBackend, type CursorOptions } from "./cursor.ts";
export { OpenCodeBackend, type OpenCodeOptions } from "./opencode.ts";
export { SdkBackend, type SdkBackendOptions } from "./sdk.ts";
export { MockAIBackend, createMockBackend } from "./mock.ts";
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

import type { Backend, BackendType } from "./types.ts";
import type { ProviderConfig } from "../workflow/types.ts";
import { getModelForBackend, normalizeBackendType } from "./model-maps.ts";
import { ClaudeCodeBackend, type ClaudeCodeOptions } from "./claude-code.ts";
import { CodexBackend, type CodexOptions } from "./codex.ts";
import { CursorBackend, type CursorOptions } from "./cursor.ts";
import { OpenCodeBackend, type OpenCodeOptions } from "./opencode.ts";
import { SdkBackend } from "./sdk.ts";

export type BackendOptions =
  | { type: "default"; model?: string; maxTokens?: number; provider?: string | ProviderConfig }
  | { type: "claude"; model?: string; options?: Omit<ClaudeCodeOptions, "model"> }
  | { type: "codex"; model?: string; options?: Omit<CodexOptions, "model"> }
  | { type: "cursor"; model?: string; options?: Omit<CursorOptions, "model"> }
  | { type: "opencode"; model?: string; options?: Omit<OpenCodeOptions, "model"> };

/**
 * Create a backend instance
 * Model names are automatically translated to backend-specific format
 * Accepts "sdk" as deprecated alias for "default"
 *
 * Examples:
 * - "sonnet" → cursor: "sonnet-4.5", claude: "sonnet", default: "claude-sonnet-4-5-20250514"
 * - "anthropic/claude-sonnet-4-5" → cursor: "sonnet-4.5", claude: "sonnet"
 */
export function createBackend(
  config: BackendOptions | { type: "sdk"; model?: string; maxTokens?: number },
): Backend {
  // Normalize "sdk" → "default" for backward compatibility
  const normalized = { ...config, type: normalizeBackendType(config.type) } as BackendOptions;
  // Translate model to backend-specific format
  const model = getModelForBackend(normalized.model, normalized.type);

  switch (normalized.type) {
    case "default": {
      const provider = (normalized as { provider?: string | ProviderConfig }).provider;
      return new SdkBackend({ model, maxTokens: (normalized as { maxTokens?: number }).maxTokens, provider });
    }
    case "claude":
      return new ClaudeCodeBackend({
        ...(normalized as { options?: Record<string, unknown> }).options,
        model,
      });
    case "codex":
      return new CodexBackend({
        ...(normalized as { options?: Record<string, unknown> }).options,
        model,
      });
    case "cursor":
      return new CursorBackend({
        ...(normalized as { options?: Record<string, unknown> }).options,
        model,
      });
    case "opencode":
      return new OpenCodeBackend({
        ...(normalized as { options?: Record<string, unknown> }).options,
        model,
      });
    default:
      throw new Error(`Unknown backend type: ${(normalized as { type: string }).type}`);
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
  const opencode = new OpenCodeBackend();

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
export async function listBackends(): Promise<
  Array<{ type: BackendType; available: boolean; name: string }>
> {
  const availability = await checkBackends();

  return [
    { type: "default", available: availability.default, name: "Vercel AI SDK" },
    { type: "claude", available: availability.claude, name: "Claude Code CLI" },
    { type: "codex", available: availability.codex, name: "OpenAI Codex CLI" },
    { type: "cursor", available: availability.cursor, name: "Cursor Agent CLI" },
    { type: "opencode", available: availability.opencode, name: "OpenCode CLI" },
  ];
}
