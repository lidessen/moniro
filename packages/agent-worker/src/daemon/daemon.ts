/**
 * Daemon — Centralized agent coordinator.
 *
 * Data ownership:
 *   Registry (configs)  — what agents exist and their configuration
 *   StateStore (store)  — conversation history and usage (pluggable)
 *   WorkerHandle (workers) — execution, local or remote
 *   Workflows (workflows) — running workflow instances with controllers
 *
 * The daemon is pure glue: receive request → lookup config →
 * dispatch to worker → persist state → return response.
 *
 * HTTP endpoints:
 *   GET  /health, POST /shutdown
 *   GET/POST /agents, GET/DELETE /agents/:name
 *   POST /run (SSE), POST /serve
 *   GET/POST /workflows, DELETE /workflows/:name/:tag
 *   ALL  /mcp
 */

import { Hono } from "hono";
import { cors } from "hono/cors";
import { streamSSE } from "hono/streaming";
import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import type { AgentConfig } from "../agent/config.ts";
import type { WorkerHandle } from "../agent/handle.ts";
import { LocalWorker } from "../agent/handle.ts";
import type { StateStore } from "../agent/store.ts";
import { MemoryStateStore } from "../agent/store.ts";
import type { BackendType } from "../backends/types.ts";
import { DEFAULT_PORT, writeDaemonInfo, removeDaemonInfo, isDaemonRunning } from "./registry.ts";
import { startHttpServer, type ServerHandle } from "./serve.ts";
import { createContextMCPServer } from "../workflow/context/mcp/server.ts";
import {
  createFileContextProvider,
  getDefaultContextDir,
} from "../workflow/context/file-provider.ts";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import type { AgentController } from "../workflow/controller/types.ts";
import type { ContextProvider } from "../workflow/context/provider.ts";
import type { Context } from "hono";
import type { ParsedWorkflow } from "../workflow/types.ts";

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
  /** Agent controllers for lifecycle management */
  controllers: Map<string, AgentController>;
  /** Context provider for shared state */
  contextProvider: ContextProvider;
  /** Shutdown function (stops controllers + cleans context) */
  shutdown: () => Promise<void>;
  /** Original workflow file path (for display) */
  workflowPath?: string;
  /** When this workflow was started */
  startedAt: string;
}

export interface DaemonState {
  /** Agent configs — the registry (what agents exist) */
  configs: Map<string, AgentConfig>;
  /** Worker handles — the execution layer (how to talk to agents) */
  workers: Map<string, WorkerHandle>;
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

const mcpSessions = new Map<
  string,
  { transport: WebStandardStreamableHTTPServerTransport; agentId: string }
>();

// ── Shutdown ───────────────────────────────────────────────────────

async function gracefulShutdown(): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;

