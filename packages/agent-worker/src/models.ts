import { gateway, type LanguageModel } from 'ai'

// Cache for lazy-loaded providers
const providerCache: Record<string, ((model: string) => LanguageModel) | null> = {}

/**
 * Lazy load a provider, caching the result
 */
async function loadProvider(
  name: string,
  packageName: string,
  exportName: string
): Promise<((model: string) => LanguageModel) | null> {
  if (name in providerCache) {
    return providerCache[name]
  }

  try {
    const module = await import(packageName)
    providerCache[name] = module[exportName]
    return providerCache[name]
  } catch {
    providerCache[name] = null
    return null
  }
}

/**
 * Parse model identifier and return the appropriate provider model
 *
 * Supports three formats:
 *
 * 1. Provider-only format: provider
 *    Uses first (most commonly used) model from FRONTIER_MODELS via gateway
 *
 *    Examples:
 *    - anthropic  → anthropic/claude-sonnet-4-5
 *    - openai     → openai/gpt-4o
 *    - deepseek   → deepseek/deepseek-chat
 *
 * 2. Gateway format: provider/model-name
 *    Uses Vercel AI Gateway, works out of the box with AI_GATEWAY_API_KEY
 *
 *    Examples:
 *    - anthropic/claude-sonnet-4-5
 *    - openai/gpt-4o
 *    - google/gemini-2.5-flash
 *    - deepseek/deepseek-chat
 *
 * 3. Direct provider format: provider:model-name
 *    Requires installing the specific @ai-sdk/provider package
 *
 *    Examples:
 *    - anthropic:claude-sonnet-4-5      (requires @ai-sdk/anthropic)
 *    - openai:gpt-4o                    (requires @ai-sdk/openai)
 *    - deepseek:deepseek-chat           (requires @ai-sdk/deepseek)
 */
export function createModel(modelId: string): LanguageModel {
  // Check if it's gateway format (contains /)
  if (modelId.includes('/')) {
    return gateway(modelId)
  }

  // Check if it's provider-only format (no / or :)
  if (!modelId.includes(':')) {
    const provider = modelId as keyof typeof FRONTIER_MODELS
    if (provider in FRONTIER_MODELS) {
      const defaultModel = FRONTIER_MODELS[provider][0]
      return gateway(`${provider}/${defaultModel}`)
    }
    throw new Error(
      `Unknown provider: ${modelId}. Supported: ${Object.keys(FRONTIER_MODELS).join(', ')}`
    )
  }

  // Direct provider format (contains :)
  const colonIndex = modelId.indexOf(':')

  const provider = modelId.slice(0, colonIndex)
  const modelName = modelId.slice(colonIndex + 1)

  if (!modelName) {
    throw new Error(`Invalid model identifier: ${modelId}. Model name is required.`)
  }

  // For direct providers, we need synchronous access after first load
  // Check cache first
  if (provider in providerCache && providerCache[provider]) {
    return providerCache[provider]!(modelName)
  }

  // Provider not loaded yet - throw helpful error
  // The user should use createModelAsync for first-time direct provider access
  throw new Error(
    `Provider '${provider}' not loaded. Use gateway format (${provider}/${modelName}) ` +
      `or call createModelAsync() for direct provider access.`
  )
}

/**
 * Async version of createModel - supports lazy loading of direct providers
 * Use this when you need direct provider access (provider:model format)
 */
