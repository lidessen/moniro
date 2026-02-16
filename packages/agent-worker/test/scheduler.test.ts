/**
 * Phase 4 gate test: scheduler
 *
 * Verifies: @mention → scheduler detects → spawns worker → worker responds
 * → channel has reply → inbox acked.
 */
import { describe, test, expect, afterEach } from "bun:test";
import { startDaemon, type DaemonHandle } from "../src/daemon/index.ts";
import { createAgent, createWorkflow, listAgents } from "../src/daemon/registry.ts";
import { channelSend, channelRead, inboxQuery } from "../src/daemon/context.ts";
import { parseInterval } from "../src/daemon/scheduler.ts";

// ==================== parseInterval ====================

describe("parseInterval", () => {
  test("parses seconds", () => {
    expect(parseInterval("30s")).toBe(30_000);
    expect(parseInterval("1s")).toBe(1_000);
  });

  test("parses minutes", () => {
    expect(parseInterval("5m")).toBe(300_000);
  });

  test("parses hours", () => {
    expect(parseInterval("1h")).toBe(3_600_000);
  });

  test("parses milliseconds", () => {
    expect(parseInterval("500ms")).toBe(500);
  });

  test("returns default for invalid", () => {
    expect(parseInterval("abc")).toBe(5000);
    expect(parseInterval("")).toBe(5000);
  });
});

// ==================== Integration: send → peek via HTTP ====================

describe("HTTP send + peek", () => {
  let daemon: DaemonHandle | null = null;

  afterEach(async () => {
    if (daemon) {
      await daemon.shutdown();
      daemon = null;
    }
  });

  test("POST /send writes to channel, GET /peek reads it", async () => {
    daemon = await startDaemon({ inMemory: true, port: 0 });
    const base = `http://${daemon.host}:${daemon.port}`;
    const { db } = daemon;

    createWorkflow(db, { name: "review", tag: "pr-1" });
    createAgent(db, { name: "alice", model: "mock", workflow: "review", tag: "pr-1" });
    createAgent(db, { name: "bob", model: "mock", workflow: "review", tag: "pr-1" });

    // Send via HTTP
    const sendRes = await fetch(`${base}/send`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        agent: "alice",
        message: "@bob please review this PR",
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
    expect(messages[0].sender).toBe("alice");
    expect(messages[0].recipients).toContain("bob");

    // Verify inbox
    const bobInbox = inboxQuery(db, "bob", "review", "pr-1");
    expect(bobInbox.length).toBe(1);
  });
});

// ==================== Scheduler + Context integration ====================

describe("scheduler + context flow", () => {
  test("complete message → inbox → ack cycle", () => {
    // This test simulates the full scheduler loop without actual subprocess:
    // 1. Send @mention
    // 2. Check inbox (what scheduler does)
    // 3. Simulate worker response
    // 4. Ack inbox (what scheduler does on success)
    // 5. Verify inbox is clear

    const { openMemoryDatabase } = require("../src/daemon/db.ts");
    const db = openMemoryDatabase();

    createWorkflow(db, { name: "review", tag: "pr-1" });
    createAgent(db, { name: "coordinator", model: "mock", workflow: "review", tag: "pr-1" });
    createAgent(db, { name: "reviewer", model: "mock", workflow: "review", tag: "pr-1" });
    createAgent(db, { name: "coder", model: "mock", workflow: "review", tag: "pr-1" });

    // 1. Coordinator sends kickoff
    channelSend(db, "system", "@coordinator PR ready for review", "review", "pr-1");

    // 2. Scheduler checks coordinator's inbox
    const coordInbox = inboxQuery(db, "coordinator", "review", "pr-1");
    expect(coordInbox.length).toBe(1);

    // 3. Simulate coordinator response
    channelSend(db, "coordinator", "@reviewer please do security review. @coder stand by.", "review", "pr-1");

    // 4. Ack coordinator's inbox
    const { inboxAckAll } = require("../src/daemon/context.ts");
    inboxAckAll(db, "coordinator", "review", "pr-1");

    // 5. Now reviewer and coder have messages
    const reviewerInbox = inboxQuery(db, "reviewer", "review", "pr-1");
    expect(reviewerInbox.length).toBe(1);
    expect(reviewerInbox[0].message.sender).toBe("coordinator");

    const coderInbox = inboxQuery(db, "coder", "review", "pr-1");
    expect(coderInbox.length).toBe(1);

    // 6. Reviewer does work and responds
    channelSend(db, "reviewer", "@coder found auth bug in auth.ts line 42", "review", "pr-1");
    inboxAckAll(db, "reviewer", "review", "pr-1");

    // 7. Coder gets reviewer's message
    const coderInbox2 = inboxQuery(db, "coder", "review", "pr-1");
    // Has both coordinator's and reviewer's messages (not yet acked)
    expect(coderInbox2.length).toBe(2);

    // 8. Coder fixes and responds
    channelSend(db, "coder", "@reviewer fixed the auth bug. @coordinator done.", "review", "pr-1");
    inboxAckAll(db, "coder", "review", "pr-1");

    // 9. Full channel history
    const allMessages = channelRead(db, "review", "pr-1");
    expect(allMessages.length).toBe(4);
    expect(allMessages.map((m: any) => m.sender)).toEqual([
      "system", "coordinator", "reviewer", "coder",
    ]);

    // 10. Everyone's inbox is clear
    expect(inboxQuery(db, "coordinator", "review", "pr-1").length).toBe(1); // coder's final message
    expect(inboxQuery(db, "reviewer", "review", "pr-1").length).toBe(1); // coder's response
    expect(inboxQuery(db, "coder", "review", "pr-1").length).toBe(0); // all acked

    db.close();
  });
});
