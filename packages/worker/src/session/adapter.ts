/**
 * ExecutionAdapter — checkpoint-based execution interface.
 *
 * Directly implements execution against backends, using checkpoint
 * semantics instead of step semantics.
 *
 * Two paths:
 * - SDK path: ToolLoopAgent with per-step checkpoints
 * - CLI path: backend.send() with per-run checkpoint
 *
 * This is NOT a wrapper around ExecutionSession. It's a parallel
 * implementation optimized for worker-level concerns:
 * - No state machine (worker owns state via AgentSession)
 * - Hooks per-call (different activations may need different hooks)
 * - Checkpoint abstraction (worker doesn't care about step vs run)
 */

import {
  ToolLoopAgent,
  stepCountIs,
  type ModelMessage,
  createModelAsync,
  createModelWithProvider,
  type Backend,
  type ProviderConfig,
  type TokenUsage,
  type ToolCall,
  type Logger,
  type StreamEvent,
} from "@moniro/agent-loop";
import type {
  ActivationOutcome,
  Checkpoint,
  ExecutionAdapter,
  ExecutionAdapterCapabilities,
  ExecutionAdapterHooks,
} from "./types.ts";

// ── Preemption Signal ──────────────────────────────────────────

class YieldSignal extends Error {
  constructor(
    public readonly steps: number,
    public readonly toolCalls: ToolCall[],
    public readonly content: string,
    public readonly usage: TokenUsage,
  ) {
    super("Execution yielded at checkpoint");
    this.name = "YieldSignal";
  }
}

// ── Capability Resolution ──────────────────────────────────────