  if (state) {
    // Stop all workflows
    for (const [, wf] of state.workflows) {
      try {
        await wf.shutdown();
      } catch {
        /* best-effort */
      }
    }
    state.workflows.clear();

    // Persist all agent states before stopping
    for (const [name, handle] of state.workers) {
      try {
        await state.store.save(name, handle.getState());
      } catch {
        /* best-effort */
      }
    }
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

// ── App Factory ──────────────────────────────────────────────────

/**
 * Create the Hono app with all daemon routes.
 *
 * Accepts a state getter so the app can be used both in production
 * (module-level state set by startDaemon) and in tests (injected state).
 */
export function createDaemonApp(getState: () => DaemonState | null): Hono {
  const app = new Hono();
  app.use("*", cors());

  function getWorkflowAgentNames(workflow: string, tag: string): string[] {
    const s = getState();
    if (!s) return [];
    return [...s.configs.values()]
      .filter((c) => c.workflow === workflow && c.tag === tag)
      .map((c) => c.name);
  }

  // ── GET /health ──────────────────────────────────────────────

  app.get("/health", (c) => {
    const s = getState();
    if (!s) return c.json({ status: "unavailable" }, 503);

    // Collect all agent names: standalone + workflow agents
    const standaloneAgents = [...s.configs.keys()];
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
      agents: standaloneAgents,
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

    // Standalone agents (from `new` command, registered in @global or named workflow)
    const standaloneAgents = [...s.configs.values()].map((cfg) => ({
      name: cfg.name,
      model: cfg.model,
      backend: cfg.backend,
      workflow: cfg.workflow,
      tag: cfg.tag,
      createdAt: cfg.createdAt,
      source: "standalone" as const,
    }));

    // Workflow agents (from `start` command)
    const workflowAgents = [...s.workflows.values()].flatMap((wf) =>
      wf.agents.map((agentName) => {
        const controller = wf.controllers.get(agentName);
        return {
          name: agentName,
          model: "", // workflow agents don't expose model at this level
          backend: "",
          workflow: wf.name,
          tag: wf.tag,
          createdAt: wf.startedAt,
          source: "workflow" as const,
          state: controller?.state ?? "unknown",
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
      workflow = "global",
      tag = "main",
    } = body as {
      name: string;
      model: string;
      system: string;
      backend?: BackendType;
      workflow?: string;
      tag?: string;
    };

    if (!name || !model || !system) {
      return c.json({ error: "name, model, system required" }, 400);
    }
    if (s.configs.has(name)) {
      return c.json({ error: `Agent already exists: ${name}` }, 409);
    }

    // Config — pure data
    const agentConfig: AgentConfig = {
      name,
      model,
      system,
      backend,
      workflow,
      tag,
      createdAt: new Date().toISOString(),
    };

    // Worker — execution handle (restore from store if available)
    const savedState = await s.store.load(name);
    const handle = new LocalWorker(agentConfig, savedState ?? undefined);

    s.configs.set(name, agentConfig);
    s.workers.set(name, handle);

    return c.json({ name, model, backend, workflow, tag }, 201);
  });

  // ── GET /agents/:name ────────────────────────────────────────

  app.get("/agents/:name", (c) => {
    const s = getState();
    if (!s) return c.json({ error: "Not ready" }, 503);
    const cfg = s.configs.get(c.req.param("name"));
    if (!cfg) return c.json({ error: "Agent not found" }, 404);
    return c.json({
      name: cfg.name,
      model: cfg.model,
      backend: cfg.backend,
      system: cfg.system,
      workflow: cfg.workflow,
      tag: cfg.tag,
      createdAt: cfg.createdAt,
    });
  });

  // ── DELETE /agents/:name ─────────────────────────────────────

  app.delete("/agents/:name", async (c) => {
    const s = getState();
    if (!s) return c.json({ error: "Not ready" }, 503);
    const name = c.req.param("name");

    if (!s.configs.delete(name)) {
      return c.json({ error: "Agent not found" }, 404);
    }

    // Persist final state before removing worker
    const handle = s.workers.get(name);
    if (handle) {
      try {
        await s.store.save(name, handle.getState());
      } catch {
        /* best-effort */
      }
    }
    s.workers.delete(name);

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

    const handle = s.workers.get(agentName);
    if (!handle) return c.json({ error: `Agent not found: ${agentName}` }, 404);

    return streamSSE(c, async (stream) => {
      try {
        const gen = handle.sendStream(message);
        while (true) {
          const { value, done } = await gen.next();
          if (done) {
            // Persist state after execution
            const currentState = getState();
            if (currentState) {
              await currentState.store.save(agentName, handle.getState());
            }
            await stream.writeSSE({
              event: "done",
              data: JSON.stringify(value),
            });
            break;
          }
          await stream.writeSSE({
            event: "chunk",
            data: JSON.stringify({ agent: agentName, text: value }),
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

    const handle = s.workers.get(agentName);
    if (!handle) return c.json({ error: `Agent not found: ${agentName}` }, 404);

    try {
      const response = await handle.send(message);

      // Persist state after execution
      await s.store.save(agentName, handle.getState());

      return c.json(response);
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

      const agentCfg = s.configs.get(agentName);
      const workflow = agentCfg?.workflow ?? "global";
      const tag = agentCfg?.tag ?? "main";

      const workflowAgents = getWorkflowAgentNames(workflow, tag);
      const allNames = [...new Set([...workflowAgents, agentName, "user"])];

      const contextDir = getDefaultContextDir(workflow, tag);
      mkdirSync(contextDir, { recursive: true });
      const provider = createFileContextProvider(contextDir, allNames);

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
        name: `${workflow}-context`,
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
    } = body as {
      workflow: ParsedWorkflow;
      tag?: string;
      feedback?: boolean;
      pollInterval?: number;
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
      const { runWorkflowWithControllers } = await import("../workflow/runner.ts");

      const result = await runWorkflowWithControllers({
        workflow,
        workflowName,
        tag,
        mode: "start",
        headless: true,
        feedback,
        pollInterval,
        log: () => {}, // Silent — daemon doesn't output to terminal
      });

      if (!result.success) {
        return c.json({ error: result.error || "Workflow failed to start" }, 500);
      }

      const handle: WorkflowHandle = {
        name: workflowName,
        tag,
        key,
        agents: Object.keys(workflow.agents),
        controllers: result.controllers!,
        contextProvider: result.contextProvider!,
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
      for (const [name, controller] of wf.controllers) {
        agentStates[name] = controller.state;
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
  const existing = isDaemonRunning();
  if (existing) {
    console.error(`Daemon already running: pid=${existing.pid} port=${existing.port}`);
    process.exit(1);
  }

  const host = config.host ?? "127.0.0.1";
  const store = config.store ?? new MemoryStateStore();

  const app = createDaemonApp(() => state);

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
  });

  state = {
    configs: new Map(),
    workers: new Map(),
    workflows: new Map(),
    store,
    server,
    port: actualPort,
    host,
    startedAt,
  };

  console.log(`Daemon started: pid=${process.pid}`);
  console.log(`Listening: http://${host}:${actualPort}`);
  console.log(`MCP: http://${host}:${actualPort}/mcp`);

  process.on("SIGINT", () => {
    console.log("\nShutting down...");
    gracefulShutdown();
  });

  process.on("SIGTERM", () => {
    gracefulShutdown();
  });
}
