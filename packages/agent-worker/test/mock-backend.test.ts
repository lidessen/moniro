/**
 * Mock Backend & Agent Identity Tests
 *
 * Tests:
 * 1. Parser validation for `backend: mock` (no model required)
 * 2. Agent identity propagation through MCP transport
 * 3. Mock runner with AI SDK generateText + MCP tools
 */

import { describe, test, expect } from 'bun:test'
import { validateWorkflow } from '../src/workflow/parser.ts'
import { createMemoryContextProvider } from '../src/context/memory-provider.ts'
import { createContextMCPServer } from '../src/context/mcp-server.ts'
import { runWithHttp } from '../src/context/http-transport.ts'
import { runMockAgent } from '../src/workflow/controller/mock-runner.ts'
import type { AgentRunContext } from '../src/workflow/controller/types.ts'

// ==================== Parser Validation ====================

describe('parser: mock backend validation', () => {
  test('accepts backend: mock without model field', () => {
    const result = validateWorkflow({
      agents: {
        alice: {
          backend: 'mock',
          system_prompt: 'You are Alice.',
        },
      },
    })
    expect(result.valid).toBe(true)
    expect(result.errors).toHaveLength(0)
  })

  test('accepts backend: mock with optional model field', () => {
    const result = validateWorkflow({
      agents: {
        alice: {
          backend: 'mock',
          model: 'test-model',
          system_prompt: 'You are Alice.',
        },
      },
    })
    expect(result.valid).toBe(true)
  })

  test('rejects sdk backend without model field', () => {
    const result = validateWorkflow({
      agents: {
        alice: {
          backend: 'sdk',
          system_prompt: 'You are Alice.',
        },
      },
    })
    expect(result.valid).toBe(false)
    expect(result.errors.some((e) => e.path.includes('model'))).toBe(true)
  })

  test('accepts claude backend without model field', () => {
    const result = validateWorkflow({
      agents: {
        alice: {
          backend: 'claude',
          system_prompt: 'You are Alice.',
        },
      },
    })
    expect(result.valid).toBe(true)
  })
})

// ==================== Agent Identity Propagation ====================

describe('agent identity via MCP transport', () => {
  test('channel_send shows correct agent name (not anonymous)', async () => {
    const agentNames = ['alice', 'bob']
    const contextProvider = createMemoryContextProvider(agentNames)

    // Track channel entries
    const mentions: { from: string; target: string }[] = []

    // Start HTTP MCP server
    const httpServer = await runWithHttp({
      createServerInstance: () =>
        createContextMCPServer({
          provider: contextProvider,
          validAgents: agentNames,
          name: 'identity-test',
          version: '1.0.0',
          onMention: (from, target) => {
            mentions.push({ from, target })
          },
        }).server,
      port: 0,
    })

    try {
      // Seed inbox with a kickoff message
      await contextProvider.appendChannel('system', 'Hello @alice, please respond.')

      // Wait for inbox to propagate
      await new Promise((r) => setTimeout(r, 50))

      const inbox = await contextProvider.getInbox('alice')

      const ctx: AgentRunContext = {
        name: 'alice',
        agent: {
          system_prompt: 'You are Alice.',
          resolvedSystemPrompt: 'You are Alice.',
        },
        inbox,
        recentChannel: await contextProvider.readChannel(),
        documentContent: '',
        mcpUrl: httpServer.url,
        workspaceDir: '/tmp/test-workspace',
        projectDir: '/tmp/test-project',
        retryAttempt: 1,
      }

      const result = await runMockAgent(ctx)
      expect(result.success).toBe(true)

      // Wait for channel to be written
      await new Promise((r) => setTimeout(r, 50))

      // Read channel and verify sender identity
      const channel = await contextProvider.readChannel()
      const aliceMessages = channel.filter((e) => e.from === 'alice')

      expect(aliceMessages.length).toBeGreaterThan(0)

      // Should NOT have anonymous messages (except system)
      const anonymousMessages = channel.filter((e) => e.from === 'anonymous')
      expect(anonymousMessages).toHaveLength(0)
    } finally {
      await httpServer.close()
    }
  })

  test('different agents get different identities', async () => {
    const agentNames = ['agent1', 'agent2']
    const contextProvider = createMemoryContextProvider(agentNames)

    const httpServer = await runWithHttp({
      createServerInstance: () =>
        createContextMCPServer({
          provider: contextProvider,
          validAgents: agentNames,
          name: 'multi-id-test',
          version: '1.0.0',
        }).server,
      port: 0,
    })

    try {
      // Seed inbox for both agents
      await contextProvider.appendChannel('system', 'Hello @agent1 and @agent2.')
      await new Promise((r) => setTimeout(r, 50))

      // Run agent1
      const inbox1 = await contextProvider.getInbox('agent1')
      const result1 = await runMockAgent({
        name: 'agent1',
        agent: { system_prompt: 'You are agent1.', resolvedSystemPrompt: 'You are agent1.' },
        inbox: inbox1,
        recentChannel: [],
        documentContent: '',
        mcpUrl: httpServer.url,
        workspaceDir: '/tmp/test-workspace-1',
        projectDir: '/tmp/test-project',
        retryAttempt: 1,
      })
      expect(result1.success).toBe(true)

      // Run agent2
      const inbox2 = await contextProvider.getInbox('agent2')
      const result2 = await runMockAgent({
        name: 'agent2',
        agent: { system_prompt: 'You are agent2.', resolvedSystemPrompt: 'You are agent2.' },
        inbox: inbox2,
        recentChannel: [],
        documentContent: '',
        mcpUrl: httpServer.url,
        workspaceDir: '/tmp/test-workspace-2',
        projectDir: '/tmp/test-project',
        retryAttempt: 1,
      })
      expect(result2.success).toBe(true)

      await new Promise((r) => setTimeout(r, 50))

      // Verify both identities are correct
      const channel = await contextProvider.readChannel()
      const agent1Msgs = channel.filter((e) => e.from === 'agent1')
      const agent2Msgs = channel.filter((e) => e.from === 'agent2')

      expect(agent1Msgs.length).toBeGreaterThan(0)
      expect(agent2Msgs.length).toBeGreaterThan(0)

      // No anonymous messages
      const anonMsgs = channel.filter((e) => e.from === 'anonymous')
      expect(anonMsgs).toHaveLength(0)
    } finally {
      await httpServer.close()
    }
  })
})
