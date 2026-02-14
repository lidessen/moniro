/**
 * Agent Controller Implementation
 * Manages agent lifecycle with polling and retry logic
 *
 * The controller owns the full orchestration line:
 *   inbox → build prompt → configure workspace → backend.send() → result
 * Backends are pure communication adapters — they only know how to send().
 */

import type { ContextProvider } from "../context/provider.ts";
import type { ProposalManager } from "../context/proposals.ts";
import type {
  AgentController,
  AgentControllerConfig,
  AgentState,
  AgentRunContext,
  AgentRunResult,
  WorkflowIdleState,
} from "./types.ts";
import { CONTROLLER_DEFAULTS } from "./types.ts";
import { buildAgentPrompt } from "./prompt.ts";
import { generateWorkflowMCPConfig } from "./mcp-config.ts";
import { resolveSchedule, type ScheduleConfig } from "../../daemon/registry.ts";
import { msUntilNextCron } from "../../daemon/cron.ts";

/** Check if controller should continue running */
function shouldContinue(state: AgentState): boolean {
  return state !== "stopped";
}

/**
 * Create an agent controller
 *
 * The controller:
 * 1. Polls for inbox messages on an interval
 * 2. Runs the agent when messages are found
 * 3. Acknowledges inbox only on successful run
 * 4. Retries with exponential backoff on failure
 * 5. Can be woken early via wake()
 */
export function createAgentController(config: AgentControllerConfig): AgentController {
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
  } = config;

  const infoLog = config.infoLog ?? log;
  const errorLog = config.errorLog ?? log;

  const pollInterval = config.pollInterval ?? CONTROLLER_DEFAULTS.pollInterval;
  const retryConfig = {
    maxAttempts: config.retry?.maxAttempts ?? CONTROLLER_DEFAULTS.retry.maxAttempts,
    backoffMs: config.retry?.backoffMs ?? CONTROLLER_DEFAULTS.retry.backoffMs,
    backoffMultiplier:
      config.retry?.backoffMultiplier ?? CONTROLLER_DEFAULTS.retry.backoffMultiplier,
  };

  let state: AgentState = "stopped";
  let wakeResolver: (() => void) | null = null;
  let pollTimeout: ReturnType<typeof setTimeout> | null = null;

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
   * Main controller loop
   */
  async function runLoop(): Promise<void> {
    while (shouldContinue(state)) {
      // Wait for poll interval or wake
      await waitForWakeOrPoll();

      // Check if stopped during wait
      if (!shouldContinue(state)) break;

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
            await contextProvider.appendChannel("system", `@${name} ${wakeupPrompt}`);
            lastActivityTime = now;
            // Re-check inbox — the wakeup message should now be there
            continue;
          }
        }

        state = "idle";
        // Update status to idle
        await contextProvider.setAgentStatus(name, { state: "idle" });
        continue;
      }

      // Log inbox summary (always visible) and details (debug only)
      const senders = inbox.map((m) => m.entry.from);
      infoLog(`Inbox: ${inbox.length} message(s) from [${senders.join(", ")}]`);
      for (const msg of inbox) {
        const preview =
          msg.entry.content.length > 120
            ? msg.entry.content.slice(0, 120) + "..."
            : msg.entry.content;
        log(`  from @${msg.entry.from}: ${preview}`);
      }

      // Get latest message ID for acknowledgment
      const latestId = inbox[inbox.length - 1]!.entry.id;

      // Mark inbox as seen (controller picked it up, now processing)
      await contextProvider.markInboxSeen(name, latestId);

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
            limit: CONTROLLER_DEFAULTS.recentChannelLimit,
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
        };

        // Orchestrate: build prompt → configure workspace → send
        lastResult = await runAgent(backend, runContext, log, infoLog);

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
          await contextProvider.ackInbox(name, latestId);

          // Reset schedule timer on activity
          lastActivityTime = Date.now();

          // Update status to idle after successful completion
          await contextProvider.setAgentStatus(name, { state: "idle" });

          break;
        }

        errorLog(`ERROR ${lastResult.error}`);

        // Retry with backoff (unless last attempt)
        if (attempt < retryConfig.maxAttempts && shouldContinue(state)) {
          const delay =
            retryConfig.backoffMs * Math.pow(retryConfig.backoffMultiplier, attempt - 1);
          log(`Retrying in ${delay}ms...`);
          await sleep(delay);
        }
      }

      // If all retries exhausted, still acknowledge to prevent infinite loop
      if (lastResult && !lastResult.success) {
        errorLog(`ERROR max retries exhausted, acknowledging to prevent loop`);
        await contextProvider.ackInbox(name, latestId);
      }

      // Notify completion
      if (lastResult && onRunComplete) {
        onRunComplete(lastResult);
      }

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

    async start() {
      if (state !== "stopped") {
        throw new Error(`Controller ${name} is already running`);
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
  };
}

// ==================== Agent Run Orchestration ====================

import type { Backend } from "@/backends/types.ts";
import { runMockAgent } from "./mock-runner.ts";
import { runSdkAgent } from "./sdk-runner.ts";

/**
 * Run an agent: build prompt, configure workspace, call backend.send()
 *
 * This is the single orchestration function that the controller calls.
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
    // Configure workspace with MCP
    if (backend.setWorkspace) {
      const mcpConfig = generateWorkflowMCPConfig(ctx.mcpUrl, ctx.name);
      backend.setWorkspace(ctx.workspaceDir, mcpConfig);
    }

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
  controllers: Map<string, AgentController>,
  provider: ContextProvider,
  debounceMs: number = CONTROLLER_DEFAULTS.idleDebounceMs,
): Promise<boolean> {
  // Check all controllers are idle
  const allIdle = [...controllers.values()].every((c) => c.state === "idle");
  if (!allIdle) return false;

  // Check no unread messages for any agent
  for (const [name] of controllers) {
    const inbox = await provider.getInbox(name);
    if (inbox.length > 0) return false;
  }

  // Debounce: wait and check again
  await sleep(debounceMs);

  // Verify still idle after debounce
  return [...controllers.values()].every((c) => c.state === "idle");
}

/**
 * Check if workflow is complete (synchronous state check)
 * All conditions must be true for workflow to be considered complete
 */
export function isWorkflowComplete(state: WorkflowIdleState): boolean {
  return (
    state.allControllersIdle &&
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
  controllers: Map<string, AgentController>,
  provider: ContextProvider,
  proposalManager?: ProposalManager,
): Promise<Omit<WorkflowIdleState, "idleDebounceElapsed">> {
  // Check all controllers are idle
  const allControllersIdle = [...controllers.values()].every((c) => c.state === "idle");

  // Check no unread messages for any agent
  let noUnreadMessages = true;
  for (const [name] of controllers) {
    const inbox = await provider.getInbox(name);
    if (inbox.length > 0) {
      noUnreadMessages = false;
      break;
    }
  }

  // Check no active proposals
  const noActiveProposals = proposalManager ? !proposalManager.hasActiveProposals() : true;

  return {
    allControllersIdle,
    noUnreadMessages,
    noActiveProposals,
  };
}
