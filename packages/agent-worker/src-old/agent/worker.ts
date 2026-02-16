import { ToolLoopAgent, stepCountIs, type ModelMessage } from "ai";
import { createModelAsync, createModelWithProvider } from "./models.ts";
import type { ProviderConfig } from "../workflow/types.ts";
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
import type { Backend } from "../backends/types.ts";

/**
 * Extended worker config that supports both SDK and CLI backends.
 * When a backend is provided, send() delegates to it instead of ToolLoopAgent.
 * This enables unified worker management regardless of backend type.
 */
export interface AgentWorkerConfig extends SessionConfig {
  /** CLI backend - when provided, send() delegates to this backend */
  backend?: Backend;
  /** Provider configuration — when set, model is resolved via createModelWithProvider */
  provider?: string | ProviderConfig;
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

/**
 * AgentWorker - Stateful worker for controlled agent execution
 *
 * Uses ToolLoopAgent internally for multi-step reasoning loops.
 * Maintains conversation state across multiple send() calls,
 * enabling improvisational testing where you observe responses
 * and decide next actions.
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

  // CLI backend (null for SDK sessions)
  private backend: Backend | null;
  // Provider config for custom endpoints (SDK only)
  private provider: string | ProviderConfig | undefined;

  // Cached agent instance (rebuilt when tools change) - SDK only
  private cachedAgent: ToolLoopAgent | null = null;
  private toolsChanged = false;

  /**
   * Whether this session supports tool management (SDK backend only)
   */
  get supportsTools(): boolean {
    return this.backend === null;
  }

