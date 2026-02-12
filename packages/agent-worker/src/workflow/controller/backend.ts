/**
 * Backend Selection
 * Maps workflow config to Backend instances from backends/
 */

import type { Backend } from "@/backends/types.ts";
import type { StreamParserCallbacks } from "@/backends/stream-json.ts";
import type { ProviderConfig } from "@/workflow/types.ts";
import { parseModel } from "@/backends/model-maps.ts";
import { createBackend } from "@/backends/index.ts";
import { createMockBackend } from "@/backends/mock.ts";

/** Options for creating a workflow backend */
export interface WorkflowBackendOptions {
  model?: string;
  timeout?: number;
  /** Provider configuration for custom endpoints */
  provider?: string | ProviderConfig;
  /** Stream parser callbacks for structured event logging */
  streamCallbacks?: StreamParserCallbacks;
  /** Debug log for mock backend */
  debugLog?: (msg: string) => void;
}

/**
 * Get backend by explicit backend type
 *
 * All backends are created via the canonical createBackend() factory
 * from backends/index.ts. Mock backend is handled specially (no model needed).
 */
export function getBackendByType(
  backendType: "default" | "claude" | "cursor" | "codex" | "opencode" | "mock",
  options?: WorkflowBackendOptions,
): Backend {
  if (backendType === "mock") {
    return createMockBackend(options?.debugLog);
  }

  const backendOptions: Record<string, unknown> = {};
  if (options?.timeout) {
    backendOptions.timeout = options.timeout;
  }
  if (options?.streamCallbacks) {
    backendOptions.streamCallbacks = options.streamCallbacks;
  }

  return createBackend({
    type: backendType,
    model: options?.model,
    ...(backendType === "default" && options?.provider ? { provider: options.provider } : {}),
    ...(Object.keys(backendOptions).length > 0 ? { options: backendOptions } : {}),
  } as Parameters<typeof createBackend>[0]);
}

/**
 * Get appropriate backend for a model identifier
 *
 * Infers backend type from model name and delegates to getBackendByType.
 * Prefer using getBackendByType with explicit backend field in workflow configs.
 */
export function getBackendForModel(model: string, options?: WorkflowBackendOptions): Backend {
  // If provider is set, model is a plain name — use SDK backend with provider config
  if (options?.provider) {
    return getBackendByType("default", { ...options, model });
  }

  const { provider } = parseModel(model);

  switch (provider) {
    case "anthropic":
      return getBackendByType("default", { ...options, model });

    case "claude":
      return getBackendByType("claude", { ...options, model });

    case "codex":
      return getBackendByType("codex", { ...options, model });

    default:
      throw new Error(`Unknown provider: ${provider}. Specify backend explicitly.`);
  }
}