function resolveAdapterCapabilities(backend: Backend): ExecutionAdapterCapabilities {
  const caps = backend.capabilities;
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
  backend: Backend;
  /** Model ID — required for SDK/external tool loop backends */
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
 * Create an ExecutionAdapter from a backend.
 */
export function createExecutionAdapter(config: ExecutionAdapterConfig): ExecutionAdapter {
  const backend = config.backend;
  const capabilities = resolveAdapterCapabilities(backend);

  let abortController: AbortController | null = null;

  const adapter: ExecutionAdapter = {
    capabilities,

    async execute(input, hooks) {
      const startTime = performance.now();

      try {
        if (capabilities.checkpointGranularity === "step") {
          return await executeWithStepCheckpoints(
            input, hooks, config, startTime,
            (ac) => { abortController = ac; },
          );
        } else {
          return await executeWithRunCheckpoint(
            input, hooks, backend, startTime,
          );
        }
      } catch (error) {
        if (error instanceof YieldSignal) {
          return {
            content: error.content,
            toolCalls: error.toolCalls,
            usage: error.usage,
            latency: Math.round(performance.now() - startTime),
            steps: error.steps,
            result: "preempted",
          };
        }
        return {
          content: "",
          toolCalls: [],
          usage: { input: 0, output: 0, total: 0 },
          latency: Math.round(performance.now() - startTime),
          steps: 0,
          result: "failed",
          error: error instanceof Error ? error.message : String(error),
        };
      } finally {
        abortController = null;
      }
    },

    abort() {
      if (abortController) {
        abortController.abort("Aborted by worker");
        abortController = null;
      }
      if (
        capabilities.supportsAbort &&
        typeof backend.abort === "function"
      ) {
        backend.abort();
      }
    },
  };

  return adapter;
}

// ── SDK Path: Step-Level Checkpoints ───────────────────────────

async function executeWithStepCheckpoints(
  input: {
    system: string;
    messages: Array<{ role: string; content: string }>;
    tools?: Record<string, unknown>;
    maxTokens?: number;
    maxSteps?: number;
  },
  hooks: ExecutionAdapterHooks | undefined,
  config: ExecutionAdapterConfig,
  startTime: number,
  setAbort: (ac: AbortController | null) => void,
): Promise<ActivationOutcome> {
  const model = config._modelFactory
    ? await config._modelFactory()
    : config.provider
      ? await createModelWithProvider(config.model!, config.provider)
      : await createModelAsync(config.model!);

  const allToolCalls: ToolCall[] = [];
  let stepNumber = 0;
  let totalUsage: TokenUsage = { input: 0, output: 0, total: 0 };
  let accumulatedContent = "";

  const agent = new ToolLoopAgent({
    model,
    instructions: input.system,
    tools: input.tools as Record<string, any> | undefined,
    maxOutputTokens: input.maxTokens ?? 4096,
    stopWhen: stepCountIs(input.maxSteps ?? 200),
  });

  const ac = new AbortController();
  setAbort(ac);

  const messages: ModelMessage[] = input.messages.map((m) => ({
    role: m.role,
    content: m.content,
  })) as ModelMessage[];

  const result = await agent.generate({
    messages,
    abortSignal: ac.signal,

    // Per-tool observation
    experimental_onToolCallStart: hooks?.onToolCall
      ? ({ toolCall }: any) => {
          hooks.onToolCall!({ name: toolCall.name, arguments: toolCall.input });
        }
      : undefined,

    experimental_onToolCallFinish: hooks?.onToolResult
      ? ({ toolCall, durationMs, success, output }: any) => {
          hooks.onToolResult!({
            name: toolCall.name,
            result: success ? output : undefined,
            durationMs,
          });
        }
      : undefined,

    // Step-level checkpoint
    onStepFinish: async ({ text, usage, toolCalls, toolResults }: { text?: string; usage?: any; toolCalls?: any[]; toolResults?: any[] }) => {
      stepNumber++;

      // Accumulate text content across steps
      if (text) {
        accumulatedContent += text;
      }

      const stepToolCalls: ToolCall[] = [];
      if (toolCalls) {
        for (const tc of toolCalls) {
          const toolResult = toolResults?.find(
            (tr: any) => tr.toolCallId === tc.toolCallId,
          );
          stepToolCalls.push({
            name: tc.toolName,
            arguments: tc.input as Record<string, unknown>,
            result: toolResult?.output ?? null,
            timing: 0,
          });
        }
        allToolCalls.push(...stepToolCalls);
      }

      const stepUsage: TokenUsage = {
        input: usage?.inputTokens ?? 0,
        output: usage?.outputTokens ?? 0,
        total: (usage?.inputTokens ?? 0) + (usage?.outputTokens ?? 0),
      };
      totalUsage.input += stepUsage.input;
      totalUsage.output += stepUsage.output;
      totalUsage.total += stepUsage.total;

      hooks?.onUsage?.(stepUsage);

      // Checkpoint decision
      if (hooks?.onCheckpoint) {
        const checkpoint: Checkpoint = {
          granularity: "step",
          stepNumber,
          toolCalls: allToolCalls,
          usage: totalUsage,
          content: accumulatedContent,
        };
        const decision = await hooks.onCheckpoint(checkpoint);
        if (decision === "yield") {
          // Carry accumulated progress into the YieldSignal
          throw new YieldSignal(
            stepNumber,
            allToolCalls,
            accumulatedContent,
            { ...totalUsage },
          );
        }
        if (decision === "abort") {
          ac.abort("Aborted at checkpoint");
          return;
        }
      }
    },
  });

  setAbort(null);

  const latency = Math.round(performance.now() - startTime);
  const finalUsage: TokenUsage = {
    input: result.usage?.inputTokens ?? 0,
    output: result.usage?.outputTokens ?? 0,
    total: (result.usage?.inputTokens ?? 0) + (result.usage?.outputTokens ?? 0),
  };

  hooks?.onText?.(result.text);

  // Warn if maxSteps limit reached
  const maxSteps = input.maxSteps ?? 200;
  if (maxSteps > 0 && stepNumber >= maxSteps && allToolCalls.length > 0) {
    config.log?.warn(
      `Execution reached maxSteps limit (${maxSteps}) but wanted to continue.`,
    );
  }

  return {
    content: result.text,
    toolCalls: allToolCalls,
    usage: finalUsage,
    latency,
    steps: stepNumber,
    result: "completed",
  };
}

// ── CLI Path: Run-Level Checkpoint ─────────────────────────────

async function executeWithRunCheckpoint(
  input: {
    system: string;
    messages: Array<{ role: string; content: string }>;
    tools?: Record<string, unknown>;
    maxTokens?: number;
    maxSteps?: number;
  },
  hooks: ExecutionAdapterHooks | undefined,
  backend: Backend,
  startTime: number,
): Promise<ActivationOutcome> {
  // Extract last user message as prompt
  const lastUserMessage = [...input.messages].reverse().find((m) => m.role === "user");
  const prompt = lastUserMessage?.content ?? "";

  // Wire stream events to hooks
  const onEvent = hooks ? createStreamEventRouter(hooks) : undefined;

  const response = await backend.send(prompt, {
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

  // Run-level checkpoint (the only checkpoint CLI backends offer)
  if (hooks?.onCheckpoint) {
    const checkpoint: Checkpoint = {
      granularity: "run",
      stepNumber: 1,
      toolCalls,
      usage,
      content: response.content,
    };
    // Decision is informational at run finish — can't preempt a completed run
    // but the worker can use this to decide what to do next
    await hooks.onCheckpoint(checkpoint);
  }

  hooks?.onUsage?.(usage);
  if (response.content) {
    hooks?.onText?.(response.content);
  }

  return {
    content: response.content,
    toolCalls,
    usage,
    latency,
    steps: toolCalls.length > 0 ? 1 : 0,
    result: "completed",
  };
}

// ── Stream Event Router ────────────────────────────────────────

/**
 * Maps CLI stream events to adapter hooks.
 */
function createStreamEventRouter(
  hooks: ExecutionAdapterHooks,
): (event: StreamEvent) => void {
  return (event: StreamEvent) => {
    switch (event.kind) {
      case "tool_call_started":
        hooks.onToolCall?.({ name: event.name });
        break;

      case "tool_call":
        hooks.onToolCall?.({ name: event.name, arguments: event.args });
        break;

      case "completed":
        if (event.usage) {
          hooks.onUsage?.({
            input: event.usage.input,
            output: event.usage.output,
            total: event.usage.input + event.usage.output,
          });
        }
        break;

      case "assistant_message":
        hooks.onText?.(event.text);
        break;
    }
  };
}