  /**
   * Convert AgentMessage[] to ModelMessage[] for AI SDK
   */
  private toModelMessages(): ModelMessage[] {
    return this.messages
      .filter((m) => m.status !== "responding") // Exclude incomplete messages
      .map((m) => ({ role: m.role, content: m.content })) as ModelMessage[];
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
    this.maxSteps = config.maxSteps ?? 200; // Default: 200 steps (effectively no limit for most tasks)
    this.backend = config.backend ?? null;
    this.provider = config.provider;
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
   * Build tools with approval wrapping for ToolLoopAgent
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
      // Wrap execute with approval check
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
   * Get or create cached agent, rebuild if tools changed
   */
  private async getAgent(autoApprove: boolean): Promise<ToolLoopAgent> {
    if (!this.cachedAgent || this.toolsChanged || !autoApprove) {
      const model = this.provider
        ? await createModelWithProvider(this.model, this.provider)
        : await createModelAsync(this.model);
      this.cachedAgent = new ToolLoopAgent({
        model,
        instructions: this.system,
        tools: this.buildTools(autoApprove),
        maxOutputTokens: this.maxTokens,
        stopWhen: stepCountIs(this.maxSteps),
      });
      if (autoApprove) {
        this.toolsChanged = false;
      }
    }
    return this.cachedAgent;
  }

  /**
   * Send a message via CLI backend (non-SDK path)
   */
  private async sendViaBackend(content: string): Promise<AgentResponse> {
    const startTime = performance.now();
    const timestamp = new Date().toISOString();

    this.messages.push({ role: "user", content, status: "complete", timestamp });

    const result = await this.backend!.send(content, { system: this.system });
    const latency = Math.round(performance.now() - startTime);

    this.messages.push({
      role: "assistant",
      content: result.content,
      status: "complete",
      timestamp: new Date().toISOString(),
    });

    const usage: TokenUsage = {
      input: result.usage?.input ?? 0,
      output: result.usage?.output ?? 0,
      total: result.usage?.total ?? 0,
    };
    this.totalUsage.input += usage.input;
    this.totalUsage.output += usage.output;
    this.totalUsage.total += usage.total;

    const toolCalls: ToolCall[] = (result.toolCalls ?? []).map((tc) => ({
      name: tc.name,
      arguments: tc.arguments as Record<string, unknown>,
      result: tc.result,
      timing: 0,
    }));

    return {
      content: result.content,
      toolCalls,
      pendingApprovals: [],
      usage,
      latency,
    };
  }

  /**
   * Send a message and get the agent's response
   */
  async send(content: string, options: SendOptions = {}): Promise<AgentResponse> {
    if (this.backend) {
      return this.sendViaBackend(content);
    }

    const { autoApprove = true, onStepFinish } = options;
    const startTime = performance.now();
    const timestamp = new Date().toISOString();

    this.messages.push({ role: "user", content, status: "complete", timestamp });

    const agent = await this.getAgent(autoApprove);

    const allToolCalls: ToolCall[] = [];
    let stepNumber = 0;

    const result = await agent.generate({
      messages: this.toModelMessages(),
      onStepFinish: async ({ usage, toolCalls, toolResults }) => {
        stepNumber++;

        const stepToolCalls: ToolCall[] = [];
        if (toolCalls) {
          for (const tc of toolCalls) {
            const toolResult = toolResults?.find((tr) => tr.toolCallId === tc.toolCallId);
            const toolCall: ToolCall = {
              name: tc.toolName,
              arguments: tc.input as Record<string, unknown>,
              result: toolResult?.output ?? null,
              timing: 0,
            };
            stepToolCalls.push(toolCall);
            allToolCalls.push(toolCall);
          }
        }

        if (onStepFinish) {
          const stepUsage: TokenUsage = {
            input: usage?.inputTokens ?? 0,
            output: usage?.outputTokens ?? 0,
            total: (usage?.inputTokens ?? 0) + (usage?.outputTokens ?? 0),
          };
          await onStepFinish({ stepNumber, toolCalls: stepToolCalls, usage: stepUsage });
        }
      },
    });

    const latency = Math.round(performance.now() - startTime);

    this.messages.push({
      role: "assistant",
      content: result.text,
      status: "complete",
      timestamp: new Date().toISOString(),
    });

    const usage: TokenUsage = {
      input: result.usage?.inputTokens ?? 0,
      output: result.usage?.outputTokens ?? 0,
      total: (result.usage?.inputTokens ?? 0) + (result.usage?.outputTokens ?? 0),
    };
    this.totalUsage.input += usage.input;
    this.totalUsage.output += usage.output;
    this.totalUsage.total += usage.total;

    // Warn if maxSteps limit was reached while agent was still working
    if (this.maxSteps > 0 && stepNumber >= this.maxSteps && allToolCalls.length > 0) {
      console.warn(
        `⚠️  Agent reached maxSteps limit (${this.maxSteps}) but wanted to continue. Consider increasing maxSteps or removing the limit.`,
      );
    }

    const currentPending = this.pendingApprovals.filter((p) => p.status === "pending");

    return {
      content: result.text,
      toolCalls: allToolCalls,
      pendingApprovals: currentPending,
      usage,
      latency,
    };
  }

  /**
   * Send a message and stream the response
   */
  async *sendStream(
    content: string,
    options: SendOptions = {},
  ): AsyncGenerator<string, AgentResponse, unknown> {
    if (this.backend) {
      const response = await this.sendViaBackend(content);
      yield response.content;
      return response;
    }

    const { autoApprove = true, onStepFinish } = options;
    const startTime = performance.now();
    const timestamp = new Date().toISOString();

    this.messages.push({ role: "user", content, status: "complete", timestamp });

    const assistantMsg: AgentMessage = {
      role: "assistant",
      content: "",
      status: "responding",
      timestamp: new Date().toISOString(),
    };
    this.messages.push(assistantMsg);

    const agent = await this.getAgent(autoApprove);

    const allToolCalls: ToolCall[] = [];
    let stepNumber = 0;

    const result = await agent.stream({
      messages: this.toModelMessages(),
      onStepFinish: async ({ usage, toolCalls, toolResults }) => {
        stepNumber++;

        const stepToolCalls: ToolCall[] = [];
        if (toolCalls) {
          for (const tc of toolCalls) {
            const toolResult = toolResults?.find((tr) => tr.toolCallId === tc.toolCallId);
            const toolCall: ToolCall = {
              name: tc.toolName,
              arguments: tc.input as Record<string, unknown>,
              result: toolResult?.output ?? null,
              timing: 0,
            };
            stepToolCalls.push(toolCall);
            allToolCalls.push(toolCall);
          }
        }

        if (onStepFinish) {
          const stepUsage: TokenUsage = {
            input: usage?.inputTokens ?? 0,
            output: usage?.outputTokens ?? 0,
            total: (usage?.inputTokens ?? 0) + (usage?.outputTokens ?? 0),
          };
          await onStepFinish({ stepNumber, toolCalls: stepToolCalls, usage: stepUsage });
        }
      },
    });

    for await (const chunk of result.textStream) {
      assistantMsg.content += chunk;
      yield chunk;
    }

    const latency = Math.round(performance.now() - startTime);

    const text = await result.text;
    assistantMsg.content = text;
    assistantMsg.status = "complete";

    const finalUsage = await result.usage;
    const usage: TokenUsage = {
      input: finalUsage?.inputTokens ?? 0,
      output: finalUsage?.outputTokens ?? 0,
      total: (finalUsage?.inputTokens ?? 0) + (finalUsage?.outputTokens ?? 0),
    };
    this.totalUsage.input += usage.input;
    this.totalUsage.output += usage.output;
    this.totalUsage.total += usage.total;

    const currentPending = this.pendingApprovals.filter((p) => p.status === "pending");

    return {
      content: text,
      toolCalls: allToolCalls,
      pendingApprovals: currentPending,
      usage,
      latency,
    };
  }

  /**
   * Add an AI SDK tool
   * Only supported for SDK backends (ToolLoopAgent)
   */
  addTool(name: string, t: unknown): void {
    if (this.backend) {
      throw new Error("Tool management not supported for CLI backends");
    }
    this.tools[name] = t;
    this.toolsChanged = true;
    this.cachedAgent = null;
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
    if (this.backend) {
      throw new Error("Tool management not supported for CLI backends");
    }
    const t = this.tools[name];
    if (!t) {
      throw new Error(`Tool not found: ${name}`);
    }
    this.tools[name] = { ...t, execute: mockFn };
    this.toolsChanged = true;
    this.cachedAgent = null;
  }

  /**
   * Set a static mock response for an existing tool
   */
  setMockResponse(name: string, response: unknown): void {
    if (this.backend) {
      throw new Error("Tool management not supported for CLI backends");
    }
    const t = this.tools[name];
    if (!t) {
      throw new Error(`Tool not found: ${name}`);
    }
    this.tools[name] = { ...t, execute: () => response };
    this.toolsChanged = true;
    this.cachedAgent = null;
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
