/**
 * AgentSession — the worker-level session model.
 *
 * Owns the session state, activation lifecycle, feature resolution,
 * and the main activation loop.
 *
 * The session is the long-lived object. Activations are individual
 * processing cycles within it.
 *
 * Key principle: the session's correctness does NOT depend on step
 * hooks. Step hooks only make it more responsive. CLI backends that
 * only checkpoint at run finish work correctly, just with coarser
 * interaction latency.
 */

import { ThinThread, DEFAULT_THIN_THREAD_SIZE } from "../conversation.ts";
import type { ConversationMessage } from "../conversation.ts";
import type { PersonalContext } from "../context/types.ts";
import type {
  AgentFeature,
  ActivationContext,
  CheckpointContext,
  FeatureContext,
  PromptSection,
} from "./feature.ts";
import type {
  ActivationOutcome,
  ActivationProgress,
  ActivationSnapshot,
  ActivationSummary,
  AgentSessionState,
  BatchPolicy,
  CheckpointDecision,
  ExecutionAdapter,
  ExecutionAdapterHooks,
  InputEnvelope,
  RuntimeSignal,
} from "./types.ts";

// ── Session Config ─────────────────────────────────────────────

export interface AgentSessionConfig {
  /** Agent name — stable identity across sessions */
  name: string;
  /** Session ID (generated if not provided) */
  sessionId?: string;
  /** Base system prompt — the agent's core instructions */
  systemPrompt?: string;
  /** Execution adapter */
  adapter: ExecutionAdapter;
  /** Composable features */
  features: AgentFeature[];
  /** Initial personal context */
  personalContext?: PersonalContext;
  /** Initial thin thread messages (e.g., loaded from a ConversationLog) */
  thinThread?: ConversationMessage[];
  /** Max messages in thin thread (default: 10) */
  thinThreadCapacity?: number;
  /** Batch policy for input processing */
  batchPolicy?: BatchPolicy;
  /** Max output tokens per activation (default: 4096) */
  maxTokens?: number;
  /** Max steps per activation (default: 200) */
  maxSteps?: number;
}

// ── Implementation ─────────────────────────────────────────────

const DEFAULT_BATCH_POLICY: BatchPolicy = {
  maxMessages: 5,
};

export class AgentSession {
  readonly id: string;
  readonly name: string;

  private adapter: ExecutionAdapter;
  private features: AgentFeature[];
  private batchPolicy: BatchPolicy;
  private systemPrompt: string;
  private maxTokens?: number;
  private maxSteps?: number;
  private state: AgentSessionState;
  private thread: ThinThread;

  constructor(config: AgentSessionConfig) {
    this.id = config.sessionId ?? crypto.randomUUID();
    this.name = config.name;
    this.adapter = config.adapter;
    this.features = config.features;
    this.batchPolicy = config.batchPolicy ?? DEFAULT_BATCH_POLICY;
    this.systemPrompt = config.systemPrompt ?? "";
    this.maxTokens = config.maxTokens;
    this.maxSteps = config.maxSteps;

    // Initialize thin thread with bounded capacity
    this.thread = new ThinThread(config.thinThreadCapacity ?? DEFAULT_THIN_THREAD_SIZE);
    if (config.thinThread) {
      for (const msg of config.thinThread) {
        this.thread.push(msg);
      }
    }

    this.state = {
      mode: "idle",
      pendingInputs: [],
      pendingSignals: [],
      personalContext: config.personalContext ?? {},
      thinThread: this.thread.getMessages(),
    };
  }

  // ── State Access ─────────────────────────────────────────────

  get mode(): AgentSessionState["mode"] {
    return this.state.mode;
  }

  get hasPendingWork(): boolean {
    return this.state.pendingInputs.length > 0 || this.state.pendingSignals.length > 0;
  }

  get lastActivation(): ActivationSummary | undefined {
    return this.state.lastActivation;
  }

  getState(): Readonly<AgentSessionState> {
    return this.state;
  }

  // ── Input & Signal Ingestion ─────────────────────────────────

