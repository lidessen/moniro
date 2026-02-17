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
import { createWorkflow, listWorkflows, removeWorkflow } from "./registry.ts";
import type { createSchedulerManager } from "./scheduler.ts";
import { dispatchToolCall, type DispatchDeps } from "./tool-dispatch.ts";
import type { DocumentProvider } from "../shared/types.ts";

export interface HttpDeps {
  db: Database;
  startedAt: number;
  shutdown: () => void;
  schedulerManager?: ReturnType<typeof createSchedulerManager>;
  documentProvider?: DocumentProvider;
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

    // Check for duplicate within same workflow:tag scope
    const workflow = body.workflow ?? "global";
    const tag = body.tag ?? "main";
    const existing = getAgent(deps.db, body.name, workflow, tag);
    if (existing) {
      return c.json({ error: `Agent '${body.name}' already exists in ${workflow}:${tag}` }, 409);
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
      sender?: string;
      workflow?: string;
      tag?: string;
    }>();

    if (!body.agent || !body.message) {
      return c.json({ error: "agent and message are required" }, 400);
    }

    // `agent` is the target for workflow/tag resolution.
    // `sender` is who the message is from (defaults to "user" for CLI callers).
    const sender = body.sender ?? "user";
    const agentConfig = getAgent(deps.db, body.agent);
    const workflow = body.workflow ?? agentConfig?.workflow ?? "global";
    const tag = body.tag ?? agentConfig?.tag ?? "main";

    const result = channelSend(deps.db, sender, body.message, workflow, tag);

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

  // ==================== Workflows ====================

  app.post("/workflows", async (c) => {
    const body = await c.req.json<{
      workflow: { name?: string; agents: Record<string, any>; kickoff?: string };
      tag?: string;
    }>();

    if (!body.workflow?.agents) {
      return c.json({ error: "workflow.agents is required" }, 400);
    }

    const name = body.workflow.name ?? "unnamed";
    const tag = body.tag ?? "main";

    // Create workflow record
    createWorkflow(deps.db, { name, tag });

    // Create agents from workflow definition
    const agentNames: string[] = [];
    for (const [agentName, agentDef] of Object.entries(body.workflow.agents)) {
      const existing = getAgent(deps.db, agentName, name, tag);
      if (!existing) {
        // Normalize provider config (string or object form) for storage
        const provider = agentDef.provider;
        const providerConfig = provider
          ? typeof provider === "string"
            ? { name: provider }
            : {
                name: provider.name,
                apiKey: provider.api_key,
                baseUrl: provider.base_url,
              }
          : undefined;

        createAgent(deps.db, {
          name: agentName,
          model: agentDef.model ?? "mock",
          backend: agentDef.backend ?? (agentDef.model ? "sdk" : "mock"),
          system: agentDef.resolvedSystemPrompt ?? agentDef.system_prompt,
          workflow: name,
          tag,
          configJson: providerConfig ? { provider: providerConfig } : undefined,
        });
      }
      agentNames.push(agentName);

      // Start scheduler for each agent
      deps.schedulerManager?.start(agentName, name, tag);
    }

    // Send kickoff message if present, then wake mentioned agents
    if (body.workflow.kickoff) {
      const result = channelSend(deps.db, "system", body.workflow.kickoff, name, tag, {
        skipAutoResource: true,
      });
      if (deps.schedulerManager) {
        for (const recipient of result.recipients) {
          deps.schedulerManager.wake(recipient, name, tag);
        }
      }
    }

    return c.json({ ok: true, name, tag, agents: agentNames }, 201);
  });

  app.get("/workflows", (c) => {
    const workflows = listWorkflows(deps.db);
    return c.json(workflows);
  });

  // ── Workflow status (for run-mode idle detection) ──────────

  app.get("/workflows/:name/:tag/status", (c) => {
    const name = c.req.param("name");
    const tag = c.req.param("tag");

    const agents = listAgents(deps.db, name, tag);
    if (agents.length === 0) {
      return c.json({ complete: true, reason: "no_agents" });
    }

    // Check: all schedulers in THIS workflow idle?
    const allIdle = agents.every(
      (a) => deps.schedulerManager?.isIdle(a.name, name, tag) ?? true,
    );

    // Check: any unread inbox messages?
    let pendingInbox = false;
    for (const agent of agents) {
      const inbox = inboxQuery(deps.db, agent.name, name, tag);
      if (inbox.length > 0) {
        pendingInbox = true;
        break;
      }
    }

    const complete = allIdle && !pendingInbox;
    return c.json({
      complete,
      agents: agents.map((a) => ({ name: a.name, state: a.state })),
      pendingInbox,
    });
  });

  app.delete("/workflows/:name/:tag", (c) => {
    const name = c.req.param("name");
    const tag = c.req.param("tag");

    // Stop schedulers for all agents in this workflow
    const agents = listAgents(deps.db, name, tag);
    for (const agent of agents) {
      deps.schedulerManager?.stop(agent.name, name, tag);
      removeAgent(deps.db, agent.name, name, tag);
    }

    removeWorkflow(deps.db, name, tag);
    return c.json({ ok: true });
  });

  // ==================== MCP (Worker→Daemon tool calls) ====================

  app.post("/mcp", async (c) => {
    // Agent identity from query param (set by ProcessManager in daemonMcpUrl)
    const agent = c.req.query("agent");
    if (!agent) {
      return c.json(
        { jsonrpc: "2.0", id: null, error: { code: -32600, message: "Missing ?agent= query param" } },
        400,
      );
    }

    const body = await c.req.json<{
      jsonrpc: string;
      id: unknown;
      method: string;
      params?: { name?: string; arguments?: Record<string, unknown> };
    }>();

    // Only support tools/call
    if (body.method !== "tools/call") {
      return c.json({
        jsonrpc: "2.0",
        id: body.id ?? null,
        error: { code: -32601, message: `Method '${body.method}' not supported` },
      });
    }

    const toolName = body.params?.name;
    if (!toolName) {
      return c.json({
        jsonrpc: "2.0",
        id: body.id ?? null,
        error: { code: -32602, message: "Missing params.name" },
      });
    }

    const dispatchDeps: DispatchDeps = {
      db: deps.db,
      documentProvider: deps.documentProvider,
    };

    try {
      const result = await dispatchToolCall(
        dispatchDeps,
        agent,
        toolName,
        body.params?.arguments ?? {},
      );
      return c.json({ jsonrpc: "2.0", id: body.id ?? null, result });
    } catch (e) {
      return c.json({
        jsonrpc: "2.0",
        id: body.id ?? null,
        error: { code: -32000, message: (e as Error).message },
      });
    }
  });

  return app;
}
