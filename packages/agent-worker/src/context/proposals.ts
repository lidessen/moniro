/**
 * Proposal & Voting System
 * Enables structured decision-making between agents
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

// ============================================================================
// Types
// ============================================================================

/** Proposal types for different decision scenarios */
export type ProposalType = 'election' | 'decision' | 'approval' | 'assignment'

/** Proposal status lifecycle */
export type ProposalStatus = 'active' | 'resolved' | 'expired' | 'cancelled'

/** Resolution methods */
export type ResolutionType = 'plurality' | 'majority' | 'unanimous'

/** Tie-breaking strategies */
export type TieBreaker = 'first' | 'random' | 'creator-decides'

/** How a proposal was resolved */
export type ResolvedBy = 'quorum' | 'timeout' | 'cancelled'

/** A voting option */
export interface ProposalOption {
  id: string
  label: string
  metadata?: Record<string, unknown>
}

/** Rules for determining the winner */
export interface ResolutionRule {
  type: ResolutionType
  /** Minimum votes required */
  quorum?: number
  /** How to break ties */
  tieBreaker?: TieBreaker
}

/** Result of a resolved proposal */
export interface ProposalResult {
  /** Winning option ID (if any) */
  winner?: string
  /** Map of voter → choice */
  votes: Record<string, string>
  /** Map of option → vote count */
  counts: Record<string, number>
  /** When resolved */
  resolvedAt?: string
  /** How it was resolved */
  resolvedBy: ResolvedBy
}

/** A proposal for voting */
export interface Proposal {
  id: string
  type: ProposalType
  title: string
  description?: string
  options: ProposalOption[]
  createdBy: string
  createdAt: string
  expiresAt?: string
  resolution: ResolutionRule
  /** Whether the result is binding */
  binding: boolean
  status: ProposalStatus
  result?: ProposalResult
}

/** Persistent state for proposals */
export interface ProposalsState {
  proposals: Record<string, Proposal>
  /** Archive of resolved proposals (optional, for history) */
  archive?: Record<string, Proposal>
  version: number
}

// ============================================================================
// Defaults
// ============================================================================

export const PROPOSAL_DEFAULTS = {
  resolution: {
    type: 'plurality' as ResolutionType,
    tieBreaker: 'first' as TieBreaker,
  },
  binding: true,
  /** Default timeout in seconds (1 hour) */
  timeoutSeconds: 3600,
  /** State file path relative to context dir */
  stateFile: '_state/proposals.json',
}

// ============================================================================
// Proposal Manager
// ============================================================================

export interface ProposalManagerOptions {
  /** Path to state directory */
  stateDir: string
  /** Valid agent names for voter validation */
  validAgents: string[]
}

/**
 * Manages proposals lifecycle: creation, voting, resolution
 */
export class ProposalManager {
  private proposals: Map<string, Proposal> = new Map()
  private readonly statePath: string
  private idCounter = 0

  constructor(private options: ProposalManagerOptions) {
    this.statePath = join(options.stateDir, 'proposals.json')
    this.load()
  }

  // --------------------------------------------------------------------------
  // Persistence
  // --------------------------------------------------------------------------

  private load(): void {
    try {
      if (existsSync(this.statePath)) {
        const data: ProposalsState = JSON.parse(readFileSync(this.statePath, 'utf-8'))
        this.proposals = new Map(Object.entries(data.proposals || {}))
        // Restore ID counter from existing proposals
        // Find the highest used ID so generateId() returns the next one
        for (const id of this.proposals.keys()) {
          const num = parseInt(id.replace('prop-', ''), 10)
          if (!isNaN(num) && num > this.idCounter) {
            this.idCounter = num
          }
        }
      }
    } catch {
      // No state file yet or invalid JSON - start fresh
    }
  }

