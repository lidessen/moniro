import { gateway, type LanguageModel } from "ai";

// Cache for lazy-loaded providers
const providerCache: Record<string, ((model: string) => LanguageModel) | null> = {};

interface ProviderOptions {
  baseURL?: string;
  apiKeyEnvVar?: string; // Custom env var name for API key
}

/**
 * Lazy load a provider, caching the result
 * Supports custom baseURL and apiKey for providers using compatible APIs (e.g., MiniMax using Claude API)
 */
async function loadProvider(
  name: string,
  packageName: string,
  exportName: string,
  options?: ProviderOptions,
): Promise<((model: string) => LanguageModel) | null> {
  if (name in providerCache) {
    return providerCache[name] ?? null;
  }

  try {
    const module = await import(packageName);
    // If custom options provided, create provider instance with them
    if (options?.baseURL || options?.apiKeyEnvVar) {
      const createProvider =
        module[`create${exportName.charAt(0).toUpperCase() + exportName.slice(1)}`];
      if (createProvider) {
        const providerOptions: Record<string, string | undefined> = {};
        if (options.baseURL) {
          providerOptions.baseURL = options.baseURL;
        }
        if (options.apiKeyEnvVar) {
          const apiKey = process.env[options.apiKeyEnvVar];
          if (!apiKey) {
            throw new Error(
              `Environment variable ${options.apiKeyEnvVar} is not set (required for ${name} provider)`,
            );
          }
          providerOptions.apiKey = apiKey;
        }
        const provider = createProvider(providerOptions);
        providerCache[name] = provider;
        return provider;
      }
    }
    const exportedProvider = module[exportName] as ((model: string) => LanguageModel) | null;
    providerCache[name] = exportedProvider;
    return exportedProvider;
  } catch {
    providerCache[name] = null;
    return null;
  }
}

/**
 * Parse model identifier and return the appropriate provider model
 *
 * Supports three formats:
 *
 * 1. Provider-only format: provider
 *    Uses first model from FRONTIER_MODELS via gateway
 *    Examples: anthropic → anthropic/claude-sonnet-4-5, openai → openai/gpt-5.2
 *
 * 2. Gateway format: provider/model-name
 *    Uses Vercel AI Gateway (requires AI_GATEWAY_API_KEY)
 *    Examples: anthropic/claude-sonnet-4-5, openai/gpt-5.2, deepseek/deepseek-chat
 *
 * 3. Direct provider format: provider:model-name
 *    Requires installing the specific @ai-sdk/provider package
 *    Examples: anthropic:claude-sonnet-4-5, openai:gpt-5.2, deepseek:deepseek-chat
 */
export function createModel(modelId: string): LanguageModel {
  // Check if it's gateway format (contains /)
  if (modelId.includes("/")) {
    return gateway(modelId);
  }

  // Check if it's provider-only format (no / or :)
  if (!modelId.includes(":")) {
    const provider = modelId as keyof typeof FRONTIER_MODELS;
    if (provider in FRONTIER_MODELS) {
      const defaultModel = FRONTIER_MODELS[provider][0];
      return gateway(`${provider}/${defaultModel}`);
    }
    throw new Error(
      `Unknown provider: ${modelId}. Supported: ${Object.keys(FRONTIER_MODELS).join(", ")}`,
    );
  }

  // Direct provider format (contains :)
  const colonIndex = modelId.indexOf(":");

  const provider = modelId.slice(0, colonIndex);
  const modelName = modelId.slice(colonIndex + 1);

  if (!modelName) {
    throw new Error(`Invalid model identifier: ${modelId}. Model name is required.`);
  }

  // For direct providers, we need synchronous access after first load
  // Check cache first
  if (provider in providerCache && providerCache[provider]) {
    return providerCache[provider]!(modelName);
  }

  // Provider not loaded yet - throw helpful error
  // The user should use createModelAsync for first-time direct provider access
  throw new Error(
    `Provider '${provider}' not loaded. Use gateway format (${provider}/${modelName}) ` +
      `or call createModelAsync() for direct provider access.`,
  );
}

/**
 * Async version of createModel - supports lazy loading of direct providers
 * Use this when you need direct provider access (provider:model format)
 */
