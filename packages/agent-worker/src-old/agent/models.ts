import { gateway, type LanguageModel } from "ai";
import type { ProviderConfig } from "../workflow/types.ts";

// Re-export for convenience
export type { ProviderConfig } from "../workflow/types.ts";

// Cache for lazy-loaded providers
const providerCache: Record<string, ((model: string) => LanguageModel) | null> = {};

/** Provider SDK package mapping */
const PROVIDER_PACKAGES: Record<string, { package: string; export: string }> = {
  anthropic: { package: "@ai-sdk/anthropic", export: "anthropic" },
  openai: { package: "@ai-sdk/openai", export: "openai" },
  deepseek: { package: "@ai-sdk/deepseek", export: "deepseek" },
  google: { package: "@ai-sdk/google", export: "google" },
  groq: { package: "@ai-sdk/groq", export: "groq" },
  mistral: { package: "@ai-sdk/mistral", export: "mistral" },
  xai: { package: "@ai-sdk/xai", export: "xai" },
};

/**
 * Lazy load a provider SDK, caching the result.
 * Only caches standard providers (no custom baseURL/apiKey).
 */
async function loadProvider(
  name: string,
  packageName: string,
  exportName: string,
): Promise<((model: string) => LanguageModel) | null> {
  if (name in providerCache) {
    return providerCache[name] ?? null;
  }

  try {
    const module = await import(packageName);
    const exportedProvider = module[exportName] as ((model: string) => LanguageModel) | null;
    providerCache[name] = exportedProvider;
    return exportedProvider;
  } catch {
    providerCache[name] = null;
    return null;
  }
}

/**
 * Create a provider instance with custom baseURL and/or apiKey.
 * Not cached — each call creates a fresh instance.
 */
async function createCustomProvider(
  packageName: string,
  exportName: string,
  options: { baseURL?: string; apiKey?: string },
): Promise<(model: string) => LanguageModel> {
  const module = await import(packageName);
  const createFn = module[`create${exportName.charAt(0).toUpperCase() + exportName.slice(1)}`];
  if (!createFn) {
    throw new Error(
      `Package ${packageName} does not export create${exportName.charAt(0).toUpperCase() + exportName.slice(1)}`,
    );
  }
  return createFn(options);
}

/**
 * Resolve api_key field: '$ENV_VAR' → process.env.ENV_VAR, literal → as-is
 */
function resolveApiKey(apiKey: string): string {
  if (apiKey.startsWith("$")) {
    const envVar = apiKey.slice(1);
    const value = process.env[envVar];
    if (!value) {
      throw new Error(`Environment variable ${envVar} is not set`);
    }
    return value;
  }
  return apiKey;
}

/**
 * Create a model using explicit provider configuration.
 * Use this when provider details (base_url, api_key) are specified separately from the model name.
 *
 * Example:
 *   createModelWithProvider("MiniMax-M2.5", { name: "anthropic", base_url: "https://api.minimax.io/anthropic/v1", api_key: "$MINIMAX_API_KEY" })
 */
export async function createModelWithProvider(
  modelName: string,
  provider: string | ProviderConfig,
): Promise<LanguageModel> {
  // String provider → resolve to built-in (no custom options)
  if (typeof provider === "string") {
    const pkg = PROVIDER_PACKAGES[provider];
    if (!pkg) {
      throw new Error(
        `Unknown provider: ${provider}. Supported: ${Object.keys(PROVIDER_PACKAGES).join(", ")}`,
      );
    }
    const providerFn = await loadProvider(provider, pkg.package, pkg.export);
    if (!providerFn) {
      throw new Error(`Install ${pkg.package} to use ${provider} models directly`);
    }
    return providerFn(modelName);
  }

  // Object provider
  const { name, base_url, api_key } = provider;
  const pkg = PROVIDER_PACKAGES[name];
  if (!pkg) {
    throw new Error(
      `Unknown provider: ${name}. Supported: ${Object.keys(PROVIDER_PACKAGES).join(", ")}`,
    );
  }

  // No custom options → use cached standard provider (same as string path)
  if (!base_url && !api_key) {
    const providerFn = await loadProvider(name, pkg.package, pkg.export);
    if (!providerFn) {
      throw new Error(`Install ${pkg.package} to use ${name} models directly`);
    }
    return providerFn(modelName);
  }

  // Custom baseURL/apiKey → fresh instance (not cached)
  const opts: { baseURL?: string; apiKey?: string } = {};
  if (base_url) opts.baseURL = base_url;
  if (api_key) opts.apiKey = resolveApiKey(api_key);

  const providerFn = await createCustomProvider(pkg.package, pkg.export, opts);
  return providerFn(modelName);
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

  const config = PROVIDER_PACKAGES[provider];
  if (!config) {
    throw new Error(
      `Unknown provider: ${provider}. ` +
        `Supported: ${Object.keys(PROVIDER_PACKAGES).join(", ")}. ` +
        `Or use gateway format: provider/model (e.g., openai/gpt-5.2)`,
    );
  }

  const providerFn = await loadProvider(provider, config.package, config.export);
  if (!providerFn) {
    throw new Error(`Install ${config.package} to use ${provider} models directly`);
  }

  return providerFn(modelName);
}

/**
 * List of supported providers for direct access
 */
export const SUPPORTED_PROVIDERS = [
  "anthropic",
  "openai",
  "deepseek",
  "google",
  "groq",
  "mistral",
  "xai",
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
} as const;
