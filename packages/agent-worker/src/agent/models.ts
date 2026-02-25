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

// ==================== Provider Auto-Discovery ====================

/**
 * Environment variable that each provider uses for authentication.
 * Ordered by priority — first match wins during auto-discovery.
 *
 * Gateway is first because it supports all providers via a single key.
 */
export const PROVIDER_ENV_KEYS: Record<string, string> = {
  gateway: "AI_GATEWAY_API_KEY",
  anthropic: "ANTHROPIC_API_KEY",
  openai: "OPENAI_API_KEY",
  deepseek: "DEEPSEEK_API_KEY",
  google: "GOOGLE_GENERATIVE_AI_API_KEY",
  groq: "GROQ_API_KEY",
  mistral: "MISTRAL_API_KEY",
  xai: "XAI_API_KEY",
};

/** Provider discovery priority order */
const DISCOVERY_ORDER = [
  "gateway",
  "anthropic",
  "openai",
  "deepseek",
  "google",
  "groq",
  "mistral",
  "xai",
] as const;

/**
 * Reverse map: model name → provider name.
 * Built from FRONTIER_MODELS so "deepseek-chat" → "deepseek", etc.
 */
const MODEL_TO_PROVIDER: Record<string, string> = {};
for (const [provider, models] of Object.entries(FRONTIER_MODELS)) {
  for (const model of models) {
    // Strip provider prefix for models like "meta-llama/llama-..."
    const shortName = model.includes("/") ? model.split("/").pop()! : model;
    MODEL_TO_PROVIDER[model] = provider;
    if (shortName !== model) {
      MODEL_TO_PROVIDER[shortName] = provider;
    }
  }
}

/** Result of provider auto-discovery */
export interface DiscoveredProvider {
  /** Provider name (e.g. "anthropic", "deepseek") */
  provider: string;
  /** Model identifier in gateway format (e.g. "anthropic/claude-sonnet-4-5") */
  model: string;
}

/** Options for provider discovery */
export interface DiscoverOptions {
  /** Preferred model — try its provider first */
  preferredModel?: string;
  /** Environment to scan (defaults to process.env). Useful for testing. */
  env?: Record<string, string | undefined>;
}

/**
 * Discover the best available provider by scanning environment variables.
 *
 * Note: This function does NOT read AGENT_MODEL — that's handled by
 * resolveModelFallback() which supports comma-separated fallback chains.
 *
 * @param options.preferredModel - If set, prefer the provider that owns this model.
 *   E.g. "deepseek-chat" → prefer "deepseek" if DEEPSEEK_API_KEY is set.
 * @param options.env - Environment to scan (defaults to process.env).
 * @returns The discovered provider and model, or null if none available.
 */
export function discoverProvider(options?: DiscoverOptions): DiscoveredProvider | null {
  const env = options?.env ?? (process.env as Record<string, string | undefined>);
  const preferredModel = options?.preferredModel;

  // If a preferred model is given, try its provider first
  if (preferredModel && preferredModel !== "auto") {
    const ownerProvider = MODEL_TO_PROVIDER[preferredModel];
    if (ownerProvider) {
      const envKey = PROVIDER_ENV_KEYS[ownerProvider];
      if (envKey && env[envKey]) {
        return {
          provider: ownerProvider,
          model: preferredModel.includes("/") ? preferredModel : `${ownerProvider}/${preferredModel}`,
        };
      }
    }
  }

  // Scan providers in priority order
  for (const provider of DISCOVERY_ORDER) {
    const envKey = PROVIDER_ENV_KEYS[provider]!;
    if (!env[envKey]) continue;

    // Gateway supports all providers — use the preferred model or default
    if (provider === "gateway") {
      if (preferredModel && preferredModel !== "auto") {
        const ownerProvider = MODEL_TO_PROVIDER[preferredModel] || "anthropic";
        return { provider: "gateway", model: `${ownerProvider}/${preferredModel}` };
      }
      // Default: anthropic via gateway
      return { provider: "gateway", model: getDefaultModel() };
    }

    // Direct provider — use frontier model or provider name as fallback
    // (createModel("deepseek") auto-resolves via FRONTIER_MODELS lookup)
    const frontierModels = FRONTIER_MODELS[provider as keyof typeof FRONTIER_MODELS];
    const defaultModel = frontierModels?.[0];

    return {
      provider,
      model: defaultModel ? (defaultModel.includes("/") ? defaultModel : `${provider}/${defaultModel}`) : provider,
    };
  }

  return null;
}

/**
 * Check if a value is the "auto" sentinel.
 */
export function isAutoProvider(value: unknown): boolean {
  return value === "auto";
}

