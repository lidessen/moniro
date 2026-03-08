import type { ProviderConfig } from "./types.ts";
import type {
  AgentMessage,
  AgentResponse,
  ApprovalCheck,
  PendingApproval,
  SessionConfig,
  SessionState,
  ToolCall,
  ToolInfo,
  TokenUsage,
  Transcript,
} from "./types.ts";
import type { Runtime } from "./runtimes/types.ts";
import type { Logger } from "./logger.ts";
import { createLoop } from "./loop/session.ts";
import type { Loop, AfterStepContext } from "./loop/types.ts";

/**
 * Extended worker config that supports both SDK and CLI runtimes.
 * When a runtime is provided, send() delegates to it instead of ToolLoopAgent.
 * This enables unified worker management regardless of runtime type.
 */
export interface AgentWorkerConfig extends SessionConfig {
  /** CLI runtime - when provided, send() delegates to this runtime */
  runtime?: Runtime;
  /** Provider configuration — when set, model is resolved via createModelWithProvider */
  provider?: string | ProviderConfig;
  /** Optional logger for worker events (maxSteps warnings, errors) */
  log?: Logger;
  /** @internal Model factory for testing — bypasses createModelAsync */
  _modelFactory?: () => Promise<any> | any;
}

/**
 * Step finish callback info
 */
export interface StepInfo {
  stepNumber: number;
  toolCalls: ToolCall[];
  usage: TokenUsage;
}

/**
 * Options for send() method
 */
export interface SendOptions {
  /** Auto-approve all tool calls that require approval (default: true) */
  autoApprove?: boolean;
  /** Callback after each agent step */
  onStepFinish?: (info: StepInfo) => void | Promise<void>;
}

// ── Default backend for SDK path ──────────────────────────────────

/** Minimal in-memory backend for SDK-only AgentWorker (no CLI needed) */
const SDK_RUNTIME: Runtime = {
  type: "default",
  capabilities: {
    streaming: true,
    toolLoop: "external",
    stepControl: "step-finish",
    cancellation: "abortable",
  },
  async send() {
    throw new Error("SDK runtime send() should not be called directly");
  },
};

/**
 * AgentWorker - Stateful worker for controlled agent execution
 *
 * Delegates execution to Loop internally, maintaining
 * conversation state and approval logic on top.
 *
 * Tools are AI SDK tool() objects passed as Record<name, tool()>.
 * Approval is configured separately via Record<name, check>.
 */
export class AgentWorker {
  readonly id: string;
  readonly model: string;
  readonly system: string;
  readonly createdAt: string;

  // Tools: name → AI SDK tool (from tool())
  private tools: Record<string, any>;
  // Approval: name → check
  private approval: Record<string, ApprovalCheck>;

  private maxTokens: number;
  private maxSteps: number;
  private messages: AgentMessage[] = [];
  private totalUsage: TokenUsage = { input: 0, output: 0, total: 0 };
  private pendingApprovals: PendingApproval[] = [];

  // CLI runtime (null for SDK sessions)
  private runtime: Runtime | null;

  // Track tool changes to know when to rebuild session
  private toolsChanged = false;

  // Optional logger for worker events
  private log?: Logger;

  // Config for session creation
  private provider: string | ProviderConfig | undefined;
  private _modelFactory?: () => Promise<any> | any;

  /**
   * Whether this session supports tool management (SDK runtime only)
   */
  get supportsTools(): boolean {
    return this.runtime === null;
  }

  constructor(config: AgentWorkerConfig, restore?: SessionState) {
    // Restore from saved state or create new
    if (restore) {
      this.id = restore.id;
      this.createdAt = restore.createdAt;
      this.messages = [...restore.messages];
      this.totalUsage = { ...restore.totalUsage };
      this.pendingApprovals = [...(restore.pendingApprovals ?? [])];
    } else {
      this.id = crypto.randomUUID();
      this.createdAt = new Date().toISOString();
    }

    this.model = config.model;
    this.system = config.system;
    this.tools = config.tools ? { ...config.tools } : {};
    this.approval = config.approval ? { ...config.approval } : {};
    this.maxTokens = config.maxTokens ?? 4096;
    this.maxSteps = config.maxSteps ?? 200;
    this.runtime = config.runtime ?? null;
    this.provider = config.provider;
    this._modelFactory = config._modelFactory;
    this.log = config.log;
  }

