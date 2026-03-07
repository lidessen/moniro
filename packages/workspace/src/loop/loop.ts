/**
 * Agent Loop Implementation
 * Manages agent lifecycle with polling and retry logic
 *
 * The loop owns the full orchestration line:
 *   inbox → build prompt → configure workspace → backend.send() → result
 * Backends are pure communication adapters — they only know how to send().
 */

import type { ContextProvider } from "../context/provider.ts";
import type { ProposalManager } from "../context/proposals.ts";
import type {
  AgentLoop,
  AgentLoopConfig,
  AgentState,
  AgentInstruction,
  AgentRunContext,
  AgentRunResult,
  PersonalContext,
  WorkflowIdleState,
} from "./types.ts";
import { LOOP_DEFAULTS } from "./types.ts";
import {
  InstructionQueue,
  generateInstructionId,
  classifyInboxPriority,
} from "./priority-queue.ts";
import { buildAgentPrompt } from "./prompt.ts";
import { generateWorkflowMCPConfig } from "./mcp-config.ts";
import { resolveSchedule, msUntilNextCron } from "@moniro/agent-loop";
import type { ScheduleConfig } from "@moniro/agent-loop";
import type { ConversationMessage } from "@moniro/agent-worker";
import type { InboxMessage } from "../context/types.ts";

/** Check if loop should continue running */
function shouldContinue(state: AgentState): boolean {
  return state !== "stopped";
}

/**
 * Create an agent loop
 *
 * The loop:
 * 1. Polls for inbox messages on an interval
 * 2. Runs the agent when messages are found
 * 3. Acknowledges inbox only on successful run
 * 4. Retries with exponential backoff on failure
 * 5. Can be woken early via wake()
 */
