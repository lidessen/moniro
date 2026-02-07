/**
 * Model Translation Maps — Single Source of Truth
 *
 * All backend-specific model naming and translation logic lives here.
 * Both `backends/types.ts` and `workflow/controller/types.ts` re-export from this module.
 */

// ==================== Backend Type ====================

/** Backend type (union of all supported backends) */
export type BackendType = 'sdk' | 'claude' | 'cursor' | 'codex' | 'mock'

// ==================== Model Configuration ====================

/** Default model per backend */
export const BACKEND_DEFAULT_MODELS: Record<BackendType, string> = {
  mock: 'mock-model',
  sdk: 'claude-sonnet-4-5',
  claude: 'sonnet',
  cursor: 'sonnet-4.5',
  codex: 'gpt-5.2-codex',
}

/**
 * Model aliases for SDK (Anthropic format)
 */
export const SDK_MODEL_ALIASES: Record<string, string> = {
  sonnet: 'claude-sonnet-4-5-20250514',
  opus: 'claude-opus-4-20250514',
  haiku: 'claude-haiku-3-5-20250514',
  'claude-sonnet-4-5': 'claude-sonnet-4-5-20250514',
  'claude-opus-4': 'claude-opus-4-20250514',
  'claude-haiku-3-5': 'claude-haiku-3-5-20250514',
}

/**
 * Model translation for Cursor backend
 * Cursor uses its own naming convention
 */
export const CURSOR_MODEL_MAP: Record<string, string> = {
  // Anthropic models
  sonnet: 'sonnet-4.5',
  opus: 'opus-4.5',
  'sonnet-4.5': 'sonnet-4.5',
  'opus-4.5': 'opus-4.5',
  'opus-4.6': 'opus-4.6',
  'claude-sonnet-4-5': 'sonnet-4.5',
  'claude-opus-4-5': 'opus-4.5',
  'anthropic/claude-sonnet-4-5': 'sonnet-4.5',
  'anthropic/claude-opus-4-5': 'opus-4.5',
  // Thinking models
  'sonnet-4.5-thinking': 'sonnet-4.5-thinking',
  'opus-4.5-thinking': 'opus-4.5-thinking',
  'opus-4.6-thinking': 'opus-4.6-thinking',
  // OpenAI/GPT models
  'gpt-5.2': 'gpt-5.2',
  'gpt-5.1': 'gpt-5.1-high',
  'gpt-4': 'gpt-5.2',
  // Gemini
  'gemini-pro': 'gemini-3-pro',
  'gemini-flash': 'gemini-3-flash',
  // Special
  auto: 'auto',
}

/**
 * Model translation for Claude CLI backend
 * Claude CLI uses short model names
 */
export const CLAUDE_MODEL_MAP: Record<string, string> = {
  sonnet: 'sonnet',
  opus: 'opus',
  haiku: 'haiku',
  'sonnet-4.5': 'sonnet',
  'opus-4.5': 'opus',
  'claude-sonnet-4-5': 'sonnet',
  'claude-opus-4': 'opus',
  'claude-haiku-3-5': 'haiku',
  'anthropic/claude-sonnet-4-5': 'sonnet',
  'anthropic/claude-opus-4': 'opus',
}

/**
 * Model translation for Codex CLI backend
 */
export const CODEX_MODEL_MAP: Record<string, string> = {
  'gpt-5.2-codex': 'gpt-5.2-codex',
  'gpt-5.2': 'gpt-5.2-codex',
  o3: 'o3',
  'o3-mini': 'o3-mini',
}

// ==================== Model Translation ====================

/**
 * Get the model name for a specific backend
 * Translates generic model names to backend-specific format
 */
export function getModelForBackend(model: string | undefined, backend: BackendType): string {
  // Use default if no model specified
  if (!model) {
    return BACKEND_DEFAULT_MODELS[backend]
  }

  // Strip provider prefix if present (e.g., "anthropic/claude-sonnet-4-5" -> "claude-sonnet-4-5")
  const normalizedModel = model.includes('/') ? model.split('/').pop()! : model

  switch (backend) {
    case 'sdk':
      // For SDK, try alias first, otherwise preserve original model string
      return SDK_MODEL_ALIASES[normalizedModel] || model

    case 'cursor':
      return CURSOR_MODEL_MAP[model] || CURSOR_MODEL_MAP[normalizedModel] || normalizedModel

    case 'claude':
      return CLAUDE_MODEL_MAP[model] || CLAUDE_MODEL_MAP[normalizedModel] || normalizedModel

    case 'codex':
      return CODEX_MODEL_MAP[model] || CODEX_MODEL_MAP[normalizedModel] || normalizedModel

    default:
      return normalizedModel
  }
}

// ==================== Model Parsing ====================

/** Parsed model information */
export interface ParsedModel {
  /** Provider name (anthropic, claude, codex, etc.) */
  provider: string
  /** Model identifier */
  model: string
}

/**
 * Parse model string to provider and version (legacy, for SDK backend)
 * Format: provider/model-name or just model-name (defaults to anthropic)
 */
export function parseModel(model: string): ParsedModel {
  const parts = model.split('/')
  if (parts.length === 2) {
    return {
      provider: parts[0]!,
      model: SDK_MODEL_ALIASES[parts[1]!] || parts[1]!,
    }
  }
  return {
    provider: 'anthropic',
    model: SDK_MODEL_ALIASES[model] || model,
  }
}

/**
 * Resolve model alias to specific version (for SDK backend)
 */
export function resolveModelAlias(model: string): string {
  return SDK_MODEL_ALIASES[model] || model
}
