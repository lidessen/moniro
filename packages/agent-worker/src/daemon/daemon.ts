/**
 * Daemon — Centralized agent coordinator.
 *
 * Architecture: Interface → Daemon → Loop (three layers)
 *   Interface: CLI/REST/MCP clients talk to daemon via HTTP
 *   Daemon:    This module — owns lifecycle, creates workspaces + loops
 *   Loop:      AgentLoop + Backend — executes agent reasoning
 *
 * Data ownership:
 *   AgentRegistry (agents) — what agents exist + their handles (loop, state)
 *   WorkspaceRegistry      — active workspaces (shared infrastructure)
 *   Workflows (workflows)  — running workflow instances
 *
 * Key principle: agents own their loops (stored on AgentHandle). Workspaces
 * provide shared infrastructure (context, MCP, event log). Standalone agents
 * get a workspace created lazily on first /run or /serve.
 *
 * HTTP endpoints:
 *   GET  /health, POST /shutdown
 *   GET/POST /agents, GET/DELETE /agents/:name
 *   POST /run (SSE), POST /serve
 *   GET/POST /workflows, DELETE /workflows/:name/:tag
 *   ALL  /mcp
 */

import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { AgentRegistry } from "../agent/agent-registry.ts";
import type { AgentDefinition } from "../agent/definition.ts";
import type { StateStore } from "../agent/store.ts";
import { MemoryStateStore } from "../agent/store.ts";
import type { BackendType } from "../backends/types.ts";
import {
  CONFIG_DIR,
  DEFAULT_PORT,
  writeDaemonInfo,
  removeDaemonInfo,
  isDaemonRunning,
} from "./registry.ts";
import { WorkspaceRegistry } from "./workspace-registry.ts";
import { startHttpServer, type ServerHandle } from "./serve.ts";
import { createContextMCPServer } from "../workflow/context/mcp/server.ts";
import {
  createFileContextProvider,
  getDefaultContextDir,
} from "../workflow/context/file-provider.ts";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import type { AgentLoop } from "../workflow/loop/types.ts";
import type { ContextProvider } from "../workflow/context/provider.ts";
import type { Context } from "hono";
import type { ParsedWorkflow, ResolvedWorkflowAgent } from "../workflow/types.ts";
import { createMinimalRuntime, createWiredLoop, type Workspace } from "../workflow/factory.ts";
import type { Logger } from "../workflow/logger.ts";
import { createEventLogger, createSilentLogger } from "../workflow/logger.ts";
import { DaemonEventLog } from "./event-log.ts";

// ── Types ──────────────────────────────────────────────────────────

/** Handle for a running workflow managed by the daemon */
export interface WorkflowHandle {
  /** Workflow name (from YAML name field or filename) */
  name: string;
  /** Workflow instance tag */
  tag: string;
  /** Key for lookup: "name:tag" */
  key: string;
  /** Agent names in this workflow */
  agents: string[];
  /** Agent loops for lifecycle management */
  loops: Map<string, AgentLoop>;
  /** Workspace providing shared infrastructure */
  workspace: Workspace;
  /** Shutdown function (stops loops + cleans context) */
  shutdown: () => Promise<void>;
  /** Original workflow file path (for display) */
  workflowPath?: string;
  /** When this workflow was started */
  startedAt: string;
}

export interface DaemonState {
  /** Agent registry — manages agent handles (definition + loop + state) */
  agents: AgentRegistry;
  /** Workspace registry — active workspaces (shared infrastructure) */
  workspaces: WorkspaceRegistry;
  /** Running workflows — keyed by "name:tag" */
  workflows: Map<string, WorkflowHandle>;
  /** State store — conversation persistence (pluggable) */
  store: StateStore;
  /** HTTP server handle (optional — missing when app is used without server) */
  server?: ServerHandle;
  port: number;
  host: string;
  startedAt: string;
}

// ── Module state ───────────────────────────────────────────────────

let state: DaemonState | null = null;
let shuttingDown = false;
let log: Logger = createSilentLogger();

const mcpSessions = new Map<
  string,
  { transport: WebStandardStreamableHTTPServerTransport; agentId: string }
>();

// ── Shutdown ───────────────────────────────────────────────────────

