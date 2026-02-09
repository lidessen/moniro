import type { Server } from "bun";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { existsSync, mkdirSync, unlinkSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { AgentSession } from "../agent/session.ts";
import type { BackendType } from "../backends/types.ts";
import { createBackend } from "../backends/index.ts";
import { SkillsProvider, createSkillsTool, SkillImporter } from "../agent/skills/index.ts";
import { createFeedbackTool, FEEDBACK_PROMPT } from "../agent/tools/feedback.ts";
import type { FeedbackEntry } from "../agent/tools/feedback.ts";
import {
  SESSIONS_DIR,
  ensureDirs,
  cleanupStaleSessions,
  registerSession,
  unregisterSession,
  resolveSchedule,
  getInstanceAgentNames,
  getAgentDisplayName,
} from "./registry.ts";
import type { SessionInfo, ScheduleConfig } from "./registry.ts";
import { handleRequest } from "./handler.ts";
import type { ServerState, Request } from "./handler.ts";
import { msUntilNextCron } from "./cron.ts";
import {
  createFileContextProvider,
  getDefaultContextDir,
} from "../workflow/context/file-provider.ts";
import { buildTargetDisplay } from "../cli/target.ts";

const DEFAULT_SKILL_DIRS = [
  ".agents/skills",
  ".claude/skills",
  ".cursor/skills",
  join(homedir(), ".agents/skills"),
  join(homedir(), ".claude/skills"),
];

/**
 * Setup skills provider and return Skills tool
 * Supports both local and imported skills
 * Skills are always loaded and provided as tools, regardless of backend
 */
async function setupSkills(
  sessionId: string,
  skillPaths?: string[],
  skillDirs?: string[],
  importSkills?: string[],
): Promise<{ tools: Record<string, unknown>; importer?: SkillImporter }> {
  const provider = new SkillsProvider();

  // Scan default directories
  for (const dir of DEFAULT_SKILL_DIRS) {
    try {
      provider.scanDirectorySync(dir);
    } catch {
      // Ignore errors from default paths
    }
  }

  // Scan additional directories
  if (skillDirs) {
    for (const dir of skillDirs) {
      try {
        provider.scanDirectorySync(dir);
      } catch (error) {
        console.error(`Failed to scan skill directory ${dir}:`, error);
      }
    }
  }

  // Add individual skills
  if (skillPaths) {
    for (const skillPath of skillPaths) {
      try {
        provider.addSkillSync(skillPath);
      } catch (error) {
        console.error(`Failed to add skill ${skillPath}:`, error);
      }
    }
  }

  // Import remote skills
  let importer: SkillImporter | undefined;
  if (importSkills && importSkills.length > 0) {
    importer = new SkillImporter(sessionId);

    try {
      await importer.importMultiple(importSkills);
      await provider.addImportedSkills(importer);
    } catch (error) {
      console.error("Failed to import skills:", error);
    }
  }

  const skills = provider.list();
  if (skills.length > 0) {
    console.log(`Loaded ${skills.length} skill(s):`);
    for (const skill of skills) {
      console.log(`  - ${skill.name}: ${skill.description}`);
    }
  }

  const tools: Record<string, unknown> = {};
  if (skills.length > 0) {
    tools.Skills = createSkillsTool(provider);
  }

  return { tools, importer };
}

let state: ServerState | null = null;

const DEFAULT_IDLE_TIMEOUT = 30 * 60 * 1000; // 30 minutes
const DEFAULT_SCHEDULE_PROMPT =
  "[Scheduled wakeup] You have been idle. Check if there are any pending tasks or updates to process.";

function resetIdleTimer(): void {
  if (!state) return;

  state.lastActivity = Date.now();

  // Clear existing timer
  if (state.idleTimer) {
    clearTimeout(state.idleTimer);
    state.idleTimer = undefined;
  }

  // Set new timer if idle timeout is configured
  const timeout = state.info.idleTimeout ?? DEFAULT_IDLE_TIMEOUT;
  if (timeout > 0) {
    state.idleTimer = setTimeout(() => {
      if (state && state.pendingRequests === 0) {
        console.log(`\nSession idle for ${timeout / 1000}s, shutting down...`);
        gracefulShutdown();
      } else {
        // Requests pending, reset timer
        resetIdleTimer();
      }
    }, timeout);
  }
}

/**
 * Interval-based wakeup: fires when agent has been idle for resolved.ms.
 * Resets on any activity (external send, @mention, etc).
 * After the wakeup send completes, the timer restarts.
 */
function resetIntervalSchedule(): void {
  if (!state) return;

  // Clear existing interval schedule timer
  if (state.scheduleTimer) {
    clearTimeout(state.scheduleTimer);
    state.scheduleTimer = undefined;
  }

  const schedule = state.info.schedule;
  if (!schedule) return;

  let resolved;
  try {
    resolved = resolveSchedule(schedule);
  } catch {
    return;
  }
  if (resolved.type !== "interval" || !resolved.ms) return;

  const ms = resolved.ms;
  const prompt = resolved.prompt || DEFAULT_SCHEDULE_PROMPT;

  state.scheduleTimer = setTimeout(async () => {
    if (!state || state.pendingRequests > 0) {
      resetIntervalSchedule();
      return;
    }

    console.log(`\n[wakeup:interval] Waking agent after ${ms / 1000}s idle`);

    try {
      state.pendingRequests++;
      resetIdleTimer();
      await state.session.send(prompt);
    } catch (error) {
      console.error("[wakeup:interval] Send error:", error);
    } finally {
      if (state) {
        state.pendingRequests--;
        resetIdleTimer();
        resetIntervalSchedule();
      }
    }
  }, ms);
}

/**
 * Cron-based wakeup: fires at fixed cron times, regardless of activity.
 * NOT reset by external activity — the agent is woken at the scheduled time.
 * After the wakeup completes, schedules the next occurrence.
 */
function startCronSchedule(): void {
  if (!state) return;

  // Clear existing cron timer
  if (state.cronTimer) {
    clearTimeout(state.cronTimer);
    state.cronTimer = undefined;
  }

  const schedule = state.info.schedule;
  if (!schedule) return;

  let resolved;
  try {
    resolved = resolveSchedule(schedule);
  } catch {
    return;
  }
  if (resolved.type !== "cron" || !resolved.expr) return;

  const expr = resolved.expr;
  const prompt = resolved.prompt || DEFAULT_SCHEDULE_PROMPT;

  let delay: number;
  try {
    delay = msUntilNextCron(expr);
  } catch (error) {
    console.error("[wakeup:cron] Invalid cron expression:", error);
    return;
  }

  const nextTime = new Date(Date.now() + delay);
  console.log(`[wakeup:cron] Next at ${nextTime.toISOString()} (in ${Math.round(delay / 1000)}s)`);

  state.cronTimer = setTimeout(async () => {
    if (!state) return;

    console.log(`\n[wakeup:cron] Waking agent (${expr})`);

    try {
      state.pendingRequests++;
      resetIdleTimer();
      await state.session.send(prompt);
    } catch (error) {
      console.error("[wakeup:cron] Send error:", error);
    } finally {
      if (state) {
        state.pendingRequests--;
        resetIdleTimer();
        // Schedule next cron occurrence
        startCronSchedule();
      }
    }
  }, delay);
}

/**
 * Reset schedule timers on external activity.
 * - Interval: resets (idle-based)
 * - Cron: NOT reset (fixed schedule)
 */
function resetScheduleTimers(): void {
  resetIntervalSchedule();
  // Cron intentionally not reset — fires at fixed times
}

const INBOX_POLL_MS = 2000; // Poll inbox every 2 seconds
let inboxQueued = false; // Whether inbox has pending messages to process

/**
 * Drain queued inbox messages. Called after a request completes
 * to ensure inbox messages aren't starved by busy agents.
 */
async function drainInbox(): Promise<void> {
  if (!inboxQueued || !state?.contextProvider || !state?.agentDisplayName) return;
  if (state.pendingRequests > 0) return; // Another request is active, wait
  inboxQueued = false;

  const provider = state.contextProvider;
  const agentName = state.agentDisplayName;

  try {
    const inbox = await provider.getInbox(agentName);
    if (inbox.length === 0) return;

    await processInbox(provider, agentName, inbox);
  } catch (error) {
    console.error("[inbox] Drain error:", error instanceof Error ? error.message : error);
  }
}

/**
 * Process inbox messages — shared between polling and drain.
 */
async function processInbox(
  provider: NonNullable<typeof state>["contextProvider"],
  agentName: string,
  inbox: Awaited<ReturnType<NonNullable<NonNullable<typeof state>["contextProvider"]>["getInbox"]>>,
): Promise<void> {
  if (!state || !provider) return;

  const latestId = inbox[inbox.length - 1]!.entry.id;
  const prompt = inbox.map((m) => `[${m.entry.from}]: ${m.entry.content}`).join("\n\n");

  state.pendingRequests++;
  resetIdleTimer();
  resetScheduleTimers();

  const senders = [...new Set(inbox.map((m) => m.entry.from))];
  await provider.appendChannel(
    agentName,
    `read ${inbox.length} message(s) from ${senders.join(", ")}`,
    { kind: "log" },
  );

  try {
    const response = await state.session.send(prompt);
    await provider.appendChannel(agentName, response.content);
    await provider.ackInbox(agentName, latestId);
  } finally {
    if (state) {
      state.pendingRequests--;
      resetIdleTimer();
    }
  }
}

/**
 * Start inbox polling — checks channel for @mentions and processes them via the LLM.
 * This is how agents receive messages from `send` (which posts to the channel).
 *
 * When the agent is busy (pendingRequests > 0), inbox messages are queued
 * and drained after the current request completes, preventing starvation.
 */
function startInboxPolling(): void {
  if (!state?.contextProvider || !state?.agentDisplayName) return;

  const provider = state.contextProvider;
  const agentName = state.agentDisplayName;

  state.inboxPollTimer = setInterval(async () => {
    if (!state) return;

    // If busy, mark that inbox needs draining after current request
    if (state.pendingRequests > 0) {
      inboxQueued = true;
      return;
    }

    try {
      const inbox = await provider.getInbox(agentName);
      if (inbox.length === 0) return;

      await processInbox(provider, agentName, inbox);
    } catch (error) {
      console.error("[inbox] Poll error:", error instanceof Error ? error.message : error);
    }
  }, INBOX_POLL_MS);
}

let shuttingDown = false;

async function gracefulShutdown(): Promise<void> {
  if (shuttingDown) return; // Prevent double shutdown
  shuttingDown = true;

  if (!state) {
    process.exit(0);
    return;
  }

  // Stop accepting new connections
  state.server.stop();

  // Wait for pending requests (max 10s)
  const maxWait = 10000;
  const start = Date.now();
  while (state.pendingRequests > 0 && Date.now() - start < maxWait) {
    await new Promise((resolve) => setTimeout(resolve, 100));
  }

  // Cleanup imported skills
  if (state.importer) {
    await state.importer.cleanup();
  }

  cleanup();
  process.exit(0);
}

function cleanup(): void {
  if (state) {
    if (state.idleTimer) {
      clearTimeout(state.idleTimer);
    }
    if (state.scheduleTimer) {
      clearTimeout(state.scheduleTimer);
    }
    if (state.cronTimer) {
      clearTimeout(state.cronTimer);
    }
    if (state.inboxPollTimer) {
      clearInterval(state.inboxPollTimer);
    }
    // Clean up file artifacts (socketPath is optional — old sessions only)
    for (const path of [state.info.socketPath, state.info.pidFile, state.info.readyFile]) {
      if (path && existsSync(path)) {
        try { unlinkSync(path); } catch { /* best-effort */ }
      }
    }
    unregisterSession(state.info.id);
  }
}

export async function startDaemon(config: {
  model: string;
  system: string;
  name?: string;
  /** Workflow name (defaults to "global") */
  workflow?: string;
  /** Workflow instance tag (defaults to "main") */
  tag?: string;
  /** @deprecated Use workflow instead */
  instance?: string;
  idleTimeout?: number;
  backend?: BackendType;
  /** HTTP port to listen on (0 = auto-assign) */
  port?: number;
  /** Host to bind to (default: "127.0.0.1", use "0.0.0.0" for remote access) */
  host?: string;
  skills?: string[];
  skillDirs?: string[];
  importSkills?: string[];
  tool?: string;
  feedback?: boolean;
  schedule?: ScheduleConfig;
}): Promise<void> {
  ensureDirs();

  // Clean up stale sessions from previously crashed daemons
  const staleCount = cleanupStaleSessions();
  if (staleCount > 0) {
    console.log(`Cleaned up ${staleCount} stale session(s)`);
  }

  const backendType = config.backend || "sdk";
  const sessionId = crypto.randomUUID();

  // Support both new (workflow/tag) and old (instance) parameters
  const workflow = config.workflow ?? config.instance ?? "global";
  const tag = config.tag ?? "main";
  const instance = config.instance ?? workflow; // For backward compat

  // Setup skills (both local and imported)
  const { tools, importer } = await setupSkills(
    sessionId,
    config.skills,
    config.skillDirs,
    config.importSkills,
  );

  // Import MCP tools if specified
  if (config.tool) {
    const toolPath = config.tool.startsWith("/") ? config.tool : join(process.cwd(), config.tool);
    try {
      const module = await import(toolPath);
      // Support array of tools or object with tools
      const toolsList = Array.isArray(module.default)
        ? module.default
        : module.default?.tools || [];
      for (const toolDef of toolsList) {
        if (toolDef && toolDef.name) {
          tools[toolDef.name] = toolDef;
        }
      }
    } catch (error) {
      console.error(`Failed to import tools from ${config.tool}:`, error);
    }
  }

  // Setup feedback tool if enabled
  let getFeedback: (() => FeedbackEntry[]) | undefined;
  if (config.feedback) {
    const fb = createFeedbackTool();
    tools.feedback = fb.tool;
    getFeedback = fb.getFeedback;
  }

  // Build system prompt (append feedback instructions if enabled)
  const system = config.feedback ? `${config.system}\n\n${FEEDBACK_PROMPT}` : config.system;

  // Create unified AgentSession (with CLI backend for non-SDK types)
  const cliBackend =
    backendType !== "sdk"
      ? createBackend({
          type: backendType,
          model: config.model,
        } as Parameters<typeof createBackend>[0])
      : undefined;

  const session = new AgentSession({
    model: config.model,
    system,
    tools,
    backend: cliBackend,
  });

  const effectiveId = session.id;
  const host = config.host ?? "127.0.0.1";

  // Generate paths
  const pidFile = join(SESSIONS_DIR, `${effectiveId}.pid`);
  const readyFile = join(SESSIONS_DIR, `${effectiveId}.ready`);

  // Setup workflow:tag context (shared channel + documents)
  const contextDir = getDefaultContextDir(workflow, tag);
  mkdirSync(contextDir, { recursive: true });
  const agentDisplayName = config.name ? getAgentDisplayName(config.name) : effectiveId.slice(0, 8);
  const existingAgentNames = getInstanceAgentNames(instance);
  const allAgentNames = [...new Set([...existingAgentNames, agentDisplayName, "user"])];
  const contextProvider = createFileContextProvider(contextDir, allAgentNames);

  // SessionInfo — port is filled after server starts listening
  const info: SessionInfo = {
    id: effectiveId,
    name: config.name,
    workflow,
    tag,
    instance, // Backward compat
    contextDir,
    model: config.model,
    system: config.system,
    backend: backendType,
    port: 0, // Updated after listen
    host,
    pidFile,
    readyFile,
    pid: process.pid,
    createdAt: session.createdAt,
    idleTimeout: config.idleTimeout,
    schedule: config.schedule,
  };

  // Create Hono app
  const app = new Hono();
  app.use("*", cors());

  app.post("/", async (c) => {
    try {
      const request: Request = await c.req.json();
      const resetActivity = () => {
        resetIdleTimer();
        resetScheduleTimers();
      };
      const resetAll = () => {
        resetIdleTimer();
        resetIntervalSchedule();
        startCronSchedule();
      };
      const result = await handleRequest(
        () => state,
        request,
        resetActivity,
        gracefulShutdown,
        resetAll,
        drainInbox,
      );
      return c.json(result);
    } catch (error) {
      return c.json(
        { success: false, error: error instanceof Error ? error.message : "Invalid request" },
        400,
      );
    }
  });

  // Start HTTP server via Bun.serve
  const server: Server<unknown> = Bun.serve({
    fetch: app.fetch,
    port: config.port ?? 0,
    hostname: host,
    error(error) {
      console.error("Server error:", error);
      cleanup();
      process.exit(1);
    },
  });

  info.port = server.port ?? 0;

  // Write PID file
  writeFileSync(pidFile, process.pid.toString());

  // Register session
  registerSession(info);

  // Initialize state
  state = {
    session,
    server,
    info,
    lastActivity: Date.now(),
    pendingRequests: 0,
    importer,
    getFeedback,
    contextProvider,
    agentDisplayName,
  };

  // Write ready file (signals CLI that server is ready)
  writeFileSync(readyFile, effectiveId);

  // Start idle timer
  resetIdleTimer();

  // Start schedule timers if configured
  resetIntervalSchedule();
  startCronSchedule();

  // Start inbox polling (listens for @mentions in channel)
  startInboxPolling();

  const nameStr = config.name ? ` (${config.name})` : "";
  const workflowDisplay = buildTargetDisplay(undefined, workflow, tag);
  console.log(`Session started: ${effectiveId}${nameStr}`);
  console.log(`Model: ${config.model}`);
  console.log(`Backend: ${backendType}`);
  console.log(`Workflow: ${workflowDisplay}`);
  console.log(`Listening: http://${host}:${server.port}`);
  if (config.schedule) {
    try {
      const resolved = resolveSchedule(config.schedule);
      if (resolved.type === "interval") {
        console.log(`Wakeup: every ${resolved.ms! / 1000}s when idle`);
        // Warn if idle timeout would fire before wakeup interval
        const idleMs = config.idleTimeout ?? DEFAULT_IDLE_TIMEOUT;
        if (idleMs > 0 && resolved.ms! > idleMs) {
          console.warn(
            `Warning: idle timeout (${idleMs / 1000}s) is shorter than wakeup interval (${resolved.ms! / 1000}s). ` +
              `Session will shut down before wakeup fires. Use --idle-timeout 0 to disable.`,
          );
        }
      } else {
        console.log(`Wakeup: cron ${resolved.expr}`);
      }
    } catch (error) {
      console.error("Invalid wakeup schedule:", error);
    }
  }

  // Handle signals — use graceful shutdown to wait for pending requests
  process.on("SIGINT", () => {
    console.log("\nShutting down...");
    gracefulShutdown();
  });

  process.on("SIGTERM", () => {
    gracefulShutdown();
  });
}
