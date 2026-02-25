/**
 * Proposal & Voting System Tests
 */

import { describe, test, expect, beforeEach, afterEach } from 'bun:test'
import { tmpdir } from 'node:os'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { FileStorage } from '../src/workflow/context/storage.js'
import {
  createProposalManager,
  formatProposal,
  formatProposalList,
  type ProposalManager,
  type Proposal,
} from '../src/workflow/context/proposals.js'

describe('ProposalManager', () => {
  let manager: ProposalManager
  let tempDir: string

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'proposals-test-'))
    manager = createProposalManager({
      storage: new FileStorage(tempDir),
      validAgents: ['alice', 'bob', 'charlie'],
    })
  })

  afterEach(() => {
    try {
      rmSync(tempDir, { recursive: true })
    } catch {
      // Ignore cleanup errors
    }
  })

  describe('create', () => {
    test('creates a proposal with required fields', async () => {
      const proposal = await manager.create({
        type: 'decision',
        title: 'Choose framework',
        options: [
          { id: 'react', label: 'React' },
          { id: 'vue', label: 'Vue' },
        ],
        createdBy: 'alice',
      })

      expect(proposal.id).toMatch(/^prop-\d+$/)
      expect(proposal.type).toBe('decision')
      expect(proposal.title).toBe('Choose framework')
      expect(proposal.options).toHaveLength(2)
      expect(proposal.createdBy).toBe('alice')
      expect(proposal.status).toBe('active')
      expect(proposal.binding).toBe(true)
      expect(proposal.resolution.type).toBe('plurality')
    })

    test('creates approval proposal with default options', async () => {
      const proposal = await manager.create({
        type: 'approval',
        title: 'Approve PR',
        createdBy: 'bob',
      })

      expect(proposal.options).toHaveLength(2)
      expect(proposal.options[0]).toEqual({ id: 'approve', label: 'Approve' })
      expect(proposal.options[1]).toEqual({ id: 'reject', label: 'Reject' })
    })

    test('throws error for non-approval without options', async () => {
      expect(
        manager.create({
          type: 'decision',
          title: 'No options',
          createdBy: 'alice',
        })
      ).rejects.toThrow('Options are required')
    })

    test('generates unique IDs', async () => {
      const p1 = await manager.create({
        type: 'approval',
        title: 'First',
        createdBy: 'alice',
      })
      const p2 = await manager.create({
        type: 'approval',
        title: 'Second',
        createdBy: 'bob',
      })

      expect(p1.id).not.toBe(p2.id)
    })

    test('sets expiration time', async () => {
      const proposal = await manager.create({
        type: 'approval',
        title: 'Quick vote',
        timeoutSeconds: 60,
        createdBy: 'alice',
      })

      expect(proposal.expiresAt).toBeDefined()
      const expiresAt = new Date(proposal.expiresAt!).getTime()
      const createdAt = new Date(proposal.createdAt).getTime()
      expect(expiresAt - createdAt).toBe(60 * 1000)
    })

    test('accepts custom resolution rules', async () => {
      const proposal = await manager.create({
        type: 'decision',
        title: 'Unanimous decision',
        options: [
          { id: 'yes', label: 'Yes' },
          { id: 'no', label: 'No' },
        ],
        resolution: {
          type: 'unanimous',
          quorum: 3,
        },
        createdBy: 'alice',
      })

      expect(proposal.resolution.type).toBe('unanimous')
      expect(proposal.resolution.quorum).toBe(3)
    })
  })

  describe('vote', () => {
    let proposal: Proposal

    beforeEach(async () => {
      proposal = await manager.create({
        type: 'decision',
        title: 'Choose color',
        options: [
          { id: 'red', label: 'Red' },
          { id: 'blue', label: 'Blue' },
        ],
        createdBy: 'alice',
      })
    })

    test('records a vote', async () => {
      const result = await manager.vote({
        proposalId: proposal.id,
        voter: 'bob',
        choice: 'red',
      })

      expect(result.success).toBe(true)
      expect(result.proposal?.result?.votes['bob']).toBe('red')
      expect(result.proposal?.result?.counts['red']).toBe(1)
    })

    test('overwrites previous vote from same voter', async () => {
      await manager.vote({ proposalId: proposal.id, voter: 'bob', choice: 'red' })
      const result = await manager.vote({ proposalId: proposal.id, voter: 'bob', choice: 'blue' })

      expect(result.success).toBe(true)
      expect(result.proposal?.result?.votes['bob']).toBe('blue')
      expect(result.proposal?.result?.counts['red']).toBe(0)
      expect(result.proposal?.result?.counts['blue']).toBe(1)
    })

    test('fails for non-existent proposal', async () => {
      const result = await manager.vote({
        proposalId: 'prop-999',
        voter: 'bob',
        choice: 'red',
      })

      expect(result.success).toBe(false)
      expect(result.error).toContain('not found')
    })

    test('fails for invalid choice', async () => {
      const result = await manager.vote({
        proposalId: proposal.id,
        voter: 'bob',
        choice: 'green',
      })

      expect(result.success).toBe(false)
      expect(result.error).toContain('Invalid choice')
    })

    test('fails for unknown voter', async () => {
      const result = await manager.vote({
        proposalId: proposal.id,
        voter: 'unknown-agent',
        choice: 'red',
      })

      expect(result.success).toBe(false)
      expect(result.error).toContain('Unknown voter')
      expect(result.error).toContain('unknown-agent')
    })

    test('fails for non-active proposal', async () => {
      await manager.cancel(proposal.id, 'alice')

      const result = await manager.vote({
        proposalId: proposal.id,
        voter: 'bob',
        choice: 'red',
      })

      expect(result.success).toBe(false)
      expect(result.error).toContain('cancelled')
    })
  })

  describe('resolution', () => {
    describe('plurality', () => {
      test('resolves when all agents vote', async () => {
        const proposal = await manager.create({
          type: 'decision',
          title: 'Plurality vote',
          options: [
            { id: 'a', label: 'A' },
            { id: 'b', label: 'B' },
          ],
          createdBy: 'alice',
        })

        await manager.vote({ proposalId: proposal.id, voter: 'alice', choice: 'a' })
        await manager.vote({ proposalId: proposal.id, voter: 'bob', choice: 'a' })
        const result = await manager.vote({ proposalId: proposal.id, voter: 'charlie', choice: 'b' })

        expect(result.resolved).toBe(true)
        expect(result.proposal?.status).toBe('resolved')
        expect(result.proposal?.result?.winner).toBe('a')
      })

      test('resolves tie with tieBreaker', async () => {
        const proposal = await manager.create({
          type: 'decision',
          title: 'Tie vote',
          options: [
            { id: 'a', label: 'A' },
            { id: 'b', label: 'B' },
          ],
          resolution: { type: 'plurality', tieBreaker: 'first' },
          createdBy: 'alice',
        })

        await manager.vote({ proposalId: proposal.id, voter: 'alice', choice: 'a' })
        await manager.vote({ proposalId: proposal.id, voter: 'bob', choice: 'b' })
        const result = await manager.vote({ proposalId: proposal.id, voter: 'charlie', choice: 'a' })

        expect(result.resolved).toBe(true)
        expect(result.proposal?.result?.winner).toBe('a')
      })
    })

    describe('majority', () => {
      test('resolves when majority reached', async () => {
        const proposal = await manager.create({
          type: 'decision',
          title: 'Majority vote',
          options: [
            { id: 'a', label: 'A' },
            { id: 'b', label: 'B' },
          ],
          resolution: { type: 'majority' },
          createdBy: 'alice',
        })

        await manager.vote({ proposalId: proposal.id, voter: 'alice', choice: 'a' })
        await manager.vote({ proposalId: proposal.id, voter: 'bob', choice: 'a' })
        const result = await manager.vote({ proposalId: proposal.id, voter: 'charlie', choice: 'b' })

        // 2 out of 3 votes = 66%, which is > 50%
        expect(result.resolved).toBe(true)
        expect(result.proposal?.result?.winner).toBe('a')
      })

      test('does not resolve without majority', async () => {
        const proposal = await manager.create({
          type: 'decision',
          title: 'Split vote',
          options: [
            { id: 'a', label: 'A' },
            { id: 'b', label: 'B' },
            { id: 'c', label: 'C' },
          ],
          resolution: { type: 'majority' },
          createdBy: 'alice',
        })

        await manager.vote({ proposalId: proposal.id, voter: 'alice', choice: 'a' })
        await manager.vote({ proposalId: proposal.id, voter: 'bob', choice: 'b' })
        const result = await manager.vote({ proposalId: proposal.id, voter: 'charlie', choice: 'c' })

        // 3-way split, no majority
        expect(result.resolved).toBe(false)
        expect(result.proposal?.status).toBe('active')
      })
    })

    describe('unanimous', () => {
      test('resolves when unanimous', async () => {
        const proposal = await manager.create({
          type: 'decision',
          title: 'Unanimous vote',
          options: [
            { id: 'yes', label: 'Yes' },
            { id: 'no', label: 'No' },
          ],
          resolution: { type: 'unanimous' },
          createdBy: 'alice',
        })

        await manager.vote({ proposalId: proposal.id, voter: 'alice', choice: 'yes' })
        await manager.vote({ proposalId: proposal.id, voter: 'bob', choice: 'yes' })
        const result = await manager.vote({ proposalId: proposal.id, voter: 'charlie', choice: 'yes' })

        expect(result.resolved).toBe(true)
        expect(result.proposal?.result?.winner).toBe('yes')
      })

      test('does not resolve without unanimity', async () => {
        const proposal = await manager.create({
          type: 'decision',
          title: 'Non-unanimous vote',
          options: [
            { id: 'yes', label: 'Yes' },
            { id: 'no', label: 'No' },
          ],
          resolution: { type: 'unanimous' },
          createdBy: 'alice',
        })

        await manager.vote({ proposalId: proposal.id, voter: 'alice', choice: 'yes' })
        await manager.vote({ proposalId: proposal.id, voter: 'bob', choice: 'yes' })
        const result = await manager.vote({ proposalId: proposal.id, voter: 'charlie', choice: 'no' })

        expect(result.resolved).toBe(false)
        expect(result.proposal?.status).toBe('active')
      })
    })

    describe('quorum', () => {
      test('does not resolve before quorum', async () => {
        const proposal = await manager.create({
          type: 'decision',
          title: 'Quorum vote',
          options: [
            { id: 'a', label: 'A' },
            { id: 'b', label: 'B' },
          ],
          resolution: { type: 'plurality', quorum: 3 },
          createdBy: 'alice',
        })

        await manager.vote({ proposalId: proposal.id, voter: 'alice', choice: 'a' })
        const result = await manager.vote({ proposalId: proposal.id, voter: 'bob', choice: 'a' })

        expect(result.resolved).toBe(false)
        expect(result.proposal?.status).toBe('active')
      })

      test('resolves when quorum met', async () => {
        const proposal = await manager.create({
          type: 'decision',
          title: 'Quorum vote',
          options: [
            { id: 'a', label: 'A' },
            { id: 'b', label: 'B' },
          ],
          resolution: { type: 'plurality', quorum: 3 },
          createdBy: 'alice',
        })

        await manager.vote({ proposalId: proposal.id, voter: 'alice', choice: 'a' })
        await manager.vote({ proposalId: proposal.id, voter: 'bob', choice: 'a' })
        const result = await manager.vote({ proposalId: proposal.id, voter: 'charlie', choice: 'b' })

        expect(result.resolved).toBe(true)
        expect(result.proposal?.result?.winner).toBe('a')
      })
    })
  })

  describe('expiration', () => {
    test('expires proposal after timeout', async () => {
      const proposal = await manager.create({
        type: 'approval',
        title: 'Quick timeout',
        timeoutSeconds: 0.01, // 10ms
        createdBy: 'alice',
      })

      // Wait for expiration
      await new Promise((resolve) => setTimeout(resolve, 20))

      // Trigger expiration check
      const fetched = await manager.get(proposal.id)

      expect(fetched?.status).toBe('expired')
      expect(fetched?.result?.resolvedBy).toBe('timeout')
    })

    test('expired proposal cannot be voted on', async () => {
      const proposal = await manager.create({
        type: 'approval',
        title: 'Quick timeout',
        timeoutSeconds: 0.01,
        createdBy: 'alice',
      })

      await new Promise((resolve) => setTimeout(resolve, 20))

      const result = await manager.vote({
        proposalId: proposal.id,
        voter: 'bob',
        choice: 'approve',
      })

      expect(result.success).toBe(false)
      expect(result.error).toContain('expired')
    })
  })

  describe('cancel', () => {
    test('creator can cancel proposal', async () => {
      const proposal = await manager.create({
        type: 'approval',
        title: 'Cancellable',
        createdBy: 'alice',
      })

      const result = await manager.cancel(proposal.id, 'alice')

      expect(result.success).toBe(true)
      expect((await manager.get(proposal.id))?.status).toBe('cancelled')
    })

    test('non-creator cannot cancel proposal', async () => {
      const proposal = await manager.create({
        type: 'approval',
        title: 'Protected',
        createdBy: 'alice',
      })

      const result = await manager.cancel(proposal.id, 'bob')

      expect(result.success).toBe(false)
      expect(result.error).toContain('Only the creator')
    })

    test('cannot cancel non-active proposal', async () => {
      const proposal = await manager.create({
        type: 'approval',
        title: 'Already done',
        createdBy: 'alice',
      })

      await manager.cancel(proposal.id, 'alice')
      const result = await manager.cancel(proposal.id, 'alice')

      expect(result.success).toBe(false)
      expect(result.error).toContain('cancelled')
    })
  })

  describe('list', () => {
    test('lists all proposals', async () => {
      await manager.create({ type: 'approval', title: 'First', createdBy: 'alice' })
      await manager.create({ type: 'approval', title: 'Second', createdBy: 'bob' })

      const all = await manager.list()
      expect(all).toHaveLength(2)
    })

    test('filters by status', async () => {
      const p1 = await manager.create({ type: 'approval', title: 'First', createdBy: 'alice' })
      await manager.create({ type: 'approval', title: 'Second', createdBy: 'bob' })

      await manager.cancel(p1.id, 'alice')

      const active = await manager.list('active')
      const cancelled = await manager.list('cancelled')

      expect(active).toHaveLength(1)
      expect(cancelled).toHaveLength(1)
    })
  })

  describe('hasActiveProposals', () => {
    test('returns false when no proposals', async () => {
      expect(await manager.hasActiveProposals()).toBe(false)
    })

    test('returns true when active proposal exists', async () => {
      await manager.create({ type: 'approval', title: 'Active', createdBy: 'alice' })
      expect(await manager.hasActiveProposals()).toBe(true)
    })

    test('returns false when all proposals resolved', async () => {
      const p = await manager.create({ type: 'approval', title: 'Done', createdBy: 'alice' })
      await manager.cancel(p.id, 'alice')
      expect(await manager.hasActiveProposals()).toBe(false)
    })
  })

  describe('persistence', () => {
    test('persists proposals across manager instances', async () => {
      const p = await manager.create({
        type: 'decision',
        title: 'Persistent',
        options: [
          { id: 'a', label: 'A' },
          { id: 'b', label: 'B' },
        ],
        createdBy: 'alice',
      })

      await manager.vote({ proposalId: p.id, voter: 'bob', choice: 'a' })

      // Create new manager with same storage directory
      const manager2 = createProposalManager({
        storage: new FileStorage(tempDir),
        validAgents: ['alice', 'bob', 'charlie'],
      })

      const loaded = await manager2.get(p.id)
      expect(loaded).toBeDefined()
      expect(loaded?.title).toBe('Persistent')
      expect(loaded?.result?.votes['bob']).toBe('a')
    })

    test('preserves ID counter across instances', async () => {
      await manager.create({ type: 'approval', title: 'First', createdBy: 'alice' })
      await manager.create({ type: 'approval', title: 'Second', createdBy: 'bob' })

      const manager2 = createProposalManager({
        storage: new FileStorage(tempDir),
        validAgents: ['alice', 'bob', 'charlie'],
      })

      const p3 = await manager2.create({ type: 'approval', title: 'Third', createdBy: 'charlie' })
      expect(p3.id).toBe('prop-3')
    })
  })
})

