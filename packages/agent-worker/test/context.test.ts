import { describe, test, expect, beforeEach, afterEach } from 'bun:test'
import { mkdirSync, rmSync, existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

import {
  extractMentions,
  calculatePriority,
  MemoryContextProvider,
  FileContextProvider,
  createFileContextProvider,
  createContextMCPServer,
} from '../src/workflow/context/index.ts'
import type { ChannelEntry } from '../src/workflow/context/index.ts'

// ==================== extractMentions Tests ====================

describe('extractMentions', () => {
  const validAgents = ['reviewer', 'coder', 'assistant']

  test('extracts single mention', () => {
    const mentions = extractMentions('@reviewer please check', validAgents)
    expect(mentions).toEqual(['reviewer'])
  })

  test('extracts multiple mentions', () => {
    const mentions = extractMentions('@reviewer and @coder please collaborate', validAgents)
    expect(mentions).toEqual(['reviewer', 'coder'])
  })

  test('ignores invalid agents', () => {
    const mentions = extractMentions('@reviewer and @unknown please check', validAgents)
    expect(mentions).toEqual(['reviewer'])
  })

  test('deduplicates mentions', () => {
    const mentions = extractMentions('@reviewer @reviewer @reviewer', validAgents)
    expect(mentions).toEqual(['reviewer'])
  })

  test('returns empty array for no mentions', () => {
    const mentions = extractMentions('No mentions here', validAgents)
    expect(mentions).toEqual([])
  })

  test('handles mentions with hyphens and underscores', () => {
    const agents = ['code-reviewer', 'test_runner']
    const mentions = extractMentions('@code-reviewer @test_runner', agents)
    expect(mentions).toEqual(['code-reviewer', 'test_runner'])
  })

  test('handles mentions at different positions', () => {
    const mentions = extractMentions('@reviewer at start, middle @coder, and end @assistant', validAgents)
    expect(mentions).toEqual(['reviewer', 'coder', 'assistant'])
  })
})

// ==================== calculatePriority Tests ====================

describe('calculatePriority', () => {
  test('returns high for multiple mentions', () => {
    const entry: ChannelEntry = {
      timestamp: new Date().toISOString(),
      from: 'agent1',
      message: '@agent2 and @agent3 please help',
      mentions: ['agent2', 'agent3'],
    }
    expect(calculatePriority(entry)).toBe('high')
  })

  test('returns high for urgent keyword', () => {
    const entry: ChannelEntry = {
      timestamp: new Date().toISOString(),
      from: 'agent1',
      message: '@agent2 this is urgent',
      mentions: ['agent2'],
    }
    expect(calculatePriority(entry)).toBe('high')
  })

  test('returns high for asap keyword', () => {
    const entry: ChannelEntry = {
      timestamp: new Date().toISOString(),
      from: 'agent1',
      message: '@agent2 please do this ASAP',
      mentions: ['agent2'],
    }
    expect(calculatePriority(entry)).toBe('high')
  })

  test('returns high for blocked keyword', () => {
    const entry: ChannelEntry = {
      timestamp: new Date().toISOString(),
      from: 'agent1',
      message: '@agent2 I am blocked on this',
      mentions: ['agent2'],
    }
    expect(calculatePriority(entry)).toBe('high')
  })

  test('returns high for critical keyword', () => {
    const entry: ChannelEntry = {
      timestamp: new Date().toISOString(),
      from: 'agent1',
      message: '@agent2 critical issue found',
      mentions: ['agent2'],
    }
    expect(calculatePriority(entry)).toBe('high')
  })

  test('returns normal for single mention without urgent keywords', () => {
    const entry: ChannelEntry = {
      timestamp: new Date().toISOString(),
      from: 'agent1',
      message: '@agent2 please review when you can',
      mentions: ['agent2'],
    }
    expect(calculatePriority(entry)).toBe('normal')
  })

  test('returns normal for no mentions', () => {
    const entry: ChannelEntry = {
      timestamp: new Date().toISOString(),
      from: 'agent1',
      message: 'Just a regular message',
      mentions: [],
    }
    expect(calculatePriority(entry)).toBe('normal')
  })
})

// ==================== MemoryContextProvider Tests ====================

describe('MemoryContextProvider', () => {
  let provider: MemoryContextProvider

  beforeEach(() => {
    provider = new MemoryContextProvider(['agent1', 'agent2', 'agent3'])
  })

  describe('channel operations', () => {
    test('appends to channel', async () => {
      const entry = await provider.appendChannel('agent1', 'Hello world')

      expect(entry.from).toBe('agent1')
      expect(entry.message).toBe('Hello world')
      expect(entry.timestamp).toBeDefined()
      expect(entry.mentions).toEqual([])
    })

    test('extracts mentions when appending', async () => {
      const entry = await provider.appendChannel('agent1', '@agent2 please review')

      expect(entry.mentions).toEqual(['agent2'])
    })

    test('reads all channel entries', async () => {
      await provider.appendChannel('agent1', 'First')
      await provider.appendChannel('agent2', 'Second')

      const entries = await provider.readChannel()
      expect(entries).toHaveLength(2)
      expect(entries[0].message).toBe('First')
      expect(entries[1].message).toBe('Second')
    })

    test('reads channel entries since timestamp', async () => {
      await provider.appendChannel('agent1', 'First')
      const second = await provider.appendChannel('agent2', 'Second')
      await provider.appendChannel('agent3', 'Third')

      const entries = await provider.readChannel(second.timestamp)
      expect(entries).toHaveLength(1)
      expect(entries[0].message).toBe('Third')
    })

    test('limits channel entries', async () => {
      await provider.appendChannel('agent1', 'First')
      await provider.appendChannel('agent2', 'Second')
      await provider.appendChannel('agent3', 'Third')

      const entries = await provider.readChannel(undefined, 2)
      expect(entries).toHaveLength(2)
      expect(entries[0].message).toBe('Second')
      expect(entries[1].message).toBe('Third')
    })
  })

  describe('inbox operations', () => {
    test('gets unread inbox messages', async () => {
      await provider.appendChannel('agent1', '@agent2 please review')
      await provider.appendChannel('agent3', '@agent2 also check this')

      const inbox = await provider.getInbox('agent2')
      expect(inbox).toHaveLength(2)
      expect(inbox[0].entry.from).toBe('agent1')
      expect(inbox[1].entry.from).toBe('agent3')
    })

    test('inbox messages have priority', async () => {
      await provider.appendChannel('agent1', '@agent2 please review')
      await provider.appendChannel('agent3', '@agent2 urgent: check this')

      const inbox = await provider.getInbox('agent2')
      expect(inbox[0].priority).toBe('normal')
      expect(inbox[1].priority).toBe('high')
    })

    test('acknowledges inbox', async () => {
      const entry = await provider.appendChannel('agent1', '@agent2 please review')
      await provider.appendChannel('agent3', '@agent2 also check this')

      await provider.ackInbox('agent2', entry.timestamp)

      const inbox = await provider.getInbox('agent2')
      expect(inbox).toHaveLength(1)
      expect(inbox[0].entry.from).toBe('agent3')
    })

    test('returns empty for no mentions', async () => {
      await provider.appendChannel('agent1', 'No mentions')

      const inbox = await provider.getInbox('agent2')
      expect(inbox).toEqual([])
    })

    test('getInbox does NOT acknowledge (explicit ackInbox required)', async () => {
      await provider.appendChannel('agent1', '@agent2 first')

      // First getInbox
      const inbox1 = await provider.getInbox('agent2')
      expect(inbox1).toHaveLength(1)

      // Second getInbox - should still have the same message
      const inbox2 = await provider.getInbox('agent2')
      expect(inbox2).toHaveLength(1)
    })
  })

  describe('document operations', () => {
    test('reads empty document', async () => {
      const content = await provider.readDocument()
      expect(content).toBe('')
    })

    test('writes document', async () => {
      await provider.writeDocument('# Notes\nSome content')
      const content = await provider.readDocument()
      expect(content).toBe('# Notes\nSome content')
    })

    test('overwrites document on write', async () => {
      await provider.writeDocument('First')
      await provider.writeDocument('Second')
      const content = await provider.readDocument()
      expect(content).toBe('Second')
    })

    test('appends to document', async () => {
      await provider.writeDocument('First')
      await provider.appendDocument('\nSecond')
      const content = await provider.readDocument()
      expect(content).toBe('First\nSecond')
    })

    test('reads specific document file', async () => {
      await provider.writeDocument('Main notes', 'notes.md')
      await provider.writeDocument('Auth findings', 'findings/auth.md')

      expect(await provider.readDocument('notes.md')).toBe('Main notes')
      expect(await provider.readDocument('findings/auth.md')).toBe('Auth findings')
    })

    test('lists documents', async () => {
      await provider.writeDocument('Notes', 'notes.md')
      await provider.writeDocument('Findings', 'findings.md')

      const files = await provider.listDocuments()
      expect(files).toContain('notes.md')
      expect(files).toContain('findings.md')
    })

    test('creates new document', async () => {
      await provider.createDocument('new-doc.md', '# New Document')

      const content = await provider.readDocument('new-doc.md')
      expect(content).toBe('# New Document')
    })

    test('createDocument throws if document exists', async () => {
      await provider.writeDocument('Existing', 'existing.md')

      await expect(provider.createDocument('existing.md', 'New content')).rejects.toThrow(
        'Document already exists'
      )
    })
  })

  describe('test helpers', () => {
    test('clear removes all data', async () => {
      await provider.appendChannel('agent1', 'Message')
      await provider.writeDocument('Content')
      await provider.ackInbox('agent2', new Date().toISOString())

      provider.clear()

      expect(await provider.readChannel()).toEqual([])
      expect(await provider.readDocument()).toBe('')
      expect(provider.getInboxState('agent2')).toBeUndefined()
    })

    test('getChannelEntries returns copy', async () => {
      await provider.appendChannel('agent1', 'Test')
      const entries = provider.getChannelEntries()
      expect(entries).toHaveLength(1)
    })

    test('getDocuments returns all documents', async () => {
      await provider.writeDocument('Notes', 'notes.md')
      await provider.writeDocument('Findings', 'findings.md')

      const docs = provider.getDocuments()
      expect(docs.get('notes.md')).toBe('Notes')
      expect(docs.get('findings.md')).toBe('Findings')
    })
  })
})

// ==================== FileContextProvider Tests ====================

describe('FileContextProvider', () => {
  let testDir: string
  let provider: FileContextProvider

  beforeEach(() => {
    testDir = join(tmpdir(), `context-test-${Date.now()}-${Math.random().toString(36).slice(2)}`)
    mkdirSync(testDir, { recursive: true })
    provider = createFileContextProvider(testDir, ['agent1', 'agent2', 'agent3'])
  })

  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true })
  })

  describe('channel operations', () => {
    test('appends to channel file with ISO timestamp format', async () => {
      await provider.appendChannel('agent1', 'Hello world')

      const channelPath = join(testDir, 'channel.md')
      expect(existsSync(channelPath)).toBe(true)

      const content = readFileSync(channelPath, 'utf-8')
      expect(content).toContain('[agent1]')
      expect(content).toContain('Hello world')
      // Verify format: ### 2026-02-05T14:30:22.123Z [agent]
      expect(content).toMatch(/### \d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z \[agent1\]/)
    })

    test('reads channel entries from file', async () => {
      await provider.appendChannel('agent1', 'First message')
      await provider.appendChannel('agent2', 'Second message')

      const entries = await provider.readChannel()
      expect(entries).toHaveLength(2)
      expect(entries[0].from).toBe('agent1')
      expect(entries[0].message).toBe('First message')
      expect(entries[1].from).toBe('agent2')
    })

    test('extracts mentions from channel', async () => {
      await provider.appendChannel('agent1', '@agent2 please review this')

      const entries = await provider.readChannel()
      expect(entries[0].mentions).toEqual(['agent2'])
    })

    test('handles multiline messages', async () => {
      await provider.appendChannel('agent1', 'Line 1\nLine 2\nLine 3')

      const entries = await provider.readChannel()
      expect(entries[0].message).toBe('Line 1\nLine 2\nLine 3')
    })

    test('returns empty for non-existent channel', async () => {
      rmSync(testDir, { recursive: true, force: true })
      mkdirSync(testDir, { recursive: true })

      const newProvider = createFileContextProvider(testDir, ['agent1'])

      const entries = await newProvider.readChannel()
      expect(entries).toEqual([])
    })
  })

  describe('inbox operations', () => {
    test('gets unread inbox messages', async () => {
      await provider.appendChannel('agent1', '@agent2 check this')

      const inbox = await provider.getInbox('agent2')
      expect(inbox).toHaveLength(1)
      expect(inbox[0].entry.from).toBe('agent1')
      expect(inbox[0].priority).toBe('normal')
    })

    test('inbox messages have priority for urgent keywords', async () => {
      await provider.appendChannel('agent1', '@agent2 urgent: check this')

      const inbox = await provider.getInbox('agent2')
      expect(inbox[0].priority).toBe('high')
    })

    test('persists inbox state to file', async () => {
      const entry = await provider.appendChannel('agent1', '@agent2 check this')
      await provider.ackInbox('agent2', entry.timestamp)

      // Create new provider to verify persistence
      const newProvider = createFileContextProvider(testDir, ['agent1', 'agent2'])

      const inbox = await newProvider.getInbox('agent2')
      expect(inbox).toEqual([])
    })

    test('inbox state is stored in _state directory', async () => {
      const entry = await provider.appendChannel('agent1', '@agent2 check this')
      await provider.ackInbox('agent2', entry.timestamp)

      const statePath = join(testDir, '_state', 'inbox-state.json')
      expect(existsSync(statePath)).toBe(true)

      const state = JSON.parse(readFileSync(statePath, 'utf-8'))
      expect(state.readCursors.agent2).toBe(entry.timestamp)
    })
  })

  describe('document operations', () => {
    test('writes and reads document', async () => {
      await provider.writeDocument('# Notes\nContent here')

      const content = await provider.readDocument()
      expect(content).toBe('# Notes\nContent here')
    })

    test('appends to document', async () => {
      await provider.writeDocument('First')
      await provider.appendDocument('\nSecond')

      const content = await provider.readDocument()
      expect(content).toBe('First\nSecond')
    })

    test('returns empty for non-existent document', async () => {
      const content = await provider.readDocument()
      expect(content).toBe('')
    })

    test('documents are stored in documents directory', async () => {
      await provider.writeDocument('Content', 'notes.md')

      const docPath = join(testDir, 'documents', 'notes.md')
      expect(existsSync(docPath)).toBe(true)
      expect(readFileSync(docPath, 'utf-8')).toBe('Content')
    })

    test('supports multiple document files', async () => {
      await provider.writeDocument('Main notes', 'notes.md')
      await provider.writeDocument('Auth findings', 'findings/auth.md')

      expect(await provider.readDocument('notes.md')).toBe('Main notes')
      expect(await provider.readDocument('findings/auth.md')).toBe('Auth findings')
    })

    test('lists all document files', async () => {
      await provider.writeDocument('Notes', 'notes.md')
      await provider.writeDocument('Auth', 'findings/auth.md')
      await provider.writeDocument('API', 'findings/api.md')

      const files = await provider.listDocuments()
      expect(files).toContain('notes.md')
      expect(files).toContain('findings/auth.md')
      expect(files).toContain('findings/api.md')
    })

    test('creates new document', async () => {
      await provider.createDocument('new-doc.md', '# New')

      expect(await provider.readDocument('new-doc.md')).toBe('# New')
    })

    test('createDocument throws if document exists', async () => {
      await provider.writeDocument('Existing', 'existing.md')

      await expect(provider.createDocument('existing.md', 'New')).rejects.toThrow('Document already exists')
    })
  })
})

