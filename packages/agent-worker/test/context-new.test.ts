/**
 * Phase 2 gate test: context (channel + inbox)
 *
 * Verifies: channel_send → @mention parsed → inbox returns unread →
 * ack → inbox empty. Resources auto-created for long messages.
 */
import { describe, test, expect } from "bun:test";
import { openMemoryDatabase } from "../src/daemon/db.ts";
import { createAgent, createWorkflow } from "../src/daemon/registry.ts";
import {
  channelSend,
  channelRead,
  inboxQuery,
  inboxAck,
  inboxAckAll,
  resourceCreate,
  resourceRead,
} from "../src/daemon/context.ts";
import { extractMentions, calculatePriority } from "../src/shared/types.ts";

// Helper: create a standard test setup
function setup() {
  const db = openMemoryDatabase();
  createWorkflow(db, { name: "review", tag: "pr-1" });
  createAgent(db, { name: "alice", model: "claude-sonnet-4-5", workflow: "review", tag: "pr-1" });
  createAgent(db, { name: "bob", model: "claude-sonnet-4-5", workflow: "review", tag: "pr-1" });
  createAgent(db, { name: "charlie", model: "gpt-4o", workflow: "review", tag: "pr-1" });
  return db;
}

// ==================== @mention parsing ====================

describe("extractMentions", () => {
  test("extracts valid agent mentions", () => {
    const agents = ["alice", "bob", "charlie"];
    expect(extractMentions("@alice please review", agents)).toEqual(["alice"]);
    expect(extractMentions("@alice and @bob look at this", agents)).toEqual(["alice", "bob"]);
  });

  test("ignores unknown mentions", () => {
    const agents = ["alice", "bob"];
    expect(extractMentions("@unknown please review", agents)).toEqual([]);
    expect(extractMentions("@alice and @unknown", agents)).toEqual(["alice"]);
  });

  test("deduplicates mentions", () => {
    const agents = ["alice"];
    expect(extractMentions("@alice then @alice again", agents)).toEqual(["alice"]);
  });

  test("handles @all", () => {
    const agents = ["alice", "bob", "all"];
    expect(extractMentions("@all sync up", agents)).toEqual(["all"]);
  });

  test("no mentions", () => {
    expect(extractMentions("no mentions here", ["alice"])).toEqual([]);
  });
});

// ==================== Channel ====================

describe("channelSend", () => {
  test("stores structured message with parsed recipients", () => {
    const db = setup();

    const result = channelSend(db, "alice", "@bob please review this code", "review", "pr-1");

    expect(result.id).toBeTruthy();
    expect(result.recipients).toEqual(["bob"]);

    const messages = channelRead(db, "review", "pr-1");
    expect(messages.length).toBe(1);
    expect(messages[0].sender).toBe("alice");
    expect(messages[0].content).toBe("@bob please review this code");
    expect(messages[0].recipients).toEqual(["bob"]);
    expect(messages[0].kind).toBe("message");

    db.close();
  });

  test("expands @all to all agents except sender", () => {
    const db = setup();

    const result = channelSend(db, "alice", "@all sync up", "review", "pr-1");

    expect(result.recipients).toContain("bob");
    expect(result.recipients).toContain("charlie");
    expect(result.recipients).not.toContain("alice");

    db.close();
  });

  test("handles DM (to parameter)", () => {
    const db = setup();

    const result = channelSend(db, "alice", "private note", "review", "pr-1", { to: "bob" });

    expect(result.recipients).toEqual(["bob"]);

    db.close();
  });

  test("auto-creates resource for long messages", () => {
    const db = setup();

    const longContent = "x".repeat(1500);
    const result = channelSend(db, "alice", longContent, "review", "pr-1");

    const messages = channelRead(db, "review", "pr-1");
    expect(messages[0].content).toContain("[Resource res_");

    db.close();
  });
});

describe("channelRead", () => {
  test("reads messages in chronological order", () => {
    const db = setup();

    channelSend(db, "alice", "first", "review", "pr-1");
    channelSend(db, "bob", "second", "review", "pr-1");
    channelSend(db, "charlie", "third", "review", "pr-1");

    const messages = channelRead(db, "review", "pr-1");
    expect(messages.length).toBe(3);
    expect(messages[0].content).toBe("first");
    expect(messages[1].content).toBe("second");
    expect(messages[2].content).toBe("third");

    db.close();
  });

  test("reads with limit", () => {
    const db = setup();

    for (let i = 0; i < 10; i++) {
      channelSend(db, "alice", `msg-${i}`, "review", "pr-1");
    }

    const messages = channelRead(db, "review", "pr-1", { limit: 3 });
    expect(messages.length).toBe(3);
    // Should be the last 3 messages (most recent)
    expect(messages[0].content).toBe("msg-7");
    expect(messages[2].content).toBe("msg-9");

    db.close();
  });

  test("reads since a message ID", () => {
    const db = setup();

    const r1 = channelSend(db, "alice", "msg-1", "review", "pr-1");
    channelSend(db, "bob", "msg-2", "review", "pr-1");
    channelSend(db, "charlie", "msg-3", "review", "pr-1");

    const messages = channelRead(db, "review", "pr-1", { since: r1.id });
    expect(messages.length).toBe(2);
    expect(messages[0].content).toBe("msg-2");
    expect(messages[1].content).toBe("msg-3");

    db.close();
  });

  test("isolates workflows", () => {
    const db = setup();
    createWorkflow(db, { name: "deploy", tag: "main" });

    channelSend(db, "alice", "review msg", "review", "pr-1");

    const reviewMsgs = channelRead(db, "review", "pr-1");
    expect(reviewMsgs.length).toBe(1);

    const deployMsgs = channelRead(db, "deploy", "main");
    expect(deployMsgs.length).toBe(0);

    db.close();
  });
});

