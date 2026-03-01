/**
 * Loop Module Tests
 * Tests for agent loop, backend abstraction, and prompt building
 */

import { describe, test, expect } from "bun:test";
import {
  LOOP_DEFAULTS,
  type AgentRunContext,
  type AgentRunResult,
} from "../src/workflow/loop/types.ts";
import type { Backend } from "../src/backends/types.ts";
import { parseModel, resolveModelAlias } from "../src/backends/model-maps.ts";
import { formatInbox, formatChannel, buildAgentPrompt } from "../src/workflow/loop/prompt.ts";
import {
  createAgentLoop,
  checkWorkflowIdle,
  isWorkflowComplete,
  buildWorkflowIdleState,
} from "../src/workflow/loop/loop.ts";
import { generateWorkflowMCPConfig } from "../src/workflow/loop/mcp-config.ts";
import {
  parseSendTarget,
  sendToWorkflowChannel,
  formatUserSender,
} from "../src/workflow/loop/send.ts";
import type { WorkflowIdleState } from "../src/workflow/loop/types.ts";
import { createMemoryContextProvider } from "../src/workflow/context/memory-provider.ts";
import type { InboxMessage, Message } from "../src/workflow/context/types.ts";
import type { ResolvedWorkflowAgent } from "../src/workflow/types.ts";

// ==================== Model Parsing Tests ====================

describe("parseModel", () => {
  test("parses provider/model format", () => {
    const result = parseModel("anthropic/claude-sonnet-4-5");
    expect(result.provider).toBe("anthropic");
    expect(result.model).toBe("claude-sonnet-4-5-20250514");
  });

  test("defaults to anthropic provider", () => {
    const result = parseModel("claude-sonnet-4-5");
    expect(result.provider).toBe("anthropic");
    expect(result.model).toBe("claude-sonnet-4-5-20250514");
  });

  test("resolves model aliases", () => {
    expect(parseModel("sonnet").model).toBe("claude-sonnet-4-5-20250514");
    expect(parseModel("opus").model).toBe("claude-opus-4-20250514");
    expect(parseModel("haiku").model).toBe("claude-haiku-3-5-20250514");
  });

  test("passes through unknown models", () => {
    const result = parseModel("openai/gpt-4");
    expect(result.provider).toBe("openai");
    expect(result.model).toBe("gpt-4");
  });

  test("handles claude CLI provider", () => {
    const result = parseModel("claude/sonnet");
    expect(result.provider).toBe("claude");
    expect(result.model).toBe("claude-sonnet-4-5-20250514");
  });
});

describe("resolveModelAlias", () => {
  test("resolves known aliases", () => {
    expect(resolveModelAlias("claude-sonnet-4-5")).toBe("claude-sonnet-4-5-20250514");
    expect(resolveModelAlias("claude-opus-4")).toBe("claude-opus-4-20250514");
    expect(resolveModelAlias("claude-haiku-3-5")).toBe("claude-haiku-3-5-20250514");
  });

  test("returns unknown models as-is", () => {
    expect(resolveModelAlias("gpt-4-turbo")).toBe("gpt-4-turbo");
    expect(resolveModelAlias("unknown-model")).toBe("unknown-model");
  });
});

// ==================== Prompt Building Tests ====================

describe("formatInbox", () => {
  test("formats empty inbox", () => {
    const result = formatInbox([]);
    expect(result).toBe("(no messages)");
  });

  test("formats single message", () => {
    const inbox: InboxMessage[] = [
      {
        entry: {
          id: "test-id-1",
          timestamp: "2024-01-15T10:30:45.123Z",
          from: "alice",
          content: "Hello @bob",
          mentions: ["bob"],
        },
        priority: "normal",
        seen: false,
      },
    ];
    const result = formatInbox(inbox);
    expect(result).toContain("[10:30:45]");
    expect(result).toContain("From @alice");
    expect(result).toContain("Hello @bob");
    expect(result).not.toContain("[HIGH]");
  });

  test("marks high priority messages", () => {
    const inbox: InboxMessage[] = [
      {
        entry: {
          id: "test-id-2",
          timestamp: "2024-01-15T10:30:45.123Z",
          from: "alice",
          content: "URGENT: @bob @charlie please review",
          mentions: ["bob", "charlie"],
        },
        priority: "high",
        seen: false,
      },
    ];
    const result = formatInbox(inbox);
    expect(result).toContain("[HIGH]");
  });
});

