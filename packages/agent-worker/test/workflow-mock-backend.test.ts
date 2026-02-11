/**
 * Workflow Mock Backend Tests
 *
 * Tests the alice-bob workflow scenario with mock CLI backends.
 * Verifies the full controller-level flow: kickoff → inbox routing →
 * agent execution → channel communication → idle detection → completion.
 *
 * This tests the same code paths as runWorkflowWithControllers but with
 * mock backends instead of real CLIs (cursor-agent, claude).
 */

import { describe, test, expect, afterEach } from 'bun:test'
import { createMemoryContextProvider } from '../src/workflow/context/memory-provider.ts'
import { createAgentController, checkWorkflowIdle } from '../src/workflow/controller/controller.ts'
import type { AgentController } from '../src/workflow/controller/types.ts'
import type { Backend } from '../src/backends/types.ts'
import type { ResolvedAgent } from '../src/workflow/types.ts'
import type { ContextProvider } from '../src/workflow/context/provider.ts'

// ==================== Helpers ====================

/**
 * Extract the inbox section from a prompt built by buildAgentPrompt().
 * The prompt mixes inbox + recent channel; behaviors must match on inbox only
 * to avoid reacting to historical channel messages.
 */
function getInboxSection(prompt: string): string {
  const start = prompt.indexOf('## Inbox')
  const end = prompt.indexOf('## Recent Activity')
  if (start === -1) return ''
  return end === -1 ? prompt.slice(start) : prompt.slice(start, end)
}

/** Wait for a condition, throw on timeout */
async function waitFor(
  condition: () => Promise<boolean> | boolean,
  timeout = 5000,
  interval = 50
): Promise<void> {
  const start = Date.now()
  while (Date.now() - start < timeout) {
    if (await condition()) return
    await new Promise((r) => setTimeout(r, interval))
  }
  throw new Error(`Timeout after ${timeout}ms waiting for condition`)
}

/**
 * Create a mock backend that simulates agent behavior.
 * The behavior function receives the prompt text (built by the controller from
 * the run context) and the shared provider, allowing it to match on inbox
 * content and write to channel (simulating MCP tool calls).
 *
 * Uses type 'claude' so the controller routes through the normal
 * build-prompt → send() path (not the mock MCP tool bridge).
 */
function createMockBackend(
  _name: string,
  behavior: (prompt: string, provider: ContextProvider, options?: { system?: string }) => Promise<void>,
  provider: ContextProvider
): Backend {
  return {
    type: 'claude' as const,
    async send(message: string, options?: { system?: string }) {
      await behavior(message, provider, options)
      return { content: '' }
    },
  }
}

// ==================== Tests ====================

/**
 * Matches the user's workflow YAML:
 *
 * agents:
 *   alice:
 *     backend: cursor
 *     model: sonnet-4.5
 *     system_prompt: You are Alice. You like to ask questions...
 *   bob:
 *     backend: claude
 *     system_prompt: You are Bob. You are knowledgeable and patient...
 *
 * kickoff: |
 *   ${{ timestamp }}
 *   @alice - Please ask @bob a simple question about AI agents.
 *   @bob - When you receive a question, answer it briefly.
 */