export async function createModelAsync(modelId: string): Promise<LanguageModel> {
  // Check if it's gateway format (contains /)
  if (modelId.includes('/')) {
    return gateway(modelId)
  }

  // Check if it's provider-only format (no / or :)
  if (!modelId.includes(':')) {
    const provider = modelId as keyof typeof FRONTIER_MODELS
    if (provider in FRONTIER_MODELS) {
      const defaultModel = FRONTIER_MODELS[provider][0]
      return gateway(`${provider}/${defaultModel}`)
    }
    throw new Error(
      `Unknown provider: ${modelId}. Supported: ${Object.keys(FRONTIER_MODELS).join(', ')}`
    )
  }

  // Direct provider format (contains :)
  const colonIndex = modelId.indexOf(':')

  const provider = modelId.slice(0, colonIndex)
  const modelName = modelId.slice(colonIndex + 1)

  if (!modelName) {
    throw new Error(`Invalid model identifier: ${modelId}. Model name is required.`)
  }

  const providerConfigs: Record<string, { package: string; export: string }> = {
    anthropic: { package: '@ai-sdk/anthropic', export: 'anthropic' },
    openai: { package: '@ai-sdk/openai', export: 'openai' },
    deepseek: { package: '@ai-sdk/deepseek', export: 'deepseek' },
    google: { package: '@ai-sdk/google', export: 'google' },
    groq: { package: '@ai-sdk/groq', export: 'groq' },
    mistral: { package: '@ai-sdk/mistral', export: 'mistral' },
    xai: { package: '@ai-sdk/xai', export: 'xai' },
    minimax: { package: 'vercel-minimax-ai-provider', export: 'minimax' },
  }

  const config = providerConfigs[provider]
  if (!config) {
    throw new Error(
      `Unknown provider: ${provider}. ` +
        `Supported: ${Object.keys(providerConfigs).join(', ')}. ` +
        `Or use gateway format: provider/model (e.g., openai/gpt-5.2)`
    )
  }

  const providerFn = await loadProvider(provider, config.package, config.export)
  if (!providerFn) {
    throw new Error(`Install ${config.package} to use ${provider} models directly`)
  }

  return providerFn(modelName)
}

/**
 * List of supported providers for direct access
 */
export const SUPPORTED_PROVIDERS = [
  'anthropic',
  'openai',
  'deepseek',
  'google',
  'groq',
  'mistral',
  'xai',
  'minimax',
] as const

export type SupportedProvider = (typeof SUPPORTED_PROVIDERS)[number]

/**
 * Default provider when none specified
 */
export const DEFAULT_PROVIDER = 'anthropic' as const

/**
 * Get the default model identifier (provider/model format)
 * Uses the first model from the default provider
 */
export function getDefaultModel(): string {
  return `${DEFAULT_PROVIDER}/${FRONTIER_MODELS[DEFAULT_PROVIDER][0]}`
}

/**
 * Frontier models for each provider (as of 2026-02)
 * NOTE: First model in each array is the most commonly used (not necessarily the best)
 */
export const FRONTIER_MODELS = {
  // Anthropic Claude models - sonnet is most commonly used (good balance of cost/performance)
  anthropic: [
    'claude-sonnet-4-5',
    'claude-haiku-4-5',
    'claude-opus-4-5',
    'claude-sonnet-4-0',
    'claude-3-7-sonnet-latest',
  ],
  // OpenAI GPT models - gpt-5.2 is the new standard
  openai: ['gpt-5.2', 'gpt-5.2-pro', 'gpt-5.1', 'gpt-5', 'gpt-4o', 'gpt-4o-mini', 'codex-2'],
  // Google Gemini models - flash is most commonly used (fast, cost-effective)
  google: ['gemini-2.5-flash', 'gemini-2.5-pro', 'gemini-3-pro-preview'],
  // DeepSeek models - chat is the standard choice
  deepseek: ['deepseek-chat', 'deepseek-reasoner'],
  // Groq-hosted models - llama-3.3-70b is the go-to
  groq: [
    'llama-3.3-70b-versatile',
    'meta-llama/llama-4-scout-17b-16e-instruct',
    'deepseek-r1-distill-llama-70b',
    'qwen-qwq-32b',
  ],
  // Mistral models - small is most commonly used (cost-effective)
  mistral: [
    'mistral-small-latest',
    'mistral-large-latest',
    'pixtral-large-latest',
    'magistral-medium-2506',
  ],
  // xAI Grok models - grok-3 is more established
  xai: ['grok-3', 'grok-3-fast', 'grok-3-mini', 'grok-4', 'grok-4-fast-reasoning'],
  // MiniMax models
  minimax: ['MiniMax-M2', 'MiniMax-M2-Stable'],
} as const