// ==================== createFileContextProvider Tests ====================

describe('createFileContextProvider', () => {
  let testDir: string

  beforeEach(() => {
    testDir = join(tmpdir(), `context-factory-${Date.now()}-${Math.random().toString(36).slice(2)}`)
  })

  afterEach(() => {
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true })
    }
  })

  test('creates provider with default paths', async () => {
    const provider = createFileContextProvider(testDir, ['agent1'])

    await provider.appendChannel('agent1', 'Test')
    await provider.writeDocument('Notes')

    expect(existsSync(join(testDir, 'channel.md'))).toBe(true)
    expect(existsSync(join(testDir, 'documents', 'notes.md'))).toBe(true)
  })

  test('creates provider with custom channel file', async () => {
    const provider = createFileContextProvider(testDir, ['agent1'], {
      channelFile: 'custom-channel.md',
    })

    await provider.appendChannel('agent1', 'Test')

    expect(existsSync(join(testDir, 'custom-channel.md'))).toBe(true)
  })

  test('creates provider with custom document directory', async () => {
    const provider = createFileContextProvider(testDir, ['agent1'], {
      documentDir: 'custom-docs/',
    })

    await provider.writeDocument('Notes')

    expect(existsSync(join(testDir, 'custom-docs', 'notes.md'))).toBe(true)
  })
})

