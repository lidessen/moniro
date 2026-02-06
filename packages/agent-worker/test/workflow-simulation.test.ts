/**
 * Workflow Simulation Tests
 * E2E tests that simulate multi-agent collaboration
 */

import { describe, test, expect, beforeEach, afterEach } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { createMemoryContextProvider } from '../src/context/memory-provider.js'
import { createAgentController, checkWorkflowIdle } from '../src/workflow/controller/controller.js'
import { createProposalManager, type ProposalManager } from '../src/context/proposals.js'
import type { AgentBackend, AgentRunContext, AgentController } from '../src/workflow/controller/types.js'
import type { ResolvedAgent } from '../src/workflow/types.js'
import type { ContextProvider } from '../src/context/provider.js'

// ==================== Test Helpers ====================

const mockAgent: ResolvedAgent = {
  model: 'mock',
  system_prompt: 'Test agent',
  resolvedSystemPrompt: 'Test agent',
}

/** Create a mock backend with custom behavior */
function createMockBackend(
  name: string,
  behavior: (ctx: AgentRunContext, provider: ContextProvider) => Promise<void>,
  provider: ContextProvider
): AgentBackend {
  return {
    name,
    async run(ctx) {
      const start = Date.now()
      try {
        await behavior(ctx, provider)
        return { success: true, duration: Date.now() - start }
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : String(error),
          duration: Date.now() - start,
        }
      }
    },
  }
}

/** Wait for a condition to be true */
async function waitFor(
  condition: () => Promise<boolean> | boolean,
  timeout = 2000,
  interval = 50
): Promise<void> {
  const start = Date.now()
  while (Date.now() - start < timeout) {
    if (await condition()) return
    await new Promise((r) => setTimeout(r, interval))
  }
  throw new Error('Timeout waiting for condition')
}

// ==================== Simulation Tests ====================

