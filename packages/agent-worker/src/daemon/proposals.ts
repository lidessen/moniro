/**
 * Proposals — collaborative voting system backed by SQLite.
 *
 * Agents create proposals, vote, and the daemon resolves
 * based on configured resolution strategy.
 */
import type { Database } from "bun:sqlite";
import { nanoid } from "nanoid";
import type {
  Proposal,
  ProposalType,
  ProposalStatus,
  ResolutionStrategy,
  Vote,
} from "../shared/types.ts";

// ==================== Create ====================

export interface CreateProposalInput {
  type: ProposalType;
  title: string;
  options: string[];
  resolution?: ResolutionStrategy;
  binding?: boolean;
  creator: string;
  workflow: string;
  tag: string;
}

export function proposalCreate(db: Database, input: CreateProposalInput): Proposal {
  const id = `prop_${nanoid(10)}`;
  const now = Date.now();
  const resolution = input.resolution ?? "plurality";
  const binding = input.binding ?? true;

  db.run(
    `INSERT INTO proposals (id, workflow, tag, type, title, options, resolution, binding, status, creator, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?)`,
    [
      id,
      input.workflow,
      input.tag,
      input.type,
      input.title,
      JSON.stringify(input.options),
      resolution,
      binding ? 1 : 0,
      input.creator,
      now,
    ],
  );

  return {
    id,
    workflow: input.workflow,
    tag: input.tag,
    type: input.type,
    title: input.title,
    options: input.options,
    resolution,
    binding,
    status: "active",
    creator: input.creator,
    createdAt: now,
  };
}

// ==================== Vote ====================

export interface VoteResult {
  success: boolean;
  error?: string;
  resolved?: boolean;
  result?: string;
}

export function proposalVote(
  db: Database,
  proposalId: string,
  agent: string,
  choice: string,
  reason?: string,
): VoteResult {
  // Check proposal exists and is active
  const proposal = proposalGet(db, proposalId);
  if (!proposal) return { success: false, error: "Proposal not found" };
  if (proposal.status !== "active")
    return { success: false, error: `Proposal is ${proposal.status}` };

  // Validate choice
  if (!proposal.options.includes(choice)) {
    return { success: false, error: `Invalid choice. Options: ${proposal.options.join(", ")}` };
  }

  // Upsert vote (allow changing vote)
  db.run(
    `INSERT OR REPLACE INTO votes (proposal_id, agent, choice, reason, created_at)
     VALUES (?, ?, ?, ?, ?)`,
    [proposalId, agent, choice, reason ?? null, Date.now()],
  );

  // Check if resolved — eligible voters = all agents in same workflow:tag
  const votes = voteList(db, proposalId);
  const eligibleCount =
    (
      db
        .query("SELECT COUNT(*) as cnt FROM agents WHERE workflow = ? AND tag = ?")
        .get(proposal.workflow, proposal.tag) as { cnt: number }
    )?.cnt ?? 0;
  const resolution = checkResolution(proposal, votes, eligibleCount);

  if (resolution) {
    db.run(`UPDATE proposals SET status = 'resolved', result = ?, resolved_at = ? WHERE id = ?`, [
      resolution,
      Date.now(),
      proposalId,
    ]);
    return { success: true, resolved: true, result: resolution };
  }

  return { success: true };
}

// ==================== Query ====================

export function proposalGet(db: Database, id: string): Proposal | null {
  const row = db.query("SELECT * FROM proposals WHERE id = ?").get(id) as ProposalRow | null;
  if (!row) return null;
  return rowToProposal(row);
}

export function proposalList(
  db: Database,
  workflow: string,
  tag: string,
  status?: ProposalStatus,
): Proposal[] {
  let rows: ProposalRow[];
  if (status) {
    rows = db
      .query(
        "SELECT * FROM proposals WHERE workflow = ? AND tag = ? AND status = ? ORDER BY created_at DESC",
      )
      .all(workflow, tag, status) as ProposalRow[];
  } else {
    rows = db
      .query("SELECT * FROM proposals WHERE workflow = ? AND tag = ? ORDER BY created_at DESC")
      .all(workflow, tag) as ProposalRow[];
  }
  return rows.map(rowToProposal);
}

export function voteList(db: Database, proposalId: string): Vote[] {
  const rows = db
    .query("SELECT * FROM votes WHERE proposal_id = ? ORDER BY created_at ASC")
    .all(proposalId) as VoteRow[];
  return rows.map((r) => ({
    proposalId: r.proposal_id,
    agent: r.agent,
    choice: r.choice,
    reason: r.reason ?? undefined,
    createdAt: r.created_at,
  }));
}

// ==================== Cancel ====================

export function proposalCancel(
  db: Database,
  proposalId: string,
  cancelledBy: string,
): { success: boolean; error?: string } {
  const proposal = proposalGet(db, proposalId);
  if (!proposal) return { success: false, error: "Proposal not found" };
  if (proposal.status !== "active")
    return { success: false, error: `Proposal is ${proposal.status}` };
  if (proposal.creator !== cancelledBy) return { success: false, error: "Only creator can cancel" };

  db.run(`UPDATE proposals SET status = 'cancelled', resolved_at = ? WHERE id = ?`, [
    Date.now(),
    proposalId,
  ]);

  return { success: true };
}

// ==================== Resolution ====================

function checkResolution(proposal: Proposal, votes: Vote[], eligibleCount: number): string | null {
  if (votes.length === 0) return null;

  // Count votes per option
  const counts: Record<string, number> = {};
  for (const option of proposal.options) {
    counts[option] = 0;
  }
  for (const vote of votes) {
    counts[vote.choice] = (counts[vote.choice] ?? 0) + 1;
  }

  const totalVotes = votes.length;
  // Use eligible voter count for threshold calculations; fall back to vote count
  const voterPool = eligibleCount > 0 ? eligibleCount : totalVotes;
  const entries = Object.entries(counts).sort((a, b) => b[1] - a[1]);
  const top = entries[0];
  if (!top) return null;
  const [topChoice, topCount] = top;

  switch (proposal.resolution) {
    case "plurality":
      // Simple: whoever has most votes wins (need at least 2 votes)
      if (totalVotes >= 2) return topChoice;
      break;

    case "majority":
      // Need > 50% of eligible voters, not just votes cast
      if (topCount > voterPool / 2) return topChoice;
      break;

    case "unanimous":
      // ALL eligible voters must vote and agree
      if (topCount === voterPool && totalVotes === voterPool) return topChoice;
      break;
  }

  return null;
}

// ==================== Row Types ====================

interface ProposalRow {
  id: string;
  workflow: string;
  tag: string;
  type: string;
  title: string;
  options: string;
  resolution: string;
  binding: number;
  status: string;
  creator: string;
  result: string | null;
  created_at: number;
  resolved_at: number | null;
}

function rowToProposal(row: ProposalRow): Proposal {
  return {
    id: row.id,
    workflow: row.workflow,
    tag: row.tag,
    type: row.type as ProposalType,
    title: row.title,
    options: JSON.parse(row.options),
    resolution: row.resolution as ResolutionStrategy,
    binding: row.binding === 1,
    status: row.status as ProposalStatus,
    creator: row.creator,
    result: row.result ?? undefined,
    createdAt: row.created_at,
    resolvedAt: row.resolved_at ?? undefined,
  };
}

interface VoteRow {
  proposal_id: string;
  agent: string;
  choice: string;
  reason: string | null;
  created_at: number;
}
