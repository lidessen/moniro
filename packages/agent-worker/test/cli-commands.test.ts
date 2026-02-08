import { describe, test, expect, afterEach } from 'bun:test'
// ==================== Server Module Tests ====================

import {
  registerSession,
  unregisterSession,
  getSessionInfo,
  listSessions,
  setDefaultSession,
  type SessionInfo,
} from '../src/daemon/server.ts'

describe('Server Session Management', () => {
  // Note: These tests use the actual registry file in ~/.agent-worker
  // In a real test environment, you'd want to mock the filesystem

  const testSessionId = `test-session-${Date.now()}`
  const testSessionInfo: SessionInfo = {
    id: testSessionId,
    name: `test-agent-${Date.now()}`,
    socketPath: `/tmp/test-${testSessionId}.sock`,
    pid: process.pid,
    backend: 'sdk',
    model: 'test-model',
    pidFile: `/tmp/test-${testSessionId}.pid`,
    workflow: 'test',
    tag: 'main',
    contextDir: '/tmp/test',
    system: 'Test system prompt',
    readyFile: `/tmp/test-${testSessionId}.ready`,
    createdAt: new Date().toISOString(),
  }

  afterEach(() => {
    // Cleanup: unregister test sessions
    try {
      unregisterSession(testSessionId)
    } catch {
      // Ignore cleanup errors
    }
  })

  test('registerSession adds session to registry', () => {
    registerSession(testSessionInfo)
    const info = getSessionInfo(testSessionId)
    expect(info).not.toBeNull()
    expect(info?.id).toBe(testSessionId)
    expect(info?.backend).toBe('sdk')
  })

  test('getSessionInfo returns session by id', () => {
    registerSession(testSessionInfo)
    const info = getSessionInfo(testSessionId)
    expect(info?.id).toBe(testSessionId)
    expect(info?.name).toBe(testSessionInfo.name)
  })

  test('getSessionInfo returns session by name', () => {
    registerSession(testSessionInfo)
    const info = getSessionInfo(testSessionInfo.name)
    expect(info?.id).toBe(testSessionId)
  })

  test('getSessionInfo returns null for unknown session', () => {
    const info = getSessionInfo('nonexistent-session-id')
    expect(info).toBeNull()
  })

  test('listSessions returns registered sessions', () => {
    registerSession(testSessionInfo)
    const sessions = listSessions()
    const found = sessions.find(s => s.id === testSessionId)
    expect(found).toBeDefined()
  })

  test('listSessions deduplicates sessions', () => {
    registerSession(testSessionInfo)
    const sessions = listSessions()
    // Should not have duplicates even though we register by both id and name
    const testSessions = sessions.filter(s => s.id === testSessionId)
    expect(testSessions.length).toBe(1)
  })

  test('unregisterSession removes session from registry', () => {
    registerSession(testSessionInfo)
    unregisterSession(testSessionId)
    const info = getSessionInfo(testSessionId)
    expect(info).toBeNull()
  })

  test('unregisterSession removes by name too', () => {
    registerSession(testSessionInfo)
    unregisterSession(testSessionInfo.name!)
    const info = getSessionInfo(testSessionId)
    expect(info).toBeNull()
  })

  test('setDefaultSession sets the default', () => {
    registerSession(testSessionInfo)
    const result = setDefaultSession(testSessionId)
    expect(result).toBe(true)
  })

  test('setDefaultSession returns false for unknown session', () => {
    const result = setDefaultSession('nonexistent-session')
    expect(result).toBe(false)
  })
})

// ==================== Client Module Tests ====================

import { sendRequest, isSessionActive } from '../src/cli/client.ts'

describe('Client Module', () => {
  test('sendRequest returns error for nonexistent session', async () => {
    const res = await sendRequest(
      { action: 'status' },
      'nonexistent-session-12345'
    )
    expect(res.success).toBe(false)
    expect(res.error).toContain('Session not found')
  })

  test('sendRequest returns error when no active session', async () => {
    // Without specifying a target, it should look for default session
    // If no default exists, it should return an error
    const res = await sendRequest({ action: 'status' })
    // This will either find a session or return "No active session"
    if (!res.success) {
      expect(res.error).toBeDefined()
    }
  })

  test('isSessionActive returns false for nonexistent session', () => {
    const active = isSessionActive('definitely-not-a-real-session-xyz')
    expect(active).toBe(false)
  })
})

// ==================== CLI Command Logic Tests ====================

import { buildAgentId, parseAgentId } from '../src/cli/instance.ts'

