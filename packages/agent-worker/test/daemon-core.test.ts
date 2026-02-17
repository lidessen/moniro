/**
 * Phase 1 gate test: daemon core
 *
 * Verifies: daemon starts → SQLite created → HTTP works →
 * register agent → shut down → restart → agent still there.
 */
import { describe, test, expect, afterEach } from "bun:test";
import { startDaemon, type DaemonHandle } from "../src/daemon/index.ts";
import { openMemoryDatabase } from "../src/daemon/db.ts";
import {
  createAgent,
  getAgent,
  listAgents,
  removeAgent,
  createWorkflow,
  getWorkflow,
  listWorkflows,
  removeWorkflow,
  ensureGlobalWorkflow,
} from "../src/daemon/registry.ts";

// ==================== Registry (direct DB) ====================

describe("registry", () => {
  test("agent CRUD", () => {
    const db = openMemoryDatabase();

    // Create
    const agent = createAgent(db, { name: "alice", model: "claude-sonnet-4-5" });
    expect(agent.name).toBe("alice");
    expect(agent.model).toBe("claude-sonnet-4-5");
    expect(agent.backend).toBe("default");
    expect(agent.workflow).toBe("global");
    expect(agent.tag).toBe("main");
    expect(agent.state).toBe("idle");

    // Get
    const fetched = getAgent(db, "alice");
    expect(fetched).not.toBeNull();
    expect(fetched!.name).toBe("alice");
    expect(fetched!.model).toBe("claude-sonnet-4-5");

    // List
    createAgent(db, { name: "bob", model: "gpt-4o" });
    const all = listAgents(db);
    expect(all.length).toBe(2);

    // List filtered
    createAgent(db, {
      name: "charlie",
      model: "claude-sonnet-4-5",
      workflow: "review",
      tag: "pr-1",
    });
    const reviewAgents = listAgents(db, "review", "pr-1");
    expect(reviewAgents.length).toBe(1);
    expect(reviewAgents[0]!.name).toBe("charlie");

    // Delete
    const removed = removeAgent(db, "alice");
    expect(removed).toBe(true);
    expect(getAgent(db, "alice")).toBeNull();

    // Delete non-existent
    expect(removeAgent(db, "nobody")).toBe(false);

    db.close();
  });

  test("agent with full config", () => {
    const db = openMemoryDatabase();

    createAgent(db, {
      name: "reviewer",
      model: "claude-sonnet-4-5",
      backend: "claude",
      system: "You are a code reviewer.",
      workflow: "review",
      tag: "pr-42",
      schedule: "30s",
      configJson: { mcpServers: { bash: { command: "bash" } } },
    });

    const fetched = getAgent(db, "reviewer")!;
    expect(fetched.backend).toBe("claude");
    expect(fetched.system).toBe("You are a code reviewer.");
    expect(fetched.workflow).toBe("review");
    expect(fetched.tag).toBe("pr-42");
    expect(fetched.schedule).toBe("30s");
    expect(fetched.configJson).toEqual({ mcpServers: { bash: { command: "bash" } } });

    db.close();
  });

  test("workflow CRUD", () => {
    const db = openMemoryDatabase();

    // Create
    const wf = createWorkflow(db, { name: "review", tag: "pr-1", configYaml: "name: review" });
    expect(wf.name).toBe("review");
    expect(wf.state).toBe("running");

    // Get
    const fetched = getWorkflow(db, "review", "pr-1");
    expect(fetched).not.toBeNull();
    expect(fetched!.configYaml).toBe("name: review");

    // List
    createWorkflow(db, { name: "deploy" });
    const all = listWorkflows(db);
    expect(all.length).toBe(2);

    // Delete
    expect(removeWorkflow(db, "review", "pr-1")).toBe(true);
    expect(getWorkflow(db, "review", "pr-1")).toBeNull();

    db.close();
  });

  test("ensureGlobalWorkflow creates it if missing", () => {
    const db = openMemoryDatabase();

    ensureGlobalWorkflow(db);
    const wf = getWorkflow(db, "global", "main");
    expect(wf).not.toBeNull();

    // Calling again is idempotent
    ensureGlobalWorkflow(db);
    const all = listWorkflows(db);
    expect(all.length).toBe(1);

    db.close();
  });
});

// ==================== Daemon HTTP ====================