describe('Alice-Bob workflow with mock backends', () => {
  const controllers: AgentController[] = []

  afterEach(async () => {
    await Promise.all(controllers.map((c) => c.stop()))
    controllers.length = 0
  })

  const aliceAgent: ResolvedAgent = {
    backend: 'cursor',
    model: 'sonnet-4.5',
    system_prompt: 'You are Alice. You like to ask questions and are curious about everything.',
    resolvedSystemPrompt: 'You are Alice. You like to ask questions and are curious about everything.',
  }

  const bobAgent: ResolvedAgent = {
    backend: 'claude',
    system_prompt: 'You are Bob. You are knowledgeable and patient. You answer questions clearly and concisely.',
    resolvedSystemPrompt:
      'You are Bob. You are knowledgeable and patient. You answer questions clearly and concisely.',
  }

  test('full conversation flow: kickoff → alice asks → bob answers → complete', async () => {
    const provider = createMemoryContextProvider(['alice', 'bob'])

    // Track what each agent received (for assertions)
    const aliceRuns: { prompt: string; system?: string }[] = []
    const bobRuns: { prompt: string; system?: string }[] = []

    // Alice behavior: reads kickoff, asks Bob a question
    // Uses getInboxSection() to match only on new inbox messages, not recent channel history
    const aliceBackend = createMockBackend(
      'mock-cursor',
      async (prompt, p, options) => {
        aliceRuns.push({ prompt, system: options?.system })
        const inbox = getInboxSection(prompt)

        if (inbox.includes('Please ask @bob')) {
          // Alice asks Bob a question (simulates channel_send MCP tool call)
          await p.appendChannel('alice', '@bob What is an AI agent and how does it work?')
        }
      },
      provider
    )

    // Bob behavior: reads Alice's question, answers
    const bobBackend = createMockBackend(
      'mock-claude',
      async (prompt, p, options) => {
        bobRuns.push({ prompt, system: options?.system })
        const inbox = getInboxSection(prompt)

        if (inbox.includes('What is an AI agent')) {
          // Bob answers Alice's question (simulates channel_send MCP tool call)
          await p.appendChannel(
            'bob',
            '@alice An AI agent is a system that can perceive its environment and take actions to achieve goals autonomously.'
          )
        }
        // Otherwise: Bob receives kickoff but no question yet — do nothing
      },
      provider
    )

    const alice = createAgentController({
      name: 'alice',
      agent: aliceAgent,
      contextProvider: provider,
      mcpUrl: 'http://127.0.0.1:0/mcp',
      workspaceDir: '/tmp/test-workspace/alice',
      projectDir: '/tmp/test-project',
      backend: aliceBackend,
      pollInterval: 30,
    })

    const bob = createAgentController({
      name: 'bob',
      agent: bobAgent,
      contextProvider: provider,
      mcpUrl: 'http://127.0.0.1:0/mcp',
      workspaceDir: '/tmp/test-workspace/bob',
      projectDir: '/tmp/test-project',
      backend: bobBackend,
      pollInterval: 30,
    })

    controllers.push(alice, bob)
    await alice.start()
    await bob.start()

    // Send kickoff (same as runner does)
    const kickoff = `Test workflow started at 2026-02-06

@alice - Please ask @bob a simple question about AI agents.

@bob - When you receive a question, answer it briefly.`

    await provider.appendChannel('system', kickoff)
    alice.wake()
    bob.wake()

    // Wait for Bob's answer to appear
    await waitFor(async () => {
      const entries = await provider.readChannel()
      return entries.some((e) => e.from === 'bob' && e.content.includes('AI agent is a system'))
    })

    // Verify the full conversation flow
    const entries = await provider.readChannel()
    // Filter out stream messages (tool calls, assistant messages) to get final responses
    const messages = entries.filter((e) => !e.kind || e.kind === undefined).map((e) => ({ from: e.from, content: e.content }))

    // 1. Orchestrator kickoff
    expect(messages[0]!.from).toBe('system')
    expect(messages[0]!.content).toContain('@alice')
    expect(messages[0]!.content).toContain('@bob')

    // 2. Alice asks a question mentioning @bob
    expect(messages[1]!.from).toBe('alice')
    expect(messages[1]!.content).toContain('@bob')
    expect(messages[1]!.content).toContain('AI agent')

    // 3. Bob answers mentioning @alice
    expect(messages[2]!.from).toBe('bob')
    expect(messages[2]!.content).toContain('@alice')
    expect(messages[2]!.content).toContain('perceive its environment')

    // Verify alice received the kickoff (prompt includes inbox content)
    expect(aliceRuns.length).toBeGreaterThanOrEqual(1)
    expect(aliceRuns[0]!.prompt).toContain('Please ask @bob')
    expect(aliceRuns[0]!.system).toContain('Alice')

    // Verify bob was invoked
    expect(bobRuns.length).toBeGreaterThanOrEqual(1)

    // Verify idle detection works after conversation completes
    const controllerMap = new Map<string, AgentController>()
    controllerMap.set('alice', alice)
    controllerMap.set('bob', bob)

    // Wait for all to go idle
    await waitFor(() => alice.state === 'idle' && bob.state === 'idle')

    // After ack, inboxes should be empty → workflow idle
    const isIdle = await checkWorkflowIdle(controllerMap, provider, 50)
    expect(isIdle).toBe(true)
  })

  test('agents receive correct run context (system prompt, workspace, project)', async () => {
    const provider = createMemoryContextProvider(['alice', 'bob'])
    let capturedAlice: { prompt: string; system?: string; workspace?: string } | null = null
    let capturedBob: { prompt: string; system?: string; workspace?: string } | null = null

    const aliceBackend: Backend = {
      type: 'claude' as const,
      setWorkspace(workspaceDir: string) {
        capturedAlice = { ...capturedAlice!, workspace: workspaceDir }
      },
      async send(message: string, options?: { system?: string }) {
        capturedAlice = { ...capturedAlice, prompt: message, system: options?.system }
        return { content: '' }
      },
    }

    const bobBackend: Backend = {
      type: 'claude' as const,
      setWorkspace(workspaceDir: string) {
        capturedBob = { ...capturedBob!, workspace: workspaceDir }
      },
      async send(message: string, options?: { system?: string }) {
        capturedBob = { ...capturedBob, prompt: message, system: options?.system }
        return { content: '' }
      },
    }

    const alice = createAgentController({
      name: 'alice',
      agent: aliceAgent,
      contextProvider: provider,
      mcpUrl: 'http://127.0.0.1:0/mcp',
      workspaceDir: '/tmp/ws/alice',
      projectDir: '/home/user/my-project',
      backend: aliceBackend,
      pollInterval: 30,
    })

    const bob = createAgentController({
      name: 'bob',
      agent: bobAgent,
      contextProvider: provider,
      mcpUrl: 'http://127.0.0.1:0/mcp',
      workspaceDir: '/tmp/ws/bob',
      projectDir: '/home/user/my-project',
      backend: bobBackend,
      pollInterval: 30,
    })

    controllers.push(alice, bob)
    await alice.start()
    await bob.start()

    // Kickoff mentioning both
    await provider.appendChannel('system', '@alice hello @bob hello')
    alice.wake()
    bob.wake()

    await waitFor(() => capturedAlice !== null && capturedAlice.prompt !== undefined && capturedBob !== null && capturedBob.prompt !== undefined)

    // Alice context — verified through prompt text, system option, and setWorkspace
    expect(capturedAlice!.system).toContain('Alice')
    expect(capturedAlice!.system).toContain('curious')
    expect(capturedAlice!.workspace).toBe('/tmp/ws/alice')
    expect(capturedAlice!.prompt).toContain('Working on: /home/user/my-project')
    expect(capturedAlice!.prompt).toContain('1 message')
    expect(capturedAlice!.prompt).toContain('From @system')
    // No retry notice on first attempt
    expect(capturedAlice!.prompt).not.toContain('retry attempt')

    // Bob context
    expect(capturedBob!.system).toContain('Bob')
    expect(capturedBob!.system).toContain('knowledgeable')
    expect(capturedBob!.workspace).toBe('/tmp/ws/bob')
    expect(capturedBob!.prompt).toContain('Working on: /home/user/my-project')
    expect(capturedBob!.prompt).toContain('1 message')
  })

  test('mention-triggered wake: alice mentions bob, bob wakes up', async () => {
    const provider = createMemoryContextProvider(['alice', 'bob'])
    let bobInvokeCount = 0

    const aliceBackend = createMockBackend(
      'mock-cursor',
      async (prompt, p) => {
        const inbox = getInboxSection(prompt)
        if (inbox.includes('start')) {
          // Alice sends a message mentioning @bob
          await p.appendChannel('alice', '@bob Can you help me?')
          // Simulate the mention callback (in real workflow, MCP server does this)
          bob.wake()
        }
      },
      provider
    )

    const bobBackend = createMockBackend(
      'mock-claude',
      async (prompt, p) => {
        bobInvokeCount++
        const inbox = getInboxSection(prompt)
        if (inbox.includes('Can you help')) {
          await p.appendChannel('bob', '@alice Sure, I can help!')
        }
      },
      provider
    )

    const alice = createAgentController({
      name: 'alice',
      agent: aliceAgent,
      contextProvider: provider,
      mcpUrl: 'http://127.0.0.1:0/mcp',
      workspaceDir: '/tmp/ws/alice',
      projectDir: '/tmp/project',
      backend: aliceBackend,
      pollInterval: 30,
    })

    const bob = createAgentController({
      name: 'bob',
      agent: bobAgent,
      contextProvider: provider,
      mcpUrl: 'http://127.0.0.1:0/mcp',
      workspaceDir: '/tmp/ws/bob',
      projectDir: '/tmp/project',
      backend: bobBackend,
      pollInterval: 30,
    })

    controllers.push(alice, bob)
    await alice.start()
    await bob.start()

    // Only kickoff to alice (not bob)
    await provider.appendChannel('system', '@alice please start')
    alice.wake()

    // Bob should be woken by alice's @mention, not by kickoff
    await waitFor(async () => {
      const entries = await provider.readChannel()
      return entries.some((e) => e.from === 'bob' && e.content.includes('Sure'))
    })

    const allEntries = await provider.readChannel()
    // Filter out stream messages to get final responses
    const entries = allEntries.filter((e) => !e.kind || e.kind === undefined)
    expect(entries).toHaveLength(3)
    expect(entries[0]!.from).toBe('system')
    expect(entries[1]!.from).toBe('alice')
    expect(entries[1]!.content).toContain('@bob')
    expect(entries[2]!.from).toBe('bob')
    expect(entries[2]!.content).toContain('@alice')
    expect(entries[2]!.content).toContain('Sure')

    // Bob should have been invoked at least once (for alice's mention)
    expect(bobInvokeCount).toBeGreaterThanOrEqual(1)
  })

  test('inbox acknowledgment prevents duplicate processing', async () => {
    const provider = createMemoryContextProvider(['alice', 'bob'])
    let aliceInvokeCount = 0

    const aliceBackend = createMockBackend(
      'mock-cursor',
      async () => {
        aliceInvokeCount++
      },
      provider
    )

    const bobBackend = createMockBackend('mock-claude', async () => {}, provider)

    const alice = createAgentController({
      name: 'alice',
      agent: aliceAgent,
      contextProvider: provider,
      mcpUrl: 'http://127.0.0.1:0/mcp',
      workspaceDir: '/tmp/ws/alice',
      projectDir: '/tmp/project',
      backend: aliceBackend,
      pollInterval: 30,
    })

    const bob = createAgentController({
      name: 'bob',
      agent: bobAgent,
      contextProvider: provider,
      mcpUrl: 'http://127.0.0.1:0/mcp',
      workspaceDir: '/tmp/ws/bob',
      projectDir: '/tmp/project',
      backend: bobBackend,
      pollInterval: 30,
    })

    controllers.push(alice, bob)
    await alice.start()
    await bob.start()

    // Send one message to alice
    await provider.appendChannel('system', '@alice do something')
    alice.wake()

    // Wait for alice to process
    await waitFor(() => aliceInvokeCount >= 1)

    // Wait for a few more poll cycles
    await new Promise((r) => setTimeout(r, 200))

    // Alice should have been invoked exactly once (inbox was ack'd after first run)
    expect(aliceInvokeCount).toBe(1)

    // Inbox should be empty now
    const inbox = await provider.getInbox('alice')
    expect(inbox).toHaveLength(0)
  })

  test('workflow idle detection: all agents idle + no unread messages', async () => {
    const provider = createMemoryContextProvider(['alice', 'bob'])

    const aliceBackend = createMockBackend('mock-cursor', async () => {}, provider)
    const bobBackend = createMockBackend('mock-claude', async () => {}, provider)

    const alice = createAgentController({
      name: 'alice',
      agent: aliceAgent,
      contextProvider: provider,
      mcpUrl: 'http://127.0.0.1:0/mcp',
      workspaceDir: '/tmp/ws/alice',
      projectDir: '/tmp/project',
      backend: aliceBackend,
      pollInterval: 30,
    })

    const bob = createAgentController({
      name: 'bob',
      agent: bobAgent,
      contextProvider: provider,
      mcpUrl: 'http://127.0.0.1:0/mcp',
      workspaceDir: '/tmp/ws/bob',
      projectDir: '/tmp/project',
      backend: bobBackend,
      pollInterval: 30,
    })

    controllers.push(alice, bob)
    await alice.start()
    await bob.start()

    const controllerMap = new Map<string, AgentController>()
    controllerMap.set('alice', alice)
    controllerMap.set('bob', bob)

    // Initially idle (no messages)
    await waitFor(() => alice.state === 'idle' && bob.state === 'idle')
    const idleBeforeMsg = await checkWorkflowIdle(controllerMap, provider, 50)
    expect(idleBeforeMsg).toBe(true)

    // Send message → not idle anymore (unread inbox)
    await provider.appendChannel('system', '@alice @bob start')
    const idleWithUnread = await checkWorkflowIdle(controllerMap, provider, 50)
    expect(idleWithUnread).toBe(false)

    // Wake agents, let them process
    alice.wake()
    bob.wake()
    await waitFor(() => alice.state === 'idle' && bob.state === 'idle')

    // Let controllers settle into steady idle state
    await new Promise((r) => setTimeout(r, 100))

    // After processing + ack, idle again
    const idleAfterAck = await checkWorkflowIdle(controllerMap, provider, 50)
    expect(idleAfterAck).toBe(true)
  })

  test('multi-turn conversation: alice and bob exchange multiple messages', async () => {
    const provider = createMemoryContextProvider(['alice', 'bob'])
    let aliceTurns = 0

    const aliceBackend = createMockBackend(
      'mock-cursor',
      async (prompt, p) => {
        aliceTurns++
        const inbox = getInboxSection(prompt)

        if (inbox.includes('From @system') && inbox.includes('machine learning')) {
          await p.appendChannel('alice', '@bob What is machine learning?')
          bob.wake()
        } else if (inbox.includes('subset of AI')) {
          await p.appendChannel('alice', '@bob Thank you! That makes sense.')
          bob.wake()
        }
      },
      provider
    )

    const bobBackend = createMockBackend(
      'mock-claude',
      async (prompt, p) => {
        const inbox = getInboxSection(prompt)

        if (inbox.includes('From @alice') && inbox.includes('machine learning')) {
          await p.appendChannel(
            'bob',
            '@alice Machine learning is a subset of AI that enables systems to learn from data.'
          )
          alice.wake()
        } else if (inbox.includes('Thank you')) {
          await p.appendChannel('bob', "You're welcome!")
        }
      },
      provider
    )

    const alice = createAgentController({
      name: 'alice',
      agent: aliceAgent,
      contextProvider: provider,
      mcpUrl: 'http://127.0.0.1:0/mcp',
      workspaceDir: '/tmp/ws/alice',
      projectDir: '/tmp/project',
      backend: aliceBackend,
      pollInterval: 30,
    })

    const bob = createAgentController({
      name: 'bob',
      agent: bobAgent,
      contextProvider: provider,
      mcpUrl: 'http://127.0.0.1:0/mcp',
      workspaceDir: '/tmp/ws/bob',
      projectDir: '/tmp/project',
      backend: bobBackend,
      pollInterval: 30,
    })

    controllers.push(alice, bob)
    await alice.start()
    await bob.start()

    // Kickoff to alice only
    await provider.appendChannel('system', '@alice Please ask @bob about machine learning.')
    alice.wake()

    // Wait for full conversation to complete
    await waitFor(async () => {
      const entries = await provider.readChannel()
      return entries.some((e) => e.from === 'bob' && e.content.includes("welcome"))
    })

    const allEntries = await provider.readChannel()
    // Filter out stream messages to get final responses
    const entries = allEntries.filter((e) => !e.kind || e.kind === undefined)
    // Debug: entries.map((e) => `${e.from}: ${e.content.slice(0, 50)}`)

    // Verify 5-message flow
    expect(entries).toHaveLength(5)
    expect(entries[0]!.from).toBe('system')
    expect(entries[1]!.from).toBe('alice')
    expect(entries[1]!.content).toContain('machine learning')
    expect(entries[2]!.from).toBe('bob')
    expect(entries[2]!.content).toContain('subset of AI')
    expect(entries[3]!.from).toBe('alice')
    expect(entries[3]!.content).toContain('Thank you')
    expect(entries[4]!.from).toBe('bob')
    expect(entries[4]!.content).toContain('welcome')

    // Alice should have been invoked twice (kickoff + bob's response)
    expect(aliceTurns).toBe(2)
  })
})
