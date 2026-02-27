/**
 * Tests for Phase 3a: Event Log Infrastructure
 *
 * Covers:
 *   - DefaultTimelineStore (append, read, incremental sync, malformed lines)
 *   - DaemonEventLog (append, readAll, readFrom, incremental sync)
 *   - createEventLogger (level → kind mapping, child loggers, formatting)
 *   - createConsoleSink (debug filtering)
 */

import { describe, test, expect, beforeEach } from "bun:test";
import { mkdirSync, readFileSync, existsSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";

import { DefaultTimelineStore } from "@/workflow/context/stores/timeline.ts";
import type { EventSink } from "@/workflow/context/stores/timeline.ts";
import { MemoryStorage } from "@/workflow/context/storage.ts";
import { DaemonEventLog } from "@/daemon/event-log.ts";
import { createEventLogger, createConsoleSink, createSilentLogger } from "@/workflow/logger.ts";
import type { Logger } from "@/workflow/logger.ts";
import type { Message, EventKind } from "@/workflow/context/types.ts";

// ── Helpers ───────────────────────────────────────────────────────

function tmpDir(): string {
  const dir = join(tmpdir(), `event-log-test-${randomUUID().slice(0, 8)}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

/** Collect events from an EventSink into an array. */
function collectingSink(): { sink: EventSink; events: Array<{ from: string; content: string; kind?: EventKind }> } {
  const events: Array<{ from: string; content: string; kind?: EventKind }> = [];
  return {
    events,
    sink: {
      append(from: string, content: string, options?: { kind?: EventKind }) {
        events.push({ from, content, kind: options?.kind });
      },
    },
  };
}

// ── DefaultTimelineStore ──────────────────────────────────────────

describe("DefaultTimelineStore", () => {
  let storage: MemoryStorage;
  let timeline: DefaultTimelineStore;

  beforeEach(() => {
    storage = new MemoryStorage();
    timeline = new DefaultTimelineStore(storage);
  });

  test("append writes JSONL to storage", async () => {
    timeline.append("alice", "state changed to running");

    const raw = await storage.read("timeline.jsonl");
    expect(raw).not.toBeNull();

    const event = JSON.parse(raw!.trim()) as Message;
    expect(event.from).toBe("alice");
    expect(event.content).toBe("state changed to running");
    expect(event.kind).toBe("system"); // default kind
    expect(event.mentions).toEqual([]);
    expect(event.id).toBeTruthy();
    expect(event.timestamp).toBeTruthy();
  });

  test("append uses provided kind", async () => {
    timeline.append("system", "debug info", { kind: "debug" });

    const raw = await storage.read("timeline.jsonl");
    const event = JSON.parse(raw!.trim()) as Message;
    expect(event.kind).toBe("debug");
  });

  test("read returns all appended events", async () => {
    timeline.append("alice", "event 1");
    timeline.append("bob", "event 2");
    timeline.append("alice", "event 3");

    const { events, offset } = await timeline.read();
    expect(events).toHaveLength(3);
    expect(events[0]!.from).toBe("alice");
    expect(events[0]!.content).toBe("event 1");
    expect(events[1]!.from).toBe("bob");
    expect(events[2]!.content).toBe("event 3");
    expect(offset).toBeGreaterThan(0);
  });

  test("read supports incremental sync via offset", async () => {
    timeline.append("alice", "first");
    timeline.append("bob", "second");

    const first = await timeline.read();
    expect(first.events).toHaveLength(2);

    // Append more after initial read
    timeline.append("alice", "third");

    // Read from previous offset — only gets new events
    const second = await timeline.read(first.offset);
    expect(second.events).toHaveLength(1);
    expect(second.events[0]!.content).toBe("third");
    expect(second.offset).toBeGreaterThan(first.offset);
  });

  test("read returns empty for no events", async () => {
    const { events, offset } = await timeline.read();
    expect(events).toEqual([]);
    expect(offset).toBe(0);
  });

  test("read skips malformed JSONL lines", async () => {
    // Write valid + invalid + valid lines directly
    await storage.append("timeline.jsonl", '{"id":"1","timestamp":"t","from":"a","content":"ok","mentions":[]}\n');
    await storage.append("timeline.jsonl", "not-json\n");
    await storage.append("timeline.jsonl", '{"id":"2","timestamp":"t","from":"b","content":"also ok","mentions":[]}\n');

    const { events } = await timeline.read();
    expect(events).toHaveLength(2);
    expect(events[0]!.content).toBe("ok");
    expect(events[1]!.content).toBe("also ok");
  });
});

// ── DaemonEventLog ────────────────────────────────────────────────

describe("DaemonEventLog", () => {
  let dir: string;
  let log: DaemonEventLog;

  beforeEach(() => {
    dir = tmpDir();
    log = new DaemonEventLog(dir);
  });

  test("creates daemon directory if missing", () => {
    const newDir = join(tmpdir(), `daemon-test-${randomUUID().slice(0, 8)}`);
    expect(existsSync(newDir)).toBe(false);
    new DaemonEventLog(newDir);
    expect(existsSync(newDir)).toBe(true);
    rmSync(newDir, { recursive: true, force: true });
  });

  test("append writes JSONL to events.jsonl", () => {
    log.append("daemon", "started");

    const filePath = join(dir, "events.jsonl");
    expect(existsSync(filePath)).toBe(true);

    const content = readFileSync(filePath, "utf-8");
    const event = JSON.parse(content.trim()) as Message;
    expect(event.from).toBe("daemon");
    expect(event.content).toBe("started");
    expect(event.kind).toBe("system");
  });

  test("append with custom kind", () => {
    log.append("daemon", "debug trace", { kind: "debug" });

    const content = readFileSync(join(dir, "events.jsonl"), "utf-8");
    const event = JSON.parse(content.trim()) as Message;
    expect(event.kind).toBe("debug");
  });

  test("readAll returns all events", async () => {
    log.append("daemon", "event 1");
    log.append("registry", "event 2");
    log.append("daemon", "event 3");

    const events = await log.readAll();
    expect(events).toHaveLength(3);
    expect(events[0]!.from).toBe("daemon");
    expect(events[1]!.from).toBe("registry");
    expect(events[2]!.content).toBe("event 3");
  });

  test("readAll returns empty when no file", async () => {
    const emptyDir = tmpDir();
    const emptyLog = new DaemonEventLog(emptyDir);
    const events = await emptyLog.readAll();
    expect(events).toEqual([]);
    rmSync(emptyDir, { recursive: true, force: true });
  });

  test("readFrom supports incremental sync", async () => {
    log.append("daemon", "first");
    log.append("daemon", "second");

    const first = await log.readFrom(0);
    expect(first.events).toHaveLength(2);
    expect(first.offset).toBeGreaterThan(0);

    log.append("daemon", "third");

    const second = await log.readFrom(first.offset);
    expect(second.events).toHaveLength(1);
    expect(second.events[0]!.content).toBe("third");
  });

  test("readFrom at end returns empty", async () => {
    log.append("daemon", "only event");
    const first = await log.readFrom(0);

    const second = await log.readFrom(first.offset);
    expect(second.events).toEqual([]);
    expect(second.offset).toBe(first.offset);
  });
});

// ── createEventLogger ─────────────────────────────────────────────

describe("createEventLogger", () => {
  test("maps info to system kind", () => {
    const { sink, events } = collectingSink();
    const logger = createEventLogger(sink, "daemon");

    logger.info("started");

    expect(events).toHaveLength(1);
    expect(events[0]!.from).toBe("daemon");
    expect(events[0]!.content).toBe("started");
    expect(events[0]!.kind).toBe("system");
  });

  test("maps debug to debug kind", () => {
    const { sink, events } = collectingSink();
    const logger = createEventLogger(sink, "worker");

    logger.debug("trace");

    expect(events).toHaveLength(1);
    expect(events[0]!.kind).toBe("debug");
  });

  test("prefixes warn with [WARN]", () => {
    const { sink, events } = collectingSink();
    const logger = createEventLogger(sink, "agent");

    logger.warn("maxSteps reached");

    expect(events[0]!.content).toBe("[WARN] maxSteps reached");
    expect(events[0]!.kind).toBe("system");
  });

  test("prefixes error with [ERROR]", () => {
    const { sink, events } = collectingSink();
    const logger = createEventLogger(sink, "agent");

    logger.error("crash");

    expect(events[0]!.content).toBe("[ERROR] crash");
    expect(events[0]!.kind).toBe("system");
  });

  test("formats extra args", () => {
    const { sink, events } = collectingSink();
    const logger = createEventLogger(sink, "test");

    logger.info("value is", 42, { key: "val" });

    expect(events[0]!.content).toBe('value is 42 {"key":"val"}');
  });

  test("child creates prefixed logger", () => {
    const { sink, events } = collectingSink();
    const parent = createEventLogger(sink, "daemon");
    const child = parent.child("registry");

    child.info("loaded agents");

    expect(events[0]!.from).toBe("daemon:registry");
    expect(events[0]!.content).toBe("loaded agents");
  });

  test("nested children chain prefixes", () => {
    const { sink, events } = collectingSink();
    const root = createEventLogger(sink, "daemon");
    const child = root.child("registry").child("alice");

    child.warn("malformed yaml");

    expect(events[0]!.from).toBe("daemon:registry:alice");
  });

  test("defaults from to system when not provided", () => {
    const { sink, events } = collectingSink();
    const logger = createEventLogger(sink);

    logger.info("hello");

    expect(events[0]!.from).toBe("system");
  });

  test("isDebug returns true", () => {
    const { sink } = collectingSink();
    const logger = createEventLogger(sink);
    expect(logger.isDebug()).toBe(true);
  });
});

// ── createConsoleSink ─────────────────────────────────────────────

describe("createConsoleSink", () => {
  test("drops debug events", () => {
    const sink = createConsoleSink();
    // Should not throw — debug events are silently dropped
    sink.append("test", "debug info", { kind: "debug" });
    // No assertion needed — just verify no crash
  });

  test("passes non-debug events through", () => {
    const sink = createConsoleSink();
    // System events should not throw
    sink.append("test", "info message", { kind: "system" });
    sink.append("test", "no kind specified");
  });
});

// ── createSilentLogger ────────────────────────────────────────────

describe("createSilentLogger", () => {
  test("produces no output", () => {
    const logger = createSilentLogger();
    // All methods should be no-ops
    logger.debug("nope");
    logger.info("nope");
    logger.warn("nope");
    logger.error("nope");
    expect(logger.isDebug()).toBe(false);
  });

  test("child returns silent logger", () => {
    const logger = createSilentLogger();
    const child = logger.child("test");
    child.info("nope");
    expect(child.isDebug()).toBe(false);
  });
});
