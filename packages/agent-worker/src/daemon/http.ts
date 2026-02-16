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

export interface HttpDeps {
  db: Database;
  startedAt: number;
  shutdown: () => void;
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

  return app;
}