describe("daemon HTTP", () => {
  let daemon: DaemonHandle | null = null;

  afterEach(async () => {
    if (daemon) {
      await daemon.shutdown();
      daemon = null;
    }
  });

  test("starts and responds to /health", async () => {
    daemon = await startDaemon({ inMemory: true, port: 0 });

    const res = await fetch(`http://${daemon.host}:${daemon.port}/health`);
    expect(res.ok).toBe(true);

    const body = await res.json();
    expect(body.pid).toBe(process.pid);
    expect(typeof body.uptime).toBe("number");
    expect(typeof body.agents).toBe("number");
  });

  test("agent CRUD via HTTP", async () => {
    daemon = await startDaemon({ inMemory: true, port: 0 });
    const base = `http://${daemon.host}:${daemon.port}`;

    // Create
    const createRes = await fetch(`${base}/agents`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "alice", model: "claude-sonnet-4-5" }),
    });
    expect(createRes.status).toBe(201);
    const created = await createRes.json();
    expect(created.name).toBe("alice");

    // Duplicate
    const dupRes = await fetch(`${base}/agents`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "alice", model: "gpt-4o" }),
    });
    expect(dupRes.status).toBe(409);

    // List
    const listRes = await fetch(`${base}/agents`);
    const agents = await listRes.json();
    expect(agents.length).toBe(1);

    // Get
    const getRes = await fetch(`${base}/agents/alice`);
    expect(getRes.ok).toBe(true);
    const agent = await getRes.json();
    expect(agent.model).toBe("claude-sonnet-4-5");

    // Get non-existent
    const notFound = await fetch(`${base}/agents/nobody`);
    expect(notFound.status).toBe(404);

    // Delete
    const delRes = await fetch(`${base}/agents/alice`, { method: "DELETE" });
    expect(delRes.ok).toBe(true);

    // Verify deleted
    const listRes2 = await fetch(`${base}/agents`);
    const agents2 = await listRes2.json();
    expect(agents2.length).toBe(0);
  });

  test("workflow creation stores provider config in agent configJson", async () => {
    daemon = await startDaemon({ inMemory: true, port: 0 });
    const base = `http://${daemon.host}:${daemon.port}`;

    // Create workflow with provider config (object form)
    await fetch(`${base}/workflows`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        workflow: {
          name: "test-provider",
          agents: {
            bot: {
              model: "anthropic/claude-sonnet-4-5",
              provider: { name: "anthropic", api_key: "sk-test-123", base_url: "https://custom.api" },
            },
          },
        },
        tag: "main",
      }),
    });

    // Verify agent has provider in configJson
    const agentRes = await fetch(`${base}/agents/bot`);
    const agent = await agentRes.json();
    expect(agent.configJson).toEqual({
      provider: { name: "anthropic", apiKey: "sk-test-123", baseUrl: "https://custom.api" },
    });
  });

  test("workflow creation handles string provider", async () => {
    daemon = await startDaemon({ inMemory: true, port: 0 });
    const base = `http://${daemon.host}:${daemon.port}`;

    await fetch(`${base}/workflows`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        workflow: {
          name: "test-str-provider",
          agents: {
            bot2: { model: "openai/gpt-4.1", provider: "openai" },
          },
        },
        tag: "main",
      }),
    });

    const agentRes = await fetch(`${base}/agents/bot2`);
    const agent = await agentRes.json();
    expect(agent.configJson).toEqual({ provider: { name: "openai" } });
  });

  test("persistence across restarts (file-based DB)", async () => {
    const { mkdtempSync } = await import("node:fs");
    const { tmpdir } = await import("node:os");
    const { join } = await import("node:path");

    const tmpDir = mkdtempSync(join(tmpdir(), "aw-test-"));
    const dbPath = join(tmpDir, "test.db");

    // Start, register agent, shutdown
    daemon = await startDaemon({ dbPath, port: 0 });
    await fetch(`http://${daemon.host}:${daemon.port}/agents`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "alice", model: "claude-sonnet-4-5" }),
    });
    await daemon.shutdown();
    daemon = null;

    // Restart with same DB
    daemon = await startDaemon({ dbPath, port: 0 });
    const res = await fetch(`http://${daemon.host}:${daemon.port}/agents/alice`);
    expect(res.ok).toBe(true);
    const agent = await res.json();
    expect(agent.name).toBe("alice");
    expect(agent.model).toBe("claude-sonnet-4-5");

    // Cleanup
    const { rmSync } = await import("node:fs");
    await daemon.shutdown();
    daemon = null;
    rmSync(tmpDir, { recursive: true });
  });
});