  /**
   * Create an Loop for a single run.
   * Per-call session allows different hooks per send().
   */
  private createSession(hooks?: {
    afterStep?: (ctx: AfterStepContext) => void | Promise<void>;
  }): Loop {
    const runtime = this.runtime ?? SDK_RUNTIME;
    return createLoop({
      runtime,
      model: this.model,
      provider: this.provider,
      log: this.log,
      _modelFactory: this._modelFactory,
      hooks: hooks ? { afterStep: hooks.afterStep } : undefined,
    });
  }

  /**
   * Convert AgentMessage[] to execution messages
   */
  private toExecutionMessages(): Array<{ role: "user" | "assistant" | "system" | "tool"; content: string }> {
    return this.messages
      .filter((m) => m.status !== "responding")
      .map((m) => ({ role: m.role, content: m.content }));
  }

  /**
   * Check if a tool needs approval for given arguments
   */
  private checkApproval(name: string, args: Record<string, unknown>): boolean {
    const check = this.approval[name];
    if (!check) return false;
    if (typeof check === "function") return check(args);
    return check;
  }

  /**
   * Build tools with approval wrapping
   */
  private buildTools(autoApprove: boolean): Record<string, any> | undefined {
    const names = Object.keys(this.tools);
    if (names.length === 0) return undefined;

    // If auto-approve or no approval config, pass tools directly
    if (autoApprove || Object.keys(this.approval).length === 0) {
      return this.tools;
    }

    // Wrap tools that need approval
    const wrapped: Record<string, any> = {};
    for (const [name, t] of Object.entries(this.tools)) {
      if (!this.approval[name]) {
        wrapped[name] = t;
        continue;
      }
      wrapped[name] = {
        ...t,
        execute: async (args: any, options?: any) => {
          if (this.checkApproval(name, args)) {
            const approval: PendingApproval = {
              id: crypto.randomUUID(),
              toolName: name,
              toolCallId: crypto.randomUUID(),
              arguments: args,
              requestedAt: new Date().toISOString(),
              status: "pending",
            };
            this.pendingApprovals.push(approval);
            return { __approvalRequired: true, approvalId: approval.id };
          }
          return t.execute?.(args, options);
        },
      };
    }
    return wrapped;
  }

  /**
   * Send a message and get the agent's response
   */
  async send(content: string, options: SendOptions = {}): Promise<AgentResponse> {
    const { autoApprove = true, onStepFinish } = options;
    const timestamp = new Date().toISOString();

    this.messages.push({ role: "user", content, status: "complete", timestamp });

    const tools = this.buildTools(autoApprove);

    // Create session per-call with hooks wired
    const session = this.createSession(
      onStepFinish
        ? {
            afterStep: async (ctx) => {
              await onStepFinish({
                stepNumber: ctx.stepNumber,
                toolCalls: ctx.toolCalls,
                usage: ctx.usage,
              });
            },
          }
        : undefined,
    );

    const result = await session.run({
      system: this.system,
      messages: this.toExecutionMessages(),
      tools,
      config: {
        maxTokens: this.maxTokens,
        maxSteps: this.maxSteps,
      },
    });

    // Propagate errors as rejections (preserves original behavior)
    if (result.outcome === "failed" && result.error) {
      throw new Error(result.error);
    }

    this.messages.push({
      role: "assistant",
      content: result.content,
      status: "complete",
      timestamp: new Date().toISOString(),
    });

    this.totalUsage.input += result.usage.input;
    this.totalUsage.output += result.usage.output;
    this.totalUsage.total += result.usage.total;

    // Warn if maxSteps limit was reached while agent was still working
    if (this.maxSteps > 0 && result.steps >= this.maxSteps && result.toolCalls.length > 0) {
      this.log?.warn(
        `Agent reached maxSteps limit (${this.maxSteps}) but wanted to continue. Consider increasing maxSteps or removing the limit.`,
      );
    }

    const currentPending = this.pendingApprovals.filter((p) => p.status === "pending");

    return {
      content: result.content,
      toolCalls: result.toolCalls,
      pendingApprovals: currentPending,
      usage: result.usage,
      latency: result.latency,
    };
  }