export function createAgentLoop(config: AgentLoopConfig): AgentLoop {
  const {
    name,
    agent,
    contextProvider,
    eventLog,
    mcpUrl,
    workspaceDir,
    projectDir,
    backend,
    onRunComplete,
    log = () => {},
    feedback,
    conversationLog,
    thinThread,
  } = config;

  const infoLog = config.infoLog ?? log;
  const errorLog = config.errorLog ?? log;

  const pollInterval = config.pollInterval ?? LOOP_DEFAULTS.pollInterval;
  const retryConfig = {
    maxAttempts: config.retry?.maxAttempts ?? LOOP_DEFAULTS.retry.maxAttempts,
    backoffMs: config.retry?.backoffMs ?? LOOP_DEFAULTS.retry.backoffMs,
    backoffMultiplier: config.retry?.backoffMultiplier ?? LOOP_DEFAULTS.retry.backoffMultiplier,
  };

  let state: AgentState = "stopped";
  let wakeResolver: (() => void) | null = null;
  let pollTimeout: ReturnType<typeof setTimeout> | null = null;
  // Logical lock to prevent sendDirect and poll loop from racing
  let directRunning = false;
  // Track whether any run exhausted all retries without success
  let _hasFailures = false;
  let _lastError: string | undefined;

  // Priority queue: three lanes (immediate > normal > background)
  const queue = new InstructionQueue();

  // Schedule support: resolve agent's wakeup config into a typed schedule.
  // Validate eagerly so invalid cron expressions fail at creation, not at runtime.
  const scheduleConfig: ScheduleConfig | undefined = agent.schedule;
  let resolvedSchedule: ReturnType<typeof resolveSchedule> | undefined;
  if (scheduleConfig) {
    try {
      resolvedSchedule = resolveSchedule(scheduleConfig);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new Error(`Agent "${name}" has invalid schedule config: ${msg}`);
    }
  }
  let lastActivityTime = Date.now();

  /**
   * Wait for either poll interval or wake() call
   */
  async function waitForWakeOrPoll(): Promise<void> {
    return new Promise((resolve) => {
      wakeResolver = resolve;
      pollTimeout = setTimeout(() => {
        wakeResolver = null;
        resolve();
      }, pollInterval);
    });
  }

  /**
   * Convert inbox messages to instructions and enqueue them by priority.
   */
  function enqueueInbox(inbox: InboxMessage[]): void {
    // Group all inbox messages into a single instruction.
    // The agent processes the full batch — priority determines ordering
    // relative to other instructions (e.g., externally enqueued ones).
    if (inbox.length === 0) return;

    // Classify priority: highest priority message wins for the batch
    let batchPriority: "immediate" | "normal" | "background" = "background";
    for (const msg of inbox) {
      const isDm = !!msg.entry.to;
      const instrPriority = classifyInboxPriority(msg.priority, isDm);
      if (instrPriority === "immediate") {
        batchPriority = "immediate";
        break;
      }
      if (instrPriority === "normal") {
        batchPriority = "normal";
      }
    }

    // Determine source from first message
    const first = inbox[0]!;
    const source = first.entry.to ? "dm" : "mention";

    queue.enqueue({
      id: generateInstructionId(),
      message: inbox.map((m) => m.entry.content).join("\n"),
      source,
      priority: batchPriority,
      queuedAt: new Date().toISOString(),
      inboxMessages: inbox,
    } satisfies AgentInstruction);
  }

  /**
   * Process a single instruction: run agent with retry logic.
   */
  async function processInstruction(instruction: AgentInstruction): Promise<void> {
    const inbox = instruction.inboxMessages ?? [];

    // Log inbox summary (always visible) and details (debug only)
    if (inbox.length > 0) {
      const senders = inbox.map((m) => m.entry.from);
      infoLog(
        `Inbox: ${inbox.length} message(s) from [${senders.join(", ")}] [${instruction.priority}]`,
      );
      for (const msg of inbox) {
        const preview =
          msg.entry.content.length > 120
            ? msg.entry.content.slice(0, 120) + "..."
            : msg.entry.content;
        log(`  from @${msg.entry.from}: ${preview}`);
      }
    } else {
      infoLog(`Processing instruction [${instruction.priority}/${instruction.source}]`);
    }

    // Get latest message ID for acknowledgment
    const latestId = inbox.length > 0 ? inbox[inbox.length - 1]!.entry.id : undefined;

    // Mark inbox as seen (loop picked it up, now processing)
    if (latestId) {
      await contextProvider.markInboxSeen(name, latestId);
    }

    // Read personal context once (stable across retries)
    const personalContext = await readPersonalContext(agent.handle);

    // Run agent with retry
    let attempt = 0;
    let lastResult: AgentRunResult | null = null;

    while (attempt < retryConfig.maxAttempts && shouldContinue(state)) {
      attempt++;
      state = "running";

      // Update status to running
      await contextProvider.setAgentStatus(name, { state: "running" });

      infoLog(`Running (attempt ${attempt}/${retryConfig.maxAttempts})`);

      // Build run context
      const runContext: AgentRunContext = {
        name,
        agent,
        inbox,
        recentChannel: await contextProvider.readChannel({
          limit: LOOP_DEFAULTS.recentChannelLimit,
          agent: name,
        }),
        documentContent: await contextProvider.readDocument(),
        mcpUrl,
        workspaceDir,
        projectDir,
        retryAttempt: attempt,
        provider: contextProvider,
        eventLog,
        feedback,
        // Cooperative preemption: yield if higher-priority instruction arrives
        shouldYield: () => queue.hasHigherPriority(instruction.priority),
        // Resume from previous progress if this instruction was preempted before
        resumeProgress: instruction.progress,
        // Personal context for ref agents (soul, memory, todos)
        personalContext,
      };

      // Orchestrate: build prompt → configure workspace → send
      lastResult = await runAgent(backend, runContext, log, infoLog);

      // Handle preemption: re-queue with progress, break to process higher-priority
      if (lastResult.preempted) {
        const preemptCount = (instruction.progress?.preemptCount ?? 0) + 1;
        infoLog(`Preempted after ${lastResult.steps ?? 0} steps (count: ${preemptCount})`);
        queue.enqueue({
          ...instruction,
          progress: {
            resumeFromStep: lastResult.steps ?? 0,
            completedWork: lastResult.completedWork ?? "",
            preemptCount,
            queuedAt: instruction.progress?.queuedAt ?? instruction.queuedAt,
          },
        });
        // Don't ack inbox — instruction will be resumed
        break;
      }

      if (lastResult.success) {
        const detail = lastResult.steps
          ? `${lastResult.steps} steps, ${lastResult.toolCalls} tool calls, ${lastResult.duration}ms`
          : `${lastResult.duration}ms`;
        infoLog(`DONE ${detail}`);

        // Write agent's final response to channel (so it's visible to user)
        if (lastResult.content) {
          await contextProvider.appendChannel(name, lastResult.content);
        }

        // Acknowledge inbox on success
        if (latestId) {
          await contextProvider.ackInbox(name, latestId);
        }

        // Reset schedule timer on activity
        lastActivityTime = Date.now();

        // Update status to idle after successful completion
        await contextProvider.setAgentStatus(name, { state: "idle" });

        break;
      }

      errorLog(`ERROR ${lastResult.error}`);

      // Retry with backoff (unless last attempt)
      if (attempt < retryConfig.maxAttempts && shouldContinue(state)) {
        const delay = retryConfig.backoffMs * Math.pow(retryConfig.backoffMultiplier, attempt - 1);
        log(`Retrying in ${delay}ms...`);
        await sleep(delay);
      }
    }

    // If all retries exhausted, still acknowledge to prevent infinite loop
    if (lastResult && !lastResult.success) {
      _hasFailures = true;
      _lastError = lastResult.error;
      errorLog(`ERROR max retries exhausted, acknowledging to prevent loop`);
      if (latestId) {
        await contextProvider.ackInbox(name, latestId);
      }
    }

    // Notify completion
    if (lastResult && onRunComplete) {
      onRunComplete(lastResult);
    }
  }

  /**
   * Main poll loop — polls inbox, classifies into instructions, processes by priority.
   */
  async function runLoop(): Promise<void> {
    while (shouldContinue(state)) {
      // Process any queued instructions first (from external enqueue())
      if (!queue.isEmpty && !directRunning) {
        const instruction = queue.dequeue()!;
        await processInstruction(instruction);
        state = "idle";
        await contextProvider.setAgentStatus(name, { state: "idle" });
        continue;
      }

      // Wait for poll interval or wake
      await waitForWakeOrPoll();

      // Check if stopped during wait
      if (!shouldContinue(state)) break;

      // Skip if a sendDirect call is in progress
      if (directRunning) continue;

      // Check externally enqueued instructions first
      if (!queue.isEmpty) continue;

      // Check inbox
      const inbox = await contextProvider.getInbox(name);
      if (inbox.length === 0) {
        // No messages — check if schedule-based wakeup is due
        if (resolvedSchedule) {
          const now = Date.now();
          let wakeupDue = false;

          if (resolvedSchedule.type === "interval") {
            // Interval: wake when idle longer than the configured duration
            const elapsed = now - lastActivityTime;
            if (elapsed >= resolvedSchedule.ms!) {
              wakeupDue = true;
            }
          } else if (resolvedSchedule.type === "cron") {
            // Cron: compute the absolute time of the next cron match after lastActivity,
            // then check if that time has already passed
            const msTillNext = msUntilNextCron(resolvedSchedule.expr!, new Date(lastActivityTime));
            const nextTriggerTime = lastActivityTime + msTillNext;
            if (now >= nextTriggerTime) {
              wakeupDue = true;
            }
          }

          if (wakeupDue) {
            const wakeupPrompt =
              resolvedSchedule.prompt ?? "Scheduled wakeup. Check for any pending work or updates.";
            log(`Schedule wakeup triggered for ${name}`);
            // Enqueue directly as background priority (skip synthetic channel message)
            queue.enqueue({
              id: generateInstructionId(),
              message: wakeupPrompt,
              source: "schedule",
              priority: "background",
              queuedAt: new Date().toISOString(),
            });
            lastActivityTime = now;
            // Process the queued instruction on next iteration
            continue;
          }
        }

        state = "idle";
        // Update status to idle
        await contextProvider.setAgentStatus(name, { state: "idle" });
        continue;
      }

      // Classify inbox messages into instructions and enqueue
      enqueueInbox(inbox);

      // Process the highest-priority instruction
      const instruction = queue.dequeue()!;
      await processInstruction(instruction);

      state = "idle";
      // Update status after completing work
      await contextProvider.setAgentStatus(name, { state: "idle" });
    }
  }

  return {
    get name() {
      return name;
    },

    get state() {
      return state;
    },

    get hasFailures() {
      return _hasFailures;
    },

    get lastError() {
      return _lastError;
    },

    async start() {
      if (state !== "stopped") {
        throw new Error(`Loop ${name} is already running`);
      }

      state = "idle";
      lastActivityTime = Date.now();
      // Update status when starting
      await contextProvider.setAgentStatus(name, { state: "idle" });
      if (resolvedSchedule) {
        const desc =
          resolvedSchedule.type === "interval"
            ? `${resolvedSchedule.ms}ms interval`
            : `cron "${resolvedSchedule.expr}"`;
        infoLog(`Starting (schedule: ${desc})`);
      } else {
        infoLog(`Starting`);
      }

      // Start loop (don't await - runs in background)
      runLoop().catch((error) => {
        errorLog(`ERROR ${error instanceof Error ? error.message : String(error)}`);
        state = "stopped";
        // Update status on error
        contextProvider.setAgentStatus(name, { state: "stopped" }).catch(() => {
          // Ignore errors during error handling
        });
      });
    },

    async stop() {
      log(`Stopping`);
      state = "stopped";

      // Update status when stopping
      await contextProvider.setAgentStatus(name, { state: "stopped" });

      // Abort any running backend operations
      if (backend.abort) {
        backend.abort();
      }

      // Clear pending timeout
      if (pollTimeout) {
        clearTimeout(pollTimeout);
        pollTimeout = null;
      }

      // Wake if waiting
      if (wakeResolver) {
        wakeResolver();
        wakeResolver = null;
      }
    },

    wake() {
      if (state === "idle" && wakeResolver) {
        log(`Waking`);
        if (pollTimeout) {
          clearTimeout(pollTimeout);
          pollTimeout = null;
        }
        wakeResolver();
        wakeResolver = null;
      }
    },

    enqueue(instruction: AgentInstruction) {
      queue.enqueue(instruction);
      log(`Enqueued instruction [${instruction.priority}/${instruction.source}]`);
      // Wake the poll loop so it processes the instruction immediately
      this.wake();
    },

    async sendDirect(message: string): Promise<AgentRunResult> {
      // Prevent concurrent runs (poll loop or another sendDirect)
      if (directRunning) {
        return {
          success: false,
          error: "Agent is already processing a direct request",
          duration: 0,
        };
      }
      if (state === "running") {
        return {
          success: false,
          error: "Agent is currently running (poll loop)",
          duration: 0,
        };
      }

      directRunning = true;
      const prevState = state;
      state = "running";
      await contextProvider.setAgentStatus(name, { state: "running" });

      try {
        // Write user message to channel for history
        await contextProvider.appendChannel("user", `@${name} ${message}`);

        // Track user message in conversation (thin thread + log)
        if (thinThread) {
          const userMsg: ConversationMessage = {
            role: "user",
            content: message,
            timestamp: new Date().toISOString(),
          };
          thinThread.push(userMsg);
          conversationLog?.append(userMsg);
        }

        // Build a synthetic inbox from the message we just wrote
        const inbox = await contextProvider.getInbox(name);
        const latestId = inbox.length > 0 ? inbox[inbox.length - 1]!.entry.id : undefined;

        if (latestId) {
          await contextProvider.markInboxSeen(name, latestId);
        }

        // Read personal context for ref agents
        const personalContext = await readPersonalContext(agent.handle);

        // Build run context (same as poll loop, plus thin thread)
        const runContext: AgentRunContext = {
          name,
          agent,
          inbox,
          recentChannel: await contextProvider.readChannel({
            limit: LOOP_DEFAULTS.recentChannelLimit,
            agent: name,
          }),
          documentContent: await contextProvider.readDocument(),
          mcpUrl,
          workspaceDir,
          projectDir,
          retryAttempt: 1,
          provider: contextProvider,
          eventLog,
          feedback,
          thinThread: thinThread?.getMessages(),
          personalContext,
        };

        infoLog(`Direct send (${message.length} chars)`);
        const result = await runAgent(backend, runContext, log, infoLog);

        if (result.success) {
          // Write response to channel
          if (result.content) {
            await contextProvider.appendChannel(name, result.content);

            // Track assistant response in conversation
            if (thinThread) {
              const assistantMsg: ConversationMessage = {
                role: "assistant",
                content: result.content,
                timestamp: new Date().toISOString(),
              };
              thinThread.push(assistantMsg);
              conversationLog?.append(assistantMsg);
            }
          }
          // Acknowledge inbox
          if (latestId) {
            await contextProvider.ackInbox(name, latestId);
          }
          lastActivityTime = Date.now();
        }

        return result;
      } finally {
        directRunning = false;
        state = prevState === "stopped" ? "stopped" : "idle";
        await contextProvider.setAgentStatus(name, { state }).catch(() => {});
      }
    },
  };
}

