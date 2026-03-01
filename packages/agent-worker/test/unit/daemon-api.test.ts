/**
 * Daemon HTTP API Tests
 *
 * Tests the Hono app created by createDaemonApp() using app.request().
 * No real HTTP server is started — requests go directly through Hono's router.
 *
 * Coverage:
 *   GET  /health
 *   GET  /agents, POST /agents, GET /agents/:name, DELETE /agents/:name
 *   POST /run, POST /serve
 *   GET  /workflows, DELETE /workflows/:name/:tag
 *   Invalid JSON body handling
 */

import { describe, test, expect, beforeEach } from "bun:test";
import { createDaemonApp, type DaemonState, type WorkflowHandle } from "../../src/daemon/daemon.ts";
import { AgentRegistry } from "../../src/agent/agent-registry.ts";
import { WorkspaceRegistry } from "../../src/daemon/workspace-registry.ts";
import { MemoryStateStore } from "../../src/agent/store.ts";
import type { AgentDefinition } from "../../src/agent/definition.ts";
import type { AgentLoop, AgentRunResult } from "../../src/workflow/loop/types.ts";
import type { ContextProvider } from "../../src/workflow/context/provider.ts";
import type { Workspace } from "../../src/workflow/factory.ts";

// ── Test Helpers ──────────────────────────────────────────────────

function createTestState(overrides?: Partial<DaemonState>): DaemonState {
  return {
    agents: new AgentRegistry(process.cwd()),
    workspaces: new WorkspaceRegistry(),
    workflows: new Map(),
    store: new MemoryStateStore(),
    port: 5099,
    host: "127.0.0.1",
    startedAt: new Date().toISOString(),
    ...overrides,
  };
}

/** Create a minimal mock AgentLoop */
function createMockLoop(response: string = "Hello!"): AgentLoop {
  return {
    name: "mock",
    state: "idle",
    async start() {},
    async stop() {},
    wake() {},
    async sendDirect(_message: string): Promise<AgentRunResult> {
      return {
        success: true,
        content: response,
        duration: 100,
        steps: 1,
        toolCalls: 0,
      };
    },
  };
}

/** Create a mock Workspace */
function createMockWorkspace(): Workspace {
  return {
    contextProvider: {} as ContextProvider,
    contextDir: "/tmp/test-workspace",
    persistent: false,
    eventLog: null as any,
    httpMcpServer: null as any,
    mcpUrl: "http://localhost:0/mcp",
    mcpToolNames: new Set(),
    projectDir: process.cwd(),
    shutdown: async () => {},
  };
}

/** Create a mock WorkflowHandle */
function createMockWorkflowHandle(
  name: string,
  tag: string,
  agents: string[],
  loops: Map<string, AgentLoop>,
): WorkflowHandle {
  return {
    name,
    tag,
    key: `${name}:${tag}`,
    agents,
    loops,
    workspace: createMockWorkspace(),
    shutdown: async () => {},
    startedAt: new Date().toISOString(),
  };
}

/** Register an ephemeral agent in the test state */
function registerTestAgent(
  s: DaemonState,
  name: string,
  overrides?: Partial<AgentDefinition>,
): void {
  const def: AgentDefinition = {
    name,
    model: "test/model",
    prompt: { system: "You are a test agent." },
    backend: "mock",
    ...overrides,
  };
  s.agents.registerEphemeral(def);
}

/** Register an ephemeral agent with a pre-wired loop */
function registerTestAgentWithLoop(s: DaemonState, name: string, loop: AgentLoop): void {
  registerTestAgent(s, name);
  const handle = s.agents.get(name)!;
  handle.loop = loop;
}

async function json(res: Response): Promise<Record<string, unknown>> {
  return (await res.json()) as Record<string, unknown>;
}

