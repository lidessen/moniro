/**
 * Daemon HTTP API — Hono routes for the Interface layer.
 *
 * Every route is a thin wrapper: parse request → call registry/context → return JSON.
 * No business logic here.
 */
import { Hono } from "hono";
import type { Database } from "bun:sqlite";
import {
  createAgent,
  getAgent,
  listAgents,
  removeAgent,
  type CreateAgentInput,
} from "./registry.ts";
import { channelSend, channelRead, inboxQuery } from "./context.ts";
import type { createSchedulerManager } from "./scheduler.ts";

export interface HttpDeps {
  db: Database;
  startedAt: number;
  shutdown: () => void;
  schedulerManager?: ReturnType<typeof createSchedulerManager>;
}

export function createApp(deps: HttpDeps): Hono {
  const app = new Hono();

  // ==================== Health ====================

  app.get("/health", (c) => {
    const agents = listAgents(deps.db);
    return c.json({
      pid: process.pid,
      uptime: Math.floor((Date.now() - deps.startedAt) / 1000),
      agents: agents.length,
    });
  });

  // ==================== Shutdown ====================

  app.post("/shutdown", (c) => {
    // Schedule shutdown after response
    setTimeout(() => deps.shutdown(), 100);
    return c.json({ ok: true });
  });

  // ==================== Agents ====================

  app.post("/agents", async (c) => {
    const body = await c.req.json<CreateAgentInput>();
    if (!body.name || !body.model) {
      return c.json({ error: "name and model are required" }, 400);
    }

    // Check for duplicate
    const existing = getAgent(deps.db, body.name);
    if (existing) {
      return c.json({ error: `Agent '${body.name}' already exists` }, 409);
    }

    const agent = createAgent(deps.db, body);
    return c.json(agent, 201);
  });

  app.get("/agents", (c) => {
    const workflow = c.req.query("workflow");
    const tag = c.req.query("tag");
    const agents = listAgents(deps.db, workflow ?? undefined, tag ?? undefined);
    return c.json(agents);
  });

  app.get("/agents/:name", (c) => {
    const agent = getAgent(deps.db, c.req.param("name"));
    if (!agent) {
      return c.json({ error: "Agent not found" }, 404);
    }
    return c.json(agent);
  });

  app.delete("/agents/:name", (c) => {
    const removed = removeAgent(deps.db, c.req.param("name"));
    if (!removed) {
      return c.json({ error: "Agent not found" }, 404);
    }
    return c.json({ ok: true });
  });

  // ==================== Messaging ====================

  app.post("/send", async (c) => {
    const body = await c.req.json<{
      agent: string;
      message: string;
      workflow?: string;
      tag?: string;
    }>();

    if (!body.agent || !body.message) {
      return c.json({ error: "agent and message are required" }, 400);
    }

    const agentConfig = getAgent(deps.db, body.agent);
    const workflow = body.workflow ?? agentConfig?.workflow ?? "global";
    const tag = body.tag ?? agentConfig?.tag ?? "main";

    const result = channelSend(deps.db, body.agent, body.message, workflow, tag);

    // Wake schedulers for recipients
    if (deps.schedulerManager) {
      for (const recipient of result.recipients) {
        deps.schedulerManager.wake(recipient, workflow, tag);
      }
    }

    return c.json(result);
  });

  app.get("/peek", (c) => {
    const workflow = c.req.query("workflow") ?? "global";
    const tag = c.req.query("tag") ?? "main";
    const limit = Number(c.req.query("limit") ?? "20");

    const messages = channelRead(deps.db, workflow, tag, { limit });
    return c.json(messages);
  });

  return app;
}