/**
 * Check if a model's provider has a valid API key in the environment.
 */
function isModelAvailable(
  model: string,
  env: Record<string, string | undefined>,
): boolean {
  // "auto" is always "available" — it will be resolved later
  if (model === "auto") return true;

  // Extract provider from model string
  let provider: string | undefined;

  // Check MODEL_TO_PROVIDER (e.g., "deepseek-chat" → "deepseek")
  provider = MODEL_TO_PROVIDER[model];

  // Check provider/model format (e.g., "deepseek/deepseek-chat" → "deepseek")
  if (!provider && model.includes("/")) {
    provider = model.split("/")[0];
  }

  // Check provider:model format (e.g., "deepseek:deepseek-chat" → "deepseek")
  if (!provider && model.includes(":")) {
    provider = model.split(":")[0];
  }

  if (!provider) return false;

  // Gateway supports all providers
  if (env[PROVIDER_ENV_KEYS["gateway"]!]) return true;

  const envKey = PROVIDER_ENV_KEYS[provider];
  return !!envKey && !!env[envKey];
}

/**
 * Resolve a model to a single concrete value, supporting fallback chains.
 *
 * Resolution order:
 *   1. AGENT_DEFAULT_MODELS env var — comma-separated preference list
 *      (e.g. "deepseek-chat, anthropic/claude-sonnet-4-5")
 *   2. Workflow YAML model field (single string, or "auto")
 *   3. Full auto-discovery — scan all provider API keys
 *
 * The preference list does NOT contain "auto" — the env var itself IS
 * the auto configuration. After exhausting the explicit list, the system
 * implicitly falls back to full provider discovery.
 *
 * Example:
 *   AGENT_DEFAULT_MODELS="deepseek-chat, anthropic/claude-sonnet-4-5"
 *   → try deepseek-chat (need DEEPSEEK_API_KEY)
 *   → try claude-sonnet-4-5 (need ANTHROPIC_API_KEY)
 *   → implicit fallback: discover any available provider
 *
 * @returns Resolved { model, provider } — never contains "auto".
 * @throws if nothing is available (no explicit candidate and no provider key).
 */
export function resolveModelFallback(config: {
  model?: string;
  provider?: string;
  /** Environment to scan (defaults to process.env). Useful for testing. */
  env?: Record<string, string | undefined>;
}): { model: string; provider?: string } {
  const env = config.env ?? (process.env as Record<string, string | undefined>);
  const isProviderAuto = config.provider === "auto";

  // AGENT_DEFAULT_MODELS: comma-separated preference list for auto mode
  const autoModel = env.AGENT_DEFAULT_MODELS;

  // If YAML model is not "auto" and no provider auto → pass through directly
  if (!isProviderAuto && config.model && config.model !== "auto" && !autoModel) {
    return { model: config.model, provider: config.provider };
  }

  // Build preference list: env var entries → implicit full discovery
  const preferences = autoModel
    ? autoModel.split(",").map((s) => s.trim()).filter(Boolean)
    : [];

  // Try each preference in order
  for (const candidate of preferences) {
    if (isModelAvailable(candidate, env)) {
      return { model: candidate, provider: isProviderAuto ? undefined : config.provider };
    }
  }

  // Provider auto with specific model: auto-detect which provider owns the model
  if (isProviderAuto && config.model && config.model !== "auto") {
    const model = config.model;
    if (isModelAvailable(model, env)) {
      const ownerProvider = MODEL_TO_PROVIDER[model];
      if (ownerProvider && !model.includes("/") && !model.includes(":")) {
        return { model: `${ownerProvider}/${model}`, provider: undefined };
      }
      return { model, provider: undefined };
    }
  }

  // Implicit fallback: full provider discovery
  const discovered = discoverProvider({ env });
  if (discovered) {
    return { model: discovered.model, provider: undefined };
  }

  // Nothing available
  const envVars = Object.values(PROVIDER_ENV_KEYS).join(", ");
  const hint = preferences.length > 0
    ? `Tried: ${preferences.join(", ")}. `
    : "";
  throw new Error(
    `No provider available for auto model resolution. ${hint}Set one of: ${envVars}`,
  );
}

/**
 * Resolve "auto" provider/model to concrete values.
 * Convenience wrapper around resolveModelFallback for single-model cases.
 *
 * @returns Resolved { model, provider } — never contains "auto".
 * @throws if auto-discovery finds no available provider.
 */
export function resolveAutoModel(config: {
  model?: string;
  provider?: string;
  /** Environment to scan (defaults to process.env). Useful for testing. */
  env?: Record<string, string | undefined>;
}): { model: string; provider?: string } {
  return resolveModelFallback(config);
}