  private save(): void {
    const dir = dirname(this.statePath)
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true })
    }

    // Only persist active proposals (resolved/cancelled/expired are not saved)
    const activeOnly = [...this.proposals.entries()].filter(([_, p]) => p.status === 'active')

    const state: ProposalsState = {
      proposals: Object.fromEntries(activeOnly),
      version: Date.now(),
    }
    writeFileSync(this.statePath, JSON.stringify(state, null, 2))
  }

  // --------------------------------------------------------------------------
  // Proposal Operations
  // --------------------------------------------------------------------------

  private generateId(): string {
    return `prop-${++this.idCounter}`
  }

  /**
   * Create a new proposal
   */
  create(params: {
    type: ProposalType
    title: string
    description?: string
    options?: ProposalOption[]
    resolution?: Partial<ResolutionRule>
    binding?: boolean
    timeoutSeconds?: number
    createdBy: string
  }): Proposal {
    const id = this.generateId()
    const now = new Date()

    // Default options for approval type
    let options = params.options
    if (!options || options.length === 0) {
      if (params.type === 'approval') {
        options = [
          { id: 'approve', label: 'Approve' },
          { id: 'reject', label: 'Reject' },
        ]
      } else {
        throw new Error('Options are required for non-approval proposals')
      }
    }

    // Calculate expiration
    const timeoutSeconds = params.timeoutSeconds ?? PROPOSAL_DEFAULTS.timeoutSeconds
    const expiresAt = new Date(now.getTime() + timeoutSeconds * 1000).toISOString()

    const proposal: Proposal = {
      id,
      type: params.type,
      title: params.title,
      description: params.description,
      options,
      createdBy: params.createdBy,
      createdAt: now.toISOString(),
      expiresAt,
      resolution: {
        type: params.resolution?.type ?? PROPOSAL_DEFAULTS.resolution.type,
        quorum: params.resolution?.quorum,
        tieBreaker: params.resolution?.tieBreaker ?? PROPOSAL_DEFAULTS.resolution.tieBreaker,
      },
      binding: params.binding ?? PROPOSAL_DEFAULTS.binding,
      status: 'active',
      result: {
        votes: {},
        counts: {},
        resolvedBy: 'quorum', // will be updated when resolved
      },
    }

    this.proposals.set(id, proposal)
    this.save()

    return proposal
  }

  /**
   * Cast a vote on a proposal
   */
  vote(params: { proposalId: string; voter: string; choice: string; reason?: string }): {
    success: boolean
    error?: string
    proposal?: Proposal
    resolved?: boolean
  } {
    const proposal = this.proposals.get(params.proposalId)

    if (!proposal) {
      return { success: false, error: `Proposal not found: ${params.proposalId}` }
    }

    if (proposal.status !== 'active') {
      return { success: false, error: `Proposal is ${proposal.status}, cannot vote` }
    }

    // Validate voter is a known agent
    if (!this.options.validAgents.includes(params.voter)) {
      return { success: false, error: `Unknown voter: ${params.voter}. Valid agents: ${this.options.validAgents.join(', ')}` }
    }

    // Check if option exists
    const optionExists = proposal.options.some((o) => o.id === params.choice)
    if (!optionExists) {
      const validOptions = proposal.options.map((o) => o.id).join(', ')
      return { success: false, error: `Invalid choice. Valid options: ${validOptions}` }
    }

    // Check expiration
    if (proposal.expiresAt && new Date(proposal.expiresAt) < new Date()) {
      this.expireProposal(proposal)
      return { success: false, error: 'Proposal has expired' }
    }

    // Record vote (overwrites previous vote from same voter)
    const previousVote = proposal.result!.votes[params.voter]
    proposal.result!.votes[params.voter] = params.choice

    // Recalculate counts
    this.recalculateCounts(proposal)

    // Check if we should resolve
    const resolved = this.checkResolution(proposal)

    this.save()

    return {
      success: true,
      proposal,
      resolved,
    }
  }

  /**
   * Get proposal by ID
   */
  get(proposalId: string): Proposal | undefined {
    const proposal = this.proposals.get(proposalId)
    if (proposal && proposal.status === 'active') {
      // Check expiration on access
      if (proposal.expiresAt && new Date(proposal.expiresAt) < new Date()) {
        this.expireProposal(proposal)
        this.save()
      }
    }
    return proposal
  }

  /**
   * Get all proposals (optionally filtered by status)
   */
  list(status?: ProposalStatus): Proposal[] {
    // Check and expire any outdated proposals
    let mutated = false
    for (const proposal of this.proposals.values()) {
      if (
        proposal.status === 'active' &&
        proposal.expiresAt &&
        new Date(proposal.expiresAt) < new Date()
      ) {
        this.expireProposal(proposal)
        mutated = true
      }
    }
    if (mutated) {
      this.save()
    }

    const proposals = [...this.proposals.values()]
    if (status) {
      return proposals.filter((p) => p.status === status)
    }
    return proposals
  }

  /**
   * Cancel a proposal (only creator can cancel)
   */
  cancel(proposalId: string, cancelledBy: string): { success: boolean; error?: string } {
    const proposal = this.proposals.get(proposalId)

    if (!proposal) {
      return { success: false, error: `Proposal not found: ${proposalId}` }
    }

    if (proposal.status !== 'active') {
      return { success: false, error: `Proposal is ${proposal.status}, cannot cancel` }
    }

    if (proposal.createdBy !== cancelledBy) {
      return { success: false, error: 'Only the creator can cancel a proposal' }
    }

    proposal.status = 'cancelled'
    proposal.result!.resolvedBy = 'cancelled'
    proposal.result!.resolvedAt = new Date().toISOString()

    this.save()

    return { success: true }
  }

  /**
   * Check if there are any active proposals
   */
  hasActiveProposals(): boolean {
    let mutated = false
    for (const proposal of this.proposals.values()) {
      if (proposal.status === 'active') {
        // Check expiration
        if (proposal.expiresAt && new Date(proposal.expiresAt) < new Date()) {
          this.expireProposal(proposal)
          mutated = true
        } else {
          // Found an active, non-expired proposal
          if (mutated) this.save()
          return true
        }
      }
    }
    if (mutated) {
      this.save()
    }
    return false
  }

  /**
   * Get count of active proposals
   */
  activeCount(): number {
    return this.list('active').length
  }

  // --------------------------------------------------------------------------
  // Resolution Logic
  // --------------------------------------------------------------------------

  private recalculateCounts(proposal: Proposal): void {
    const counts: Record<string, number> = {}
    for (const option of proposal.options) {
      counts[option.id] = 0
    }
    for (const choice of Object.values(proposal.result!.votes)) {
      counts[choice] = (counts[choice] || 0) + 1
    }
    proposal.result!.counts = counts
  }

  private checkResolution(proposal: Proposal): boolean {
    const { resolution, result } = proposal
    const counts = result!.counts
    const totalVotes = Object.values(result!.votes).length

    // Determine effective quorum (explicit quorum or all agents)
    const effectiveQuorum = resolution.quorum ?? this.options.validAgents.length

    // Check quorum
    if (totalVotes < effectiveQuorum) {
      return false
    }

    // Sort options by vote count
    const sorted = Object.entries(counts).sort((a, b) => b[1] - a[1])
    const topVotes = sorted[0]?.[1] || 0
    const secondVotes = sorted[1]?.[1] || 0
    const hasTie = sorted.length >= 2 && topVotes === secondVotes && topVotes > 0

    let winner: string | undefined

    switch (resolution.type) {
      case 'plurality':
        // Winner is whoever has most votes (quorum already checked)
        if (topVotes > 0) {
          winner = this.resolveTie(sorted, resolution, hasTie)
        }
        break

      case 'majority':
        // Winner needs > 50% of votes cast
        if (topVotes > totalVotes / 2) {
          winner = sorted[0]?.[0]
        }
        break

      case 'unanimous':
        // All votes must be for the same option
        // Quorum already checked above, so just verify unanimity
        if (sorted.length === 1 || (sorted.length > 1 && (sorted[1]?.[1] ?? 0) === 0)) {
          winner = sorted[0]?.[0]
        }
        break
    }

    // If we have a winner, mark as resolved
    if (winner) {
      proposal.result!.winner = winner
      proposal.status = 'resolved'
      proposal.result!.resolvedAt = new Date().toISOString()
      proposal.result!.resolvedBy = 'quorum'
      return true
    }

    return false
  }

  private resolveTie(
    sorted: [string, number][],
    resolution: ResolutionRule,
    hasTie: boolean
  ): string | undefined {
    if (!hasTie) {
      return sorted[0]?.[0]
    }

    // Find all options tied for first
    const topVotes = sorted[0]?.[1] ?? 0
    const tiedOptions = sorted.filter(([_, count]) => count === topVotes).map(([id]) => id)

    switch (resolution.tieBreaker) {
      case 'first':
        return tiedOptions[0]
      case 'random':
        return tiedOptions[Math.floor(Math.random() * tiedOptions.length)]
      case 'creator-decides':
        // Don't resolve automatically - creator must vote again or decide
        return undefined
      default:
        return tiedOptions[0]
    }
  }

  private expireProposal(proposal: Proposal): void {
    proposal.status = 'expired'
    proposal.result!.resolvedAt = new Date().toISOString()
    proposal.result!.resolvedBy = 'timeout'

    // Still determine winner if we have votes
    const sorted = Object.entries(proposal.result!.counts).sort((a, b) => b[1] - a[1])
    const topVotes = sorted[0]?.[1] ?? 0
    if (sorted.length > 0 && topVotes > 0) {
      const hasTie = sorted.length >= 2 && topVotes === (sorted[1]?.[1] ?? 0)
      proposal.result!.winner = this.resolveTie(sorted, proposal.resolution, hasTie)
    }
  }

  // --------------------------------------------------------------------------
  // Test Helpers
  // --------------------------------------------------------------------------

  /** Clear all proposals (for testing) */
  clear(): void {
    this.proposals.clear()
    this.idCounter = 0
    this.save()
  }

  /** Get all proposals as map (for testing) */
  getAll(): Map<string, Proposal> {
    return new Map(this.proposals)
  }
}