describe("formatChannel", () => {
  test("formats empty channel", () => {
    const result = formatChannel([]);
    expect(result).toBe("(no messages)");
  });

  test("formats channel entries", () => {
    const entries: Message[] = [
      {
        id: "test-id-3",
        timestamp: "2024-01-15T10:30:45.123Z",
        from: "alice",
        content: "Starting review",
        mentions: [],
      },
      {
        id: "test-id-4",
        timestamp: "2024-01-15T10:31:00.000Z",
        from: "bob",
        content: "On it!",
        mentions: [],
      },
    ];
    const result = formatChannel(entries);
    expect(result).toContain("[10:30:45] @alice: Starting review");
    expect(result).toContain("[10:31:00] @bob: On it!");
  });
});

describe("buildAgentPrompt", () => {
  const mockAgent: ResolvedWorkflowAgent = {
    model: "claude-sonnet-4-5",
    system_prompt: "You are a helpful assistant",
    resolvedSystemPrompt: "You are a helpful assistant",
  };

  // Mock provider for tests
  const mockProvider = {
    appendChannel: async () => {},
  } as any;

  test("builds complete prompt with all sections", () => {
    const ctx: AgentRunContext = {
      name: "reviewer",
      agent: mockAgent,
      inbox: [
        {
          entry: {
            id: "test-id-5",
            timestamp: "2024-01-15T10:30:45.123Z",
            from: "alice",
            content: "Please review this",
            mentions: ["reviewer"],
          },
          priority: "normal",
          seen: false,
        },
      ],
      recentChannel: [
        {
          id: "test-id-6",
          timestamp: "2024-01-15T10:30:45.123Z",
          from: "alice",
          content: "Please review this",
          mentions: ["reviewer"],
        },
      ],
      documentContent: "# Notes\nSome content here",
      mcpUrl: "http://127.0.0.1:0/mcp",
      workspaceDir: "/tmp/workspaces/reviewer",
      projectDir: "/home/user/myproject",
      retryAttempt: 1,
      provider: mockProvider,
    };

    const result = buildAgentPrompt(ctx);

    expect(result).toContain("## Project");
    expect(result).toContain("Working on: /home/user/myproject");
    expect(result).toContain("## Inbox (1 message for you)");
    expect(result).toContain("## Recent Activity");
    expect(result).toContain("## Shared Document");
    expect(result).toContain("# Notes");
    expect(result).toContain("## Instructions");
    expect(result).toContain("channel_send");
    expect(result).toContain("channel_read");
    expect(result).toContain("my_inbox");
    expect(result).toContain("my_inbox_ack");
    expect(result).toContain("team_members");
    expect(result).toContain("team_proposal_create");
    expect(result).toContain("team_vote");
    expect(result).toContain("team_proposal_status");
    expect(result).toContain("team_proposal_cancel");
    expect(result).toContain("MUST use channel_send");
    expect(result).not.toContain("retry attempt");
  });

  test("shows retry notice on retry attempt", () => {
    const ctx: AgentRunContext = {
      name: "reviewer",
      agent: mockAgent,
      inbox: [],
      recentChannel: [],
      documentContent: "",
      mcpUrl: "http://127.0.0.1:0/mcp",
      workspaceDir: "/tmp/workspaces/reviewer",
      projectDir: "/home/user/myproject",
      retryAttempt: 2,
      provider: mockProvider,
    };

    const result = buildAgentPrompt(ctx);
    expect(result).toContain("## Note");
    expect(result).toContain("retry attempt 2");
  });

  test("pluralizes message count correctly", () => {
    const ctx: AgentRunContext = {
      name: "reviewer",
      agent: mockAgent,
      inbox: [
        {
          entry: {
            id: "test-id-7",
            timestamp: "2024-01-15T10:30:45.123Z",
            from: "a",
            content: "m1",
            mentions: [],
          },
          priority: "normal",
          seen: false,
        },
        {
          entry: {
            id: "test-id-8",
            timestamp: "2024-01-15T10:31:00.000Z",
            from: "b",
            content: "m2",
            mentions: [],
          },
          priority: "normal",
          seen: false,
        },
      ],
      recentChannel: [],
      documentContent: "",
      mcpUrl: "http://127.0.0.1:0/mcp",
      workspaceDir: "/tmp/workspaces/reviewer",
      projectDir: "/home/user/myproject",
      retryAttempt: 1,
      provider: mockProvider,
    };

    const result = buildAgentPrompt(ctx);
    expect(result).toContain("2 messages for you");
  });
});

