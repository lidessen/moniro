import { gateway, type LanguageModel } from 'ai'

// Optional provider imports - users install what they need
let anthropic: ((model: string) => LanguageModel) | undefined
let openai: ((model: string) => LanguageModel) | undefined
let deepseek: ((model: string) => LanguageModel) | undefined
let google: ((model: string) => LanguageModel) | undefined
let groq: ((model: string) => LanguageModel) | undefined
let mistral: ((model: string) => LanguageModel) | undefined
let xai: ((model: string) => LanguageModel) | undefined

// Try to load optional providers
try {
  anthropic = (await import('@ai-sdk/anthropic')).anthropic
} catch {}
try {
  openai = (await import('@ai-sdk/openai')).openai
} catch {}
try {
  deepseek = (await import('@ai-sdk/deepseek')).deepseek
} catch {}
try {
  google = (await import('@ai-sdk/google')).google
} catch {}
try {
  groq = (await import('@ai-sdk/groq')).groq
} catch {}
try {
  mistral = (await import('@ai-sdk/mistral')).mistral
} catch {}
try {
  xai = (await import('@ai-sdk/xai')).xai
} catch {}

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

  switch (provider) {
    case 'anthropic':
      if (!anthropic) {
        throw new Error('Install @ai-sdk/anthropic to use Anthropic models directly')
      }
      return anthropic(modelName)

    case 'openai':
      if (!openai) {
        throw new Error('Install @ai-sdk/openai to use OpenAI models directly')
      }
      return openai(modelName)

    case 'deepseek':
      if (!deepseek) {
        throw new Error('Install @ai-sdk/deepseek to use DeepSeek models directly')
      }
      return deepseek(modelName)

    case 'google':
      if (!google) {
        throw new Error('Install @ai-sdk/google to use Google models directly')
      }
      return google(modelName)

    case 'groq':
      if (!groq) {
        throw new Error('Install @ai-sdk/groq to use Groq models directly')
      }
      return groq(modelName)

    case 'mistral':
      if (!mistral) {
        throw new Error('Install @ai-sdk/mistral to use Mistral models directly')
      }
      return mistral(modelName)

    case 'xai':
      if (!xai) {
        throw new Error('Install @ai-sdk/xai to use xAI models directly')
      }
      return xai(modelName)

    default:
      throw new Error(
        `Unknown provider: ${provider}. ` +
          `Supported: anthropic, openai, deepseek, google, groq, mistral, xai. ` +
          `Or use gateway format: provider/model (e.g., openai/gpt-5.2)`
      )
  }
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
 * Example models for each provider (as of 2026-02)
 */
export const EXAMPLE_MODELS = {
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