function post(app: ReturnType<typeof createDaemonApp>, path: string, body: unknown) {
  return app.request(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

// ── Tests ─────────────────────────────────────────────────────────

describe("Daemon API", () => {
  let testState: DaemonState;
  let app: ReturnType<typeof createDaemonApp>;

  beforeEach(() => {
    testState = createTestState();
    app = createDaemonApp({ getState: () => testState });
  });

  // ── GET /health ──────────────────────────────────────────────

  describe("GET /health", () => {
    test("returns status ok with state info", async () => {
      const res = await app.request("/health");
      expect(res.status).toBe(200);
      const data = await json(res);
      expect(data.status).toBe("ok");
      expect(data.pid).toBe(process.pid);
      expect(data.port).toBe(5099);
      expect(data.agents).toEqual([]);
      expect(data.workflows).toEqual([]);
      expect(typeof data.uptime).toBe("number");
    });

    test("returns 503 when state is null", async () => {
      const nullApp = createDaemonApp({ getState: () => null });
      const res = await nullApp.request("/health");
      expect(res.status).toBe(503);
      const data = await json(res);
      expect(data.status).toBe("unavailable");
    });

    test("includes agent names", async () => {
      registerTestAgent(testState, "alice");

      const res = await app.request("/health");
      const data = await json(res);
      expect(data.agents).toEqual(["alice"]);
    });
  });

  // ── GET /agents ──────────────────────────────────────────────

  describe("GET /agents", () => {
    test("returns empty list initially", async () => {
      const res = await app.request("/agents");
      expect(res.status).toBe(200);
      const data = await json(res);
      expect(data.agents).toEqual([]);
    });

    test("lists standalone agents", async () => {
      registerTestAgent(testState, "alice");

      const res = await app.request("/agents");
      const data = await json(res);
      const agents = data.agents as Array<Record<string, unknown>>;
      expect(agents).toHaveLength(1);
      expect(agents[0]!.name).toBe("alice");
      expect(agents[0]!.source).toBe("standalone");
    });
  });

  // ── POST /agents ─────────────────────────────────────────────

  describe("POST /agents", () => {
    test("creates agent successfully", async () => {
      const res = await post(app, "/agents", {
        name: "bob",
        model: "test/model",
        system: "Test prompt",
      });
      expect(res.status).toBe(201);
      const data = await json(res);
      expect(data.name).toBe("bob");
      expect(data.model).toBe("test/model");
      expect(data.backend).toBe("default");
      // Standalone agents have no workflow/tag by default
      expect(data.workflow).toBeUndefined();
      expect(data.tag).toBeUndefined();

      // Verify agent was stored in registry
      expect(testState.agents.has("bob")).toBe(true);
      // And it's ephemeral
      expect(testState.agents.get("bob")!.ephemeral).toBe(true);
    });

    test("rejects missing required fields", async () => {
      const res = await post(app, "/agents", { name: "bob" });
      expect(res.status).toBe(400);
      const data = await json(res);
      expect(data.error).toContain("required");
    });

    test("rejects duplicate agent name", async () => {
      registerTestAgent(testState, "alice");

      const res = await post(app, "/agents", {
        name: "alice",
        model: "test/model",
        system: "prompt",
      });
      expect(res.status).toBe(409);
      const data = await json(res);
      expect(data.error).toContain("already exists");
    });

    test("rejects invalid JSON body", async () => {
      const res = await app.request("/agents", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "not json",
      });
      expect(res.status).toBe(400);
      const data = await json(res);
      expect(data.error).toContain("Invalid JSON");
    });

    test("accepts custom workflow and tag in response", async () => {
      const res = await post(app, "/agents", {
        name: "reviewer",
        model: "test/model",
        system: "Review code",
        workflow: "review",
        tag: "pr-123",
      });
      expect(res.status).toBe(201);
      const data = await json(res);
      expect(data.workflow).toBe("review");
      expect(data.tag).toBe("pr-123");
    });
  });

  // ── GET /agents/:name ────────────────────────────────────────

  describe("GET /agents/:name", () => {
    test("returns agent info", async () => {
      registerTestAgent(testState, "alice");

      const res = await app.request("/agents/alice");
      expect(res.status).toBe(200);
      const data = await json(res);
      expect(data.name).toBe("alice");
      expect(data.model).toBe("test/model");
      expect(data.system).toBe("You are a test agent.");
    });

    test("returns 404 for unknown agent", async () => {
      const res = await app.request("/agents/nobody");
      expect(res.status).toBe(404);
    });
  });

  // ── DELETE /agents/:name ─────────────────────────────────────

  describe("DELETE /agents/:name", () => {
    test("removes agent from registry", async () => {
      registerTestAgent(testState, "alice");

      const res = await app.request("/agents/alice", { method: "DELETE" });
      expect(res.status).toBe(200);
      const data = await json(res);
      expect(data.success).toBe(true);

      expect(testState.agents.has("alice")).toBe(false);
    });

    test("shuts down workspace on removal", async () => {
      registerTestAgent(testState, "alice");
      let shutdownCalled = false;
      const ws = createMockWorkspace();
      ws.shutdown = async () => {
        shutdownCalled = true;
      };
      testState.workspaces.set("agent:alice", ws);

      await app.request("/agents/alice", { method: "DELETE" });

      expect(shutdownCalled).toBe(true);
      expect(testState.workspaces.has("agent:alice")).toBe(false);
    });

    test("stops agent loop on removal", async () => {
      const loop = createMockLoop();
      let stopCalled = false;
      loop.stop = async () => {
        stopCalled = true;
      };
      registerTestAgentWithLoop(testState, "alice", loop);

      await app.request("/agents/alice", { method: "DELETE" });

      expect(stopCalled).toBe(true);
      expect(testState.agents.has("alice")).toBe(false);
    });

    test("returns 404 for unknown agent", async () => {
      const res = await app.request("/agents/nobody", { method: "DELETE" });
      expect(res.status).toBe(404);
    });
  });

  // ── POST /run ────────────────────────────────────────────────

  describe("POST /run", () => {
    test("rejects missing fields", async () => {
      const res = await post(app, "/run", { agent: "alice" });
      expect(res.status).toBe(400);
      const data = await json(res);
      expect(data.error).toContain("required");
    });

    test("returns 404 for unknown agent", async () => {
      const res = await post(app, "/run", { agent: "nobody", message: "hi" });
      expect(res.status).toBe(404);
    });

    test("rejects invalid JSON body", async () => {
      const res = await app.request("/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{bad json",
      });
      expect(res.status).toBe(400);
    });
  });

  // ── POST /serve ──────────────────────────────────────────────

  describe("POST /serve", () => {
    test("rejects missing fields", async () => {
      const res = await post(app, "/serve", { message: "hi" });
      expect(res.status).toBe(400);
    });

    test("returns 404 for unknown agent", async () => {
      const res = await post(app, "/serve", { agent: "nobody", message: "hi" });
      expect(res.status).toBe(404);
    });

    test("sends message and returns response via loop", async () => {
      const loop = createMockLoop("I'm Alice!");
      registerTestAgentWithLoop(testState, "alice", loop);

      const res = await post(app, "/serve", { agent: "alice", message: "hello" });
      expect(res.status).toBe(200);
      const data = await json(res);
      expect(data.content).toBe("I'm Alice!");
      expect(data.duration).toBe(100);
      expect(data.success).toBe(true);
    });

    test("returns error when sendDirect fails", async () => {
      const loop = createMockLoop();
      loop.sendDirect = async () => ({ success: false, error: "Backend unavailable", duration: 0 });
      registerTestAgentWithLoop(testState, "alice", loop);

      const res = await post(app, "/serve", { agent: "alice", message: "hello" });
      expect(res.status).toBe(500);
      const data = await json(res);
      expect(data.error).toBe("Backend unavailable");
    });

    test("rejects invalid JSON body", async () => {
      const res = await app.request("/serve", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "not-json",
      });
      expect(res.status).toBe(400);
    });
  });

  // ── GET /workflows ───────────────────────────────────────────

  describe("GET /workflows", () => {
    test("returns empty list initially", async () => {
      const res = await app.request("/workflows");
      expect(res.status).toBe(200);
      const data = await json(res);
      expect(data.workflows).toEqual([]);
    });
  });

  // ── POST /workflows ──────────────────────────────────────────

  describe("POST /workflows", () => {
    test("rejects missing workflow", async () => {
      const res = await post(app, "/workflows", {});
      expect(res.status).toBe(400);
    });

    test("rejects invalid JSON body", async () => {
      const res = await app.request("/workflows", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "broken",
      });
      expect(res.status).toBe(400);
    });
  });

  // ── DELETE /workflows ────────────────────────────────────────

  describe("DELETE /workflows", () => {
    test("returns 404 for unknown workflow", async () => {
      const res = await app.request("/workflows/unknown/main", { method: "DELETE" });
      expect(res.status).toBe(404);
    });

    test("convenience route defaults tag to main", async () => {
      const res = await app.request("/workflows/unknown", { method: "DELETE" });
      expect(res.status).toBe(404);
      const data = await json(res);
      expect(data.error).toContain("unknown:main");
    });

    test("stops and removes workflow", async () => {
      let shutdownCalled = false;
      testState.workflows.set("review:main", {
        name: "review",
        tag: "main",
        key: "review:main",
        agents: ["reviewer"],
        loops: new Map(),
        workspace: createMockWorkspace(),
        shutdown: async () => {
          shutdownCalled = true;
        },
        startedAt: new Date().toISOString(),
      });

      const res = await app.request("/workflows/review/main", { method: "DELETE" });
      expect(res.status).toBe(200);
      const data = await json(res);
      expect(data.success).toBe(true);
      expect(shutdownCalled).toBe(true);
      expect(testState.workflows.has("review:main")).toBe(false);
    });
  });

  // ── Token auth ────────────────────────────────────────────────

  describe("token auth", () => {
    const TEST_TOKEN = "test-secret-token";
    let authedApp: ReturnType<typeof createDaemonApp>;

    function authedPost(path: string, body: unknown) {
      return authedApp.request(path, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${TEST_TOKEN}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
      });
    }

    beforeEach(() => {
      authedApp = createDaemonApp({
        getState: () => testState,
        token: TEST_TOKEN,
      });
    });

    // ── Rejection: no token ──────────────────────────────────

    test("rejects GET /health without token", async () => {
      const res = await authedApp.request("/health");
      expect(res.status).toBe(401);
      const data = await json(res);
      expect(data.error).toBe("Unauthorized");
    });

    test("rejects POST /agents without token", async () => {
      const res = await authedApp.request("/agents", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "x", model: "m", system: "s" }),
      });
      expect(res.status).toBe(401);
    });

    test("rejects POST /run without token", async () => {
      const res = await authedApp.request("/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ agent: "a", message: "hi" }),
      });
      expect(res.status).toBe(401);
    });

    test("rejects POST /serve without token", async () => {
      const res = await authedApp.request("/serve", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ agent: "a", message: "hi" }),
      });
      expect(res.status).toBe(401);
    });

    test("rejects POST /workflows without token", async () => {
      const res = await authedApp.request("/workflows", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ workflow: {} }),
      });
      expect(res.status).toBe(401);
    });

    test("rejects DELETE /agents/:name without token", async () => {
      const res = await authedApp.request("/agents/test", { method: "DELETE" });
      expect(res.status).toBe(401);
    });

    test("rejects DELETE /workflows/:name/:tag without token", async () => {
      const res = await authedApp.request("/workflows/w/main", { method: "DELETE" });
      expect(res.status).toBe(401);
    });

    test("rejects POST /shutdown without token", async () => {
      const res = await authedApp.request("/shutdown", { method: "POST" });
      expect(res.status).toBe(401);
    });

    // ── Rejection: wrong token ───────────────────────────────

    test("rejects requests with wrong token", async () => {
      const res = await authedApp.request("/health", {
        headers: { Authorization: "Bearer wrong-token" },
      });
      expect(res.status).toBe(401);
    });

    // ── Rejection: wrong scheme ──────────────────────────────

    test("rejects requests with wrong auth scheme", async () => {
      const res = await authedApp.request("/health", {
        headers: { Authorization: `Token ${TEST_TOKEN}` },
      });
      expect(res.status).toBe(401);
    });

    test("rejects empty Authorization header", async () => {
      const res = await authedApp.request("/health", {
        headers: { Authorization: "" },
      });
      expect(res.status).toBe(401);
    });

    // ── Acceptance: correct token ────────────────────────────

    test("accepts GET /health with correct token", async () => {
      const res = await authedApp.request("/health", {
        headers: { Authorization: `Bearer ${TEST_TOKEN}` },
      });
      expect(res.status).toBe(200);
      const data = await json(res);
      expect(data.status).toBe("ok");
    });

    test("accepts POST /agents with correct token", async () => {
      const res = await authedPost("/agents", {
        name: "secured-agent",
        model: "test/model",
        system: "Secure prompt",
      });
      expect(res.status).toBe(201);
    });

    test("accepts POST /run with correct token (404 = past auth)", async () => {
      const res = await authedPost("/run", { agent: "nobody", message: "hi" });
      // 404 means request passed auth and reached route handler
      expect(res.status).toBe(404);
    });

    test("accepts POST /serve with correct token (404 = past auth)", async () => {
      const res = await authedPost("/serve", { agent: "nobody", message: "hi" });
      expect(res.status).toBe(404);
    });

    test("accepts DELETE /agents/:name with correct token (404 = past auth)", async () => {
      const res = await authedApp.request("/agents/nobody", {
        method: "DELETE",
        headers: { Authorization: `Bearer ${TEST_TOKEN}` },
      });
      expect(res.status).toBe(404);
    });

    test("accepts POST /workflows with correct token (400 = past auth)", async () => {
      const res = await authedPost("/workflows", {});
      // 400 means request passed auth, reached handler, failed validation
      expect(res.status).toBe(400);
    });

    test("accepts DELETE /workflows with correct token (404 = past auth)", async () => {
      const res = await authedApp.request("/workflows/x/main", {
        method: "DELETE",
        headers: { Authorization: `Bearer ${TEST_TOKEN}` },
      });
      expect(res.status).toBe(404);
    });

    // ── Backward compat: no token configured ─────────────────

    test("no token required when token is not configured", async () => {
      const res = await app.request("/health");
      expect(res.status).toBe(200);
    });

    test("all endpoints work without token when not configured", async () => {
      // POST /agents works
      const res = await post(app, "/agents", {
        name: "open-agent",
        model: "test/model",
        system: "prompt",
      });
      expect(res.status).toBe(201);
    });
  });

  // ── Agent Lifecycle ──────────────────────────────────────────

  describe("agent lifecycle", () => {
    test("registered agent has no loop initially", async () => {
      registerTestAgent(testState, "alice");

      // No workspace or loop exists yet
      expect(testState.agents.get("alice")!.loop).toBeNull();
      expect(testState.workspaces.size).toBe(0);

      // GET /agents shows the agent but with no state (loop not created)
      const res = await app.request("/agents");
      const data = await json(res);
      const agents = data.agents as Array<Record<string, unknown>>;
      expect(agents).toHaveLength(1);
      expect(agents[0]!.name).toBe("alice");
      expect(agents[0]!.state).toBeUndefined();
    });

    test("agent handle stores its own loop", async () => {
      const loop = createMockLoop("handle-owned");
      registerTestAgentWithLoop(testState, "alice", loop);

      // POST /serve should find the loop from handle.loop
      const res = await post(app, "/serve", { agent: "alice", message: "test" });
      expect(res.status).toBe(200);
      const data = await json(res);
      expect(data.content).toBe("handle-owned");
    });

    test("serve uses loop from agent handle", async () => {
      const loop = createMockLoop("lazy response");
      registerTestAgentWithLoop(testState, "alice", loop);

      // POST /serve should find the loop and execute
      const res = await post(app, "/serve", { agent: "alice", message: "test" });
      expect(res.status).toBe(200);
      const data = await json(res);
      expect(data.content).toBe("lazy response");
      expect(data.success).toBe(true);
    });

    test("findLoop works across multiple workflows", async () => {
      // Create two workflows with different agents
      const loopA = createMockLoop("from-review");
      const loopB = createMockLoop("from-deploy");

      testState.workflows.set(
        "review:main",
        createMockWorkflowHandle("review", "main", ["alice"], new Map([["alice", loopA]])),
      );

      testState.workflows.set(
        "deploy:main",
        createMockWorkflowHandle("deploy", "main", ["bob"], new Map([["bob", loopB]])),
      );

      // alice should be found in review workflow
      registerTestAgent(testState, "alice");
      const resA = await post(app, "/serve", { agent: "alice", message: "hi" });
      expect(resA.status).toBe(200);
      expect((await json(resA)).content).toBe("from-review");

      // bob should be found in deploy workflow
      registerTestAgent(testState, "bob");
      const resB = await post(app, "/serve", { agent: "bob", message: "hi" });
      expect(resB.status).toBe(200);
      expect((await json(resB)).content).toBe("from-deploy");
    });

    test("delete agent cleans up workspace", async () => {
      registerTestAgent(testState, "alice");
      let shutdownCalled = false;
      const ws = createMockWorkspace();
      ws.shutdown = async () => {
        shutdownCalled = true;
      };
      testState.workspaces.set("agent:alice", ws);

      // Also wire a loop
      const loop = createMockLoop();
      testState.agents.get("alice")!.loop = loop;

      // Delete the agent
      const res = await app.request("/agents/alice", { method: "DELETE" });
      expect(res.status).toBe(200);
      const data = await json(res);
      expect(data.success).toBe(true);

      // Agent removed from registry
      expect(testState.agents.has("alice")).toBe(false);
      // Workspace removed
      expect(testState.workspaces.has("agent:alice")).toBe(false);
      // Shutdown was called
      expect(shutdownCalled).toBe(true);
    });

    test("delete agent without workspace succeeds", async () => {
      // Agent registered but no workspace or loop created yet
      registerTestAgent(testState, "alice");

      const res = await app.request("/agents/alice", { method: "DELETE" });
      expect(res.status).toBe(200);
      expect(testState.agents.has("alice")).toBe(false);
    });

    test("standalone agent works via handle.loop", async () => {
      // Agent with loop directly on handle
      const loop = createMockLoop("solo response");
      registerTestAgentWithLoop(testState, "solo", loop);

      const res = await post(app, "/serve", { agent: "solo", message: "hi" });
      expect(res.status).toBe(200);
      expect((await json(res)).content).toBe("solo response");
    });

    test("workflow agents visible in GET /agents alongside standalone", async () => {
      // Standalone agent
      registerTestAgent(testState, "alice");

      // Workflow with inline agent
      testState.workflows.set(
        "review:main",
        createMockWorkflowHandle(
          "review",
          "main",
          ["reviewer"],
          new Map([["reviewer", createMockLoop()]]),
        ),
      );

      const res = await app.request("/agents");
      const data = await json(res);
      const agents = data.agents as Array<Record<string, unknown>>;

      // Should have both standalone and workflow agents
      expect(agents).toHaveLength(2);
      const names = agents.map((a) => a.name);
      expect(names).toContain("alice");
      expect(names).toContain("reviewer");

      // Sources should be different
      const alice = agents.find((a) => a.name === "alice");
      const reviewer = agents.find((a) => a.name === "reviewer");
      expect(alice!.source).toBe("standalone");
      expect(reviewer!.source).toBe("workflow");
    });
  });

  // ── 503 when not ready ───────────────────────────────────────

  describe("503 when state is null", () => {
    test("all endpoints return 503", async () => {
      const nullApp = createDaemonApp({ getState: () => null });

      const endpoints: Array<[string, string]> = [
        ["GET", "/agents"],
        ["GET", "/agents/test"],
        ["GET", "/workflows"],
      ];

      for (const [method, path] of endpoints) {
        const res = await nullApp.request(path, { method });
        expect(res.status).toBe(503);
      }
    });

    test("POST endpoints return 503", async () => {
      const nullApp = createDaemonApp({ getState: () => null });

      const endpoints = ["/agents", "/run", "/serve", "/workflows"];

      for (const path of endpoints) {
        const res = await post(nullApp, path, { test: true });
        expect(res.status).toBe(503);
      }
    });
  });
});
