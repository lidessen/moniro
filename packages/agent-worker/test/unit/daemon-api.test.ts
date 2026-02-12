/**
 * Daemon HTTP API Tests
 *
 * Tests the Hono app created by createDaemonApp() using app.request().
 * No real HTTP server is started — requests go directly through Hono's router.
 *
 * Coverage:
 *   GET  /health
 *   GET  /agents, POST /agents, GET /agents/:name, DELETE /agents/:name
 *   POST /run, POST /serve (validation only — no real backend)
 *   GET  /workflows, DELETE /workflows/:name/:tag
 *   Invalid JSON body handling
 */

import { describe, test, expect, beforeEach } from "bun:test";
import { createDaemonApp, type DaemonState } from "../../src/daemon/daemon.ts";
import { MemoryStateStore } from "../../src/agent/store.ts";
import type { WorkerHandle } from "../../src/agent/handle.ts";
import type { AgentConfig } from "../../src/agent/config.ts";
import type { AgentResponse, SessionState } from "../../src/agent/types.ts";

// ── Test Helpers ──────────────────────────────────────────────────

function createTestState(overrides?: Partial<DaemonState>): DaemonState {
  return {
    configs: new Map(),
    workers: new Map(),
    workflows: new Map(),
    store: new MemoryStateStore(),
    port: 5099,
    host: "127.0.0.1",
    startedAt: new Date().toISOString(),
    ...overrides,
  };
}

/** Create a minimal mock WorkerHandle */
function createMockWorker(response: string = "Hello!"): WorkerHandle {
  const messages: Array<{ role: string; content: string }> = [];
  return {
    async send(input: string): Promise<AgentResponse> {
      messages.push({ role: "user", content: input });
      messages.push({ role: "assistant", content: response });
      return {
        content: response,
        toolCalls: [],
        pendingApprovals: [],
        usage: { input: 10, output: 5, total: 15 },
        latency: 100,
      };
    },
    async *sendStream(input: string): AsyncGenerator<string, AgentResponse> {
      messages.push({ role: "user", content: input });
      yield response;
      return {
        content: response,
        toolCalls: [],
        pendingApprovals: [],
        usage: { input: 10, output: 5, total: 15 },
        latency: 100,
      };
    },
    getState(): SessionState {
      return {
        id: "test-id",
        createdAt: new Date().toISOString(),
        messages: messages.map((m) => ({
          role: m.role as "user" | "assistant",
          content: m.content,
          status: "complete" as const,
          timestamp: new Date().toISOString(),
        })),
        totalUsage: { input: 10, output: 5, total: 15 },
        pendingApprovals: [],
      };
    },
  };
}

function createTestAgent(name: string, overrides?: Partial<AgentConfig>): AgentConfig {
  return {
    name,
    model: "test/model",
    system: "You are a test agent.",
    backend: "default",
    workflow: "global",
    tag: "main",
    createdAt: new Date().toISOString(),
    ...overrides,
  };
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
      const cfg = createTestAgent("alice");
      testState.configs.set("alice", cfg);

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
      const cfg = createTestAgent("alice");
      testState.configs.set("alice", cfg);

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
      expect(data.workflow).toBe("global");
      expect(data.tag).toBe("main");

      // Verify state was updated
      expect(testState.configs.has("bob")).toBe(true);
      expect(testState.workers.has("bob")).toBe(true);
    });

    test("rejects missing required fields", async () => {
      const res = await post(app, "/agents", { name: "bob" });
      expect(res.status).toBe(400);
      const data = await json(res);
      expect(data.error).toContain("required");
    });

    test("rejects duplicate agent name", async () => {
      testState.configs.set("alice", createTestAgent("alice"));

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

    test("accepts custom workflow and tag", async () => {
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
    test("returns agent config", async () => {
      testState.configs.set("alice", createTestAgent("alice"));

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
    test("removes agent", async () => {
      testState.configs.set("alice", createTestAgent("alice"));
      testState.workers.set("alice", createMockWorker());

      const res = await app.request("/agents/alice", { method: "DELETE" });
      expect(res.status).toBe(200);
      const data = await json(res);
      expect(data.success).toBe(true);

      expect(testState.configs.has("alice")).toBe(false);
      expect(testState.workers.has("alice")).toBe(false);
    });

    test("persists state before removal", async () => {
      const store = new MemoryStateStore();
      testState.store = store;
      testState.configs.set("alice", createTestAgent("alice"));
      testState.workers.set("alice", createMockWorker());

      await app.request("/agents/alice", { method: "DELETE" });

      const saved = await store.load("alice");
      expect(saved).not.toBeNull();
      expect(saved!.id).toBe("test-id");
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

    test("sends message and returns response", async () => {
      testState.configs.set("alice", createTestAgent("alice"));
      testState.workers.set("alice", createMockWorker("I'm Alice!"));

      const res = await post(app, "/serve", { agent: "alice", message: "hello" });
      expect(res.status).toBe(200);
      const data = await json(res);
      expect(data.content).toBe("I'm Alice!");
      expect(data.latency).toBe(100);
    });

    test("persists state after serve", async () => {
      const store = new MemoryStateStore();
      testState.store = store;
      testState.configs.set("alice", createTestAgent("alice"));
      testState.workers.set("alice", createMockWorker());

      await post(app, "/serve", { agent: "alice", message: "hello" });

      const saved = await store.load("alice");
      expect(saved).not.toBeNull();
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
        controllers: new Map(),
        contextProvider: {} as any,
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