// ============================================================================
// Factory
// ============================================================================

/**
 * Create a proposal manager
 */
export function createProposalManager(options: ProposalManagerOptions): ProposalManager {
  return new ProposalManager(options)
}

// ============================================================================
// Formatting Helpers
// ============================================================================

/**
 * Format a proposal for display
 */
export function formatProposal(proposal: Proposal): string {
  const lines: string[] = []

  lines.push(`📋 **${proposal.title}** (${proposal.id})`)
  lines.push(`Type: ${proposal.type} | Status: ${proposal.status}`)

  if (proposal.description) {
    lines.push(`\n${proposal.description}`)
  }

  lines.push('\nOptions:')
  for (const option of proposal.options) {
    const count = proposal.result?.counts[option.id] || 0
    const marker = proposal.result?.winner === option.id ? '✓ ' : '  '
    lines.push(`${marker}- ${option.label} (${option.id}): ${count} votes`)
  }

  if (proposal.result && Object.keys(proposal.result.votes).length > 0) {
    lines.push('\nVotes:')
    for (const [voter, choice] of Object.entries(proposal.result.votes)) {
      lines.push(`  @${voter} → ${choice}`)
    }
  }

  if (proposal.status === 'active' && proposal.expiresAt) {
    const remaining = new Date(proposal.expiresAt).getTime() - Date.now()
    const minutes = Math.max(0, Math.floor(remaining / 60000))
    lines.push(`\nExpires in: ${minutes} minutes`)
  }

  if (proposal.status === 'resolved' && proposal.result?.winner) {
    const winningOption = proposal.options.find((o) => o.id === proposal.result?.winner)
    lines.push(`\n🏆 Winner: ${winningOption?.label || proposal.result.winner}`)
  }

  return lines.join('\n')
}

/**
 * Format multiple proposals as a summary
 */
export function formatProposalList(proposals: Proposal[]): string {
  if (proposals.length === 0) {
    return '(no proposals)'
  }

  return proposals
    .map((p) => {
      const votes = Object.keys(p.result?.votes || {}).length
      return `- ${p.id}: ${p.title} [${p.status}] (${votes} votes)`
    })
    .join('\n')
}
