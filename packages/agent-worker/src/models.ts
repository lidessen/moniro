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
 * Supports two formats:
 *
 * 1. Gateway format (recommended): creator/model-name
 *    Uses Vercel AI Gateway, works out of the box with AI_GATEWAY_API_KEY
 *
 *    Examples:
 *    - anthropic/claude-sonnet-4-5
 *    - anthropic/claude-opus-4-5
 *    - openai/gpt-5.2
 *    - openai/gpt-4o
 *    - google/gemini-2.5-flash
 *    - deepseek/deepseek-chat
 *    - xai/grok-4
 *    - mistral/mistral-large-latest
 *    - groq/llama-3.3-70b-versatile
 *
 * 2. Direct provider format: provider:model-name
 *    Requires installing the specific @ai-sdk/provider package
 *
 *    Examples:
 *    - anthropic:claude-sonnet-4-5      (requires @ai-sdk/anthropic)
 *    - openai:gpt-5.2                   (requires @ai-sdk/openai)
 *    - deepseek:deepseek-chat           (requires @ai-sdk/deepseek)
 *    - google:gemini-2.5-flash          (requires @ai-sdk/google)
 *    - groq:llama-3.3-70b-versatile     (requires @ai-sdk/groq)
 *    - mistral:mistral-large-latest     (requires @ai-sdk/mistral)
 *    - xai:grok-4                       (requires @ai-sdk/xai)
 */
export function createModel(modelId: string): LanguageModel {
  // Check if it's gateway format (contains /)
  if (modelId.includes('/')) {
    return gateway(modelId)
  }

  // Direct provider format (contains :)
  const colonIndex = modelId.indexOf(':')
  if (colonIndex === -1) {
    throw new Error(
      `Invalid model identifier: ${modelId}. Expected format: provider/model or provider:model`
    )
  }

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

  // Direct provider format (contains :)
  const colonIndex = modelId.indexOf(':')
  if (colonIndex === -1) {
    throw new Error(
      `Invalid model identifier: ${modelId}. Expected format: provider/model or provider:model`
    )
  }

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
] as const

export type SupportedProvider = (typeof SUPPORTED_PROVIDERS)[number]

/**
 * Frontier models for each provider (as of 2026-02)
 */
export const FRONTIER_MODELS = {
  // Anthropic Claude models
  anthropic: [
    'claude-opus-4-5',
    'claude-sonnet-4-5',
    'claude-haiku-4-5',
    'claude-sonnet-4-0',
    'claude-3-7-sonnet-latest',
  ],
  // OpenAI GPT models
  openai: ['gpt-5.2-pro', 'gpt-5.2', 'gpt-5.1', 'gpt-5', 'gpt-4o', 'gpt-4o-mini'],
  // Google Gemini models
  google: ['gemini-3-pro-preview', 'gemini-2.5-pro', 'gemini-2.5-flash'],
  // DeepSeek models
  deepseek: ['deepseek-chat', 'deepseek-reasoner'],
  // Groq-hosted models
  groq: [
    'meta-llama/llama-4-scout-17b-16e-instruct',
    'llama-3.3-70b-versatile',
    'deepseek-r1-distill-llama-70b',
    'qwen-qwq-32b',
  ],
  // Mistral models
  mistral: [
    'pixtral-large-latest',
    'mistral-large-latest',
    'magistral-medium-2506',
    'mistral-small-latest',
  ],
  // xAI Grok models
  xai: ['grok-4', 'grok-4-fast-reasoning', 'grok-3', 'grok-3-fast', 'grok-3-mini'],
} as const