export async function createModelAsync(modelId: string): Promise<LanguageModel> {
  // Check if it's gateway format (contains /)
  if (modelId.includes("/")) {
    return gateway(modelId);
  }

  // Check if it's provider-only format (no / or :)
  if (!modelId.includes(":")) {
    const provider = modelId as keyof typeof FRONTIER_MODELS;
    if (provider in FRONTIER_MODELS) {
      const defaultModel = FRONTIER_MODELS[provider][0];
      return gateway(`${provider}/${defaultModel}`);
    }
    throw new Error(
      `Unknown provider: ${modelId}. Supported: ${Object.keys(FRONTIER_MODELS).join(", ")}`,
    );
  }

  // Direct provider format (contains :)
  const colonIndex = modelId.indexOf(":");

  const provider = modelId.slice(0, colonIndex);
  const modelName = modelId.slice(colonIndex + 1);

  if (!modelName) {
    throw new Error(`Invalid model identifier: ${modelId}. Model name is required.`);
  }

  const providerConfigs: Record<
    string,
    { package: string; export: string; options?: ProviderOptions }
  > = {
    anthropic: { package: "@ai-sdk/anthropic", export: "anthropic" },
    openai: { package: "@ai-sdk/openai", export: "openai" },
    deepseek: { package: "@ai-sdk/deepseek", export: "deepseek" },
    google: { package: "@ai-sdk/google", export: "google" },
    groq: { package: "@ai-sdk/groq", export: "groq" },
    mistral: { package: "@ai-sdk/mistral", export: "mistral" },
    xai: { package: "@ai-sdk/xai", export: "xai" },
    // MiniMax uses Claude-compatible API
    // Set MINIMAX_BASE_URL to override (e.g., "https://api.minimaxi.com" for CN)
    minimax: {
      package: "@ai-sdk/anthropic",
      export: "anthropic",
      options: {
        baseURL: `${(process.env.MINIMAX_BASE_URL || "https://api.minimax.io").replace(/\/+$/, "")}/anthropic/v1`,
        apiKeyEnvVar: "MINIMAX_API_KEY",
      },
    },
  };

  const config = providerConfigs[provider];
  if (!config) {
    throw new Error(
      `Unknown provider: ${provider}. ` +
        `Supported: ${Object.keys(providerConfigs).join(", ")}. ` +
        `Or use gateway format: provider/model (e.g., openai/gpt-5.2)`,
    );
  }

  const providerFn = await loadProvider(provider, config.package, config.export, config.options);
  if (!providerFn) {
    throw new Error(`Install ${config.package} to use ${provider} models directly`);
  }

  return providerFn(modelName);
}

/**
 * List of supported providers for direct access
 * Note: minimax uses Claude-compatible API via @ai-sdk/anthropic with custom baseURL
 */
export const SUPPORTED_PROVIDERS = [
  "anthropic",
  "openai",
  "deepseek",
  "google",
  "groq",
  "mistral",
  "xai",
  "minimax",
] as const;

export type SupportedProvider = (typeof SUPPORTED_PROVIDERS)[number];

/**
 * Default provider when none specified
 */
export const DEFAULT_PROVIDER = "anthropic" as const;

/**
 * Get the default model identifier (provider/model format)
 * Uses the first model from the default provider
 */
export function getDefaultModel(): string {
  return `${DEFAULT_PROVIDER}/${FRONTIER_MODELS[DEFAULT_PROVIDER][0]}`;
}

/**
 * Frontier models for each provider (as of 2026-02)
 * Only includes the latest/best models, no legacy versions
 *
 * Note: Some models may be placeholders for testing or future releases.
 * Always verify model availability with the provider before production use.
 */
export const FRONTIER_MODELS = {
  anthropic: ["claude-sonnet-4-5", "claude-haiku-4-5", "claude-opus-4-5"],
  openai: ["gpt-5.2", "gpt-5.2-codex"],
  google: ["gemini-3-pro-preview", "gemini-2.5-flash", "gemini-2.5-pro"],
  deepseek: ["deepseek-chat", "deepseek-reasoner"],
  groq: ["meta-llama/llama-4-scout-17b-16e-instruct", "deepseek-r1-distill-llama-70b"],
  mistral: ["mistral-large-latest", "pixtral-large-latest", "magistral-medium-2506"],
  xai: ["grok-4", "grok-4-fast-reasoning"],
  minimax: ["MiniMax-M2"],
} as const;
