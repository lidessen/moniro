/**
 * ExecutionSession implementation.
 *
 * The core execution runtime. Dispatches to either:
 * - External tool loop (ToolLoopAgent via AI SDK) when backend supports it
 * - Native tool loop (backend.send()) for CLI backends
 *
 * All higher-level semantics (prompt assembly, inbox, workspace) are
 * handled by the caller. This layer only executes.
 */

import { ToolLoopAgent, stepCountIs, type ModelMessage } from "ai";
import { createModelAsync, createModelWithProvider } from "../models.ts";
import type { ProviderConfig, TokenUsage, ToolCall } from "../types.ts";
import type { Backend } from "../backends/types.ts";
import type { StreamEvent } from "../backends/stream-json.ts";
import type { Logger } from "../logger.ts";
import { ExecutionStateMachine } from "./state-machine.ts";
import type {
  BackendCapabilities,
  ExecutionHooks,
  ExecutionInput,
  ExecutionObserver,
  ExecutionResult,
  ExecutionSession,
  ExecutionState,
  StepMutation,
} from "./types.ts";

// ── Capability Resolution ──────────────────────────────────────

/** Default capabilities by backend type */
const DEFAULT_CAPABILITIES: Record<string, BackendCapabilities> = {
  default: {
    streaming: true,
    toolLoop: "external",
    stepControl: "step-finish",
    cancellation: "abortable",
  },
  mock: {
    streaming: false,
    toolLoop: "external",
    stepControl: "step-finish",
    cancellation: "none",
  },
};

const CLI_CAPABILITIES: BackendCapabilities = {
  streaming: true,
  toolLoop: "native",
  stepControl: "none",
  cancellation: "cooperative",
};

/**
 * Resolve backend capabilities.
 * Uses declared capabilities if available, otherwise infers from type.
 */
function resolveCapabilities(backend: Backend): BackendCapabilities {
  if ("capabilities" in backend && backend.capabilities) {
    return backend.capabilities as BackendCapabilities;
  }
  return DEFAULT_CAPABILITIES[backend.type] ?? CLI_CAPABILITIES;
}

// ── Session Config ─────────────────────────────────────────────

export interface ExecutionSessionConfig {
  /** Backend instance */
  backend: Backend;
  /** Execution hooks (mutation — can modify execution) */
  hooks?: ExecutionHooks;
  /**
   * Execution observer (observation — read-only).
   * Receives tool calls, text output, usage updates in real-time.
   * Works across both SDK and CLI paths.
   */
  observer?: ExecutionObserver;
  /** Logger */
  log?: Logger;
  /**
   * Model ID — required when backend.capabilities.toolLoop === 'external'.
   * Ignored for native tool loop backends.
   */
  model?: string;
  /** Provider config for model creation (external tool loop only) */
  provider?: string | ProviderConfig;
  /** @internal Model factory for testing */
  _modelFactory?: () => Promise<any> | any;
}

// ── Preemption Error ───────────────────────────────────────────

class PreemptionSignal extends Error {
  constructor(
    public readonly steps: number,
    public readonly toolCalls: ToolCall[],
    public readonly content: string,
  ) {
    super("Execution preempted");
    this.name = "PreemptionSignal";
  }
}

// ── Implementation ─────────────────────────────────────────────

export class ExecutionSessionImpl implements ExecutionSession {
  readonly id: string;
  readonly capabilities: BackendCapabilities;

  private machine = new ExecutionStateMachine();
  private hooks: ExecutionHooks;
  private observer?: ExecutionObserver;
  private backend: Backend;
  private log?: Logger;

  // External tool loop config
  private model?: string;
  private provider?: string | ProviderConfig;
  private _modelFactory?: () => Promise<any> | any;

  // Cached model instance (avoid recreating per execute)
  private cachedModel: any = null;
  private cachedModelKey: string | null = null;

  // Cancellation
  private abortController: AbortController | null = null;