  /**
   * Enqueue an input for processing.
   */
  enqueue(input: InputEnvelope): void {
    this.state.pendingInputs.push(input);
  }

  /**
   * Send a runtime signal.
   * If the session is waiting, transitions to idle for re-activation.
   */
  signal(sig: RuntimeSignal): void {
    this.state.pendingSignals.push(sig);

    // Notify features
    for (const feature of this.features) {
      feature.onExternalEvent?.(sig);
    }

    // Wake from waiting
    if (this.state.mode === "waiting" && (sig.type === "new-input" || sig.type === "wake")) {
      this.state.mode = "idle";
      this.state.waiting = undefined;
    }

    // Abort if supported and urgent
    if (this.state.mode === "running" && sig.urgent && this.adapter.capabilities.supportsAbort) {
      this.adapter.abort?.();
    }
  }

  /**
   * Update personal context (e.g., after loading from storage).
   */
  updatePersonalContext(ctx: PersonalContext): void {
    this.state.personalContext = ctx;
  }

  /**
   * Update the base system prompt (e.g., per-activation prompt assembly).
   */
  updateSystemPrompt(prompt: string): void {
    this.systemPrompt = prompt;
  }

  // ── Activation ───────────────────────────────────────────────

  /**
   * Run one activation cycle.
   *
   * Dequeues a batch of inputs, resolves features, executes via
   * the adapter, and applies the outcome to session state.
   *
   * Returns the outcome, or null if there's nothing to do.
   */
  async activate(): Promise<ActivationOutcome | null> {
    if (this.state.pendingInputs.length === 0 && this.state.pendingSignals.length === 0) {
      return null;
    }

    // 1. Dequeue input batch
    const batch = this.dequeueInputBatch();
    if (batch.length === 0 && this.state.pendingSignals.length === 0) {
      return null;
    }

    // 2. Build immutable snapshot
    const snapshot: ActivationSnapshot = {
      sessionId: this.id,
      inputBatch: batch,
      runtimeSignals: [...this.state.pendingSignals],
      personalContext: { ...this.state.personalContext },
      thinThread: [...this.state.thinThread],
    };

    // Clear consumed signals
    this.state.pendingSignals = [];

    // 3. beforeActivation hooks (features may do async setup, e.g. MCP connection)
    const activationCtx: ActivationContext = { snapshot };
    for (const feature of this.features) {
      await feature.beforeActivation?.(activationCtx);
    }

    // 4. Resolve features (after setup, so features can contribute tools/sections)
    const featureCtx: FeatureContext = {
      name: this.name,
      personalContext: snapshot.personalContext,
      thinThread: snapshot.thinThread,
    };
    const promptSections = this.collectPromptSections(featureCtx);
    const tools = this.collectTools(featureCtx);

    // 5. Build execution input
    const system = this.buildSystemPrompt(promptSections);
    const messages = this.buildMessages(snapshot);

    // 6. Transition to running
    this.state.mode = "running";
    const startedAt = new Date().toISOString();

    // 7. Execute with checkpoint hooks
    const hooks: ExecutionAdapterHooks = {
      onCheckpoint: async (checkpoint) => {
        return this.resolveCheckpointDecision({
          checkpoint,
          pendingSignals: this.state.pendingSignals,
        });
      },
    };

    const outcome = await this.adapter.execute(
      {
        system,
        messages,
        tools: Object.keys(tools).length > 0 ? tools : undefined,
        maxTokens: this.maxTokens,
        maxSteps: this.maxSteps,
      },
      hooks,
    );

    // 8. afterActivation hooks
    const afterCtx: ActivationContext = { snapshot, outcome };
    for (const feature of this.features) {
      await feature.afterActivation?.(afterCtx);
    }

    // 9. Apply outcome to session state
    this.applyOutcome(outcome, batch, startedAt);

    return outcome;
  }

  // ── Internal: Batch Dequeue ──────────────────────────────────

