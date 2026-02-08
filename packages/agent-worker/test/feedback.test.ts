/**
 * Feedback Tool Tests
 */

import { describe, test, expect } from 'bun:test'
import {
  createFeedbackTool,
  FEEDBACK_PROMPT,
  type FeedbackEntry,
} from '../src/agent/tools/feedback.js'

/** Helper: call the tool's execute function directly */
async function submitFeedback(
  toolResult: ReturnType<typeof createFeedbackTool>,
  args: Record<string, unknown>,
) {
  const t = toolResult.tool as { execute: (args: Record<string, unknown>) => Promise<unknown> }
  return t.execute(args)
}

describe('createFeedbackTool', () => {
  test('returns tool, getFeedback, and clearFeedback', () => {
    const result = createFeedbackTool()

    expect(result.tool).toBeDefined()
    expect(typeof result.getFeedback).toBe('function')
    expect(typeof result.clearFeedback).toBe('function')
  })

  test('starts with empty feedback', () => {
    const { getFeedback } = createFeedbackTool()
    expect(getFeedback()).toEqual([])
  })

  describe('execute', () => {
    test('records a feedback entry with required fields', async () => {
      const result = createFeedbackTool()

      const response = await submitFeedback(result, {
        target: 'file-search',
        type: 'missing',
        description: 'Need a recursive grep tool',
      })

      expect(response).toEqual({ recorded: true })

      const entries = result.getFeedback()
      expect(entries).toHaveLength(1)
      expect(entries[0]!.target).toBe('file-search')
      expect(entries[0]!.type).toBe('missing')
      expect(entries[0]!.description).toBe('Need a recursive grep tool')
      expect(entries[0]!.timestamp).toBeTruthy()
      expect(entries[0]!.context).toBeUndefined()
    })

    test('records optional context field', async () => {
      const result = createFeedbackTool()

      await submitFeedback(result, {
        target: 'bash',
        type: 'friction',
        description: 'Timeout too short for builds',
        context: 'Running npm run build in a large monorepo',
      })

      const entries = result.getFeedback()
      expect(entries[0]!.context).toBe('Running npm run build in a large monorepo')
    })

    test('accepts all three valid types', async () => {
      const result = createFeedbackTool()

      for (const type of ['missing', 'friction', 'suggestion'] as const) {
        await submitFeedback(result, {
          target: 'test',
          type,
          description: `Testing ${type}`,
        })
      }

      const entries = result.getFeedback()
      expect(entries).toHaveLength(3)
      expect(entries.map((e) => e.type)).toEqual(['missing', 'friction', 'suggestion'])
    })

    test('falls back to suggestion for invalid type', async () => {
      const result = createFeedbackTool()

      await submitFeedback(result, {
        target: 'test',
        type: 'bug',
        description: 'Invalid type should fallback',
      })

      const entries = result.getFeedback()
      expect(entries[0]!.type).toBe('suggestion')
    })

    test('accumulates multiple entries in order', async () => {
      const result = createFeedbackTool()

      await submitFeedback(result, {
        target: 'a',
        type: 'missing',
        description: 'first',
      })
      await submitFeedback(result, {
        target: 'b',
        type: 'friction',
        description: 'second',
      })

      const entries = result.getFeedback()
      expect(entries).toHaveLength(2)
      expect(entries[0]!.target).toBe('a')
      expect(entries[1]!.target).toBe('b')
    })
  })

  describe('maxEntries', () => {
    test('enforces default cap of 50', async () => {
      const result = createFeedbackTool()

      for (let i = 0; i < 55; i++) {
        await submitFeedback(result, {
          target: `tool-${i}`,
          type: 'suggestion',
          description: `Entry ${i}`,
        })
      }

      const entries = result.getFeedback()
      expect(entries).toHaveLength(50)
      // Oldest entries should have been evicted
      expect(entries[0]!.target).toBe('tool-5')
      expect(entries[49]!.target).toBe('tool-54')
    })

    test('respects custom maxEntries', async () => {
      const result = createFeedbackTool({ maxEntries: 3 })

      for (let i = 0; i < 5; i++) {
        await submitFeedback(result, {
          target: `t-${i}`,
          type: 'missing',
          description: `Entry ${i}`,
        })
      }

      const entries = result.getFeedback()
      expect(entries).toHaveLength(3)
      expect(entries[0]!.target).toBe('t-2')
      expect(entries[2]!.target).toBe('t-4')
    })
  })

  describe('onFeedback callback', () => {
    test('calls onFeedback for each submission', async () => {
      const received: FeedbackEntry[] = []
      const result = createFeedbackTool({
        onFeedback: (entry) => received.push(entry),
      })

      await submitFeedback(result, {
        target: 'readFile',
        type: 'friction',
        description: 'Too slow on large files',
      })

      expect(received).toHaveLength(1)
      expect(received[0]!.target).toBe('readFile')
    })
  })

  describe('getFeedback', () => {
    test('returns a copy (not a reference to internal array)', async () => {
      const result = createFeedbackTool()

      await submitFeedback(result, {
        target: 'test',
        type: 'suggestion',
        description: 'Test isolation',
      })

      const snapshot = result.getFeedback()
      // Mutating the snapshot should not affect internal state
      snapshot.pop()
      expect(result.getFeedback()).toHaveLength(1)
    })
  })

  describe('clearFeedback', () => {
    test('removes all entries', async () => {
      const result = createFeedbackTool()

      await submitFeedback(result, {
        target: 'test',
        type: 'missing',
        description: 'Will be cleared',
      })

      expect(result.getFeedback()).toHaveLength(1)
      result.clearFeedback()
      expect(result.getFeedback()).toHaveLength(0)
    })

    test('allows new entries after clearing', async () => {
      const result = createFeedbackTool()

      await submitFeedback(result, {
        target: 'old',
        type: 'missing',
        description: 'Old entry',
      })
      result.clearFeedback()

      await submitFeedback(result, {
        target: 'new',
        type: 'suggestion',
        description: 'New entry',
      })

      const entries = result.getFeedback()
      expect(entries).toHaveLength(1)
      expect(entries[0]!.target).toBe('new')
    })
  })

  describe('isolation', () => {
    test('separate instances do not share state', async () => {
      const a = createFeedbackTool()
      const b = createFeedbackTool()

      await submitFeedback(a, {
        target: 'only-a',
        type: 'missing',
        description: 'Only in A',
      })

      expect(a.getFeedback()).toHaveLength(1)
      expect(b.getFeedback()).toHaveLength(0)
    })
  })
})

describe('FEEDBACK_PROMPT', () => {
  test('mentions the feedback tool', () => {
    expect(FEEDBACK_PROMPT).toContain('`feedback`')
  })

  test('describes workflow improvement purpose', () => {
    expect(FEEDBACK_PROMPT).toContain('improve the workflow')
  })
})
