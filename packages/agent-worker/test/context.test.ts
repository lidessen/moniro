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
import type { Message } from '../src/workflow/context/index.ts'


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
    const entry: Message = {
      id: 'test-id-1',
      timestamp: new Date().toISOString(),
      from: 'agent1',
      content: '@agent2 and @agent3 please help',
      mentions: ['agent2', 'agent3'],
    }
    expect(calculatePriority(entry)).toBe('high')
  })

  test('returns high for urgent keyword', () => {
    const entry: Message = {
      id: 'test-id-2',
      timestamp: new Date().toISOString(),
      from: 'agent1',
      content: '@agent2 this is urgent',
      mentions: ['agent2'],
    }
    expect(calculatePriority(entry)).toBe('high')
  })

  test('returns high for asap keyword', () => {
    const entry: Message = {
      id: 'test-id-3',
      timestamp: new Date().toISOString(),
      from: 'agent1',
      content: '@agent2 please do this ASAP',
      mentions: ['agent2'],
    }
    expect(calculatePriority(entry)).toBe('high')
  })

  test('returns high for blocked keyword', () => {
    const entry: Message = {
      id: 'test-id-4',
      timestamp: new Date().toISOString(),
      from: 'agent1',
      content: '@agent2 I am blocked on this',
      mentions: ['agent2'],
    }
    expect(calculatePriority(entry)).toBe('high')
  })

  test('returns high for critical keyword', () => {
    const entry: Message = {
      id: 'test-id-5',
      timestamp: new Date().toISOString(),
      from: 'agent1',
      content: '@agent2 critical issue found',
      mentions: ['agent2'],
    }
    expect(calculatePriority(entry)).toBe('high')
  })

  test('returns normal for single mention without urgent keywords', () => {
    const entry: Message = {
      id: 'test-id-6',
      timestamp: new Date().toISOString(),
      from: 'agent1',
      content: '@agent2 please review when you can',
      mentions: ['agent2'],
    }
    expect(calculatePriority(entry)).toBe('normal')
  })

  test('returns normal for no mentions', () => {
    const entry: Message = {
      id: 'test-id-7',
      timestamp: new Date().toISOString(),
      from: 'agent1',
      content: 'Just a regular message',
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
      expect(entry.content).toBe('Hello world')
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
      expect(entries[0]!.content).toBe('First')
      expect(entries[1]!.content).toBe('Second')
    })

    test('reads channel entries since timestamp', async () => {
      await provider.appendChannel('agent1', 'First')
      const second = await provider.appendChannel('agent2', 'Second')
      // Ensure next message gets a strictly later timestamp
      await new Promise(r => setTimeout(r, 2))
      await provider.appendChannel('agent3', 'Third')

      const entries = await provider.readChannel({ since: second.timestamp })
      expect(entries).toHaveLength(1)
      expect(entries[0]!.content).toBe('Third')
    })

    test('limits channel entries', async () => {
      await provider.appendChannel('agent1', 'First')
      await provider.appendChannel('agent2', 'Second')
      await provider.appendChannel('agent3', 'Third')

      const entries = await provider.readChannel({ limit: 2 })
      expect(entries).toHaveLength(2)
      expect(entries[0]!.content).toBe('Second')
      expect(entries[1]!.content).toBe('Third')
    })
  })

  describe('inbox operations', () => {
    test('gets unread inbox messages', async () => {
      await provider.appendChannel('agent1', '@agent2 please review')
      await provider.appendChannel('agent3', '@agent2 also check this')

      const inbox = await provider.getInbox('agent2')
      expect(inbox).toHaveLength(2)
      expect(inbox[0]!.entry.from).toBe('agent1')
      expect(inbox[1]!.entry.from).toBe('agent3')
    })

    test('inbox messages have priority', async () => {
      await provider.appendChannel('agent1', '@agent2 please review')
      await provider.appendChannel('agent3', '@agent2 urgent: check this')

      const inbox = await provider.getInbox('agent2')
      expect(inbox[0]!.priority).toBe('normal')
      expect(inbox[1]!.priority).toBe('high')
    })

    test('acknowledges inbox', async () => {
      const entry = await provider.appendChannel('agent1', '@agent2 please review')
      await provider.appendChannel('agent3', '@agent2 also check this')

      await provider.ackInbox('agent2', entry.id)

      const inbox = await provider.getInbox('agent2')
      expect(inbox).toHaveLength(1)
      expect(inbox[0]!.entry.from).toBe('agent3')
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

  describe('resource API', () => {
    test('createResource returns ID and ref', async () => {
      const content = '# Report\n' + 'Content line\n'.repeat(100)
      const result = await provider.createResource(content, 'agent1')

      expect(result.id).toMatch(/^res_/)
      expect(result.ref).toBe(`resource:${result.id}`)
    })

    test('readResource returns content by ID', async () => {
      const content = '# Long Document\n' + 'Content line\n'.repeat(100)
      const { id } = await provider.createResource(content, 'agent1')

      const retrieved = await provider.readResource(id)
      expect(retrieved).toBe(content)
    })

    test('readResource returns null for missing ID', async () => {
      const content = await provider.readResource('res_nonexistent')
      expect(content).toBeNull()
    })

    test('clear also clears resources', async () => {
      const { id } = await provider.createResource('Test content', 'agent1')

      provider.clear()

      const content = await provider.readResource(id)
      expect(content).toBeNull()
    })

    test('getResources returns all resources', async () => {
      await provider.createResource('Content 1', 'agent1')
      await provider.createResource('Content 2', 'agent2')

      const resources = await provider.getResources()
      expect(resources.size).toBe(2)
    })

    test('channel message can reference resource', async () => {
      const { ref } = await provider.createResource('Full report content', 'agent1')
      await provider.appendChannel('agent1', `Analysis complete. See [full report](${ref})`)

      const entries = await provider.readChannel()
      expect(entries[0]!.content).toContain('resource:res_')
    })
  })

  describe('smartSend', () => {
    test('sends short message directly without conversion', async () => {
      const shortContent = 'This is a short message'
      const msg = await provider.smartSend('agent1', shortContent)

      expect(msg.content).toBe(shortContent)
      expect(msg.from).toBe('agent1')

      // Should not create any resource
      const entries = await provider.readChannel()
      expect(entries).toHaveLength(1)
      expect(entries[0]!.content).toBe(shortContent)
    })

    test('converts long message to resource', async () => {
      // Create message exceeding MESSAGE_LENGTH_THRESHOLD (1200 chars)
      const longContent = 'A'.repeat(1500)
      const msg = await provider.smartSend('agent1', longContent)

      // Should create short reference message
      expect(msg.content).toContain('[Long content stored as resource]')
      expect(msg.content).toContain('resource_read')
      expect(msg.content).toMatch(/resource:res_/)

      // Extract resource ID from message
      const resourceMatch = msg.content.match(/resource:res_[a-z0-9]+/)
      expect(resourceMatch).toBeDefined()
      const resourceRef = resourceMatch![0]
      const resourceId = resourceRef.replace('resource:', '')

      // Verify resource was created with full content
      const retrieved = await provider.readResource(resourceId)
      expect(retrieved).toBe(longContent)
    })

    test('logs full content in debug channel for long messages', async () => {
      const longContent = 'B'.repeat(1500)
      await provider.smartSend('agent1', longContent)

      // Check channel entries - should have 2: debug log + reference message
      const entries = await provider.readChannel()
      expect(entries.length).toBeGreaterThanOrEqual(2)

      // Find debug entry (kind='debug', from='system')
      const debugEntry = entries.find(e => e.kind === 'debug' && e.from === 'system')
      expect(debugEntry).toBeDefined()
      expect(debugEntry!.content).toContain('Created resource')
      expect(debugEntry!.content).toContain('(1500 chars)')
      expect(debugEntry!.content).toContain('@agent1')
      expect(debugEntry!.content).toContain(longContent) // Full content in debug
    })

    test('detects markdown content for resource type', async () => {
      const markdownContent = '```typescript\n' + 'const x = 1;\n'.repeat(100) + '```'
      await provider.smartSend('agent1', markdownContent)

      const entries = await provider.readChannel()
      const refMessage = entries.find(e => e.from === 'agent1' && e.content.includes('resource:'))
      expect(refMessage).toBeDefined()

      // Extract and verify resource was created as markdown
      const resourceMatch = refMessage!.content.match(/resource:(res_[a-z0-9]+)/)
      expect(resourceMatch).toBeDefined()
      const resourceId = resourceMatch![1]!
      const retrieved = await provider.readResource(resourceId)
      expect(retrieved).toBe(markdownContent)
    })

    test('works with DM option', async () => {
      const longContent = 'C'.repeat(1500)
      const msg = await provider.smartSend('agent1', longContent, { to: 'agent2' })

      expect(msg.to).toBe('agent2')
      expect(msg.content).toContain('[Long content stored as resource]')
    })

    test('preserves @mentions in short message', async () => {
      const longContent = '@agent2 @agent3 ' + 'X'.repeat(1500)
      const msg = await provider.smartSend('agent1', longContent)

      // Short message should contain the @mentions
      expect(msg.content).toContain('@agent2')
      expect(msg.content).toContain('@agent3')
      expect(msg.content).toContain('[Long content stored as resource]')

      // Mentions array should be populated
      expect(msg.mentions).toContain('agent2')
      expect(msg.mentions).toContain('agent3')
    })

    test('filters invalid @mentions', async () => {
      const longContent = '@agent2 @invalid_agent @unknown ' + 'Y'.repeat(1500)
      const msg = await provider.smartSend('agent1', longContent)

      // Only valid agent mention should be preserved
      expect(msg.content).toContain('@agent2')
      expect(msg.content).not.toContain('@invalid_agent')
      expect(msg.content).not.toContain('@unknown')
      expect(msg.mentions).toEqual(['agent2'])
    })

    test('handles no @mentions gracefully', async () => {
      const longContent = 'Z'.repeat(1500)
      const msg = await provider.smartSend('agent1', longContent)

      // Should work fine without mentions
      expect(msg.content).toContain('[Long content stored as resource]')
      expect(msg.content).not.toMatch(/@\w+/)
      expect(msg.mentions).toEqual([])
    })

    test('threshold boundary: 1200 chars sends directly', async () => {
      const content = 'D'.repeat(1200)
      const msg = await provider.smartSend('agent1', content)

      // Exactly 1200 should send directly (threshold is >1200)
      expect(msg.content).toBe(content)
    })

    test('threshold boundary: 1201 chars converts to resource', async () => {
      const content = 'E'.repeat(1201)
      const msg = await provider.smartSend('agent1', content)

      // 1201 should convert to resource
      expect(msg.content).toContain('[Long content stored as resource]')
      expect(msg.content).toContain('resource:')
    })
  })

  describe('test helpers', () => {
    test('clear removes all data', async () => {
      const msg = await provider.appendChannel('agent1', 'Message')
      await provider.writeDocument('Content')
      await provider.ackInbox('agent2', msg.id)

      provider.clear()

      expect(await provider.readChannel()).toEqual([])
      expect(await provider.readDocument()).toBe('')
      expect(await provider.getInboxState('agent2')).toBeUndefined()
    })

    test('getMessages returns entries', async () => {
      await provider.appendChannel('agent1', 'Test')
      const entries = await provider.getMessages()
      expect(entries).toHaveLength(1)
    })

    test('getDocuments returns all documents', async () => {
      await provider.writeDocument('Notes', 'notes.md')
      await provider.writeDocument('Findings', 'findings.md')

      const docs = await provider.getDocuments()
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
    test('appends to channel file in JSONL format', async () => {
      await provider.appendChannel('agent1', 'Hello world')

      const channelPath = join(testDir, 'channel.jsonl')
      expect(existsSync(channelPath)).toBe(true)

      const content = readFileSync(channelPath, 'utf-8')
      const entry = JSON.parse(content.trim())
      expect(entry.from).toBe('agent1')
      expect(entry.content).toBe('Hello world')
      expect(entry.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/)
      expect(entry.mentions).toEqual([])
    })

    test('reads channel entries from file', async () => {
      await provider.appendChannel('agent1', 'First message')
      await provider.appendChannel('agent2', 'Second message')

      const entries = await provider.readChannel()
      expect(entries).toHaveLength(2)
      expect(entries[0]!.from).toBe('agent1')
      expect(entries[0]!.content).toBe('First message')
      expect(entries[1]!.from).toBe('agent2')
    })

    test('extracts mentions from channel', async () => {
      await provider.appendChannel('agent1', '@agent2 please review this')

      const entries = await provider.readChannel()
      expect(entries[0]!.mentions).toEqual(['agent2'])
    })

    test('handles multiline messages', async () => {
      await provider.appendChannel('agent1', 'Line 1\nLine 2\nLine 3')

      const entries = await provider.readChannel()
      expect(entries[0]!.content).toBe('Line 1\nLine 2\nLine 3')
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
      expect(inbox[0]!.entry.from).toBe('agent1')
      expect(inbox[0]!.priority).toBe('normal')
    })

    test('inbox messages have priority for urgent keywords', async () => {
      await provider.appendChannel('agent1', '@agent2 urgent: check this')

      const inbox = await provider.getInbox('agent2')
      expect(inbox[0]!.priority).toBe('high')
    })

    test('persists inbox state to file', async () => {
      const entry = await provider.appendChannel('agent1', '@agent2 check this')
      await provider.ackInbox('agent2', entry.id)

      // Create new provider to verify persistence
      const newProvider = createFileContextProvider(testDir, ['agent1', 'agent2'])

      const inbox = await newProvider.getInbox('agent2')
      expect(inbox).toEqual([])
    })

    test('inbox state is stored in _state directory', async () => {
      const entry = await provider.appendChannel('agent1', '@agent2 check this')
      await provider.ackInbox('agent2', entry.id)

      const statePath = join(testDir, '_state', 'inbox.json')
      expect(existsSync(statePath)).toBe(true)

      const state = JSON.parse(readFileSync(statePath, 'utf-8'))
      expect(state.readCursors.agent2).toBe(entry.id)
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

  describe('resource API', () => {
    test('createResource stores file and returns ID', async () => {
      const content = '# Long Report\n' + 'Line content\n'.repeat(100)
      const result = await provider.createResource(content, 'agent1')

      // Should return ID and ref
      expect(result.id).toMatch(/^res_/)
      expect(result.ref).toBe(`resource:${result.id}`)

      // File should exist in resources directory
      const resourcesDir = join(testDir, 'resources')
      expect(existsSync(resourcesDir)).toBe(true)
    })

    test('readResource returns file content by ID', async () => {
      const content = '# Long Document\n' + 'Content\n'.repeat(100)
      const { id } = await provider.createResource(content, 'agent1', 'markdown')

      const retrieved = await provider.readResource(id)
      expect(retrieved).toBe(content)
    })

    test('readResource returns null for missing ID', async () => {
      const content = await provider.readResource('res_nonexistent')
      expect(content).toBeNull()
    })

    test('supports different content types', async () => {
      const mdContent = '# Markdown'
      const jsonContent = '{"key": "value"}'
      const diffContent = '+ added\n- removed'

      const mdResult = await provider.createResource(mdContent, 'agent1', 'markdown')
      const jsonResult = await provider.createResource(jsonContent, 'agent1', 'json')
      const diffResult = await provider.createResource(diffContent, 'agent1', 'diff')

      expect(await provider.readResource(mdResult.id)).toBe(mdContent)
      expect(await provider.readResource(jsonResult.id)).toBe(jsonContent)
      expect(await provider.readResource(diffResult.id)).toBe(diffContent)
    })

    test('channel message can reference resource', async () => {
      const { ref } = await provider.createResource('Full report content', 'agent1')
      await provider.appendChannel('agent1', `Analysis complete. See [full report](${ref})`)

      const entries = await provider.readChannel()
      expect(entries[0]!.content).toContain('resource:res_')
    })
  })

  describe('smartSend', () => {
    test('sends short message directly without conversion', async () => {
      const shortContent = 'This is a short message for file provider'
      const msg = await provider.smartSend('agent1', shortContent)

      expect(msg.content).toBe(shortContent)
      expect(msg.from).toBe('agent1')

      // Verify no resource was created (message sent directly)
      const entries = await provider.readChannel()
      expect(entries).toHaveLength(1)
      expect(entries[0]!.content).toBe(shortContent)
      expect(entries[0]!.content).not.toContain('resource:')
    })

    test('converts long message to resource file', async () => {
      const longContent = 'F'.repeat(1500)
      const msg = await provider.smartSend('agent1', longContent)

      // Should create short reference message
      expect(msg.content).toContain('[Long content stored as resource]')
      expect(msg.content).toContain('resource_read')
      expect(msg.content).toMatch(/resource:res_/)

      // Extract resource ID
      const resourceMatch = msg.content.match(/resource:res_[a-z0-9]+/)
      expect(resourceMatch).toBeDefined()
      const resourceRef = resourceMatch![0]
      const resourceId = resourceRef.replace('resource:', '')

      // Verify resource file was created
      const retrieved = await provider.readResource(resourceId)
      expect(retrieved).toBe(longContent)

      // Verify file exists in resources directory
      const resourcesDir = join(testDir, 'resources')
      expect(existsSync(resourcesDir)).toBe(true)
    })

    test('logs full content in debug channel', async () => {
      const longContent = 'G'.repeat(1500)
      await provider.smartSend('agent1', longContent)

      const entries = await provider.readChannel()

      // Find debug entry
      const debugEntry = entries.find(e => e.kind === 'debug' && e.from === 'system')
      expect(debugEntry).toBeDefined()
      expect(debugEntry!.content).toContain('Created resource')
      expect(debugEntry!.content).toContain('(1500 chars)')
      expect(debugEntry!.content).toContain('@agent1')
      expect(debugEntry!.content).toContain(longContent)
    })

    test('persists across provider instances', async () => {
      const longContent = 'H'.repeat(1500)
      await provider.smartSend('agent1', longContent)

      // Create new provider instance
      const newProvider = createFileContextProvider(testDir, ['agent1', 'agent2'])

      // Should be able to read the resource
      const entries = await newProvider.readChannel()
      const refMessage = entries.find(e => e.from === 'agent1' && e.content.includes('resource:'))
      expect(refMessage).toBeDefined()

      const resourceMatch = refMessage!.content.match(/resource:(res_[a-z0-9]+)/)
      expect(resourceMatch).toBeDefined()
      const resourceId = resourceMatch![1]!
      const retrieved = await newProvider.readResource(resourceId)
      expect(retrieved).toBe(longContent)
    })

    test('preserves @mentions in short message', async () => {
      const longContent = '@agent2 ' + 'K'.repeat(1500)
      const msg = await provider.smartSend('agent1', longContent)

      expect(msg.content).toContain('@agent2')
      expect(msg.content).toContain('[Long content stored as resource]')
      expect(msg.mentions).toContain('agent2')
    })

    test('filters invalid @mentions', async () => {
      const longContent = '@agent2 @nonexistent ' + 'L'.repeat(1500)
      const msg = await provider.smartSend('agent1', longContent)

      expect(msg.content).toContain('@agent2')
      expect(msg.content).not.toContain('@nonexistent')
      expect(msg.mentions).toEqual(['agent2'])
    })

    test('threshold boundary behavior', async () => {
      // Exactly 1200 should send directly
      const at1200 = 'I'.repeat(1200)
      const msg1200 = await provider.smartSend('agent1', at1200)
      expect(msg1200.content).toBe(at1200)

      // 1201 should convert
      const at1201 = 'J'.repeat(1201)
      const msg1201 = await provider.smartSend('agent1', at1201)
      expect(msg1201.content).toContain('[Long content stored as resource]')
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

    // Channel is JSONL, documents are under documents/
    expect(existsSync(join(testDir, 'channel.jsonl'))).toBe(true)
    expect(existsSync(join(testDir, 'documents', 'notes.md'))).toBe(true)
  })

  test('creates resources directory on demand', async () => {
    const provider = createFileContextProvider(testDir, ['agent1'])

    const result = await provider.createResource('Long content', 'agent1', 'markdown')

    expect(result.id).toMatch(/^res_/)
    expect(existsSync(join(testDir, 'resources'))).toBe(true)
  })

  test('stores inbox state in _state directory', async () => {
    const provider = createFileContextProvider(testDir, ['agent1', 'agent2'])

    const entry = await provider.appendChannel('agent1', '@agent2 hello')
    await provider.ackInbox('agent2', entry.id)

    expect(existsSync(join(testDir, '_state', 'inbox.json'))).toBe(true)
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
    const text = result.content[0]!.text
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

      // Verify messages in provider (tool call + actual message)
      const entries = await provider.readChannel()
      expect(entries).toHaveLength(2)

      // First entry: tool call log
      expect(entries[0]!.from).toBe('agent1')
      expect(entries[0]!.kind).toBe('tool_call')
      expect(entries[0]!.toolCall?.name).toBe('channel_send')

      // Second entry: actual message
      expect(entries[1]!.from).toBe('agent1')
      expect(entries[1]!.content).toBe('Hello world')
      expect(entries[1]!.kind).toBeUndefined() // Regular message
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
      expect(entries[0]!.from).toBe('anonymous')
    })
  })

  describe('channel_read', () => {
    test('reads all channel entries', async () => {
      await provider.appendChannel('agent1', 'First')
      await provider.appendChannel('agent2', 'Second')

      const result = (await callTool('channel_read', {})) as Array<{
        from: string
        content: string
      }>

      expect(result).toHaveLength(2)
      expect(result[0]!.content).toBe('First')
      expect(result[1]!.content).toBe('Second')
    })

    test('reads entries since timestamp', async () => {
      await provider.appendChannel('agent1', 'First')
      const second = await provider.appendChannel('agent2', 'Second')
      // Ensure next message gets a strictly later timestamp
      await new Promise(r => setTimeout(r, 2))
      await provider.appendChannel('agent3', 'Third')

      const result = (await callTool('channel_read', {
        since: second.timestamp,
      })) as Array<{ content: string }>

      expect(result).toHaveLength(1)
      expect(result[0]!.content).toBe('Third')
    })

    test('limits entries', async () => {
      await provider.appendChannel('agent1', 'First')
      await provider.appendChannel('agent2', 'Second')
      await provider.appendChannel('agent3', 'Third')

      const result = (await callTool('channel_read', { limit: 2 })) as Array<{
        content: string
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

  describe('resource_create', () => {
    test('creates resource and returns ID/ref', async () => {
      const content = '# Long Document\n' + 'Content line\n'.repeat(100)

      const result = (await callTool('resource_create', { content }, { sessionId: 'agent1' })) as {
        id: string
        ref: string
        hint: string
      }

      expect(result.id).toMatch(/^res_/)
      expect(result.ref).toBe(`resource:${result.id}`)
      expect(result.hint).toContain('Use [description]')
    })

    test('supports type parameter', async () => {
      const result = (await callTool(
        'resource_create',
        { content: '{"key": "value"}', type: 'json' },
        { sessionId: 'agent1' }
      )) as { id: string }

      expect(result.id).toMatch(/^res_/)
    })
  })

  describe('resource_read', () => {
    test('reads resource content by ID', async () => {
      const content = '# Long Document\n' + 'Content line\n'.repeat(100)
      const { id } = await provider.createResource(content, 'agent1')

      const result = await callTool('resource_read', { id })

      expect(result).toBe(content)
    })

    test('returns error for missing resource', async () => {
      const result = (await callTool('resource_read', {
        id: 'res_nonexistent',
      })) as { error: string }

      expect(result.error).toContain('not found')
    })
  })

  describe('my_inbox', () => {
    test('gets unread inbox messages for agent', async () => {
      await provider.appendChannel('agent1', '@agent2 first mention')
      await provider.appendChannel('agent3', '@agent2 second mention')

      const result = (await callTool('my_inbox', {}, { sessionId: 'agent2' })) as {
        messages: Array<{ id: string; from: string; priority: string }>
        count: number
      }

      expect(result.count).toBe(2)
      expect(result.messages).toHaveLength(2)
      expect(result.messages[0]!.from).toBe('agent1')
      expect(result.messages[1]!.from).toBe('agent3')
    })

    test('includes priority in inbox messages', async () => {
      await provider.appendChannel('agent1', '@agent2 normal request')
      await provider.appendChannel('agent3', '@agent2 urgent: critical issue')

      const result = (await callTool('my_inbox', {}, { sessionId: 'agent2' })) as {
        messages: Array<{ priority: string }>
      }

      expect(result.messages[0]!.priority).toBe('normal')
      expect(result.messages[1]!.priority).toBe('high')
    })

    test('returns empty for no unread messages', async () => {
      await provider.appendChannel('agent1', 'No mentions here')

      const result = (await callTool('my_inbox', {}, { sessionId: 'agent2' })) as {
        messages: Array<unknown>
        count: number
      }

      expect(result.messages).toEqual([])
      expect(result.count).toBe(0)
    })

    test('does NOT acknowledge (explicit my_inbox_ack required)', async () => {
      await provider.appendChannel('agent1', '@agent2 check this')

      // Check inbox twice
      await callTool('my_inbox', {}, { sessionId: 'agent2' })
      const result = (await callTool('my_inbox', {}, { sessionId: 'agent2' })) as {
        count: number
      }

      // Still has the message
      expect(result.count).toBe(1)
    })
  })

  describe('my_inbox_ack', () => {
    test('acknowledges inbox up to message ID', async () => {
      const entry = await provider.appendChannel('agent1', '@agent2 first')
      await provider.appendChannel('agent3', '@agent2 second')

      // Acknowledge first message by ID
      const ackResult = (await callTool(
        'my_inbox_ack',
        { until: entry.id },
        { sessionId: 'agent2' }
      )) as { status: string; until: string }

      expect(ackResult.status).toBe('acknowledged')
      expect(ackResult.until).toBe(entry.id)

      // Check inbox - should only have second message
      const inbox = await provider.getInbox('agent2')
      expect(inbox).toHaveLength(1)
      expect(inbox[0]!.entry.from).toBe('agent3')
    })

    test('acknowledges all messages when using latest ID', async () => {
      await provider.appendChannel('agent1', '@agent2 first')
      const second = await provider.appendChannel('agent3', '@agent2 second')

      // Acknowledge all by last message ID
      await callTool('my_inbox_ack', { until: second.id }, { sessionId: 'agent2' })

      const inbox = await provider.getInbox('agent2')
      expect(inbox).toEqual([])
    })
  })

  describe('team_doc_read', () => {
    test('reads document content', async () => {
      await provider.writeDocument('# Notes\nSome content')

      const result = await callTool('team_doc_read', {})

      expect(result).toBe('# Notes\nSome content')
    })

    test('returns placeholder for empty document', async () => {
      const result = await callTool('team_doc_read', {})

      expect(result).toBe('(empty document)')
    })

    test('reads specific document file', async () => {
      await provider.writeDocument('Main notes', 'notes.md')
      await provider.writeDocument('Auth findings', 'findings/auth.md')

      const notesResult = await callTool('team_doc_read', { file: 'notes.md' })
      const findingsResult = await callTool('team_doc_read', { file: 'findings/auth.md' })

      expect(notesResult).toBe('Main notes')
      expect(findingsResult).toBe('Auth findings')
    })
  })

  describe('team_doc_write', () => {
    test('writes document content', async () => {
      const result = await callTool('team_doc_write', {
        content: '# New Content',
      })

      expect(result).toContain('written successfully')

      const content = await provider.readDocument()
      expect(content).toBe('# New Content')
    })

    test('writes to specific file', async () => {
      await callTool('team_doc_write', {
        content: 'Findings content',
        file: 'findings.md',
      })

      const content = await provider.readDocument('findings.md')
      expect(content).toBe('Findings content')
    })

    test('overwrites existing content', async () => {
      await provider.writeDocument('Old content')

      await callTool('team_doc_write', { content: 'New content' })

      const content = await provider.readDocument()
      expect(content).toBe('New content')
    })
  })

  describe('team_doc_append', () => {
    test('appends to document', async () => {
      await provider.writeDocument('First')

      const result = await callTool('team_doc_append', { content: '\nSecond' })

      expect(result).toContain('appended')

      const content = await provider.readDocument()
      expect(content).toBe('First\nSecond')
    })

    test('appends to specific file', async () => {
      await provider.writeDocument('Start', 'notes.md')

      await callTool('team_doc_append', { content: '\nMore', file: 'notes.md' })

      const content = await provider.readDocument('notes.md')
      expect(content).toBe('Start\nMore')
    })

    test('appends to empty document', async () => {
      await callTool('team_doc_append', { content: 'First content' })

      const content = await provider.readDocument()
      expect(content).toBe('First content')
    })
  })

  describe('team_doc_list', () => {
    test('lists all document files', async () => {
      await provider.writeDocument('Notes', 'notes.md')
      await provider.writeDocument('Findings', 'findings.md')

      const result = (await callTool('team_doc_list', {})) as {
        files: string[]
        count: number
      }

      expect(result.count).toBe(2)
      expect(result.files).toContain('notes.md')
      expect(result.files).toContain('findings.md')
    })

    test('returns empty for no documents', async () => {
      const result = (await callTool('team_doc_list', {})) as {
        files: string[]
        count: number
      }

      expect(result.files).toEqual([])
      expect(result.count).toBe(0)
    })
  })

  describe('team_doc_create', () => {
    test('creates new document', async () => {
      const result = await callTool('team_doc_create', {
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
        callTool('team_doc_create', {
          file: 'existing.md',
          content: 'New content',
        })
      ).rejects.toThrow()
    })
  })

  describe('team_members', () => {
    test('lists all agents in workflow', async () => {
      const result = (await callTool('team_members', {})) as {
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
        'team_members',
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
      const result = (await callTool('team_members', {})) as {
        agents: Array<{ isYou: boolean }>
      }

      // All agents should have isYou: false when caller is anonymous
      expect(result.agents.every((a) => a.isYou === false)).toBe(true)
    })
  })
})