  private dequeueInputBatch(): InputEnvelope[] {
    const { maxMessages, includeUrgentOnly } = this.batchPolicy;

    // Sort by priority: immediate > normal > background
    const priorityOrder = { immediate: 0, normal: 1, background: 2 };
    const sorted = [...this.state.pendingInputs].sort(
      (a, b) => priorityOrder[a.priority] - priorityOrder[b.priority],
    );

    const batch: InputEnvelope[] = [];
    const remaining: InputEnvelope[] = [];

    for (const input of sorted) {
      if (batch.length >= maxMessages) {
        remaining.push(input);
      } else if (includeUrgentOnly && input.priority !== "immediate") {
        remaining.push(input);
      } else {
        batch.push(input);
      }
    }

    this.state.pendingInputs = remaining;
    return batch;
  }

  // ── Internal: Feature Resolution ─────────────────────────────

  private collectPromptSections(ctx: FeatureContext): PromptSection[] {
    const sections: PromptSection[] = [];
    for (const feature of this.features) {
      const featureSections = feature.collectPromptSections?.(ctx);
      if (featureSections) {
        sections.push(...featureSections);
      }
    }
    return sections;
  }

  private collectTools(ctx: FeatureContext): Record<string, unknown> {
    const tools: Record<string, unknown> = {};
    for (const feature of this.features) {
      const featureTools = feature.collectTools?.(ctx);
      if (featureTools) {
        Object.assign(tools, featureTools);
      }
    }
    return tools;
  }

  // ── Internal: System Prompt ──────────────────────────────────

  /**
   * Assemble the system prompt from base prompt + feature sections.
   *
   * Base system prompt comes first (agent's core identity/instructions),
   * then feature-contributed sections are appended.
   */
  private buildSystemPrompt(featureSections: PromptSection[]): string {
    const parts: string[] = [];

    if (this.systemPrompt) {
      parts.push(this.systemPrompt);
    }

    for (const section of featureSections) {
      parts.push(section.content);
    }

    return parts.join("\n\n");
  }

  // ── Internal: Message Building ───────────────────────────────

  /**
   * Build messages for the execution adapter.
   *
   * thinThread goes as message history (proper role-based messages).
   * Current input batch appended as user message(s).
   *
   * Conversation continuity lives here — features should NOT
   * duplicate thinThread as a prompt section.
   */
  private buildMessages(
    snapshot: ActivationSnapshot,
  ): Array<{ role: string; content: string }> {
    const messages: Array<{ role: string; content: string }> = [];

    // Thin thread for conversation continuity
    for (const msg of snapshot.thinThread) {
      messages.push({ role: msg.role, content: msg.content });
    }

    // Current input batch as user message(s)
    if (snapshot.inputBatch.length === 1) {
      messages.push({ role: "user", content: snapshot.inputBatch[0]!.content });
    } else if (snapshot.inputBatch.length > 1) {
      const combined = snapshot.inputBatch
        .map((input) => {
          const prefix = input.source ? `[${input.source}] ` : "";
          return `${prefix}${input.content}`;
        })
        .join("\n\n---\n\n");
      messages.push({ role: "user", content: combined });
    }

    return messages;
  }

  // ── Internal: Checkpoint Decision ────────────────────────────

  private resolveCheckpointDecision(ctx: CheckpointContext): CheckpointDecision {
    // Collect decisions from features
    for (const feature of this.features) {
      const decision = feature.beforeCheckpoint?.(ctx);
      if (decision === "yield" || decision === "abort") {
        return decision;
      }
    }

    // Check for urgent pending signals
    const hasUrgent = ctx.pendingSignals.some((s) => s.urgent);
    if (hasUrgent) {
      return "yield";
    }

    return "continue";
  }

  // ── Internal: Apply Outcome ──────────────────────────────────