describe("generateWorkflowMCPConfig", () => {
  test("generates HTTP MCP config with agent identity in URL", () => {
    const config = generateWorkflowMCPConfig("http://127.0.0.1:3000/mcp", "alice");

    expect(config).toHaveProperty("mcpServers");
    const server = (config as any).mcpServers["workflow-context"];
    expect(server).toBeDefined();
    expect(server.type).toBe("http");
    expect(server.url).toBe("http://127.0.0.1:3000/mcp?agent=alice");
  });

  test("encodes agent name in URL", () => {
    const config = generateWorkflowMCPConfig("http://127.0.0.1:3000/mcp", "agent with spaces");
    const server = (config as any).mcpServers["workflow-context"];
    expect(server.url).toContain("agent=agent%20with%20spaces");
  });
});

// ==================== Loop Tests ====================

describe("createAgentLoop", () => {
  const mockAgent: ResolvedWorkflowAgent = {
    model: "claude-sonnet-4-5",
    system_prompt: "Test agent",
    resolvedSystemPrompt: "Test agent",
  };

  test("starts in stopped state", () => {
    const provider = createMemoryContextProvider(["agent1"]);
    const mockBackend: Backend = {
      type: "mock" as const,
      send: async () => ({ content: "ok" }),
    };

    const loop = createAgentLoop({
      name: "agent1",
      agent: mockAgent,
      contextProvider: provider,
      mcpUrl: "http://127.0.0.1:0/mcp",
      backend: mockBackend,
      workspaceDir: "/tmp/workspace",
      projectDir: "/tmp/project",
    });

    expect(loop.name).toBe("agent1");
    expect(loop.state).toBe("stopped");
  });

  test("transitions to idle after start", async () => {
    const provider = createMemoryContextProvider(["agent1"]);
    const mockBackend: Backend = {
      type: "mock" as const,
      send: async () => ({ content: "ok" }),
    };

    const loop = createAgentLoop({
      name: "agent1",
      agent: mockAgent,
      contextProvider: provider,
      mcpUrl: "http://127.0.0.1:0/mcp",
      backend: mockBackend,
      workspaceDir: "/tmp/workspace",
      projectDir: "/tmp/project",
      pollInterval: 100,
    });

    await loop.start();

    // Wait a tick for the loop to start
    await new Promise((r) => setTimeout(r, 10));

    expect(loop.state).toBe("idle");

    await loop.stop();
  });

  test("runs agent when inbox has messages", async () => {
    const provider = createMemoryContextProvider(["agent1", "agent2"]);
    let runCalled = false;

    const mockBackend: Backend = {
      type: "claude" as const,
      send: async (message) => {
        runCalled = true;
        // Loop builds prompt from context — verify inbox content is included
        expect(message).toContain("1 message");
        expect(message).toContain("From @agent2");
        return { content: "ok" };
      },
    };

    const loop = createAgentLoop({
      name: "agent1",
      agent: mockAgent,
      contextProvider: provider,
      mcpUrl: "http://127.0.0.1:0/mcp",
      backend: mockBackend,
      workspaceDir: "/tmp/workspace",
      projectDir: "/tmp/project",
      pollInterval: 50,
    });

    // Add message to agent1's inbox
    await provider.appendChannel("agent2", "Hello @agent1");

    await loop.start();

    // Wait for poll cycle
    await new Promise((r) => setTimeout(r, 100));

    expect(runCalled).toBe(true);

    await loop.stop();
  });

  test("acknowledges inbox only on success", async () => {
    const provider = createMemoryContextProvider(["agent1", "agent2"]);
    let runCount = 0;

    const mockBackend: Backend = {
      type: "claude" as const,
      send: async () => {
        runCount++;
        // Fail first time, succeed second time
        if (runCount === 1) {
          throw new Error("Test error");
        }
        return { content: "ok" };
      },
    };

    const loop = createAgentLoop({
      name: "agent1",
      agent: mockAgent,
      contextProvider: provider,
      mcpUrl: "http://127.0.0.1:0/mcp",
      backend: mockBackend,
      workspaceDir: "/tmp/workspace",
      projectDir: "/tmp/project",
      pollInterval: 50,
      retry: { maxAttempts: 2, backoffMs: 10, backoffMultiplier: 1 },
    });

    // Add message
    await provider.appendChannel("agent2", "Hello @agent1");

    // Verify inbox has message before run
    const inboxBefore = await provider.getInbox("agent1");
    expect(inboxBefore.length).toBe(1);

    await loop.start();

    // Wait for retry cycle
    await new Promise((r) => setTimeout(r, 200));

    // Inbox should be acknowledged after successful retry
    const inboxAfter = await provider.getInbox("agent1");
    expect(inboxAfter.length).toBe(0);
    expect(runCount).toBe(2);

    await loop.stop();
  });

  test("wake() interrupts polling", async () => {
    const provider = createMemoryContextProvider(["agent1", "agent2"]);
    let runCalled = false;

    const mockBackend: Backend = {
      type: "claude" as const,
      send: async () => {
        runCalled = true;
        return { content: "ok" };
      },
    };

    const loop = createAgentLoop({
      name: "agent1",
      agent: mockAgent,
      contextProvider: provider,
      mcpUrl: "http://127.0.0.1:0/mcp",
      backend: mockBackend,
      workspaceDir: "/tmp/workspace",
      projectDir: "/tmp/project",
      pollInterval: 5000, // Long poll interval
    });

    await loop.start();

    // Add message and wake
    await provider.appendChannel("agent2", "Hello @agent1");
    loop.wake();

    // Should run almost immediately
    await new Promise((r) => setTimeout(r, 50));

    expect(runCalled).toBe(true);

    await loop.stop();
  });

  test("stops cleanly", async () => {
    const provider = createMemoryContextProvider(["agent1"]);
    const mockBackend: Backend = {
      type: "mock" as const,
      send: async () => ({ content: "ok" }),
    };

    const loop = createAgentLoop({
      name: "agent1",
      agent: mockAgent,
      contextProvider: provider,
      mcpUrl: "http://127.0.0.1:0/mcp",
      backend: mockBackend,
      workspaceDir: "/tmp/workspace",
      projectDir: "/tmp/project",
      pollInterval: 100,
    });

    await loop.start();
    expect(loop.state).not.toBe("stopped");

    await loop.stop();
    expect(loop.state).toBe("stopped");
  });

  test("calls onRunComplete callback", async () => {
    const provider = createMemoryContextProvider(["agent1", "agent2"]);
    let completedResult: AgentRunResult | null = null;

    const mockBackend: Backend = {
      type: "claude" as const,
      send: async () => ({ content: "ok" }),
    };

    const loop = createAgentLoop({
      name: "agent1",
      agent: mockAgent,
      contextProvider: provider,
      mcpUrl: "http://127.0.0.1:0/mcp",
      backend: mockBackend,
      workspaceDir: "/tmp/workspace",
      projectDir: "/tmp/project",
      pollInterval: 50,
      onRunComplete: (result) => {
        completedResult = result;
      },
    });

    await provider.appendChannel("agent2", "Hello @agent1");
    await loop.start();

    await new Promise((r) => setTimeout(r, 100));

    expect(completedResult).not.toBeNull();
    expect(completedResult!.success).toBe(true);
    expect(completedResult!.duration).toBeGreaterThanOrEqual(0);

    await loop.stop();
  });
});

