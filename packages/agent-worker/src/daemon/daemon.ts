/**
 * Daemon — Centralized agent coordinator.
 *
 * Data ownership:
 *   Registry (configs)  — what agents exist and their configuration
 *   StateStore (store)  — conversation history and usage (pluggable)
 *   WorkerHandle (workers) — execution, local or remote
 *
 * The daemon is pure glue: receive request → lookup config →
 * dispatch to worker → persist state → return response.
 *
 * 9 HTTP endpoints:
 *   GET  /health, POST /shutdown
 *   GET/POST /agents, GET/DELETE /agents/:name
 *   POST /run (SSE), POST /serve
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

// ── Types ──────────────────────────────────────────────────────────

export interface DaemonState {
  /** Agent configs — the registry (what agents exist) */
  configs: Map<string, AgentConfig>;
  /** Worker handles — the execution layer (how to talk to agents) */
  workers: Map<string, WorkerHandle>;
  /** State store — conversation persistence (pluggable) */
  store: StateStore;
  /** HTTP server handle */
  server: ServerHandle;
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
    // Persist all agent states before stopping
    for (const [name, handle] of state.workers) {
      try {
        await state.store.save(name, handle.getState());
      } catch { /* best-effort */ }
    }
    await state.server.close();
  }

  for (const [, session] of mcpSessions) {
    try { await session.transport.close(); } catch { /* best-effort */ }
  }
  mcpSessions.clear();

  removeDaemonInfo();
  process.exit(0);
}

// ── Helpers ────────────────────────────────────────────────────────

function getWorkflowAgentNames(workflow: string, tag: string): string[] {
  if (!state) return [];
  return [...state.configs.values()]
    .filter((c) => c.workflow === workflow && c.tag === tag)
    .map((c) => c.name);
}

// ── Daemon Entry Point ─────────────────────────────────────────────

export async function startDaemon(config: {
  port?: number;
  host?: string;
  store?: StateStore;
} = {}): Promise<void> {
  const existing = isDaemonRunning();
  if (existing) {
    console.error(`Daemon already running: pid=${existing.pid} port=${existing.port}`);
    process.exit(1);
  }

  const host = config.host ?? "127.0.0.1";
  const store = config.store ?? new MemoryStateStore();
  const app = new Hono();
  app.use("*", cors());

  // ── GET /health ──────────────────────────────────────────────

  app.get("/health", (c) => {
    if (!state) return c.json({ status: "unavailable" }, 503);
    return c.json({
      status: "ok",
      pid: process.pid,
      port: state.port,
      uptime: Date.now() - new Date(state.startedAt).getTime(),
      agents: [...state.configs.keys()],
    });
  });

  // ── POST /shutdown ───────────────────────────────────────────

  app.post("/shutdown", (c) => {
    setImmediate(() => gracefulShutdown());
    return c.json({ success: true });
  });

  // ── GET /agents ──────────────────────────────────────────────

  app.get("/agents", (c) => {
    if (!state) return c.json({ error: "Not ready" }, 503);
    const agents = [...state.configs.values()].map((c) => ({
      name: c.name,
      model: c.model,
      backend: c.backend,
      workflow: c.workflow,
      tag: c.tag,
      createdAt: c.createdAt,
    }));
    return c.json({ agents });
  });

  // ── POST /agents ─────────────────────────────────────────────

  app.post("/agents", async (c) => {
    if (!state) return c.json({ error: "Not ready" }, 503);

    const body = await c.req.json();
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
    if (state.configs.has(name)) {
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
    const savedState = await state.store.load(name);
    const handle = new LocalWorker(agentConfig, savedState ?? undefined);

    state.configs.set(name, agentConfig);
    state.workers.set(name, handle);

    return c.json({ name, model, backend, workflow, tag }, 201);
  });

  // ── GET /agents/:name ────────────────────────────────────────

  app.get("/agents/:name", (c) => {
    if (!state) return c.json({ error: "Not ready" }, 503);
    const cfg = state.configs.get(c.req.param("name"));
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
    if (!state) return c.json({ error: "Not ready" }, 503);
    const name = c.req.param("name");

    if (!state.configs.delete(name)) {
      return c.json({ error: "Agent not found" }, 404);
    }

    // Persist final state before removing worker
    const handle = state.workers.get(name);
    if (handle) {
      try { await state.store.save(name, handle.getState()); } catch { /* best-effort */ }
    }
    state.workers.delete(name);

    return c.json({ success: true });
  });

  // ── POST /run (SSE stream) ──────────────────────────────────

  app.post("/run", async (c) => {
    if (!state) return c.json({ error: "Not ready" }, 503);

    const body = await c.req.json();
    const { agent: agentName, message } = body as {
      agent: string;
      message: string;
    };

    if (!agentName || !message) {
      return c.json({ error: "agent and message required" }, 400);
    }

    const handle = state.workers.get(agentName);
    if (!handle) return c.json({ error: `Agent not found: ${agentName}` }, 404);

    return streamSSE(c, async (stream) => {
      try {
        const gen = handle.sendStream(message);
        while (true) {
          const { value, done } = await gen.next();
          if (done) {
            // Persist state after execution
            if (state) {
              await state.store.save(agentName, handle.getState());
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
    if (!state) return c.json({ error: "Not ready" }, 503);

    const body = await c.req.json();
    const { agent: agentName, message } = body as {
      agent: string;
      message: string;
    };

    if (!agentName || !message) {
      return c.json({ error: "agent and message required" }, 400);
    }

    const handle = state.workers.get(agentName);
    if (!handle) return c.json({ error: `Agent not found: ${agentName}` }, 404);

    try {
      const response = await handle.send(message);

      // Persist state after execution
      await state.store.save(agentName, handle.getState());

      return c.json(response);
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      return c.json({ error: msg }, 500);
    }
  });

  // ── ALL /mcp (unified MCP endpoint) ─────────────────────────

  app.all("/mcp", async (c) => {
    if (!state) return c.json({ error: "Not ready" }, 503);

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

      const agentCfg = state.configs.get(agentName);
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