  private applyOutcome(
    outcome: ActivationOutcome,
    batch: InputEnvelope[],
    startedAt: string,
  ): void {
    // Record activation summary
    this.state.lastActivation = {
      id: crypto.randomUUID(),
      startedAt,
      endedAt: new Date().toISOString(),
      inputCount: batch.length,
      outcome: outcome.requestedWait
        ? "waiting"
        : (outcome.result === "completed"
            ? "completed"
            : outcome.result === "preempted"
              ? "preempted"
              : "failed"),
      steps: outcome.steps,
      toolCalls: outcome.toolCalls.length,
      usage: outcome.usage,
    };

    // Record conversation to thinThread (built-in, always active)
    this.recordConversation(batch, outcome);

    // Update session mode
    if (outcome.requestedWait) {
      this.state.mode = "waiting";
      this.state.waiting = {
        since: new Date().toISOString(),
        reason: "Agent requested wait",
      };
    } else if (outcome.result === "preempted") {
      // Build progress from the preempted activation
      const existingProgress = batch.find((b) => b.progress)?.progress;
      const progress: ActivationProgress = {
        completedSteps: outcome.steps + (existingProgress?.completedSteps ?? 0),
        completedToolCalls: [
          ...(existingProgress?.completedToolCalls ?? []),
          ...outcome.toolCalls,
        ],
        completedContent: [
          existingProgress?.completedContent,
          outcome.content,
        ].filter(Boolean).join("\n"),
        completedUsage: {
          input: outcome.usage.input + (existingProgress?.completedUsage.input ?? 0),
          output: outcome.usage.output + (existingProgress?.completedUsage.output ?? 0),
          total: outcome.usage.total + (existingProgress?.completedUsage.total ?? 0),
        },
        preemptCount: (existingProgress?.preemptCount ?? 0) + 1,
        originalInputIds: existingProgress?.originalInputIds ?? batch.map((b) => b.id),
      };

      // Re-queue with full progress context
      this.state.pendingInputs.unshift({
        id: `resume_${Date.now().toString(36)}`,
        kind: "resume",
        priority: "immediate",
        content: this.buildResumeContent(progress),
        timestamp: new Date().toISOString(),
        progress,
      });
      this.state.mode = "idle";
    } else {
      this.state.mode = "idle";
    }
  }

  // ── Internal: Resume Content ──────────────────────────────────

  /**
   * Build resume content from progress so the next activation
   * knows what was already accomplished.
   */
  private buildResumeContent(progress: ActivationProgress): string {
    const parts: string[] = [];
    parts.push(`Resume from preempted activation (preempt #${progress.preemptCount}).`);
    parts.push(`Completed ${progress.completedSteps} steps, ${progress.completedToolCalls.length} tool calls.`);
    if (progress.completedContent) {
      parts.push(`\nProgress so far:\n${progress.completedContent}`);
    }
    return parts.join(" ");
  }

  // ── Internal: Conversation Recording ──────────────────────────

  /**
   * Record user input and assistant output to the thin thread.
   *
   * Built into the session — every activation automatically
   * updates the conversation buffer. The conversation *feature*
   * adds persistence (ConversationLog) on top.
   *
   * Skip recording for:
   * - Resume inputs (internal mechanism, not real conversation)
   * - Failed activations with no content
   */
  private recordConversation(
    batch: InputEnvelope[],
    outcome: ActivationOutcome,
  ): void {
    const now = new Date().toISOString();

    // Record user input (skip resume inputs — they're internal)
    const realInputs = batch.filter((b) => b.kind !== "resume");
    if (realInputs.length > 0) {
      const userContent =
        realInputs.length === 1
          ? realInputs[0]!.content
          : realInputs
              .map((b) => {
                const prefix = b.source ? `[${b.source}] ` : "";
                return `${prefix}${b.content}`;
              })
              .join("\n\n---\n\n");

      this.thread.push({ role: "user", content: userContent, timestamp: now });
    }

    // Record assistant output (skip if failed with no content)
    if (outcome.content && outcome.result !== "failed") {
      this.thread.push({
        role: "assistant",
        content: outcome.content,
        timestamp: now,
      });
    }

    // Sync bounded buffer → state
    this.state.thinThread = this.thread.getMessages();
  }
}