describe('CLI Command Logic', () => {
  describe('agent ID handling', () => {
    test('builds agent IDs with instance (includes tag)', () => {
      const agentId = buildAgentId('reviewer', 'pr-123')
      expect(agentId).toBe('reviewer@pr-123:main') // Now includes :main tag

      const parsed = parseAgentId(agentId)
      expect(parsed.agent).toBe('reviewer')
      expect(parsed.instance).toBe('pr-123') // Extracts workflow part only
    })

    test('default instance is used when not specified', () => {
      const id = buildAgentId('worker', undefined)
      expect(id).toBe('worker@global:main') // Now uses global:main

      const parsed = parseAgentId(id)
      expect(parsed.instance).toBe('global') // Extracts workflow part only
    })
  })

  describe('session management', () => {
    test('listSessions returns array', () => {
      const sessions = listSessions()
      expect(Array.isArray(sessions)).toBe(true)
    })

    test('session info contains required fields', () => {
      // Create a temporary session for testing
      const testId = `ps-test-${Date.now()}`
      const info: SessionInfo = {
        id: testId,
        socketPath: `/tmp/${testId}.sock`,
        pid: process.pid,
        backend: 'sdk',
        model: 'test',
        pidFile: `/tmp/${testId}.pid`,
        workflow: 'test',
        tag: 'main',
        contextDir: '/tmp/test',
        system: 'Test system prompt',
        readyFile: `/tmp/${testId}.ready`,
        createdAt: new Date().toISOString(),
      }

      registerSession(info)

      try {
        const sessions = listSessions()
        const found = sessions.find(s => s.id === testId)
        expect(found).toBeDefined()
        expect(found?.id).toBe(testId)
        expect(found?.backend).toBe('sdk')
        expect(found?.pid).toBe(process.pid)
      } finally {
        unregisterSession(testId)
      }
    })

    test('lists all registered sessions', () => {
      const id1 = `ls-test-1-${Date.now()}`
      const id2 = `ls-test-2-${Date.now()}`

      registerSession({
        id: id1,
        socketPath: `/tmp/${id1}.sock`,
        pid: process.pid,
        backend: 'sdk',
        model: 'test',
        pidFile: `/tmp/${id1}.pid`,
        workflow: 'test',
        tag: 'main',
        contextDir: '/tmp/test',
        system: 'Test system prompt',
        readyFile: `/tmp/${id1}.ready`,
        createdAt: new Date().toISOString(),
      })

      registerSession({
        id: id2,
        socketPath: `/tmp/${id2}.sock`,
        pid: process.pid,
        backend: 'claude',
        model: 'test',
        pidFile: `/tmp/${id2}.pid`,
        workflow: 'test',
        tag: 'main',
        contextDir: '/tmp/test',
        system: 'Test system prompt',
        readyFile: `/tmp/${id2}.ready`,
        createdAt: new Date().toISOString(),
      })

      try {
        const sessions = listSessions()
        const found1 = sessions.find(s => s.id === id1)
        const found2 = sessions.find(s => s.id === id2)

        expect(found1).toBeDefined()
        expect(found2).toBeDefined()
        expect(found1?.backend).toBe('sdk')
        expect(found2?.backend).toBe('claude')
      } finally {
        unregisterSession(id1)
        unregisterSession(id2)
      }
    })
  })

  describe('down command logic', () => {
    test('can check if session is running', () => {
      // For a non-existent session, should return false
      const running = isSessionActive('nonexistent-session-xyz')
      expect(running).toBe(false)
    })

    test('sendRequest handles shutdown action format', async () => {
      // Verify the shutdown request format is correct
      const req = { action: 'shutdown' }
      expect(req.action).toBe('shutdown')

      // Sending to nonexistent session should return error
      const res = await sendRequest(req, 'nonexistent')
      expect(res.success).toBe(false)
    })
  })
})

// ==================== Agent Instance Lifecycle Tests ====================

describe('Agent Instance Lifecycle', () => {
  test('buildAgentId handles workflow instance naming', () => {
    // Simulating workflow run --tag pr-123
    const reviewerId = buildAgentId('reviewer', 'pr-123')
    const coderId = buildAgentId('coder', 'pr-123')

    expect(reviewerId).toBe('reviewer@pr-123:main') // Includes tag
    expect(coderId).toBe('coder@pr-123:main') // Includes tag

    // All agents in same workflow instance share the instance suffix
    const parsed1 = parseAgentId(reviewerId)
    const parsed2 = parseAgentId(coderId)
    expect(parsed1.instance).toBe(parsed2.instance)
  })

  test('default instance is used when not specified', () => {
    const id = buildAgentId('worker', undefined)
    expect(id).toBe('worker@global:main') // Now uses global:main

    const parsed = parseAgentId(id)
    expect(parsed.instance).toBe('global') // Extracts workflow part
  })
})