describe("checkWorkflowIdle", () => {
  const mockAgent: ResolvedWorkflowAgent = {
    model: "claude-sonnet-4-5",
    system_prompt: "Test agent",
    resolvedSystemPrompt: "Test agent",
  };

  test("returns true when all idle and no messages", async () => {
    const provider = createMemoryContextProvider(["agent1", "agent2"]);
    const mockBackend: Backend = {
      type: "mock" as const,
      send: async () => ({ content: "ok" }),
    };

    const loop1 = createAgentLoop({
      name: "agent1",
      agent: mockAgent,
      contextProvider: provider,
      mcpUrl: "http://127.0.0.1:0/mcp",
      backend: mockBackend,
      workspaceDir: "/tmp/workspace",
      projectDir: "/tmp/project",
      pollInterval: 1000,
    });

    const loop2 = createAgentLoop({
      name: "agent2",
      agent: mockAgent,
      contextProvider: provider,
      mcpUrl: "http://127.0.0.1:0/mcp",
      backend: mockBackend,
      workspaceDir: "/tmp/workspace",
      projectDir: "/tmp/project",
      pollInterval: 1000,
    });

    await loop1.start();
    await loop2.start();

    // Wait for idle state
    await new Promise((r) => setTimeout(r, 50));

    const loops = new Map([
      ["agent1", loop1],
      ["agent2", loop2],
    ]);

    const isIdle = await checkWorkflowIdle(loops, provider, 50);
    expect(isIdle).toBe(true);

    await loop1.stop();
    await loop2.stop();
  });

  test("returns false when messages pending", async () => {
    const provider = createMemoryContextProvider(["agent1", "agent2"]);
    const mockBackend: Backend = {
      type: "mock" as const,
      send: async () => ({ content: "ok" }),
    };

    const loop1 = createAgentLoop({
      name: "agent1",
      agent: mockAgent,
      contextProvider: provider,
      mcpUrl: "http://127.0.0.1:0/mcp",
      backend: mockBackend,
      workspaceDir: "/tmp/workspace",
      projectDir: "/tmp/project",
      pollInterval: 10000, // Long poll so it doesn't process
    });

    await loop1.start();
    await new Promise((r) => setTimeout(r, 50));

    // Add message but don't wake
    await provider.appendChannel("agent2", "Hello @agent1");

    const loops = new Map([["agent1", loop1]]);

    const isIdle = await checkWorkflowIdle(loops, provider, 10);
    expect(isIdle).toBe(false);

    await loop1.stop();
  });
});

