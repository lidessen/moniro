/**
 * Tests for Phase 3c: Conversation Model
 *
 * Covers:
 *   - ConversationMessage type structure
 *   - ConversationLog: JSONL append, readAll, readTail, persistence
 *   - ThinThread: push, bounded capacity, render, fromLog
 *   - thinThreadSection: prompt assembly integration
 *   - AgentHandle: conversation accessors (lazy creation, ephemeral skip)
 */

import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdirSync, existsSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";

import { ConversationLog, ThinThread, DEFAULT_THIN_THREAD_SIZE } from "@/agent/conversation.ts";
import type { ConversationMessage } from "@/agent/conversation.ts";
import { AgentHandle } from "@/agent/agent-handle.ts";
import type { AgentDefinition } from "@/agent/definition.ts";
import { thinThreadSection, formatConversation } from "@/workflow/loop/prompt.ts";
import type { AgentRunContext } from "@/workflow/loop/types.ts";

// ── Test Helpers ──────────────────────────────────────────────────

function tmpDir(): string {
  const dir = join(tmpdir(), `conv-test-${randomUUID().slice(0, 8)}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

function makeMsg(
  role: ConversationMessage["role"],
  content: string,
  timestamp?: string,
): ConversationMessage {
  return {
    role,
    content,
    timestamp: timestamp ?? new Date().toISOString(),
  };
}

function makeMinimalDef(name: string, overrides?: Partial<AgentDefinition>): AgentDefinition {
  return {
    name,
    model: "mock/test",
    prompt: { system: "test agent" },
    ...overrides,
  };
}

function makeMinimalRunContext(overrides?: Partial<AgentRunContext>): AgentRunContext {
  return {
    name: "test",
    agent: { model: "mock", resolvedSystemPrompt: "test" },
    inbox: [],
    recentChannel: [],
    documentContent: "",
    mcpUrl: "http://localhost:0/mcp",
    workspaceDir: "/tmp/ws",
    projectDir: "/tmp/proj",
    retryAttempt: 1,
    provider: {} as AgentRunContext["provider"],
    ...overrides,
  };
}

// ── ConversationLog ───────────────────────────────────────────────

describe("ConversationLog", () => {
  let dir: string;

  beforeEach(() => {
    dir = tmpDir();
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  test("append creates file and writes JSONL", () => {
    const logPath = join(dir, "conversations", "personal.jsonl");
    const log = new ConversationLog(logPath);

    expect(log.exists).toBe(false);

    const msg = makeMsg("user", "hello");
    log.append(msg);

    expect(log.exists).toBe(true);
    const raw = readFileSync(logPath, "utf-8");
    const lines = raw.trim().split("\n");
    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0]!)).toEqual(msg);
  });

  test("append creates parent directories", () => {
    const logPath = join(dir, "deep", "nested", "personal.jsonl");
    const log = new ConversationLog(logPath);

    log.append(makeMsg("user", "hello"));
    expect(existsSync(logPath)).toBe(true);
  });

  test("readAll returns all messages", () => {
    const logPath = join(dir, "personal.jsonl");
    const log = new ConversationLog(logPath);

    const msgs = [
      makeMsg("user", "hello", "2026-03-01T10:00:00.000Z"),
      makeMsg("assistant", "hi there", "2026-03-01T10:00:01.000Z"),
      makeMsg("user", "how are you?", "2026-03-01T10:00:02.000Z"),
    ];

    for (const m of msgs) log.append(m);

    const result = log.readAll();
    expect(result).toHaveLength(3);
    expect(result).toEqual(msgs);
  });

  test("readAll returns empty array for non-existent file", () => {
    const log = new ConversationLog(join(dir, "nonexistent.jsonl"));
    expect(log.readAll()).toEqual([]);
  });

  test("readTail returns last N messages", () => {
    const logPath = join(dir, "personal.jsonl");
    const log = new ConversationLog(logPath);

    for (let i = 0; i < 10; i++) {
      log.append(makeMsg("user", `msg-${i}`));
    }

    const tail3 = log.readTail(3);
    expect(tail3).toHaveLength(3);
    expect(tail3[0]!.content).toBe("msg-7");
    expect(tail3[1]!.content).toBe("msg-8");
    expect(tail3[2]!.content).toBe("msg-9");
  });

  test("readTail returns all if N > total", () => {
    const logPath = join(dir, "personal.jsonl");
    const log = new ConversationLog(logPath);

    log.append(makeMsg("user", "hello"));
    log.append(makeMsg("assistant", "hi"));

    const tail = log.readTail(100);
    expect(tail).toHaveLength(2);
  });

  test("skips malformed JSONL lines", () => {
    const logPath = join(dir, "personal.jsonl");
    mkdirSync(dir, { recursive: true });

    // Write a mix of valid and invalid lines
    const { writeFileSync } = require("node:fs");
    writeFileSync(
      logPath,
      `${JSON.stringify(makeMsg("user", "good"))}\n` +
        `not valid json\n` +
        `${JSON.stringify(makeMsg("assistant", "also good"))}\n`,
    );

    const log = new ConversationLog(logPath);
    const result = log.readAll();
    expect(result).toHaveLength(2);
    expect(result[0]!.content).toBe("good");
    expect(result[1]!.content).toBe("also good");
  });

  test("path getter returns file path", () => {
    const logPath = join(dir, "conversations", "personal.jsonl");
    const log = new ConversationLog(logPath);
    expect(log.path).toBe(logPath);
  });
});

// ── ThinThread ────────────────────────────────────────────────────

describe("ThinThread", () => {
  test("push adds messages", () => {
    const thread = new ThinThread(10);
    thread.push(makeMsg("user", "hello"));
    thread.push(makeMsg("assistant", "hi"));

    expect(thread.length).toBe(2);
    expect(thread.getMessages()).toHaveLength(2);
  });

  test("enforces capacity limit", () => {
    const thread = new ThinThread(3);

    for (let i = 0; i < 5; i++) {
      thread.push(makeMsg("user", `msg-${i}`));
    }

    expect(thread.length).toBe(3);
    const msgs = thread.getMessages();
    expect(msgs[0]!.content).toBe("msg-2");
    expect(msgs[1]!.content).toBe("msg-3");
    expect(msgs[2]!.content).toBe("msg-4");
  });

  test("getMessages returns a copy", () => {
    const thread = new ThinThread(10);
    thread.push(makeMsg("user", "hello"));

    const msgs = thread.getMessages();
    msgs.push(makeMsg("user", "extra"));

    expect(thread.length).toBe(1); // Original not affected
  });

  test("capacity getter returns max messages", () => {
    const thread = new ThinThread(5);
    expect(thread.capacity).toBe(5);
  });

  test("default capacity is DEFAULT_THIN_THREAD_SIZE", () => {
    const thread = new ThinThread();
    expect(thread.capacity).toBe(DEFAULT_THIN_THREAD_SIZE);
    expect(DEFAULT_THIN_THREAD_SIZE).toBe(10);
  });

  test("render returns null when empty", () => {
    const thread = new ThinThread(10);
    expect(thread.render()).toBeNull();
  });

  test("render formats messages with time and role", () => {
    const thread = new ThinThread(10);
    thread.push(makeMsg("user", "hello", "2026-03-01T10:30:00.000Z"));
    thread.push(makeMsg("assistant", "hi there", "2026-03-01T10:30:05.000Z"));
    thread.push(makeMsg("system", "context loaded", "2026-03-01T10:30:10.000Z"));

    const rendered = thread.render()!;
    expect(rendered).toContain("[10:30:00] User: hello");
    expect(rendered).toContain("[10:30:05] You: hi there");
    expect(rendered).toContain("[10:30:10] System: context loaded");
  });

  describe("fromLog", () => {
    let dir: string;

    beforeEach(() => {
      dir = tmpDir();
    });

    afterEach(() => {
      rmSync(dir, { recursive: true, force: true });
    });

    test("restores from conversation log tail", () => {
      const logPath = join(dir, "personal.jsonl");
      const log = new ConversationLog(logPath);

      for (let i = 0; i < 20; i++) {
        log.append(makeMsg("user", `msg-${i}`));
      }

      const thread = ThinThread.fromLog(log, 5);
      expect(thread.length).toBe(5);

      const msgs = thread.getMessages();
      expect(msgs[0]!.content).toBe("msg-15");
      expect(msgs[4]!.content).toBe("msg-19");
    });

    test("restores all if log has fewer than capacity", () => {
      const logPath = join(dir, "personal.jsonl");
      const log = new ConversationLog(logPath);

      log.append(makeMsg("user", "hello"));
      log.append(makeMsg("assistant", "hi"));

      const thread = ThinThread.fromLog(log, 10);
      expect(thread.length).toBe(2);
    });

    test("returns empty thread if log does not exist", () => {
      const log = new ConversationLog(join(dir, "nonexistent.jsonl"));
      const thread = ThinThread.fromLog(log, 10);
      expect(thread.length).toBe(0);
    });

    test("uses default capacity", () => {
      const logPath = join(dir, "personal.jsonl");
      const log = new ConversationLog(logPath);

      const thread = ThinThread.fromLog(log);
      expect(thread.capacity).toBe(DEFAULT_THIN_THREAD_SIZE);
    });
  });
});

// ── formatConversation ────────────────────────────────────────────

describe("formatConversation", () => {
  test("returns fallback for empty array", () => {
    expect(formatConversation([])).toBe("(no conversation history)");
  });

  test("formats messages with role labels", () => {
    const messages: ConversationMessage[] = [
      makeMsg("user", "hello", "2026-03-01T14:00:00.000Z"),
      makeMsg("assistant", "hi there", "2026-03-01T14:00:01.000Z"),
    ];
    const result = formatConversation(messages);
    expect(result).toContain("[14:00:00] User: hello");
    expect(result).toContain("[14:00:01] You: hi there");
  });
});

// ── thinThreadSection ─────────────────────────────────────────────

describe("thinThreadSection", () => {
  test("returns null when no thin thread", () => {
    const ctx = makeMinimalRunContext();
    expect(thinThreadSection(ctx)).toBeNull();
  });

  test("returns null when thin thread is empty", () => {
    const ctx = makeMinimalRunContext({ thinThread: [] });
    expect(thinThreadSection(ctx)).toBeNull();
  });

  test("renders conversation history section", () => {
    const ctx = makeMinimalRunContext({
      thinThread: [
        makeMsg("user", "hello", "2026-03-01T10:00:00.000Z"),
        makeMsg("assistant", "hi", "2026-03-01T10:00:01.000Z"),
      ],
    });

    const result = thinThreadSection(ctx);
    expect(result).not.toBeNull();
    expect(result).toContain("## Conversation History");
    expect(result).toContain("[10:00:00] User: hello");
    expect(result).toContain("[10:00:01] You: hi");
  });
});

// ── AgentHandle conversation accessors ────────────────────────────

describe("AgentHandle conversation", () => {
  let dir: string;

  beforeEach(() => {
    dir = tmpDir();
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  test("conversationLog returns ConversationLog for persistent agent", () => {
    const def = makeMinimalDef("alice");
    const contextDir = join(dir, ".agents", "alice");
    mkdirSync(contextDir, { recursive: true });
    const handle = new AgentHandle(def, contextDir);

    const log = handle.conversationLog;
    expect(log).not.toBeNull();
    expect(log!.path).toBe(join(contextDir, "conversations", "personal.jsonl"));
  });

  test("conversationLog returns null for ephemeral agent", () => {
    const def = makeMinimalDef("bob");
    const contextDir = join(dir, ".agents", "bob");
    const handle = new AgentHandle(def, contextDir, undefined, true);

    expect(handle.conversationLog).toBeNull();
  });

  test("conversationLog is lazy (same instance)", () => {
    const def = makeMinimalDef("alice");
    const contextDir = join(dir, ".agents", "alice");
    mkdirSync(contextDir, { recursive: true });
    const handle = new AgentHandle(def, contextDir);

    const log1 = handle.conversationLog;
    const log2 = handle.conversationLog;
    expect(log1).toBe(log2);
  });

  test("thinThread returns ThinThread", () => {
    const def = makeMinimalDef("alice");
    const contextDir = join(dir, ".agents", "alice");
    mkdirSync(contextDir, { recursive: true });
    const handle = new AgentHandle(def, contextDir);

    const thread = handle.thinThread;
    expect(thread).toBeDefined();
    expect(thread.capacity).toBe(DEFAULT_THIN_THREAD_SIZE);
  });

  test("thinThread respects definition.context.thin_thread", () => {
    const def = makeMinimalDef("alice", {
      context: { thin_thread: 5 },
    });
    const contextDir = join(dir, ".agents", "alice");
    mkdirSync(contextDir, { recursive: true });
    const handle = new AgentHandle(def, contextDir);

    expect(handle.thinThread.capacity).toBe(5);
  });

  test("thinThread is lazy (same instance)", () => {
    const def = makeMinimalDef("alice");
    const contextDir = join(dir, ".agents", "alice");
    mkdirSync(contextDir, { recursive: true });
    const handle = new AgentHandle(def, contextDir);

    const t1 = handle.thinThread;
    const t2 = handle.thinThread;
    expect(t1).toBe(t2);
  });

  test("thinThread restores from existing conversation log", () => {
    const def = makeMinimalDef("alice");
    const contextDir = join(dir, ".agents", "alice");
    mkdirSync(join(contextDir, "conversations"), { recursive: true });

    // Pre-populate a conversation log
    const logPath = join(contextDir, "conversations", "personal.jsonl");
    const { writeFileSync } = require("node:fs");
    const msgs = [
      makeMsg("user", "first", "2026-03-01T10:00:00.000Z"),
      makeMsg("assistant", "second", "2026-03-01T10:00:01.000Z"),
      makeMsg("user", "third", "2026-03-01T10:00:02.000Z"),
    ];
    writeFileSync(logPath, msgs.map((m) => JSON.stringify(m)).join("\n") + "\n");

    const handle = new AgentHandle(def, contextDir);
    const thread = handle.thinThread;

    expect(thread.length).toBe(3);
    const restored = thread.getMessages();
    expect(restored[0]!.content).toBe("first");
    expect(restored[1]!.content).toBe("second");
    expect(restored[2]!.content).toBe("third");
  });

  test("ephemeral agent thinThread works (in-memory only)", () => {
    const def = makeMinimalDef("bob");
    const contextDir = join(dir, ".agents", "bob");
    const handle = new AgentHandle(def, contextDir, undefined, true);

    const thread = handle.thinThread;
    thread.push(makeMsg("user", "hello"));
    expect(thread.length).toBe(1);
    // No log file created
    expect(existsSync(join(contextDir, "conversations", "personal.jsonl"))).toBe(false);
  });
});
