/**
 * Proposal & Voting System — Edge Case Tests
 *
 * Verifies behaviors identified during code review:
 * 1. ID counter reset when all proposals resolved before reload
 * 2. Majority deadlock (all agents voted, no majority)
 * 3. creator-decides tie breaker leaves proposal unresolved
 * 4. Vote overwrite breaks deadlock
 * 5. Expired proposal still picks a winner from existing votes
 * 6. Persistence drops non-active proposals
 */

import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { tmpdir } from "node:os";
import { mkdtempSync, rmSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  createProposalManager,
  type ProposalManager,
} from "../src/workflow/context/proposals.js";

describe("ProposalManager edge cases", () => {
  let manager: ProposalManager;
  let tempDir: string;
  const agents = ["alice", "bob", "charlie"];

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "proposals-edge-"));
    manager = createProposalManager({ stateDir: tempDir, validAgents: agents });
  });

  afterEach(() => {
    try {
      rmSync(tempDir, { recursive: true });
    } catch {
      /* ignore */
    }
  });

  // --------------------------------------------------------------------------
  // 1. ID counter reset across sessions
  // --------------------------------------------------------------------------
  describe("ID counter across sessions", () => {
    test("ID counter preserved even when all proposals resolved before reload", () => {
      // Create and resolve two proposals
      const p1 = manager.create({
        type: "approval",
        title: "First",
        createdBy: "alice",
      });
      const p2 = manager.create({
        type: "approval",
        title: "Second",
        createdBy: "bob",
      });

      expect(p1.id).toBe("prop-1");
      expect(p2.id).toBe("prop-2");

      // Resolve both by voting
      manager.vote({ proposalId: p1.id, voter: "alice", choice: "approve" });
      manager.vote({ proposalId: p1.id, voter: "bob", choice: "approve" });
      manager.vote({ proposalId: p1.id, voter: "charlie", choice: "approve" });

      manager.vote({ proposalId: p2.id, voter: "alice", choice: "reject" });
      manager.vote({ proposalId: p2.id, voter: "bob", choice: "reject" });
      manager.vote({ proposalId: p2.id, voter: "charlie", choice: "reject" });

      // Both should be resolved
      expect(manager.get(p1.id)?.status).toBe("resolved");
      expect(manager.get(p2.id)?.status).toBe("resolved");

      // Create new manager — idCounter is now persisted in state file
      const manager2 = createProposalManager({
        stateDir: tempDir,
        validAgents: agents,
      });

      const p3 = manager2.create({
        type: "approval",
        title: "Third",
        createdBy: "charlie",
      });

      // Fixed: idCounter persisted separately, no more ID reuse
      expect(p3.id).toBe("prop-3");
    });

    test("ID counter preserved when at least one proposal remains active", () => {
      manager.create({
        type: "approval",
        title: "First",
        createdBy: "alice",
      });
      const p2 = manager.create({
        type: "approval",
        title: "Second (stays active)",
        createdBy: "bob",
      });

      // Only resolve the first
      const p1 = manager.get("prop-1")!;
      manager.vote({ proposalId: p1.id, voter: "alice", choice: "approve" });
      manager.vote({ proposalId: p1.id, voter: "bob", choice: "approve" });
      manager.vote({ proposalId: p1.id, voter: "charlie", choice: "approve" });

      expect(p1.status).toBe("resolved");
      expect(p2.status).toBe("active");

      const manager2 = createProposalManager({
        stateDir: tempDir,
        validAgents: agents,
      });

      const p3 = manager2.create({
        type: "approval",
        title: "Third",
        createdBy: "charlie",
      });

      // p2 (prop-2) is still active → ID counter restored correctly
      expect(p3.id).toBe("prop-3");
    });
  });

  // --------------------------------------------------------------------------
  // 2. Majority deadlock
  // --------------------------------------------------------------------------
  describe("majority deadlock", () => {
    test("3-way split with majority stays active forever (all agents voted)", () => {
      const p = manager.create({
        type: "decision",
        title: "Three-way split",
        options: [
          { id: "a", label: "A" },
          { id: "b", label: "B" },
          { id: "c", label: "C" },
        ],
        resolution: { type: "majority" },
        createdBy: "alice",
      });

      manager.vote({ proposalId: p.id, voter: "alice", choice: "a" });
      manager.vote({ proposalId: p.id, voter: "bob", choice: "b" });
      const result = manager.vote({
        proposalId: p.id,
        voter: "charlie",
        choice: "c",
      });

      // All agents voted, quorum met, but no majority — stuck active
      expect(result.resolved).toBe(false);
      expect(result.proposal?.status).toBe("active");

      // No more valid voters exist
      const invalidVote = manager.vote({
        proposalId: p.id,
        voter: "dave",
        choice: "a",
      });
      expect(invalidVote.success).toBe(false);
    });

    test("deadlock breaks when agent changes their vote", () => {
      const p = manager.create({
        type: "decision",
        title: "Breakable deadlock",
        options: [
          { id: "a", label: "A" },
          { id: "b", label: "B" },
          { id: "c", label: "C" },
        ],
        resolution: { type: "majority" },
        createdBy: "alice",
      });

      manager.vote({ proposalId: p.id, voter: "alice", choice: "a" });
      manager.vote({ proposalId: p.id, voter: "bob", choice: "b" });
      manager.vote({ proposalId: p.id, voter: "charlie", choice: "c" });

      // Charlie changes mind → 'a' now has 2/3 = 66% > 50%
      const result = manager.vote({
        proposalId: p.id,
        voter: "charlie",
        choice: "a",
      });

      expect(result.resolved).toBe(true);
      expect(result.proposal?.result?.winner).toBe("a");
    });
  });

  // --------------------------------------------------------------------------
  // 3. creator-decides tie breaker
  // --------------------------------------------------------------------------
  describe("creator-decides tie breaker", () => {
    test("tie with creator-decides leaves proposal unresolved", () => {
      const p = manager.create({
        type: "decision",
        title: "Creator tie",
        options: [
          { id: "x", label: "X" },
          { id: "y", label: "Y" },
        ],
        resolution: { type: "plurality", tieBreaker: "creator-decides" },
        createdBy: "alice",
      });

      manager.vote({ proposalId: p.id, voter: "alice", choice: "x" });
      manager.vote({ proposalId: p.id, voter: "bob", choice: "y" });
      // charlie breaks the tie only if they vote for x or y
      // but first let's test: what if charlie also creates a tie
      // Actually with 3 agents, 2 options, 1+1+1 is impossible (only 2 options)
      // So alice=x, bob=y → 2 voters, but quorum=3, not met yet
      const result = manager.vote({
        proposalId: p.id,
        voter: "charlie",
        choice: "y",
      });

      // charlie voted y → y has 2, x has 1 → no tie → resolved
      expect(result.resolved).toBe(true);
      expect(result.proposal?.result?.winner).toBe("y");
    });

    test("creator-decides with actual tie stays unresolved", () => {
      // Need even number of agents for a real tie
      const tempDir2 = mkdtempSync(join(tmpdir(), "proposals-tie-"));
      const fourAgents = ["alice", "bob", "charlie", "dave"];
      const mgr = createProposalManager({
        stateDir: tempDir2,
        validAgents: fourAgents,
      });

      const p = mgr.create({
        type: "decision",
        title: "Even tie",
        options: [
          { id: "x", label: "X" },
          { id: "y", label: "Y" },
        ],
        resolution: { type: "plurality", tieBreaker: "creator-decides" },
        createdBy: "alice",
      });

      mgr.vote({ proposalId: p.id, voter: "alice", choice: "x" });
      mgr.vote({ proposalId: p.id, voter: "bob", choice: "y" });
      mgr.vote({ proposalId: p.id, voter: "charlie", choice: "x" });
      const result = mgr.vote({
        proposalId: p.id,
        voter: "dave",
        choice: "y",
      });

      // 2-2 tie, creator-decides → no auto-resolution
      expect(result.resolved).toBe(false);
      expect(result.proposal?.status).toBe("active");

      // Creator can break the tie by changing their vote
      const breakResult = mgr.vote({
        proposalId: p.id,
        voter: "alice",
        choice: "y",
      });

      // Now: x=1 (charlie), y=3 (alice, bob, dave) — not a tie anymore
      expect(breakResult.resolved).toBe(true);
      expect(breakResult.proposal?.result?.winner).toBe("y");

      rmSync(tempDir2, { recursive: true });
    });
  });

  // --------------------------------------------------------------------------
  // 4. Expiration with partial votes
  // --------------------------------------------------------------------------
  describe("expiration with partial votes", () => {
    test("expired proposal picks winner from existing votes", async () => {
      const p = manager.create({
        type: "decision",
        title: "Partial then expire",
        options: [
          { id: "a", label: "A" },
          { id: "b", label: "B" },
        ],
        timeoutSeconds: 0.01,
        createdBy: "alice",
      });

      // Only one vote before expiration
      manager.vote({ proposalId: p.id, voter: "alice", choice: "a" });

      await new Promise((r) => setTimeout(r, 20));

      const fetched = manager.get(p.id);
      expect(fetched?.status).toBe("expired");
      expect(fetched?.result?.resolvedBy).toBe("timeout");
      // Winner should still be determined from existing votes
      expect(fetched?.result?.winner).toBe("a");
    });

    test("expired proposal with tied votes and first tiebreaker", async () => {
      const tempDir2 = mkdtempSync(join(tmpdir(), "proposals-expire-tie-"));
      const mgr = createProposalManager({
        stateDir: tempDir2,
        validAgents: ["alice", "bob", "charlie", "dave"],
      });

      const p = mgr.create({
        type: "decision",
        title: "Tie then expire",
        options: [
          { id: "a", label: "A" },
          { id: "b", label: "B" },
        ],
        timeoutSeconds: 0.01,
        resolution: { tieBreaker: "first" },
        createdBy: "alice",
      });

      mgr.vote({ proposalId: p.id, voter: "alice", choice: "a" });
      mgr.vote({ proposalId: p.id, voter: "bob", choice: "b" });

      await new Promise((r) => setTimeout(r, 20));

      const fetched = mgr.get(p.id);
      expect(fetched?.status).toBe("expired");
      // With first tiebreaker, the first option in sorted order wins
      expect(fetched?.result?.winner).toBeDefined();

      rmSync(tempDir2, { recursive: true });
    });
  });

  // --------------------------------------------------------------------------
  // 5. Persistence only saves active proposals
  // --------------------------------------------------------------------------
  describe("persistence drops non-active proposals", () => {
    test("resolved proposals are not in state file but idCounter is preserved", () => {
      const p = manager.create({
        type: "approval",
        title: "Will resolve",
        createdBy: "alice",
      });

      manager.vote({ proposalId: p.id, voter: "alice", choice: "approve" });
      manager.vote({ proposalId: p.id, voter: "bob", choice: "approve" });
      manager.vote({
        proposalId: p.id,
        voter: "charlie",
        choice: "approve",
      });

      expect(manager.get(p.id)?.status).toBe("resolved");

      // Read the state file directly
      const statePath = join(tempDir, "proposals.json");
      const state = JSON.parse(readFileSync(statePath, "utf-8"));

      // Only active proposals are persisted
      expect(Object.keys(state.proposals)).toHaveLength(0);
      // But idCounter is preserved
      expect(state.idCounter).toBe(1);
    });

    test("cancelled proposals are not in state file", () => {
      const p = manager.create({
        type: "approval",
        title: "Will cancel",
        createdBy: "alice",
      });

      manager.cancel(p.id, "alice");

      const statePath = join(tempDir, "proposals.json");
      const state = JSON.parse(readFileSync(statePath, "utf-8"));

      expect(Object.keys(state.proposals)).toHaveLength(0);
    });
  });

  // --------------------------------------------------------------------------
  // 6. Multiple options with plurality
  // --------------------------------------------------------------------------
  describe("multi-option plurality", () => {
    test("winner with minority of total votes (plurality, not majority)", () => {
      const p = manager.create({
        type: "election",
        title: "Multi-candidate",
        options: [
          { id: "a", label: "A" },
          { id: "b", label: "B" },
          { id: "c", label: "C" },
        ],
        resolution: { type: "plurality" },
        createdBy: "alice",
      });

      // Each votes differently → 3-way tie, but with "first" tiebreaker
      manager.vote({ proposalId: p.id, voter: "alice", choice: "a" });
      manager.vote({ proposalId: p.id, voter: "bob", choice: "b" });
      const result = manager.vote({
        proposalId: p.id,
        voter: "charlie",
        choice: "c",
      });

      // Quorum met (3/3), plurality with tie → first tiebreaker picks winner
      expect(result.resolved).toBe(true);
      expect(result.proposal?.result?.winner).toBeDefined();
    });
  });

  // --------------------------------------------------------------------------
  // 7. Vote reason persistence
  // --------------------------------------------------------------------------
  describe("vote reason persistence", () => {
    test("stores vote reason alongside choice", () => {
      const p = manager.create({
        type: "decision",
        title: "With reasons",
        options: [
          { id: "a", label: "A" },
          { id: "b", label: "B" },
        ],
        createdBy: "alice",
      });

      manager.vote({
        proposalId: p.id,
        voter: "alice",
        choice: "a",
        reason: "Better performance",
      });
      manager.vote({
        proposalId: p.id,
        voter: "bob",
        choice: "b",
        reason: "Easier to maintain",
      });

      const fetched = manager.get(p.id);
      expect(fetched?.result?.reasons?.alice).toBe("Better performance");
      expect(fetched?.result?.reasons?.bob).toBe("Easier to maintain");
    });

    test("reason persists across manager instances", () => {
      const p = manager.create({
        type: "decision",
        title: "Persistent reasons",
        options: [
          { id: "a", label: "A" },
          { id: "b", label: "B" },
        ],
        createdBy: "alice",
      });

      manager.vote({
        proposalId: p.id,
        voter: "alice",
        choice: "a",
        reason: "My reasoning",
      });

      const manager2 = createProposalManager({
        stateDir: tempDir,
        validAgents: agents,
      });

      const loaded = manager2.get(p.id);
      expect(loaded?.result?.reasons?.alice).toBe("My reasoning");
    });

    test("vote without reason does not create empty reasons map", () => {
      const p = manager.create({
        type: "approval",
        title: "No reasons",
        createdBy: "alice",
      });

      manager.vote({ proposalId: p.id, voter: "alice", choice: "approve" });

      const fetched = manager.get(p.id);
      expect(fetched?.result?.reasons).toBeUndefined();
    });

    test("overwriting vote preserves new reason", () => {
      const p = manager.create({
        type: "decision",
        title: "Changed mind",
        options: [
          { id: "a", label: "A" },
          { id: "b", label: "B" },
        ],
        createdBy: "alice",
      });

      manager.vote({
        proposalId: p.id,
        voter: "alice",
        choice: "a",
        reason: "First thought",
      });
      manager.vote({
        proposalId: p.id,
        voter: "alice",
        choice: "b",
        reason: "Changed my mind",
      });

      const fetched = manager.get(p.id);
      expect(fetched?.result?.votes["alice"]).toBe("b");
      expect(fetched?.result?.reasons?.alice).toBe("Changed my mind");
    });
  });

  // --------------------------------------------------------------------------
  // 8. Voting on same proposal after resolution
  // --------------------------------------------------------------------------
  describe("post-resolution behavior", () => {
    test("cannot vote on resolved proposal", () => {
      const p = manager.create({
        type: "approval",
        title: "Done",
        createdBy: "alice",
      });

      manager.vote({ proposalId: p.id, voter: "alice", choice: "approve" });
      manager.vote({ proposalId: p.id, voter: "bob", choice: "approve" });
      manager.vote({
        proposalId: p.id,
        voter: "charlie",
        choice: "approve",
      });

      const lateVote = manager.vote({
        proposalId: p.id,
        voter: "alice",
        choice: "reject",
      });

      expect(lateVote.success).toBe(false);
      expect(lateVote.error).toContain("resolved");
    });
  });
});
