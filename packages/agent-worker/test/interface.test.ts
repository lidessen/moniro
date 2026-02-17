/**
 * Phase 5 gate test: interface CLI
 *
 * Verifies: target parsing, HTTP client integration,
 * workflow parser, and full CLI flow through daemon.
 */
import { describe, test, expect, afterEach } from "bun:test";
import { writeFileSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { parseTarget, buildTarget, buildTargetDisplay } from "../src/interface/target.ts";
import { startDaemon, type DaemonHandle } from "../src/daemon/index.ts";
import { createAgent, createWorkflow } from "../src/daemon/registry.ts";
import { parseWorkflowFile, validateWorkflow, getKickoffMentions } from "../src/workflow/parser.ts";

// ==================== Target Parsing ====================

describe("parseTarget", () => {
  test("just agent name", () => {
    const t = parseTarget("alice");
    expect(t.agent).toBe("alice");
    expect(t.workflow).toBe("global");
    expect(t.tag).toBe("main");
    expect(t.display).toBe("alice");
  });

  test("agent@workflow", () => {
    const t = parseTarget("alice@review");
    expect(t.agent).toBe("alice");
    expect(t.workflow).toBe("review");
    expect(t.tag).toBe("main");
    expect(t.display).toBe("alice@review");
  });

  test("agent@workflow:tag", () => {
    const t = parseTarget("alice@review:pr-123");
    expect(t.agent).toBe("alice");
    expect(t.workflow).toBe("review");
    expect(t.tag).toBe("pr-123");
    expect(t.display).toBe("alice@review:pr-123");
  });

  test("@workflow (no agent)", () => {
    const t = parseTarget("@review");
    expect(t.agent).toBeUndefined();
    expect(t.workflow).toBe("review");
    expect(t.tag).toBe("main");
    expect(t.display).toBe("@review");
  });

  test("@workflow:tag (no agent)", () => {
    const t = parseTarget("@review:pr-123");
    expect(t.agent).toBeUndefined();
    expect(t.workflow).toBe("review");
    expect(t.tag).toBe("pr-123");
    expect(t.display).toBe("@review:pr-123");
  });

  test("display omits @global", () => {
    const t = parseTarget("alice");
    expect(t.display).toBe("alice");
    expect(t.full).toBe("alice@global:main");
  });

  test("display omits :main", () => {
    const t = parseTarget("alice@review");
    expect(t.display).toBe("alice@review");
  });
});

describe("buildTarget", () => {
  test("builds full target", () => {
    expect(buildTarget("alice", "review", "pr-1")).toBe("alice@review:pr-1");
  });

  test("builds with defaults", () => {
    expect(buildTarget("alice")).toBe("alice@global:main");
  });

  test("builds workflow-only target", () => {
    expect(buildTarget(undefined, "review", "pr-1")).toBe("@review:pr-1");
  });
});

describe("buildTargetDisplay", () => {
  test("omits global and main", () => {
    expect(buildTargetDisplay("alice")).toBe("alice");
    expect(buildTargetDisplay("alice", "review")).toBe("alice@review");
    expect(buildTargetDisplay("alice", "review", "pr-1")).toBe("alice@review:pr-1");
  });
});

// ==================== Workflow Parser ====================

describe("validateWorkflow", () => {
  test("valid workflow", () => {
    const result = validateWorkflow({
      agents: {
        reviewer: { model: "mock", backend: "mock" },
        coder: { model: "mock", backend: "mock" },
      },
      kickoff: "@reviewer check the PR",
    });
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  test("requires agents", () => {
    const result = validateWorkflow({});
    expect(result.valid).toBe(false);
    expect(result.errors[0]!.path).toBe("agents");
  });

  test("validates agent model", () => {
    const result = validateWorkflow({
      agents: {
        reviewer: { backend: "default" }, // No model, default backend
      },
    });
    expect(result.valid).toBe(false);
    expect(result.errors[0]!.path).toContain("model");
  });

  test("model not required for CLI backends", () => {
    const result = validateWorkflow({
      agents: {
        reviewer: { backend: "mock" },
      },
    });
    expect(result.valid).toBe(true);
  });

  test("validates setup tasks", () => {
    const result = validateWorkflow({
      agents: { a: { backend: "mock" } },
      setup: [{ invalid: true }],
    });
    expect(result.valid).toBe(false);
    expect(result.errors[0]!.path).toContain("setup");
  });

  test("validates wakeup_prompt requires wakeup", () => {
    const result = validateWorkflow({
      agents: {
        a: { backend: "mock", wakeup_prompt: "check" },
      },
    });
    expect(result.valid).toBe(false);
    expect(result.errors[0]!.path).toContain("wakeup_prompt");
  });
});

describe("parseWorkflowFile", () => {
  const tmpDir = join(tmpdir(), `agent-worker-test-${Date.now()}`);

  afterEach(() => {
    try {
      rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      // ignore
    }
  });

  test("parses valid YAML file", async () => {
    mkdirSync(tmpDir, { recursive: true });
    const yamlPath = join(tmpDir, "review.yaml");
    writeFileSync(
      yamlPath,
      `name: review
agents:
  reviewer:
    model: mock
    backend: mock
    system_prompt: "You review code."
  coder:
    model: mock
    backend: mock
kickoff: "@reviewer check the PR"
`,
    );

    const parsed = await parseWorkflowFile(yamlPath);
    expect(parsed.name).toBe("review");
    expect(parsed.agents.reviewer).toBeDefined();
    expect(parsed.agents.coder).toBeDefined();
    expect(parsed.agents.reviewer!.resolvedSystemPrompt).toBe("You review code.");
    expect(parsed.kickoff).toBe("@reviewer check the PR");
  });

  test("infers name from filename", async () => {
    mkdirSync(tmpDir, { recursive: true });
    const yamlPath = join(tmpDir, "deploy.yaml");
    writeFileSync(
      yamlPath,
      `agents:
  bot:
    backend: mock
`,
    );

    const parsed = await parseWorkflowFile(yamlPath);
    expect(parsed.name).toBe("deploy");
  });

  test("loads system prompt from file", async () => {
    mkdirSync(tmpDir, { recursive: true });
    const promptPath = join(tmpDir, "prompt.md");
    writeFileSync(promptPath, "You are an expert reviewer.\nFocus on security.");
    const yamlPath = join(tmpDir, "review.yaml");
    writeFileSync(
      yamlPath,
      `agents:
  reviewer:
    model: mock
    backend: mock
    system_prompt: prompt.md
`,
    );

    const parsed = await parseWorkflowFile(yamlPath);
    expect(parsed.agents.reviewer!.resolvedSystemPrompt).toContain("expert reviewer");
    expect(parsed.agents.reviewer!.resolvedSystemPrompt).toContain("security");
  });

  test("resolves wakeup into schedule", async () => {
    mkdirSync(tmpDir, { recursive: true });
    const yamlPath = join(tmpDir, "monitor.yaml");
    writeFileSync(
      yamlPath,
      `agents:
  monitor:
    backend: mock
    wakeup: "30s"
    wakeup_prompt: "Check status"
`,
    );

    const parsed = await parseWorkflowFile(yamlPath);
    expect(parsed.agents.monitor!.schedule).toEqual({
      wakeup: "30s",
      prompt: "Check status",
    });
  });

  test("throws on missing file", async () => {
    expect(parseWorkflowFile("/nonexistent/review.yaml")).rejects.toThrow("not found");
  });

  test("throws on invalid YAML", async () => {
    mkdirSync(tmpDir, { recursive: true });
    const yamlPath = join(tmpDir, "bad.yaml");
    writeFileSync(yamlPath, ": invalid: yaml: [");

    expect(parseWorkflowFile(yamlPath)).rejects.toThrow();
  });
});

describe("getKickoffMentions", () => {
  test("extracts valid agent mentions", () => {
    expect(getKickoffMentions("@reviewer check the PR", ["reviewer", "coder"])).toEqual([
      "reviewer",
    ]);
  });

  test("extracts multiple mentions", () => {
    expect(
      getKickoffMentions("@reviewer and @coder start", ["reviewer", "coder"]),
    ).toEqual(["reviewer", "coder"]);
  });

  test("ignores unknown mentions", () => {
    expect(getKickoffMentions("@unknown do stuff", ["reviewer"])).toEqual([]);
  });
});

// ==================== Integration: CLI → daemon ====================

describe("CLI → daemon integration", () => {
  let daemon: DaemonHandle | null = null;

  afterEach(async () => {
    if (daemon) {
      await daemon.shutdown();
      daemon = null;
    }
  });

  test("full flow: start daemon → create agents → send → peek", async () => {
    daemon = await startDaemon({ inMemory: true, port: 0 });
    const base = `http://${daemon.host}:${daemon.port}`;
    const { db } = daemon;

    // Setup workflow + agents
    createWorkflow(db, { name: "review", tag: "pr-1" });
    createAgent(db, { name: "alice", model: "mock", workflow: "review", tag: "pr-1" });
    createAgent(db, { name: "bob", model: "mock", workflow: "review", tag: "pr-1" });

    // List agents via HTTP
    const listRes = await fetch(`${base}/agents?workflow=review&tag=pr-1`);
    const agents = await listRes.json();
    expect(agents.length).toBe(2);

    // Send message via HTTP
    const sendRes = await fetch(`${base}/send`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        agent: "alice",
        message: "@bob please review the auth module",
        workflow: "review",
        tag: "pr-1",
      }),
    });
    expect(sendRes.ok).toBe(true);
    const sendResult = await sendRes.json();
    expect(sendResult.recipients).toContain("bob");

    // Peek via HTTP
    const peekRes = await fetch(`${base}/peek?workflow=review&tag=pr-1`);
    const messages = await peekRes.json();
    expect(messages.length).toBe(1);
    expect(messages[0].sender).toBe("user");
    expect(messages[0].content).toContain("auth module");

    // Health check
    const healthRes = await fetch(`${base}/health`);
    const healthData = await healthRes.json();
    expect(healthData.pid).toBe(process.pid);
    expect(healthData.agents).toBe(2);
  });

  test("agent CRUD via HTTP", async () => {
    daemon = await startDaemon({ inMemory: true, port: 0 });
    const base = `http://${daemon.host}:${daemon.port}`;

    // Create
    const createRes = await fetch(`${base}/agents`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "test-agent", model: "mock", backend: "mock" }),
    });
    expect(createRes.status).toBe(201);

    // Get
    const getRes = await fetch(`${base}/agents/test-agent`);
    const agent = await getRes.json();
    expect(agent.name).toBe("test-agent");

    // List
    const listRes = await fetch(`${base}/agents`);
    const list = await listRes.json();
    expect(list.length).toBeGreaterThanOrEqual(1);

    // Duplicate check
    const dupRes = await fetch(`${base}/agents`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "test-agent", model: "mock" }),
    });
    expect(dupRes.status).toBe(409);

    // Delete
    const delRes = await fetch(`${base}/agents/test-agent`, { method: "DELETE" });
    expect(delRes.ok).toBe(true);

    // Verify deleted
    const getRes2 = await fetch(`${base}/agents/test-agent`);
    expect(getRes2.status).toBe(404);
  });

  test("shutdown via HTTP", async () => {
    daemon = await startDaemon({ inMemory: true, port: 0 });
    const base = `http://${daemon.host}:${daemon.port}`;

    const res = await fetch(`${base}/shutdown`, { method: "POST" });
    const data = await res.json();
    expect(data.ok).toBe(true);

    // Wait for shutdown to complete
    await new Promise((r) => setTimeout(r, 200));
    daemon = null; // Already shut down
  });
});
