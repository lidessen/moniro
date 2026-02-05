import { describe, test, expect, beforeEach, afterEach } from 'bun:test'
import { mkdirSync, rmSync, existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

import {
  extractMentions,
  MemoryContextProvider,
  FileContextProvider,
  createFileContextProvider,
} from '../src/workflow/context/index.ts'

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

  describe('mention operations', () => {
    test('gets unread mentions', async () => {
      await provider.appendChannel('agent1', '@agent2 please review')
      await provider.appendChannel('agent3', '@agent2 also check this')

      const mentions = await provider.getUnreadMentions('agent2')
      expect(mentions).toHaveLength(2)
      expect(mentions[0].from).toBe('agent1')
      expect(mentions[1].from).toBe('agent3')
    })

    test('acknowledges mentions', async () => {
      const entry = await provider.appendChannel('agent1', '@agent2 please review')
      await provider.appendChannel('agent3', '@agent2 also check this')

      await provider.acknowledgeMentions('agent2', entry.timestamp)

      const mentions = await provider.getUnreadMentions('agent2')
      expect(mentions).toHaveLength(1)
      expect(mentions[0].from).toBe('agent3')
    })

    test('returns empty for no mentions', async () => {
      await provider.appendChannel('agent1', 'No mentions')

      const mentions = await provider.getUnreadMentions('agent2')
      expect(mentions).toEqual([])
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
  })

  describe('test helpers', () => {
    test('clear removes all data', async () => {
      await provider.appendChannel('agent1', 'Message')
      await provider.writeDocument('Content')
      await provider.acknowledgeMentions('agent2', new Date().toISOString())

      provider.clear()

      expect(await provider.readChannel()).toEqual([])
      expect(await provider.readDocument()).toBe('')
      expect(provider.getMentionState('agent2')).toBeUndefined()
    })

    test('getChannelEntries returns copy', async () => {
      await provider.appendChannel('agent1', 'Test')
      const entries = provider.getChannelEntries()
      expect(entries).toHaveLength(1)
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
    provider = new FileContextProvider(
      join(testDir, 'channel.md'),
      join(testDir, 'notes.md'),
      join(testDir, '.mention-state.json'),
      ['agent1', 'agent2', 'agent3']
    )
  })

  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true })
  })

  describe('channel operations', () => {
    test('appends to channel file', async () => {
      await provider.appendChannel('agent1', 'Hello world')

      const channelPath = join(testDir, 'channel.md')
      expect(existsSync(channelPath)).toBe(true)

      const content = readFileSync(channelPath, 'utf-8')
      expect(content).toContain('[agent1]')
      expect(content).toContain('Hello world')
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

      const newProvider = new FileContextProvider(
        join(testDir, 'new-channel.md'),
        join(testDir, 'notes.md'),
        join(testDir, '.mention-state.json'),
        ['agent1']
      )

      const entries = await newProvider.readChannel()
      expect(entries).toEqual([])
    })
  })

  describe('mention operations', () => {
    test('gets unread mentions', async () => {
      await provider.appendChannel('agent1', '@agent2 check this')

      const mentions = await provider.getUnreadMentions('agent2')
      expect(mentions).toHaveLength(1)
      expect(mentions[0].from).toBe('agent1')
      expect(mentions[0].target).toBe('agent2')
    })

    test('persists mention state to file', async () => {
      const entry = await provider.appendChannel('agent1', '@agent2 check this')
      await provider.acknowledgeMentions('agent2', entry.timestamp)

      // Create new provider to verify persistence
      const newProvider = new FileContextProvider(
        join(testDir, 'channel.md'),
        join(testDir, 'notes.md'),
        join(testDir, '.mention-state.json'),
        ['agent1', 'agent2']
      )

      const mentions = await newProvider.getUnreadMentions('agent2')
      expect(mentions).toEqual([])
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
    expect(existsSync(join(testDir, 'notes.md'))).toBe(true)
  })

  test('creates provider with custom paths', async () => {
    const provider = createFileContextProvider(testDir, ['agent1'], {
      channelFile: 'custom-channel.md',
      documentFile: 'custom-notes.md',
    })

    await provider.appendChannel('agent1', 'Test')
    await provider.writeDocument('Notes')

    expect(existsSync(join(testDir, 'custom-channel.md'))).toBe(true)
    expect(existsSync(join(testDir, 'custom-notes.md'))).toBe(true)
  })
})
