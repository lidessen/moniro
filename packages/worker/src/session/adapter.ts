/**
 * ExecutionAdapter — checkpoint-based execution interface.
 *
 * Delegates to Loop from @moniro/agent-loop for actual
 * execution, mapping checkpoint semantics onto the session's hooks.
 *
 * This is NOT a separate execution implementation — it's a thin
 * adapter that translates the worker's checkpoint vocabulary into
 * Loop's hook system. One execution engine, two APIs.
 */

import {
  createLoop,
  type Runtime,
  type ProviderConfig,
  type TokenUsage,
  type ToolCall,
  type Logger,
  type Loop,
} from "@moniro/agent-loop";
import type {
  ActivationOutcome,
  Checkpoint,
  ExecutionAdapter,
  ExecutionAdapterCapabilities,
  ExecutionAdapterHooks,
} from "./types.ts";

// ── Capability Resolution ──────────────────────────────────────

function resolveAdapterCapabilities(runtime: Runtime): ExecutionAdapterCapabilities {
  const caps = runtime.capabilities;
  return {
    streaming: caps.streaming,
    checkpointGranularity: caps.toolLoop === "external" ? "step" : "run",
    supportsAbort:
      caps.cancellation === "abortable" ||
      caps.cancellation === "cooperative",
  };
}

// ── Adapter Config ─────────────────────────────────────────────

export interface ExecutionAdapterConfig {
  runtime: Runtime;
  /** Model ID — required for SDK/external tool loop runtimes */
  model?: string;
  /** Provider config for model creation */
  provider?: string | ProviderConfig;
  /** Logger */
  log?: Logger;
  /** @internal Model factory for testing */
  _modelFactory?: () => Promise<any> | any;
}

// ── Implementation ─────────────────────────────────────────────

/**
 * Create an ExecutionAdapter that delegates to Loop.
 *
 * Loop (in @moniro/agent-loop) is the single execution engine.
 * This adapter maps the worker's checkpoint semantics onto it.
 */
export function createExecutionAdapter(config: ExecutionAdapterConfig): ExecutionAdapter {
  const runtime = config.runtime;
  const capabilities = resolveAdapterCapabilities(runtime);

  // Shared Loop with model caching
  const session: Loop = createLoop({
    runtime,
    model: config.model,
    provider: config.provider,
    log: config.log,
    _modelFactory: config._modelFactory,
  });

  const adapter: ExecutionAdapter = {
    capabilities,

    async execute(input, hooks) {
      // Run via Loop
      const result = await session.run({
        system: input.system,
        messages: input.messages.map((m) => ({
          role: m.role as "user" | "assistant" | "system" | "tool",
          content: m.content,
        })),
        tools: input.tools,
        config: {
          maxTokens: input.maxTokens,
          maxSteps: input.maxSteps,
        },
      });

      // Map ExecutionResult → ActivationOutcome
      const outcome: ActivationOutcome = {
        content: result.content,
        toolCalls: result.toolCalls,
        usage: result.usage,
        latency: result.latency,
        steps: result.steps,
        result: mapOutcome(result.outcome),
        error: result.error,
      };

      // Post-execution checkpoint (for checkpoint-based decision making)
      if (hooks?.onCheckpoint) {
        const checkpoint: Checkpoint = {
          granularity: capabilities.checkpointGranularity,
          stepNumber: result.steps,
          toolCalls: result.toolCalls,
          usage: result.usage,
          content: result.content,
        };
        await hooks.onCheckpoint(checkpoint);
      }

      // Forward usage and text to hooks
      hooks?.onUsage?.(result.usage);
      if (result.content) {
        hooks?.onText?.(result.content);
      }

      return outcome;
    },

    abort() {
      session.cancel("Aborted by worker");
    },
  };

  return adapter;
}

function mapOutcome(outcome: string): ActivationOutcome["result"] {
  switch (outcome) {
    case "completed": return "completed";
    case "preempted": return "preempted";
    case "cancelled": return "aborted";
    default: return "failed";
  }
}
