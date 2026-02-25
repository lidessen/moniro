import { describe, test, expect } from 'bun:test'

// ==================== Target Identifier Tests ====================

import {
  parseTarget,
  buildTarget,
  isValidName,
  DEFAULT_WORKFLOW,
  DEFAULT_TAG,
} from '../src/cli/target.ts'

describe('parseTarget', () => {
  test('parses simple agent name', () => {
    const result = parseTarget('reviewer')
    expect(result.agent).toBe('reviewer')
    expect(result.workflow).toBe('global')
    expect(result.tag).toBe('main')
    expect(result.full).toBe('reviewer@global:main')
  })

  test('parses agent@workflow format', () => {
    const result = parseTarget('reviewer@pr-123')
    expect(result.agent).toBe('reviewer')
    expect(result.workflow).toBe('pr-123')
    expect(result.tag).toBe('main')
  })

  test('handles explicit global workflow', () => {
    const result = parseTarget('assistant@global')
    expect(result.agent).toBe('assistant')
    expect(result.workflow).toBe('global')
  })

  test('handles empty workflow after @', () => {
    const result = parseTarget('agent@')
    expect(result.agent).toBe('agent')
    expect(result.workflow).toBe('global')
  })

  test('handles multiple @ symbols', () => {
    const result = parseTarget('agent@instance@extra')
    expect(result.agent).toBe('agent')
    expect(result.workflow).toBe('instance@extra')
  })

  test('handles hyphenated names', () => {
    const result = parseTarget('code-reviewer@feature-branch')
    expect(result.agent).toBe('code-reviewer')
    expect(result.workflow).toBe('feature-branch')
  })

  test('handles underscored names', () => {
    const result = parseTarget('test_agent@test_workflow')
    expect(result.agent).toBe('test_agent')
    expect(result.workflow).toBe('test_workflow')
  })

  test('handles numeric workflow', () => {
    const result = parseTarget('worker@123')
    expect(result.agent).toBe('worker')
    expect(result.workflow).toBe('123')
  })

  test('parses full agent@workflow:tag format', () => {
    const result = parseTarget('reviewer@review:pr-123')
    expect(result.agent).toBe('reviewer')
    expect(result.workflow).toBe('review')
    expect(result.tag).toBe('pr-123')
    expect(result.full).toBe('reviewer@review:pr-123')
  })

  test('parses workflow-only target @workflow', () => {
    const result = parseTarget('@review')
    expect(result.agent).toBeUndefined()
    expect(result.workflow).toBe('review')
    expect(result.tag).toBe('main')
  })

  test('parses workflow-only target @workflow:tag', () => {
    const result = parseTarget('@review:pr-123')
    expect(result.agent).toBeUndefined()
    expect(result.workflow).toBe('review')
    expect(result.tag).toBe('pr-123')
  })
})

describe('buildTarget', () => {
  test('builds with explicit workflow', () => {
    expect(buildTarget('agent', 'prod')).toBe('agent@prod:main')
  })

  test('builds with default workflow when undefined', () => {
    expect(buildTarget('agent', undefined)).toBe('agent@global:main')
  })

  test('builds with default workflow when empty', () => {
    expect(buildTarget('agent', '')).toBe('agent@global:main')
  })

  test('preserves special characters in workflow', () => {
    expect(buildTarget('agent', 'pr-123')).toBe('agent@pr-123:main')
    expect(buildTarget('agent', 'feature_branch')).toBe('agent@feature_branch:main')
  })

  test('builds workflow-only target (no agent)', () => {
    expect(buildTarget(undefined, 'review', 'pr-123')).toBe('@review:pr-123')
  })

  test('builds with explicit tag', () => {
    expect(buildTarget('agent', 'review', 'pr-123')).toBe('agent@review:pr-123')
  })
})

describe('isValidName', () => {
  test('accepts alphanumeric', () => {
    expect(isValidName('test123')).toBe(true)
    expect(isValidName('ABC')).toBe(true)
    expect(isValidName('123')).toBe(true)
  })

  test('accepts hyphens', () => {
    expect(isValidName('my-workflow')).toBe(true)
    expect(isValidName('pr-123')).toBe(true)
  })

  test('accepts underscores', () => {
    expect(isValidName('my_workflow')).toBe(true)
    expect(isValidName('test_123')).toBe(true)
  })

  test('accepts dots', () => {
    expect(isValidName('test.workflow')).toBe(true)
    expect(isValidName('v1.2.3')).toBe(true)
  })

  test('accepts mixed valid characters', () => {
    expect(isValidName('my-test_workflow-123')).toBe(true)
  })

  test('rejects spaces', () => {
    expect(isValidName('my workflow')).toBe(false)
  })

  test('rejects special characters', () => {
    expect(isValidName('test@workflow')).toBe(false)
    expect(isValidName('test/workflow')).toBe(false)
    expect(isValidName('test:workflow')).toBe(false)
    expect(isValidName('test!workflow')).toBe(false)
  })

  test('rejects empty string', () => {
    expect(isValidName('')).toBe(false)
  })
})

describe('DEFAULT_WORKFLOW', () => {
  test('is "global"', () => {
    expect(DEFAULT_WORKFLOW).toBe('global')
  })

  test('DEFAULT_TAG is "main"', () => {
    expect(DEFAULT_TAG).toBe('main')
  })
})

// ==================== Integration: parseTarget + buildTarget ====================

describe('parseTarget + buildTarget roundtrip', () => {
  test('parseTarget extracts workflow', () => {
    const parsed = parseTarget('agent@prod')
    expect(parsed.workflow).toBe('prod')
  })

  test('buildTarget includes tag', () => {
    const built = buildTarget('agent', 'prod')
    expect(built).toBe('agent@prod:main')
  })

  test('roundtrip: build → parse → verify', () => {
    const built = buildTarget('agent', 'review', 'pr-42')
    expect(built).toBe('agent@review:pr-42')

    const parsed = parseTarget(built)
    expect(parsed.agent).toBe('agent')
    expect(parsed.workflow).toBe('review')
    expect(parsed.tag).toBe('pr-42')
  })

  test('roundtrip with defaults: build → parse → verify', () => {
    const built = buildTarget('worker')
    expect(built).toBe('worker@global:main')

    const parsed = parseTarget(built)
    expect(parsed.agent).toBe('worker')
    expect(parsed.workflow).toBe('global')
    expect(parsed.tag).toBe('main')
  })
})
