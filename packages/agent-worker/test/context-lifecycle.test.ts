/**
 * Context Lifecycle Tests
 *
 * Tests for:
 * 1. ContextProvider.destroy() lifecycle
 * 2. Cross-instance data isolation (FileContextProvider)
 * 3. Resume semantics (reconnecting to existing context directory)
 * 4. Instance lock mechanism
 * 5. Concurrent write safety (single-process)
 */
import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdirSync, rmSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import {
  MemoryContextProvider,
  createFileContextProvider,
} from "../src/workflow/context/index.ts";

// ==================== destroy() Lifecycle Tests ====================

describe("ContextProvider.destroy()", () => {
  describe("MemoryContextProvider", () => {
    test("destroy clears transient state but preserves persistent data", async () => {
      const provider = new MemoryContextProvider(["agent1", "agent2"]);

      // Write some data
      const msg = await provider.appendChannel("agent1", "@agent2 hello");
      await provider.writeDocument("some content");
      await provider.ackInbox("agent2", msg.id);

      // Destroy
      await provider.destroy();

      // Channel and documents should be preserved
      expect(await provider.readChannel()).toHaveLength(1);
      expect(await provider.readDocument()).toBe("some content");

      // Inbox state (transient) should be cleared
      expect(await provider.getInboxState("agent2")).toBeUndefined();
    });
  });

  describe("FileContextProvider", () => {
    let testDir: string;

    beforeEach(() => {
      testDir = join(
        tmpdir(),
        `lifecycle-test-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      );
      mkdirSync(testDir, { recursive: true });
    });

    afterEach(() => {
      rmSync(testDir, { recursive: true, force: true });
    });

    test("destroy cleans up inbox state but preserves channel and documents", async () => {
      const provider = createFileContextProvider(testDir, ["agent1", "agent2"]);

      // Write data
      const msg = await provider.appendChannel("agent1", "@agent2 hello");
      await provider.writeDocument("important notes");
      await provider.ackInbox("agent2", msg.id);

      // Verify inbox state exists before destroy
      expect(existsSync(join(testDir, "_state", "inbox.json"))).toBe(true);

      // Destroy
      await provider.destroy();

      // Channel log should be preserved (it's a persistent log)
      expect(existsSync(join(testDir, "channel.jsonl"))).toBe(true);
      const channelContent = readFileSync(join(testDir, "channel.jsonl"), "utf-8");
      expect(channelContent).toContain("hello");

      // Documents should be preserved
      expect(await provider.readDocument()).toBe("important notes");

      // Inbox state should be cleaned up (transient state)
      expect(existsSync(join(testDir, "_state", "inbox.json"))).toBe(false);
    });

    test("destroy releases instance lock", async () => {
      const provider = createFileContextProvider(testDir, ["agent1"]);
      provider.acquireLock();

      expect(existsSync(join(testDir, "_state", "instance.lock"))).toBe(true);

      await provider.destroy();

      expect(existsSync(join(testDir, "_state", "instance.lock"))).toBe(false);
    });
  });
});

// ==================== Cross-Instance Isolation Tests ====================

describe("Cross-Instance Isolation", () => {
  let baseDir: string;
  let instanceADir: string;
  let instanceBDir: string;

  beforeEach(() => {
    baseDir = join(
      tmpdir(),
      `isolation-test-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    );
    instanceADir = join(baseDir, "instance-a");
    instanceBDir = join(baseDir, "instance-b");
    mkdirSync(instanceADir, { recursive: true });
    mkdirSync(instanceBDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(baseDir, { recursive: true, force: true });
  });

  test("messages in instance A do not appear in instance B", async () => {
    const providerA = createFileContextProvider(instanceADir, ["alice", "bob"]);
    const providerB = createFileContextProvider(instanceBDir, ["alice", "bob"]);

    await providerA.appendChannel("alice", "Hello from instance A");
    await providerB.appendChannel("bob", "Hello from instance B");

    const messagesA = await providerA.readChannel();
    const messagesB = await providerB.readChannel();

    expect(messagesA).toHaveLength(1);
    expect(messagesA[0]!.content).toBe("Hello from instance A");

    expect(messagesB).toHaveLength(1);
    expect(messagesB[0]!.content).toBe("Hello from instance B");
  });

  test("inbox state in instance A does not affect instance B", async () => {
    const providerA = createFileContextProvider(instanceADir, ["alice", "bob"]);
    const providerB = createFileContextProvider(instanceBDir, ["alice", "bob"]);

    // Send mentions in both instances
    await providerA.appendChannel("alice", "@bob check this");
    await providerB.appendChannel("alice", "@bob different task");

    // Acknowledge in instance A
    const inboxA = await providerA.getInbox("bob");
    await providerA.ackInbox("bob", inboxA[0]!.entry.id);

    // Instance B should still have unread messages
    const inboxB = await providerB.getInbox("bob");
    expect(inboxB).toHaveLength(1);
    expect(inboxB[0]!.entry.content).toBe("@bob different task");
  });

  test("documents in instance A do not appear in instance B", async () => {
    const providerA = createFileContextProvider(instanceADir, ["alice"]);
    const providerB = createFileContextProvider(instanceBDir, ["alice"]);

    await providerA.writeDocument("Instance A notes");
    await providerB.writeDocument("Instance B notes");

    expect(await providerA.readDocument()).toBe("Instance A notes");
    expect(await providerB.readDocument()).toBe("Instance B notes");
  });

  test("resources in instance A do not appear in instance B", async () => {
    const providerA = createFileContextProvider(instanceADir, ["alice"]);
    const providerB = createFileContextProvider(instanceBDir, ["alice"]);

    const resA = await providerA.createResource("Resource A content", "alice");
    const resB = await providerB.createResource("Resource B content", "alice");

    // Each instance can only read its own resources
    expect(await providerA.readResource(resA.id)).toBe("Resource A content");
    expect(await providerA.readResource(resB.id)).toBeNull();

    expect(await providerB.readResource(resB.id)).toBe("Resource B content");
    expect(await providerB.readResource(resA.id)).toBeNull();
  });

  test("destroy of instance A does not affect instance B", async () => {
    const providerA = createFileContextProvider(instanceADir, ["alice", "bob"]);
    const providerB = createFileContextProvider(instanceBDir, ["alice", "bob"]);

    const msgA = await providerA.appendChannel("alice", "@bob task A");
    const msgB = await providerB.appendChannel("alice", "@bob task B");
    await providerA.ackInbox("bob", msgA.id);
    await providerB.ackInbox("bob", msgB.id);

    // Destroy instance A
    await providerA.destroy();

    // Instance B inbox state should be unaffected
    const statePath = join(instanceBDir, "_state", "inbox.json");
    expect(existsSync(statePath)).toBe(true);

    // Instance B channel should still have its messages
    const messagesB = await providerB.readChannel();
    expect(messagesB).toHaveLength(1);
    expect(messagesB[0]!.content).toBe("@bob task B");
  });
});

// ==================== Resume Semantics Tests ====================

describe("Resume Semantics", () => {
  let testDir: string;

  beforeEach(() => {
    testDir = join(
      tmpdir(),
      `resume-test-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    );
    mkdirSync(testDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true });
  });

  test("new provider sees existing channel messages", async () => {
    // First session
    const provider1 = createFileContextProvider(testDir, ["alice", "bob"]);
    await provider1.appendChannel("alice", "First session message");
    await provider1.appendChannel("bob", "Response from first session");

    // Second session (reconnecting to same dir)
    const provider2 = createFileContextProvider(testDir, ["alice", "bob"]);
    const messages = await provider2.readChannel();

    expect(messages).toHaveLength(2);
    expect(messages[0]!.content).toBe("First session message");
    expect(messages[1]!.content).toBe("Response from first session");
  });

  test("new provider sees existing documents", async () => {
    const provider1 = createFileContextProvider(testDir, ["alice"]);
    await provider1.writeDocument("# Progress Notes\n- Task 1 done");

    const provider2 = createFileContextProvider(testDir, ["alice"]);
    expect(await provider2.readDocument()).toBe("# Progress Notes\n- Task 1 done");
  });

  test("new provider can append to existing channel", async () => {
    const provider1 = createFileContextProvider(testDir, ["alice", "bob"]);
    await provider1.appendChannel("alice", "From session 1");

    const provider2 = createFileContextProvider(testDir, ["alice", "bob"]);
    await provider2.appendChannel("bob", "From session 2");

    const messages = await provider2.readChannel();
    expect(messages).toHaveLength(2);
    expect(messages[0]!.content).toBe("From session 1");
    expect(messages[1]!.content).toBe("From session 2");
  });

  test("inbox state resets after destroy + reconnect", async () => {
    const provider1 = createFileContextProvider(testDir, ["alice", "bob"]);
    await provider1.appendChannel("alice", "@bob check this");
    const inbox1 = await provider1.getInbox("bob");
    await provider1.ackInbox("bob", inbox1[0]!.entry.id);

    // Verify bob has no unread messages
    expect(await provider1.getInbox("bob")).toHaveLength(0);

    // Destroy (clears inbox state)
    await provider1.destroy();

    // Reconnect
    const provider2 = createFileContextProvider(testDir, ["alice", "bob"]);
    // Bob should see the message again since inbox state was cleared
    const inbox2 = await provider2.getInbox("bob");
    expect(inbox2).toHaveLength(1);
    expect(inbox2[0]!.entry.content).toBe("@bob check this");
  });

  test("resources survive provider recreation", async () => {
    const provider1 = createFileContextProvider(testDir, ["alice"]);
    const res = await provider1.createResource("Persistent blob", "alice");

    const provider2 = createFileContextProvider(testDir, ["alice"]);
    expect(await provider2.readResource(res.id)).toBe("Persistent blob");
  });
});

// ==================== Instance Lock Tests ====================

describe("Instance Lock", () => {
  let testDir: string;

  beforeEach(() => {
    testDir = join(
      tmpdir(),
      `lock-test-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    );
    mkdirSync(testDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true });
  });

  test("acquireLock creates lock file", () => {
    const provider = createFileContextProvider(testDir, ["alice"]);
    provider.acquireLock();

    const lockPath = join(testDir, "_state", "instance.lock");
    expect(existsSync(lockPath)).toBe(true);

    const lock = JSON.parse(readFileSync(lockPath, "utf-8"));
    expect(lock.pid).toBe(process.pid);
    expect(lock.startedAt).toBeDefined();

    provider.releaseLock();
  });

  test("releaseLock removes lock file", () => {
    const provider = createFileContextProvider(testDir, ["alice"]);
    provider.acquireLock();
    provider.releaseLock();

    expect(existsSync(join(testDir, "_state", "instance.lock"))).toBe(false);
  });

  test("acquireLock cleans up stale lock from dead process", () => {
    // Write a lock file with a fake (dead) PID
    const stateDir = join(testDir, "_state");
    mkdirSync(stateDir, { recursive: true });
    writeFileSync(
      join(stateDir, "instance.lock"),
      JSON.stringify({ pid: 999999999, startedAt: "2020-01-01T00:00:00Z" }),
    );

    // Should succeed because PID 999999999 doesn't exist
    const provider = createFileContextProvider(testDir, ["alice"]);
    expect(() => provider.acquireLock()).not.toThrow();

    // Lock should now be ours
    const lock = JSON.parse(readFileSync(join(stateDir, "instance.lock"), "utf-8"));
    expect(lock.pid).toBe(process.pid);

    provider.releaseLock();
  });

  test("acquireLock throws when locked by live process (self)", () => {
    const provider1 = createFileContextProvider(testDir, ["alice"]);
    provider1.acquireLock();

    // Second provider trying to lock the same dir should fail
    const provider2 = createFileContextProvider(testDir, ["alice"]);
    expect(() => provider2.acquireLock()).toThrow("Context directory is locked");

    provider1.releaseLock();
  });

  test("releaseLock only releases own lock", () => {
    // Write a lock file owned by a different PID
    const stateDir = join(testDir, "_state");
    mkdirSync(stateDir, { recursive: true });
    const otherPid = process.pid + 1; // Different PID (won't exist as a real lock)
    writeFileSync(
      join(stateDir, "instance.lock"),
      JSON.stringify({ pid: otherPid, startedAt: "2020-01-01T00:00:00Z" }),
    );

    const provider = createFileContextProvider(testDir, ["alice"]);
    provider.releaseLock();

    // Lock file should still exist (not ours to release)
    expect(existsSync(join(stateDir, "instance.lock"))).toBe(true);
  });

  test("acquireLock handles malformed lock file", () => {
    const stateDir = join(testDir, "_state");
    mkdirSync(stateDir, { recursive: true });
    writeFileSync(join(stateDir, "instance.lock"), "not json");

    // Should clean up malformed lock and succeed
    const provider = createFileContextProvider(testDir, ["alice"]);
    expect(() => provider.acquireLock()).not.toThrow();

    provider.releaseLock();
  });
});

// ==================== Concurrent Write Safety Tests ====================

describe("Concurrent Write Safety (single process)", () => {
  test("parallel appendChannel calls do not lose messages (MemoryProvider)", async () => {
    const provider = new MemoryContextProvider(["a", "b", "c"]);

    // Fire 20 concurrent appends
    const promises = Array.from({ length: 20 }, (_, i) =>
      provider.appendChannel(`agent-${i % 3}`, `Message ${i}`),
    );
    await Promise.all(promises);

    const messages = await provider.readChannel();
    expect(messages).toHaveLength(20);
  });

  test("parallel appendChannel calls do not lose messages (FileProvider)", async () => {
    const testDir = join(
      tmpdir(),
      `concurrent-test-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    );
    mkdirSync(testDir, { recursive: true });

    try {
      const provider = createFileContextProvider(testDir, ["a", "b", "c"]);

      // Fire 20 concurrent appends
      const promises = Array.from({ length: 20 }, (_, i) =>
        provider.appendChannel(`agent-${i % 3}`, `Message ${i}`),
      );
      await Promise.all(promises);

      const messages = await provider.readChannel();
      expect(messages).toHaveLength(20);

      // All messages should be distinct
      const contents = new Set(messages.map((m) => m.content));
      expect(contents.size).toBe(20);
    } finally {
      rmSync(testDir, { recursive: true, force: true });
    }
  });

  test("message IDs are unique even for rapid concurrent writes", async () => {
    const provider = new MemoryContextProvider(["alice"]);

    const promises = Array.from({ length: 50 }, (_, i) =>
      provider.appendChannel("alice", `Rapid message ${i}`),
    );
    const results = await Promise.all(promises);

    const ids = results.map((r) => r.id);
    const uniqueIds = new Set(ids);

    // All IDs should be unique (nanoid ensures this)
    expect(uniqueIds.size).toBe(50);
  });

  test("concurrent getInbox and appendChannel do not corrupt state", async () => {
    const provider = new MemoryContextProvider(["alice", "bob"]);

    // Interleave writes and reads
    const writes = Array.from({ length: 10 }, (_, i) =>
      provider.appendChannel("alice", `@bob message ${i}`),
    );
    const reads = Array.from({ length: 10 }, () => provider.getInbox("bob"));

    await Promise.all([...writes, ...reads]);

    // Final state should be consistent
    const finalInbox = await provider.getInbox("bob");
    expect(finalInbox.length).toBe(10);
    expect(finalInbox.every((m) => m.entry.from === "alice")).toBe(true);
  });
});

// ==================== Bind (Persistent) Context Tests ====================

describe("Bind (Persistent) Context", () => {
  let testDir: string;

  beforeEach(() => {
    testDir = join(
      tmpdir(),
      `bind-test-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    );
    mkdirSync(testDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true });
  });

  test("persistent context preserves inbox state across provider recreations", async () => {
    // Simulate bind mode: don't call destroy(), only releaseLock()
    const provider1 = createFileContextProvider(testDir, ["alice", "bob"]);
    provider1.acquireLock();

    await provider1.appendChannel("alice", "@bob review this PR");
    const inbox1 = await provider1.getInbox("bob");
    expect(inbox1).toHaveLength(1);

    // Ack the message
    await provider1.ackInbox("bob", inbox1[0]!.entry.id);
    expect(await provider1.getInbox("bob")).toHaveLength(0);

    // Persistent shutdown: only release lock, don't destroy
    provider1.releaseLock();

    // Next session: reconnect to same directory
    const provider2 = createFileContextProvider(testDir, ["alice", "bob"]);
    provider2.acquireLock();

    // Inbox state should be preserved (bob already acked)
    expect(await provider2.getInbox("bob")).toHaveLength(0);

    // New message should appear
    await provider2.appendChannel("alice", "@bob new changes pushed");
    expect(await provider2.getInbox("bob")).toHaveLength(1);

    provider2.releaseLock();
  });

  test("ephemeral context resets inbox state on destroy", async () => {
    // Simulate ephemeral mode: call destroy() on shutdown
    const provider1 = createFileContextProvider(testDir, ["alice", "bob"]);

    await provider1.appendChannel("alice", "@bob review this");
    await provider1.ackInbox("bob", (await provider1.getInbox("bob"))[0]!.entry.id);
    expect(await provider1.getInbox("bob")).toHaveLength(0);

    // Ephemeral shutdown: destroy clears inbox state
    await provider1.destroy();

    // Next session: bob sees old message again (inbox state was reset)
    const provider2 = createFileContextProvider(testDir, ["alice", "bob"]);
    const inbox = await provider2.getInbox("bob");
    expect(inbox).toHaveLength(1);
    expect(inbox[0]!.entry.content).toBe("@bob review this");
  });

  test("persistent context accumulates channel history across runs", async () => {
    // Run 1
    const provider1 = createFileContextProvider(testDir, ["alice", "bob"]);
    provider1.acquireLock();
    await provider1.appendChannel("alice", "Run 1: starting review");
    await provider1.appendChannel("bob", "Run 1: looks good");
    provider1.releaseLock();

    // Run 2
    const provider2 = createFileContextProvider(testDir, ["alice", "bob"]);
    provider2.acquireLock();
    await provider2.appendChannel("alice", "Run 2: new feature added");

    const allMessages = await provider2.readChannel();
    expect(allMessages).toHaveLength(3);
    expect(allMessages[0]!.content).toBe("Run 1: starting review");
    expect(allMessages[1]!.content).toBe("Run 1: looks good");
    expect(allMessages[2]!.content).toBe("Run 2: new feature added");

    provider2.releaseLock();
  });

  test("persistent context preserves documents across runs", async () => {
    // Run 1: create findings
    const provider1 = createFileContextProvider(testDir, ["alice"]);
    provider1.acquireLock();
    await provider1.writeDocument("# Run 1 Findings\n- Bug in auth module");
    await provider1.createDocument("api-review.md", "# API Review\n- Endpoint /users needs auth");
    provider1.releaseLock();

    // Run 2: continue from previous findings
    const provider2 = createFileContextProvider(testDir, ["alice"]);
    provider2.acquireLock();

    expect(await provider2.readDocument()).toBe("# Run 1 Findings\n- Bug in auth module");
    expect(await provider2.readDocument("api-review.md")).toBe(
      "# API Review\n- Endpoint /users needs auth",
    );

    // Append to existing document
    await provider2.appendDocument("\n- Also found XSS in comments");
    expect(await provider2.readDocument()).toBe(
      "# Run 1 Findings\n- Bug in auth module\n- Also found XSS in comments",
    );

    const docs = await provider2.listDocuments();
    expect(docs).toHaveLength(2);

    provider2.releaseLock();
  });

  test("bind with instance template creates separate dirs", () => {
    // Simulate what the parser does with ${{ instance }} in bind path
    const instanceA = join(testDir, "instance-a");
    const instanceB = join(testDir, "instance-b");
    mkdirSync(instanceA, { recursive: true });
    mkdirSync(instanceB, { recursive: true });

    const providerA = createFileContextProvider(instanceA, ["alice"]);
    const providerB = createFileContextProvider(instanceB, ["alice"]);

    providerA.acquireLock();
    providerB.acquireLock();

    // Both should work independently
    expect(existsSync(join(instanceA, "_state", "instance.lock"))).toBe(true);
    expect(existsSync(join(instanceB, "_state", "instance.lock"))).toBe(true);

    providerA.releaseLock();
    providerB.releaseLock();
  });
});

// ==================== DM Visibility Isolation Tests ====================

describe("DM Visibility Isolation", () => {
  test("DMs between two agents are invisible to third agent", async () => {
    const provider = new MemoryContextProvider(["alice", "bob", "charlie"]);

    // Alice sends DM to Bob
    await provider.appendChannel("alice", "Secret for Bob only", { to: "bob" });

    // Public message
    await provider.appendChannel("alice", "Hello everyone");

    // Charlie should only see the public message
    const charlieView = await provider.readChannel({ agent: "charlie" });
    expect(charlieView).toHaveLength(1);
    expect(charlieView[0]!.content).toBe("Hello everyone");

    // Bob should see both
    const bobView = await provider.readChannel({ agent: "bob" });
    expect(bobView).toHaveLength(2);

    // Alice (sender) should also see the DM
    const aliceView = await provider.readChannel({ agent: "alice" });
    expect(aliceView).toHaveLength(2);
  });

  test("DM creates inbox entry only for recipient", async () => {
    const provider = new MemoryContextProvider(["alice", "bob", "charlie"]);

    await provider.appendChannel("alice", "Private to bob", { to: "bob" });

    const bobInbox = await provider.getInbox("bob");
    const charlieInbox = await provider.getInbox("charlie");

    expect(bobInbox).toHaveLength(1);
    expect(charlieInbox).toHaveLength(0);
  });

  test("log entries are hidden from all agents", async () => {
    const provider = new MemoryContextProvider(["alice", "bob"]);

    await provider.appendChannel("system", "Internal log entry", { kind: "log" });
    await provider.appendChannel("alice", "Public message");

    // Both agents should only see the public message
    const aliceView = await provider.readChannel({ agent: "alice" });
    expect(aliceView).toHaveLength(1);
    expect(aliceView[0]!.content).toBe("Public message");

    // Unfiltered view should see both
    const allEntries = await provider.readChannel();
    expect(allEntries).toHaveLength(2);
  });
});