describe('Workflow Simulation', () => {
  let tempDir: string

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'workflow-sim-'))
  })

  afterEach(() => {
    try {
      rmSync(tempDir, { recursive: true })
    } catch {
      // Ignore cleanup errors
    }
  })

  test('two agents collaborate via @mentions', async () => {
    const provider = createMemoryContextProvider(['reviewer', 'coder'])
    const controllers: AgentController[] = []

    // Reviewer behavior: request code review, then acknowledge
    const reviewerBackend = createMockBackend(
      'reviewer',
      async (ctx, p) => {
        const msg = ctx.inbox[0]?.entry.content || ''
        if (msg.includes('review this')) {
          await p.appendChannel('reviewer', 'Starting review... @coder looks good!')
        } else if (msg.includes('fixed')) {
          await p.appendChannel('reviewer', 'LGTM, approved!')
        }
      },
      provider
    )

    // Coder behavior: respond to reviewer feedback
    const coderBackend = createMockBackend(
      'coder',
      async (ctx, p) => {
        const msg = ctx.inbox[0]?.entry.content || ''
        if (msg.includes('looks good')) {
          await p.appendChannel('coder', '@reviewer fixed the issues')
        }
      },
      provider
    )

    const reviewer = createAgentController({
      name: 'reviewer',
      agent: mockAgent,
      contextProvider: provider,
      mcpUrl: 'http://127.0.0.1:0/mcp',
      backend: reviewerBackend,
      pollInterval: 30,
    })

    const coder = createAgentController({
      name: 'coder',
      agent: mockAgent,
      contextProvider: provider,
      mcpUrl: 'http://127.0.0.1:0/mcp',
      backend: coderBackend,
      pollInterval: 30,
    })

    controllers.push(reviewer, coder)

    // Start controllers
    await reviewer.start()
    await coder.start()

    // Kickoff
    await provider.appendChannel('user', '@reviewer please review this PR')
    reviewer.wake()

    // Wait for conversation to complete
    await waitFor(async () => {
      const entries = await provider.readChannel()
      return entries.some((e) => e.content.includes('approved'))
    })

    // Verify conversation flow
    const entries = await provider.readChannel()
    const messages = entries.map((e) => `${e.from}: ${e.content}`)

    expect(messages).toContainEqual(expect.stringContaining('user: @reviewer'))
    expect(messages).toContainEqual(expect.stringContaining('reviewer: Starting review'))
    expect(messages).toContainEqual(expect.stringContaining('coder: @reviewer fixed'))
    expect(messages).toContainEqual(expect.stringContaining('reviewer: LGTM'))

    // Cleanup
    await Promise.all(controllers.map((c) => c.stop()))
  })

  test('agents vote on a proposal', async () => {
    const provider = createMemoryContextProvider(['alice', 'bob', 'charlie'])
    const proposalManager = createProposalManager({
      stateDir: tempDir,
      validAgents: ['alice', 'bob', 'charlie'],
    })

    const controllers: AgentController[] = []
    let proposal: ReturnType<typeof proposalManager.create> | null = null

    // Alice creates proposal and votes
    const aliceBackend = createMockBackend(
      'alice',
      async (ctx, p) => {
        const msg = ctx.inbox[0]?.entry.content || ''
        if (msg.includes('decide')) {
          proposal = proposalManager.create({
            type: 'decision',
            title: 'Choose database',
            options: [
              { id: 'postgres', label: 'PostgreSQL' },
              { id: 'mysql', label: 'MySQL' },
            ],
            createdBy: 'alice',
          })
          proposalManager.vote({ proposalId: proposal.id, voter: 'alice', choice: 'postgres' })
          await p.appendChannel('alice', `Created ${proposal.id}. @bob @charlie please vote!`)
        }
      },
      provider
    )

    // Bob votes
    const bobBackend = createMockBackend(
      'bob',
      async (ctx, _p) => {
        if (proposal && ctx.inbox.some((m) => m.entry.content.includes('please vote'))) {
          proposalManager.vote({ proposalId: proposal.id, voter: 'bob', choice: 'postgres' })
        }
      },
      provider
    )

    // Charlie votes
    const charlieBackend = createMockBackend(
      'charlie',
      async (ctx, _p) => {
        if (proposal && ctx.inbox.some((m) => m.entry.content.includes('please vote'))) {
          proposalManager.vote({ proposalId: proposal.id, voter: 'charlie', choice: 'mysql' })
        }
      },
      provider
    )

    const alice = createAgentController({
      name: 'alice',
      agent: mockAgent,
      contextProvider: provider,
      mcpUrl: 'http://127.0.0.1:0/mcp',
      backend: aliceBackend,
      pollInterval: 30,
    })

    const bob = createAgentController({
      name: 'bob',
      agent: mockAgent,
      contextProvider: provider,
      mcpUrl: 'http://127.0.0.1:0/mcp',
      backend: bobBackend,
      pollInterval: 30,
    })

    const charlie = createAgentController({
      name: 'charlie',
      agent: mockAgent,
      contextProvider: provider,
      mcpUrl: 'http://127.0.0.1:0/mcp',
      backend: charlieBackend,
      pollInterval: 30,
    })

    controllers.push(alice, bob, charlie)

    // Start controllers
    await Promise.all(controllers.map((c) => c.start()))

    // Kickoff
    await provider.appendChannel('user', '@alice please decide on database')
    alice.wake()

    // Wait for proposal creation and votes
    await waitFor(() => {
      if (!proposal) return false
      const p = proposalManager.get(proposal.id)
      return p?.status === 'resolved'
    })

    // Verify proposal resolved with correct winner
    const finalProposal = proposalManager.get(proposal!.id)
    expect(finalProposal?.status).toBe('resolved')
    expect(finalProposal?.result?.winner).toBe('postgres')
    expect(finalProposal?.result?.counts['postgres']).toBe(2)
    expect(finalProposal?.result?.counts['mysql']).toBe(1)

    // Cleanup
    await Promise.all(controllers.map((c) => c.stop()))
  })

  test('idle detection works correctly', async () => {
    const provider = createMemoryContextProvider(['agent1', 'agent2'])
    const controllers = new Map<string, AgentController>()

    const backend: AgentBackend = {
      name: 'mock',
      async run() {
        return { success: true, duration: 10 }
      },
    }

    const agent1 = createAgentController({
      name: 'agent1',
      agent: mockAgent,
      contextProvider: provider,
      mcpUrl: 'http://127.0.0.1:0/mcp',
      backend,
      pollInterval: 30,
    })

    const agent2 = createAgentController({
      name: 'agent2',
      agent: mockAgent,
      contextProvider: provider,
      mcpUrl: 'http://127.0.0.1:0/mcp',
      backend,
      pollInterval: 30,
    })

    controllers.set('agent1', agent1)
    controllers.set('agent2', agent2)

    await agent1.start()
    await agent2.start()

    // Initially should be idle (no messages)
    await waitFor(() => agent1.state === 'idle' && agent2.state === 'idle')

    const isIdle = await checkWorkflowIdle(controllers, provider, 50)
    expect(isIdle).toBe(true)

    // Add a message - no longer idle
    await provider.appendChannel('user', '@agent1 do something')

    // Check inbox has message
    const inbox = await provider.getInbox('agent1')
    expect(inbox.length).toBe(1)

    // Cleanup
    await agent1.stop()
    await agent2.stop()
  })

  test('agent retry on failure', async () => {
    const provider = createMemoryContextProvider(['worker'])
    let attempts = 0

    const backend: AgentBackend = {
      name: 'mock',
      async run(ctx) {
        attempts++
        if (attempts < 3) {
          return { success: false, error: 'Temporary failure', duration: 10 }
        }
        await provider.appendChannel('worker', 'Task completed after retries')
        return { success: true, duration: 10 }
      },
    }

    const worker = createAgentController({
      name: 'worker',
      agent: mockAgent,
      contextProvider: provider,
      mcpUrl: 'http://127.0.0.1:0/mcp',
      backend,
      pollInterval: 30,
      retry: { maxAttempts: 3, backoffMs: 10, backoffMultiplier: 1 },
    })

    await worker.start()

    // Trigger worker
    await provider.appendChannel('user', '@worker do task')
    worker.wake()

    // Wait for success after retries
    await waitFor(async () => {
      const entries = await provider.readChannel()
      return entries.some((e) => e.content.includes('completed after retries'))
    })

    expect(attempts).toBe(3)

    // Inbox should be acknowledged
    const inbox = await provider.getInbox('worker')
    expect(inbox.length).toBe(0)

    await worker.stop()
  })
})