// ==================== Agent Run Orchestration ====================

import type { Backend } from "@moniro/agent-loop";
import { runMockAgent } from "./mock-runner.ts";
import { runSdkAgent } from "./sdk-runner.ts";
import { writeBackendMcpConfig } from "./mcp-config.ts";

/**
 * Run an agent: build prompt, configure workspace, call backend.send()
 *
 * This is the single orchestration function that the loop calls.
 * All the "how to run an agent" logic lives here — backends just send().
 *
 * SDK and mock backends get special runners with MCP tool bridge + bash,
 * because they can't manage tools on their own (unlike CLI backends).
 */
async function runAgent(
  backend: Backend,
  ctx: AgentRunContext,
  log: (msg: string) => void,
  infoLog?: (msg: string) => void,
): Promise<AgentRunResult> {
  const info = infoLog ?? log;

  // Mock backend: scripted tool calls for integration testing
  if (backend.type === "mock") {
    return runMockAgent(ctx, (msg) => log(msg));
  }

  // Default backend: real model with MCP tools + bash
  if (backend.type === "default") {
    return runSdkAgent(ctx, (msg) => log(msg));
  }

  // CLI backends (claude, codex, cursor): manage their own tools
  const startTime = Date.now();

  try {
    // Write MCP config to workspace (backend-specific format)
    const mcpConfig = generateWorkflowMCPConfig(ctx.mcpUrl, ctx.name);
    writeBackendMcpConfig(backend.type, ctx.workspaceDir, mcpConfig);

    // Build prompt from context
    const prompt = buildAgentPrompt(ctx);
    info(`Prompt (${prompt.length} chars) → ${backend.type} backend`);

    // Send via backend
    const response = await backend.send(prompt, { system: ctx.agent.resolvedSystemPrompt });

    return {
      success: true,
      duration: Date.now() - startTime,
      content: response.content,
    };
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    return { success: false, error: errorMsg, duration: Date.now() - startTime };
  }
}