async function gracefulShutdown(): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;

  if (state) {
    // Stop all agent-owned loops
    for (const handle of state.agents.list()) {
      if (handle.loop) {
        try {
          await handle.loop.stop();
        } catch {
          /* best-effort */
        }
        handle.loop = null;
      }
    }

    // Stop all workflows (workflow-scoped loops + context)
    for (const [, wf] of state.workflows) {
      try {
        await wf.shutdown();
      } catch {
        /* best-effort */
      }
    }
    state.workflows.clear();

    // Shutdown all workspaces (MCP servers, context providers)
    await state.workspaces.shutdownAll();

    if (state.server) {
      await state.server.close();
    }
  }

  for (const [, session] of mcpSessions) {
    try {
      await session.transport.close();
    } catch {
      /* best-effort */
    }
  }
  mcpSessions.clear();

  removeDaemonInfo();
  process.exit(0);
}

// ── Helpers ────────────────────────────────────────────────────────

/** Safe JSON body parsing — returns null on malformed input */
async function parseJsonBody(c: { req: { json: () => Promise<unknown> } }): Promise<unknown> {
  try {
    return await c.req.json();
  } catch {
    return null;
  }
}

// ── Agent → Loop bridge ───────────────────────────────────────────

/** Map AgentDefinition to the ResolvedWorkflowAgent type needed by the factory */
function defToResolvedAgent(def: AgentDefinition): ResolvedWorkflowAgent {
  return {
    backend: def.backend as ResolvedWorkflowAgent["backend"],
    model: def.model,
    provider: def.provider,
    resolvedSystemPrompt: def.prompt.system ?? "",
    schedule: def.schedule,
  };
}

/**
 * Find an agent's loop.
 * First checks the agent handle (standalone agents own their loop),
 * then falls back to workflow-scoped loops (workflow agents).
 */
function findLoop(s: DaemonState, agentName: string): AgentLoop | null {
  // Check agent handle first (standalone agents)
  const handle = s.agents.get(agentName);
  if (handle?.loop) return handle.loop;

  // Fall back to workflow-scoped loops
  for (const wf of s.workflows.values()) {
    const l = wf.loops.get(agentName);
    if (l) return l;
  }
  return null;
}

/** Build a workspace key for standalone agents */
function agentWorkspaceKey(agentName: string): string {
  return `agent:${agentName}`;
}

/**
 * Ensure a standalone agent has a loop + workspace.
 * Creates the infrastructure lazily on first call (starts MCP server, etc.).
 *
 * The loop is stored on the AgentHandle.
 * The workspace is stored in the WorkspaceRegistry.
 *
 * This is the bridge between POST /agents (stores definition only) and
 * POST /run or /serve (needs a loop to execute).
 */
async function ensureAgentLoop(s: DaemonState, agentName: string): Promise<AgentLoop> {
  // Check if loop already exists
  const existing = findLoop(s, agentName);
  if (existing) return existing;

  // Need to create: get handle
  const handle = s.agents.get(agentName);
  if (!handle) throw new Error(`Agent not found: ${agentName}`);

  const agentDef = defToResolvedAgent(handle.definition);
  const wsKey = agentWorkspaceKey(agentName);

  // Create workspace (context + MCP server)
  const workspace = await createMinimalRuntime({
    workflowName: "global",
    tag: "main",
    agentNames: [agentName],
  });

  // Create wired loop (backend + workspace dir).
  // If this fails, clean up the workspace we just created.
  let loop: AgentLoop;
  try {
    ({ loop } = createWiredLoop({
      name: agentName,
      agent: agentDef,
      runtime: workspace,
      conversationLog: handle.conversationLog ?? undefined,
      thinThread: handle.thinThread,
    }));
  } catch (err) {
    await workspace.shutdown();
    throw err;
  }

  // Store loop on the agent handle (agent owns its loop)
  handle.loop = loop;

  // Store workspace in registry
  s.workspaces.set(wsKey, workspace);

  return loop;
}

// ── App Factory ──────────────────────────────────────────────────

/** Options for createDaemonApp */
export interface DaemonAppOptions {
  /** State getter — returns current DaemonState or null if not ready */
  getState: () => DaemonState | null;
  /** Auth token — when set, all requests must include `Authorization: Bearer <token>` */
  token?: string;
}

