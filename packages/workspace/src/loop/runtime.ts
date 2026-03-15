/**
 * Runtime Selection
 * Maps workflow config to Runtime instances from backends/
 */

import type { Runtime, StreamParserCallbacks, ProviderConfig } from "@moniro/agent-loop";
import { parseModel, createRuntime, createMockRuntime } from "@moniro/agent-loop";

/** Options for creating a workflow runtime */
export interface WorkflowRuntimeOptions {
  model?: string;
  timeout?: number;
  /** Provider configuration for custom endpoints */
  provider?: string | ProviderConfig;
  /** Stream parser callbacks for structured event logging */
  streamCallbacks?: StreamParserCallbacks;
  /** Debug log for mock runtime */
  debugLog?: (msg: string) => void;
  /** Workspace directory for CLI runtime isolation (used as cwd) */
  workspace?: string;
}

/**
 * Get runtime by explicit runtime type
 *
 * All backends are created via the canonical createRuntime() factory
 * from backends/index.ts. Mock runtime is handled specially (no model needed).
 */
export function getRuntimeByType(
  backendType: "default" | "claude" | "cursor" | "codex" | "opencode" | "mock",
  options?: WorkflowRuntimeOptions,
): Runtime {
  if (backendType === "mock") {
    return createMockRuntime(options?.debugLog);
  }

  const runtimeOptions: Record<string, unknown> = {};
  if (options?.timeout) {
    runtimeOptions.timeout = options.timeout;
  }
  if (options?.streamCallbacks) {
    runtimeOptions.streamCallbacks = options.streamCallbacks;
  }
  if (options?.workspace) {
    runtimeOptions.workspace = options.workspace;
  }

  return createRuntime({
    type: backendType,
    model: options?.model,
    ...(backendType === "default" && options?.provider ? { provider: options.provider } : {}),
    ...(Object.keys(runtimeOptions).length > 0 ? { options: runtimeOptions } : {}),
  } as Parameters<typeof createRuntime>[0]);
}

/**
 * Get appropriate runtime for a model identifier
 *
 * Infers runtime type from model name and delegates to getRuntimeByType.
 * Prefer using getRuntimeByType with explicit runtime field in workflow configs.
 */
export function getRuntimeForModel(model: string, options?: WorkflowRuntimeOptions): Runtime {
  // If provider is set, model is a plain name — use SDK runtime with provider config
  if (options?.provider) {
    return getRuntimeByType("default", { ...options, model });
  }

  const { provider } = parseModel(model);

  // CLI backends have their own process — route explicitly
  if (provider === "claude") return getRuntimeByType("claude", { ...options, model });
  if (provider === "codex") return getRuntimeByType("codex", { ...options, model });

  // Everything else (anthropic, openai, deepseek, google, etc.) → SDK runtime
  return getRuntimeByType("default", { ...options, model });
}