// ==================== createContextMCPServer Tests ====================

describe('createContextMCPServer', () => {
  let provider: MemoryContextProvider

  beforeEach(() => {
    provider = new MemoryContextProvider(['agent1', 'agent2', 'agent3'])
  })

  test('creates server with correct name and version', () => {
    const { server } = createContextMCPServer({
      provider,
      validAgents: ['agent1', 'agent2'],
      name: 'test-context',
      version: '2.0.0',
    })

    expect(server).toBeDefined()
  })

  test('creates server with default name and version', () => {
    const { server } = createContextMCPServer({
      provider,
      validAgents: ['agent1'],
    })

    expect(server).toBeDefined()
  })

  test('tracks valid agents', () => {
    const { validAgents } = createContextMCPServer({
      provider,
      validAgents: ['agent1', 'agent2', 'agent3'],
    })

    expect(validAgents).toEqual(['agent1', 'agent2', 'agent3'])
  })

  test('initializes empty agent connections', () => {
    const { agentConnections } = createContextMCPServer({
      provider,
      validAgents: ['agent1'],
    })

    expect(agentConnections.size).toBe(0)
  })
})

// ==================== MCP Server Tool Tests ====================

describe('MCP Server Tools', () => {
  let provider: MemoryContextProvider
  let mcpServer: ReturnType<typeof createContextMCPServer>

  // Helper to call MCP tool and extract result
  async function callTool(
    toolName: string,
    args: Record<string, unknown>,
    extra?: { sessionId?: string }
  ): Promise<unknown> {
    // Access internal _registeredTools object
    const server = mcpServer.server as unknown as {
      _registeredTools: Record<
        string,
        {
          handler: (
            args: Record<string, unknown>,
            extra: unknown
          ) => Promise<{ content: Array<{ type: string; text: string }> }>
        }
      >
    }
    const tool = server._registeredTools[toolName]
    if (!tool) {
      throw new Error(`Tool ${toolName} not found`)
    }
    const result = await tool.handler(args, extra || {})
    const text = result.content[0].text
    // Try to parse as JSON, return as-is if not JSON
    try {
      return JSON.parse(text)
    } catch {
      return text
    }
  }

  beforeEach(() => {
    provider = new MemoryContextProvider(['agent1', 'agent2', 'agent3'])
    mcpServer = createContextMCPServer({
      provider,
      validAgents: ['agent1', 'agent2', 'agent3'],
    })
  })

  describe('channel_send', () => {
    test('sends message to channel', async () => {
      const result = (await callTool(
        'channel_send',
        { message: 'Hello world' },
        { sessionId: 'agent1' }
      )) as { status: string; timestamp: string; mentions: string[] }

      expect(result.status).toBe('sent')
      expect(result.timestamp).toBeDefined()
      expect(result.mentions).toEqual([])

      // Verify message in provider
      const entries = await provider.readChannel()
      expect(entries).toHaveLength(1)
      expect(entries[0].from).toBe('agent1')
      expect(entries[0].message).toBe('Hello world')
    })

    test('extracts mentions from message', async () => {
      const result = (await callTool(
        'channel_send',
        { message: '@agent2 @agent3 please review' },
        { sessionId: 'agent1' }
      )) as { mentions: string[] }

      expect(result.mentions).toEqual(['agent2', 'agent3'])
    })

    test('uses anonymous when no sessionId', async () => {
      await callTool('channel_send', { message: 'Anonymous message' })

      const entries = await provider.readChannel()
      expect(entries[0].from).toBe('anonymous')
    })
  })

  describe('channel_read', () => {
    test('reads all channel entries', async () => {
      await provider.appendChannel('agent1', 'First')
      await provider.appendChannel('agent2', 'Second')

      const result = (await callTool('channel_read', {})) as Array<{
        from: string
        message: string
      }>

      expect(result).toHaveLength(2)
      expect(result[0].message).toBe('First')
      expect(result[1].message).toBe('Second')
    })

    test('reads entries since timestamp', async () => {
      await provider.appendChannel('agent1', 'First')
      const second = await provider.appendChannel('agent2', 'Second')
      await provider.appendChannel('agent3', 'Third')

      const result = (await callTool('channel_read', {
        since: second.timestamp,
      })) as Array<{ message: string }>

      expect(result).toHaveLength(1)
      expect(result[0].message).toBe('Third')
    })

    test('limits entries', async () => {
      await provider.appendChannel('agent1', 'First')
      await provider.appendChannel('agent2', 'Second')
      await provider.appendChannel('agent3', 'Third')

      const result = (await callTool('channel_read', { limit: 2 })) as Array<{
        message: string
      }>

      expect(result).toHaveLength(2)
    })

    test('does NOT auto-acknowledge mentions', async () => {
      await provider.appendChannel('agent1', '@agent2 check this')

      // Read as agent2
      await callTool('channel_read', {}, { sessionId: 'agent2' })

      // Verify mentions NOT acknowledged (new behavior)
      const inbox = await provider.getInbox('agent2')
      expect(inbox).toHaveLength(1)
    })
  })

  describe('inbox_check', () => {
    test('gets unread inbox messages for agent', async () => {
      await provider.appendChannel('agent1', '@agent2 first mention')
      await provider.appendChannel('agent3', '@agent2 second mention')

      const result = (await callTool('inbox_check', {}, { sessionId: 'agent2' })) as {
        messages: Array<{ from: string; priority: string }>
        count: number
        latestTimestamp: string
      }

      expect(result.count).toBe(2)
      expect(result.messages).toHaveLength(2)
      expect(result.messages[0].from).toBe('agent1')
      expect(result.messages[1].from).toBe('agent3')
    })

    test('includes priority in inbox messages', async () => {
      await provider.appendChannel('agent1', '@agent2 normal request')
      await provider.appendChannel('agent3', '@agent2 urgent: critical issue')

      const result = (await callTool('inbox_check', {}, { sessionId: 'agent2' })) as {
        messages: Array<{ priority: string }>
      }

      expect(result.messages[0].priority).toBe('normal')
      expect(result.messages[1].priority).toBe('high')
    })

    test('returns empty for no unread messages', async () => {
      await provider.appendChannel('agent1', 'No mentions here')

      const result = (await callTool('inbox_check', {}, { sessionId: 'agent2' })) as {
        messages: Array<unknown>
        count: number
      }

      expect(result.messages).toEqual([])
      expect(result.count).toBe(0)
    })

    test('does NOT acknowledge (explicit inbox_ack required)', async () => {
      await provider.appendChannel('agent1', '@agent2 check this')

      // Check inbox twice
      await callTool('inbox_check', {}, { sessionId: 'agent2' })
      const result = (await callTool('inbox_check', {}, { sessionId: 'agent2' })) as {
        count: number
      }

      // Still has the message
      expect(result.count).toBe(1)
    })
  })

  describe('inbox_ack', () => {
    test('acknowledges inbox up to timestamp', async () => {
      const entry = await provider.appendChannel('agent1', '@agent2 first')
      await provider.appendChannel('agent3', '@agent2 second')

      // Acknowledge first message
      const ackResult = (await callTool(
        'inbox_ack',
        { until: entry.timestamp },
        { sessionId: 'agent2' }
      )) as { status: string; until: string }

      expect(ackResult.status).toBe('acknowledged')
      expect(ackResult.until).toBe(entry.timestamp)

      // Check inbox - should only have second message
      const inbox = await provider.getInbox('agent2')
      expect(inbox).toHaveLength(1)
      expect(inbox[0].entry.from).toBe('agent3')
    })

    test('acknowledges all messages when using latest timestamp', async () => {
      await provider.appendChannel('agent1', '@agent2 first')
      const second = await provider.appendChannel('agent3', '@agent2 second')

      // Acknowledge all
      await callTool('inbox_ack', { until: second.timestamp }, { sessionId: 'agent2' })

      const inbox = await provider.getInbox('agent2')
      expect(inbox).toEqual([])
    })
  })

  describe('document_read', () => {
    test('reads document content', async () => {
      await provider.writeDocument('# Notes\nSome content')

      const result = await callTool('document_read', {})

      expect(result).toBe('# Notes\nSome content')
    })

    test('returns placeholder for empty document', async () => {
      const result = await callTool('document_read', {})

      expect(result).toBe('(empty document)')
    })

    test('reads specific document file', async () => {
      await provider.writeDocument('Main notes', 'notes.md')
      await provider.writeDocument('Auth findings', 'findings/auth.md')

      const notesResult = await callTool('document_read', { file: 'notes.md' })
      const findingsResult = await callTool('document_read', { file: 'findings/auth.md' })

      expect(notesResult).toBe('Main notes')
      expect(findingsResult).toBe('Auth findings')
    })
  })

  describe('document_write', () => {
    test('writes document content', async () => {
      const result = await callTool('document_write', {
        content: '# New Content',
      })

      expect(result).toContain('written successfully')

      const content = await provider.readDocument()
      expect(content).toBe('# New Content')
    })

    test('writes to specific file', async () => {
      await callTool('document_write', {
        content: 'Findings content',
        file: 'findings.md',
      })

      const content = await provider.readDocument('findings.md')
      expect(content).toBe('Findings content')
    })

    test('overwrites existing content', async () => {
      await provider.writeDocument('Old content')

      await callTool('document_write', { content: 'New content' })

      const content = await provider.readDocument()
      expect(content).toBe('New content')
    })
  })

  describe('document_append', () => {
    test('appends to document', async () => {
      await provider.writeDocument('First')

      const result = await callTool('document_append', { content: '\nSecond' })

      expect(result).toContain('appended')

      const content = await provider.readDocument()
      expect(content).toBe('First\nSecond')
    })

    test('appends to specific file', async () => {
      await provider.writeDocument('Start', 'notes.md')

      await callTool('document_append', { content: '\nMore', file: 'notes.md' })

      const content = await provider.readDocument('notes.md')
      expect(content).toBe('Start\nMore')
    })

    test('appends to empty document', async () => {
      await callTool('document_append', { content: 'First content' })

      const content = await provider.readDocument()
      expect(content).toBe('First content')
    })
  })

  describe('document_list', () => {
    test('lists all document files', async () => {
      await provider.writeDocument('Notes', 'notes.md')
      await provider.writeDocument('Findings', 'findings.md')

      const result = (await callTool('document_list', {})) as {
        files: string[]
        count: number
      }

      expect(result.count).toBe(2)
      expect(result.files).toContain('notes.md')
      expect(result.files).toContain('findings.md')
    })

    test('returns empty for no documents', async () => {
      const result = (await callTool('document_list', {})) as {
        files: string[]
        count: number
      }

      expect(result.files).toEqual([])
      expect(result.count).toBe(0)
    })
  })

  describe('document_create', () => {
    test('creates new document', async () => {
      const result = await callTool('document_create', {
        file: 'new-doc.md',
        content: '# New Document',
      })

      expect(result).toContain('created successfully')

      const content = await provider.readDocument('new-doc.md')
      expect(content).toBe('# New Document')
    })

    test('fails if document exists', async () => {
      await provider.writeDocument('Existing', 'existing.md')

      await expect(
        callTool('document_create', {
          file: 'existing.md',
          content: 'New content',
        })
      ).rejects.toThrow()
    })
  })

  describe('workflow_agents', () => {
    test('lists all agents in workflow', async () => {
      const result = (await callTool('workflow_agents', {})) as {
        agents: Array<{ name: string; mention: string; isYou: boolean }>
        count: number
        hint: string
      }

      expect(result.count).toBe(3)
      expect(result.agents).toHaveLength(3)
      expect(result.agents[0]).toEqual({
        name: 'agent1',
        mention: '@agent1',
        isYou: false,
      })
      expect(result.agents[1]).toEqual({
        name: 'agent2',
        mention: '@agent2',
        isYou: false,
      })
      expect(result.hint).toContain('@agent')
    })

    test('marks current agent with isYou', async () => {
      const result = (await callTool(
        'workflow_agents',
        {},
        { sessionId: 'agent2' }
      )) as {
        agents: Array<{ name: string; mention: string; isYou: boolean }>
      }

      expect(result.agents.find((a) => a.name === 'agent1')?.isYou).toBe(false)
      expect(result.agents.find((a) => a.name === 'agent2')?.isYou).toBe(true)
      expect(result.agents.find((a) => a.name === 'agent3')?.isYou).toBe(false)
    })

    test('uses anonymous when no sessionId', async () => {
      const result = (await callTool('workflow_agents', {})) as {
        agents: Array<{ isYou: boolean }>
      }

      // All agents should have isYou: false when caller is anonymous
      expect(result.agents.every((a) => a.isYou === false)).toBe(true)
    })
  })
})

// ==================== Transport Tests ====================

describe('getSocketPath', () => {
  const { getSocketPath } = require('../src/workflow/context/transport.ts')

  test('generates socket path with workflow name and instance', () => {
    const path = getSocketPath('my-workflow', 'production')
    expect(path).toMatch(/agent-worker-my-workflow-production\.sock$/)
  })

  test('uses tmp directory', () => {
    const path = getSocketPath('test', 'default')
    expect(path).toMatch(/^(\/tmp|\/var)/)
  })
})