/**
 * Create the Hono app with all daemon routes.
 *
 * Accepts a state getter so the app can be used both in production
 * (module-level state set by startDaemon) and in tests (injected state).
 *
 * When a token is provided, all endpoints require `Authorization: Bearer <token>`.
 * This prevents cross-origin attacks from malicious websites.
 */
export function createDaemonApp(options: DaemonAppOptions): Hono {
  const { getState, token } = options;

  const app = new Hono();

  // Auth middleware — reject requests without valid token
  if (token) {
    app.use("*", async (c, next) => {
      const auth = c.req.header("authorization");
      if (auth !== `Bearer ${token}`) {
        return c.json({ error: "Unauthorized" }, 401);
      }
      await next();
    });
  }

  // ── GET /health ──────────────────────────────────────────────

  app.get("/health", (c) => {
    const s = getState();
    if (!s) return c.json({ status: "unavailable" }, 503);

    // Collect agent names from registry
    const agentNames = s.agents.list().map((h) => h.name);
    const workflowList = [...s.workflows.values()].map((wf) => ({
      name: wf.name,
      tag: wf.tag,
      agents: wf.agents,
    }));

    return c.json({
      status: "ok",
      pid: process.pid,
      port: s.port,
      uptime: Date.now() - new Date(s.startedAt).getTime(),
      agents: agentNames,
      workflows: workflowList,
    });
  });

  // ── POST /shutdown ───────────────────────────────────────────

  app.post("/shutdown", (c) => {
    setImmediate(() => gracefulShutdown());
    return c.json({ success: true });
  });

  // ── GET /agents ──────────────────────────────────────────────

  app.get("/agents", (c) => {
    const s = getState();
    if (!s) return c.json({ error: "Not ready" }, 503);

    // Standalone agents (from registry)
    const standaloneAgents = s.agents.list().map((handle) => {
      const def = handle.definition;
      return {
        name: def.name,
        model: def.model,
        backend: def.backend ?? "default",
        workflow: undefined as string | undefined,
        tag: undefined as string | undefined,
        createdAt: handle.ephemeral ? undefined : undefined,
        source: "standalone" as const,
        state: handle.loop?.state,
      };
    });

    // Workflow agents (from running workflows)
    const workflowAgents = [...s.workflows.values()].flatMap((wf) =>
      wf.agents.map((agentName) => {
        const loop = wf.loops.get(agentName);
        return {
          name: agentName,
          model: "",
          backend: "",
          workflow: wf.name,
          tag: wf.tag,
          createdAt: wf.startedAt,
          source: "workflow" as const,
          state: loop?.state ?? "unknown",
        };
      }),
    );

    return c.json({ agents: [...standaloneAgents, ...workflowAgents] });
  });

  // ── POST /agents ─────────────────────────────────────────────

  app.post("/agents", async (c) => {
    const s = getState();
    if (!s) return c.json({ error: "Not ready" }, 503);

    const body = await parseJsonBody(c);
    if (!body || typeof body !== "object") return c.json({ error: "Invalid JSON body" }, 400);
    const {
      name,
      model,
      system,
      backend = "default",
      provider,
      workflow,
      tag,
      schedule,
    } = body as {
      name: string;
      model: string;
      system: string;
      backend?: BackendType;
      provider?: string | { name: string; base_url?: string; api_key?: string };
      workflow?: string;
      tag?: string;
      schedule?: { wakeup: string | number; prompt?: string };
    };

    if (!name || !model || !system) {
      return c.json({ error: "name, model, system required" }, 400);
    }
    if (s.agents.has(name)) {
      return c.json({ error: `Agent already exists: ${name}` }, 409);
    }

    // Convert API params to AgentDefinition
    const def: AgentDefinition = {
      name,
      model,
      backend: backend as AgentDefinition["backend"],
      provider,
      prompt: { system },
      schedule,
    };

    // Register as ephemeral (no YAML file, no context dir)
    s.agents.registerEphemeral(def);

    return c.json({ name, model, backend, workflow, tag, schedule }, 201);
  });

  // ── GET /agents/:name ────────────────────────────────────────

  app.get("/agents/:name", (c) => {
    const s = getState();
    if (!s) return c.json({ error: "Not ready" }, 503);
    const handle = s.agents.get(c.req.param("name"));
    if (!handle) return c.json({ error: "Agent not found" }, 404);
    const def = handle.definition;
    return c.json({
      name: def.name,
      model: def.model,
      backend: def.backend ?? "default",
      system: def.prompt.system,
      workflow: undefined,
      tag: undefined,
      createdAt: undefined,
      schedule: def.schedule,
    });
  });

  // ── DELETE /agents/:name ─────────────────────────────────────

  app.delete("/agents/:name", async (c) => {
    const s = getState();
    if (!s) return c.json({ error: "Not ready" }, 503);
    const name = c.req.param("name");

    const handle = s.agents.get(name);
    if (!handle) {
      return c.json({ error: "Agent not found" }, 404);
    }

    // Clean up agent-owned loop
    if (handle.loop) {
      try {
        await handle.loop.stop();
      } catch {
        /* best-effort */
      }
      handle.loop = null;
    }

    // Clean up agent's workspace
    const wsKey = agentWorkspaceKey(name);
    const ws = s.workspaces.get(wsKey);
    if (ws) {
      try {
        await ws.shutdown();
      } catch {
        /* best-effort */
      }
      s.workspaces.delete(wsKey);
    }

    // Remove from registry
    s.agents.delete(name);

    return c.json({ success: true });
  });

  // ── POST /run (SSE stream) ──────────────────────────────────

  app.post("/run", async (c) => {
    const s = getState();
    if (!s) return c.json({ error: "Not ready" }, 503);

    const body = await parseJsonBody(c);
    if (!body || typeof body !== "object") return c.json({ error: "Invalid JSON body" }, 400);
    const { agent: agentName, message } = body as {
      agent: string;
      message: string;
    };

    if (!agentName || !message) {
      return c.json({ error: "agent and message required" }, 400);
    }

    // Find or create a loop for this agent
    let loop: AgentLoop | undefined;
    const existingLoop = findLoop(s, agentName);

    if (existingLoop) {
      loop = existingLoop;
    } else if (s.agents.has(agentName)) {
      // Lazy creation: agent has a handle but no loop yet
      try {
        loop = await ensureAgentLoop(s, agentName);
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        return c.json({ error: `Failed to create agent runtime: ${msg}` }, 500);
      }
    }

    if (!loop) {
      return c.json({ error: `Agent not found: ${agentName}` }, 404);
    }

    const agentLoop = loop;
    return streamSSE(c, async (stream) => {
      try {
        const result = await agentLoop.sendDirect(message);
        if (result.success) {
          if (result.content) {
            await stream.writeSSE({
              event: "chunk",
              data: JSON.stringify({ agent: agentName, text: result.content }),
            });
          }
          await stream.writeSSE({
            event: "done",
            data: JSON.stringify(result),
          });
        } else {
          await stream.writeSSE({
            event: "error",
            data: JSON.stringify({ error: result.error }),
          });
        }
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        await stream.writeSSE({
          event: "error",
          data: JSON.stringify({ error: msg }),
        });
      }
    });
  });

  // ── POST /serve (sync JSON) ─────────────────────────────────

  app.post("/serve", async (c) => {
    const s = getState();
    if (!s) return c.json({ error: "Not ready" }, 503);

    const body = await parseJsonBody(c);
    if (!body || typeof body !== "object") return c.json({ error: "Invalid JSON body" }, 400);
    const { agent: agentName, message } = body as {
      agent: string;
      message: string;
    };

    if (!agentName || !message) {
      return c.json({ error: "agent and message required" }, 400);
    }

    // Find or create a loop for this agent
    let loop: AgentLoop | undefined;
    const existingLoop = findLoop(s, agentName);

    if (existingLoop) {
      loop = existingLoop;
    } else if (s.agents.has(agentName)) {
      // Lazy creation: handle exists but no loop yet
      try {
        loop = await ensureAgentLoop(s, agentName);
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        return c.json({ error: msg }, 500);
      }
    }

    if (!loop) {
      return c.json({ error: `Agent not found: ${agentName}` }, 404);
    }

    try {
      const result = await loop.sendDirect(message);
      if (!result.success) {
        return c.json({ error: result.error }, 500);
      }
      return c.json({
        content: result.content ?? "",
        duration: result.duration,
        success: true,
      });
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      return c.json({ error: msg }, 500);
    }
  });

  // ── ALL /mcp (unified MCP endpoint) ─────────────────────────

  app.all("/mcp", async (c) => {
    const s = getState();
    if (!s) return c.json({ error: "Not ready" }, 503);

    const req = c.req.raw;
    const sessionId = req.headers.get("mcp-session-id");

    if (sessionId && mcpSessions.has(sessionId)) {
      const session = mcpSessions.get(sessionId)!;
      if (req.method === "DELETE") {
        await session.transport.close();
        mcpSessions.delete(sessionId);
        return new Response(null, { status: 200 });
      }
      return session.transport.handleRequest(req);
    }

    if (req.method === "POST") {
      const body = await req.json();
      const isInit = Array.isArray(body)
        ? body.some((m: { method?: string }) => m?.method === "initialize")
        : (body as { method?: string })?.method === "initialize";

      if (!isInit) {
        return c.json({ error: "Bad request: session required" }, 400);
      }

      const url = new URL(req.url);
      const agentName = url.searchParams.get("agent") || "user";

      // Look up agent's workspace context provider when available
      const handle = s.agents.get(agentName);
      const wsKey = agentWorkspaceKey(agentName);
      const existingWs = s.workspaces.get(wsKey);

      const allNames = [...new Set([agentName, "user"])];

      const provider: ContextProvider =
        existingWs?.contextProvider ??
        (() => {
          const contextDir = getDefaultContextDir("global", "main");
          mkdirSync(contextDir, { recursive: true });
          return createFileContextProvider(contextDir, allNames);
        })();

      const transport = new WebStandardStreamableHTTPServerTransport({
        sessionIdGenerator: () => `${agentName}-${randomUUID().slice(0, 8)}`,
        onsessioninitialized: (sid: string) => {
          mcpSessions.set(sid, { transport, agentId: agentName });
        },
        onsessionclosed: (sid: string) => {
          mcpSessions.delete(sid);
        },
        enableJsonResponse: true,
      });

      const mcpServer = createContextMCPServer({
        provider,
        validAgents: allNames,
        name: `${handle?.definition.name ?? agentName}-context`,
        version: "1.0.0",
      }).server;

      await mcpServer.connect(transport);
      return transport.handleRequest(req, { parsedBody: body });
    }

    if (req.method === "GET") {
      return c.json({ error: "Session ID required for GET requests" }, 400);
    }

    return c.json({ error: "Method not allowed" }, 405);
  });

  // ── POST /workflows (start a workflow) ──────────────────────

  app.post("/workflows", async (c) => {
    const s = getState();
    if (!s) return c.json({ error: "Not ready" }, 503);

    const body = await parseJsonBody(c);
    if (!body || typeof body !== "object") return c.json({ error: "Invalid JSON body" }, 400);
    const {
      workflow,
      tag = "main",
      feedback,
      pollInterval,
      params,
    } = body as {
      workflow: ParsedWorkflow;
      tag?: string;
      feedback?: boolean;
      pollInterval?: number;
      params?: Record<string, string>;
    };

    if (!workflow || !workflow.agents) {
      return c.json({ error: "workflow (parsed YAML) required" }, 400);
    }

    const workflowName = workflow.name || "global";
    const key = `${workflowName}:${tag}`;

    if (s.workflows.has(key)) {
      return c.json({ error: `Workflow already running: ${key}` }, 409);
    }

    try {
      const { runWorkflowWithLoops } = await import("../workflow/runner.ts");

      const result = await runWorkflowWithLoops({
        workflow,
        workflowName,
        tag,
        mode: "start",
        headless: true,
        feedback,
        pollInterval,
        params,
        log: () => {}, // Silent — daemon doesn't output to terminal
      });

      if (!result.success) {
        return c.json({ error: result.error || "Workflow failed to start" }, 500);
      }

      // Create a Workspace-compatible object from the runner result
      const workspace: Workspace = {
        contextProvider: result.contextProvider!,
        contextDir: "",
        persistent: false,
        eventLog: null as any, // Not available from runner result
        httpMcpServer: null as any,
        mcpUrl: result.mcpUrl ?? "",
        mcpToolNames: new Set(),
        projectDir: process.cwd(),
        shutdown: result.shutdown!,
      };

      const handle: WorkflowHandle = {
        name: workflowName,
        tag,
        key,
        agents: Object.keys(workflow.agents),
        loops: result.loops!,
        workspace,
        shutdown: result.shutdown!,
        workflowPath: workflow.filePath,
        startedAt: new Date().toISOString(),
      };

      s.workflows.set(key, handle);

      return c.json(
        {
          key,
          name: workflowName,
          tag,
          agents: handle.agents,
        },
        201,
      );
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      return c.json({ error: `Failed to start workflow: ${msg}` }, 500);
    }
  });

  // ── GET /workflows ────────────────────────────────────────────

  app.get("/workflows", (c) => {
    const s = getState();
    if (!s) return c.json({ error: "Not ready" }, 503);

    const workflows = [...s.workflows.values()].map((wf) => {
      const agentStates: Record<string, string> = {};
      for (const [name, loop] of wf.loops) {
        agentStates[name] = loop.state;
      }
      return {
        name: wf.name,
        tag: wf.tag,
        key: wf.key,
        agents: wf.agents,
        agentStates,
        workflowPath: wf.workflowPath,
        startedAt: wf.startedAt,
      };
    });

    return c.json({ workflows });
  });

  // ── DELETE /workflows/:name/:tag ──────────────────────────────

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async function deleteWorkflow(c: Context<any, any, any>, name: string, tag: string) {
    const s = getState();
    if (!s) return c.json({ error: "Not ready" }, 503);

    const key = `${name}:${tag}`;
    const handle = s.workflows.get(key);
    if (!handle) {
      return c.json({ error: `Workflow not found: ${key}` }, 404);
    }

    try {
      await handle.shutdown();
      s.workflows.delete(key);
      return c.json({ success: true, key });
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      return c.json({ error: `Failed to stop workflow: ${msg}` }, 500);
    }
  }

  app.delete("/workflows/:name/:tag", (c) =>
    deleteWorkflow(c, c.req.param("name"), c.req.param("tag")),
  );

  // Convenience: DELETE /workflows/:name (defaults tag to "main")
  app.delete("/workflows/:name", (c) => deleteWorkflow(c, c.req.param("name"), "main"));

  return app;
}

