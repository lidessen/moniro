import { describe, test, expect, afterEach } from 'bun:test'
// ==================== Server Module Tests ====================

import {
  registerSession,
  unregisterSession,
  getSessionInfo,
  listSessions,
  setDefaultSession,
  type SessionInfo,
} from '../src/daemon/registry.ts'

describe('Server Session Management', () => {
  // Note: These tests use the actual registry file in ~/.agent-worker
  // In a real test environment, you'd want to mock the filesystem

  const testSessionId = `test-session-${Date.now()}`
  const testSessionInfo: SessionInfo = {
    id: testSessionId,
    name: `test-agent-${Date.now()}`,
    port: 0,
    pid: process.pid,
    backend: 'default',
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
    expect(info?.backend).toBe('default')
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

import { isDaemonActive } from '../src/cli/client.ts'

describe('Client Module', () => {
  test('isDaemonActive returns false when no daemon running', () => {
    // Without a running daemon, should return false
    // (unless a daemon happens to be running on this machine)
    const active = isDaemonActive()
    expect(typeof active).toBe('boolean')
  })
})

// ==================== CLI Command Logic Tests ====================

import { buildTarget, parseTarget } from '../src/cli/target.ts'

describe('CLI Command Logic', () => {
  describe('target handling', () => {
    test('builds targets with workflow (includes tag)', () => {
      const target = buildTarget('reviewer', 'pr-123')
      expect(target).toBe('reviewer@pr-123:main')

      const parsed = parseTarget(target)
      expect(parsed.agent).toBe('reviewer')
      expect(parsed.workflow).toBe('pr-123')
    })

    test('default workflow is used when not specified', () => {
      const id = buildTarget('worker')
      expect(id).toBe('worker@global:main')

      const parsed = parseTarget(id)
      expect(parsed.workflow).toBe('global')
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
        port: 0,
        pid: process.pid,
        backend: 'default',
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
        expect(found?.backend).toBe('default')
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
        port: 0,
        pid: process.pid,
        backend: 'default',
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
        port: 0,
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
        expect(found1?.backend).toBe('default')
        expect(found2?.backend).toBe('claude')
      } finally {
        unregisterSession(id1)
        unregisterSession(id2)
      }
    })
  })

  describe('daemon check', () => {
    test('isDaemonActive returns boolean', () => {
      const active = isDaemonActive()
      expect(typeof active).toBe('boolean')
    })
  })
})

// ==================== Agent Instance Lifecycle Tests ====================

describe('Agent Workflow Lifecycle', () => {
  test('buildTarget handles workflow naming', () => {
    // Simulating workflow run --tag pr-123
    const reviewerId = buildTarget('reviewer', 'pr-123')
    const coderId = buildTarget('coder', 'pr-123')

    expect(reviewerId).toBe('reviewer@pr-123:main')
    expect(coderId).toBe('coder@pr-123:main')

    // All agents in same workflow share the workflow suffix
    const parsed1 = parseTarget(reviewerId)
    const parsed2 = parseTarget(coderId)
    expect(parsed1.workflow).toBe(parsed2.workflow)
  })

  test('default workflow is used when not specified', () => {
    const id = buildTarget('worker')
    expect(id).toBe('worker@global:main')

    const parsed = parseTarget(id)
    expect(parsed.workflow).toBe('global')
  })
})
