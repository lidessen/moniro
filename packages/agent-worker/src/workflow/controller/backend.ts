/**
 * Backend Selection
 * Maps workflow config to Backend instances from backends/
 */

import type { Backend } from '../../backends/types.ts'
import { parseModel, getModelForBackend } from '../../backends/model-maps.ts'
import { createBackend } from '../../backends/index.ts'
import { createMockBackend } from '../../backends/mock.ts'

/**
 * Get backend by explicit backend type
 *
 * All backends are created via the canonical createBackend() factory
 * from backends/index.ts. Mock backend is handled specially (no model needed).
 */
export function getBackendByType(
  backendType: 'sdk' | 'claude' | 'cursor' | 'codex' | 'mock',
  options?: { model?: string; debugLog?: (msg: string) => void }
): Backend {
  if (backendType === 'mock') {
    return createMockBackend(options?.debugLog)
  }

  return createBackend({
    type: backendType,
    model: options?.model,
  } as Parameters<typeof createBackend>[0])
}

/**
 * Get appropriate backend for a model identifier
 *
 * Infers backend type from model name and delegates to getBackendByType.
 * Prefer using getBackendByType with explicit backend field in workflow configs.
 */
export function getBackendForModel(
  model: string,
  options?: { debugLog?: (msg: string) => void }
): Backend {
  const { provider } = parseModel(model)

  switch (provider) {
    case 'anthropic':
      return getBackendByType('sdk', { ...options, model })

    case 'claude':
      return getBackendByType('claude', { ...options, model })

    case 'codex':
      return getBackendByType('codex', { ...options, model })

    default:
      throw new Error(`Unknown provider: ${provider}. Specify backend explicitly.`)
  }
}
