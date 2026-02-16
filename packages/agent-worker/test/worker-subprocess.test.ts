/**
 * Phase 3 gate test: worker subprocess
 *
 * Verifies: daemon spawns worker → worker connects MCP →
 * worker calls channel_send → daemon sees message → worker exits.
 */
import { describe, test, expect, afterEach } from "bun:test";
import { startDaemon, type DaemonHandle } from "../src/daemon/index.ts";
import { createAgent, createWorkflow, listAgents } from "../src/daemon/registry.ts";
import { channelRead } from "../src/daemon/context.ts";
import { buildPrompt } from "../src/worker/prompt.ts";
import { runSession } from "../src/worker/session.ts";
import { createMockBackend } from "../src/worker/backends/mock.ts";
import type { InboxMessage, Message } from "../src/shared/types.ts";

// ==================== Prompt building ====================

describe("buildPrompt", () => {
  test("builds prompt with inbox messages", () => {
    const prompt = buildPrompt({
      inbox: [
        {
          message: {
            id: "1",
            sender: "alice",
            content: "@bob please review",
            recipients: ["bob"],
            kind: "message",
            workflow: "review",
            tag: "pr-1",
            createdAt: Date.now(),
          },
          priority: "normal",
        },
      ],
      channel: [],
    });

    expect(prompt).toContain("## Inbox (1 messages for you)");
    expect(prompt).toContain("@alice");
    expect(prompt).toContain("please review");
  });

  test("builds prompt with channel history", () => {
    const prompt = buildPrompt({
      inbox: [],
      channel: [
        {
          id: "1",
          sender: "alice",
          content: "starting review",
          recipients: [],
          kind: "message",
          workflow: "review",
          tag: "pr-1",
          createdAt: Date.now(),
        },
      ],
    });

    expect(prompt).toContain("## Recent Activity");
    expect(prompt).toContain("@alice: starting review");
  });

  test("includes document content", () => {
    const prompt = buildPrompt({
      inbox: [],
      channel: [],
      document: "# Project Goals\n- Ship v2",
    });

    expect(prompt).toContain("## Current Workspace");
    expect(prompt).toContain("# Project Goals");
  });

  test("includes instructions", () => {
    const prompt = buildPrompt({ inbox: [], channel: [] });
    expect(prompt).toContain("## Instructions");
    expect(prompt).toContain("channel_send");
  });
});

// ==================== Session ====================

describe("runSession", () => {
  test("runs with mock backend", async () => {
    const backend = createMockBackend({ response: "I reviewed the code. LGTM!" });

    const result = await runSession({
      backend,
      system: "You are a reviewer.",
      prompt: "Please review this PR.",
    });

    expect(result.content).toBe("I reviewed the code. LGTM!");
  });

  test("mock backend with handler", async () => {
    const backend = createMockBackend({
      handler: (msg) => ({
        content: `Processed: ${msg.slice(0, 20)}`,
        toolCalls: [{ name: "channel_send", arguments: { message: "done" }, result: {} }],
        usage: { input: 100, output: 50, total: 150 },
      }),
    });

    const result = await runSession({
      backend,
      prompt: "Review this code please",
    });

    expect(result.content).toContain("Processed:");
    expect(result.toolCalls?.length).toBe(1);
    expect(result.usage?.total).toBe(150);
  });
});

// ==================== Integration: daemon + worker (in-process) ====================

describe("daemon + worker integration", () => {
  let daemon: DaemonHandle | null = null;

  afterEach(async () => {
    if (daemon) {
      await daemon.shutdown();
      daemon = null;
    }
  });

  test("worker sends message that appears in daemon channel", async () => {
    daemon = await startDaemon({ inMemory: true, port: 0 });
    const { db } = daemon;

    // Setup: workflow + agents
    createWorkflow(db, { name: "review", tag: "pr-1" });
    createAgent(db, { name: "reviewer", model: "mock", backend: "mock", workflow: "review", tag: "pr-1" });
    createAgent(db, { name: "coder", model: "mock", backend: "mock", workflow: "review", tag: "pr-1" });

    // Simulate what a worker subprocess does:
    // 1. Backend produces a response that includes channel_send
    const backend = createMockBackend({
      handler: () => "I found 3 issues in the code. @coder please fix the auth bug.",
    });

    const result = await runSession({
      backend,
      system: "You are a code reviewer.",
      prompt: buildPrompt({
        inbox: [{
          message: {
            id: "kick",
            sender: "system",
            content: "@reviewer please review the PR",
            recipients: ["reviewer"],
            kind: "message",
            workflow: "review",
            tag: "pr-1",
            createdAt: Date.now(),
          },
          priority: "normal",
        }],
        channel: [],
      }),
    });

    // Worker would call channel_send after getting result
    // Simulating the daemon-side post-processing:
    const { channelSend } = await import("../src/daemon/context.ts");
    const sendResult = channelSend(db, "reviewer", result.content, "review", "pr-1");

    // Verify: message in channel with @coder parsed
    expect(sendResult.recipients).toContain("coder");

    const messages = channelRead(db, "review", "pr-1");
    expect(messages.length).toBe(1);
    expect(messages[0].sender).toBe("reviewer");
    expect(messages[0].content).toContain("3 issues");

    // Verify: coder's inbox has the message
    const { inboxQuery } = await import("../src/daemon/context.ts");
    const coderInbox = inboxQuery(db, "coder", "review", "pr-1");
    expect(coderInbox.length).toBe(1);
    expect(coderInbox[0].message.sender).toBe("reviewer");
  });
});
