/**
 * Phase 6 gate test: remaining features
 *
 * Verifies: proposals, documents, workflow lifecycle, backend factory.
 */
import { describe, test, expect, afterEach } from "bun:test";
import { rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { openMemoryDatabase } from "../src/daemon/db.ts";
import { createAgent, createWorkflow } from "../src/daemon/registry.ts";
import {
  proposalCreate,
  proposalGet,
  proposalList,
  proposalVote,
  proposalCancel,
  voteList,
} from "../src/daemon/proposals.ts";
import { createFileDocumentProvider } from "../src/daemon/documents/file-provider.ts";
import { startDaemon, type DaemonHandle } from "../src/daemon/index.ts";
import { createBackend } from "../src/worker/backends/index.ts";

// ==================== Proposals ====================

describe("proposals", () => {
  function setup() {
    const db = openMemoryDatabase();
    createWorkflow(db, { name: "review", tag: "pr-1" });
    createAgent(db, { name: "alice", model: "mock", workflow: "review", tag: "pr-1" });
    createAgent(db, { name: "bob", model: "mock", workflow: "review", tag: "pr-1" });
    createAgent(db, { name: "charlie", model: "mock", workflow: "review", tag: "pr-1" });
    return db;
  }

  test("create proposal", () => {
    const db = setup();

    const proposal = proposalCreate(db, {
      type: "decision",
      title: "Which framework?",
      options: ["React", "Vue", "Svelte"],
      creator: "alice",
      workflow: "review",
      tag: "pr-1",
    });

    expect(proposal.id).toMatch(/^prop_/);
    expect(proposal.title).toBe("Which framework?");
    expect(proposal.options).toEqual(["React", "Vue", "Svelte"]);
    expect(proposal.status).toBe("active");
    expect(proposal.creator).toBe("alice");
    expect(proposal.resolution).toBe("plurality");
    expect(proposal.binding).toBe(true);

    db.close();
  });

  test("vote and check resolution", () => {
    const db = setup();

    const proposal = proposalCreate(db, {
      type: "decision",
      title: "Which framework?",
      options: ["React", "Vue"],
      creator: "alice",
      workflow: "review",
      tag: "pr-1",
    });

    // First vote
    const r1 = proposalVote(db, proposal.id, "alice", "React");
    expect(r1.success).toBe(true);
    expect(r1.resolved).toBeUndefined();

    // Second vote — plurality needs 2 votes, this should resolve
    const r2 = proposalVote(db, proposal.id, "bob", "React");
    expect(r2.success).toBe(true);
    expect(r2.resolved).toBe(true);
    expect(r2.result).toBe("React");

    // Verify proposal resolved
    const updated = proposalGet(db, proposal.id);
    expect(updated!.status).toBe("resolved");
    expect(updated!.result).toBe("React");

    db.close();
  });

  test("majority resolution", () => {
    const db = setup();

    const proposal = proposalCreate(db, {
      type: "decision",
      title: "Approve?",
      options: ["yes", "no"],
      resolution: "majority",
      creator: "alice",
      workflow: "review",
      tag: "pr-1",
    });

    // Vote 1: yes
    proposalVote(db, proposal.id, "alice", "yes");
    // Vote 2: no — tied, no resolution
    const r2 = proposalVote(db, proposal.id, "bob", "no");
    expect(r2.resolved).toBeUndefined();

    // Vote 3: yes — 2/3 = majority
    const r3 = proposalVote(db, proposal.id, "charlie", "yes");
    expect(r3.resolved).toBe(true);
    expect(r3.result).toBe("yes");

    db.close();
  });

  test("unanimous resolution", () => {
    const db = setup();

    const proposal = proposalCreate(db, {
      type: "approval",
      title: "Ship v2?",
      options: ["approve", "reject"],
      resolution: "unanimous",
      creator: "alice",
      workflow: "review",
      tag: "pr-1",
    });

    proposalVote(db, proposal.id, "alice", "approve");
    const r2 = proposalVote(db, proposal.id, "bob", "reject");
    // Not unanimous — no resolution
    expect(r2.resolved).toBeUndefined();

    db.close();
  });

  test("invalid vote rejected", () => {
    const db = setup();

    const proposal = proposalCreate(db, {
      type: "decision",
      title: "Pick one",
      options: ["A", "B"],
      creator: "alice",
      workflow: "review",
      tag: "pr-1",
    });

    const result = proposalVote(db, proposal.id, "alice", "C");
    expect(result.success).toBe(false);
    expect(result.error).toContain("Invalid choice");

    db.close();
  });

  test("cancel proposal", () => {
    const db = setup();

    const proposal = proposalCreate(db, {
      type: "decision",
      title: "Cancel me",
      options: ["A", "B"],
      creator: "alice",
      workflow: "review",
      tag: "pr-1",
    });

    // Non-creator can't cancel
    const r1 = proposalCancel(db, proposal.id, "bob");
    expect(r1.success).toBe(false);
    expect(r1.error).toContain("Only creator");

    // Creator can cancel
    const r2 = proposalCancel(db, proposal.id, "alice");
    expect(r2.success).toBe(true);

    const updated = proposalGet(db, proposal.id);
    expect(updated!.status).toBe("cancelled");

    db.close();
  });

  test("list proposals", () => {
    const db = setup();

    proposalCreate(db, {
      type: "decision",
      title: "First",
      options: ["A", "B"],
      creator: "alice",
      workflow: "review",
      tag: "pr-1",
    });
    proposalCreate(db, {
      type: "decision",
      title: "Second",
      options: ["X", "Y"],
      creator: "bob",
      workflow: "review",
      tag: "pr-1",
    });

    const all = proposalList(db, "review", "pr-1");
    expect(all).toHaveLength(2);

    const active = proposalList(db, "review", "pr-1", "active");
    expect(active).toHaveLength(2);

    db.close();
  });

  test("vote list", () => {
    const db = setup();

    const proposal = proposalCreate(db, {
      type: "decision",
      title: "Vote on this",
      options: ["A", "B"],
      creator: "alice",
      workflow: "review",
      tag: "pr-1",
    });

    proposalVote(db, proposal.id, "alice", "A", "I prefer A");
    proposalVote(db, proposal.id, "bob", "B", "B is better");

    const votes = voteList(db, proposal.id);
    expect(votes).toHaveLength(2);
    expect(votes[0]!.agent).toBe("alice");
    expect(votes[0]!.choice).toBe("A");
    expect(votes[0]!.reason).toBe("I prefer A");

    db.close();
  });
});

// ==================== Documents (FileDocumentProvider) ====================

describe("FileDocumentProvider", () => {
  const tmpDir = join(tmpdir(), `agent-worker-docs-${Date.now()}`);

  afterEach(() => {
    try {
      rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      // ignore
    }
  });

  test("write and read document", async () => {
    const provider = createFileDocumentProvider(tmpDir);

    await provider.write("review", "pr-1", "notes.md", "# Review Notes\n- Ship it");

    const content = await provider.read("review", "pr-1", "notes.md");
    expect(content).toBe("# Review Notes\n- Ship it");
  });

  test("append to document", async () => {
    const provider = createFileDocumentProvider(tmpDir);

    await provider.write("review", "pr-1", "log.txt", "Line 1\n");
    await provider.append("review", "pr-1", "log.txt", "Line 2\n");

    const content = await provider.read("review", "pr-1", "log.txt");
    expect(content).toBe("Line 1\nLine 2\n");
  });

  test("list documents", async () => {
    const provider = createFileDocumentProvider(tmpDir);

    await provider.write("review", "pr-1", "notes.md", "notes");
    await provider.write("review", "pr-1", "plan.md", "plan");

    const files = await provider.list("review", "pr-1");
    expect(files).toContain("notes.md");
    expect(files).toContain("plan.md");
  });

  test("create fails on existing", async () => {
    const provider = createFileDocumentProvider(tmpDir);

    await provider.create("review", "pr-1", "unique.md", "first");

    expect(
      provider.create("review", "pr-1", "unique.md", "second"),
    ).rejects.toThrow("already exists");
  });

  test("read returns null for missing", async () => {
    const provider = createFileDocumentProvider(tmpDir);

    const content = await provider.read("review", "pr-1", "nonexistent.md");
    expect(content).toBeNull();
  });

  test("isolates workflow:tag", async () => {
    const provider = createFileDocumentProvider(tmpDir);

    await provider.write("review", "pr-1", "doc.md", "PR 1");
    await provider.write("review", "pr-2", "doc.md", "PR 2");

    expect(await provider.read("review", "pr-1", "doc.md")).toBe("PR 1");
    expect(await provider.read("review", "pr-2", "doc.md")).toBe("PR 2");
  });
});

// ==================== Backend Factory ====================

describe("backend factory", () => {
  test("creates mock backend", async () => {
    const backend = await createBackend({ type: "mock" });
    expect(backend.type).toBe("mock");
  });

  test("rejects unknown backend", async () => {
    expect(createBackend({ type: "unknown" as any })).rejects.toThrow("Unknown backend");
  });
});

// ==================== Workflow Lifecycle via HTTP ====================

describe("workflow lifecycle", () => {
  let daemon: DaemonHandle | null = null;

  afterEach(async () => {
    if (daemon) {
      await daemon.shutdown();
      daemon = null;
    }
  });

  test("POST /workflows creates workflow + agents", async () => {
    daemon = await startDaemon({ inMemory: true, port: 0 });
    const base = `http://${daemon.host}:${daemon.port}`;

    const res = await fetch(`${base}/workflows`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        workflow: {
          name: "review",
          agents: {
            reviewer: { model: "mock", backend: "mock", system_prompt: "You review code" },
            coder: { model: "mock", backend: "mock" },
          },
          kickoff: "@reviewer please review the PR",
        },
        tag: "pr-1",
      }),
    });

    expect(res.status).toBe(201);
    const data = await res.json();
    expect(data.ok).toBe(true);
    expect(data.name).toBe("review");
    expect(data.agents).toContain("reviewer");
    expect(data.agents).toContain("coder");

    // Verify agents exist
    const agentsRes = await fetch(`${base}/agents?workflow=review&tag=pr-1`);
    const agents = await agentsRes.json();
    expect(agents.length).toBe(2);

    // Verify kickoff message in channel
    const peekRes = await fetch(`${base}/peek?workflow=review&tag=pr-1`);
    const messages = await peekRes.json();
    expect(messages.length).toBe(1);
    expect(messages[0].sender).toBe("system");
    expect(messages[0].content).toContain("@reviewer");
  });

  test("DELETE /workflows/:name/:tag removes workflow", async () => {
    daemon = await startDaemon({ inMemory: true, port: 0 });
    const base = `http://${daemon.host}:${daemon.port}`;

    // Create workflow
    await fetch(`${base}/workflows`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        workflow: {
          name: "temp",
          agents: { bot: { model: "mock", backend: "mock" } },
        },
        tag: "main",
      }),
    });

    // Delete workflow
    const delRes = await fetch(`${base}/workflows/temp/main`, { method: "DELETE" });
    expect(delRes.ok).toBe(true);

    // Verify agents removed
    const agentsRes = await fetch(`${base}/agents?workflow=temp&tag=main`);
    const agents = await agentsRes.json();
    expect(agents.length).toBe(0);
  });

  test("GET /workflows lists workflows", async () => {
    daemon = await startDaemon({ inMemory: true, port: 0 });
    const base = `http://${daemon.host}:${daemon.port}`;

    const res = await fetch(`${base}/workflows`);
    const workflows = await res.json();
    // Should have at least the @global workflow
    expect(workflows.length).toBeGreaterThanOrEqual(1);
  });
});