// ==================== Defaults Tests ====================

describe("LOOP_DEFAULTS", () => {
  test("has expected default values", () => {
    expect(LOOP_DEFAULTS.pollInterval).toBe(5000);
    expect(LOOP_DEFAULTS.retry.maxAttempts).toBe(3);
    expect(LOOP_DEFAULTS.retry.backoffMs).toBe(1000);
    expect(LOOP_DEFAULTS.retry.backoffMultiplier).toBe(2);
    expect(LOOP_DEFAULTS.recentChannelLimit).toBe(50);
    expect(LOOP_DEFAULTS.idleDebounceMs).toBe(2000);
  });
});

// ==================== Idle State Tests ====================

describe("isWorkflowComplete", () => {
  test("returns true when all conditions met", () => {
    const state: WorkflowIdleState = {
      allLoopsIdle: true,
      noUnreadMessages: true,
      noActiveProposals: true,
      idleDebounceElapsed: true,
    };
    expect(isWorkflowComplete(state)).toBe(true);
  });

  test("returns false when loops not idle", () => {
    const state: WorkflowIdleState = {
      allLoopsIdle: false,
      noUnreadMessages: true,
      noActiveProposals: true,
      idleDebounceElapsed: true,
    };
    expect(isWorkflowComplete(state)).toBe(false);
  });

  test("returns false when unread messages exist", () => {
    const state: WorkflowIdleState = {
      allLoopsIdle: true,
      noUnreadMessages: false,
      noActiveProposals: true,
      idleDebounceElapsed: true,
    };
    expect(isWorkflowComplete(state)).toBe(false);
  });

  test("returns false when proposals active", () => {
    const state: WorkflowIdleState = {
      allLoopsIdle: true,
      noUnreadMessages: true,
      noActiveProposals: false,
      idleDebounceElapsed: true,
    };
    expect(isWorkflowComplete(state)).toBe(false);
  });

  test("returns false when debounce not elapsed", () => {
    const state: WorkflowIdleState = {
      allLoopsIdle: true,
      noUnreadMessages: true,
      noActiveProposals: true,
      idleDebounceElapsed: false,
    };
    expect(isWorkflowComplete(state)).toBe(false);
  });
});

describe("buildWorkflowIdleState", () => {
  const mockAgent: ResolvedWorkflowAgent = {
    model: "claude-sonnet-4-5",
    system_prompt: "Test agent",
    resolvedSystemPrompt: "Test agent",
  };

  test("reports idle when all loops idle and no messages", async () => {
    const provider = createMemoryContextProvider(["agent1", "agent2"]);
    const mockBackend: Backend = {
      type: "mock" as const,
      send: async () => ({ content: "ok" }),
    };

    const loop1 = createAgentLoop({
      name: "agent1",
      agent: mockAgent,
      contextProvider: provider,
      mcpUrl: "http://127.0.0.1:0/mcp",
      backend: mockBackend,
      workspaceDir: "/tmp/workspace",
      projectDir: "/tmp/project",
      pollInterval: 5000,
    });

    await loop1.start();
    await new Promise((r) => setTimeout(r, 50));

    const loops = new Map([["agent1", loop1]]);

    const state = await buildWorkflowIdleState(loops, provider);

    expect(state.allLoopsIdle).toBe(true);
    expect(state.noUnreadMessages).toBe(true);
    expect(state.noActiveProposals).toBe(true);

    await loop1.stop();
  });

  test("reports not idle when messages pending", async () => {
    const provider = createMemoryContextProvider(["agent1", "agent2"]);
    const mockBackend: Backend = {
      type: "mock" as const,
      send: async () => ({ content: "ok" }),
    };

    const loop1 = createAgentLoop({
      name: "agent1",
      agent: mockAgent,
      contextProvider: provider,
      mcpUrl: "http://127.0.0.1:0/mcp",
      backend: mockBackend,
      workspaceDir: "/tmp/workspace",
      projectDir: "/tmp/project",
      pollInterval: 10000,
    });

    await loop1.start();
    await new Promise((r) => setTimeout(r, 50));

    // Add message but don't wake
    await provider.appendChannel("agent2", "Hello @agent1");

    const loops = new Map([["agent1", loop1]]);

    const state = await buildWorkflowIdleState(loops, provider);

    expect(state.allLoopsIdle).toBe(true);
    expect(state.noUnreadMessages).toBe(false);

    await loop1.stop();
  });
});