/**
 * Sleep helper
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ==================== Idle Detection ====================

/**
 * Check if workflow is complete (all agents idle, no pending work)
 */
export async function checkWorkflowIdle(
  loops: Map<string, AgentLoop>,
  provider: ContextProvider,
  debounceMs: number = LOOP_DEFAULTS.idleDebounceMs,
): Promise<boolean> {
  // Check all loops are idle
  const allIdle = [...loops.values()].every((c) => c.state === "idle");
  if (!allIdle) return false;

  // Check no unread messages for any agent
  for (const [name] of loops) {
    const inbox = await provider.getInbox(name);
    if (inbox.length > 0) return false;
  }

  // Debounce: wait and check again
  await sleep(debounceMs);

  // Verify still idle after debounce
  return [...loops.values()].every((c) => c.state === "idle");
}

/**
 * Check if workflow is complete (synchronous state check)
 * All conditions must be true for workflow to be considered complete
 */
export function isWorkflowComplete(state: WorkflowIdleState): boolean {
  return (
    state.allLoopsIdle &&
    state.noUnreadMessages &&
    state.noActiveProposals &&
    state.idleDebounceElapsed
  );
}

/**
 * Build workflow idle state from current state
 * Used for run mode exit detection
 */
export async function buildWorkflowIdleState(
  loops: Map<string, AgentLoop>,
  provider: ContextProvider,
  proposalManager?: ProposalManager,
): Promise<Omit<WorkflowIdleState, "idleDebounceElapsed">> {
  // Check all loops are idle
  const allLoopsIdle = [...loops.values()].every((c) => c.state === "idle");

  // Check no unread messages for any agent
  let noUnreadMessages = true;
  for (const [name] of loops) {
    const inbox = await provider.getInbox(name);
    if (inbox.length > 0) {
      noUnreadMessages = false;
      break;
    }
  }

  // Check no active proposals
  const noActiveProposals = proposalManager ? !(await proposalManager.hasActiveProposals()) : true;

  return {
    allLoopsIdle,
    noUnreadMessages,
    noActiveProposals,
  };
}

// ── Personal Context ──────────────────────────────────────────────

/**
 * Read personal context from an agent handle (if available).
 * Returns undefined for inline agents (no handle) or agents without context.
 */
async function readPersonalContext(
  handle: import("../types.ts").AgentHandleRef | undefined,
): Promise<PersonalContext | undefined> {
  if (!handle) return undefined;

  const soul = handle.definition.soul;
  const [memory, todos] = await Promise.all([
    handle.readMemory?.() ?? Promise.resolve(undefined),
    handle.readTodos?.() ?? Promise.resolve(undefined),
  ]);

  // Only return if there's something to inject
  if (!soul && !memory && !todos) return undefined;

  return { soul, memory, todos };
}