  constructor(config: ExecutionSessionConfig) {
    this.id = crypto.randomUUID();
    this.backend = config.backend;
    this.capabilities = resolveCapabilities(config.backend);
    this.hooks = config.hooks ?? {};
    this.observer = config.observer;
    this.log = config.log;

    this.model = config.model;
    this.provider = config.provider;
    this._modelFactory = config._modelFactory;

    // Wire state change hook
    if (this.hooks.onStateChange) {
      this.machine.onStateChange(this.hooks.onStateChange);
    }
  }

  getState(): ExecutionState {
    return this.machine.state;
  }

  /**
   * Get or create a cached model instance.
   * Model is cached by (model, provider) key to avoid recreation per execute().
   */
  private async getOrCreateModel(): Promise<any> {
    // Test factories always create fresh (may return different mocks)
    if (this._modelFactory) {
      return this._modelFactory();
    }

    const key = `${this.model}:${typeof this.provider === "string" ? this.provider : JSON.stringify(this.provider ?? "")}`;
    if (this.cachedModel && this.cachedModelKey === key) {
      return this.cachedModel;
    }

    const model = this.provider
      ? await createModelWithProvider(this.model!, this.provider)
      : await createModelAsync(this.model!);

    this.cachedModel = model;
    this.cachedModelKey = key;
    return model;
  }

  async cancel(reason?: string): Promise<void> {
    if (this.machine.isTerminal) return;

    // Abort ongoing execution
    if (this.abortController) {
      this.abortController.abort(reason ?? "Cancelled");
      this.abortController = null;
    }

    // Cooperative cancellation for CLI backends
    if (
      this.capabilities.cancellation === "cooperative" &&
      typeof this.backend.abort === "function"
    ) {
      this.backend.abort();
    }

    this.machine.tryTransition("cancelled");
  }

  async run(input: ExecutionInput): Promise<ExecutionResult> {
    // Allow re-running from terminal or preempted states
    if (this.machine.isTerminal || this.machine.state === "preempted") {
      this.machine.reset();
    }

    // Apply beforeRun hook
    let resolvedInput = input;
    if (this.hooks.beforeRun) {
      const mutated = await this.hooks.beforeRun(input);
      if (mutated && typeof mutated === "object" && "system" in mutated) {
        resolvedInput = mutated as ExecutionInput;
      }
    }

    this.machine.transition("running");

    const startTime = performance.now();

    try {
      let result: ExecutionResult;

      if (this.capabilities.toolLoop === "external") {
        result = await this.runExternal(resolvedInput, startTime);
      } else {
        result = await this.runNative(resolvedInput, startTime);
      }

      // Apply afterRun hook
      if (this.hooks.afterRun) {
        await this.hooks.afterRun(result);
      }

      // Transition to final state based on outcome
      this.machine.transition(result.outcome);
      return result;
    } catch (error) {
      if (error instanceof PreemptionSignal) {
        const result: ExecutionResult = {
          content: error.content,
          toolCalls: error.toolCalls,
          usage: { input: 0, output: 0, total: 0 },
          latency: Math.round(performance.now() - startTime),
          steps: error.steps,
          outcome: "preempted",
          resumeContext: {
            steps: error.steps,
            toolCalls: error.toolCalls,
            content: error.content,
          },
        };

        if (this.hooks.afterRun) {
          await this.hooks.afterRun(result);
        }

        this.machine.transition("preempted");
        return result;
      }

      const errorMessage = error instanceof Error ? error.message : String(error);

      // Check if this was a cancellation
      if (this.machine.state === "cancelled") {
        return {
          content: "",
          toolCalls: [],
          usage: { input: 0, output: 0, total: 0 },
          latency: Math.round(performance.now() - startTime),
          steps: 0,
          outcome: "cancelled",
          error: errorMessage,
        };
      }

      const failResult: ExecutionResult = {
        content: "",
        toolCalls: [],
        usage: { input: 0, output: 0, total: 0 },
        latency: Math.round(performance.now() - startTime),
        steps: 0,
        outcome: "failed",
        error: errorMessage,
      };

      if (this.hooks.afterRun) {
        await this.hooks.afterRun(failResult);
      }

      this.machine.transition("failed");
      return failResult;
    }
  }

  // ── External Tool Loop (SDK path) ────────────────────────────

