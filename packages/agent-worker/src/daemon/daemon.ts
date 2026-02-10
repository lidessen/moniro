/**
 * Daemon — Single long-lived process managing multiple agents.
 *
 * 9 HTTP endpoints:
 *   GET  /health          — daemon status
 *   POST /shutdown        — graceful shutdown
 *   GET  /agents          — list agents
 *   POST /agents          — create agent
 *   GET  /agents/:name    — agent info
 *   DELETE /agents/:name  — remove agent
 *   POST /run             — send message → SSE stream
 *   POST /serve           — send message → sync JSON
 *   ALL  /mcp             — unified MCP endpoint
 */

import { Hono } from "hono";
import { cors } from "hono/cors";
import { streamSSE } from "hono/streaming";
import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { AgentWorker } from "../agent/worker.ts";
import type { BackendType } from "../backends/types.ts";
import { createBackend } from "../backends/index.ts";
import { DEFAULT_PORT, writeDaemonInfo, removeDaemonInfo, isDaemonRunning } from "./registry.ts";
import { createContextMCPServer } from "../workflow/context/mcp-server.ts";
import {
  createFileContextProvider,
  getDefaultContextDir,
} from "../workflow/context/file-provider.ts";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";

// ── Types ──────────────────────────────────────────────────────────

export interface AgentState {
  worker: AgentWorker;
  name: string;
  model: string;
  backend: BackendType;
  system: string;
  workflow: string;
  tag: string;
  createdAt: string;
}

export interface DaemonState {
  agents: Map<string, AgentState>;
  server: { stop(closeActiveConnections?: boolean): void };
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
    state.server.stop();
  }

  // Close MCP sessions
  for (const [, session] of mcpSessions) {
    try {
      await session.transport.close();
    } catch { /* best-effort */ }
  }
  mcpSessions.clear();

  removeDaemonInfo();
  process.exit(0);
}

// ── Helpers ────────────────────────────────────────────────────────

function getWorkflowAgentNames(workflow: string, tag: string): string[] {
  if (!state) return [];
  return [...state.agents.values()]
    .filter((a) => a.workflow === workflow && a.tag === tag)
    .map((a) => a.name);
}

// ── Daemon Entry Point ─────────────────────────────────────────────

export async function startDaemon(config: {
  port?: number;
  host?: string;
} = {}): Promise<void> {
  // Prevent starting multiple daemons
  const existing = isDaemonRunning();
  if (existing) {
    console.error(`Daemon already running: pid=${existing.pid} port=${existing.port}`);
    process.exit(1);
  }

  const host = config.host ?? "127.0.0.1";
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
      agents: [...state.agents.keys()],
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
    const agents = [...state.agents.values()].map((a) => ({
      name: a.name,
      model: a.model,
      backend: a.backend,
      workflow: a.workflow,
      tag: a.tag,
      createdAt: a.createdAt,
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
      tools: toolDefs,
    } = body as {
      name: string;
      model: string;
      system: string;
      backend?: BackendType;
      workflow?: string;
      tag?: string;
      tools?: Record<string, unknown>;
    };

    if (!name || !model || !system) {
      return c.json({ error: "name, model, system required" }, 400);
    }
    if (state.agents.has(name)) {
      return c.json({ error: `Agent already exists: ${name}` }, 409);
    }

    const cliBackend =
      backend !== "default"
        ? createBackend({ type: backend, model } as Parameters<typeof createBackend>[0])
        : undefined;

    const worker = new AgentWorker({
      model,
      system,
      tools: toolDefs ?? {},
      backend: cliBackend,
    });

    state.agents.set(name, {
      worker,
      name,
      model,
      backend,
      system,
      workflow,
      tag,
      createdAt: new Date().toISOString(),
    });

    return c.json({ name, model, backend, workflow, tag }, 201);
  });

  // ── GET /agents/:name ────────────────────────────────────────

  app.get("/agents/:name", (c) => {
    if (!state) return c.json({ error: "Not ready" }, 503);
    const agent = state.agents.get(c.req.param("name"));
    if (!agent) return c.json({ error: "Agent not found" }, 404);
    return c.json({
      name: agent.name,
      model: agent.model,
      backend: agent.backend,
      system: agent.system,
      workflow: agent.workflow,
      tag: agent.tag,
      createdAt: agent.createdAt,
    });
  });

  // ── DELETE /agents/:name ─────────────────────────────────────

  app.delete("/agents/:name", (c) => {
    if (!state) return c.json({ error: "Not ready" }, 503);
    const name = c.req.param("name");
    if (!state.agents.delete(name)) {
      return c.json({ error: "Agent not found" }, 404);
    }
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

    const agent = state.agents.get(agentName);
    if (!agent) return c.json({ error: `Agent not found: ${agentName}` }, 404);

    return streamSSE(c, async (stream) => {
      try {
        const gen = agent.worker.sendStream(message);
        while (true) {
          const { value, done } = await gen.next();
          if (done) {
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

    const agent = state.agents.get(agentName);
    if (!agent) return c.json({ error: `Agent not found: ${agentName}` }, 404);

    try {
      const response = await agent.worker.send(message);
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

    // Route to existing session
    if (sessionId && mcpSessions.has(sessionId)) {
      const session = mcpSessions.get(sessionId)!;

      if (req.method === "DELETE") {
        await session.transport.close();
        mcpSessions.delete(sessionId);
        return new Response(null, { status: 200 });
      }

      return session.transport.handleRequest(req);
    }

    // New session — only POST with initialize is valid
    if (req.method === "POST") {
      const body = await req.json();

      const isInit = Array.isArray(body)
        ? body.some((m: { method?: string }) => m?.method === "initialize")
        : (body as { method?: string })?.method === "initialize";

      if (!isInit) {
        return c.json({ error: "Bad request: session required" }, 400);
      }

      // Resolve agent identity from query param (default: "user")
      const url = new URL(req.url);
      const agentName = url.searchParams.get("agent") || "user";

      // Find workflow context for this agent
      const agentState = state.agents.get(agentName);
      const workflow = agentState?.workflow ?? "global";
      const tag = agentState?.tag ?? "main";

      // Build agent name list for this workflow
      const workflowAgents = getWorkflowAgentNames(workflow, tag);
      const allNames = [...new Set([...workflowAgents, agentName, "user"])];

      // Create context provider
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

    // GET without session (SSE stream) — need session ID
    if (req.method === "GET") {
      return c.json({ error: "Session ID required for GET requests" }, 400);
    }

    return c.json({ error: "Method not allowed" }, 405);
  });

  // ── Start HTTP server ────────────────────────────────────────

  const server = Bun.serve({
    fetch: app.fetch,
    port: config.port ?? DEFAULT_PORT,
    hostname: host,
    error(error) {
      console.error("Server error:", error);
      removeDaemonInfo();
      process.exit(1);
    },
  });

  const actualPort = server.port ?? 0;
  const startedAt = new Date().toISOString();

  writeDaemonInfo({
    pid: process.pid,
    host,
    port: actualPort,
    startedAt,
  });

  state = {
    agents: new Map(),
    server,
    port: actualPort,
    host,
    startedAt,
  };

  console.log(`Daemon started: pid=${process.pid}`);
  console.log(`Listening: http://${host}:${actualPort}`);
  console.log(`MCP: http://${host}:${actualPort}/mcp`);

  // Handle signals
  process.on("SIGINT", () => {
    console.log("\nShutting down...");
    gracefulShutdown();
  });

  process.on("SIGTERM", () => {
    gracefulShutdown();
  });
}