// ==================== Send Target Parsing Tests ====================

describe("parseSendTarget", () => {
  test("parses standalone agent", () => {
    const result = parseSendTarget("reviewer");
    expect(result.type).toBe("standalone");
    expect(result.agent).toBe("reviewer");
    expect(result.instance).toBeUndefined();
  });

  test("parses workflow agent (agent@instance)", () => {
    const result = parseSendTarget("reviewer@default");
    expect(result.type).toBe("workflow-agent");
    expect(result.agent).toBe("reviewer");
    expect(result.instance).toBe("default");
  });

  test("parses workflow channel (@instance)", () => {
    const result = parseSendTarget("@production");
    expect(result.type).toBe("workflow-channel");
    expect(result.agent).toBeUndefined();
    expect(result.instance).toBe("production");
  });

  test("handles complex instance names", () => {
    const result = parseSendTarget("coder@feature-123");
    expect(result.type).toBe("workflow-agent");
    expect(result.agent).toBe("coder");
    expect(result.instance).toBe("feature-123");
  });
});

describe("sendToWorkflowChannel", () => {
  test("sends message to channel", async () => {
    const provider = createMemoryContextProvider(["agent1", "agent2"]);

    const result = await sendToWorkflowChannel(provider, "user", "Hello everyone");

    expect(result.success).toBe(true);
    expect(result.type).toBe("workflow-channel");
    expect(result.timestamp).toBeDefined();

    // Verify message in channel
    const entries = await provider.readChannel();
    expect(entries.length).toBe(1);
    expect(entries[0]!.content).toBe("Hello everyone");
    expect(entries[0]!.from).toBe("user");
  });

  test("sends message with @mention", async () => {
    const provider = createMemoryContextProvider(["agent1", "agent2"]);

    const result = await sendToWorkflowChannel(provider, "user", "Please review", "agent1");

    expect(result.success).toBe(true);
    expect(result.type).toBe("workflow-agent");

    // Verify message in channel with mention
    const entries = await provider.readChannel();
    expect(entries.length).toBe(1);
    expect(entries[0]!.content).toBe("@agent1 Please review");
    expect(entries[0]!.mentions).toContain("agent1");
  });

  test("message appears in agent inbox", async () => {
    const provider = createMemoryContextProvider(["agent1", "agent2"]);

    await sendToWorkflowChannel(provider, "user", "Hello", "agent1");

    const inbox = await provider.getInbox("agent1");
    expect(inbox.length).toBe(1);
    expect(inbox[0]!.entry.content).toBe("@agent1 Hello");
  });
});

describe("formatUserSender", () => {
  test("returns user for no username", () => {
    expect(formatUserSender()).toBe("user");
  });

  test("returns user:name for username", () => {
    expect(formatUserSender("alice")).toBe("user:alice");
  });
});

// ==================== Mock Backend Registration Tests ====================

describe("getBackendByType mock", () => {
  test('returns mock backend with name "mock"', async () => {
    const { getBackendByType } = await import("../src/workflow/loop/backend.ts");
    const backend = getBackendByType("mock");
    expect(backend.type).toBe("mock");
  });

  test("passes debugLog to mock backend", async () => {
    const { getBackendByType } = await import("../src/workflow/loop/backend.ts");
    const logs: string[] = [];
    const backend = getBackendByType("mock", { debugLog: (msg) => logs.push(msg) });
    expect(backend.type).toBe("mock");
  });

  test("throws for unknown backend type", async () => {
    const { getBackendByType } = await import("../src/workflow/loop/backend.ts");
    expect(() => getBackendByType("nonexistent" as any)).toThrow("Unknown backend type");
  });
});