  private async runExternal(input: ExecutionInput, startTime: number): Promise<ExecutionResult> {
    const config = input.config ?? {};

    if (!this.model && !this._modelFactory) {
      throw new Error(
        "Model is required for external tool loop. " +
          "Set model in ExecutionSessionConfig or use a native tool loop backend.",
      );
    }

    // Create or reuse cached model
    const model = await this.getOrCreateModel();

    // Track execution
    const allToolCalls: ToolCall[] = [];
    let stepNumber = 0;

    // Build ToolLoopAgent with prepareStep hook wired at construction time
    const agent = new ToolLoopAgent({
      model,
      instructions: input.system,
      tools: input.tools as Record<string, any> | undefined,
      maxOutputTokens: config.maxTokens ?? 4096,
      stopWhen: stepCountIs(config.maxSteps ?? 200),

      // beforeStep → AI SDK's prepareStep (constructor-level)
      prepareStep: this.hooks.beforeStep
        ? async () => {
            stepNumber++;
            const mutation = await this.hooks.beforeStep!({ stepNumber });
            if (mutation && typeof mutation === "object") {
              const m = mutation as StepMutation;
              return {
                ...(m.activeTools ? { activeTools: m.activeTools } : {}),
                ...(m.system ? { instructions: m.system } : {}),
              };
            }
            return {};
          }
        : undefined,
    });

    // Set up abort
    this.abortController = new AbortController();
    const signal = config.abortSignal
      ? mergeAbortSignals(config.abortSignal, this.abortController.signal)
      : this.abortController.signal;

    // Convert messages
    const messages: ModelMessage[] = input.messages.map((m) => ({
      role: m.role,
      content: m.content,
    })) as ModelMessage[];

    // Track per-tool timing for observer
    const toolTimings = new Map<string, number>();

    // Run with hooks + observer
    const result = await agent.generate({
      messages,
      abortSignal: signal,

      // Observer: tool call start
      experimental_onToolCallStart: this.observer?.onToolCallStart
        ? ({ toolCall }: any) => {
            toolTimings.set(toolCall.callId, performance.now());
            this.observer!.onToolCallStart!({
              name: toolCall.name,
              callId: toolCall.callId,
              arguments: toolCall.input,
            });
          }
        : undefined,

      // Observer: tool call end
      experimental_onToolCallFinish: this.observer?.onToolCallEnd
        ? ({ toolCall, durationMs, success, output, error }: any) => {
            this.observer!.onToolCallEnd!({
              name: toolCall.name,
              result: success ? output : undefined,
              durationMs,
              error: success ? undefined : String(error),
            });
          }
        : undefined,

      // afterStep → AI SDK's onStepFinish
      onStepFinish: async ({ usage, toolCalls, toolResults }) => {
        if (!this.hooks.beforeStep) {
          stepNumber++;
        }

        const stepToolCalls: ToolCall[] = [];
        if (toolCalls) {
          for (const tc of toolCalls) {
            const toolResult = toolResults?.find(
              (tr: any) => tr.toolCallId === tc.toolCallId,
            );
            const startTime = toolTimings.get(tc.toolCallId);
            const toolCall: ToolCall = {
              name: tc.toolName,
              arguments: tc.input as Record<string, unknown>,
              result: toolResult?.output ?? null,
              timing: startTime ? Math.round(performance.now() - startTime) : 0,
            };
            stepToolCalls.push(toolCall);
            allToolCalls.push(toolCall);
          }
        }

        const stepUsage: TokenUsage = {
          input: usage?.inputTokens ?? 0,
          output: usage?.outputTokens ?? 0,
          total: (usage?.inputTokens ?? 0) + (usage?.outputTokens ?? 0),
        };

        // Observer: usage update
        this.observer?.onUsage?.(stepUsage);

        // afterStep hook
        if (this.hooks.afterStep) {
          await this.hooks.afterStep({
            stepNumber,
            toolCalls: stepToolCalls,
            usage: stepUsage,
          });
        }

        // Check preemption trigger at step boundary (the decision point)
        if (config.shouldYield?.()) {
          throw new PreemptionSignal(stepNumber, allToolCalls, "");
        }
      },
    });

    // Observer: text output
    if (result.text) {
      this.observer?.onText?.(result.text);
    }

    this.abortController = null;

    const latency = Math.round(performance.now() - startTime);
    const usage: TokenUsage = {
      input: result.usage?.inputTokens ?? 0,
      output: result.usage?.outputTokens ?? 0,
      total: (result.usage?.inputTokens ?? 0) + (result.usage?.outputTokens ?? 0),
    };

    // Warn if maxSteps limit reached
    const maxSteps = config.maxSteps ?? 200;
    if (maxSteps > 0 && stepNumber >= maxSteps && allToolCalls.length > 0) {
      this.log?.warn(
        `Execution reached maxSteps limit (${maxSteps}) but wanted to continue.`,
      );
    }

    return {
      content: result.text,
      toolCalls: allToolCalls,
      usage,
      latency,
      steps: stepNumber,
      outcome: "completed",
    };
  }