// ==================== Inbox ====================

describe("inboxQuery", () => {
  test("returns unread messages for agent", () => {
    const db = setup();

    channelSend(db, "alice", "@bob please review", "review", "pr-1");
    channelSend(db, "alice", "@charlie check tests", "review", "pr-1");

    const bobInbox = inboxQuery(db, "bob", "review", "pr-1");
    expect(bobInbox.length).toBe(1);
    expect(bobInbox[0].message.content).toBe("@bob please review");

    const charlieInbox = inboxQuery(db, "charlie", "review", "pr-1");
    expect(charlieInbox.length).toBe(1);
    expect(charlieInbox[0].message.content).toBe("@charlie check tests");

    db.close();
  });

  test("does not include own messages", () => {
    const db = setup();

    channelSend(db, "alice", "@alice reminder to self", "review", "pr-1");

    const aliceInbox = inboxQuery(db, "alice", "review", "pr-1");
    expect(aliceInbox.length).toBe(0);

    db.close();
  });

  test("ack advances cursor — messages disappear from inbox", () => {
    const db = setup();

    const r1 = channelSend(db, "alice", "@bob first task", "review", "pr-1");
    channelSend(db, "alice", "@bob second task", "review", "pr-1");

    // Before ack: 2 messages
    expect(inboxQuery(db, "bob", "review", "pr-1").length).toBe(2);

    // Ack first message
    inboxAck(db, "bob", "review", "pr-1", r1.id);

    // After ack: 1 message (only second)
    const remaining = inboxQuery(db, "bob", "review", "pr-1");
    expect(remaining.length).toBe(1);
    expect(remaining[0].message.content).toBe("@bob second task");

    db.close();
  });

  test("ackAll clears entire inbox", () => {
    const db = setup();

    channelSend(db, "alice", "@bob task 1", "review", "pr-1");
    channelSend(db, "alice", "@bob task 2", "review", "pr-1");
    channelSend(db, "alice", "@bob task 3", "review", "pr-1");

    inboxAckAll(db, "bob", "review", "pr-1");

    expect(inboxQuery(db, "bob", "review", "pr-1").length).toBe(0);

    db.close();
  });

  test("new messages after ack appear in inbox", () => {
    const db = setup();

    const r1 = channelSend(db, "alice", "@bob old message", "review", "pr-1");
    inboxAck(db, "bob", "review", "pr-1", r1.id);

    // New message after ack
    channelSend(db, "alice", "@bob new message", "review", "pr-1");

    const inbox = inboxQuery(db, "bob", "review", "pr-1");
    expect(inbox.length).toBe(1);
    expect(inbox[0].message.content).toBe("@bob new message");

    db.close();
  });

  test("@all messages appear in all agents' inboxes", () => {
    const db = setup();

    channelSend(db, "alice", "@all standup time", "review", "pr-1");

    expect(inboxQuery(db, "bob", "review", "pr-1").length).toBe(1);
    expect(inboxQuery(db, "charlie", "review", "pr-1").length).toBe(1);
    // Sender doesn't get it
    expect(inboxQuery(db, "alice", "review", "pr-1").length).toBe(0);

    db.close();
  });
});

// ==================== Priority ====================

describe("calculatePriority", () => {
  test("high priority for multiple recipients", () => {
    const msg = { recipients: ["alice", "bob"] } as any;
    expect(calculatePriority(msg)).toBe("high");
  });

  test("high priority for urgent keywords", () => {
    const msg = { content: "URGENT: fix this now", recipients: ["alice"] } as any;
    expect(calculatePriority(msg)).toBe("high");
  });

  test("normal priority for regular messages", () => {
    const msg = { content: "please review when you can", recipients: ["alice"] } as any;
    expect(calculatePriority(msg)).toBe("normal");
  });
});

// ==================== Resources ====================

describe("resources", () => {
  test("create and read resource", () => {
    const db = setup();

    const resource = resourceCreate(db, "large content here", "markdown", "alice", "review", "pr-1");
    expect(resource.id).toMatch(/^res_/);
    expect(resource.content).toBe("large content here");
    expect(resource.type).toBe("markdown");
    expect(resource.createdBy).toBe("alice");

    const fetched = resourceRead(db, resource.id);
    expect(fetched).not.toBeNull();
    expect(fetched!.content).toBe("large content here");

    db.close();
  });

  test("returns null for non-existent resource", () => {
    const db = setup();
    expect(resourceRead(db, "res_nonexistent")).toBeNull();
    db.close();
  });
});