describe('formatProposal', () => {
  test('formats proposal with votes', () => {
    const proposal: Proposal = {
      id: 'prop-1',
      type: 'decision',
      title: 'Test Proposal',
      options: [
        { id: 'a', label: 'Option A' },
        { id: 'b', label: 'Option B' },
      ],
      createdBy: 'alice',
      createdAt: '2026-02-06T10:00:00.000Z',
      expiresAt: '2026-02-06T11:00:00.000Z',
      resolution: { type: 'plurality' },
      binding: true,
      status: 'active',
      result: {
        votes: { alice: 'a', bob: 'b' },
        counts: { a: 1, b: 1 },
        resolvedBy: 'quorum',
      },
    }

    const formatted = formatProposal(proposal)

    expect(formatted).toContain('Test Proposal')
    expect(formatted).toContain('prop-1')
    expect(formatted).toContain('Option A')
    expect(formatted).toContain('Option B')
    expect(formatted).toContain('@alice')
    expect(formatted).toContain('@bob')
  })

  test('formats resolved proposal with winner', () => {
    const proposal: Proposal = {
      id: 'prop-2',
      type: 'approval',
      title: 'Approved',
      options: [
        { id: 'approve', label: 'Approve' },
        { id: 'reject', label: 'Reject' },
      ],
      createdBy: 'alice',
      createdAt: '2026-02-06T10:00:00.000Z',
      resolution: { type: 'plurality' },
      binding: true,
      status: 'resolved',
      result: {
        votes: { alice: 'approve', bob: 'approve' },
        counts: { approve: 2, reject: 0 },
        winner: 'approve',
        resolvedAt: '2026-02-06T10:05:00.000Z',
        resolvedBy: 'quorum',
      },
    }

    const formatted = formatProposal(proposal)

    expect(formatted).toContain('Winner')
    expect(formatted).toContain('Approve')
  })
})

describe('formatProposalList', () => {
  test('formats empty list', () => {
    expect(formatProposalList([])).toBe('(no proposals)')
  })

  test('formats multiple proposals', () => {
    const proposals: Proposal[] = [
      {
        id: 'prop-1',
        type: 'decision',
        title: 'First',
        options: [],
        createdBy: 'alice',
        createdAt: '',
        resolution: { type: 'plurality' },
        binding: true,
        status: 'active',
        result: { votes: { alice: 'a' }, counts: {}, resolvedBy: 'quorum' },
      },
      {
        id: 'prop-2',
        type: 'approval',
        title: 'Second',
        options: [],
        createdBy: 'bob',
        createdAt: '',
        resolution: { type: 'plurality' },
        binding: true,
        status: 'resolved',
        result: { votes: {}, counts: {}, resolvedBy: 'quorum' },
      },
    ]

    const formatted = formatProposalList(proposals)

    expect(formatted).toContain('prop-1')
    expect(formatted).toContain('First')
    expect(formatted).toContain('active')
    expect(formatted).toContain('prop-2')
    expect(formatted).toContain('Second')
    expect(formatted).toContain('resolved')
  })
})