  // ── Native Tool Loop (CLI backend path) ──────────────────────

  private async runNative(input: ExecutionInput, startTime: number): Promise<ExecutionResult> {
    // For native backends, we compose system + messages into a single send
    // The last user message is the prompt; system is passed separately
    const lastUserMessage = [...input.messages].reverse().find((m) => m.role === "user");
    const prompt = lastUserMessage?.content ?? "";

    // Wire observer through stream event parsing
    const onEvent = this.observer ? this.createStreamEventHandler() : undefined;

    const response = await this.backend.send(prompt, {
      system: input.system,
      onEvent,
    });

    const latency = Math.round(performance.now() - startTime);
    const usage: TokenUsage = {
      input: response.usage?.input ?? 0,
      output: response.usage?.output ?? 0,
      total: response.usage?.total ?? 0,
    };
    const toolCalls: ToolCall[] = (response.toolCalls ?? []).map((tc) => ({
      name: tc.name,
      arguments: tc.arguments as Record<string, unknown>,
      result: tc.result,
      timing: 0,
    }));

    // Observer: final usage from response (some backends only report at end)
    if (usage.total > 0) {
      this.observer?.onUsage?.(usage);
    }

    // Observer: text output
    if (response.content) {
      this.observer?.onText?.(response.content);
    }

    return {
      content: response.content,
      toolCalls,
      usage,
      latency,
      steps: toolCalls.length > 0 ? 1 : 0,
      outcome: "completed",
    };
  }

  /**
   * Create a StreamEvent handler that maps CLI stream events to observer calls.
   */
  private createStreamEventHandler(): (event: StreamEvent) => void {
    const obs = this.observer!;
    return (event: StreamEvent) => {
      switch (event.kind) {
        case "init":
          obs.onInit?.({ model: event.model, sessionId: event.sessionId });
          break;

        case "tool_call_started":
          obs.onToolCallStart?.({ name: event.name, callId: event.callId });
          break;

        case "tool_call":
          // CLI backends report tool call as a single event (start + args)
          obs.onToolCallStart?.({ name: event.name, arguments: event.args });
          break;

        case "completed":
          if (event.usage) {
            obs.onUsage?.({
              input: event.usage.input,
              output: event.usage.output,
              total: event.usage.input + event.usage.output,
            });
          }
          break;

        case "assistant_message":
          obs.onText?.(event.text);
          break;

        // user_message, skip, unknown → not forwarded to observer
      }
    };
  }
}

// ── Factory ────────────────────────────────────────────────────

/**
 * Create an ExecutionSession.
 */
export function createExecutionSession(config: ExecutionSessionConfig): ExecutionSession {
  return new ExecutionSessionImpl(config);
}

// ── Utilities ──────────────────────────────────────────────────

/**
 * Merge two AbortSignals — aborts when either fires.
 */
function mergeAbortSignals(a: AbortSignal, b: AbortSignal): AbortSignal {
  if (a.aborted) return a;
  if (b.aborted) return b;

  const controller = new AbortController();
  const onAbort = () => controller.abort();
  a.addEventListener("abort", onAbort, { once: true });
  b.addEventListener("abort", onAbort, { once: true });
  return controller.signal;
}
