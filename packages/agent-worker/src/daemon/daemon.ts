import { createServer } from "node:net";
import { existsSync, unlinkSync, writeFileSync } from "node:fs";
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
  registerSession,
  unregisterSession,
  resolveSchedule,
} from "./registry.ts";
import type { SessionInfo, ScheduleConfig } from "./registry.ts";
import { handleRequest } from "./handler.ts";
import type { ServerState, Request } from "./handler.ts";
import { msUntilNextCron } from "./cron.ts";

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

async function gracefulShutdown(): Promise<void> {
  if (!state) {
    process.exit(0);
    return;
  }

  // Stop accepting new connections
  state.server.close();

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
    if (existsSync(state.info.socketPath)) {
      unlinkSync(state.info.socketPath);
    }
    if (existsSync(state.info.pidFile)) {
      unlinkSync(state.info.pidFile);
    }
    if (existsSync(state.info.readyFile)) {
      unlinkSync(state.info.readyFile);
    }
    unregisterSession(state.info.id);
  }
}

export async function startDaemon(config: {
  model: string;
  system: string;
  name?: string;
  idleTimeout?: number;
  backend?: BackendType;
  skills?: string[];
  skillDirs?: string[];
  importSkills?: string[];
  feedback?: boolean;
  schedule?: ScheduleConfig;
}): Promise<void> {
  ensureDirs();

  const backendType = config.backend || "sdk";
  const sessionId = crypto.randomUUID();

  // Setup skills (both local and imported)
  const { tools, importer } = await setupSkills(
    sessionId,
    config.skills,
    config.skillDirs,
    config.importSkills,
  );

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

  // Generate paths
  const socketPath = join(SESSIONS_DIR, `${effectiveId}.sock`);
  const pidFile = join(SESSIONS_DIR, `${effectiveId}.pid`);
  const readyFile = join(SESSIONS_DIR, `${effectiveId}.ready`);

  // Clean up any existing socket
  if (existsSync(socketPath)) {
    unlinkSync(socketPath);
  }

  const info: SessionInfo = {
    id: effectiveId,
    name: config.name,
    model: config.model,
    system: config.system,
    backend: backendType,
    socketPath,
    pidFile,
    readyFile,
    pid: process.pid,
    createdAt: session.createdAt,
    idleTimeout: config.idleTimeout,
    schedule: config.schedule,
  };

  // Create Unix socket server
  const server = createServer((socket) => {
    let buffer = "";

    socket.on("data", async (data) => {
      buffer += data.toString();

      const lines = buffer.split("\n");
      buffer = lines.pop() || "";

      for (const line of lines) {
        if (!line.trim()) continue;

        try {
          const req: Request = JSON.parse(line);
          const resetActivity = () => { resetIdleTimer(); resetScheduleTimers(); };
          const resetAll = () => { resetIdleTimer(); resetIntervalSchedule(); startCronSchedule(); };
          const res = await handleRequest(() => state, req, resetActivity, gracefulShutdown, resetAll);
          socket.write(JSON.stringify(res) + "\n");
        } catch (error) {
          socket.write(
            JSON.stringify({
              success: false,
              error: error instanceof Error ? error.message : "Parse error",
            }) + "\n",
          );
        }
      }
    });

    socket.on("error", () => {
      // Ignore client errors
    });
  });

  server.listen(socketPath, () => {
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
    };

    // Write ready file (signals CLI that server is ready)
    writeFileSync(readyFile, effectiveId);

    // Start idle timer
    resetIdleTimer();

    // Start schedule timers if configured
    resetIntervalSchedule();
    startCronSchedule();

    const nameStr = config.name ? ` (${config.name})` : "";
    console.log(`Session started: ${effectiveId}${nameStr}`);
    console.log(`Model: ${config.model}`);
    console.log(`Backend: ${backendType}`);
    if (config.schedule) {
      try {
        const resolved = resolveSchedule(config.schedule);
        if (resolved.type === "interval") {
          console.log(`Wakeup: every ${resolved.ms! / 1000}s when idle`);
        } else {
          console.log(`Wakeup: cron ${resolved.expr}`);
        }
      } catch (error) {
        console.error("Invalid wakeup schedule:", error);
      }
    }
  });

  server.on("error", (error) => {
    console.error("Server error:", error);
    cleanup();
    process.exit(1);
  });

  // Handle signals
  process.on("SIGINT", () => {
    console.log("\nShutting down...");
    cleanup();
    process.exit(0);
  });

  process.on("SIGTERM", () => {
    cleanup();
    process.exit(0);
  });
}
