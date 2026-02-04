/**
 * Backend factory and exports
 */

export * from './types.ts'
export { ClaudeCliBackend, type ClaudeCliOptions } from './claude-cli.ts'
export { CodexCliBackend, type CodexCliOptions } from './codex-cli.ts'
export { SdkBackend, type SdkBackendOptions } from './sdk.ts'

import type { Backend, BackendType } from './types.ts'
import { ClaudeCliBackend, type ClaudeCliOptions } from './claude-cli.ts'
import { CodexCliBackend, type CodexCliOptions } from './codex-cli.ts'
import { SdkBackend, type SdkBackendOptions } from './sdk.ts'

export type BackendOptions =
  | { type: 'sdk'; model: string; maxTokens?: number }
  | { type: 'claude'; options?: ClaudeCliOptions }
  | { type: 'codex'; options?: CodexCliOptions }

/**
 * Create a backend instance
 */
export function createBackend(config: BackendOptions): Backend {
  switch (config.type) {
    case 'sdk':
      return new SdkBackend({ model: config.model, maxTokens: config.maxTokens })
    case 'claude':
      return new ClaudeCliBackend(config.options)
    case 'codex':
      return new CodexCliBackend(config.options)
    default:
      throw new Error(`Unknown backend type: ${(config as { type: string }).type}`)
  }
}

/**
 * Check which backends are available
 */
export async function checkBackends(): Promise<Record<BackendType, boolean>> {
  const claude = new ClaudeCliBackend()
  const codex = new CodexCliBackend()

  const [claudeAvailable, codexAvailable] = await Promise.all([
    claude.isAvailable(),
    codex.isAvailable(),
  ])

  return {
    sdk: true, // Always available (depends on API keys at runtime)
    claude: claudeAvailable,
    codex: codexAvailable,
  }
}

/**
 * List available backends with info
 */
export async function listBackends(): Promise<
  Array<{ type: BackendType; available: boolean; name: string }>
> {
  const availability = await checkBackends()

  return [
    { type: 'sdk', available: availability.sdk, name: 'Vercel AI SDK' },
    { type: 'claude', available: availability.claude, name: 'Claude Code CLI' },
    { type: 'codex', available: availability.codex, name: 'OpenAI Codex CLI' },
  ]
}