// ── Daemon Entry Point ─────────────────────────────────────────────

export async function startDaemon(
  config: {
    port?: number;
    host?: string;
    store?: StateStore;
  } = {},
): Promise<void> {
  // Initialize daemon event log + logger
  const daemonEventLog = new DaemonEventLog(CONFIG_DIR);
  log = createEventLogger(daemonEventLog, "daemon");

  const existing = isDaemonRunning();
  if (existing) {
    log.error(`Daemon already running: pid=${existing.pid} port=${existing.port}`);
    process.exit(1);
  }

  const host = config.host ?? "127.0.0.1";
  const store = config.store ?? new MemoryStateStore();
  const token = randomUUID();

  const app = createDaemonApp({ getState: () => state, token });

  // ── Start HTTP server ────────────────────────────────────────

  const server = await startHttpServer(app, {
    port: config.port ?? DEFAULT_PORT,
    hostname: host,
  });

  const actualPort = server.port;
  const startedAt = new Date().toISOString();

  writeDaemonInfo({
    pid: process.pid,
    host,
    port: actualPort,
    startedAt,
    token,
  });

  state = {
    agents: new AgentRegistry(process.cwd(), log),
    workspaces: new WorkspaceRegistry(),
    workflows: new Map(),
    store,
    server,
    port: actualPort,
    host,
    startedAt,
  };

  log.info(`Daemon started: pid=${process.pid}`);
  log.info(`Listening: http://${host}:${actualPort}`);
  log.info(`MCP: http://${host}:${actualPort}/mcp`);

  process.on("SIGINT", () => {
    log.info("Shutting down...");
    gracefulShutdown();
  });

  process.on("SIGTERM", () => {
    log.info("Shutting down...");
    gracefulShutdown();
  });
}
