import { Hono } from "hono";
import { cors } from "hono/cors";
import { createBunWebSocket } from "hono/bun";
import type { WSContext } from "hono/ws";
import { existsSync, mkdirSync, unlinkSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { homedir } from "node:os";
import { join } from "node:path";
import { AgentWorker } from "../agent/worker.ts";
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
import type { ServerState, Response as DaemonResponse } from "./handler.ts";
import { msUntilNextCron } from "./cron.ts";
import {
  createFileContextProvider,
  getDefaultContextDir,
} from "../workflow/context/file-provider.ts";
// Inline workflow display formatting (avoids daemon → CLI dependency)
import { createContextMCPServer } from "../workflow/context/mcp-server.ts";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

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

let mcpSessions: Map<
  string,
  { transport: WebStandardStreamableHTTPServerTransport; agentId: string }
> | null = null;

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

  // Close MCP sessions
  if (mcpSessions) {
    for (const [, session] of mcpSessions) {
      try {
        await session.transport.close();
      } catch { /* best-effort */ }
    }
    mcpSessions.clear();
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

  const backendType = config.backend || "default";
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

  // Create unified AgentWorker (with CLI backend for non-default types)
  const cliBackend =
    backendType !== "default"
      ? createBackend({
          type: backendType,
          model: config.model,
        } as Parameters<typeof createBackend>[0])
      : undefined;

  const session = new AgentWorker({
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

  // Helper: dispatch an action through the transport-agnostic handler
  async function callHandler(action: string, payload?: unknown): Promise<DaemonResponse> {
    const resetActivity = () => {
      resetIdleTimer();
      resetScheduleTimers();
    };
    const resetAll = () => {
      resetIdleTimer();
      resetIntervalSchedule();
      startCronSchedule();
    };
    return handleRequest(
      () => state,
      { action, payload },
      resetActivity,
      gracefulShutdown,
      resetAll,
      drainInbox,
    );
  }

  // Helper: JSON error response with appropriate status code
  function errorResponse(c: { json: Function }, result: DaemonResponse) {
    const status = result.error === "No active session" ? 503 : 400;
    return (c as any).json(result, status);
  }

  // Create Hono app + WebSocket
  const { upgradeWebSocket, websocket } = createBunWebSocket();
  const app = new Hono();
  app.use("*", cors());

  // ── Health check (bypasses handleRequest) ──
  app.get("/health", (c) => {
    if (!state) {
      return c.json({ status: "unavailable" }, 503);
    }
    return c.json({
      status: "ok",
      session: state.info.id,
      model: state.info.model,
      backend: state.info.backend,
      pendingRequests: state.pendingRequests,
      uptime: Date.now() - new Date(state.info.createdAt).getTime(),
    });
  });

  // ── Session routes ──
  app.get("/session", async (c) => {
    const result = await callHandler("ping");
    return result.success ? c.json(result) : errorResponse(c, result);
  });

  app.post("/session/send", async (c) => {
    const body = await c.req.json();
    const result = await callHandler("send", body);
    return result.success ? c.json(result) : errorResponse(c, result);
  });

  app.get("/session/history", async (c) => {
    const result = await callHandler("history");
    return result.success ? c.json(result) : errorResponse(c, result);
  });

  app.get("/session/stats", async (c) => {
    const result = await callHandler("stats");
    return result.success ? c.json(result) : errorResponse(c, result);
  });

  app.get("/session/export", async (c) => {
    const result = await callHandler("export");
    return result.success ? c.json(result) : errorResponse(c, result);
  });

  app.post("/session/clear", async (c) => {
    const result = await callHandler("clear");
    return result.success ? c.json(result) : errorResponse(c, result);
  });

  app.post("/session/shutdown", async (c) => {
    const result = await callHandler("shutdown");
    return c.json(result);
  });

  // ── Tool routes ──
  app.get("/tools", async (c) => {
    const result = await callHandler("tool_list");
    return result.success ? c.json(result) : errorResponse(c, result);
  });

  app.post("/tools", async (c) => {
    const body = await c.req.json();
    const result = await callHandler("tool_add", body);
    return result.success ? c.json(result, 201) : errorResponse(c, result);
  });

  app.post("/tools/import", async (c) => {
    const body = await c.req.json();
    const result = await callHandler("tool_import", body);
    return result.success ? c.json(result) : errorResponse(c, result);
  });

  app.post("/tools/mock", async (c) => {
    const body = await c.req.json();
    const result = await callHandler("tool_mock", body);
    return result.success ? c.json(result) : errorResponse(c, result);
  });

  // ── Approval routes ──
  app.get("/approvals", async (c) => {
    const result = await callHandler("pending");
    return result.success ? c.json(result) : errorResponse(c, result);
  });

  app.post("/approvals/:id/approve", async (c) => {
    const result = await callHandler("approve", { id: c.req.param("id") });
    return result.success ? c.json(result) : errorResponse(c, result);
  });

  app.post("/approvals/:id/deny", async (c) => {
    const body = await c.req.json().catch(() => ({}));
    const result = await callHandler("deny", { id: c.req.param("id"), ...body });
    return result.success ? c.json(result) : errorResponse(c, result);
  });

  // ── Feedback route ──
  app.get("/feedback", async (c) => {
    const result = await callHandler("feedback_list");
    return result.success ? c.json(result) : errorResponse(c, result);
  });

  // ── Schedule routes ──
  app.get("/schedule", async (c) => {
    const result = await callHandler("schedule_get");
    return result.success ? c.json(result) : errorResponse(c, result);
  });

  app.put("/schedule", async (c) => {
    const body = await c.req.json();
    const result = await callHandler("schedule_set", body);
    return result.success ? c.json(result) : errorResponse(c, result);
  });

  app.delete("/schedule", async (c) => {
    const result = await callHandler("schedule_clear");
    return result.success ? c.json(result) : errorResponse(c, result);
  });

  // ── MCP endpoint (context tools via Model Context Protocol) ──
  mcpSessions = new Map();

  function createMCPServerInstance(): McpServer {
    return createContextMCPServer({
      provider: contextProvider,
      validAgents: allAgentNames,
      name: `${workflow}-context`,
      version: "1.0.0",
      feedback: config.feedback,
    }).server;
  }

  app.all("/mcp", async (c) => {
    if (!mcpSessions) return c.json({ error: "MCP not initialized" }, 503);

    const req = c.req.raw;
    const sessionId = req.headers.get("mcp-session-id");
    const sessions = mcpSessions; // Narrow type for closures below

    // Route to existing session
    if (sessionId && sessions.has(sessionId)) {
      const session = sessions.get(sessionId)!;

      if (req.method === "DELETE") {
        await session.transport.close();
        sessions.delete(sessionId);
        return new Response(null, { status: 200 });
      }

      return session.transport.handleRequest(req);
    }

    // New session — only POST with initialize is valid
    if (req.method === "POST") {
      const body = await req.json();

      // Check for initialize method
      const isInit = Array.isArray(body)
        ? body.some((m: { method?: string }) => m?.method === "initialize")
        : (body as { method?: string })?.method === "initialize";

      if (!isInit) {
        return c.json({ error: "Bad request: session required" }, 400);
      }

      // Resolve agent identity from query param or daemon's own name
      const url = new URL(req.url);
      const agentName = url.searchParams.get("agent") || agentDisplayName;

      const transport = new WebStandardStreamableHTTPServerTransport({
        sessionIdGenerator: () => `${agentName}-${randomUUID().slice(0, 8)}`,
        onsessioninitialized: (sid: string) => {
          sessions.set(sid, { transport, agentId: agentName });
        },
        onsessionclosed: (sid: string) => {
          sessions.delete(sid);
        },
        enableJsonResponse: true,
      });

      const mcpServer = createMCPServerInstance();
      await mcpServer.connect(transport);

      return transport.handleRequest(req, { parsedBody: body });
    }

    // GET without session (SSE stream) — need session ID
    if (req.method === "GET") {
      return c.json({ error: "Session ID required for GET requests" }, 400);
    }

    return c.json({ error: "Method not allowed" }, 405);
  });

  // ── WebSocket endpoint for streaming ──
  const wsClients = new Set<WSContext>();

  app.get(
    "/ws",
    upgradeWebSocket(() => ({
      onOpen(_evt, ws) {
        wsClients.add(ws);
      },

      onClose(_evt, ws) {
        wsClients.delete(ws);
      },

      async onMessage(evt, ws) {
        if (!state) {
          ws.send(JSON.stringify({ type: "error", error: "No active session" }));
          return;
        }

        let msg: { action: string; [key: string]: unknown };
        try {
          msg = JSON.parse(typeof evt.data === "string" ? evt.data : new TextDecoder().decode(evt.data as ArrayBuffer));
        } catch {
          ws.send(JSON.stringify({ type: "error", error: "Invalid JSON" }));
          return;
        }

        // Streaming send — yields token chunks
        if (msg.action === "send_stream") {
          const message = msg.message as string;
          const options = msg.options as { autoApprove?: boolean } | undefined;

          if (!message || typeof message !== "string") {
            ws.send(JSON.stringify({ type: "error", error: "Message is required" }));
            return;
          }

          state.pendingRequests++;
          resetIdleTimer();
          resetScheduleTimers();

          try {
            const gen = state.session.sendStream(message, options);
            let finalResponse;
            while (true) {
              const { value, done } = await gen.next();
              if (done) {
                finalResponse = value;
                break;
              }
              ws.send(JSON.stringify({ type: "chunk", data: value }));
            }
            ws.send(JSON.stringify({ type: "done", data: finalResponse }));
          } catch (error) {
            const errorMsg = error instanceof Error ? error.message : String(error);
            ws.send(JSON.stringify({ type: "error", error: errorMsg }));
          } finally {
            if (state) {
              state.pendingRequests--;
              resetIdleTimer();
              if (state.pendingRequests === 0) {
                drainInbox();
              }
            }
          }
          return;
        }

        // All other actions: dispatch through handler and send response
        try {
          const result = await callHandler(msg.action, msg.payload);
          ws.send(JSON.stringify({ type: "response", action: msg.action, ...result }));
        } catch (error) {
          const errorMsg = error instanceof Error ? error.message : String(error);
          ws.send(JSON.stringify({ type: "error", error: errorMsg }));
        }
      },
    })),
  );

  // Start HTTP server via Bun.serve
  const server = Bun.serve({
    fetch: app.fetch,
    websocket,
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
  const workflowDisplay = tag === "main" ? `@${workflow}` : `@${workflow}:${tag}`;
  console.log(`Session started: ${effectiveId}${nameStr}`);
  console.log(`Model: ${config.model}`);
  console.log(`Backend: ${backendType}`);
  console.log(`Workflow: ${workflowDisplay}`);
  console.log(`Listening: http://${host}:${server.port}`);
  console.log(`MCP: http://${host}:${server.port}/mcp`);
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