  /**
   * Send a message and stream the response.
   *
   * Note: streaming delegates to send() internally since Loop
   * handles streaming at the execution level. The full response is yielded
   * as a single chunk. For true streaming, use Loop directly.
   */
  async *sendStream(
    content: string,
    options: SendOptions = {},
  ): AsyncGenerator<string, AgentResponse, unknown> {
    // Delegate to send — Loop handles the execution.
    // Streaming at the AgentWorker level is a convenience API;
    // real streaming happens inside Loop.
    const response = await this.send(content, options);
    yield response.content;
    return response;
  }

  /**
   * Add an AI SDK tool
   * Only supported for SDK runtimes (ToolLoopAgent)
   */
  addTool(name: string, t: unknown): void {
    if (this.runtime) {
      throw new Error("Tool management not supported for CLI runtimes");
    }
    this.tools[name] = t;
    this.toolsChanged = true;
  }

  /**
   * Set approval requirement for a tool
   */
  setApproval(name: string, check: ApprovalCheck): void {
    this.approval[name] = check;
  }

  /**
   * Replace a tool's execute function (for testing)
   */
  mockTool(name: string, mockFn: (args: Record<string, unknown>) => unknown): void {
    if (this.runtime) {
      throw new Error("Tool management not supported for CLI runtimes");
    }
    const t = this.tools[name];
    if (!t) {
      throw new Error(`Tool not found: ${name}`);
    }
    this.tools[name] = { ...t, execute: mockFn };
    this.toolsChanged = true;
  }

  /**
   * Set a static mock response for an existing tool
   */
  setMockResponse(name: string, response: unknown): void {
    if (this.runtime) {
      throw new Error("Tool management not supported for CLI runtimes");
    }
    const t = this.tools[name];
    if (!t) {
      throw new Error(`Tool not found: ${name}`);
    }
    this.tools[name] = { ...t, execute: () => response };
    this.toolsChanged = true;
  }

  /**
   * Get tool info (names, descriptions, approval status)
   */
  getTools(): ToolInfo[] {
    return Object.entries(this.tools).map(([name, t]) => {
      const tool = t as Record<string, unknown> | null | undefined;
      return {
        name,
        description: tool?.description as string | undefined,
        needsApproval: !!this.approval[name],
      };
    });
  }

  history(): AgentMessage[] {
    return [...this.messages];
  }

  stats(): { messageCount: number; usage: TokenUsage } {
    return {
      messageCount: this.messages.length,
      usage: { ...this.totalUsage },
    };
  }

  export(): Transcript {
    return {
      sessionId: this.id,
      model: this.model,
      system: this.system,
      messages: [...this.messages],
      totalUsage: { ...this.totalUsage },
      createdAt: this.createdAt,
    };
  }

  getState(): SessionState {
    return {
      id: this.id,
      createdAt: this.createdAt,
      messages: [...this.messages],
      totalUsage: { ...this.totalUsage },
      pendingApprovals: [...this.pendingApprovals],
    };
  }

  getPendingApprovals(): PendingApproval[] {
    return this.pendingApprovals.filter((p) => p.status === "pending");
  }

  async approve(approvalId: string): Promise<unknown> {
    const approval = this.pendingApprovals.find((p) => p.id === approvalId);
    if (!approval) {
      throw new Error(`Approval not found: ${approvalId}`);
    }
    if (approval.status !== "pending") {
      throw new Error(`Approval already ${approval.status}: ${approvalId}`);
    }

    const t = this.tools[approval.toolName];
    if (!t) {
      throw new Error(`Tool not found: ${approval.toolName}`);
    }

    let result: unknown;
    const tool = t as Record<string, unknown>;
    if (typeof tool.execute === "function") {
      result = await tool.execute(approval.arguments);
    } else {
      result = { error: "No implementation provided" };
    }

    approval.status = "approved";
    return result;
  }

  deny(approvalId: string, reason?: string): void {
    const approval = this.pendingApprovals.find((p) => p.id === approvalId);
    if (!approval) {
      throw new Error(`Approval not found: ${approvalId}`);
    }
    if (approval.status !== "pending") {
      throw new Error(`Approval already ${approval.status}: ${approvalId}`);
    }

    approval.status = "denied";
    approval.denyReason = reason;
  }

  clear(): void {
    this.messages = [];
    this.totalUsage = { input: 0, output: 0, total: 0 };
    this.pendingApprovals = [];
  }
}
